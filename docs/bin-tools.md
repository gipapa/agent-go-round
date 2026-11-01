# ~/bin：JavaScript 檔案工具

已實作：IndexedDB VFS、檔案工具與 skill_load 的 JS 執行、shell／文字編輯器／Pi、歷史恢復、AGENTS.md 與檔案式 skill discovery，以及 [HTML 主頁與 popup 預覽](page-preview.md)。

新 tab 從 `~` 開始。`ai` 進入 agent，`/exit` 回 shell；demo provider 只提供 scripted 文字，真實模型使用工具需先在 settings 連接 Groq。檔案都在瀏覽器 IndexedDB，同一個 workspace 的 app tabs 共用檔案，各有自己的 cwd；預設 workspace 為 `default`。UI/session、檔案與 lifecycle 均保存到 IndexedDB；API key 與少量 provider 偏好維持獨立設定。URL 可帶 `?workspace=NAME` 使用不同工作區（英數字、底線或連字號），各自隔離檔案與歷史。

## 預設工具

```text
~/bin/
  read.js       read.tool.json
  write.js      write.tool.json
  edit.js       edit.tool.json
  grep.js       grep.tool.json
  find.js       find.tool.json
  ls.js         ls.tool.json
  skill_load.js skill_load.tool.json
```

| 工具 | 參數與行為 |
|---|---|
| read | `path` 可為單一路徑或最多 32 個路徑的陣列，選填 `offset`（行號，從 1 開始）、`limit`；回傳內容、revision、totalLines、nextOffset |
| write | 單檔用 `path`／`content`；多檔用 `files:[{path,content,expectedRevision?}]` 原子提交，最多 32 檔。`createParents:true` 建父目錄；覆寫需提供 revision |
| edit | `path`、`oldText`、`newText`，選填 `replaceAll`、`expectedRevision`；精確替換，多處匹配預設失敗 |
| grep | `pattern`，選填 `path`、`regex`、`ignoreCase`、`limit`；遞迴搜尋內容，回傳檔名、revision、行號與文字 |
| find | 選填 `path`、`name`（basename glob，支援 `*`、`?`）、`type`、`limit`；遞迴列出匹配路徑 |
| ls | 選填 `path`；列出目錄的直接子項，包含隱藏檔與 revision |
| skill_load | `name`；經由 `api.skills.load` 載入本輪 catalog 中的 SKILL.md，記錄來源與 active skill。與其他工具一樣從 ~/bin 載入 JS／manifest |

Shell 與 Pi 使用相同 BinRegistry、schemas、JS 與 filesystem API。Shell 是內建指令解析器；目前不支援 pipes、redirects 或作業系統程式。

Shell 指令名稱不分大小寫，例如 `LS`、`Read`、`AI --NEW`、`Preview`、`DeMo JoKeS` 都可使用，包含自訂 bin 工具。`restore-bin READ` 也接受大小寫混用；路徑、檔案內容、搜尋字串、JSON 欄位和 session ID 仍保留原本大小寫。

```text
ls ~/bin
mkdir jokes
write "jokes/笑話1.md" "今天的笑話"
read "jokes/笑話1.md"
edit "jokes/笑話1.md" "今天" "明天"
grep "笑話" jokes
find jokes "*.md"
cd jokes
pi
```

所有 bin 工具都可直接接受 JSON 參數，方便使用完整選項：

```text
write {"path":"main.html","content":"<h1>Hello</h1>"}
read main.html
write {"path":"main.html","content":"<h1>你好</h1>","expectedRevision":1}
edit {"path":"main.html","oldText":"你好","newText":"歡迎","expectedRevision":2}
grep {"pattern":"hello|welcome","regex":true,"ignoreCase":true,"path":".","limit":20}
```

## 擴充自己的工具

建立 `~/bin/hello.js`，內容是一個 async function expression：

```js
async function main(args, api) {
  const file = await api.fs.readFile(args.path);
  return { message: "讀到了", path: file.path, revision: file.revision };
}
```

建立對應 `~/bin/hello.tool.json`：

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

在 shell 執行 `rehash`，之後可用 `hello {"path":"main.html"}`；進入 Pi 後同樣能呼叫 `hello`。修改 JS 或 metadata 後再執行 `rehash`。已經開始的 agent run 保留原本工具定義，下一次 user run 才註冊新版本。

工具函式可用的 `api.fs` 方法為 `stat`、`readFile`、`listDirectory`、`writeFile`、`writeFiles`、`mkdir`、`remove`；每一項必須列在 manifest capabilities。相對路徑依呼叫 tab 的 cwd 解析，所有路徑限定在該 workspace 的 `~` 中。`stat` / `listDirectory` 不回傳檔案正文，內容必須透過 `readFile` 取得。寫入可帶 `{ expectedRevision }`，新增可用 0。

`api.skills.load(name)` 需要 manifest 的 `loadSkill` capability，並只在 Pi 配置過的本輪 skill catalog 中解析名稱。工具 JS 無法自行把任意文字當作工作區指示。

執行器使用 opaque-origin sandbox iframe 內的 Worker，透過 MessageChannel 呼叫受控的 VFS API。工具不直接取得 app DOM、IndexedDB 或 provider credentials；CSP 阻擋網路與外部程式載入。因此 JS 格式目前是自足的函式，不支援 ESM imports、npm packages 或 Node API。

單次執行預設 10 秒、最多 8192 次 filesystem RPC、結果最多 128000 字元；Worker 可被 Stop 中止。若寫入已開始但工具未完成，回報 `outcome_unknown`，需要先讀回，不能自動重做。每檔最多 512 KiB，workspace 最多 2048 個節點及 16 MiB 文字內容。

預設安裝補缺檔，並且只對逐字符合舊版內建 JS 與 manifest 的工具做原子升級，不覆蓋使用者修改的工具。工具損壞時，可用內建 `restore-bin read`（或其他預設工具名稱）重設其 JS 與 manifest；自訂 manifest 損壞時可 `rm ~/bin/hello.tool.json` 後 `rehash`。這些恢復命令由 shell 本身提供，不依賴損壞的工具。

## 驗證紀錄

- Regression 包含 IndexedDB reload／workspace 隔離／revision conflict、六工具與 Pi native loop、五檔讀取、新增 JS、capability 拒絕、取消後副作用分類與恢復命令。
- 本機 Chrome browser smoke 已跑六工具、動態 JS 擴充、網路／IndexedDB 隔離、無限迴圈 Stop、跨 app tabs 共用與 shell／Pi 切換。
- Production preview 已驗證 write／read／edit／grep、reload 後內容與 revision 保存，以及 390×844 手機寬度無水平溢出。`npm test`、`npm run build` 與 `npm run verify:dist` 通過。
- Groq `openai/gpt-oss-120b` 的五檔讀取、reload／重連後重新評分、agent 建立五檔並讀回已通過 SDK live runner；production browser 同三項使用 `qwen/qwen3.8-27b` 全數通過。報告與額度限制見 [笑話驗收](joke-acceptance.md)。
