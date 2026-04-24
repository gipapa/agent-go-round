# Issue 9 — 測試覆蓋率（infra 已備、high-level integration 仍缺）

## 嚴重度
Medium（會放大 issue 1 的 refactor 風險）

## 現況（2026-04 更新）

### 已完成（BATCH4）
- ✅ Testing infra：`@testing-library/react`、`@testing-library/user-event`、`@testing-library/jest-dom`、`@vitest/coverage-v8`、`happy-dom` 全裝
- ✅ `vitest.config.ts` 設好 environment / setupFiles
- ✅ `src/__tests__/setup.ts` 載 jest-dom matchers
- ✅ npm scripts：`test:watch` / `test:coverage` 補齊
- ✅ 修好 `app.test.tsx` 既有 4 個 chat 測試（LB / credential fixture + Chat Config card-grid 導覽）
- ✅ 新增單元測試：`deadline.test.ts`、`safeStorage.test.ts`、`credentialVault.test.ts`、`runBuiltInScriptTool.test.ts`
- ✅ 整體測試現況：17 files / 76 tests，全綠

### **仍未完成**
- ❌ **High-level integration test 缺 4 條**（BATCH4 只把現有 4 個 chat test 修綠，沒加新情境）：
  - skill 多輪執行 happy path
  - load balancer failover
  - radio mode 啟動 → STT → 切換 → TTS
  - tutorial 流程跑完一個 scenario
- ❌ 沒 coverage gate，沒跑過 baseline coverage report
- ❌ App.tsx 內邏輯仍幾乎無單元測試（拆完 hook 後再補，見 issue 1）

## 待辦

### Step 1 — 補 4 條 high-level integration test
作為 issue 1 拆 App.tsx 的「不准退步」契約。模式參考已修綠的 chat test（mock fetch + seed `agr_load_balancers_v1` + `agr_model_credentials_v1`）。

每條 test 應做到：
- 真的 render `<App />`（不 mock）
- 用 `userEvent` 走完關鍵 UI 路徑
- 斷言最終可見訊息 / state，而非中間實作細節

### Step 2 — Baseline coverage
- 跑一次 `npm run test:coverage` 把 baseline 數字記下來（README 或 AGENT.md）
- CI 加 job 跑 coverage（先不擋）

### Step 3 — Coverage gate（漸進）
- 第一階段：對 `src/utils/`、`src/storage/`、`src/orchestrators/` 設目標 80%+
- 第二階段：對 PR diff 要求 80%+（用 lcov diff 工具）

### Step 4 — 為新拆出的 hook / context 補 unit test（issue 1 同步）
- `useSkillExecution` 並發觸發行為（execution lock）
- `useTutorial` restore lock
- 各 reducer pure function

## 驗收條件
- 4 條 integration test 全部加好且綠
- coverage report 有 baseline 數字
- 新檔案（`src/storage/safeStorage.ts`、`credentialVault.ts`、`utils/deadline.ts` 等）覆蓋率 > 80%（這幾個現在已有 unit test，正式量化即可）

## 關聯
- 屬於 [BATCH6](BATCH6.md)
- 是 [issue 1](issue1.md) 拆 App.tsx 的硬前置
