# Issue 11 — Adapter 的 `fetch()` 無 timeout / 無 cancellation

## 嚴重度
High

## 觀察到的問題
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

## 來源檔案
- `src/adapters/openaiCompat.ts`（行 16, 50）
- `src/adapters/custom.ts`（行 42）
- `src/adapters/chromePrompt.ts`
- `src/adapters/base.ts`（介面定義，未含 signal）

## 建議做法

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

## 驗收條件
- 任意呼叫一個會 hang 的 mock endpoint，30 秒內 fetch 應自動中斷
- UI「停止」按鈕能真的中斷正在進行的 chat
- streaming response 中途取消，後續 chunk 不會 yield
- 三個 adapter 都有 429 處理且都尊重 `Retry-After`

## 影響
- 使用者體驗：請求卡住無救援
- token 浪費：失敗 / 逾時的請求仍會被計費
- 與 Issue 13 緊密相關（skill / orchestrator 無 cancellation 的根因之一）
