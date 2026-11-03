# VFS 主頁與 Pi popup

更新：2026-11-04。現行終端與 AI bash 使用 just-bash；人類 editor 已移除。完整整合與驗收狀態見 [驗證紀錄](just-bash-progress.md)。

在 shell 建立 HTML，再使用 Workspace → Preview file → Open preview 開啟。預設 entry 為 `~/main.html`；檔案不存在時，按「建立主頁範本」才寫入，不覆寫已有內容。

```sh
printf '<h1>我的主頁</h1>' > ~/main.html
```

預覽右下角的「開啟 Pi」掛載現有 popup。連接 Groq、按 AI，即可要求 agent 透過 bash 或結構化工具讀寫同一 workspace 的檔案，包括 AGENTS.md、skills 與 main.html。New conversation、History／Resume 管理對話；`/exit` 返回 shell。

檔案更新後顯示「檔案有更新」，按「重新載入預覽」才套用。刷新僅替換頁面 iframe，保留 popup 對話、草稿及執行中的任務；切換 tabs 也保留 popup。整頁 reload 恢復 entry、surface 與對話，未保存 key 時需重新連線，不自動重送模型請求或工具副作用。

「開啟主頁」開啟隱藏工作區外框的 page view，例如：

```text
/?workspace=my-space&view=page&entry=%2Fhome%2Fuser%2Fmain.html&surface=page
```

workspace 決定檔案與歷史範圍，surface 決定持久化版面；popup 的 surface identity 隨預覽 tab 保存。page view 的「工作區」連結可回到 shell／AI 工作區。

## 手機與 popup

手機／窄螢幕與 popup 僅顯示直式 tab 列；桌面工作區僅顯示橫式列，皆可新增、切換、關閉及開啟 provider settings。Popup loader 指定 `tabs=vertical`。

just-bash 指令與變數區分大小寫，路徑與內容保留大小寫。每次送出獨立 script，僅保存 cwd；shell 的 read／help 使用上游定義。AI 模式使用 UI 切換，沒有舊 JSON CLI 或 editor 指令。

觸控輸入欄位採 16px。鍵盤縮小可視區時保留 tab 操作、精簡標題與 composer，terminal 仍可捲動。App 和 popup 跟隨 visual viewport 的高度、寬度與位移，不 remount iframe、不丟失草稿。`test:mobile:browser` 以真實 Chrome 模擬 360px 高可視區；這是版面回歸，未取代 iPhone Safari 的實體鍵盤驗收。

## 頁面與資源範圍

支援嚴格 UTF-8 HTML、CSS、CSS 相對 import、inline style 與 VFS SVG。資源路徑相對於所屬 HTML／CSS 解析；實際讀取的 revision 用於更新提示。每個預覽最多 64 個資源與 2 MB 文字，CSS import 檢查循環與深度。

VFS 可保存 bytes；預覽目前仍只處理上述文字資源。PNG／JPEG 匯入介面、頁面 JavaScript、外部資源與頁面內導航列為後續。缺少或不支援的資源會顯示錯誤，保留上一個可用預覽。

HTML 先以純解析器處理，再放入 opaque-origin sandbox iframe。Scripts、event handlers、嵌入 frame、導向與外部載入由清理及 CSP 阻擋。可信任 runtime 掛載 popup，頁面 HTML 不持有 credentials 或直接存取 IndexedDB。

檔案屬於目前瀏覽器／app origin，本機預覽尚未提供 VFS 匯出或讓訪客共享自訂主頁的發布功能。

## Embed API

```js
const widget = window.AgentGoRound.mount({
  appUrl: "https://example.com/agent-go-round/",
  workspaceId: "my-space",
  surfaceId: "support-popup",
  mode: "popup"
});
```

Script auto-mount 對應 `data-workspace`／`data-surface`。Identity 僅接受 1–64 個英數字、底線或連字號；ready handshake 驗證實際 binding。

外部 popup 未指定 workspace 時取得獨立 `popup-*` 工作區，與直接 app 的 default 隔離；宿主 sessionStorage 依 URL／掛載順序保存身份，reload 恢復。VFS 預覽明確傳入 workspace，因此與主 app 共用檔案。

`~/bin/read_host_page.js`／`~/bin/manifests/read_host_page.tool.json` 是 AI 的結構化宿主工具，透過 `readHostPage` capability 呼叫 bridge，參數為 offset／limit。一般宿主 HTML 排除 widget、script／style 與表單控制項；VFS 預覽則綁定當前 entry，回傳原始 HTML／path／revision。沒有宿主時明確回報錯誤。HTML 是外部資料，不自動成為 instructions。Shell 沒有同名 CLI bridge。

檔案、歷史與 writer leases 按 workspace 共用，工作區／page view／popup 各自保存 layout。同時恢復同一 session 時，revision／lease 會拒絕並行寫入；不同 workspace 不共用檔案。

## 驗證

```sh
npm test
npm run build
npm run verify:dist
npm run preview
AGENT_BROWSER_CLI=/path/to/agent-browser.js npm run test:preview:browser
AGENT_BROWSER_CLI=/path/to/agent-browser.js npm run test:host:browser
```

可用 `AGENT_GO_ROUND_APP_URL` 指向 production preview，包括 `/agent-go-round/`。預設使用本機 HTTP／SSE fixture，驅動真正 provider adapter／Pi loop／sandbox／原生 IndexedDB，不需 key。驗證修改頁面、刷新保留 active run、共享規則與檔案、CSS 更新、tab 切換、reload／reconnect 的 request 歷史、page entry、workspace 隔離與手機版面。

`AGENT_GO_ROUND_RUN_GROQ=1 npm run test:preview:browser` 才呼叫外部 Groq，從未追蹤的 `.env.local` 讀 key；模型可用 `AGENT_GO_ROUND_GROQ_MODEL` 指定。報告與截圖存於 `test-results/preview-browser.json`、`host-browser.json` 及 `preview-*.png`。模型／quota 失敗明列 FAIL；fixture 通過不等同外部模型通過。

2026-11-01 的舊版 Groq 預覽成功與 Qwen quota 失敗屬歷史紀錄，不作為 just-bash 版的模型驗收證據。
