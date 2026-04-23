# Batch 3 — MCP 層整體重構（3-5 天）

## 包含 Issues
- **Issue 2** — MCP client 無連線池，每次工具呼叫都新建 SSE 連線
- **Issue 3** — MCP `serverId` resolution 的 fallback 不嚴謹
- **Issue 14（部分）** — `ensureMcpToolsLoadedForServers` 的 cache stampede（同 server 並發呼叫造成重複 `tools/list`）

（Issue 14 其餘場景 — skill 執行 race condition、tutorial restore lock — 留給 Batch 4 與 Batch 4.5 處理。）

## 為何整合
三個 issue 都會新增 / 修改 `src/mcp/` 目錄，且 caller 是**同一批程式碼**：
- `src/app/App.tsx:3622`（`ensureMcpToolsLoadedForServers`）
- `src/app/App.tsx:4864`（`executeResolvedToolSelection`）
- `src/app/App.tsx:5066`（skill executor 內的 `resolveMcpServerId`）
- `src/ui/McpPanel.tsx:129, 171`（測試連線 / 列工具）

如果分開做，會在這幾段程式碼**動兩次**，且每次都有衝突風險。一起做的話：
- 一次性把 `App.tsx` 內 5+ 處 MCP 呼叫點改成走 `clientManager` + `serverResolver`
- 一個 PR 涵蓋整個 MCP 層的責任邊界重劃

## 工作量
3-5 天

## 風險
中高 — 動到 runtime 連線管理，要小心 connection leak / race condition；強烈建議搭配 fake MCP server 做整合測試

## 前置依賴
- **強烈建議先做 Batch 2**：本 batch 會動 `src/mcp/sseClient.ts` 的 RPC 型別，如果還是 `any` 會難 refactor
- Batch 1 非必要但已做更好（Error Boundary 在 SSE 異常時可救援）

## 執行順序建議

### Step 1：抽 `serverResolver`（Issue 3）
- 新增 `src/mcp/serverResolver.ts`：
  ```ts
  export type McpServerResolution =
    | { ok: true; serverId: string; matchedBy: "exact-id" | "exact-name" | "fuzzy" | "single-tool-match" }
    | { ok: false; reason: "ambiguous" | "no-match" | "invalid-input"; candidates?: string[] };

  export function resolveMcpServerId(args: {
    requestedServerId?: string | null;
    toolName: string;
    availableMcpTools: Array<{ server: McpServerConfig; tools: McpTool[] }>;
  }): McpServerResolution
  ```
- 補 unit test 涵蓋 6 個 case（exact id / exact name / fuzzy / 單一 tool match / 多 tool match / 垃圾 serverId）
- 替換 `src/app/App.tsx:307` 與 `:5066` 兩處實作 → 統一 import
- caller 改成處理 `ok: false` 分支（log + 回給 model 修正提示），**不再回傳無效 serverId**

### Step 2：建立 `McpClientManager` + tool catalog（Issue 2 + Issue 14 部分）
- 新增 `src/mcp/clientManager.ts`：
  ```ts
  export class McpClientManager {
    private clients = new Map<string, McpSseClient>();
    private idleTimers = new Map<string, number>();
    private idleMs = 60_000;

    get(server: McpServerConfig, onLog?: (m: string) => void): McpSseClient { ... }
    private scheduleIdleClose(serverId: string) { ... }
    closeAll() { ... }
  }
  ```
- 行為：
  - 同一個 `server.id` 重用 client，連線狀態壞掉時自動重建
  - 60s idle 自動 close
  - app unmount 時 `closeAll()`
- 注意：**測試連線按鈕（`McpPanel.tsx:129`）不該走 pool**，因為它是即時健康檢查，每次都該開新 client

**同時新增 `src/mcp/toolCatalog.ts` 處理 cache stampede（Issue 14 部分）**：
```ts
export class McpToolCatalog {
  private cache = new Map<string, McpTool[]>();
  private inflight = new Map<string, Promise<McpTool[]>>();

  async load(server: McpServerConfig, manager: McpClientManager): Promise<McpTool[]> {
    const cached = this.cache.get(server.id);
    if (cached) return cached;

    const existing = this.inflight.get(server.id);
    if (existing) return existing;  // 復用進行中的 promise，避免 stampede

    const promise = this.fetchTools(server, manager)
      .then((tools) => {
        this.cache.set(server.id, tools);
        return tools;
      })
      .finally(() => this.inflight.delete(server.id));

    this.inflight.set(server.id, promise);
    return promise;
  }

  invalidate(serverId: string) { this.cache.delete(serverId); }
}
```
- `ensureMcpToolsLoadedForServers()` 改用 `toolCatalog.load(server)`，同 server 並發呼叫只會打一次 `tools/list`
- server 設定變更時呼叫 `invalidate(serverId)`

### Step 3：改寫 caller
依序替換：
1. `src/app/App.tsx:3622` `ensureMcpToolsLoadedForServers` — 走 manager
2. `src/app/App.tsx:4864` `executeResolvedToolSelection` — 走 manager + 新 resolver
3. `src/app/App.tsx:5066` skill executor 內 — 統一用 resolver
4. `src/ui/McpPanel.tsx:171` 列工具 — 走 manager
5. `src/ui/McpPanel.tsx:129` 測試連線 — **保留** `new McpSseClient(...)` 不走 pool

### Step 4：補測試
- `serverResolver.test.ts`（unit）
- `clientManager.test.ts`（mock McpSseClient）
- `toolCatalog.test.ts`（驗證 stampede dedup：同時呼叫 N 次 `load()` 應只觸發 1 次 fetchTools）
- 整合 test：用 `mcp-test/server.js`（已在 Batch 1 加固）做 happy path 連線重用驗證

## 驗收條件
- 同一個 MCP server 連續呼叫 5 個 tool，只有 1 條 SSE 連線（看 `mcp-test/server.js` log）
- 同時觸發 3 個 `ensureMcpToolsLoadedForServers([sameServer])`，server 應只看到 **1 次** `tools/list`
- 給故意錯的 `serverId`，會在 log 看到 `mcp_routing_fallback` 標記，不會盲目走預設 server
- 60s 沒呼叫後連線自動關閉
- App unmount / hot reload 時不殘留 `EventSource`

## 後續鋪墊
- Batch 4 拆 App.tsx 時，MCP 邏輯已封裝乾淨，可直接搬進 `useMcp()` hook
- `clientManager` 也是 Batch 4 `McpContext` 的天然 backing store

## 不要做的事
- 不要在這個 batch 內把 `executeResolvedToolSelection` 抽出 App.tsx（留給 Batch 4 一次處理）
- 不要動 SSE 協定本身（heartbeat / handshake 機制），只改連線管理層
- 不要 import 任何 React hook 進 `clientManager`，保持純 class（方便測試）
