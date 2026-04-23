# Batch 4 — Reliability / Resource Limits（3-5 天）

## 包含 Issues
- **Issue 10** — `runBuiltInScriptTool` 無 timeout / 無 sandbox
- **Issue 13** — 多輪 skill / orchestrator 無 wall-clock timeout、無 AbortController 串連取消
- **Issue 15** — MAGI consensus 無 deadlock detection、無 round timeout

## 為何整合
三個 issue 本質都是「**執行限制 / 取消 / timeout**」家族：
- 共用工具：`AbortController` 串連、wall-clock deadline helper、timeout race wrapper
- 影響面：user-defined code、skill runtime、MAGI orchestrator
- 解決順序自然：先建好 `deadline helper`（Step 1）→ 三個 issue 都能複用

如果分開做：
- 會做三遍類似的 timeout / abort 機制
- 取消訊號無法跨層串連（user code timeout 觸發但 fetch 仍在跑）

## 工作量
3-5 天

## 風險
中 — 動到執行核心，要小心：
- 不要因為加 timeout 把正常的長時間請求誤殺
- AbortController 串連時注意「abort 後 cleanup 要乾淨」
- Issue 10 的 Web Worker 化會比較大改動，可能拆獨立 PR

## 前置依賴
- ✅ Batch 1 已完成（ErrorBoundary 已就位，timeout / abort 引發的 error 會被 boundary 接住）
- ✅ Batch 2 已完成（型別安全 + Zod，callbacks chain 不會再被 `any` 拖累）
- ✅ Adapter 層已完成 fetch `signal` + `timeoutMs` + `Retry-After`（先前的 Issue 11，已 merge）；本 batch 要做的是把 signal **從 caller 端串到底**

## 執行順序建議

### Step 1：建立統一的 deadline / abort 基礎建設（半天）
新增 `src/utils/deadline.ts`：
- `createDeadline({ totalMs, externalSignal? }): ExecutionDeadline`
- `timeoutAfter(ms, label): Promise<never>`
- `combineSignals(...signals): AbortSignal`
- `withTimeout<T>(promise, ms, label): Promise<T>`

補 unit test。後續所有 step 都用這些 helper。

### Step 2：Issue 13 之 multi-turn skill runtime 接 deadline（1 天）
- `MultiTurnSkillCallbacks` 介面新增 `signal?: AbortSignal`
- `runMultiTurnSkillRuntime` 主迴圈每輪檢查 `deadline.alive()`
- callbacks 內呼叫 adapter / model 時把 signal 傳下去（吃 adapter 層既有的 `signal` / `timeoutMs` 介面）
- 中途 timeout / abort 時要寫入 trace 說明原因

### Step 3：Issue 13 之 orchestrators 接 deadline（半天）
- `oneToOne.ts`、`leaderTeam.ts`、`magi.ts` 的 entry function 接收 `deadline?` 參數
- failover loop 每次切 instance 前檢查 deadline
- App.tsx 內呼叫處建立 deadline（從 user 設定讀，預設 5 分鐘）
- UI「停止」按鈕觸發 `controller.abort()`

### Step 4：Issue 15 之 MAGI deadlock detection + round timeout（1 天）
- 加 `ballotsAreIdentical()` 比對函式
- 加 `checkMajority()`（2/3 多數提早結束）
- 主迴圈：連續 2 輪 ballots 完全相同 → 標記 deadlock 結束
- 每輪 `Promise.race(allBallots, roundTimeout)` + 個別 unit timeout
- error unit 處理策略寫清楚（retry 次數、錯誤超門檻放棄）

### Step 5：Issue 10 之 user code timeout（半天）
- `runBuiltInScriptTool` 加 `Promise.race` + timeout（10s 預設）
- 接收 `signal?` 與外部取消串連
- 注意：同步 infinite loop 此時還是會卡 main thread，這只擋 async timeout
- 在 UI 警告：「Built-in tool 預設執行上限 10 秒，可在 tool 設定調整」

### Step 6：Issue 10 之 Web Worker 化（1-2 天，可獨立 PR）
- 新增 `src/utils/sandbox/builtInToolWorker.ts`（worker source via Blob URL）
- 主線程 ↔ worker 透過 postMessage 溝通
- helpers proxy：worker 內呼叫 `system.foo(...)` → postMessage 給主線程 → 主線程執行 → 回結果
- timeout 到了 `worker.terminate()`（同步 infinite loop 也能斷）
- 加白名單：明確列出 worker 內可用 / 不可用 globals
- UI 載入第三方 built-in tool 時跳警告 + code preview

## 驗收條件
- multi-turn skill 設 30 秒 deadline，跑超時應 throw 並寫入 trace
- 按 UI「停止」按鈕，正在進行的 model call 應在 1 秒內中斷
- MAGI mock 三個 deadlock unit，應在連續 2 輪相同後 early-exit（不跑滿 maxRounds）
- MAGI 一個 unit 故意 hang，整輪在 round timeout 內結束
- Built-in tool 寫 `while(true){}`，10 秒後 worker 被 terminate（Step 6 完成後）
- 既有 vitest 測試仍綠
- 新增 deadline / timeout / deadlock 對應 unit test

## 後續鋪墊
- Batch 5 拆 App.tsx 時，`useOneToOne` / `useSkillExecution` hook 內持有 `AbortController`，可直接呼叫此 batch 已備好的 deadline helper
- Issue 14 的 race condition 解法（execution lock）會直接用到 abort 機制（取消舊 instance）

## 不要做的事
- 不要在這個 batch 同時動「拆 App.tsx」（Batch 5 工作）
- 不要把 deadline 的預設值寫死在 helper 內，要從 settings 讀（讓使用者可調）
- Step 6（Web Worker）如果時間不夠可以延後到後續 batch，但 Step 5（async timeout）必做
- 不要為了取消而強行 reject 已 commit 的 trace（保留部分結果，標記為「中斷」）

## PR 拆分建議
- PR 1：deadline helper + unit test（Step 1）
- PR 2：multi-turn skill + orchestrator 接 deadline（Step 2-3）
- PR 3：MAGI deadlock + timeout（Step 4）
- PR 4：user code async timeout（Step 5）
- PR 5：user code Web Worker 化（Step 6，獨立 PR 因為改動較大）
