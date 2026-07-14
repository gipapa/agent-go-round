# Batch 6 — App.tsx 拆解 + Credential Vault 收尾 + 測試護欄（2-4 週）

## 包含工作項
- High-level integration test 補齊 + coverage gate
- **Issue 1** — `App.tsx` 8990 行拆解
- Credential Vault wiring + 主密碼 UI + migration

## 為何整合
這三個是 BATCH5 跑完後**唯一還沒收斂的結構性問題**。BATCH4 已經把 deadline / abort / lock / sandbox / storage envelope / credential vault **程式碼**全寫完了，但：

1. **vault 沒 wire 進 App** → `localStorage` 仍明文
2. **App.tsx 反而從 8800 漲到 8990 行**（lock / abort 都堆在裡面，issue 1）
3. **integration test 只有原本 4 條 chat 修綠，新情境沒補**

三者必須整合：
- 拆 App.tsx 必須先有 integration test 護欄
- 拆 `AgentContext` 時自然要把 vault 解鎖狀態收進去
- 拆完 hook 後 lock / abort ref 才能從 App.tsx 搬出來

## 工作量
2-4 週（最大的 batch，至少拆成 10+ PR）

## 風險
高 — 動到全工程最核心的 component；必須有測試保護。比 BATCH5（已完成的 abort / sandbox / storage 加固）風險更高，因為改動面更廣。

## 前置依賴（皆已完成）
- ✅ BATCH1 — ErrorBoundary + fetch signal
- ✅ BATCH2 — 型別安全 + Zod schemas
- ✅ BATCH3 — MCP 封裝（`clientManager` / `serverResolver` / `McpToolCatalog`）
- ✅ BATCH4 — deadline / abort / lock / sandbox
- ✅ BATCH5 — 已退役（其 scope 在 BATCH4 一併完成：testing infra、storage envelope、execution lock、credential vault 程式碼本體）

## 執行順序

### Phase 6.1 — 補 high-level integration test（3-5 天）
模式直接抄目前 `app.test.tsx` 已修綠的 4 個 chat 測試。
- skill 多輪執行 happy path
- load balancer failover（mock 第一個 instance fetch fail → 應切下一個）
- radio mode 啟動 → STT → 切換 → TTS（mock Web Speech API）
- tutorial 流程跑完一個 scenario

跑一次 `npm run test:coverage`，把 baseline 寫進 AGENT.md。

### Phase 6.2 — 拆 App.tsx（Issue 1，2-3 週）

**鐵則：每個 PR 只抽一個 context / hook**。順序由獨立到耦合：

1. **抽純 helper 函式**（1-2 天，PR 大但簡單）
   - 所有 normalize / extract / build* / format* → `src/app/helpers/`
2. **抽超大 inline UI 區塊**（2-3 天，每個 modal 一個 PR）
   - Credentials / MCP / Skills / Prompts / Built-in Tools / Mode Modal → `src/ui/*Modal.tsx`
3. **抽 Context + Reducer**（一個 domain 一個 PR）
   - `AgentContext`（agents / credentials / LB） — 同步做 Phase 6.3 的 vault wiring
   - `McpContext`
   - `SkillContext`
   - `TutorialContext`
   - `RadioContext`
4. **抽 custom hooks**
   - `useOneToOne` / `useSkillExecution`（吸收 `skillExecutionLocksRef`） / `useTutorial`（吸收 restore lock） / `useRadioSession` / `useLoadBalancerPlan`
5. **Orchestrator 真的搬到 `src/orchestrators/`**
   - `sendOneToOneTurn` → `src/orchestrators/oneToOne.ts` 純函式版
   - `executeMultiTurnSkill` → `src/orchestrators/skillExecution.ts`
   - hook 只串 state + 呼叫純函式

每抽完一塊 → Phase 6.1 的 integration test 必須全綠才能 merge。

### Phase 6.3 — Credential Vault Wiring（3-5 天，與 Phase 6.2.3 `AgentContext` 同步）
1. **Credentials Modal 加警示 banner**（半天獨立 PR）
2. **主密碼解鎖 / 設定 UI**
   - 啟動偵測 `agr_credential_vault_v1`
   - 有 → 解鎖 UI；沒有 → 「設定主密碼（可選）」
3. **AgentContext 持有解鎖後的明文 credentials**（記憶體）
4. **「鎖定」按鈕** + **「session-only」模式**
5. **Migration**：舊 `agr_model_credentials_v1` 明文 → 加密遷移 → 清舊 key

### Phase 6.4 — 收尾測試 coverage
- 為每個新拆 hook / context 補 unit test
- skill execution lock 並發測試
- vault unlock / 主密碼錯誤 / migration 測試
- CI 加 coverage gate（先 baseline，後 diff 要求 80%+）

## 驗收條件
- `App.tsx` 行數 < 500（理想 < 300）
- App.tsx 內 `useState` < 5 個（純 UI 局部狀態）
- 4 條 high-level integration test 全綠
- coverage 有 baseline 數字、新檔案 > 80%
- 啟用 vault 後 `localStorage` raw dump 找不到 raw API key
- 主密碼錯誤時 vault 拒絕解鎖且不破壞既有資料
- 舊明文 credentials 能一鍵遷移進 vault
- session-only 模式下重整瀏覽器 credentials 消失
- 同 skill 並發觸發兩次按既定政策處理（lock 已就位，行為要寫成 test）
- Tutorial restore 期間觸發 chat 被擋住

## 不要做的事
- 不要為了拆 App.tsx 引入 Redux / Zustand（先用 React 內建 context + reducer）
- Phase 6.2 純搬，不要順手改業務邏輯
- 不要跳過 Phase 6.1 的 integration test 直接拆 App.tsx
- vault 主密碼 UI 不要做太花俏
- 不要在這 batch 做 bundle / build 優化（scope creep）

## PR 拆分建議
至少 10-14 個 PR：
1. integration test：skill 多輪
2. integration test：LB failover
3. integration test：radio
4. integration test：tutorial scenario
5. coverage baseline 寫入文件
6. helper 函式搬移
7-12. modal 元件抽出（每個一個 PR）
13-17. context / hook 抽出（每個 domain 一個 PR）
   - 抽 `AgentContext` 那 PR 同時做 vault wiring + 主密碼 UI + migration
   - 抽 `useSkillExecution` 把 lock ref 搬進去
   - 抽 `useTutorial` 把 restore lock 搬進去
18. coverage gate 上線

每個 PR 都要可獨立 revert。
