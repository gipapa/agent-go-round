# Issue 1 — `App.tsx` 巨型 God Component（8990 行）

## 嚴重度
Critical（仍未處理）

## 現況（2026-04 更新）
歷經 BATCH1-4 的可靠性 / 型別 / MCP / abort 工作後，**App.tsx 不但沒縮，反而從 8800 漲到 ~8990 行**，`useState` 從 30+ 漲到 ~58 個。BATCH4 雖然把 abort / lock / sandbox 等基礎建好，但所有新 ref（`activeChatAbortRef`、`skillExecutionLocksRef`…）都還是堆在這顆 component 裡。

> 現存 ref / state 範例（`src/app/App.tsx`）：
> - `activeChatAbortRef`、`skillExecutionLocksRef`（BATCH4 新增的 lock / abort）
> - 30+ 個 `useState` 涵蓋 agents / skills / docs / credentials / MCP / load balancers / radio / tutorial / logs / 各種 modal 開關
> - `sendOneToOneTurn()` / `executeMultiTurnSkill()` / `runOneToOneWithLoadBalancer()` 仍然 inline

`src/orchestrators/` 雖然存在 `oneToOne.ts` / `magi.ts` / `leaderTeam.ts`，但 App.tsx 內仍有自己的 wrapper 版本與 React state 牽動。

## 為什麼一直拖到現在
1. 沒有 high-level integration test 護航 → 拆風險過高（見 issue 9）
2. 拆要動到的 context 邊界（MCP / credential vault）部分還沒收斂（見 issue 7）
3. BATCH4 的 deadline / abort helper 是拆 hook 的前置，這部分已就緒，現在沒理由再延

## 建議做法（依風險排序，每步一個 PR）

### Phase A — 純搬移（零行為改變）
1. **抽純 helper 函式**：所有 normalize / extract / build* / format* 純函式 → `src/app/helpers/` 或 `src/utils/`
2. **抽超大 inline UI 區塊**：Credentials Modal、MCP Modal、Skills Modal、Prompts Modal、Built-in Tools Modal、Mode Modal → `src/ui/*Modal.tsx`，透過 prop 傳資料

### Phase B — Context + Reducer（依 domain）
- `AgentContext`（agents / credentials / load balancers）— 同時把 vault wiring 收進來（見 issue 7）
- `McpContext`（吃既有 `clientManager` / `serverResolver` / `McpToolCatalog`）
- `SkillContext`（skills / built-in tools）
- `TutorialContext`（吸收 15+ tutorial ref）
- `RadioContext`（吸收 4 個 radio ref）

### Phase C — Custom hooks（封裝業務邏輯）
- `useOneToOne()`、`useSkillExecution()`、`useTutorial()`、`useRadioSession()`、`useLoadBalancerPlan()`
- `useSkillExecution` 內把現存的 `skillExecutionLocksRef` 收進來，順便把 `skillTraceRef` 改 per-execution local
- 各 hook 直接用 BATCH4 的 `createDeadline` / `combineSignals`

### Phase D — Orchestrator 真的搬到 `src/orchestrators/`
- `sendOneToOneTurn`、`executeMultiTurnSkill` 變純函式（接收 deps 物件）
- React 端只負責串 state / 呼叫純函式

## 驗收條件
- `App.tsx` 行數 < 500（理想 < 300）
- App.tsx 內 `useState` < 5 個（純 UI 局部狀態）
- BATCH6 補的 high-level integration test 全綠（不准退步）
- 並發跑兩個 skill 不再共享 ref（issue 14 的 race 場景，BATCH4 已經部分擋住）

## 影響
- 維護成本最大宗；目前 IDE / TypeScript 在這檔回應已明顯變慢
- 任何新 feature（vault UI、新 orchestration mode）都被迫塞進這顆 component

## 關聯
- **前置已備齊**：BATCH1（ErrorBoundary）、BATCH2（型別 + Zod）、BATCH3（MCP 封裝）、BATCH4（deadline / abort / lock / sandbox）
- **平行依賴**：issue 7（vault wire）、issue 9（integration test 護欄）
- 屬於 [BATCH6](BATCH6.md)
