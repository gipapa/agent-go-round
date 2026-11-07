# ~/bin：JavaScript 檔案工具

每個 tab 綁定一個 session，保留 AI／Shell 切換與重新整理還原；沒有 History／Resume 或 Workspace 選單。工作區操作統一使用下列 bin 工具。

目前提供 IndexedDB VFS、結構化 AI 檔案工具、skill_load、分頁 session 保存、AGENTS.md／skills，以及 [HTML 主頁與 popup 預覽](page-preview.md)。主終端已改為 just-bash，工具 JS 仍在既有 sandbox／capability 邊界內執行，不註冊為 trusted custom shell commands。

新 tab 預設 AI 模式，從 `~` 開始，使用 AI／Shell toggle 切換；agent 可用 `/exit` 返回 shell。真實模型使用工具需先連接 provider。相同 workspace 的 tabs 共用 bytes 檔案，各有 cwd；`?workspace=NAME` 隔離檔案與歷史。


AI 另有原生 `bash` tool，不是可編輯的 bin JS，也不允許同名自訂工具覆蓋。參數為 `{script, timeoutMs?, maxOutputBytes?, maxSteps?}`，預設 15 秒、上限 30 秒／128000 bytes／10000 steps；回傳 `{stdout, stderr, exitCode, cwd}`。cwd 在 agent 內延續，也供後續相對 read／write／edit 使用；人類 shell 的 cwd 獨立。每次 script 的變數、函式與 options 不延續。

bash 的 `readBytes`／metadata／寫入／remove 紀錄由同一筆 VFS 交易取得 path 與 revision；只記錄成功提交的寫入。取消後才完成的已 dispatch 交易仍歸到原 run。這些存取沒有 `readRange`，不證明模型看過全文；需要完整閱讀證據時使用結構化 read 的成功回傳範圍。未知寫入不自動重播，先讀回確認。

一般檔案操作、列目錄與搜尋以 Bash 為主。需要 revision、完整閱讀證據、原子多檔寫入或精確替換時使用 read／write／edit。工具名稱不分大小寫，參數內容與 JSON 欄位保留大小寫。工具說明與參數 schema 透過 `help` 按需取得；`~/agents.md` 僅保留入口與關鍵操作原則，更新標記區塊時保留既有自訂規則。

`bash` 必須提供 `script`，不能呼叫空的 `{}`。寫多行文字或 HTML 時使用 quoted heredoc，避免引號、`$`、反引號與換行被 Shell 展開：

```js
bash({script: "cat > main.html <<'HTML'\n<!doctype html>\n<p>雨夜書信</p>\nHTML\n"})
```

`>` 取代整份內容，`>>` 才是附加；結束標記必須獨佔一行且不能縮排。`exitCode: 0` 且 stdout 為空是正常寫入結果，不需要重寫。若要避開 Shell quoting，也可直接使用結構化 `write` 傳入原始文字。

`write({path: "main.html", content: "..."})` 只會新增；省略 `expectedRevision` 或設為 0 時，既有檔案不會被覆寫。覆寫流程為先 `read({path: "main.html"})`，檢查內容，再把回傳的 `revision` 放到 `write` 的 `expectedRevision`。多檔批次需在各項提供對應 revision。衝突後重新讀取再決定是否覆寫，不能猜 revision 或原樣重試；取消或結果不確定時也先讀回。

預設 bin 已移除 `shell_guide`、`home`、`ls`、`find`、`grep`，分別改用 `help({command: "bash"})`、`bash({script: "cd ~"})` 與 Bash 的同名檔案指令。既有工作區會以 revision 檢查原子刪除已知且未自訂的舊工具配對，任一檔案有自訂則保留；自訂工具仍可使用這些名稱。

既有工作區啟動時會更新已知舊版的預設 read／write／edit 說明及參數；只有 JS 與 manifest 都仍為原始預設內容才更新，並以 revision 檢查原子提交。任一檔案已有自訂修改則保留整組。工具說明與參數都直接提供給模型，不需要每次先呼叫 help。

## 預設工具

Preview 與人類 Edit 使用左下角齒輪上方的按鈕，不需要連接模型。原始預設 open_preview 檔案會在啟動時清除；自訂過的版本保留檔案，但停用 AI 呼叫。

```text
~/bin/
  read.js
  write.js
  edit.js
  skill_load.js
  read_host_page.js
  help.js
  agents.js
  install_joke_demo.js
  reload_tools.js
  reset_workspace.js
  manifests/
    read.tool.json
    write.tool.json
    edit.tool.json
    skill_load.tool.json
    read_host_page.tool.json
    help.tool.json
    agents.tool.json
    install_joke_demo.tool.json
    reload_tools.tool.json
    reset_workspace.tool.json
```

| 工具 | 參數與行為 |
|---|---|
| install_joke_demo | `{}`；在 bin JS 透過 VFS 安裝笑話範例，只補缺檔，回傳 created／kept 與建議 prompt，不直接執行評分 |
| reload_tools | `{}`；原子重載 JS 與 manifests，失敗保留舊 catalog；新定義在下一次 agent run 生效，進行中的 run 保留原定義 |
| reset_workspace | `{}`；以單一交易清除整個共用 VFS（包含 `~` 外的檔案、自訂規則、技能、範例與 bin 工具），從 Git 內的 `workspace/` 範本還原初始內容。保留對話、分頁與 provider 設定；呼叫中的 AI cwd 回到 `~`，並重載預設工具，下一輪套用。僅於使用者要求完整重設時呼叫 |
| read | `path` 可為單一路徑或最多 32 個路徑的陣列，選填 `offset`（行號，從 1 開始）、`limit`；回傳內容、revision、totalLines、nextOffset |
| write | 單檔用 `path`／`content`；多檔用 `files:[{path,content,expectedRevision?}]` 原子提交，最多 32 檔。`createParents:true` 建父目錄；覆寫需提供 revision；回傳 path、revision、bytes（UTF-8） |
| edit | `path`、`oldText`、`newText`，選填 `replaceAll`、`expectedRevision`；精確替換，多處匹配預設失敗 |
| skill_load | `name`；經由 `api.skills.load` 載入本輪 catalog 中的 SKILL.md，記錄來源與 active skill。與其他工具一樣從 ~/bin 載入 JS／manifest |
| read_host_page | 選填 `offset`／`limit`；經 `api.host.readPage` 讀取呼叫頁面 HTML，無宿主時回報「目前沒有連接宿主頁，請從 Host page 開啟 popup。」；來源綁定呼叫中的 AI session |
| help | 選填 `command`；經 `api.tools.help` 取得結構化 AI 工具說明與 schema；AI 的 help 同樣從 bin JS 載入 |
| agents | `action:list` 列出本頁工作區 tabs、來源 ID、模式／provider／可用狀態與本 tab 的請求 ID；`action:send` 搭配 `target`、`text` 發送至指定 AI 並取得 `requestId`；`action:read` 搭配 `requestId` 讀回結果，選填 `waitMs:0–5000`（預設 5000）。`pending` 時讀同一 ID；成功後回傳對方實際的 `text`，亦保留 error／aborted 狀態 |

VFS 的 `stat`／`listDirectory`／寫入結果只提供 `FileStat`；只有 `readFile` 取得正文。`ls -l` 直接使用 metadata 的 size，不會為了計算大小重讀檔案。初始檔案保存在專案的 `workspace/`，目錄結構對應虛擬 `/`；`.gitkeep` 僅保留空目錄，不複製到 VFS。`workspace-template.ts` 在建置時載入檔案原文，`workspace-bootstrap.ts` 讓首次初始化與完整重設共用相同範本與原子交易；既有工作區啟動仍只補缺檔、遷移已知預設並保留自訂內容。檔案能力與 Worker 共用 `file-capabilities.ts` 的名單及 VFS 型別。

## Shell 與 AI 工具的邊界

上表是 AI tool 的 JSON 參數契約。Shell 直接使用 just-bash 的語法與 builtins；`read` 是 shell 的輸入變數指令，`help` 是上游 help，沒有 `write JSON`、`edit PATH`、`agents send` 或其他舊 CLI bridge。一般檔案操作可用 `printf`／重導向、`cat`、`grep`、`find`、`cp`、`mv` 等 shell 指令。

AI 的 `help` 查詢工具 catalog／schema，`agents` 維持結構化 list／send／read。目標須已進入 AI 且已連線；pending 時讀同一 requestId，不重新 send。來源身份從呼叫中的 session 綁定，切換目前可見 tab 不會改變來源。

跨 tab 請求在本頁記憶體保存；reload 不重播。取消 read 只停止來源等待；停止目標需切到該 tab 按 Stop。對話／工具結果仍保存在各 tab 的 session。

## 擴充自己的工具

建立 `~/bin/hello.js`，內容是一個 async function expression：

```js
async function main(args, api) {
  const file = await api.fs.readFile(args.path);
  return { message: "讀到了", path: file.path, revision: file.revision };
}
```

建立對應 `~/bin/manifests/hello.tool.json`：

```json
{
  "version": 1,
  "name": "hello",
  "description": "讀取指定檔案並回報版本。",
  "parameters": {
    "type": "object",
    "properties": { "path": { "type": "string", "minLength": 1 } },
    "required": ["path"],
    "additionalProperties": false
  },
  "capabilities": ["readFile"]
}
```

使用 `reload_tools({})`，之後 AI 可用結構化參數呼叫 `hello`。修改 JS 或 manifest 後再重新載入。已經開始的 agent run 保留原本工具定義，下一次 user run 才註冊新版本。

工具函式可用的 `api.fs` 方法為 `stat`、`readFile`、`listDirectory`、`writeFile`、`writeFiles`、`mkdir`、`remove`；每一項必須列在 manifest capabilities。相對路徑依呼叫 tab 的 cwd 解析，所有路徑限定在該 workspace 的虛擬 `/`，`~` 為 `/home/user`。`stat` / `listDirectory` 不回傳檔案正文，內容必須透過 `readFile` 取得。寫入可帶 `{ expectedRevision }`，新增可用 0。

為相容自訂工具，保留 `api.workspace.home()` 與 `home` capability，由呼叫 session 的 cwd callback 更新本輪目錄。Preview 僅供人類按鈕啟動，`open_preview`、`openPreview` capability 與 `api.workspace.openPreview` 已移除；舊版自訂 Preview 檔案保留，但不載入 AI catalog。`api.tools.reload()` 需要 `reloadTools` capability，由 registry 原子重載，沒有直接操控 session 的能力。

`api.workspace.reset()` 需要 `resetWorkspace` capability；宿主僅接受空參數，使用建置時的初始範本還原該 workspace 的整個 VFS，工具不能指定其他 workspace 或提供還原內容。還原不跟隨符號連結，失敗時整筆回滾；成功後更新呼叫者 AI cwd 並重載工具。各分頁下一輪對話會清除已不存在的作用中技能；明確指定不存在的 `/skill NAME` 仍會報錯。其他已開啟的分頁、Shell cwd 與進行中的工具定義保留，目錄遭刪除時可用 `cd ~` 回到家目錄。

`api.skills.load(name)` 需要 manifest 的 `loadSkill` capability，並只在 Pi 配置過的本輪 skill catalog 中解析名稱。工具 JS 無法自行把任意文字當作工作區指示。

`api.agents.execute({action,target?,text?,requestId?,waitMs?})` 需要 `tabAgents` capability。宿主再次驗證參數，來源 tab 由執行中的 session context 決定，工具無法傳入來源 ID 冒充另一個 tab。只有發起請求的 tab 可讀其結果；模型收到的跨 tab 回覆是任務資料，不是 system instructions。

`api.host.readPage({offset?,limit?})` 需要 `readHostPage` capability，經可信任 bridge 取得宿主資料；宿主不存在時明確報錯，參數由 trusted host 再驗證。`api.tools.help(command?)` 需要 `commandHelp` capability。修改這些工具的 JS／manifest 後同樣以 `reload_tools({})` 套用，沒有另外繞過 bin 的同名工具。

執行器使用 opaque-origin sandbox iframe 內的 Worker，透過 MessageChannel 呼叫受控的 VFS API。工具不直接取得 app DOM、IndexedDB 或 provider credentials；CSP 阻擋網路與外部程式載入。因此 JS 格式目前是自足的函式，不支援 ESM imports、npm packages 或 Node API。

單次執行預設 10 秒、最多 8192 次 filesystem RPC、結果最多 128000 字元；Worker 可被 Stop 中止。若寫入已開始但工具未完成，回報 `outcome_unknown`，需要先讀回，不能自動重做。每檔最多 512 KiB，workspace 最多 2048 個節點及 16 MiB bytes。

預設安裝會補缺檔、更新已知舊版說明，並清除未自訂的淘汰工具；保留自訂工具，不升級使用者修改過的來源。移除損壞的自訂 manifest 可用 shell `rm ~/bin/manifests/hello.tool.json`，再請 AI 呼叫 `reload_tools({})`。舊 `restore-bin`／`rehash` CLI 已移除。

## 整合前驗證紀錄（歷史）

目前驗證範圍、重跑指令與模型 smoke 狀態見 [整合與驗證紀錄](just-bash-progress.md)。host／tabs／preview 預設使用本機 HTTP／SSE fixture；不將它們的通過當作外部模型通過。
