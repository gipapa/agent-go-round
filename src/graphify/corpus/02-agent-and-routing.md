# Agent and Routing Concepts

AgentGoRound 的 agent 並不是直接綁死 provider，而是綁到 `Load Balancer`。

設計重點：

- `Credential Pool` 用來維護 provider endpoint 與多把 key。
- `Load Balancer` 由多個 ordered instances 組成。
- `Agent Workspace` 透過 load balancer 選擇模型與 key。
- instance 失敗時會記錄 failure、cooldown 與 resume time。
- 這個設計讓同一個 agent 可以在多個模型、金鑰與實例之間切換。

與其他能力的連結：

- `MCP Integration` 與 `Skills` 最終都還是透過 agent 的模型能力決策。
- `Tutorials` 會教使用者建立 credential、load balancer 與 agent。
- `MAGI` 模式要求三個固定命名 agent 預先存在。

相關檔案：

- `src/utils/loadBalancer.ts`
- `src/storage/settingsStore.ts`
- `src/ui/LoadBalancersPanel.tsx`
- `src/ui/AgentsPanel.tsx`
