# Batch 4 — 大型重構：App.tsx 拆解 + Storage 加固 + 測試補強（2-4 週）

## 包含 Issues
- **Issue 9** — 測試覆蓋率嚴重不足
- **Issue 1** — `App.tsx` 8000+ 行 god component
- **Issue 7** — Credentials / API Keys 明文存 localStorage
- **Issue 12** — Storage 無 quota 處理 + 載入時 silent 吞錯
- **Issue 14（剩餘）** — Skill / LB 執行的 race condition + tutorial restore lock

（Issue 14 的 MCP cache stampede 部分已在 Batch 3 處理。）

## 為何整合
五個 issue **互為前置 / 互相支撐**，分開做會白工：

1. **Issue 9 是 Issue 1 的前置條件**
   拆 8000 行檔案沒有 integration test 護航是自殺。先補 high-level 行為測試（「給定 X 輸入，最終 chat 應該包含 Y」），再開始拆。

2. **Issue 7 + Issue 12 + Issue 1 共用 storage 層改動**
   - Issue 7：credentials 加密
   - Issue 12：quota 處理 + Zod 驗證 + schema versioning
   - Issue 1：拆 `AgentContext` / `CredentialsContext` 時 storage 介面會被重整
   三者都動 `src/storage/*.ts` 與 App.tsx 內 storage 呼叫點，**一次解決最划算**。Issue 12 的 Zod schema 直接重用 Batch 2 已建立的 schema 定義。

3. **拆 App.tsx 時順手把 `useReducer` 跟新 storage 串好**
   分兩次做要 grep 兩次同樣的程式碼。

4. **Issue 14（skill race）必須在 App.tsx 拆完後才好做**
   execution lock / queue 需要乾淨的 hook 邊界（`useSkillExecution` 內持有 `Map<skillId, AbortController>`）。在 8000 行 god component 內加 lock 會很醜且易錯。

## 工作量
2-4 週（這是最大的 batch，可拆成多個小 PR）

## 風險
高 — 動到全工程最核心的 component 與 storage schema；必須有測試保護

## 前置依賴
- **Batch 1 已完成**：Error Boundary 在 refactor 過程中救命；fetch 已支援 signal
- **Batch 2 必須先完成**：拆 App.tsx 時靠 Zod schema 與型別安全當地圖；ESLint 守門避免 refactor 引入新 `any`
- **Batch 3 強烈建議先完成**：MCP 邏輯已封裝乾淨，可直接搬進 `useMcp()` hook，否則拆 App.tsx 時還要邊改 MCP 邊改 context
- **Batch 4.5 強烈建議先完成**：deadline / abort helper 與 user code timeout 已就緒，拆出 hook 時可直接整合

## 執行順序建議

### Phase 4.1：補齊測試基礎建設（Issue 9 第一步，3-5 天）
- 裝 testing libs：
  ```bash
  npm i -D @testing-library/react @testing-library/user-event @testing-library/jest-dom @vitest/coverage-v8 happy-dom
  ```
- 改 `vitest.config.ts`：環境、setup、coverage reporter
- 加 `npm scripts`：`test:watch` / `test:coverage` / `test:ui`
- 建 `src/__tests__/setup.ts`（jest-dom matchers）
- **補 high-level integration test**（重點）：
  - 一對一 chat happy path
  - skill 多輪執行
  - load balancer failover
  - radio mode 啟動 → STT → 切換 → TTS
  - tutorial 流程跑完一個 scenario
  這些 test 在 Phase 4.2 拆 App.tsx 時是「不准退步」的契約

### Phase 4.2：拆 App.tsx（Issue 1，2-3 週）
**重要原則**：每個 PR 只抽一個 context / hook，不要一次大爆炸。

依下列順序抽，從最獨立到最耦合：

1. **抽純 helper 函式**（最低風險，1-2 天）
   - 把 `App.tsx` 內所有 normalize / extract / build* / format* 純函式搬到 `src/app/helpers/` 或對應 `src/utils/`
   - 不動 component，純粹搬位置
   - PR 應該很大但很簡單

2. **抽超大 inline UI 區塊**（2-3 天）
   - Credentials Modal → `src/ui/CredentialsModal.tsx`
   - MCP Modal → `src/ui/McpModal.tsx`
   - Skills Modal → `src/ui/SkillsModal.tsx`
   - Prompts Modal → `src/ui/PromptsModal.tsx`
   - Tools Modal → `src/ui/BuiltInToolsModal.tsx`
   - Mode Modal → `src/ui/ModeModal.tsx`
   - 透過 prop 傳遞需要的狀態與 callback（暫不引入 context）

3. **抽 Context + Reducer**（依 domain 一個一個來）
   - `src/contexts/AgentContext.tsx`（agents / credentials / load balancers）
   - `src/contexts/McpContext.tsx`（吃 Batch 3 的 `clientManager` 與 `serverResolver`）
   - `src/contexts/SkillContext.tsx`（skills / built-in tools）
   - `src/contexts/TutorialContext.tsx`
   - `src/contexts/RadioContext.tsx`
   - 每抽一個 context，整顆 App 應該還能跑（用 Phase 4.1 的 integration test 護航）

4. **抽 custom hooks**（封裝業務邏輯）
   - `src/hooks/useOneToOne.ts` — 從 `sendOneToOneTurn`、`runOneToOneWithLoadBalancer` 抽
   - `src/hooks/useSkillExecution.ts` — 從 `executeMultiTurnSkill` 抽
   - `src/hooks/useTutorial.ts` — 整合 15+ tutorial ref
   - `src/hooks/useRadioSession.ts` — 整合 4 個 radio ref
   - `src/hooks/useLoadBalancerPlan.ts` — 從 `resolveLoadBalancerPlanForAgent` 抽，順便加 useMemo

5. **把 orchestrator 真的搬進 `src/orchestrators/`**
   - `sendOneToOneTurn` → 純函式版本搬到 `src/orchestrators/oneToOne.ts`
   - `executeMultiTurnSkill` → `src/orchestrators/skillExecution.ts`
   - hook 只負責串 React state + 呼叫純函式

### Phase 4.3：Storage 加固（Issue 7 + Issue 12，3-5 天，與 Phase 4.2.3 的 AgentContext 同步做）

#### 4.3.A — Issue 12（quota + 驗證 + versioning）先做（基礎設施）
1. 新增 `src/storage/safeStorage.ts`：`safeSetItem(key, value)` 包 try/catch，回傳結構化結果（`ok | reason: "quota" | "denied" | "other"`）
2. 所有 store 改用 `safeSetItem`；爆 quota 時 toast 提示，不沉默成功
3. 載入時用 Zod schema 驗證（重用 Batch 2 的 schema），失敗時：
   - 把原始 raw 字串備份到 `__backup_${key}_${ts}_${reason}` key
   - log 警告
   - 回傳 default，**不直接洗掉**
4. 加 schema versioning：payload 結構為 `{ __version: number, data: T }`，加 `migrate()` pipeline
5. IndexedDB 錯誤包裝：`reject(new Error(...))` 而不是 `reject(req.error)`（可能是 null）

#### 4.3.B — Issue 7（credentials 加密）
1. **短期防護**（先做，無痛）
   - Credentials Modal 加警示 banner
   - Credentials 從 settings 物件分離到單獨 `localStorage` key（XSS 取走 settings 不會帶到 key）
   - `runBuiltInScriptTool` helpers 移除任何讀取 credential 的 API
2. **中期方案**（重頭戲）
   - 新增 `src/storage/credentialVault.ts`，用 Web Crypto AES-GCM
   - 主密碼 PBKDF2 派生
   - 第一次啟動跳「設定主密碼」流程（可選）
   - 提供「session-only 模式」（記憶體保存，不寫 storage）
   - migration：偵測到舊版明文 credentials → 提示使用者設定密碼後加密遷移

### Phase 4.4：Skill execution lock + tutorial restore lock（Issue 14 剩餘）
在 Phase 4.2.4 抽 `useSkillExecution()` 時順手做：

1. **Skill instance lock**
   - hook 內持有 `executionLockRef = useRef<Map<string, AbortController>>(new Map())`
   - 啟動 skill 前檢查同一 skillId 是否已在跑：拒絕 / 排隊 / 取消舊的（政策由 UI 決定）
   - 完成或取消時清掉 entry

2. **Trace per-execution**
   - 把 `skillTraceRef` 改成由 caller 傳入的 local 物件
   - 每次 skill 執行自己持有 trace，最後一次性 commit 到 React state
   - 中途取消（Batch 4.5 的 deadline）只會丟掉那個 local trace，不污染其他執行流

3. **Tutorial restore lock**
   - `useTutorial()` 暴露 `isRestoring` 狀態
   - chat / skill 啟動前檢查此 flag，restore 中拒絕並提示「Tutorial 正在恢復」
   - UI 「Send」按鈕 / skill 觸發按鈕在 restore 中 disabled

### Phase 4.5：補完測試 coverage（Issue 9 收尾）
- 為新抽出的每個 hook / context 補 unit test
- 為 storage（quota / 載入失敗 / migration）補 round-trip test
- 為 credential vault（加密 / 解密 / 主密碼錯誤）補 test
- 為 skill execution lock 補 test（同 skill 並發觸發）
- 加 CI coverage gate（漸進式：先建 baseline，再對 diff 要求 80%+）

## 驗收條件
- `App.tsx` 行數 < 500（理想 < 300）
- `src/app/App.tsx` 內無 `useState`（全進 context）或 < 5 個（純 UI 局部狀態）
- 所有 Phase 4.1 補的 integration test 全綠
- coverage report 整體 > 50%，新檔案 > 80%
- credentials 不再以明文形式出現在 `localStorage` raw dump（除非使用者選 session-only 並輸入過）
- storage 在版本不對時能 migrate 或 fallback，不再炸掉啟動
- 模擬 quota exceeded，UI 應顯示警告而非沉默
- 同一 skill 並發觸發兩次，第二次按既定政策被處理（不會兩個 trace 互相污染）
- Tutorial restore 期間觸發 chat 應被擋住

## 不要做的事
- 不要為了拆 App.tsx 而引入 Redux / Zustand（先用 React 內建 context + reducer 試）
- 不要在 Phase 4.2 同時改業務邏輯（純搬，行為不變）
- 不要跳過 Phase 4.1 的 integration test 直接拆 App.tsx
- credentials 加密 UI 不要做太花俏（一個密碼欄、一個解鎖按鈕就好）
- 不要在這個 batch 內順手做 Bundle / Build 優化（scope creep）

## PR 拆分建議
這個 batch 至少拆成 10-14 個 PR：
1. testing infra + integration test baseline
2. **storage safeSetItem + Zod 驗證 + versioning + IDB 錯誤包裝（Issue 12）** ← 先做，當作後續 storage 動作的基礎
3. helper 函式搬移
4-8. modal 元件抽出（每個一個 PR）
9-13. context + hook 抽出（每個 domain 一個 PR）
   - 抽 `useSkillExecution` 時順手加 execution lock（Issue 14 剩餘）
   - 抽 `useTutorial` 時順手加 restore lock（Issue 14 剩餘）
14. credentials 加密 + 主密碼流程（Issue 7）

每個 PR 都應該獨立可 revert，不影響其他功能。
