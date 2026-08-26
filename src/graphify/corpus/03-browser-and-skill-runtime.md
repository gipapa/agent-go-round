# Browser Automation and Skill Harness

AgentGoRound 的 skill 不只是 prompt 片段，而是 workflow layer。

重點概念：

- `Skills` 提供高階任務封裝。
- `Pi loop harness` 把模型回覆、skill context、tool effect 與 final answer 放在同一份 canonical transcript。
- `Browser Workflow Skill` 透過 `skill.load` / `skill.read` progressive disclosure 取得 context。
- `MCP Integration` 讓 skill 能呼叫 browser tools。
- state-changing tool 後由 deterministic observation guard 阻止下一個 mutate/control，直到模型選擇 observe。

關鍵流程：

- model step
- preflight / confirmation / effect dispatch
- typed tool result append 回 transcript
- final assistant text 或 typed terminal stop reason

這個 harness 的目標是讓 browser automation、confirmation、blocked state、abort 與 outcome unknown 都能被 UI 明確呈現。

相關檔案：

- `agentic.md`
- `docs/skill-runtime-design.md`
- `src/runtime/harness/runAgentLoop.ts`
- `src/runtime/harness/contextProjector.ts`
- `src/runtime/harness/skillTools.ts`
- `src/runtime/toolEffectRunner.ts`
