# Visualization and Rendering Extensions

除了 chat 與 skill runtime，AgentGoRound 也把前端視為一個可操作的展示空間。

重要概念：

- `Built-in Tools` 允許直接執行瀏覽器端 JavaScript。
- `Render Anything Pattern` 代表一種由模型生成前端畫面的方式。
- `Dashboard Helper` 用來統一管理浮動面板與即時 UI。
- `Graphify Concept Graph` 則是把整個專案的產品概念整理成可互動圖譜。

這條能力線的用途：

- 把 agent output 轉成可觀察的 UI。
- 把系統的架構與概念變成可導覽的地圖。
- 補足純文字 README 不容易一眼看出來的連結。

相關檔案：

- `render_anything.md`
- `src/utils/runBuiltInScriptTool.ts`
- `src/utils/toolDashboard.ts`
- `src/graphify/`
