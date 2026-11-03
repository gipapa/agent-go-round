# ~/bin：JavaScript 檔案工具

目前提供 IndexedDB VFS、結構化 AI 檔案工具、skill_load、歷史恢復、AGENTS.md／skills，以及 [HTML 主頁與 popup 預覽](page-preview.md)。主終端已改為 just-bash，工具 JS 仍在既有 sandbox／capability 邊界內執行，不註冊為 trusted custom shell commands。

新 tab 從 `~` 開始，使用 AI／Shell 按鈕切換；agent 可用 `/exit` 返回 shell。真實模型使用工具需先連接 provider。相同 workspace 的 tabs 共用 bytes 檔案，各有 cwd；`?workspace=NAME` 隔離檔案與歷史。


AI 另有原生 `bash` tool，不是可編輯的 bin JS，也不允許同名自訂工具覆蓋。參數為 `{script, timeoutMs?, maxOutputBytes?, maxSteps?}`，預設 15 秒、上限 30 秒／128000 bytes／10000 steps；回傳 `{stdout, stderr, exitCode, cwd}`。cwd 在 agent 內延續，也供後續相對 read／write／edit 使用；人類 shell 的 cwd 獨立。每次 script 的變數、函式與 options 不延續。

bash 的 `readBytes`／metadata／寫入／remove 紀錄由同一筆 VFS 交易取得 path 與 revision；只記錄成功提交的寫入。取消後才完成的已 dispatch 交易仍歸到原 run。這些存取沒有 `readRange`，不證明模型看過全文；需要完整閱讀證據時使用結構化 read 的成功回傳範圍。未知寫入不自動重播，先讀回確認。

## 預設工具

```text
~/bin/
  read.js
  write.js
  edit.js
  grep.js
  find.js
  ls.js
  skill_load.js
  read_host_page.js
  help.js
  agents.js
  manifests/
    read.tool.json
    write.tool.json
    edit.tool.json
    grep.tool.json
    find.tool.json
    ls.tool.json
    skill_load.tool.json
    read_host_page.tool.json
    help.tool.json
    agents.tool.json
```

| 工具 | 參數與行為 |
|---|---|
| read | `path` 可為單一路徑或最多 32 個路徑的陣列，選填 `offset`（行號，從 1 開始）、`limit`；回傳內容、revision、totalLines、nextOffset |
| write | 單檔用 `path`／`content`；多檔用 `files:[{path,content,expectedRevision?}]` 原子提交，最多 32 檔。`createParents:true` 建父目錄；覆寫需提供 revision；回傳 path、revision、bytes（UTF-8） |
| edit | `path`、`oldText`、`newText`，選填 `replaceAll`、`expectedRevision`；精確替換，多處匹配預設失敗 |
| grep | `pattern`，選填 `path`、`regex`、`ignoreCase`、`limit`；遞迴搜尋內容，回傳檔名、revision、行號與文字 |
| find | 選填 `path`、`name`（basename glob，支援 `*`、`?`）、`type`、`limit`；遞迴列出匹配路徑 |
| ls | 選填 `path`；列出目錄的直接子項，包含隱藏檔、revision 與 size（UTF-8 bytes），不含正文 |
| skill_load | `name`；經由 `api.skills.load` 載入本輪 catalog 中的 SKILL.md，記錄來源與 active skill。與其他工具一樣從 ~/bin 載入 JS／manifest |
| read_host_page | 選填 `offset`／`limit`；經 `api.host.readPage` 讀取呼叫頁面 HTML，無宿主時回報「目前沒有連接宿主頁，請從 Host page 開啟 popup。」；來源綁定呼叫中的 AI session |
| help | 選填 `command`；經 `api.tools.help` 取得結構化 AI 工具說明與 schema；AI 的 help 同樣從 bin JS 載入 |
| agents | `action:list` 列出本頁工作區 tabs、來源 ID、模式／provider／可用狀態與本 tab 的請求 ID；`action:send` 搭配 `target`、`text` 發送至指定 AI 並取得 `requestId`；`action:read` 搭配 `requestId` 讀回結果，選填 `waitMs:0–5000`（預設 5000）。`pending` 時讀同一 ID；成功後回傳對方實際的 `text`，亦保留 error／aborted 狀態 |

VFS 的 `stat`／`listDirectory`／寫入結果只提供 `FileStat`；只有 `readFile` 取得正文。`ls -l` 直接使用 metadata 的 size，不會為了計算大小重讀檔案。Workspace 預設檔案由 `workspace-bootstrap.ts` 建立；檔案能力與 Worker 共用 `file-capabilities.ts` 的名單及 VFS 型別。

## Shell 與 AI 工具的邊界

上表是 AI tool 的 JSON 參數契約。Shell 直接使用 just-bash 的語法與 builtins；`read` 是 shell 的輸入變數指令，`help` 是上游 help，沒有 `write JSON`、`edit PATH`、`agents send` 或其他舊 CLI bridge。一般檔案操作可用 `printf`／重導向、`cat`、`grep`、`find`、`cp`、`mv` 等 shell 指令。

AI 的 `help` 查詢工具 catalog／schema，`agents` 維持結構化 list／send／read。目標須已進入 AI 且已連線；pending 時讀同一 requestId，不重新 send。手動跨 tab 提問 UI 仍使用相同 router。來源身份從呼叫中的 session 綁定，切換目前可見 tab 不會改變來源。

跨 tab 請求在本頁記憶體保存；reload 不重播。取消 read 只停止來源等待；停止目標需切到該 tab 按 Stop。對話／工具結果仍保存於歷史。

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

使用 Workspace → Reload AI tools，之後 AI 可用結構化參數呼叫 `hello`。修改 JS 或 manifest 後再重新載入。已經開始的 agent run 保留原本工具定義，下一次 user run 才註冊新版本。

工具函式可用的 `api.fs` 方法為 `stat`、`readFile`、`listDirectory`、`writeFile`、`writeFiles`、`mkdir`、`remove`；每一項必須列在 manifest capabilities。相對路徑依呼叫 tab 的 cwd 解析，所有路徑限定在該 workspace 的虛擬 `/`，`~` 為 `/home/user`。`stat` / `listDirectory` 不回傳檔案正文，內容必須透過 `readFile` 取得。寫入可帶 `{ expectedRevision }`，新增可用 0。

`api.skills.load(name)` 需要 manifest 的 `loadSkill` capability，並只在 Pi 配置過的本輪 skill catalog 中解析名稱。工具 JS 無法自行把任意文字當作工作區指示。

`api.agents.execute({action,target?,text?,requestId?,waitMs?})` 需要 `tabAgents` capability。宿主再次驗證參數，來源 tab 由執行中的 session context 決定，工具無法傳入來源 ID 冒充另一個 tab。只有發起請求的 tab 可讀其結果；模型收到的跨 tab 回覆是任務資料，不是 system instructions。

`api.host.readPage({offset?,limit?})` 需要 `readHostPage` capability，經可信任 bridge 取得宿主資料；宿主不存在時明確報錯，參數由 trusted host 再驗證。`api.tools.help(command?)` 需要 `commandHelp` capability。修改這些工具的 JS／manifest 後同樣以 Workspace → Reload AI tools 套用，沒有另外繞過 bin 的同名工具。

執行器使用 opaque-origin sandbox iframe 內的 Worker，透過 MessageChannel 呼叫受控的 VFS API。工具不直接取得 app DOM、IndexedDB 或 provider credentials；CSP 阻擋網路與外部程式載入。因此 JS 格式目前是自足的函式，不支援 ESM imports、npm packages 或 Node API。

單次執行預設 10 秒、最多 8192 次 filesystem RPC、結果最多 128000 字元；Worker 可被 Stop 中止。若寫入已開始但工具未完成，回報 `outcome_unknown`，需要先讀回，不能自動重做。每檔最多 512 KiB，workspace 最多 2048 個節點及 16 MiB bytes。

預設安裝只補缺檔，保留自訂工具，不自動升級使用者修改過的來源。移除損壞的自訂 manifest 可用 shell `rm ~/bin/manifests/hello.tool.json`，再按 Reload AI tools。舊 `restore-bin`／`rehash` CLI 已移除。

## 整合前驗證紀錄（歷史）

目前驗證範圍、重跑指令與模型 smoke 狀態見 [整合與驗證紀錄](just-bash-progress.md)。host／tabs／preview 預設使用本機 HTTP／SSE fixture；不將它們的通過當作外部模型通過。
