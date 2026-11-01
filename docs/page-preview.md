# VFS 主頁與 Pi popup

更新：2026-11-01。

Production 瀏覽器驗收已通過：Groq `openai/gpt-oss-20b` 實際將頁面標題改成 `Updated by Pi`、提交 revision 2，並依 AGENTS.md 用中文回覆。七項整合檢查全數 PASS，reload／重連後的 request 確實保留上一輪問題與回答。回歸共 89 項通過，typecheck／build／dist 檢查通過。先前 Qwen 在完成讀寫後遭輸出額度限制拒絕，失敗紀錄另存，沒有計為成功。

GitHub Pages 子路徑 `/agent-go-round/` 的獨立 build 亦已在真實瀏覽器驗證：390×844 page view 沒有水平溢出、popup 為完整 390×844，iframe URL 保留正確子路徑與 workspace／surface binding。截圖為 `test-results/preview-pages-mobile-popup.png`。

在 shell 執行 `preview ~/main.html`（或 `preview`），會沿用現有 tab 系統開啟主頁預覽。檔案不存在時，按「建立主頁範本」才寫入檔案；已有內容不會被覆寫。

```text
edit ~/main.html
preview ~/main.html
```

預覽右下角的「開啟 Pi」沿用現有 popup。連接 Groq、執行 `ai`，即可要求 agent 讀取或修改同一 workspace 的檔案，包括 AGENTS.md、skills 與 main.html。Popup 有獨立對話版面，`/exit`、`history`、`ai --resume` 和工作區一樣可用。

檔案更新後，預覽會顯示「檔案有更新」，按「重新載入預覽」才套用新內容。重新載入只替換頁面 iframe，不重建 popup；切換工作區 tabs 也保留 popup。整頁 reload 後會恢復預覽 entry、popup surface 與對話，Groq 需要重新連接。沒有自動重送模型或重做工具。

「開啟主頁」會開啟隱藏編輯器外框的 page view，網址例如：

```text
/?workspace=my-space&view=page&entry=%2Fhome%2Fuser%2Fmain.html&surface=page
```

Page view 同樣有 Pi launcher。「工作區」連結可另開 shell/editor。URL 的 workspace 決定檔案與歷史範圍；surface 決定持久化版面。Popup 的 surface identity 隨預覽 tab 保存，reload 不會隨機換成另一段對話。

## 手機鍵盤與簡易 bash

Terminal 會列出簡易 bash 支援的內建指令及 ~/bin 檔案工具。指令名稱不分大小寫，例如 `LS`、`Read`、`AI --NEW`、`Preview`；路徑、內容、搜尋文字與 session ID 保留大小寫。啟動 agent 使用 `ai`，另開／恢復對話使用 `ai --new`、`ai --resume ID`；`/exit` 返回 shell。技能仍放在 `~/.pi/skills`。

手機與觸控裝置的輸入欄位採 16px。鍵盤縮小可視區時，暫時隱藏側欄及額外標題，把 composer 收成一列，保留可捲動的 terminal。App 和 popup 同時跟隨 visual viewport 的高度、寬度與位移；popup iframe 只調整尺寸，保留草稿和對話。鍵盤收起時恢復原版面。

`npm run test:mobile:browser` 不需 API key；透過真實 Chrome 模擬縮小至 360px 高的 visual viewport，驗證混合大小寫指令、composer、捲動、設定表單、popup 草稿保留及水平位移。回歸測試目前共 94 項通過；瀏覽器結果為 `test-results/mobile-browser.json`，截圖為 `mobile-*-simulated.png`。這是可視區幾何回歸，未取代 iPhone Safari 實體鍵盤驗收。

## 頁面與資源範圍

支援 UTF-8 HTML、CSS、CSS 相對 import、inline style，以及 VFS 的 SVG 圖片。CSS 和圖片路徑相對於所屬 HTML／CSS 解析；每次預覽記錄實際讀取的 revision。任一依賴更新都會提示刷新。每個預覽最多 64 個資源、2 MB 文字；CSS import 會檢查循環與深度。

目前 VFS 是文字檔案系統，因此 PNG／JPEG 等二進位匯入、完整頁面 JavaScript 執行、外部網路資源與頁面內導航另列後續。缺少或不支援的資源會顯示錯誤並保留上一個可用預覽。

HTML 先以純解析器處理，避免解析期間請求資源，再放進 opaque-origin sandbox iframe。頁面 scripts、event handlers、嵌入 frame、導向與外部載入被移除或由 CSP 阻擋。Popup 由外層可信任 runtime 掛載，頁面 HTML 不持有 credentials 或直接存取 IndexedDB。

IndexedDB 仍屬於目前瀏覽器／app origin。這是本機內容預覽，尚未提供 VFS 內容匯出或讓其他訪客共享同一份自訂主頁的發布功能。

## Embed API

宿主可明確指定工作區和版面：

```js
const widget = window.AgentGoRound.mount({
  appUrl: "https://example.com/agent-go-round/",
  workspaceId: "my-space",
  surfaceId: "support-popup",
  mode: "popup"
});
```

Script auto-mount 對應 `data-workspace="my-space"`、`data-surface="support-popup"`。Identity 僅接受 1–64 個英數字、底線或連字號。`ready` handshake 回報實際 workspaceId／surfaceId；指定的 binding 不符時 loader 回報錯誤。預設工作區仍為 default，原本沒有傳 binding 的 embed 保持相容。

檔案、歷史和 writer leases 按 workspace 共用；editor、page view 與 popup 的 layout 分開保存。若從另一 surface 手動恢復同一個 session，既有 revision／lease 檢查仍會拒絕同時寫入。不同 workspace 的檔案不共用。

## 驗證

```sh
npm test
npm run build
npm run verify:dist
npm run preview
AGENT_BROWSER_CLI=/path/to/agent-browser.js \
AGENT_GO_ROUND_GROQ_MODEL=openai/gpt-oss-20b npm run test:preview:browser
```

Live runner 從未追蹤的 `.env.local` 讀取 `AGENT_GO_ROUND_GROQ_API_KEY`，使用 production preview（預設 127.0.0.1:4173），每次建立獨立 workspace，關閉 Remember。透過真正 UI 連線與 Pi loop，驗證模型修改 main.html、AGENTS 中文規則、active-run 刷新、shell 讀回、CSS 更新、tab 切換、reload／reconnect 後的實際 request 歷史、page entry、workspace 隔離及手機版面。結果輸出到 `test-results/preview-browser.json`，截圖為 `preview-*.png`；額度／模型失敗會保留為 FAIL。
