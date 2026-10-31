# AgentGoRound

一個以穩定、簡單與高度客製化為目標的前端 agent harness，參考 Pi 的小核心與擴充方式，讓其他專案能加入自己的模型、工具與上下文。

目前工作樹提供 IndexedDB 虛擬檔案系統、shell／文字編輯器／Pi 共用 tabs、可擴充的 `~/bin` JS 工具，以及從檔案載入 AGENTS.md 與 skills。Groq 對話可在 reload、重連或關閉重開後接續。跨 tab 路由為同頁面、使用者明確觸發的操作；不包含模型自動 delegation。

- [設計與實作規劃](docs/plan.md)
- 完整舊版保存在 `v2` 分支，封存起點為 `73285d6`；舊版未完成的驗收紀錄亦保留在該分支。
- 更早版本保存在 `v1`、`v1.5` 分支。

模型採 Groq 的 OpenAI 相容 Chat Completions 接口，Pi 擁有唯一工具循環。JS loader、iframe popup 與 VFS `main.html` 主頁預覽已實作；popup 可以修改同一個 workspace 的頁面檔案。

公開 SDK entry 位於 `src/index.ts`，除了 core runtime、storage、skills、router 與 bridge types，也安全 export `mount()`；非瀏覽器環境可以 import 這個 entry 而不會自動碰 DOM，呼叫 `mount()` 時才要求 browser document。

日常驗證以不消耗模型額度的回歸測試為主，Groq 作為第一個真實對話與工具驗收 provider。ChatGPT 訂閱整合延後，不阻擋基本對話、視窗與嵌入開發。

## 開發

新 tab 先進入 `~` 的 shell，可輸入 `help`、`ls ~/bin`、`write demo.md "hello"`、`read demo.md`；`pi` 進入 agent，`/exit` 返回 shell。預設提供 read、write、edit、grep、find、ls 和 skill_load，新增工具以 `.js` 與 `.tool.json` 放入 `~/bin` 後執行 `rehash`。完整參數、隔離執行與擴充方式見 [bin 工具說明](docs/bin-tools.md)。`preview ~/main.html` 開啟頁面預覽，缺少檔案時可明確建立範本；右下角 Pi 可讀寫相同 VFS。操作、page view 和 embed binding 見 [主頁預覽](docs/page-preview.md)。

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

目前固定使用 `@earendil-works/pi-agent-core` / `pi-ai` `0.84.4`。日常回歸使用 scripted model；檔案式 skill 的 Groq 三任務驗收已執行，完整狀態與重跑方式見 [笑話驗收](docs/joke-acceptance.md)。

快速體驗：在 shell 輸入 `demo jokes`，建立不覆寫既有檔案的中文 AGENTS.md、joke-master skill、評分參考與五個笑話。連接 Groq 後執行 `pi`，使用英文請它讀取、評分並選出最好笑的笑話。`edit PATH` 開啟文字編輯器；`history` 與 `pi --resume SESSION_ID` 可重開對話，`pi --new` 開始新對話。

Groq live tool acceptance 是明確 opt-in：設定 `AGENT_GO_ROUND_GROQ_API_KEY` 後執行 `npm run test:groq`，會跑 read、mutation/read-back、tool-error correction 三個短任務，輸出 provider/model、工具呼叫與 `harness`／`provider`／`quota`／`network`／`model_decision` 失敗分類；可用 `AGENT_GO_ROUND_GROQ_REPORT` 另外保存 JSON report。一般 `npm test` 不會觸發網路或消耗額度。

核心也提供第一輪 typed tool boundary：`AgentSession` 可注入 Pi `AgentTool`，由 Pi 負責 TypeBox schema validation 與唯一 tool loop；宿主可用 `requiresApproval`、`approval` callback、`maxToolCalls`、`deadlineMs` 與 `maxOutputCharacters` 限制副作用與資源。若工具已送出但結果不明，請丟出 `ToolOutcomeUnknownError`；session 會記錄 `outcome_unknown`、停止自動 follow-up，交由宿主明確讀回或請使用者決定。`MemorySessionEventStore` 可保存 version 1 session events，事件不保存 tool arguments 或 result details。

Session transcript 可透過 `MemorySessionStore` 或注入的 `LocalStorageSessionStore` 保存與 restore；snapshot 只允許在 idle session 建立，避免把執行中的狀態假裝成可恢復完成。儲存格式有 version 與 `sessionId` 驗證，保存／讀取失敗會回報錯誤。

`MemorySessionEventStore` 與 `LocalStorageSessionEventStore` 保存 versioned run/tool lifecycle，`inspectSessionRecovery()` 只重建 interrupted／outcome-unknown metadata，不會在 reload 時自動重送模型或工具副作用；UI 會將需要人工 review 的 recovery notice 寫入對應 tab。

Workspace UI 使用 `IndexedDbConversationStore` 保存 tabs、草稿、editor draft 與完整 session transcript，並將 session 歷史獨立於開啟的 tabs 保存。首次從既有 localStorage workspace 遷移，保留原資料。`IndexedDbSessionEventStore` 保存 lifecycle 與讀檔來源／版本，不保存逐字 text delta。Groq reload 後須重新連線，重連保留原 messages 和 active skill；不自動重送模型或工具。`prepareFileContext()` 從 home 到 cwd 載入 AGENTS.md／agents.md，`VfsSkillLoader` 只先提供 skill metadata，`~/bin/skill_load.js` 按需載入正文；active skill 在下一輪從檔案刷新。SDK 仍保留 memory／localStorage store 與最小 MemorySkillLoader 供獨立宿主使用。

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

localhost 的 host page 也可以直接使用 GitHub Pages 的 production loader。若要測 production 版本，請使用絕對 URL；`src="./embed.js"` 則會改載入 localhost 自己提供的 loader：

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

Loader 會從自身的 GitHub Pages URL 推導 iframe app URL；localhost host 需要能連網，且若有 CSP 需允許載入 `https://gipapa.github.io` 的 script 與 iframe。

Loader 也會提供 `window.AgentGoRound.mount()`，widget instance 目前支援 `open()`、`close()`、`toggle()`、`postMessage()` 與 `destroy()`。iframe bridge 使用 `postMessage`，目前支援 `hello`、`ready`、`prompt`、`error`、`host_tools`、`host_tool_call`／`host_tool_result`／`host_tool_cancel`、`open-settings` 與 `close-settings`；provider 認證與跨 tab routing 尚未納入 embed API。

宿主可在 mount 後以 `widget.registerTool({ name, label, description, parameters, requiresApproval, timeoutMs }, handler, approval?)` 明確註冊 allow-listed tool。每次呼叫都帶有 instance、session、tool-call、request identity；parent bridge 會再次驗證 JSON schema，handler 可使用 `AbortSignal`。`requiresApproval` tool 必須先取得由宿主核發、綁定精確參數與 tool-call、60 秒後過期且只能使用一次的 approval token，直接繞過 approval 的 `host_tool_call` 會被拒絕。bridge 會處理 cancel、timeout 與 `outcome_unknown`，不會讓 iframe 直接讀取宿主 DOM、cookies 或 storage。因本版加入 tool-call identity 與 approval token，wire protocol 已 bump 為 v2、SDK 為 `0.2.0`，目前採明確 exact-match；不支援的版本會 fail closed。`public/embed-example.html` 內含一個 read-only host tool 範例。

本機可先執行 `npm run build && npm run verify:dist && npm run preview`，再開啟 `/embed-example.html` 測試第三方 host page；`public/embed-example.html` 是最小純 HTML 範例。GitHub Actions 會在部署前檢查 `index.html`、`embed.js` 與 host example artifact；push 到 `master` 後才會把工作樹內容發布到 GitHub Pages。部署後可開啟 [GitHub Pages embed example](https://gipapa.github.io/agent-go-round/embed-example.html)。

另一個框架 host 範例位於 `examples/react-host`：在該目錄執行 `npm install`，再以 `VITE_AGENT_APP_URL=http://127.0.0.1:4173/ npm run dev` 啟動；React `useEffect` 會 mount、註冊 host tool，unmount 時 destroy。此範例已通過獨立 typecheck/build 與跨 origin browser smoke。

push 到 `master` 會由 GitHub Actions 執行測試、build，成功後部署到 [GitHub Pages](https://gipapa.github.io/agent-go-round/)。

採用 [MIT License](LICENSE)。
