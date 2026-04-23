# Issue 11 — Adapter fetch timeout / cancellation：adapter 層已完成，caller 端尚未串接

## 嚴重度
Medium（先前為 High，adapter 層修完後降級；剩下的 caller 串接缺口由 Issue 13 接手追蹤）

## 現況（2026-04 更新）

### ✅ 已完成（adapter 層）

- **`src/adapters/base.ts`** `ChatRequest` 已加入：
  ```ts
  signal?: AbortSignal;
  timeoutMs?: number;
  ```
- **`src/utils/fetchWithTimeout.ts`** 共用 wrapper 已實作：
  - 接 external `signal` + 內部 `timeoutMs` → 合成 `AbortController`
  - 解析 `Retry-After` header（秒數或 HTTP date 格式皆支援）→ `getRetryAfterDelayMs()`
  - 配套單元測試：`src/__tests__/fetchWithTimeout.test.ts`
- **`src/adapters/openaiCompat.ts`**
  - 主呼叫透過 `fetchWithTimeout` 帶 `{ signal: req.signal, timeoutMs }`
  - streaming 迴圈各 yield 點都檢查 `req.signal?.aborted`
  - retry sleep 用 `sleepWithAbort(delayMs, req.signal)`
- **`src/adapters/custom.ts`**
  - 同樣用 `fetchWithTimeout` + `sleepWithAbort`
  - retry 迴圈會在 abort 後立即終止
- **`src/adapters/chromePrompt.ts`**
  - `createPromptAbortGuard()` 把 external signal + timeout 合成一個內部 signal
  - `raceWithAbort()` 包住每次 `iterator.next()`，streaming 中段也能取消

### ❌ 尚未完成（caller / UI 串接）

Adapter 已能接收 `signal`，但實際把 `AbortSignal` 餵下去的 caller 只有 `src/orchestrators/oneToOne.ts:24`。其餘執行路徑都沒傳：

- `src/orchestrators/magi.ts` — `invokeUnit` 沒收 signal、也沒往下傳
- `src/orchestrators/leaderTeam.ts` — 同上
- `src/runtime/multiTurnSkillRuntime.ts` — 主迴圈、`skillPlanner` / `skillExecutor` 都沒帶 signal
- `src/radio/runtime.ts` — refine call 無 signal
- `src/app/App.tsx` — 沒有對應的 ChatPanel「停止」按鈕去呼叫 `controller.abort()`，也沒有把 controller 存成 ref

### 後果（剩餘）

- 一般 chat（one-to-one）已可被取消；但 MAGI / leaderTeam / multi-turn skill / radio 仍無法中斷 → 使用者按「停止」對這些路徑無效
- Skill 跑 12 輪、每輪含多次 model call 時，使用者只能等到 `toolLoopMax` 跑完
- 雖然 adapter 自己有 fetch-level timeout，但 caller 沒辦法主動提早取消整個高階流程

## 建議做法（剩餘步驟）

> 這部分與 Issue 13（skill / orchestrator 無 wall-clock timeout、無串連取消）高度重疊，建議併入 BATCH4.5 一起執行。

### Step A：`AgentInvocationOptions` / 對應介面加 signal
為 magi / leaderTeam / multiTurn 入口統一加：
```ts
signal?: AbortSignal;
deadlineMs?: number; // 由 Issue 13 補
```
往下層 callback（`invokeUnit`, `decideNextStep`, `runTool`...）一路傳。

### Step B：UI 在 ChatPanel 持有 controller
```ts
const abortRef = useRef<AbortController | null>(null);

// 開始時
abortRef.current = new AbortController();
runOrchestrator({ signal: abortRef.current.signal, ... });

// 停止鍵
abortRef.current?.abort(new Error("user cancelled"));
```
搬出 `App.tsx` 時請與 Issue 1（god component 拆解）一起做。

### Step C：把 `req.timeoutMs` 加進 settings
目前 `DEFAULT_FETCH_TIMEOUT_MS` 是寫死常數；建議在 `settingsStore` 暴露 per-instance / per-LB 覆寫。

### Step D：MAGI / multi-turn 的取消語意
- MAGI：`Promise.all` 改 `Promise.allSettled` + 任一 unit 收到 abort 立即放棄回收 → 由 Issue 15 統籌
- multiTurn：每輪開頭檢查 `signal.aborted`，命中即中止並 yield 一個 cancelled trace entry

## 來源檔案
- 已修：`src/adapters/base.ts`、`src/utils/fetchWithTimeout.ts`、`src/adapters/openaiCompat.ts`、`src/adapters/custom.ts`、`src/adapters/chromePrompt.ts`
- 待修：`src/orchestrators/magi.ts`、`src/orchestrators/leaderTeam.ts`、`src/runtime/multiTurnSkillRuntime.ts`、`src/runtime/skillPlanner.ts`、`src/runtime/skillExecutor.ts`、`src/radio/runtime.ts`、`src/app/App.tsx`（ChatPanel 周邊）

## 驗收條件
- 任一 orchestrator（包含 MAGI / multi-turn skill / radio）跑到一半，UI「停止」鍵能在 1 秒內中斷後續 model call
- Skill multi-turn 中段取消後，trace 會留下一筆 `cancelled` entry，不再 yield 後續 token
- ChatPanel 切換對話 / 切離分頁時，前一個 controller 會自動 abort

## 影響
- 完成後與 Issue 13、15 共同收斂為「全鏈路 cancellation + deadline」能力
- 未完成前：MAGI / multi-turn / radio 路徑仍會浪費 token、卡 UI

## 相關 issue
- Issue 13 — skill / orchestrator 無 wall-clock timeout
- Issue 15 — MAGI 無 deadlock 偵測
- Issue 1 — App.tsx 拆解（ChatPanel 抽出後再做 controller ref 較乾淨）
- BATCH4.5 — 建議的整合執行批次

## 原始問題記錄（Batch1 前）

以下保留原始 code-review 記錄，用來說明此 issue 被建立時的風險背景；adapter 層已於 Batch1 修正，剩餘 caller/UI 串接轉交 Issue 13 / BATCH4.5。

### Issue 11 — Adapter 的 `fetch()` 無 timeout / 無 cancellation

### 嚴重度
High

### 觀察到的問題
所有 adapter 的 `fetch()` 都沒有 `AbortController`、沒有 timeout：

### `src/adapters/openaiCompat.ts`
- L16 `/models` detect call — 沒 timeout
- L50 `/chat/completions` 主呼叫 — 沒 timeout
- 雖有 retry（429 / network error），但每次 attempt 也沒 timeout

### `src/adapters/custom.ts`
- L42 — 沒 timeout、沒 retry、沒 abort
- 比 openaiCompat 還陽春

### `src/adapters/chromePrompt.ts`
- 走瀏覽器內建 API，但同樣沒 cancellation

### 後果
- model server 慢回（或根本不回）→ 整個 chat 卡住等到瀏覽器預設 fetch timeout（多數瀏覽器是 5 分鐘）
- 使用者按「停止」按鈕無法真的中斷請求，仍會繼續等待 + 浪費 token
- streaming response 中途 user 切換頁面，stream 也不會被取消
- retry 路徑遇到「server 慢回」會堆疊：第 1 次等 5 分鐘 → 第 2 次再等 5 分鐘
- 與 Issue 13（skill / orchestrator 無 cancellation）形成連動：上層想取消，但下層 fetch 不理

### 來源檔案
- `src/adapters/openaiCompat.ts`（行 16, 50）
- `src/adapters/custom.ts`（行 42）
- `src/adapters/chromePrompt.ts`
- `src/adapters/base.ts`（介面定義，未含 signal）

### 建議做法

### Step 1：`ChatRequest` 加 `signal?: AbortSignal`
```ts
// src/adapters/base.ts
export type ChatRequest = {
  // ... existing fields ...
  signal?: AbortSignal;
  timeoutMs?: number;
};
```

### Step 2：每個 adapter 內接 signal + 加 timeout
```ts
async function fetchWithTimeout(url: string, init: RequestInit, opts: {
  signal?: AbortSignal;
  timeoutMs?: number;
}) {
  const controller = new AbortController();
  const timeoutId = opts.timeoutMs
    ? window.setTimeout(() => controller.abort(new Error("fetch timeout")), opts.timeoutMs)
    : null;

  // 把外部 signal 串進來
  const onExternalAbort = () => controller.abort(opts.signal?.reason);
  opts.signal?.addEventListener("abort", onExternalAbort);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    if (timeoutId !== null) window.clearTimeout(timeoutId);
    opts.signal?.removeEventListener("abort", onExternalAbort);
  }
}
```
然後把 adapter 內所有 `fetch(...)` 改用這個 wrapper。

### Step 3：streaming 也要支援取消
openaiCompat.ts 內讀 stream 的 `for await` 迴圈也要檢查 `signal.aborted`，能在收到部分內容後中斷。

### Step 4：UI 串接「停止」按鈕
- ChatPanel 的「停止」按鈕應該觸發 `controller.abort()`
- 上層 hook（例如未來抽出的 `useOneToOne`）統一管理 controller

### Step 5：尊重 `Retry-After` header
adapter 既有 retry 用固定 `retryDelaySec`；如果 server 回 `Retry-After`，應優先採用：
```ts
const retryAfter = res.headers.get("Retry-After");
const delayMs = retryAfter
  ? Math.max(0, Number(retryAfter) * 1000)
  : retryDelaySec * 1000;
```

### Step 6：統一 retry 邏輯
目前只有 openaiCompat 處理 429；custom / chromePrompt 完全沒處理。建議在 `src/adapters/base.ts` 抽 `withRetry(fn, opts)` helper，三個 adapter 共用。

### 驗收條件
- 任意呼叫一個會 hang 的 mock endpoint，30 秒內 fetch 應自動中斷
- UI「停止」按鈕能真的中斷正在進行的 chat
- streaming response 中途取消，後續 chunk 不會 yield
- 三個 adapter 都有 429 處理且都尊重 `Retry-After`

### 影響
- 使用者體驗：請求卡住無救援
- token 浪費：失敗 / 逾時的請求仍會被計費
- 與 Issue 13 緊密相關（skill / orchestrator 無 cancellation 的根因之一）
