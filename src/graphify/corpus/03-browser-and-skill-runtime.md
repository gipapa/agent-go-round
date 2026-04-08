# Browser Automation and Skill Runtime

AgentGoRound 的 skill 不只是 prompt 片段，而是 workflow layer。

重點概念：

- `Skills` 提供高階任務封裝。
- `Multi-turn Skill Runtime` 把複數步驟任務拆成 phase、todo 與 trace。
- `Browser Workflow Skill` 是目前最具代表性的多輪 skill。
- `MCP Integration` 讓 skill 能呼叫 browser tools。
- `Browser Observation` 用來把 snapshot、click 結果與 blocked 狀態整理成可規劃的觀察結果。

關鍵流程：

- 先 `observe`
- 再 `act`
- 再 `sync state`
- 最後 `completion gate`

這個 runtime 的目標是讓 browser automation、manual gate、blocked state 與 verify/refine 都能被 UI 明確呈現。

相關檔案：

- `agentic.md`
- `docs/skill-runtime-design.md`
- `src/runtime/multiTurnSkillRuntime.ts`
- `src/runtime/browserObservation.ts`
- `src/runtime/skillPlanner.ts`
- `src/runtime/skillState.ts`
