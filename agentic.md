# Agentic Multi-turn Skill Runtime

這份文件專門記錄 `AgentGoRound` 目前的多輪 skill runtime。`README.md` 只保留入口與使用方式；比較細的 phase、todo、manual gate 與測試策略都集中在這裡。

## 目標

多輪 skill 的目標不是把單輪 prompt 越疊越厚，而是把需要連續動作的任務改成可觀測的 workflow engine。這一版特別針對：

- browser automation
- 需要 `observe -> act -> observe`
- 需要人工確認後再繼續
- 需要在 UI 中直接看進度與阻塞點

`single_turn` 維持原狀；`multi_turn` 走獨立 runtime。

## Runtime 結構

主要模組：

- `src/runtime/multiTurnSkillRuntime.ts`
- `src/runtime/skillPlanner.ts`
- `src/runtime/skillState.ts`
- `src/runtime/skillTodo.ts`
- `src/runtime/skillTrace.ts`
- `src/runtime/browserObservation.ts`

現有的 `skillRuntime.ts` 仍然負責：

- skill snapshot
- skill load
- references / assets resolve

`App.tsx` 不再直接塞滿 multi-turn 補丁邏輯，主要只負責：

- 啟動 runtime
- 顯示 assistant 狀態
- 呈現 todo 與 trace

## Phase

多輪 skill 固定走這些 phase：

1. `skill_load`
2. `bootstrap_plan`
3. `observe`
4. `plan_next_step`
5. `act`
6. `sync_state`
7. `completion_gate`
8. `final_answer`
9. `verify_refine`（可選）

這樣做的原因是把「現在該觀察、該操作、還是該停下來問人」變成顯式狀態，而不是全部交給模型在一段長 prompt 裡自己猜。

## Runtime State

`SkillRunState` 目前至少追蹤：

- `skillId`
- `goal`
- `phase`
- `stepIndex`
- `todo`
- `recentObservationSignatures`
- `recentActionSignatures`
- `manualGate`
- `completionStatus`
- `latestReason`

`manualGate` 目前分成：

- `none`
- `awaiting_user_confirmation`
- `awaiting_manual_browser_step`
- `resumable`

這讓 `request_user_confirmation` 不再只是回一個 `{ confirmed: true }` 就交給模型自行理解，而是能明確恢復 runtime。

## Todo 模型

多輪 skill 會先產生 3 到 7 項 todo，並掛在 assistant message 上。

`SkillTodoItem` 目前包含：

- `id`
- `label`
- `status`
  - `pending`
  - `in_progress`
  - `completed`
  - `blocked`
- `source`
  - `skill`
  - `planner`
  - `system`
- `reason`
- `updatedAt`

Todo 是唯讀的。v1 不做 thread 級 task manager，也不讓使用者手動修改。

## Planner 與 Completion Gate

多輪 runtime 不再直接重用一般聊天的 `runToolDecision()`。

planner 只允許四種下一步：

- `observe`
- `act`
- `ask_user`
- `finish`

其中 `act` 必須明確指定：

- `toolKind`
- `toolName`
- `input`
- `reason`
- `todoIds`

`finish` 不會直接當真；runtime 仍會再跑一次 `completion_gate`。

`completion_gate` 的責任是避免這些假完成：

- 只打開網站
- 只做 snapshot
- 只把文字填進輸入框
- 只知道目前 blocked，但還沒整理成最後回覆

## Observe / Act 規則

runtime 目前有幾個固定規則：

- 狀態改變後，下一步必須先 `observe`
- 連續 observation 沒有變化，下一步不能再一直 observe
- `ask_user` 完成後，流程必須回到 `resumable`
- 若 observation 已明確顯示 blocked/manual 狀態，runtime 可以直接走 deterministic summary

這些規則的目的是防止：

- 無限 `browser_open`
- 無限 `browser_snapshot`
- 按完確認後就卡住

## UI

multi-turn skill 命中時，assistant 訊息下方會直接出現 todo 面板：

- 目標
- 目前 phase
- 目前進行中
- blocked 原因
- 完整 todo 狀態

`查看 skill 流程紀錄` 則偏向 debug：

- `Skill load`
- `Bootstrap plan`
- `Planner step N`
- `Observation N`
- `Action N`
- `Manual gate`
- `Completion gate`
- `Verify/refine`

Todo 與 trace 是分開的：

- todo 給人快速看進度
- trace 給人 debug 與貼 log

completion gate 通過後，runtime 會把剩餘未完成的 todo 自動收斂成 `completed`，避免 UI 停在 `in_progress`。

## Case 6: GitHub Trending

目前主要 acceptance case 是：

- `[6] 使用多輪 Skill 操作 GitHub Trending`

這個案例做幾件事：

- 建立專用 multi-turn browser skill
- 使用案例 5 已註冊的 `agent-browser` MCP
- 預設用 headless 流程；若使用者明確要求視窗模式，就直接用 headed
- 直接打開 `https://github.com/trending`
- 點進第一名 repo
- 讀取 repo README / 描述區並整理內容摘要
- 若遇到 blocked/manual 狀態，改走 manual gate
- 接受兩條成功路徑：
  - 實際完成 GitHub Trending -> 第一名 repo -> 摘要
  - 正確辨識 blocked/manual 並整理成最終回覆

目前 targeted real tutorial 驗證可用：

```bash
REAL_TUTORIAL_ONLY=chatgpt-browser-skill npm run test:real_tutorial
```

## 真實測試

真實測試一律讀：

- `.tutorial-test.local.json`

目前重點是：

- `npm run test:tutorial`
- `npm run test:real_tutorial`

`test:real_tutorial` 會：

- 自動啟動 dev
- 自動啟動 `mcp-test/run.sh -agent_browser`
- 用真實瀏覽器跑 onboarding 案例
- 測完後清掉本網站資料

由於目前 provider 是 Groq free tier，完整 real tutorial 仍可能受 TPM / TPD 限制。這不是 runtime 架構本身的邏輯失敗，而是外部配額限制。

## 目前限制

這版仍然是 v1：

- 不做 subagents / supervisor-worker
- 不做完整 ask/allow/deny policy graph
- 不做 thread 級任務管理
- 不執行 `scripts/`

但這版已經把多輪 skill 從「prompt 補丁」提升成：

- 顯式 phase
- 正式 todo state
- manual gate
- completion gate
- 可在 UI 與 real tutorial 裡驗證的 runtime
