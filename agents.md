# AgentGoRound 開發與 AI 工具

請使用繁體中文回覆。修改後執行相關測試與 `npm run build`；介面變更需以瀏覽器驗證。以下描述產品內的瀏覽器虛擬工作區；主機開發仍使用實際可用的工具。

## 必要規則

- 產品 AI 優先使用 `bash` 處理一般檔案操作；需要 revision、完整讀取證據、原子多檔寫入或精確替換時用 `read`／`write`／`edit`。技能、跨分頁、宿主頁面用專用工具。
- 指令與工具名稱不分大小寫；路徑、變數、參數、JSON 欄位與 session ID 保留大小寫。Bash 語法關鍵字遵循標準語法。
- Shell 與 AI 各有 cwd；每次 script 獨立，僅 cwd 延續。bin JS 是結構化工具，不能當 Shell executable。
- 新分頁預設 AI 並建立獨立對話；AI／Shell toggle 保留對話，`/exit` 返回 Shell，History／Resume 恢復歷史。不提供 New conversation 按鈕。

## 按需查閱

產品 AI 用 `help({})` 查工具入口、`help({command: "工具名稱"})` 查用途與 JSON schema、`help({command: "bash"})` 查指令／內建與限制；Shell 內建詳情用 `bash({script: "help"})`。技能使用前呼叫 `skill_load` 並讀取引用資源。

開發時依任務讀取原始定義，不在此重複完整清單：

- Bash 清單：`src/core/shell-catalog.ts`；參數與行為：`src/core/bash-tool.ts`、`src/core/shell-help.ts`。
- bin 契約：`src/core/bin-defaults.ts`；載入與執行：`src/core/bin.ts`；延伸說明：`docs/bin-tools.md`。
- 預設 `~/agents.md`：`src/core/workspace-bootstrap.ts`；只更新標記區塊，保留自訂規則。
- 系統提示、階層規則與技能探索：`src/core/file-context.ts`。

自訂工具放在 `~/bin/<name>.js` 與 `~/bin/manifests/<name>.tool.json`，修改後使用 Workspace → Reload AI tools；名稱忽略大小寫後不可重複或覆蓋原生 `bash`。
