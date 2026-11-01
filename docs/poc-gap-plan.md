# Pi POC：從可對話到可持續工作的缺口規劃

原始盤點：2026-10-31；封存說明更新：2026-11-01。下列狀態與 P0–P3 是當時的缺口紀錄，不是目前缺陷清單。

歷史接續、IndexedDB VFS、shell／`ai`、檔案式 AGENTS.md／skills、五笑話驗收與主頁 popup 已依 [檔案編輯器規劃](filesystem-editor-plan.md) 完成第一輪交付。手機鍵盤已做模擬回歸，iPhone 實機仍待驗收；當前證據與後續順序以 [主規劃](plan.md) 為準。本文保留原始盤點供參考，未完成的進階歷史與 compaction 不因封存而視為通過。

當時定位：已有 Pi loop、工具邊界、儲存與嵌入的技術骨架，但日常使用仍接近基本聊天介面。以下敘述反映 F0–F5 實作前的狀態。

## 實作盤點

| 能力 | 目前實際狀態 | 使用上的缺口 |
|---|---|---|
| 同一 runtime 多輪對話 | Pi 保留 `agent.state.messages`，不是每次只送最新一句 | 缺少 UI 到 provider request 的多輪內容斷言 |
| Reload 後續聊 | core 有 snapshot / restore；scripted UI 有接回 | Groq 只還原畫面，沒有把原 snapshot 接回 runtime |
| 重新連接 provider | 可以建立 Groq runtime | 每次 Connect 建立空 session，畫面舊訊息仍在，模型歷史被重置 |
| 對話保存 | localStorage 保存目前開啟 tabs、draft、畫面與 snapshot | 不是可瀏覽、搜尋、重開的歷史對話庫；關閉 tab 後缺少取回入口 |
| 多 tab | 各有 runtime、draft、顯示紀錄 | provider 標記在 workspace 全域，Connect 只改 active tab；新 tab 仍是 scripted，顯示可能與實際 runtime 不符 |
| 跨 tab 回覆 | 使用者可傳問題並看見回覆 | 回覆只加入來源 tab 的畫面，來源模型下次不會因此取得該回覆 |
| Instructions / skills | 有 loader 與 system-prompt 組合函式 | 主 UI 未接入設定／選用流程；Groq session 沒有傳入 system prompt |
| Tools | core、approval、取消與 host-tool bridge 已建立 | 獨立頁面沒有實用工具目錄；主畫面沒有呈現工具參數、結果與 approval 狀態的完整流程 |
| 長對話 | 累積完整 messages | 沒有 token 預算、context projection 或 compaction；model context window 固定宣告為 128k |
| 中斷恢復 | lifecycle events 可辨識 interrupted / unknown outcome | 通知後的 review／讀回流程不足；任一 tab running 會阻擋整個 workspace snapshot 保存 |
| 對話閱讀 | 純文字串流 | 每次 render 重建全文並捲到底；缺少閱讀舊訊息時保留位置、Markdown 與程式碼呈現 |

主要依據：`src/main.ts` 的 `restoreTab()`、`restoreWorkspace()`、provider submit handler、`handleRouteEvent()`、`persistWorkspace()` 與 `renderTerminal()`；`src/core/session.ts` 的 constructor / snapshot；`src/core/skills.ts`。

## P0：先修對話接續與身份

目標：畫面中的對話，與下次模型真正收到的上下文一致。

1. Session identity 與 provider connection 分離。每個 tab 保存自己的 provider/model metadata 與連線狀態，credentials 留在 credential runtime。新 tab 明確選擇或繼承 provider 設定。
2. Reload 後保留 Groq session snapshot，進入 disconnected 狀態；重連只補 transport / credentials，透過 snapshot 恢復 messages 與 system prompt。等待連線時禁止誤送到 scripted runtime，也不能把空 session 自動覆寫回原紀錄。
3. 同 provider 重新 Connect 保留歷史；切換 model/provider 時明確定義保留、相容轉換或另開對話的行為。只有使用者選擇新對話／清除時才重置。
4. 定義 canonical conversation records，再由它產生畫面與模型上下文。保留 user / assistant / tool-call / tool-result 的結構；啟動提示與連線通知不當成模型訊息。
5. 跨 tab 回覆保存來源與 correlation identity，提供明確的「加入本對話上下文」操作；加入後不自動啟動模型，下一次正常送出才帶入。

驗收：

- 第一輪給代號，第二輪實際 provider request 包含第一輪 user / assistant；不要只測模型回覆的措辭。
- Reload → 重連 → 詢問代號，request 仍包含原歷史；重複 Connect 不清空、不重複加入訊息。
- A 用 Groq、B 用 demo 時，標籤、保存與 reload 結果各自正確；新 tab 不會假顯示為 Groq。
- 跨 tab 回覆經加入後，出現在來源 tab 下一輪 request，且只出現一次。
- 恢復前、連線失敗或其他 tab 正在執行時，既有已保存歷史不被空資料覆寫。

## P1：建立真正的歷史對話

目標：tabs 是目前開啟的視窗，sessions 是可以長期找回的對話。

1. 增加獨立 session repository 與列表索引：sessionId、標題、建立／更新時間、provider/model、狀態與摘要預覽。沿用 storage interface，browser 實作可採 IndexedDB。
2. 提供歷史列表、重開、重新命名、搜尋、封存與明確刪除；關閉 tab 只關閉視窗，保留 session。
3. 每個 session 獨立保存 committed messages 與 draft，某一個 session running 不應阻擋其他 session 保存。中斷中的 run 另記 checkpoint／事件，不偽裝成完整 idle snapshot。
4. 定義既有 localStorage workspace 的一次性 migration、版本驗證與失敗回復。匯入匯出只包含對話與必要 metadata。

驗收：關閉後可從歷史重開並續聊；重新整理、多 tab 同時工作、storage 寫入失敗與 migration 都不會悄悄丟失已提交對話。

## P2：把上下文與工具接成可用任務

目標：宿主能提供 agent 的任務背景與能力，使用者看得懂 agent 做了什麼。

1. 串接 base instructions、選定 skills 與 host context；定義可更新的 SDK / bridge 接口、來源標記與大小上限。UI 能檢視本 session 使用哪些 instructions / skills / tools。
2. 完成一個具體任務範例，例如讀取宿主資料 → 草擬修改 → 確認 → 修改 → 讀回。沿用既有 Pi tool loop 與 approval，不另造 loop。
3. 主畫面顯示工具名稱、參數、執行／等待確認／成功／錯誤／結果未知狀態與可展開結果。對結果未知提供明確 review／讀回入口。
4. 將已存在的 tool-call、deadline 與輸出限制接到產品設定或合理預設，避免目前只靠 SDK 呼叫者自行配置。

驗收：工具讀取、修改後讀回、錯誤修正可從正式 UI 完成；拒絕／停止後沒有額外修改，結果未知不自動重試。

## P3：長對話與閱讀體驗

1. 建立 context budget，依實際模型能力預留輸出與工具空間；接入 Pi 的 context transform 邊界。
2. 超限時採可檢視的摘要加最近訊息；保留原始歷史與 tool-call/result 配對，記錄摘要覆蓋範圍。摘要失敗有明確狀態。
3. 支援 Markdown、程式碼區塊與複製；串流時只更新相關內容，使用者往上閱讀時保留捲動位置。
4. 顯示可取得的 token usage、耗時與執行步數；目前 provider cost metadata 為零，不能當成真實費用。

驗收：長對話可繼續且不產生孤立 tool result；原文仍可查閱；手機與桌面閱讀舊訊息時不被串流拉回底部。

## 建議交付順序

先做 P0，交付「reload / reconnect 後仍有記憶的聊天」；再做 P1，交付「可找回、重開的對話」；P2 交付「有背景、有工具、看得見執行過程的任務」。P3 隨對話長度與使用量補齊，context 超限的明確錯誤處理可提前加入。

MCP、自動 delegation、ChatGPT 訂閱 adapter、voice 與多模態維持後續選配，先完成上述最小使用閉環。

本次盤點已執行 `npm test`：14 test files、52 tests 通過，未呼叫真實 provider。現有測試主要證明個別核心契約；尚未覆蓋 Groq UI reload / reconnect 的歷史接續，因此綠燈不能作為該流程已完成的證據。既有文件的 Groq live 紀錄僅作過往結果參考，本次未重跑。
