# Issue 1 — `App.tsx` 巨型 God Component（8000+ 行）

## 嚴重度
Critical

## 觀察到的問題
`src/app/App.tsx` 單一檔案超過 **8000 行**，是整個專案最嚴重的結構性問題：

- 單一 React component 內宣告了 **30+ 個 `useState`**，同時管理：
  - agents、skills、docs、credentials
  - MCP servers、load balancers
  - radio session、tutorial 流程
  - logs、UI（modal、面板、表單）狀態
- 數百個 helper 函式直接定義在檔案頂層，與 component 混雜
- 多個超大 orchestrator 函式內嵌在 component 內：
  - `sendOneToOneTurn()`（~500 行）
  - `executeMultiTurnSkill()`（~1000 行）
  - `runOneToOneWithLoadBalancer()`（~300 行）
- 任何一個 state 變更都觸發整顆 App 重渲染
- 不同 domain（agent / MCP / skill / tutorial）的 state 透過 ref 與 useEffect 互相牽動，難以追蹤
- `src/orchestrators/` 資料夾已存在（leaderTeam、magi、oneToOne），但實際 orchestration 邏輯卻仍寫在 `App.tsx` 裡

## 來源檔案
- `src/app/App.tsx`（整檔）
- 對照已存在但未被充分使用的：`src/orchestrators/oneToOne.ts`、`src/orchestrators/magi.ts`、`src/orchestrators/leaderTeam.ts`

## 建議做法

### 短期（不動架構）
- 把 `App.tsx` 內所有 helper 純函式（normalize / extract / build* 系列）抽到 `src/app/helpers/` 或 `src/utils/`
- 把超大 inline UI 區塊（credentials modal、MCP modal、skills modal）拆成獨立 component 檔

### 中期（漸進重構）
- 將 state 拆分到多個 React Context + `useReducer`：
  - `AgentContext`（agents / credentials / load balancers）
  - `McpContext`（MCP servers / 工具 catalog）
  - `SkillContext`（skills / built-in tools）
  - `TutorialContext`
  - `RadioContext`
- 將業務邏輯抽成 custom hooks：
  - `useOneToOne()`
  - `useSkillExecution()`
  - `useTutorial()`
  - `useRadioSession()`
  - `useLoadBalancerPlan()`
- 把 orchestrator 函式真的搬進 `src/orchestrators/`，讓它們是純函式（接收 deps、回傳結果），由 hook 串接

### 長期
- 評估引入 Zustand 或 Jotai 取代散落的 useState（單一檔內 30+ useState 是明顯訊號）
- 為每個 context / hook 補上單元測試（目前 App.tsx 完全沒測）

## 影響
- 可維護性極差，任何修改都有跨領域副作用風險
- 效能：state 變動造成整顆 App 重渲染
- 測試：邏輯與 UI 緊耦合，無法寫單元測試
- 開發體驗：IDE / TypeScript 在 8000 行檔案的回應會變慢
