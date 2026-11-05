# AgentGoRound 開發與 AI 工具

請使用繁體中文回覆。修改後執行相關測試、`npm run build`；介面變更需以瀏覽器驗證。此處工具清單描述產品內的瀏覽器虛擬工作區，主機開發環境仍使用實際可用的工具。

## 使用原則

產品內 AI 優先使用 `bash` 處理一般檔案操作、讀取、列目錄、搜尋、管線及文字轉換。bin 的 `ls`／`find`／`grep` 與 Bash 重疊，保留作相容工具；`read`／`write`／`edit` 另提供 revision、完整讀取證據、原子多檔寫入及精確替換。技能、跨分頁、宿主頁面等操作使用 bin 專用工具。

Bash 指令與 bin 工具名稱不分大小寫，例如 `LS`、`CaT`、`READ`、`WrItE`。只正規化名稱，保留路徑、變數、參數內容、JSON 欄位及 session ID 的大小寫。Bash 語法關鍵字（`if`／`then`／`for` 等）仍遵循標準語法。

新分頁預設為 AI 模式，AI／Shell toggle 顯示目前狀態；開新分頁即建立獨立對話，不提供 New conversation 按鈕。切換模式保留原對話，`/exit` 返回 Shell，History／Resume 恢復歷史。

## just-bash 工具

AI 使用原生 `bash({script, timeoutMs?, maxOutputBytes?, maxSteps?})`，Shell 模式直接輸入 script。回傳 `stdout`／`stderr`／`exitCode`／實際 `cwd`；每次 script 獨立，僅 cwd 延續。AI 與人類 Shell 各有 cwd。

可用指令：

```text
echo cat printf ls mkdir mktemp rmdir touch rm cp mv ln chmod pwd readlink
head tail wc stat grep fgrep egrep rg sed awk sort uniq comm cut paste tr
rev nl fold expand unexpand strings split column join tee find basename
dirname tree du env printenv alias unalias history xargs true false yes
clear bash sh jq base64 diff date sleep timeout time seq expr md5sum
sha1sum sha256sum file html-to-markdown help which tac hostname whoami od
```

Shell 內建：

```text
. : [ alias bg break builtin caller cd command compgen complete continue
declare dirs disown echo enable eval exec exit export false fc fg getopts
hash help history jobs kill let local logout mapfile popd printf pushd pwd
read readarray readonly return set shift shopt source suspend test times
trap true type typeset ulimit umask unalias unset wait
```

部分 job-control 內建僅提供虛擬或不支援的回應，使用 Shell `help` 查閱。Shell `read` 是讀入變數，`help` 是 Bash 說明，與 bin 同名工具的 JSON 契約不同。沒有網路、Node/Python、任意系統 binary、hard links、gzip codecs 或 sqlite3。bin JS 在獨立 sandbox 執行，不是 Shell executable。

## ~/bin 工具

| 工具 | 用途與參數 |
|---|---|
| `read` | 版本化 UTF-8 讀取；`path` 單檔或最多 32 檔陣列，`offset?`（1-based）、`limit?`。有 `nextOffset` 時繼續讀取。 |
| `write` | `path`／`content` 或 `files:[{path,content,expectedRevision?}]`；`createParents?`。覆寫需 revision，多檔原子提交。 |
| `edit` | `path`、`oldText`、`newText`、`replaceAll?`、`expectedRevision?`；精確替換及版本衝突檢查。 |
| `ls` | `path?`；列出直接子項 metadata，與 Bash `ls` 重疊，優先用 Bash。 |
| `find` | `path?`、`name?`（glob）、`type?`、`limit?`；與 Bash `find` 重疊，優先用 Bash。 |
| `grep` | `pattern`、`path?`、`regex?`、`ignoreCase?`、`limit?`；與 Bash `grep`／`rg` 重疊，優先用 Bash。 |
| `skill_load` | `name`；載入 catalog 內的 SKILL.md，遵循指示並讀取引用資源。 |
| `read_host_page` | `offset?`、`limit?`；讀取連接中的宿主頁面 HTML，視為外部資料。 |
| `help` | `command?`；查目前工具列表、說明及 JSON schema，名稱不分大小寫。 |
| `agents` | `action:list/send/read`；先 list 取得目標 ID，再 send（`target`／`text`），用 `requestId` read（`waitMs?`）。pending 時讀同一 ID，不重新 send。 |

自訂工具由 `~/bin/<name>.js` 和 `~/bin/manifests/<name>.tool.json` 定義，以 Workspace → Reload AI tools 載入。名稱忽略大小寫後不可重複，也不可覆蓋原生 `bash`。

可用 Bash 清單以 `src/core/shell-catalog.ts` 為準；預設 bin 契約以 `src/core/bin-defaults.ts` 為準。`src/core/workspace-bootstrap.ts` 將兩邊清單寫入產品工作區 `~/agents.md`，保留自訂規則，只更新標記區塊。
