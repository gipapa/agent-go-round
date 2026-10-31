# AgentGoRound：輕量前端 harness 規劃

日期：2026-10-31

狀態：規劃階段，尚未開始程式實作。

## 目標

建立穩定、簡單、可高度客製化，並容易被其他專案導入的瀏覽器 agent harness。參考 Pi 的小核心、工具與 skills 擴充方式；核心負責執行可靠性，專案提供解題所需的模型、工具與上下文。

優先順序：執行正確與可恢復 → 核心容易理解與測試 → 客製化 → 嵌入 → 選配功能。介面可採 terminal 風格的文字對話，不要求完整 terminal emulator 或真正 shell。

## 版本策略與舊版參考

- `v2` 保存舊版完整程式、文件、測試與 Git 歷史，起點為 `73285d6`。
- `master` 使用獨立根提交，從本規劃、README 與必要 repository metadata 開始。
- 舊版 gate 的 pending/failure 保持原狀，不因重建而改列通過。新版依自己的產品範圍建立驗收條件。
- 舊版不是新版依賴。移植任何模組前，確認其依賴、保留行為與回歸案例；禁止為沿用一個 helper 搬入整個 App。
- 不承諾新版能直接讀取舊版資料。若未來需要 migration，另訂格式與恢復方案；不得隱性覆寫舊 browser storage。

優先評估的舊版資產：

| 資產 | 舊版參考路徑 | 移植前要確認 |
|---|---|---|
| Pi runtime / tool boundary | `src/pi/runtime/`、`src/pi/tools/` | 可脫離 React、App 與必選 load balancer |
| 副作用與取消 | `src/runtime/toolEffectRunner.ts`、`src/utils/deadline.ts` | dispatch、abort、重試與 unknown outcome 語意 |
| Context projection | `src/pi/context/PiContextAssembler.ts` | tool call/result 成對；超限不默默遺失必要資訊 |
| Session persistence / recovery | `src/storage/piSessionStore.ts`、`src/pi/session/` | 可注入 store；格式與 writer ownership 清楚 |
| MCP lifecycle | `src/mcp/clientManager.ts`、`src/mcp/toolCatalog.ts` | 選配；不拖慢基本對話初始化 |
| 歷史失敗案例 | `src/__tests__/`、`docs/gates/milestone-e.md` | 改寫為小範圍可重現的 regression fixtures |

以上路徑位於 `v2`，不代表已經移植或完成驗證。

## 第一版產品範圍

保留：單代理、模型串流、typed tools、instructions/skills、可替換 storage、approval、abort/deadline、執行上限、事件紀錄與中斷恢復。

預設不納入：MAGI、多代理、voice、Graphify、大型管理面板、必選 load balancer、任意 JS script tool、雲端同步、完整 tree UI、steering、codemode 與多模態。

MCP 與 load balancing 作為選配 adapter；tutorial 作為範例與測試素材。主路徑只維護一套 agent loop，避免 legacy/new engine 切換。

先以小型 conformance spike 確認適用的 upstream Pi 版本、瀏覽器 bundling、工具循環、取消與 provider transport。版本需固定並記錄理由；不預設直接沿用舊版 `0.84.4`，也不把所有 upstream 產品功能搬進核心。

## 核心邊界與客製化

核心不依賴 React、DOM、全域 UI state 或特定 IndexedDB database。瀏覽器限制、CORS 與 runtime lifecycle 必須明確，不以依賴注入宣稱已支援所有執行環境。

提供的接口：

- Model adapter：輸入上下文，回傳文字／工具請求與明確 terminal outcome。
- Tools：名稱、說明、schema、執行函式、權限與副作用描述。
- Instructions / skills：基本指示、按需載入的能力與資源。
- Storage：memory 預設實作；IndexedDB 或宿主儲存可替換。
- Policy：確認、時間／步數／輸出上限及重試條件。
- Context：宿主提供的資料與每回合 context transform。
- Events：可訂閱、可保存、可重播的版本化事件與 run identity。

僅在有具體用途時加入 `beforeTurn`、`beforeTool`、`afterTool`、`onEvent` 等 hooks，定義執行順序、錯誤與取消語意。工具可以是宿主信任的程式；不讓模型隨意產生並執行同源 JS。

UI 與核心分離，簡潔文字介面、浮動 widget 與宿主自行製作的介面共用核心。先建立清楚入口，不急於拆成大量 npm packages 或建立 plugin marketplace。

## 穩定性契約

1. 每個 run 有穩定 identity 與唯一 terminal outcome；遲到結果不能改寫已結束或其他 run。
2. 同一 session 預設只允許一個 active run；並行與 takeover 必須明確定義。
3. 工具參數通過驗證才可 dispatch；discovery 與 hooks 不得繞過 policy。
4. 模型請求重試與工具副作用重試分開處理，不自動重送結果不明的 mutation。
5. 工具已送出但結果無法確認時，保存 `outcome_unknown`，由明確的讀回或使用者決定下一步。
6. Abort、deadline、步數與輸出限制涵蓋 provider、tool 與等待確認的階段；取消不能產生未啟動的新副作用。
7. Context projection 保留 tool call/result 完整性；不足以繼續時回報明確原因，或使用有紀錄的 compaction。
8. Session 保存失敗對使用者可見，不能假裝已可恢復；恢復時辨別未 dispatch 與結果不明的操作。
9. Replay 僅重建狀態，不能呼叫模型或執行工具。紀錄、fixtures 與 export 不包含 credentials。
10. 關閉 widget 與銷毀 runtime 是不同操作；隱藏不自動中止，destroy 的取消與資源釋放必須可驗證。

## 嵌入其他專案

第一個嵌入版本使用小型 JS loader 建立浮動按鈕與 iframe。較深的整合提供 ES module/SDK，讓宿主自行提供 UI。

宿主透過 bridge 主動提供必要上下文及註冊工具，例如讀取訂單、草擬回覆、確認後更新資料。不同 origin 的 iframe 不自行讀取宿主 DOM、cookies 或 storage。

Bridge 定義版本、instance/session/request identity、schema、origin/source 驗證、allow-list、取消與 timeout。宿主只執行已註冊且通過權限檢查的操作。

至少驗證兩個 widget instance 不互相污染；關閉重開、destroy/remount、初始化失敗及重複載入均有明確行為。跨站 storage 受限時可以使用 memory 或宿主 storage。

參考：[iframe](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe)、[postMessage](https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage)。

## 驗證策略

| 層級 | 驗證內容 | 頻率 |
|---|---|---|
| Deterministic regression | Scripted model 搭配正式 harness、tools、storage；故障注入 | 日常修改與 CI |
| 真實模型 acceptance | 真模型選工具、理解結果、修正錯誤及完成任務 | 小量、明確觸發 |
| Browser / embed smoke | 簡潔 UI、宿主 bridge、instance 隔離與 lifecycle | UI／嵌入變更 |

固定測試覆蓋成功、invalid args、拒絕確認、abort、deadline、斷線、有限重試、unknown outcome、late result、儲存失敗與恢復。Scripted model 只能證明執行契約，不能證明模型解題能力。

真實模型先驗證三個短任務：讀取資料回答、修改後讀回確認、工具錯誤後修正參數完成。判定實際狀態與必要事件，不依賴回答措辭或模型自稱完成。專案可注入 `validateResult`，不預設加入 verifier agent。

每次真實測試記錄 model/provider/version、次數、成功率、步數、耗時與失敗分類。區分 harness、provider compatibility、模型決策、network 與 quota；額度不足不能算 PASS，也不無限等待／重跑。

Groq 作為後續相容性案例，不再是唯一驗收來源。舊版 tool-name control marker 等失敗保留為 regression 素材。新版不以外部網站長流程或免費 provider 配額作為日常開發前置條件。

## ChatGPT 訂閱測試 adapter

優先做開發／測試用途的本機 adapter spike，透過官方 Sign in with ChatGPT 授權，再使用 Responses transport。必須保持自有 Pi loop 擁有工具循環；由 Codex 代辦整個任務不能視為本 harness 的 tool-loop 驗收。

截至本規劃日期，官方文件說明符合資格的 Plus/Pro 使用者可在開源與本機個人專案授權使用 ChatGPT plan；實際帳號資格、可用模型、工具相容性與用量仍需完成登入及最小請求確認。

先驗證登入、refresh/revoke、模型清單、單一工具呼叫與結果回傳，再接入正式 acceptance runner。需要本機 callback/token lifecycle 的部分留在測試 adapter；核心與一般 widget 不強制依賴本機服務。

使用正式授權流程，不讀取既有 Codex credentials 或瀏覽器 cookies。依官方流程使用 Responses API、`store: false`、`stream: true`；處理 completed、failed、incomplete、用量限制及串流中斷，不能只因出現文字就算成功。

這項整合不代表一般 API key 用量由訂閱支付，也不代表能使用個人訂閱服務所有網站訪客。公開代管／商用 widget 的模型認證與供應另行設計；保留宿主 provider adapter。

參考：[官方整合範例](https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt)、[適用範圍](https://developers.openai.com/siwc/token-sharing-open-source)、[模型與推論](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)。外部規格可能更新，實作前重查。

## 實作里程碑

### M0：確認最小技術路徑

驗證 Pi-in-browser 的最小 bundle、單一 model adapter、工具往返與 abort。另做 ChatGPT 本機授權及 Responses 工具呼叫 spike，記錄可行性、依賴版本與已知限制。完成前不搬入大型舊版模組。

### M1：可靠的小核心

完成單代理、tool policy、執行上限、typed events、memory store 與 deterministic regression。接受一個模型與少數工具即可執行；不需要 App、React、MCP 或 load balancer。

### M2：簡潔介面與恢復

文字對話、停止、必要確認與可展開 trace；加入可替換 persistence，驗證 reload/recovery。完成三個真實模型短任務，留下實際結果與失敗分類。

### M3：可嵌入版本

交付 JS loader、iframe bridge、SDK 入口與範例。純 HTML 與另一個框架專案完成導入，驗證隔離、destroy/remount 與宿主工具。提供清楚的認證／部署說明。

### M4：按實際需求擴充

優先考慮 MCP discovery、context compaction、follow-up。Tree UI、steering、多模態、codemode、多代理及 voice 需有實際需求與獨立驗收後才加入。

本次只建立規劃與版本分界；以上里程碑均未開始，不宣稱模型相容性、訂閱登入或測試已通過。
