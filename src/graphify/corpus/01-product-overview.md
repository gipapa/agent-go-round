# AgentGoRound Product Overview

AgentGoRound 是一個 browser-first、frontend-only 的 agent playground。

核心產品主張：

- 直接在瀏覽器中管理 agent、docs、MCP、built-in tools、skills 與 chat history。
- 主要使用情境是快速建立 workflow、驗證 use case、展示 agentic UI，而不是提供正式後端服務。
- 部署目標是 GitHub Pages，因此 UI、資料儲存、互動流程都偏向 local-first。

主要概念之間的關係：

- `Agent Workspace` 是主要操作中心。
- `Load Balancer` 與 `Credential Pool` 共同決定 agent 如何呼叫模型。
- `Docs Context`、`MCP Integration`、`Built-in Tools`、`Skills` 都是 agent 能力來源。
- `Tutorials` 把上述能力串成可重現的教學路徑。
- `MAGI` 是特殊的多 agent 協作模式。

相關檔案：

- `README.md`
- `src/app/App.tsx`
- `src/ui/LandingPage.tsx`
