# AgentGoRound

以 Pi 為核心的純前端 agent 編輯器：在瀏覽器中管理檔案、接續對話，讓 agent 讀取工作區規則與 skills，並透過 popup 修改與預覽自己的主頁。

Pi 擁有唯一的模型／工具循環，使用 Groq 的 OpenAI 相容 Chat Completions 接口。檔案與對話保存於瀏覽器 IndexedDB，不需要檔案伺服器。

## 目前功能

- 既有 tabs 共用虛擬檔案系統，各自保有 cwd、草稿與對話；同一個 panel 可切換簡易 bash、文字編輯器與 agent。
- `~/bin` 提供可擴充的 JavaScript 檔案工具；從 VFS 載入 AGENTS.md 與 skills，記錄實際讀寫的路徑和 revision。
- 歷史對話可在 reload、重新連接 Groq 或關閉 tab 後恢復；不會自動重送未完成的模型請求或工具副作用。
- `~/main.html` 支援 HTML／CSS／SVG 預覽，popup 使用同一 workspace 的檔案；刷新預覽保留 popup 對話與草稿。
- 使用者可明確向另一個 tab 提問並接收回覆；目前沒有模型自動 delegation。

[線上版本](https://gipapa.github.io/agent-go-round/) · [檔案工具](docs/bin-tools.md) · [主頁與 popup](docs/page-preview.md) · [笑話驗收](docs/joke-acceptance.md) · [實作規劃](docs/filesystem-editor-plan.md)

## 本機啟動

需要 Node.js 22 或更新版本：

```sh
npm install
npm run dev
```

開啟 Vite 顯示的網址。新 tab 先進入 `~` 的簡易 bash；預設 scripted demo 可體驗介面，真正的模型對話與 agent 工具呼叫需在 provider settings 連接 Groq。手動操作 shell 檔案工具不需要 API key。

Groq 設定使用 password field。`Remember this key in this browser` 預設開啟，勾選時保存於目前 origin 的 localStorage；取消勾選時只保留在目前頁面的記憶體，亦可清除已保存的 key。API key 不會寫入 VFS、對話、bundle 或 embed bridge。

## 簡易 bash 與對話

這是操作 VFS 的簡易 bash，支援下列內建指令及 `~/bin` 擴充工具；不支援管線、重導向、作業系統程式或完整 bash 語法。

**指令名稱不分大小寫。** `ls`、`LS`、`Ls` 的效果相同；`AI --NEW`、`Ai --ReSuMe ID`、`DeMo JoKeS`、`RESTORE-BIN READ` 也可使用。路徑、檔案內容、搜尋字串、JSON 欄位與 session ID 保留原本大小寫。

| 指令 | 用途 |
|---|---|
| `help` | 顯示支援指令與用法 |
| `pwd`、`cd PATH` | 查看或切換目前目錄 |
| `ls [PATH]`、`find [PATH] [NAME_GLOB]` | 列出目錄或尋找檔案 |
| `read PATH`／`cat PATH` | 讀取內容與 revision |
| `write PATH "CONTENT"` | 建立文字檔；覆寫既有檔案需以 JSON 提供 expectedRevision |
| `edit PATH` | 在目前 panel 開啟文字編輯器 |
| `edit PATH "OLD" "NEW"` | 精確替換文字 |
| `grep "TEXT" [PATH]` | 搜尋檔案內容 |
| `mkdir PATH`、`touch PATH`、`mv FROM TO`、`rm PATH` | 建立目錄／空檔、搬移或刪除 |
| `preview [PATH]` | 開啟頁面預覽，預設為 `~/main.html` |
| `ai` | 啟動或接續目前 tab 的 agent |
| `ai --new` | 另開對話，保留舊對話於歷史 |
| `history`、`ai --resume SESSION_ID` | 列出或恢復已保存的對話 |
| `rehash`、`restore-bin NAME` | 載入新增／修改的工具，或還原預設工具 |
| `demo jokes`、`clear` | 建立笑話範例，或清空目前 terminal 顯示 |

進入 agent 後，`/exit` 返回 shell；`/skill NAME TASK` 明確選用 skill，`/skill off` 清除 active skill。這些控制指令也接受大小寫混用，skill 名稱與任務文字維持原樣。

例如以下指令只會建立一個保留大小寫的 `Notes.md`：

```text
WrItE Notes.md "Hello World"
READ Notes.md
GREP "World" Notes.md
```

所有 bin 工具都接受 JSON 參數，可提供分頁、批次讀寫、revision 與搜尋選項，詳見 [bin 工具說明](docs/bin-tools.md)。

## AGENTS.md、skills 與工具

工作區以 `/home/user` 對應 `~`，典型結構如下：

```text
~/
  AGENTS.md
  main.html
  documents/
  jokes/
  .pi/skills/joke-master/
    SKILL.md
    references/scoring.md
  bin/
    read.js
    read.tool.json
    …
```

每個 user run 從 home 到 agent cwd 載入 AGENTS.md，也接受小寫的 agents.md；同層兩者並存時會回報歧義。Skill 先提供 metadata catalog，模型透過 `skill_load` 按需讀取 SKILL.md，再以 `read` 取得 references 和工作檔案。Active skill 在下一輪從檔案刷新。

預設工具為 `read`、`write`、`edit`、`grep`、`find`、`ls`、`skill_load`。新增工具時，把 `.js` 與對應 `.tool.json` 放入 `~/bin`，再執行 `rehash`。JS 在隔離 iframe 的 Worker 執行，透過 manifest 宣告的 capabilities 存取 VFS，無法直接取得 app DOM、IndexedDB 或 provider credentials；目前不支援 Node API、npm packages 或外部 imports。

快速體驗檔案式 skill：

1. 在 shell 輸入 `demo jokes`，建立中文 AGENTS.md、joke-master skill、評分參考與五個笑話，既有檔案不覆寫。
2. 在 settings 連接 Groq，輸入 `ai`。
3. 用英文詢問：`Use the joke-master skill to read all five Markdown jokes in ~/jokes, score each one, and give me the funniest joke.`
4. 檢閱中文評分、冠軍原文、讀檔來源與 revision；修改檔案後可要求重新讀取與評分。

完整驗收條件與模型／額度紀錄見 [笑話驗收](docs/joke-acceptance.md)。

## 主頁預覽與 popup

在 shell 輸入 `preview ~/main.html`。檔案不存在時，按「建立主頁範本」才會寫入；也可先用 `edit ~/main.html` 自行編輯。

右下角「開啟 Pi」會打開共用該 workspace 檔案的 popup。連接 Groq、輸入 `ai` 後，可要求 agent 修改 `~/main.html`。檔案有更新時，按「重新載入預覽」套用內容；刷新只更新頁面 iframe，保留 popup 的對話、草稿與 active run。

「開啟主頁」提供隱藏編輯器外框的 page view，例如 `?workspace=my-space&view=page`；「工作區」可另開 shell/editor。預覽 entry 和 popup surface 會持久化，整頁 reload 後可恢復，Groq 需要重新連線。

目前支援 UTF-8 HTML、CSS、相對 CSS import 與 SVG 圖片。頁面在隔離 iframe 呈現，頁面腳本、外部網路資源與導航不執行；二進位圖片匯入、完整頁面 JavaScript、VFS 匯出／發布另列後續。詳見 [主頁預覽](docs/page-preview.md)。

手機輸入欄位使用 16px；鍵盤縮小可視區時精簡標題列與側欄，保留輸入列及可捲動的對話區。Popup 跟隨宿主的可視區尺寸與位移，調整尺寸時保留草稿。已做瀏覽器可視區模擬，iPhone Safari 原生鍵盤仍需實機驗證。

## 儲存與工作區

UI 使用 IndexedDB 保存檔案、tabs、editor draft、session transcript、歷史與 lifecycle／來源版本紀錄，首次會遷移舊 localStorage workspace 並保留原資料。關閉 tab 保留對話歷史；reload 後重連 Groq 會接續原 messages 與 active skill。

URL 可用 `?workspace=NAME` 隔離檔案與歷史。相同 workspace 的 editor、page view 與 popup 共用檔案及歷史，各自保存 layout；revision／writer lease 檢查避免同一 session 被同時覆寫。Identity 接受 1–64 個英數字、底線或連字號。

IndexedDB 資料屬於目前瀏覽器與 app origin，不是雲端同步，也不會因部署到 GitHub Pages 就讓其他訪客取得你的自訂檔案。

## 驗證

```sh
npm test
npm run typecheck
npm run build
npm run verify:dist
```

目前回歸測試為 94 項，涵蓋歷史接續、VFS、工具／skills、大小寫指令、預覽及 popup。一般 `npm test` 不呼叫模型或消耗額度。

瀏覽器 runner 使用 agent-browser CLI，可透過 `AGENT_BROWSER_CLI` 指定 executable 或 JS 入口：

| 指令 | 驗證範圍與需求 |
|---|---|
| `npm run test:mobile:browser` | 混合大小寫工具、模擬鍵盤、捲動、設定表單與 popup 草稿；先啟動 production preview，不需 API key |
| `npm run test:jokes` | 真實 Groq 的五檔評分、歷史恢復、建立五檔並讀回；使用 `.env.local` 的 key |
| `npm run test:jokes:browser` | 真正瀏覽器 UI／IndexedDB／Worker 的笑話驗收；先啟動 dev server，使用 `.env.local` 的 key，Node 需支援 TypeScript stripping |
| `npm run test:preview:browser` | 真實 Groq 修改頁面、刷新、歷史、工作區隔離；先啟動 production preview，使用 `.env.local` 的 key |
| `npm run test:groq` | adapter 的 read、mutation/read-back、tool-error correction；以環境變數提供 key |

Production preview 先執行 `npm run build`，再以 `npm run preview` 啟動。瀏覽器 runner 可用 `AGENT_GO_ROUND_APP_URL` 指定 app URL；live runner 可用 `AGENT_GO_ROUND_GROQ_MODEL` 選擇模型。測試 key 使用 `AGENT_GO_ROUND_GROQ_API_KEY`，不要提交到 Git。

笑話、主頁與手機 runner 的報告／截圖保存於忽略追蹤的 `test-results/`。`test:groq` 輸出至 terminal，可透過 `AGENT_GO_ROUND_GROQ_REPORT` 指定 JSON 報告路徑。詳細證據見對應驗收文件，quota／模型失敗不計為通過。

## 嵌入其他網站

Production build 會產生 `embed.js`。宿主 HTML 可以載入 GitHub Pages 的 loader，即使宿主本身在 localhost：

```html
<script
  type="module"
  src="https://gipapa.github.io/agent-go-round/embed.js"
  data-target="body"
  data-mode="popup"
  data-workspace="my-space"
  data-surface="support-popup"
  data-button-label="Open AgentGoRound"
></script>
```

Loader 依 `embed.js` 所在位置推導 iframe app URL，保留 `/agent-go-round/` 子路徑。測試線上版本時使用上述絕對 URL；`src="./embed.js"` 會改載入宿主自己提供的檔案。若宿主有 CSP，需允許該來源的 script 與 iframe。使用者仍在 popup 輸入自己的 Groq key。

亦可由宿主明確 mount：

```js
const widget = window.AgentGoRound.mount({
  appUrl: "https://gipapa.github.io/agent-go-round/",
  workspaceId: "my-space",
  surfaceId: "support-popup",
  mode: "popup"
});
```

Widget 提供 `open()`、`close()`、`toggle()`、`postMessage()`、`on()`、`registerTool()`、`destroy()`；`mode: "inline"` 可直接嵌入容器。Workspace／surface binding 會由 ready handshake 核對；provider 認證與跨 tab routing 尚未提供 embed API。

宿主可用 `registerTool(spec, handler, approval?)` 註冊工具。Bridge 驗證 schema、instance／session／tool-call／request identity，處理取消、deadline 與 outcome unknown；需批准的工具使用綁定精確參數、只能使用一次的 approval token。Bridge 不提供任意讀取宿主 DOM、cookies 或 storage 的介面。目前 wire protocol 為 v2、SDK 為 `0.2.0`，不支援的版本會被拒絕。

純 HTML 範例為 [public/embed-example.html](public/embed-example.html)，可在本機 build／preview 後開啟 `/embed-example.html`，或查看 [線上 embed example](https://gipapa.github.io/agent-go-round/embed-example.html)。React 範例在 [examples/react-host](examples/react-host)：在該目錄執行 `npm install`，再以 `VITE_AGENT_APP_URL=http://127.0.0.1:4173/ npm run dev` 啟動；unmount 時會 destroy widget。

## 核心 SDK

公開 entry 為 [src/index.ts](src/index.ts)，非瀏覽器環境可 import，呼叫 `mount()` 才要求 browser document。Pi 套件固定為 `@earendil-works/pi-agent-core`／`pi-ai` `0.84.4`。

`AgentSession` 可注入 Pi `AgentTool`，由 Pi 驗證參數並執行工具循環；宿主可設定 approval、maxToolCalls、deadlineMs 與 maxOutputCharacters。工具結果不明時使用 `ToolOutcomeUnknownError`，session 記錄 outcome_unknown 並停止自動 follow-up；`inspectSessionRecovery()` 重建中斷資訊，不重播副作用。

SDK 也提供可替換的 filesystem、session／workspace stores、event stores、skills loader、tab router 與 embed bridge。Memory／localStorage adapters 保留供獨立宿主使用；正式 UI 使用 IndexedDB。模型自動多代理編排、完整長對話 compaction、MCP、遠端磁碟與 ChatGPT 訂閱接入仍列後續，見 [設計規劃](docs/plan.md)。

## 部署與版本

Push 到 `master` 會由 GitHub Actions 執行測試、typecheck、build 與 dist 檢查，再發布到 GitHub Pages。Project-site build 使用 `VITE_BASE_PATH=/agent-go-round/`。

完整舊版保存在 `v2` 分支，封存起點為 `73285d6`；更早版本在 `v1`、`v1.5`。舊版的未完成驗收紀錄保留於對應分支，並不代表新版已通過。

採用 [MIT License](LICENSE)。
