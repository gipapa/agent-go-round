# Issue 13 — 多輪 skill / orchestrator 無 wall-clock timeout、無 AbortController 串連取消

## 嚴重度
High

## 觀察到的問題
專案內所有「會跑很多輪」的執行迴圈都只用「步數」設限，**沒有時間上限、沒有外部取消**：

### 多輪 skill runtime
`src/runtime/multiTurnSkillRuntime.ts:231` 主迴圈：
```ts
for (let round = 1; round <= args.toolLoopMax; round++) {
  // 每輪呼叫 decideNextStep / runTool / verify ...
  // 任何一步可以是 model API call（慢）或 MCP tool call（更慢）
}
```
- `toolLoopMax` 控制最多幾輪，但每輪沒上限
- 假設 `toolLoopMax = 12`、每輪含 2 次 model call + 1 次 tool call、每個慢回應可達 5 分鐘 → 理論最壞 = 12 × 3 × 5 = **180 分鐘**才會結束
- 沒有 `AbortSignal` 串進 callbacks，使用者按「停止」沒辦法真的停
- 中途丟錯時部分 trace 已寫入，沒有 transactional rollback

### MAGI consensus
`src/orchestrators/magi.ts:107`：
```ts
const roundResults = await Promise.all(
  args.units.map(async (unit) => {
    const raw = await args.invokeUnit({ ... });
    // ...
  })
);
```
- `Promise.all` 會等到「最慢」的 unit 完成
- 一個 unit hang，整輪卡住
- consensus 模式可跑多輪（`maxRounds`），最壞 case 是 `maxRounds × 最慢 unit 的最壞時間`
- 沒有 deadlock detection（見 Issue 15）

### One-to-one orchestrator
`src/orchestrators/oneToOne.ts` 與 App.tsx 內的 `runOneToOneWithLoadBalancer`：
- failover 邏輯會輪流嘗試多個 LB instance
- 每個 instance 失敗（含 timeout）才換下一個
- 結合 Issue 11（fetch 無 timeout）→ 一個 instance 可以卡 5 分鐘才換下一個

### 背景
- 沒有任何函式接收 `AbortSignal`
- callbacks chain 全部 fire-and-forget，無法 propagate cancellation
- 使用者按「停止」按鈕，目前只能停「下一輪」，當前進行中的 model call 仍會跑完且計費

## 來源檔案
- `src/runtime/multiTurnSkillRuntime.ts`（主迴圈 ~L231）
- `src/runtime/skillExecutor.ts`、`skillRuntime.ts`
- `src/orchestrators/oneToOne.ts`、`magi.ts`、`leaderTeam.ts`
- `src/app/App.tsx` 內 `executeMultiTurnSkill`、`runOneToOneWithLoadBalancer`、`sendOneToOneTurn`

## 建議做法

### Step 1：建立統一的 deadline / abort helper
新增 `src/utils/deadline.ts`：
```ts
export type ExecutionDeadline = {
  signal: AbortSignal;
  /** 距離 deadline 還剩多少 ms（負數代表已過） */
  remainingMs: () => number;
  /** 還沒過 deadline 嗎？ */
  alive: () => boolean;
};

export function createDeadline(opts: {
  totalMs: number;
  externalSignal?: AbortSignal;
}): ExecutionDeadline {
  const controller = new AbortController();
  const startedAt = Date.now();

  const timer = setTimeout(
    () => controller.abort(new Error(`Execution exceeded ${opts.totalMs}ms`)),
    opts.totalMs
  );
  opts.externalSignal?.addEventListener("abort", () => controller.abort(opts.externalSignal!.reason));

  return {
    signal: controller.signal,
    remainingMs: () => opts.totalMs - (Date.now() - startedAt),
    alive: () => !controller.signal.aborted
  };
}
```

### Step 2：multi-turn runtime 接 deadline
```ts
export async function runMultiTurnSkillRuntime(args: {
  // ... existing fields ...
  deadline?: ExecutionDeadline;
}) {
  const dl = args.deadline ?? createDeadline({ totalMs: 5 * 60_000 });

  for (let round = 1; round <= args.toolLoopMax; round++) {
    if (!dl.alive()) {
      throw new Error("Skill execution timed out (wall-clock)");
    }
    // 把 dl.signal 傳進 callbacks
    const decision = await args.callbacks.decideNextStep({ ..., signal: dl.signal });
    // ...
  }
}
```

### Step 3：MAGI 加 round timeout + race
```ts
const roundDeadlineMs = 60_000;
const roundResults = await Promise.race([
  Promise.all(args.units.map(...)),
  new Promise((_, reject) => setTimeout(
    () => reject(new Error(`MAGI round ${round} timed out`)),
    roundDeadlineMs
  ))
]);
```
進階：用 `Promise.allSettled` + 個別 unit timeout，讓快的 unit 先回，慢的 unit 標記為 timeout-skip。

### Step 4：callbacks 全部接收 `signal`
所有 `MultiTurnSkillCallbacks` / orchestrator callback 介面新增 `signal?: AbortSignal`，由執行端帶下去：
```ts
type DecideNextStepArgs = {
  // ... existing ...
  signal?: AbortSignal;
};
```
adapter 內 fetch（Issue 11）把 signal 串進去 → 從 UI 停止按鈕到 fetch 中斷整條串通。

### Step 5：UI 停止按鈕真的取消
- ChatPanel 的「停止」按鈕（如果有）持有 `AbortController`
- 觸發 `abort()` → 訊號層層下傳到 fetch → 中斷請求 → callbacks 拒絕 → orchestrator 提早結束
- 在 chat trace 寫入「使用者中斷」訊息

### Step 6：trace 紀錄 timeout 原因
- timeout 發生時要在 trace 寫清楚是哪一層、卡在哪一個 step、已花多少時間
- 方便 debug 與優化 prompt / tool

## 與其他 issue 的關聯
- 必須先做 Issue 11（fetch 加 signal），否則 deadline 串到 fetch 也沒用
- 與 Issue 15（MAGI deadlock）共用 round timeout 機制
- 與 Issue 14（race condition）相關：cancel 時要乾淨清理 ref，否則狀態會壞

## 驗收條件
- multi-turn skill 設 30 秒 deadline，跑超時應 throw 並寫入 trace
- 按「停止」按鈕，正在跑的 model call 應在 1 秒內中斷（不再消耗 token）
- MAGI 一個 unit 故意 hang，整輪應在 round timeout 內結束，其他 unit 結果保留
- 所有測試（vitest）跑得過

## 影響
- 失控的 skill 可以跑半小時，使用者只能關 tab
- token 燒錢：失敗的 skill 還是把每一輪都打完
- UX：停止按鈕變成「之後不再開新請求」而不是真的停止
