# just-bash 實作與驗證紀錄

2026-11-04。依 [整合計畫](just-bash-plan.md) 完成 P0–P5 的實作、文件與驗收；本頁記錄實際證據及保留限制。

## 已落地

| 階段 | 程式與證據 | 邊界 |
|---|---|---|
| P0 | 固定 just-bash 3.6.0 與 lockfile；`poc/just-bash.html`、module Worker、host VFS RPC；Vite production build 與 GitHub Pages base path | 保留獨立 adapter probe；主產品另使用正式 ShellRuntime |
| P1 | `core/fs.ts`：bytes、嚴格 UTF-8 facade、atomic append／exclusive create／copy／replace rename、revision、配額、mode／mtime／atime、symlink；`fs-bytes.test.ts` 與原生瀏覽器驗證 | `/` 是 workspace 的虛擬根；保護 `/`、`/home`、`/home/user`；沒有 host filesystem 存取 |
| P2 | `JustBashFileSystem` 實作 filesystem 合約；`shell-filesystem.ts` 使用 MountableFs 並在選 mount 前解析各層 symlink；adapter 整合測試與 probe 使用同一實作 | hard links 明確 ENOSYS；`getAllPaths()` 不提供同步 workspace index，glob 使用 async readdir/stat |
| P3 | 正式 ShellRuntime／opaque iframe／Worker、CSP、run-bound RPC、來源／輸出／時間／步數限制；主終端直接執行整段 script；UI 切換 shell／AI、歷史與預覽；stdout／stderr／exitCode 分流保存 | 每次獨立 script，只保存公開結果回傳的真實 cwd；Stop 不重播寫入，可能已提交時回報 outcome_unknown |
| P4 | 原生 AI bash tool、同一 ShellRuntime／VFS、agent 專用 cwd、受限選項、交易範圍存取 recorder；11 項新增測試與 production AI runner | 不把 byte 讀取當作模型全文閱讀；Stop／reload／重新連線不重播未知寫入 |
| P5 | 移除舊引擎／editor，SDK exports、README、工具／預覽／歷史文件與全部 browser runners 對齊 | 外部模型 smoke 與本機 fixture 分開列示；人類 editor 重做仍屬後續 |
| 發布授權 | `public/licenses/` 包含 just-bash／Pi 全文、production dependency inventory／全文及上游 bundled notices；`verify:dist` 檢查版本與內容雜湊 | 清單是已安裝 production 依賴超集，包含未打入瀏覽器的 Node／optional 套件 |

新版 storage namespace 為 `agent-go-round.vfs.bytes-v2`，schema 1。metadata、contents、usage 仍分開儲存並在同一交易提交，workspace／parent index 不變；內容欄位改為 Uint8Array。舊 `agent-go-round.vfs` 不開啟、不清空、不 migration。對話／layout／events 沿用原資料庫。

新增／刪除 directory entry 會更新父目錄 mtime／revision；覆寫既有檔案正文不改父目錄時間。搬移目錄保留子樹各目錄原本的 mtime，只更新搬出／搬入的父目錄。mode 僅為保存的虛擬 metadata，不建立 owner／多使用者權限系統。

一般工作檔案與 `/tmp` 使用持久化 workspace VFS；runtime 建立 `/tmp`、`/usr` skeleton。`/bin`、`/usr/bin`、`/dev`、`/proc` 使用每次執行的記憶體 mount，供上游 constructor 建立 stubs／系統檔。所有非系統檔案直接操作 IndexedDB，不在指令結束後同步另一份樹。

## P0 校正結果

- 未自行修改 PWD 的正常 script，其 `exec()` 回傳 `env.PWD` 反映最後 cwd；`getCwd()` 保持 constructor 的 cwd。不過 `cd docs; PWD=/tmp; pwd` 會輸出 `/home/user/docs` 而回傳 `env.PWD=/tmp`，執行限制等錯誤路徑也可能回傳初始 env。P3 已透過最小補丁新增公開 `result.cwd`，從 execution-local interpreter state 回傳，host 不讀 private state、不保存完整互動 session；覆寫 PWD、exit、eval、函式、source、subshell 與步數中止都有測試。補丁在 install／build／test 驗證原始完整 SHA-256，遇到版本差異明確失敗；[修改聲明](../public/licenses/just-bash-modifications.txt)。
- HOME 必須明確設為 `/home/user`；自訂 filesystem 的上游預設可能是 `/`。每次送出仍為獨立 script，不延續變數、函式、alias、options 或 `$?`。
- `Bash` 對 InMemoryFs／MountableFs 使用同步系統初始化；mount 的底層工作區不需要提供同步 IndexedDB 操作。小檔寫入、stat／list 不掃其他正文。
- 一般引號、Unicode、pipe、redirect、append、glob、heredoc、條件、迴圈只使用 async filesystem 方法。正式 probe 觀察到 lstat、mkdir、stat、writeFile、readFileBuffer、appendFile、readdir；代表腳本不依賴同步 getAllPaths。
- browser bundle 仍有 node:zlib 靜態匯入，Vite 原始 build 會失敗；`browser-zlib.ts` shim 明確回報 ENOSYS。上游 bundle 唯一修改是前項的公開 cwd 結果補丁。
- gzip／gunzip／zcat 無瀏覽器 codec；curl 無 network 設定時不註冊；Node／Python 沒有開啟。`touch -t` 在 3.6.0 中接受選項但沒有套用指定時間，已使用可驗證的 `touch -d`。不宣稱所有上游命令與所有 flags 都已驗收。
- `printf '\\xff'` 的重導向會由上游按 UTF-8 編碼，不等同本機 Bash 的 raw byte escape；使用原版 InMemoryFs 也重現。二進位整合改以 `printf AP+A | base64 -d > file` 建檔，再驗證 copy／move／讀回 bytes，未修改上游 printf。
- MountableFs 原本會在個別 backend 內解析 absolute symlink。新增全域虛擬路徑 resolver 後，`/bin/home -> /home/user`、home 指向 `/bin/cat`、跨 mount 循環與普通跨 mount byte copy／move 均有整合案例。跨 mount copy／move 是上游逐檔複製／刪除，不宣稱跨 backend 原子交易；workspace 內 copy／rename 則為單一 VFS 交易。
- 正式 Worker 程式由 esbuild 建立自足 IIFE，經動態 import 的字串 chunk 送進 opaque iframe，iframe 建立 blob Worker；CSP 禁止網路／外部載入。Worker 不接收 provider key 或 DOM，ready 需回報 null origin／無 document；host 依 runId、固定 workspace／tab owner、method／參數與唯一 RPC ID 驗證請求。Stop 關閉 port 並移除 iframe，late RPC 不再接受；已 dispatch 的交易仍可能完成。
- Worker 程式 chunk 約 1.29 MB、gzip 約 363 kB；主 app 第一次執行 script 才載入，建置與開發用同一 plugin，不依賴 host origin 的 Worker import。

## 驗證與重跑

```sh
npm test
npm run typecheck
npm run licenses:generate
VITE_BASE_PATH=/agent-go-round/ npm run build
VITE_BASE_PATH=/agent-go-round/ npm run verify:dist
VITE_BASE_PATH=/agent-go-round/ npm run preview -- --port 4186 --strictPort
AGENT_GO_ROUND_APP_URL=http://127.0.0.1:4186/agent-go-round/ npm run test:bash:browser
AGENT_GO_ROUND_APP_URL=http://127.0.0.1:4186/agent-go-round/ npm run test:shell:browser
```

`AGENT_BROWSER_CLI` 可指定 agent-browser 的 executable 或 `.js` 路徑。報告：`test-results/just-bash-browser.json`。測試使用真實瀏覽器／原生 IndexedDB，包含 memory／persisted 代表腳本、reload、執行／輸出／步數限制、Stop 與已提交寫入、embedded frame、兩個 surface 的並行 append 與 exclusive create；不需模型 key。fake-indexeddb 測試另驗證 revision 衝突、metadata-only 存取、全批回滾與 workspace 隔離。

P0–P2 上輪基線（歷史）：30 個測試檔、191 項測試通過；typecheck、production build、`verify:dist` 在 `/` 與 `/agent-go-round/` base path 通過；GitHub Pages base path 的 just-bash browser runner 13 項通過；現有 app 的 VFS browser runner 5 項通過（覆寫／listing 的正文讀取與 workspace 掃描均為 0）。既有 cross-origin embed runner 的 native 與無 randomUUID 兩種模式也通過，涵蓋初始化、讀寫、預覽與 reload；這仍是舊終端入口的回歸，不等同 P3 的新 ShellRuntime 驗收。常規 probe script 的預設期限為 15 秒，另以 80 ms 的明確期限測試 sleep 中斷；5 秒常規期限在與其他大量 browser／test 工作並行時曾觸發 host timeout，未將該次失敗列為通過，最後以完成建置後的獨立 production run 驗證。

`npm audit --omit=dev` 另回報 guarded-fetch／undici 連帶的 3 項 production dependency 告警（2 moderate、1 high）；此處不將 npm audit 視為通過。固定版 browser bundle 沒有匯入 guarded-fetch 的 Node／undici 執行路徑，且沒有開啟 network commands；後續若引入 Node 或網路功能需重新處理其依賴版本。沒有使用 `audit fix --force` 降版 just-bash。

P3 已移除 `shell.ts`、`shell-command.ts`、`command-definitions.ts`、舊 parser／大小寫／JSON CLI 測試，以及人類 editor／file-browser 程式與入口；SDK 改匯出 ShellRuntime。結構化 bin 工具、skills、provider／history／跨 tab 來源測試保留，help tool 改為 AI schema 說明。單元測試目前 29 檔、169 項通過；移除的舊相容案例不作為新驗收。正式 production UI runner 在 `/` 已通過 10 項（script、cwd、獨立狀態、雙 tab／reload、stderr／exit、opaque Worker／CSP／已提交 Stop、無限迴圈 Stop、限制、模式 UI、手機）；報告為 `test-results/shell-runtime-browser.json`，手機截圖為 `shell-runtime-mobile.png`。Stop 測試先確認原生 IDB 寫入已提交，再停止 Worker，不以固定延遲推測寫入完成。

P3 本輪正式 UI runner 也已在 `/agent-go-round/` 通過同 10 項，`verify:dist` 在 `/` 與該 base path 通過；cross-origin embed runner 的 native／無 randomUUID 兩種模式通過，包含 opaque Worker、原生 IDB 已提交內容、Stop／late write 拒絕、預覽與 reload。embed runner 報告為 `test-results/embed-vfs-browser.json`。最後一次 unit suite 為 29 檔／169 項通過，production build 內含 typecheck；CSS／說明的後續整理亦完成 production build 驗證。

## P4／P5 完成內容

原生 `bash` 不由可編輯的 ~/bin JS 提供，使用與人類相同的 ShellRuntime、opaque Worker、adapter 與限制。`{script, timeoutMs?, maxOutputBytes?, maxSteps?}` 回傳 stdout／stderr／exitCode／實際 cwd；非零 exitCode 保留為 shell 結果。agent cwd 與人類 shell 分開保存，同一 run 後續相對 read／write／edit 會使用 bash 回傳的 cwd。schema 拒絕超出上限與未宣告選項，同名自訂 bash tool 明確衝突。

`withAccessRecorder` 是共享同一 storage 的 run context，不是全域 observer 或另一份檔案樹。讀取在交易內取得 path／revision；寫入只在 commit 後依同一交易的最終 metadata 發出，copy／rename 子樹、父目錄更新、刪除與 rollback 均有測試。不以操作後另一次 stat 推測當時版本。Scoped recorder 不互相繼承或洩漏其他 run 的事件。

`readBytes`／metadata 紀錄沒有 readRange，不能證明模型收到全文；結構化 read 仍依成功回傳內容另記範圍。Stop 關閉 Worker／RPC，已 dispatch 的交易仍可能完成；其 audit callback 捕捉原 session／run／tool-call identity，即使新的 run 已開始，仍歸屬原 run。未知副作用停止模型自動 follow-up，reload／reconnect 僅恢復對話並等待使用者下一輪，不重播 script。

新增 `fs-trace.test.ts`、`bash-tool.test.ts` 共 11 項，包含 native-like delayed transaction completion：先提交 revision 3，再讓其他 context 寫成 revision 4，最後交付的舊 recorder 仍記錄 3。Memory 與 IndexedDB 的並行 context、copy／rename、quota rollback、metadata-only 存取、bash／結構化工具／skill 引用交叉使用、宿主／agents source identity 與取消後的原 run 歸屬均有證據。

非瀏覽器 SDK harness 必須明確注入 ShellExecutor，產品沒有宿主 shell fallback。Node live acceptance harness 明確使用相同 engine／adapter；真正 Worker 的證據由 browser runner 提供。

其餘 runners 已去除舊大小寫／JSON CLI／editor 入口。host／tabs 與 AI bash 使用本機 HTTP／SSE fixture 驅動真正 provider adapter、Pi loop、sandbox、native IDB；preview 預設 fixture，設定 AGENT_GO_ROUND_RUN_GROQ=1 才使用外部 Groq。jokes live runner 也已改用 shell 寫入、New conversation／模式 UI 及 bytes-v2 讀回；本輪沒有執行外部模型。

## 本輪最終驗證

| Gate | 結果／證據 |
|---|---|
| npm test | 31 檔、180 項通過；普通 suite 不呼叫外部模型 |
| typecheck／build | 通過；production base `/` 與 `/agent-go-round/` 均成功 |
| licenses:generate／verify:dist | 163 production dependencies 全文與 notices；兩種 base 均通過 |
| test:shell:browser | `/` 與 `/agent-go-round/` 各 10 項通過 |
| test:agent:bash:browser | `/` 與 `/agent-go-round/` 各 3 組通過，每次 13 個實際 HTTP requests |
| test:bash:browser | 13 項通過，包括原生 IDB、binary、跨 surface 並行 80 次 append、exclusive create、quota rollback、reload |
| test:vfs:browser | 5 項通過；100 檔情境覆寫／ls -l 的正文讀取與 workspace scan 均為 0；串流 DOM／選取、skill 與 revision reload |
| test:embed:vfs:browser | `/agent-go-round/`，跨 origin，native／無 randomUUID 兩種模式通過；Worker、已提交 Stop、late write 拒絕、預覽與 reload |
| test:mobile:browser | 12 項通過；鍵盤／popup 幾何為 Chrome 模擬，不是 iPhone 實機 |
| test:host:browser | 5 組通過；真實 HTML 分頁、切換可見 tab 時原 source identity、bridge 拒絕、workspace 隔離、reload、無宿主錯誤 |
| test:tabs:browser | 2 組通過；各自 session、list／一次 send／同 ID read／精確轉述、target bash 寫入、reload 不重播與 request 失效 |
| test:preview:browser | 7 項通過；真實頁面修改／revision、active run 刷新、CSS、reload request history、page view 與 workspace 隔離 |
| 外部模型 smoke | 本輪未執行：test:groq、test:jokes、test:jokes:browser、preview live 均不列為通過 |

報告／截圖位於忽略追蹤的 `test-results/`；子路徑的本輪 reports 另存 `test-results/base-path/`，避免根路徑重跑覆蓋證據。AI 與 popup 截圖已視覺檢查。初期 runner 曾有舊輸出 channel／revision／隱藏 Workspace 選單斷言錯誤，修正後重跑；大量 browser 並行時也曾出現 target Worker outcome_unknown，獨立重跑通過，未把先前失敗計為通過或放寬產品限制。先完成 build 再執行 browser checks，避免測試中置換 dist 造成舊 chunk 404。

仍保留的已知限制是上方的 undici／guarded-fetch npm audit 告警、上游 browser codec／printf bytes 差異，以及本計畫已列為後續的完整互動 shell state、hard links、Node／Python／網路與人類 editor。公開網站 deploy 不在本次工作範圍，尚未發布新版。
