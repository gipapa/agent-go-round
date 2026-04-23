# Batch 1 — Quick Wins（1-1.5 天）

## 包含 Issues
- **Issue 4** — `mcp-test/server.js` 缺輸入驗證
- **Issue 6** — 整個 App 沒有 React Error Boundary
- **Issue 11** — Adapter 的 `fetch()` 無 timeout / 無 cancellation

## 為何整合
三個 issue 都屬於「**新增程式碼、不動既有邏輯**」：
- Issue 4 只改 `mcp-test/server.js` 一個檔，跟前端完全無關
- Issue 6 新增一個 component + 在 `main.tsx` 包一層
- Issue 11 新增 `fetchWithTimeout` helper，三個 adapter 各換 1-2 處 fetch

Issue 11 看起來像 reliability 議題，但**修法純粹是「換掉 fetch、不動業務邏輯」**，且是 Batch 4.5（取消串連）的前置條件，所以放在這裡先做。

風險最低，可當暖身。完成後立即提升開發體驗（測試 server 不會 crash、白畫面有救援路徑、API 慢回不再卡死 UI）。

## 工作量
1-1.5 天

## 風險
極低 — 純新增、不破壞現有行為（Issue 11 加的 timeout 預設給較寬鬆的 60 秒，避免誤殺）

## 執行順序建議

### Step 1：Issue 4（mcp-test 加驗證）
- 改 `mcp-test/server.js`：
  - body 型別檢查（非 object 回 400）
  - `id` / `method` 必填驗證
  - try/catch wrapper
  - global error handler
- 重啟 `mcp-test/run.sh`，手動丟幾個 malformed request 驗證不會 crash

### Step 2：Issue 6（Error Boundary）
- 新增 `src/ui/ErrorBoundary.tsx`
- 在 `src/main.tsx` 包 root
- 重點 risky 區塊（ChatPanel、SkillsPanel、McpPanel、tool output render）各包一層
- 串接到既有 `logNow({ category: "render_error", ... })`
- （可選）加 `window.addEventListener("unhandledrejection", ...)` 補 async exception

### Step 3：Issue 11（fetch timeout / cancellation）
- 新增 `src/utils/fetchWithTimeout.ts`：包 AbortController + timeout + 串外部 signal
- `src/adapters/base.ts` 的 `ChatRequest` 介面新增 `signal?: AbortSignal` 與 `timeoutMs?: number`（暫不強制使用）
- 替換各 adapter 內所有 `fetch(...)` 呼叫：
  - `src/adapters/openaiCompat.ts`（行 16, 50）
  - `src/adapters/custom.ts`（行 42）
- streaming response 的 `for await` 迴圈內檢查 `signal.aborted`（openaiCompat）
- 預設 timeout 給 60 秒（Batch 4.5 會接 deadline helper 後變更精細）
- 三個 adapter 統一處理 429（如果 custom / chromePrompt 還沒做）+ 尊重 `Retry-After` header
- **不**在這個 batch 串 UI 「停止」按鈕（留給 Batch 4.5）

## 驗收條件
- mcp-test server 在收到空 body / 缺欄位 / 非 JSON 時回 400 而非 500 / crash
- 在某個 panel 內手動 `throw new Error("test")` 能看到 fallback UI 而非整頁白畫面
- Error 能在 logs 看到
- 對著故意 hang 的 mock endpoint 呼叫 chat，60 秒後應自動結束（看到「fetch timeout」訊息）
- 既有測試（vitest）仍綠

## 後續鋪墊
- 完成 Issue 11 後，Batch 4.5 可直接利用 `signal` 串通取消鏈
- 完成 Error Boundary 後，Batch 4.5 / Batch 4 重構過程中的錯誤都有保險絲

## 不要做的事
- 不要順手改 mcp-test 的 echo / time tool 行為（scope creep）
- 不要在這個 batch 內試圖整合 logger 或加 telemetry，留給後續
- Issue 11 不要順手把 `fetchWithTimeout` 推到 MCP 層（MCP 是 SSE，不同機制，留給 Batch 3）
