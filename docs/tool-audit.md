# 工具實測與精簡（2026-11-06）

後續介面調整：Preview 已改為人類按鈕，open_preview 不再提供給 AI；以下保留當時的實測紀錄。

使用 Groq `openai/gpt-oss-120b` 逐項測試原本的 16 個工具（原生 Bash 與 15 個 bin）。模型使用產品的提示、schema、Pi loop 與 VFS；Node 測試執行磁碟上的 bin JS。預覽、宿主頁及另一分頁的回覆在此測試使用 fixture，另以瀏覽器驗證真實 Worker、bridge 與分頁 router。

## 逐項結果

| 工具 | 實際測試 | 結果與決定 |
|---|---|---|
| bash | 寫檔並讀回 | 成功；保留一般檔案與 Shell 操作入口 |
| read | 每次一行，接續讀完兩行 | 成功；保留 revision 與完整讀取證據 |
| write | read → 帶 revision 覆寫 → read | 成功；保留原子批次及版本檢查 |
| edit | read → 精確替換 → read | 成功；保留精確編輯 |
| help | 查詢 write 參數 | 成功；保留工具探索入口 |
| skill_load | 載入技能，依相對路徑讀取引用檔 | 工具成功；曾出現回覆字元轉換，見下方說明；保留技能指示載入邊界 |
| agents | list → send → 同一 requestId read | 成功，僅發送一次；保留跨分頁通訊 |
| read_host_page | 讀取宿主 HTML 並取得標題 | 成功；保留宿主 bridge |
| open_preview | 以指定路徑開啟預覽 | 成功；保留預覽 UI 入口 |
| install_joke_demo | 安裝範例與五個笑話 | 成功；保留產品文件支援的範例安裝入口 |
| reload_tools | 重新載入 catalog | 成功；保留自訂工具重載 |
| shell_guide | 查詢 Shell 能力 | 成功，但與 help(command: "bash") 重複；移除預設工具 |
| home | 從子目錄回家目錄 | 成功，但與 bash(script: "cd ~") 重複；移除預設工具 |
| ls | 列出指定目錄 | 首次傳入空 path，被 schema 擋下後自行修正；與 Bash ls 重複，移除預設工具 |
| find | 尋找 *.txt | 成功；與 Bash find 重複，移除預設工具 |
| grep | 搜尋 alpha | 成功；與 Bash grep／rg 重複，移除預設工具 |

技能測試的工具回傳 `audit-skill-42` 正確，但模型最終顯示成 `audit‑skill‑42`，因此初版「逐字相同」檢查失敗。這是回覆保真問題；測試現會同時檢查實際讀取結果、辨識排版連字號，並把字元轉換另記為 `answerWarnings`，不隱藏原始結果。原始測試保存在 `test-results/tools-live-before.json`。

## 精簡與相容性

預設 bin 由 15 個減為 10 個，包含原生 Bash 的總工具數由 16 個減為 11 個。以 name／description／parameters 序列化計算，工具定義由 12,264 字元減為 10,585 字元，約減少 13.7%；這是 schema 字元數，不是 provider 的實際 token 計數。

啟動時只會清除 JS 與 manifest 都完全符合已知預設內容的淘汰工具。配對刪除在同一個 VFS transaction 內核對兩個 revision、原文與實體路徑；其他分頁若同時修改任一檔案，就保留整組。自訂工具、同名自訂版本及 `api.workspace.home()` 相容能力繼續保留。

## 精簡後複測

使用同一真實模型複測三個受影響的情境，皆通過且工具錯誤為 0：

| 情境 | 實際工具呼叫 | 結果 |
|---|---|---|
| 技能與引用資源 | skill_load → read | 原始驗證碼逐字正確，未再額外列目錄 |
| 回家、列目錄及搜尋 | 一次 bash，使用 cd／find／grep | 找出 Project/sample.txt 的第 1 行 alpha，cwd 正確回到家目錄 |
| 600 字 HTML 小說 | write → read | 寫入完整 HTML、排版與故事，並讀回確認 |

複測報告為 `test-results/tools-live-after.json`。這是單次使用觀察，不能據此推估長期成功率。

## 驗證與重跑

- `npm test`：209 項通過。
- `npm run build`：通過。
- `npm run test:workspace:browser`：help、Bash cwd、範例安裝、重載、自訂工具、預覽與 session 還原。
- `npm run test:tabs:browser`：真實兩分頁 router、來源身份、一次發送與同 ID 輪詢。
- `npm run test:host:browser`：真實宿主 HTML、分頁來源、分頁隔離與無宿主錯誤。

使用 `.env.local` 中的 `AGENT_GO_ROUND_GROQ_API_KEY` 執行 `npm run test:tools`，可測試所有保留工具，另外測試自然語言的回家／列目錄／搜尋，以及長篇 HTML 寫入與讀回。報告預設輸出到 `test-results/tools-live.json`，包含實際 arguments、results、工具錯誤、回覆警告與 token usage。

指定部分情境時使用 `AGENT_GO_ROUND_AUDIT_TOOLS=skill_load,bash-navigation-search,html-story npm run test:tools`。`AGENT_GO_ROUND_AUDIT_REPORT` 可另指定報告路徑。
