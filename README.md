# AgentGoRound

一個以穩定、簡單與高度客製化為目標的前端 agent harness，參考 Pi 的小核心與擴充方式，讓其他專案能加入自己的模型、工具與上下文。

目前 `master` 已有 M0-A 的最小可執行 browser harness，以及 M0-B 的 Herdr-inspired tab shell 與第一版跨 tab 訊息／關聯回覆。跨 tab 路由目前是同一頁面內、使用者明確觸發的操作；跨瀏覽器分頁與模型自動 delegation 不在範圍內。

- [設計與實作規劃](docs/plan.md)
- 完整舊版保存在 `v2` 分支，封存起點為 `73285d6`；舊版未完成的驗收紀錄亦保留在該分支。
- 更早版本保存在 `v1`、`v1.5` 分支。

第一個驗收版本以 Groq 的 OpenAI 相容 Chat Completions 接口完成基本多輪串流對話，提供 Herdr 風格的 tab 視窗、獨立 session、停止，以及明確觸發的跨 tab 訊息與回覆。先實際驗收對話視窗，再擴充工具、skills 與 session 恢復。

之後提供 JavaScript loader、彈出式聊天視窗；核心從早期即以公開 module/SDK 入口供獨立範例使用。

公開 SDK entry 位於 `src/index.ts`，除了 core runtime、storage、skills、router 與 bridge types，也安全 export `mount()`；非瀏覽器環境可以 import 這個 entry 而不會自動碰 DOM，呼叫 `mount()` 時才要求 browser document。

日常驗證以不消耗模型額度的回歸測試為主，Groq 作為第一個真實對話與工具驗收 provider。ChatGPT 訂閱整合延後，不阻擋基本對話、視窗與嵌入開發。

## 開發

需要 Node.js 22 或更新版本：

```sh
npm install
npm run dev
```

開啟 Vite 顯示的網址即可使用 scripted demo；在頁面輸入 Groq API key 可切換到 Groq。設定 drawer 使用 password field，`Remember this key in this browser` 預設開啟；取消勾選時 key 只存在目前頁面的 in-memory provider runtime，保持勾選才會保存到目前 origin 的 `localStorage`，並提供清除操作。key 不會寫入 bundle、session 或 embed bridge。不要把 API key 貼到聊天或 commit。

```sh
npm test
npm run typecheck
npm run build
npm run verify:dist
```

目前已固定使用 `@earendil-works/pi-agent-core` / `pi-ai` `0.84.4`。Groq 的真實額度驗收尚未在此環境執行，日常回歸使用 scripted model。

Groq live tool acceptance 是明確 opt-in：設定 `AGENT_GO_ROUND_GROQ_API_KEY` 後執行 `npm run test:groq`，會跑 read、mutation/read-back、tool-error correction 三個短任務，輸出 provider/model、工具呼叫與 `harness`／`provider`／`quota`／`network`／`model_decision` 失敗分類；可用 `AGENT_GO_ROUND_GROQ_REPORT` 另外保存 JSON report。一般 `npm test` 不會觸發網路或消耗額度。

核心也提供第一輪 typed tool boundary：`AgentSession` 可注入 Pi `AgentTool`，由 Pi 負責 TypeBox schema validation 與唯一 tool loop；宿主可用 `requiresApproval`、`approval` callback、`maxToolCalls`、`deadlineMs` 與 `maxOutputCharacters` 限制副作用與資源。若工具已送出但結果不明，請丟出 `ToolOutcomeUnknownError`；session 會記錄 `outcome_unknown`、停止自動 follow-up，交由宿主明確讀回或請使用者決定。`MemorySessionEventStore` 可保存 version 1 session events，事件不保存 tool arguments 或 result details。

Session transcript 可透過 `MemorySessionStore` 或注入的 `LocalStorageSessionStore` 保存與 restore；snapshot 只允許在 idle session 建立，避免把執行中的狀態假裝成可恢復完成。儲存格式有 version 與 `sessionId` 驗證，保存／讀取失敗會回報錯誤。

`MemorySessionEventStore` 與 `LocalStorageSessionEventStore` 保存 versioned run/tool lifecycle，`inspectSessionRecovery()` 只重建 interrupted／outcome-unknown metadata，不會在 reload 時自動重送模型或工具副作用；UI 會將需要人工 review 的 recovery notice 寫入對應 tab。

Workspace UI 會以 `LocalStorageWorkspaceStore` 保存 tab identity、active tab、draft、transcript 與 session snapshot；reload 後會恢復 tabs 與未送出的輸入，snapshot 不包含 provider API key。Groq workspace 只恢復安全的 UI/session metadata，重新載入後需由使用者重新連接 provider。`MemorySkillLoader`、`loadSkills()` 與 `composeSystemPrompt()` 提供按需載入、去重、大小限制與 deterministic system-prompt 組合，skills body 不會因 metadata listing 被提前暴露。

## Embed spike

production build 會另外產生 `embed.js`，可由宿主 HTML 以 script 載入。Loader 會建立一個隔離的 iframe popup，不會直接接管宿主頁面的 DOM 或 CSS：

```html
<script
  type="module"
  src="https://your-domain.example/agent-go-round/embed.js"
  data-target="body"
  data-mode="popup"
  data-button-label="Open AgentGoRound"
  defer
></script>
```

本專案部署到 GitHub Pages 時可直接使用：

```html
<script
  type="module"
  src="https://gipapa.github.io/agent-go-round/embed.js"
  data-target="body"
  data-mode="popup"
  data-button-label="Open AgentGoRound"
  defer
></script>
```

GitHub Pages 使用 project-site 子路徑 `/agent-go-round/`；loader 會依照 `embed.js` 所在位置找到 iframe app，因此宿主頁面不需要自行設定 app URL。若宿主網站有 CSP，需允許從 `https://gipapa.github.io` 載入 script 與 iframe。loader 不包含 Groq API key；目前真實 Groq 對話仍需使用者在 popup 輸入自己的 key，不能把擁有者 key 放進公開 bundle。

Loader 也會提供 `window.AgentGoRound.mount()`，widget instance 目前支援 `open()`、`close()`、`toggle()`、`postMessage()` 與 `destroy()`。iframe bridge 使用 `postMessage`，目前支援 `hello`、`ready`、`prompt`、`error`、`host_tools`、`host_tool_call`／`host_tool_result`／`host_tool_cancel`、`open-settings` 與 `close-settings`；provider 認證與跨 tab routing 尚未納入 embed API。

宿主可在 mount 後以 `widget.registerTool({ name, label, description, parameters, requiresApproval, timeoutMs }, handler, approval?)` 明確註冊 allow-listed tool。每次呼叫都帶有 instance、session、tool-call、request identity；parent bridge 會再次驗證 JSON schema，handler 可使用 `AbortSignal`。`requiresApproval` tool 必須先取得由宿主核發、綁定精確參數與 tool-call、60 秒後過期且只能使用一次的 approval token，直接繞過 approval 的 `host_tool_call` 會被拒絕。bridge 會處理 cancel、timeout 與 `outcome_unknown`，不會讓 iframe 直接讀取宿主 DOM、cookies 或 storage。因本版加入 tool-call identity 與 approval token，wire protocol 已 bump 為 v2、SDK 為 `0.2.0`，目前採明確 exact-match；不支援的版本會 fail closed。`public/embed-example.html` 內含一個 read-only host tool 範例。

本機可先執行 `npm run build && npm run verify:dist && npm run preview`，再開啟 `/embed-example.html` 測試第三方 host page；`public/embed-example.html` 是最小純 HTML 範例。GitHub Actions 會在部署前檢查 `index.html`、`embed.js` 與 host example artifact；push 到 `master` 後才會把工作樹內容發布到 GitHub Pages。部署後可開啟 [GitHub Pages embed example](https://gipapa.github.io/agent-go-round/embed-example.html)。

另一個框架 host 範例位於 `examples/react-host`：在該目錄執行 `npm install`，再以 `VITE_AGENT_APP_URL=http://127.0.0.1:4173/ npm run dev` 啟動；React `useEffect` 會 mount、註冊 host tool，unmount 時 destroy。此範例已通過獨立 typecheck/build 與跨 origin browser smoke。

push 到 `master` 會由 GitHub Actions 執行測試、build，成功後部署到 [GitHub Pages](https://gipapa.github.io/agent-go-round/)。

採用 [MIT License](LICENSE)。
