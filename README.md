# AgentGoRound

一個以穩定、簡單與高度客製化為目標的前端 agent harness，參考 Pi 的小核心與擴充方式，讓其他專案能加入自己的模型、工具與上下文。

目前 `master` 已有 M0-A 的最小可執行 browser harness，以及 M0-B 的 Herdr-inspired tab shell 第一版；跨 tab 訊息與回覆尚未完成。

- [設計與實作規劃](docs/plan.md)
- 完整舊版保存在 `v2` 分支，封存起點為 `73285d6`；舊版未完成的驗收紀錄亦保留在該分支。
- 更早版本保存在 `v1`、`v1.5` 分支。

第一個驗收版本以 Groq 的 OpenAI 相容 Chat Completions 接口完成基本多輪串流對話，提供 Herdr 風格的 tab 視窗、獨立 session、停止，以及明確觸發的跨 tab 訊息與回覆。先實際驗收對話視窗，再擴充工具、skills 與 session 恢復。

之後提供 JavaScript loader、彈出式聊天視窗；核心從早期即以公開 module/SDK 入口供獨立範例使用。

日常驗證以不消耗模型額度的回歸測試為主，Groq 作為第一個真實對話與工具驗收 provider。ChatGPT 訂閱整合延後，不阻擋基本對話、視窗與嵌入開發。

## 開發

需要 Node.js 22 或更新版本：

```sh
npm install
npm run dev
```

開啟 Vite 顯示的網址即可使用 scripted demo；在頁面輸入 Groq API key 可切換到 Groq。API key 只保存在當次頁面記憶體，不會寫入 bundle 或 session。

```sh
npm test
npm run typecheck
npm run build
```

目前已固定使用 `@earendil-works/pi-agent-core` / `pi-ai` `0.84.4`。Groq 的真實額度驗收尚未在此環境執行，日常回歸使用 scripted model。

push 到 `master` 會由 GitHub Actions 執行測試、build，成功後部署到 [GitHub Pages](https://gipapa.github.io/agent-go-round/)。

採用 [MIT License](LICENSE)。
