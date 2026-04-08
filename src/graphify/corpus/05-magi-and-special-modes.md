# MAGI and Special Interaction Modes

MAGI 是 AgentGoRound 取代 deprecated goal-driven mode 的特殊協作模式。

主要概念：

- `MAGI Mode` 不是一般 one-to-one chat。
- 它依賴三個固定命名的 agent：`Melchior`、`Balthasar`、`Casper`。
- `Magi Vote` 是基本版：三賢人同時表決。
- `Magi Consensus` 是進階版：三賢人反覆溝通直到收斂或 deadlock。
- `Magi Skills` 是內建且受控的專屬 skill bundle。

設計邊界：

- MAGI 模式會忽略全域 docs、MCP、built-in tools 與其他 user skills。
- 這樣做是為了避免三個 agent 的角色漂移，並讓 deliberation template 可控。

相關檔案：

- `src/orchestrators/magi.ts`
- `src/magi/magiSkills.ts`
- `src/ui/ChatPanel.tsx`
- `src/app/styles.css`
