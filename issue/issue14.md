# Issue 14 — 並發執行的 race conditions（shared ref 競寫、MCP cache stampede）

## 嚴重度
Medium-High

## 觀察到的問題
專案內多個 ref / cache 是**單例 shared mutable state**，但沒有任何 lock / dedup / queue 機制。當以下情境發生時會競寫或重複工作：

### 場景 A：同 server 並發拉 MCP 工具清單
`src/app/App.tsx:3620` 的 `ensureMcpToolsLoadedForServers()`：
```ts
const unknownServers = servers.filter((server) => !mcpToolsByServer[server.id]);
const loadedEntries = await Promise.all(
  unknownServers.map(async (server) => {
    const client = new McpSseClient(server);
    // ... 連線、列工具 ...
  })
);
```
- 若兩個 caller 同時呼叫，且 `mcpToolsByServer[serverId]` 還沒寫入
- 兩邊都看到 cache miss，都各自開連線、列工具
- 結果：同一台 server 短時間內多次 `tools/list`，浪費網路 + 在 server log 看到重複請求
- 這就是 cache stampede 經典案例

### 場景 B：多個 skill / chat 同時跑，trace ref 被覆蓋
`src/app/App.tsx` 內存在多個 `*Ref.current` 用來累積 trace / state：
- `skillTraceRef.current`
- 多輪 skill 內的 currentContext
- 各種 `Promise.all(...)` 寫入後再 set 進 React state

如果使用者：
1. 開始一個 long-running skill
2. 在 skill 還沒跑完前，啟動另一個 chat / skill
3. 兩個執行流共用同一個 ref

→ ref 會被混合覆蓋，trace 順序錯亂、最終 state 不一致。

### 場景 C：load balancer failover 與 skill 執行交錯
- skill 跑到一半，某個 LB instance 失敗 → failover 切換 instance
- 切換時更新 `loadBalancers` state
- 同一時間另一個 skill 也在用同一個 LB → 拿到「正在切換中」的不一致狀態

### 場景 D：tutorial restore 時主流程仍可寫入
- 使用者可以在 tutorial 還在 restore workspace snapshot 時觸發 chat
- 兩邊同時改 storage / state，最終結果未定義

### 為什麼之前沒被涵蓋
- Issue 1（god component）只談結構，沒展開 race condition
- Issue 2（MCP pool）會解決部分場景 A，但 dedup 邏輯（in-flight request tracking）需要明確設計
- 這類問題在「使用者單一線程操作」下不會發生，但 agent / skill 啟動非同步任務後就會冒出來

## 來源檔案
- `src/app/App.tsx`（多處 `Promise.all`：3620, 3835, 3897, 3969 等）
- `src/runtime/multiTurnSkillRuntime.ts`（trace 累積）
- `src/runtime/skillTrace.ts`（如果有 shared 累積邏輯）
- `src/utils/loadBalancer.ts`（failover 狀態更新）

## 建議做法

### Step 1：MCP cache stampede 防護（屬於 Batch 3 範圍）
在 `McpClientManager` 或 tool catalog 層加 in-flight tracking：
```ts
class McpToolCatalog {
  private cache = new Map<string, McpTool[]>();
  private inflight = new Map<string, Promise<McpTool[]>>();

  async load(server: McpServerConfig): Promise<McpTool[]> {
    const cached = this.cache.get(server.id);
    if (cached) return cached;

    const existing = this.inflight.get(server.id);
    if (existing) return existing;  // 復用進行中的 promise

    const promise = this.actualLoad(server)
      .then((tools) => {
        this.cache.set(server.id, tools);
        return tools;
      })
      .finally(() => this.inflight.delete(server.id));

    this.inflight.set(server.id, promise);
    return promise;
  }
}
```

### Step 2：Skill 執行加 instance lock / queue
- 同一個 skill 同時間只允許一個 instance 跑（最簡單）
- 或：每個 skill instance 都有獨立 trace 物件，不共用 ref
- 屬於 Batch 4（拆 App.tsx）的範圍 — 抽 `useSkillExecution()` 時順便加 lock：
```ts
const executionLockRef = useRef<Map<string, AbortController>>(new Map());

async function startSkill(skillId: string, ...) {
  const existing = executionLockRef.current.get(skillId);
  if (existing) {
    // 選項：拒絕 / 取消舊的 / 排隊
    throw new Error(`Skill ${skillId} is already running`);
    // 或：existing.abort(); // 取消舊的
  }
  const controller = new AbortController();
  executionLockRef.current.set(skillId, controller);
  try {
    await runSkill({ signal: controller.signal });
  } finally {
    executionLockRef.current.delete(skillId);
  }
}
```

### Step 3：trace per-execution，不再共用單例
- 把 `skillTraceRef` 改成由 caller 傳入的參數
- 每次 `executeMultiTurnSkill()` 自己持有 `localTrace: ChatTraceEntry[]`，最後一次性 commit 到 React state
- 中途取消（Issue 13）只會丟掉那個 local trace，不影響其他執行流

### Step 4：tutorial restore 期間鎖主流程
- 進入 restore mode 時設 `isRestoringRef.current = true`
- chat / skill 啟動前檢查此 flag，拒絕並提示「Tutorial 正在恢復，請稍候」
- restore 完成後解鎖

### Step 5：UI 層 disable 並發觸發
- 「Send」按鈕在 chat 進行中應 disabled
- skill 執行時對應 UI 應 disabled
- 雖然這不能完全解決問題，但是第一道防線

## 與其他 issue 的關聯
- 場景 A（MCP stampede）→ 屬於 **Batch 3**（與 Issue 2/3 一起）
- 場景 B/C（skill / LB race）→ 屬於 **Batch 4**（拆 App.tsx 時順便處理）
- 場景全部都需要 **Issue 13**（AbortController 串連）才能乾淨清理

## 驗收條件
- 同時呼叫兩次 `ensureMcpToolsLoadedForServers([server])`，server 應只看到 **1 次** `tools/list` 請求
- 同一 skill 同時觸發兩次，第二次應被拒絕（或取消第一次，視政策決定）
- 兩個不同 chat / skill 並行，trace 不互相污染

## 影響
- 重複網路請求浪費頻寬
- trace 錯亂導致 debug 困難、tutorial / 紀錄回放失準
- 使用者觀感：state 偶爾「跳」一下、變回舊值
