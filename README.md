# AgentGoRound

以 Pi 為核心的純前端 agent 工作區：在瀏覽器中管理檔案、接續對話，讓 agent 讀取工作區規則與 skills，並透過 popup 修改與預覽自己的主頁。

Pi 擁有唯一的模型／工具循環，使用 Groq 的 OpenAI 相容 Chat Completions 接口。檔案與對話保存於瀏覽器 IndexedDB，不需要檔案伺服器。

## 目前功能

- 桌面僅顯示橫式 tab 列；手機／窄螢幕與 popup 僅顯示直式 tab 列，提供新增、切換與關閉，鍵盤開啟時保留。
- 新 tab 預設 AI 模式，透過 AI／Shell toggle 顯示及切換目前模式；開啟新 tab 就建立獨立對話。Tabs 共用虛擬檔案系統，各自保有 cwd、草稿與對話，切換模式保留對話。
- AI 優先用 just-bash 操作檔案；`~/bin` 保留版本化讀寫、精確編輯、skills、宿主頁面與跨 tab 等工具。指令／工具名稱不分大小寫，檔名、變數、內容與 JSON 欄位保留大小寫。
- 從 VFS 載入 AGENTS.md 與 skills，記錄實際讀寫的路徑和 revision；`~/agents.md` 包含 Bash／bin 工具清單及使用原則。
- 歷史對話可在 reload、重新連接 Groq 或關閉 tab 後恢復；不會自動重送未完成的模型請求或工具副作用。
- `~/main.html` 支援 HTML／CSS／SVG 預覽，popup 使用同一 workspace 的檔案；刷新預覽保留 popup 對話與草稿。
- `~/bin/agents.js` 讓 AI 列出 agents、向指定 tab 發送任務並讀取實際回覆；另保留手動跨 tab 提問 UI。

[線上版本](https://gipapa.github.io/agent-go-round/) · [檔案工具](docs/bin-tools.md) · [主頁與 popup](docs/page-preview.md) · [笑話驗收](docs/joke-acceptance.md) · [工具列表](agents.md) · [待辦與現況](docs/plan.md#後續工作順序待排期) · [just-bash 計畫](docs/just-bash-plan.md)

[just-bash 與 VFS 整合](docs/just-bash-plan.md) 已接入主終端：固定 `just-bash@3.6.0`、bytes VFS、opaque iframe／Worker 與受限 filesystem RPC。AI 的原生 `bash` tool 使用同一 runtime／VFS，也保留結構化工具、skills、宿主讀取與跨 tab agents。人類 editor 重做另列後續。

新版檔案資料庫為 `agent-go-round.vfs.bytes-v2`（schema 1），沿用 workspace 隔離。舊 `agent-go-round.vfs` 留存但不讀取、不清空、不自動搬移；原有對話資料庫維持不變。文字工具使用嚴格 UTF-8 facade，二進位檔改用 SDK 的 `readBytes`／`writeBytes`；不合法 UTF-8 會回報錯誤。

重跑瀏覽器概念驗證：啟動 app 後執行 `npm run test:bash:browser`，可用 `AGENT_GO_ROUND_APP_URL` 指向 production base path，`AGENT_BROWSER_CLI` 指定 agent-browser 路徑。結果寫入 `test-results/just-bash-browser.json`。支援範圍與上游限制見 [驗證紀錄](docs/just-bash-progress.md)。

## 本機啟動

需要 Node.js 22 或更新版本：

```sh
npm install
npm run dev
```

開啟 Vite 顯示的網址。新 tab 預設進入 AI 模式，工作目錄為 `~`；AI／Shell toggle 可切換至 just-bash shell；預設 scripted demo 可體驗介面，真正的模型對話與 agent 工具呼叫需在 provider settings 連接 Groq。手動執行 shell 不需要 API key。

Groq 設定使用 password field。`Remember this key in this browser` 預設開啟，勾選時保存於目前 origin 的 localStorage；取消勾選時只保留在目前頁面的記憶體，亦可清除已保存的 key。API key 不會寫入 VFS、對話、bundle 或 embed bridge。

已保存 key 時，重新整理會自動恢復相同 API 位址的 Groq runtime；恢復歷史對話也沿用本頁可用的設定，保留各對話原本的模型與 context length，不會重送歷史請求。未保存 key 時，reload 後需手動 Connect 一次，同一 API 位址的其他待連線 tabs 會一起恢復。

Provider settings 會從 Base URL 下的 `/models` 取得模型清單，並帶入模型的 context length（tokens）；也可按 `Refresh models` 更新。端點不存在、請求失敗或未提供長度時，可手動輸入 Model 與 Context length。設定中的 `Auto compact target` 預設為 context 的 40%，當估算使用量超過這個比例時，會保留較新的對話輪次並移除較舊輪次，再繼續送出請求；百分比可自行調整。AI status bar 位於每個 pane 最底部，標示 `STATUS`、目前執行狀態、workspace 儲存狀態、模型、context 使用量和 compact 目標；手機與鍵盤縮小畫面也會保留，窄版會自動換行避免 context 被裁切。模型欄位依據 [Groq Models API](https://console.groq.com/docs/api-reference#models) 的 `id`／`context_window`，也接受相容端點的 `context_length`／`max_model_len`。

## Shell 與對話

新分頁預設 AI，透過 AI／Shell toggle 切換至 Shell 後，終端直接執行整段 just-bash script，指令名稱不分大小寫；變數、路徑與參數保留大小寫；支援引號、Unicode、pipe、redirect、glob、heredoc、條件、迴圈及函式。stdout、stderr、exitCode 分別顯示。桌面 Enter 送出、Shift+Enter 換行；手機以 Send 送出，Enter 保留換行。

```sh
mkdir -p ~/docs && cd ~/docs
printf 'hello\n世界\n' > notes.txt
cat notes.txt | grep hello > matches.txt
printf 'more\n' >> notes.txt
for file in *.txt; do echo "$file"; done
```

每次送出是獨立 script，跨次僅保留 cwd；變數、函式、alias、shell options 與 `$?` 不延續。cwd 隨 tab 保存並在 reload 還原。使用可重現且驗證原始套件雜湊的上游補丁，從公開執行結果取得真正 cwd，並正規化指令名稱；不依賴可被覆寫的 PWD。[修改與授權聲明](public/licenses/just-bash-modifications.txt)。

Shell 只操作目前 workspace 的虛擬 `/`，`~`／HOME 為 `/home/user`；沒有宿主磁碟、任意 binary、網路、Node／Python、hard links、gzip codecs 或 sqlite3。執行有來源／步數／記憶體／輸出與時間上限，Stop 會終止 Worker；已開始提交的寫入可能成功，結果不確定時先讀回。

對話、預覽與工具目錄操作使用 UI：

| 操作 | 入口 |
|---|---|
| Shell／AI 切換 | pane 上方 AI／Shell toggle；agent 中也可 `/exit` 返回 shell |
| 新對話、恢復歷史 | 開啟新分頁、History／Resume |
| HTML 預覽 | Workspace → Preview file → Open preview |
| 笑話範例與 JS 工具更新 | Workspace → Install joke demo／Reload AI tools |
| 回到 home、用法 | Workspace → Home／Shell guide |

Shell 的 `read`／`help` 使用上游定義。`~/bin` 的結構化 AI 工具沒有同名 CLI／JSON 相容層；也不執行使用者 JS 作為 trusted shell command。人類 editor 已退出本階段。

## 跨 tab 的 agent 溝通

在同一頁面開兩個 app tabs，連接 Groq，確認兩個 tabs 都在 AI 模式。在第一個 tab 對 AI 說「請另一個 tab 講一個笑話，讀取回覆後告訴我」，AI 即可透過 `agents` 工具自行找出目的 tab、發送任務和讀取對方的真實回覆。切換目前顯示的 tab 不會改變工具的來源身分；兩個 tabs 各自保有原本對話與工作目錄。

`send` 回傳 `requestId`，`read` 預設最多等待 5 秒。若仍為 `pending`，繼續讀取同一 ID；不要再次 `send`。AI 使用 JSON 形式，例如 `{"action":"send","target":"agent-2","text":"請講一個笑話"}`，接著 `{"action":"read","requestId":"message-…"}`。`list` 也列出本 tab 的請求 ID 與狀態，可在中斷後找回。

目標必須已進入 AI 且已連線。自己的 tab、忙碌或已關閉的目標會明確拒絕，沒有隱藏佇列。停止來源 tab 的等待不會重送或取消已接收的目標任務；可切到目標按 Stop。請求索引保存在目前頁面記憶體，保留最近 200 筆且不淘汰進行中的請求；reload 後失效，已保存的對話與工具結果仍可從歷史查看。此功能處理同一 app instance 的 tabs，未連接其他瀏覽器分頁或 popup instances。

## AGENTS.md、skills 與工具

工作區以 `/home/user` 對應 `~`。啟動時預先建立空白的 `~/skills/` 與 `~/agents.md`，預設規則為「請回覆繁體中文」，並附上 just-bash 指令／內建、bin 工具列表與 Bash 優先的使用原則。既有 AGENTS.md／agents.md 保留自訂規則，只更新 `agent-go-round:tools` 標記內的工具清單，不另建大小寫重複檔。開發期間直接使用目前格式的新工作區，不匯入或搬移舊資料。

安裝 joke demo 後的典型結構如下：

```text
~/
  agents.md
  main.html
  documents/
  jokes/
  skills/joke-master/
    SKILL.md
    references/scoring.md
  bin/
    read.js
    …
    manifests/
      read.tool.json
      …
```

每個 user run 從 home 到 agent cwd 載入 AGENTS.md，也接受小寫的 agents.md；skill 檔也接受小寫的 skill.md。同層大小寫兩者並存時會回報歧義。Skill 先提供 metadata catalog，模型透過 `skill_load` 按需讀取 SKILL.md，再以 `read` 取得 references 和工作檔案。Active skill 在下一輪從檔案刷新。

AI 另有原生 `bash` tool（不在可編輯的 `~/bin` 中），可提交 script 與受限的 timeoutMs／maxOutputBytes／maxSteps。其 cwd 與人類 shell 分開保存，成功回傳的 cwd 也用於該 agent 後續相對路徑的結構化工具。bash 的交易存取紀錄包含實際路徑與 revision；head／grep／pipe 的結果不標記為模型已讀全文。Stop／結果不確定時先讀回，不自動重播寫入。

一般讀取、列目錄、搜尋與文字轉換優先使用 `bash`；bin 的 `ls`／`find`／`grep` 保留相容用途。需要 revision、完整讀取證據、原子多檔寫入或精確替換時，使用結構化 `read`／`write`／`edit`。完整指令與工具清單見 [agents.md](agents.md)。工具呼叫與 `help` 查詢名稱不分大小寫；Bash 的 `if`／`then`／`for` 等語法關鍵字仍採標準大小寫。

預設結構化工具為 `read`、`write`、`edit`、`grep`、`find`、`ls`、`skill_load`、`read_host_page`、`help`、`agents`，供 AI 以結構化參數呼叫。工具 `.js` 放在 `~/bin`，工具說明／JSON schema 的 `.tool.json` 集中於 `~/bin/manifests/`；新增或修改後使用 Workspace → Reload AI tools。JS 在隔離 iframe 的 Worker 執行，透過 manifest 宣告的 capabilities 存取 VFS 或呼叫宿主 bridge，無法直接取得 app DOM、IndexedDB 或 provider credentials；目前不支援 Node API、npm packages 或外部 imports。

快速體驗檔案式 skill：

1. 使用 Workspace → Install joke demo，沿用預設 agents.md，建立 joke-master skill、評分參考與五個笑話，既有檔案不覆寫；已有小寫 agents.md／skill.md 時沿用原檔。
2. 在 settings 連接 Groq，切換至 AI。
3. 用英文詢問：`Use the joke-master skill to read all five Markdown jokes in ~/jokes, score each one, and give me the funniest joke.`
4. 檢閱中文評分、冠軍原文、讀檔來源與 revision；修改檔案後可要求重新讀取與評分。

完整驗收條件與模型／額度紀錄見 [笑話驗收](docs/joke-acceptance.md)。

## 主頁預覽與 popup

使用 Workspace → Preview file 輸入 `~/main.html`，按 Open preview。檔案不存在時，按「建立主頁範本」才會寫入；也可先用 shell 重導向建立檔案。

右下角「開啟 Pi」會打開共用該 workspace 檔案的 popup。連接 Groq 後，可要求 agent 修改 `~/main.html`。檔案有更新時，按「重新載入預覽」套用內容；刷新只更新頁面 iframe，保留 popup 的對話、草稿與 active run。

「開啟主頁」提供隱藏編輯器外框的 page view，例如 `?workspace=my-space&view=page`；「工作區」可另開 shell／agent。預覽 entry 和 popup surface 會持久化，整頁 reload 後可恢復，Groq 需要重新連線。

目前支援 UTF-8 HTML、CSS、相對 CSS import 與 SVG 圖片。頁面在隔離 iframe 呈現，頁面腳本、外部網路資源與導航不執行；二進位圖片匯入、完整頁面 JavaScript、VFS 匯出／發布另列後續。詳見 [主頁預覽](docs/page-preview.md)。

手機輸入欄位使用 16px；鍵盤縮小可視區時精簡標題列，保留直式 tab 列，保留輸入列及可捲動的對話區。Popup 跟隨宿主的可視區尺寸與位移，調整尺寸時保留草稿。已做瀏覽器可視區模擬，iPhone Safari 原生鍵盤仍需實機驗證。

## 儲存與工作區

UI 使用 IndexedDB 保存 bytes 檔案、tabs、cwd、輸入草稿、session transcript、歷史與 lifecycle／來源版本紀錄；不匯入舊 localStorage 或舊 VFS namespace。關閉 tab 保留對話歷史；reload 後重連 Groq 會接續原 messages 與 active skill。

URL 可用 `?workspace=NAME` 隔離檔案與歷史。一般外部 popup 在未指定 workspace 時自動建立獨立 workspace，與直接開啟的 `default` 工作區及其他 popup 隔離。同一宿主瀏覽器分頁重新整理時，依頁面 URL 與掛載順序恢復原 workspace；sessionStorage 不可用時僅在目前 instance 保留身份。相同 workspace 的 shell、page view 與明確綁定的 popup 共用檔案及歷史，各自保存 layout；revision／writer lease 檢查避免同一 session 被同時覆寫。Identity 接受 1–64 個英數字、底線或連字號。

IndexedDB 資料屬於目前瀏覽器與 app origin，不是雲端同步，也不會因部署到 GitHub Pages 就讓其他訪客取得你的自訂檔案。

## 驗證

```sh
npm test
npm run typecheck
npm run build
npm run verify:dist
```

2026-11-06 本機驗證：32 個測試檔、183 項測試通過，production build（含 typecheck）與 `verify:dist` 通過。瀏覽器驗證包含正式 Shell 的 12 項、AI Bash／bin 的 3 組、跨 tab 的 2 組與手機／popup 的 12 項檢查。報告與各輪範圍見 [驗證紀錄](docs/just-bash-progress.md)。

回歸涵蓋歷史接續、provider、VFS bytes／交易、結構化工具／skills、預覽、popup identity，以及指令／工具大小寫、AI 預設模式與 toggle。舊 JSON CLI 與人類 editor 已移除。一般 `npm test` 不呼叫模型或消耗額度；just-bash 版的外部模型 smoke 與 iPhone Safari 真機驗收仍待完成。

瀏覽器 runners 已改用 just-bash 與現行 UI；agent／host／tabs 預設使用本機 HTTP／SSE fixture 驅動真正 Pi loop，不呼叫外部模型。瀏覽器 runner 使用 agent-browser CLI，可透過 `AGENT_BROWSER_CLI` 指定 executable 或 JS 入口：

| 指令 | 驗證範圍與需求 |
|---|---|
| `npm run test:shell:browser` | 正式 just-bash UI、opaque Worker／CSP、真實 cwd、雙 tab／reload、Stop／已提交寫入、輸出上限及手機；先啟動 production preview，不需 API key |
| `npm run test:agent:bash:browser` | AI bash／結構化工具交叉讀寫、skills、交易 trace、cwd、Stop／reload 不重播；production preview，本機 fixture，不需 key |
| `npm run test:bash:browser` | 獨立 P0–P2 adapter／原生 IndexedDB 驗證入口，不需 API key |
| `npm run test:vfs:browser` | 原生 IndexedDB 讀取量、metadata、skill 路徑、串流選取及 reload；先啟動 production preview，不需 API key |
| `npm run test:embed:vfs:browser` | 不同 localhost origin 的 HTTP embed：原生／缺少 `crypto.randomUUID` 的 VFS 初始化、Worker 讀寫、預覽及 reload；先 build，runner 自行啟動 preview 與宿主，不需 API key |
| `npm run test:mobile:browser` | just-bash 輸入、模擬鍵盤、捲動、設定表單與 popup 草稿；先啟動 production preview，不需 API key |
| `npm run test:host:browser` | Popup workspace 隔離、reload、宿主 HTML 分頁及來源身分；production preview，本機 fixture，不需 key |
| `npm run test:tabs:browser` | 同頁雙 AI sessions 的 list／send／read、精確轉述、來源身分與 request 過期；production preview，本機 fixture，不需 key |
| `npm run test:jokes` | 真實 Groq 的五檔評分、歷史恢復、建立五檔並讀回；使用 `.env.local` 的 key |
| `npm run test:jokes:browser` | 真正瀏覽器 UI／IndexedDB／Worker 的笑話驗收；先啟動 dev server，使用 `.env.local` 的 key，Node 需支援 TypeScript stripping |
| `npm run test:preview:browser` | Popup 修改頁面、刷新、歷史、工作區隔離；production preview，預設本機 fixture；設定 AGENT_GO_ROUND_RUN_GROQ=1 才呼叫 Groq |
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

本機 `vite` dev server 也提供 `/embed.js`；跨站載入只允許 `localhost`、`*.localhost`、`127.0.0.1` 與 `[::1]` 的 HTTP(S) origin，dev server 與 embed entry 使用同一份白名單。

嵌入環境未提供 `crypto.randomUUID()` 時，工作區識別碼、預覽 surface 與工具 sandbox nonce 會使用 `crypto.getRandomValues()` 產生安全 UUID，避免初始化或讀檔失敗。

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

`~/bin/read_host_page.js` 與 `~/bin/manifests/read_host_page.tool.json` 提供唯讀宿主讀取；AI 以結構化參數 `{"offset":0,"limit":1000}` 呼叫該 bin JS。沒有宿主時明確回報「目前沒有連接宿主頁，請從 Host page 開啟 popup。」。HTML 視為外部資料；不會自動成為 system instructions 或寫入 VFS。Demo Host page 包含「這一頁的作者是gipapa」，可在 popup 連接 Groq，再問「這一頁的作者是誰？」驗證工具讀取。

Terminal 在 shell 輸出、工具結果或 AI 串流有新內容時自動捲到底部；沒有新內容時可自行捲動閱讀。

宿主可用 `registerTool(spec, handler, approval?)` 註冊額外工具。Bridge 驗證 schema、instance／session／tool-call／request identity，處理取消、deadline 與 outcome unknown；需批准的工具使用綁定精確參數、只能使用一次的 approval token。Bridge 不提供任意讀取宿主 cookies 或 storage 的介面。目前 wire protocol 為 v2、SDK 為 `0.2.0`，不支援的版本會被拒絕。

純 HTML 範例為 [public/embed-example.html](public/embed-example.html)，可在本機 build／preview 後開啟 `/embed-example.html`，或查看 [線上 embed example](https://gipapa.github.io/agent-go-round/embed-example.html)。React 範例在 [examples/react-host](examples/react-host)：在該目錄執行 `npm install`，再以 `VITE_AGENT_APP_URL=http://127.0.0.1:4173/ npm run dev` 啟動；unmount 時會 destroy widget。

## 核心 SDK

公開 entry 為 [src/index.ts](src/index.ts)，非瀏覽器環境可 import，呼叫 `mount()` 才要求 browser document。Pi 套件固定為 `@earendil-works/pi-agent-core`／`pi-ai` `0.84.4`。

`ShellRuntime` 僅在瀏覽器 DOM 執行；非瀏覽器 SDK harness 必須向 `configureFileAgent` 最後的 runtime 參數明確注入 `ShellExecutor`，不提供宿主 shell fallback。

`AgentSession` 可注入 Pi `AgentTool`，由 Pi 驗證參數並執行工具循環；宿主可設定 approval、maxToolCalls、deadlineMs 與 maxOutputCharacters。工具結果不明時使用 `ToolOutcomeUnknownError`，session 記錄 outcome_unknown 並停止自動 follow-up；`inspectSessionRecovery()` 重建中斷資訊，不重播副作用。

SDK 也提供可替換的 filesystem、session／workspace stores、event stores、skills loader、tab router 與 embed bridge。Memory／localStorage adapters 保留供獨立宿主使用；正式 UI 使用 IndexedDB。模型自動多代理編排、完整長對話 compaction、MCP、遠端磁碟與 ChatGPT 訂閱接入仍列後續，見 [設計規劃](docs/plan.md)。

## 尚未完成的規劃

just-bash／bytes VFS 的 P0–P5 已落地；後續以 [主計畫](docs/plan.md#後續工作順序待排期) 為準，舊版 F0–F5／POC 文件保留為歷史，不能直接當成目前待辦。

| 狀態 | 項目 |
|---|---|
| 待驗收 | just-bash 版的真實 Groq 工具／笑話／預覽 smoke；iPhone Safari 原生鍵盤、中文輸入、旋轉與 popup 操作 |
| 部分完成 | Context budget、模型 context length 與可調整的 40% 自動裁切已做；原始歷史封存、真正摘要、可檢閱的 compaction 紀錄與超限處理仍待補齊 |
| 未實作 | 工作區匯出／匯入；歷史搜尋、重新命名、封存／刪除、Markdown／程式碼呈現；人類檔案 editor 重做 |
| 未實作 | PNG／JPEG 等二進位預覽與匯入介面、受控頁面 JavaScript、HTML／資源匯出及訪客可見的發布 |
| 刻意延後 | 跨輸入保留完整 Shell 狀態、hard links、多使用者權限、Node／Python／網路執行；MCP、遠端磁碟、ChatGPT 訂閱 adapter、自動 delegation、voice 與多模態 |

VFS 已能儲存二進位 bytes，AI `agents` 的跨 tab list／send／read 也已完成；它們不列為未實作。現有自動裁切會移除 runtime messages 的舊輪次，不能視為已完成保留原始歷史的摘要壓縮。

## 部署與版本

Push 到 `master` 會由 GitHub Actions 執行測試、typecheck、build 與 dist 檢查，再發布到 GitHub Pages。Project-site build 使用 `VITE_BASE_PATH=/agent-go-round/`。

完整舊版保存在 `v2` 分支，封存起點為 `73285d6`；更早版本在 `v1`、`v1.5`。舊版的未完成驗收紀錄保留於對應分支，並不代表新版已通過。

專案自有程式採用 [MIT License](LICENSE)。實際 Pi 套件與 just-bash（Apache-2.0）依賴，以及 Pi-like／Herdr-like 的行為參考，見 [來源與授權說明](CREDITS.md)。[第三方授權全文與索引](public/licenses/index.html) 隨 dist 發布；更新依賴後執行 `npm run licenses:generate`。
