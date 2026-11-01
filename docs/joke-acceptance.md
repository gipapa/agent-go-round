# 檔案式 Pi：笑話驗收

更新：2026-11-01。SDK Groq live runner 與 production 瀏覽器 live runner 的三個任務均已通過。SDK 使用 `openai/gpt-oss-120b`；瀏覽器使用 `qwen/qwen3.8-27b`，實際報告見下方。

## 自己操作

1. `npm run dev`，開啟顯示的 URL。新 tab 位於 `~`。
2. 輸入 `demo jokes`，建立以下檔案。既有檔案不覆寫；若有自己的規則或同名 skill，請另開 `?workspace=jokes-demo`。

```text
~/AGENTS.md
~/.pi/skills/joke-master/SKILL.md
~/.pi/skills/joke-master/references/scoring.md
~/jokes/笑話1.md … 笑話5.md
~/bin/read.js、write.js、edit.js、grep.js、find.js、ls.js、skill_load.js
```

3. 在 provider settings 連接 Groq，執行 `ai`，用英文詢問：

```text
Use the joke-master skill to read all five Markdown jokes in ~/jokes, score each one, and give me the funniest joke.
```

4. 查看中文答案、五筆評分與冠軍原文。介面列出本輪 AGENTS.md／skill／讀檔來源及 revision；工具結果可展開檢閱參數與原始內容。
5. `/exit` → `edit ~/jokes/笑話1.md` → 修改並 Save → Cancel 返回 shell → reload → reconnect → `ai`。英文要求重新讀取五個檔案並評分，必須讀到新 revision。
6. `/exit` → `ai --new`，用英文請 agent 建立另一個目錄中的五個新笑話，逐檔讀回、評分、選出冠軍。新對話共用同一份 VFS；歷史接續在上一步驗證。`/exit` 後用 `ls`、`read` 檢閱實際檔案。

`history` 列出持久化對話，`ai --resume SESSION_ID` 重開，`ai --new` 明確另起對話。關 tab 保留歷史；Groq reload 後等待重新連線，不把保存的 transcript 替換成空 runtime。Shell output 不自動塞進模型對話。

## 重跑指令

在未追蹤的 `.env.local` 設定 `AGENT_GO_ROUND_GROQ_API_KEY`，不要把 key 放進 VFS 或聊天。普通 `npm test` 不呼叫網路。

```sh
npm test
npm run build
npm run verify:dist
npm run test:jokes
```

SDK runner 使用真正 Groq adapter／Pi loop、IndexedDB（測試使用 fake-indexeddb）與 VFS 內的 JS；只有 Node 執行器以 VM 代替 browser sandbox。

正式瀏覽器 runner 使用 `agent-browser` CLI、真正瀏覽器 IndexedDB、opaque iframe／Worker、editor 與設定表單。先啟動 dev server；CLI 已在 PATH 時可直接執行，否則透過 `AGENT_BROWSER_CLI` 指定其 executable 或 JS 入口：

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

## 報告與執行限制

本次 production 瀏覽器驗收於 `http://127.0.0.1:4173/` 執行，三項均 PASS：前兩項使用相同 session，messages 從 11 筆增加至 20 筆；修改後的笑話 revision 為 2。第三項明確另開 session、共用同一 workspace，留下五筆真實寫入與五筆讀回紀錄。390×844 寬度檢查亦通過。普通回歸測試共 82 項通過，build／typecheck／dist 檢查通過。

獨立語言規則驗收亦 PASS：新 workspace 只建立 AGENTS.md、沒有 skill，以英文詢問虛擬檔案系統，模型實際回覆繁體中文；該輪唯一 context source 為 AGENTS.md revision 1。

GPT-OSS 120B 已先通過 SDK 三任務；其當日額度在後續瀏覽器測試耗盡，因此 browser 最終使用 Qwen，沒有把 120B 的 quota failure 當作成功。先前的 quota、timeout 與模型原文引用不符等失敗報告另存於 `test-results/jokes-browser-*.json`，最終成功證據為下列主報告。

- `test-results/jokes-live.json`：provider/model/Pi version、每任務結果、耗時、讀寫 trace、最終文字、request 數量和 usage。
- `test-results/jokes-browser.json`：正式 UI 三任務結果、session identity、讀寫／context trace 與最終答案。
- `test-results/jokes-browser-mobile.png`：390×844 操作畫面。
- `test-results/language-browser.json`：只有 AGENTS.md、沒有 skill 時的英文問題／中文回答，避免混淆 skill 自身的中文指示。
- 回歸測試另外驗證 reload／重連／關閉重開的實際 HTTP request、多 tab provider 隔離、editor revision conflict、migration／transaction rollback、五檔批次讀寫、skill 變更與來源保留。

Groq 的免費 TPM 限制可能讓多步工具任務需要等待。Provider 只做最多兩次模型請求重試，單次服務端等待最多 60 秒，UI run 總 deadline 360 秒；工具副作用不自動重試。瀏覽器未暴露 Retry-After header 時，adapter 從 Groq 的限流訊息補回等待秒數，再交給 Pi 的既有 request retry。429／網路／quota 失敗不算驗收通過。對話超過帳號的單次 input-token 額度時必須另開對話或提高供應商額度，目前沒有自動壓縮歷史。

目前 GPT-OSS 預設 medium reasoning、temperature 0.6，SDK 可覆寫。這些設定依 [Groq reasoning 文件](https://console.groq.com/docs/reasoning) 支援的選項配置；限流說明見 [Groq rate limits](https://console.groq.com/docs/rate-limits)。

後續 F5 的 `~/main.html` 主頁預覽與 popup 共享 workspace 已另行實作，操作與獨立驗收見 [主頁預覽](page-preview.md)。本文件保留原笑話驗收範圍。
