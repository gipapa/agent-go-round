# 檔案式 Pi：笑話驗收

更新：2026-11-04。just-bash 版的外部模型 smoke 尚未執行；以下先前的模型結果不列為新版通過。先前版本的 SDK 與 production 瀏覽器三任務均曾通過；本輪加強架構驗收後，真實模型驗收尚未全數通過，最新結果與限制見「本輪架構審閱結果」。先前 SDK 使用 `openai/gpt-oss-120b`；瀏覽器使用 `qwen/qwen3.8-27b`。

## 自己操作

1. `npm run dev`，開啟顯示的 URL。新 tab 位於 `~`。
2. 新 workspace 已有空白 `~/skills/` 及內容為「請回覆繁體中文」的 `~/agents.md`。使用 Workspace → Install joke demo，建立示例 skill 與笑話：既有檔案不覆寫，也沿用同位置的小寫 `agents.md`／`skill.md`，避免建立大小寫重複檔；若有自己的規則或同名 skill，請另開 `?workspace=jokes-demo`。

```text
~/agents.md
~/skills/joke-master/SKILL.md
~/skills/joke-master/references/scoring.md
~/jokes/笑話1.md … 笑話5.md
~/bin/read.js、write.js、edit.js、grep.js、find.js、ls.js、skill_load.js
```

3. 在 provider settings 連接 Groq，按 AI，用英文詢問：

```text
Use the joke-master skill to read all five Markdown jokes in ~/jokes, score each one, and give me the funniest joke.
```

4. 查看中文答案、五筆評分與冠軍原文。介面列出本輪 AGENTS.md／skill／讀檔來源及 revision；工具結果可展開檢閱參數與原始內容。
5. `/exit` 回 shell，以 `printf`／重導向修改 `~/jokes/笑話1.md` → reload → reconnect → 按 AI。英文要求重新讀取五個檔案並評分，必須讀到新 revision。
6. `/exit` → 開啟新分頁，用英文請 agent 建立另一個目錄中的五個新笑話，逐檔讀回、評分、選出冠軍。新對話共用同一份 VFS；歷史接續在上一步驗證。`/exit` 後用 `ls`、`cat` 檢閱實際檔案。

History／Resume 恢復持久化對話，開啟新分頁 另起對話。關 tab 保留歷史；Groq reload 後等待重新連線，不把保存的 transcript 替換成空 runtime。Shell output 不自動塞進模型對話。

## 重跑指令

在未追蹤的 `.env.local` 設定 `AGENT_GO_ROUND_GROQ_API_KEY`，不要把 key 放進 VFS 或聊天。普通 `npm test` 不呼叫網路。

```sh
npm test
npm run build
npm run verify:dist
npm run test:jokes
```

SDK runner 使用真正 Groq adapter／Pi loop、IndexedDB（測試使用 fake-indexeddb）與 VFS 內的 JS；只有 Node 執行器以 VM 代替 browser sandbox。

正式瀏覽器 runner 使用 `agent-browser` CLI、真正瀏覽器 IndexedDB、opaque iframe／Worker、just-bash 與設定表單。先啟動 dev server；CLI 已在 PATH 時可直接執行，否則透過 `AGENT_BROWSER_CLI` 指定其 executable 或 JS 入口：

```sh
npm run test:jokes:browser
AGENT_BROWSER_CLI=/path/to/agent-browser.js npm run test:jokes:browser
AGENT_GO_ROUND_GROQ_MODEL=qwen/qwen3.8-27b npm run test:jokes:browser
AGENT_GO_ROUND_LANGUAGE_ONLY=1 npm run test:jokes:browser
```

可用 `AGENT_GO_ROUND_APP_URL` 指向 production preview。每次建立獨立 workspace，不覆寫原本工作區；key 只輸入 password field，取消 Remember，報告不記錄 credential。此可選腳本使用 Node 的 TypeScript stripping，需支援該功能的 Node 版本（目前驗證 Node 25）。

## 實際驗證內容

| 任務 | 通過條件 |
|---|---|
| 五個既有笑話 | 英文問題；本輪讀取 AGENTS.md、SKILL.md、scoring.md 和全部五個笑話；中文評分與原因；冠軍屬最高分且原文等於實際檔案 |
| 修改／reload／重連後重新評分 | Session identity 和過往 messages 保留；新 request 包含舊問題／回答；再次讀取五個檔案且 revision 與最新資料一致 |
| agent 自己建五檔再評分 | 五個獨立 .md 實際提交到 VFS；讀回每一檔後評分；shell 可檢閱；沒有以模型自稱完成代替寫入證據 |

評分屬主觀判斷，不固定哪一則必須獲勝；檔案集合、讀取版本、分數範圍、最高分、冠軍原文與中文說明都有程式斷言。漏讀任何一檔、讀舊版本、亂填分數、只回空白或截斷，都不能算 PASS。沒有額外 verifier agent 或隱藏的補做迴圈。

## 架構回歸檢查

驗收從 VFS 實際檔案取得規則、skill 與評分參考的路徑／revision；必須分別位於 `~/AGENTS.md`（或 `agents.md`）、`~/skills/joke-master/SKILL.md`（或 `skill.md`）及同 skill 目錄的 `references/scoring.md`。只有相同類型的 context event、錯誤位置或過期 revision 都不能通過。

`file_access` 原有的 RPC 紀錄繼續保留；工具成功回傳的內容經 host 與 VFS 原文核對後，才另留下帶 `readRange`（`startLine`／`endLine`／`totalLines`）的紀錄。驗收只採計成功工具所回傳的範圍，評分參考與五個笑話必須涵蓋全文且沒有分頁缺口。工具內部讀過卻沒回傳、只讀第一頁或讀取失敗，都不能作為完整閱讀證據。冠軍原文須逐字一致，包含首尾空白與換行。

`src/acceptance/joke-context.test.ts` 使用 IndexedDB、正式 context loader 與 VFS bin JS，驗證首輪只送 catalog、`skill_load` 後模型收到正文、205 行檔案的分頁讀取，以及恢復 session 後載入更新的 agents／skill／reference。這個離線測試使用 scripted provider；真實模型驗收另由 live runners 執行。舊報告未包含 `readRange`，無法直接當作此加強版驗收的通過證據，需重跑。

bash 會記錄實際 bytes 存取，但不產生全文 readRange；本驗收仍要求結構化 read 回傳完整內容。

## 歷史架構審閱結果（切換 just-bash 前）

離線回歸 136 項全數通過（包含預設檔案、交易回滾與多視窗初始化），typecheck／build／dist 檢查通過。已修正 demo 在存在小寫 agents／skill 檔時建立大寫重複檔的問題，並加上來源位置／revision、成功回傳的完整分頁與冠軍原文逐字比對。舊格式相容程式與專用測試已移除。

本輪實際從瀏覽器 VFS 的 read 工具讀取 AGENTS.md、SKILL.md 與 scoring.md，位置正確。真實模型結果須與載入機制的回歸結果分開判讀：

- GPT-OSS SDK：第一輪五檔評分與 reload／重連通過；第三輪建檔讀回時漏讀本輪 scoring.md，驗收正確拒絕。skill 已明確要求建立笑話也先讀準則；重跑前兩項通過，第三項遭 Groq 每日 token 額度拒絕，不能宣告修正後全數通過。
- GPT-OSS 瀏覽器：前兩項通過；第三項遇到 Groq TPM 限流，沒有計為通過。
- Qwen 瀏覽器：第一項通過；重新評分時仍漏讀本輪 scoring.md，驗收拒絕。每輪讀取參考檔的模型遵循仍不穩定。

上述真實模型報告產生於目錄搬移之前，記錄的是舊版 `~/.pi/skills` 路徑；新位置 `~/skills` 已經離線與 UI 回歸驗證，尚未重跑真實模型。

證據保留於 `test-results/jokes-live-architecture-review.json`、`jokes-live-architecture-review-retest.json`、`jokes-browser-architecture-review.json` 與 `jokes-browser-architecture-review-qwen.json`。未加入自動補做或放寬漏讀檢查；以下舊版成功紀錄僅代表當時的驗收結果。

## 報告與執行限制

先前 production 瀏覽器驗收於 `http://127.0.0.1:4173/` 執行，三項均 PASS：前兩項使用相同 session，messages 從 11 筆增加至 20 筆；修改後的笑話 revision 為 2。第三項明確另開 session、共用同一 workspace，留下五筆真實寫入與五筆讀回紀錄。390×844 寬度檢查亦通過。普通回歸測試共 82 項通過，build／typecheck／dist 檢查通過。

獨立語言規則驗收亦 PASS：新 workspace 只建立 AGENTS.md、沒有 skill，以英文詢問虛擬檔案系統，模型實際回覆繁體中文；該輪唯一 context source 為 AGENTS.md revision 1。

GPT-OSS 120B 已先通過 SDK 三任務；其當日額度在後續瀏覽器測試耗盡，因此 browser 最終使用 Qwen，沒有把 120B 的 quota failure 當作成功。先前的 quota、timeout 與模型原文引用不符等失敗報告另存於 `test-results/jokes-browser-*.json`，最終成功證據為下列主報告。

- `test-results/jokes-live.json`：provider/model/Pi version、每任務結果、耗時、讀寫 trace、最終文字、request 數量和 usage。
- `test-results/jokes-browser.json`：正式 UI 三任務結果、session identity、讀寫／context trace 與最終答案。
- `test-results/jokes-browser-mobile.png`：390×844 操作畫面。
- `test-results/language-browser.json`：只有 AGENTS.md、沒有 skill 時的英文問題／中文回答，避免混淆 skill 自身的中文指示。
- 回歸測試另外驗證 reload／重連／關閉重開的實際 HTTP request、多 tab provider 隔離、editor revision conflict、transaction rollback、五檔批次讀寫、skill 變更與來源保留。

Groq 的免費 TPM 限制可能讓多步工具任務需要等待。Provider 只做最多兩次模型請求重試，單次服務端等待最多 60 秒，UI run 總 deadline 360 秒；工具副作用不自動重試。瀏覽器未暴露 Retry-After header 時，adapter 從 Groq 的限流訊息補回等待秒數，再交給 Pi 的既有 request retry。429／網路／quota 失敗不算驗收通過。對話超過帳號的單次 input-token 額度時必須另開對話或提高供應商額度，目前沒有自動壓縮歷史。

目前 GPT-OSS 預設 medium reasoning、temperature 0.6，SDK 可覆寫。這些設定依 [Groq reasoning 文件](https://console.groq.com/docs/reasoning) 支援的選項配置；限流說明見 [Groq rate limits](https://console.groq.com/docs/rate-limits)。

後續 F5 的 `~/main.html` 主頁預覽與 popup 共享 workspace 已另行實作，操作與獨立驗收見 [主頁預覽](page-preview.md)。本文件保留原笑話驗收範圍。
