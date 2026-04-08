# Tutorials and Learning Surface

Tutorial 系統是 AgentGoRound 的教學與驗證入口。

主要概念：

- `Landing Page` 提供「開始使用」與「使用案例教學」。
- `Tutorials` 以 YAML 與 runtime step evaluation 組成。
- `Tutorial Runtime` 會比對目前 workspace 狀態，判斷步驟是否完成。
- 案例 5 聚焦 `MCP Integration`。
- 案例 6 聚焦 `Browser Workflow Skill` 與 GitHub Trending 的多輪操作。

Tutorial 的角色：

- 不是單純說明文件，而是把 product capability 變成可操作、可驗證的 journey。
- 幫助使用者理解 agent、MCP、skills、built-in tools、load balancer 之間如何組合。

相關檔案：

- `src/onboarding/runtime.ts`
- `src/onboarding/catalog.ts`
- `src/onboarding/tutorials/`
- `src/ui/TutorialGuide.tsx`
- `src/ui/LandingPage.tsx`
