# AgentGoRound：輕量前端 harness 規劃

日期：2026-10-31

狀態：M0-A 已建立；最小 browser harness、Pi 0.84.4、scripted regression 與 Groq adapter 已建立。M0-B 的 Herdr-inspired tab shell 與第一版使用者觸發跨 tab 訊息／關聯回覆已建立；M0-B.1 的手機／popup 共用直式 surface 已完成第一輪實作與 browser smoke，待使用者實際視覺確認。M3 的 JS loader／iframe bridge 第一輪已完成，並以不同 localhost origin 驗證 iframe handshake／host tool catalog；完整嵌入驗收仍待補齊。

## 目標

建立穩定、簡單、可高度客製化，並容易被其他專案導入的瀏覽器 agent harness。參考 Pi 的小核心、工具與 skills 擴充方式；核心負責執行可靠性，專案提供解題所需的模型、工具與上下文。

優先順序：執行正確與可恢復 → 核心容易理解與測試 → 客製化 → 嵌入 → 選配功能。介面可採 terminal 風格的文字對話，不要求完整 terminal emulator 或真正 shell。

第一個可驗收版本必須能以 Groq 的 OpenAI 相容 Chat Completions 接口完成基本對話，並提供 Herdr 風格的多 tab 對話視窗。先讓使用者實際確認視窗與對話流程，再擴充工具、skills 與完整恢復能力。ChatGPT 訂閱接入延後，不作為早期開發或驗收的前置條件。

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

第一個驗收範圍：Groq 基本多輪串流對話、Herdr 風格 tab shell、每個 tab 獨立的 session、停止與重用、執行狀態，以及使用者明確觸發的跨 tab 訊息與回覆。

後續核心範圍：typed tools、instructions/skills、可替換 storage、approval、abort/deadline、執行上限、事件紀錄與中斷恢復。每個 session 使用單代理；多個 tab 可以有各自的 agent/session。

預設不納入：MAGI、自動多代理編排、voice、Graphify、大型管理面板、必選 load balancer、任意 JS script tool、雲端同步、完整 tree UI、steering、codemode 與多模態。多 tab 與有明確目標的訊息互送屬於基本需求；自動 delegation、投票或 agent 群組協作另行評估。

MCP 與 load balancing 作為選配 adapter；tutorial 作為範例與測試素材。主路徑只維護一套 agent loop，避免 legacy/new engine 切換。

Upstream Pi 擁有模型／工具循環與 transcript ordering；產品層負責 run identity、policy、資源限制、storage、對外事件及 tab 訊息路由。Provider adapter 只轉換模型請求與串流，不另建 agent loop。

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

## 第一個 provider：Groq / OpenAI 相容 Chat Completions

以 `baseURL`、`model`、credential resolver 與 timeout 建立單一 provider 設定，第一個真實實作用 Groq。模型 ID 在實作時確認並固定於測試設定，不直接繼承舊版模型，也不加入候選切換或多 key 輪替。

目標接口為 Chat Completions（`/chat/completions`），先完成多輪訊息、串流文字、停止與錯誤處理；工具 schema/call/result 在 M1 加入。相容性以實際測試為準，不宣稱所有 OpenAI 相容 provider 都已支援。

開發用 key 透過本機未追蹤設定或使用者輸入提供；使用者明確勾選後可保存到目前 origin 的 `localStorage`，否則只在記憶體持有。無論是否保存，都不寫進 bundle、對話、trace 或跨 tab 訊息；provider drawer 提供清除操作。

先驗證瀏覽器連線與 production build 的實際行為；若需要本機 relay，記錄它的用途與限制，不把本機成功視為公開嵌入部署已可用。

遇到 429、額度不足、連線中斷或 provider 拒絕請求時，顯示可判讀的狀態並結束／有限重試，不無限等待。單次真實測試採低併發、明確 timeout 與有限次數；故障情境用 scripted model 或 transport fixtures 重現。

## 早期視窗設計：Herdr 風格 tabs 與互通

本規劃的 tab 先指同一應用內的對話分頁。跨瀏覽器分頁、跨裝置或對現有 Herdr terminal agents 的連線不屬於這次基本驗收，也不預設需要 BroadcastChannel 或外部 Herdr 服務。

早期 layout：精簡 tab 列、active tab 的文字對話區、固定輸入區與送出／停止操作。Tab 顯示名稱、working/idle/error 等狀態及未讀提示；詳細 trace 可展開。

下一個 UI 優先項目是手機與 popup 的共用直式呈現。兩者共用同一套 vertical surface 規則：單欄內容、固定且可見的標題／關閉操作、可獨立捲動的內容區、底部操作列、相同的欄距／內距／表單節奏與 touch target；避免在窄寬度出現水平捲動或被鍵盤遮住。手機將這套 surface 展開為全畫面；popup 則以 overlay／sheet 呈現，但不另外設計一套表單版型。桌面上的 popup 可以保留錨定位置，內容仍維持單欄直式。先完成這個共用基礎，再確認 desktop、mobile 與 popup 的對話、長訊息、捲動及鍵盤操作，完整 split-pane/layout 編輯延後。

每個 tab 綁定穩定 `tabId`、`sessionId` 與自己的 runtime、history、draft、error、run 狀態。切換 tab 不會取消執行，也不會把串流或草稿寫入其他 tab。關閉 tab 會明確銷毀該 runtime；同時執行中的取消與 late result 必須被正確處理。

Herdr 參考包含其他 tab 之間的對話能力，不能只做外觀與互相隔離的聊天頁。最早版本提供明確的「送到其他 tab」操作，並完成以下契約：

- 使用者選擇目標 tab 與要傳送的訊息／回答片段，送出前能看見目的地與內容；不自動分享整段歷史或 credentials。
- 路由訊息包含 `messageId`、`sourceTabId`、`targetTabId` 與 correlation identity；重複投遞不能觸發第二個 run。
- 目標 tab idle 時，接受已授權的問題並執行回覆；busy 時明確回報 busy，M0 不使用隱藏 queue 或中途注入 steering。
- 接收端顯示來源；跨 tab 內容保留為來源資料，不能被提升為 system instruction 或新增工具權限。
- 發送端顯示送達／busy／失敗狀態；送達與回答完成分開表示。目標的回答以關聯訊息回傳給發送端供閱讀，不自動觸發發送端再呼叫模型。
- 目標關閉、run 被取消或回覆失敗時，發送端能辨識結果；回傳回覆不產生自動往返循環。

後續再評估將相同 router 暴露成 policy-gated tool，讓模型在明確授權與目標 allow-list 下向其他 tab 詢問。仍沿用同一套 message/run contract，不增加第二條不可追蹤的 agent-to-agent 路徑；此項擴充安排於 M4，不阻擋早期使用者觸發的跨 tab 對話。

外觀與互動的早期驗收需要使用者實際操作確認；工程測試通過不代表視窗設計已被使用者接受。

## 穩定性契約

1. 每個 run 有穩定 identity 與唯一 terminal outcome；遲到結果不能改寫已結束或其他 run。
2. 同一 session 預設只允許一個 active run；busy 時明確拒絕新請求。不同 tab 使用不同 session；跨 tab 路由不能繞過 run ownership。
3. 工具參數通過驗證才可 dispatch；discovery 與 hooks 不得繞過 policy。
4. 模型請求重試與工具副作用重試分開處理，不自動重送結果不明的 mutation。
5. 工具已送出但結果無法確認時，保存 `outcome_unknown`，由明確的讀回或使用者決定下一步。
6. Abort、deadline、步數與輸出限制涵蓋 provider、tool 與等待確認的階段；取消不能產生未啟動的新副作用。總 wall-clock deadline 包含等待確認；若未來加入 active-time budget，必須另定名稱與語意。工具無法真正中止時，run 仍能結束等待，但副作用結果保留為未知，late result 不污染後續 run。
7. Context projection 保留 tool call/result 完整性；不足以繼續時回報明確原因，或使用有紀錄的 compaction。
8. Session 保存失敗對使用者可見，不能假裝已可恢復；恢復時辨別未 dispatch 與結果不明的操作。
9. Replay 僅重建狀態，不能呼叫模型或執行工具。紀錄、fixtures 與 export 不包含 credentials。
10. 關閉 widget 與銷毀 runtime 是不同操作；隱藏不自動中止，destroy 的取消與資源釋放必須可驗證。
11. Tab 路由訊息與回覆具有穩定 identity、明確目標與來源，具備 deduplication；跨 tab 回傳不會自動引起新的模型往返。

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
| 真實模型 acceptance | M0 用 Groq 多輪對話；M1 起加入工具與結果驗證 | 小量、明確觸發 |
| Browser / embed smoke | 早期 tab 對話／互通與 lifecycle；之後加入宿主 bridge、widget 隔離 | UI／嵌入變更 |

固定測試覆蓋成功、invalid args、拒絕確認、abort、deadline、斷線、有限重試、unknown outcome、late result、儲存失敗與恢復。Scripted model 只能證明執行契約，不能證明模型解題能力。

第一個使用者驗收先測基本對話與視窗：多輪上下文、串流、停止後再次對話、兩個 tab 切換與隔離，以及 A 詢問 B、B 回覆後 A 能看見結果。固定故障測試驗證 busy、目標關閉、重複投遞及取消後遲到回覆；不要求所有故障都消耗真實模型額度。

工具加入後再驗證三個短任務：讀取資料回答、修改後讀回確認、工具錯誤後修正參數完成。判定實際狀態與必要事件，不依賴回答措辭或模型自稱完成。專案可注入 `validateResult`，不預設加入 verifier agent。

每次真實測試記錄 model/provider/version、次數、成功率、步數、耗時與失敗分類。區分 harness、provider compatibility、模型決策、network 與 quota；額度不足不能算 PASS，也不無限等待／重跑。

Groq 是第一個真實 provider 與早期對話驗收目標；日常回歸仍以 deterministic tests 執行，不依賴免費額度。舊版 tool-name control marker 等失敗保留為 regression 素材，工具導入時再驗證。新版不以外部網站長流程或免費 provider 配額作為日常開發前置條件。

## 後續選配：ChatGPT 訂閱測試 adapter

延後至 Groq 基本對話、視窗驗收與核心工具契約完成後，再評估開發／測試用途的本機 adapter spike，透過官方 Sign in with ChatGPT 授權使用 Responses transport。它不阻擋 M0–M3。必須保持自有 Pi loop 擁有工具循環；由 Codex 代辦整個任務不能視為本 harness 的 tool-loop 驗收。

截至本規劃日期，官方文件說明符合資格的 Plus/Pro 使用者可在開源與本機個人專案授權使用 ChatGPT plan；實際帳號資格、可用模型、工具相容性與用量仍需完成登入及最小請求確認。

先驗證登入、refresh/revoke、模型清單、單一工具呼叫與結果回傳，再接入正式 acceptance runner。需要本機 callback/token lifecycle 的部分留在測試 adapter；核心與一般 widget 不強制依賴本機服務。

使用正式授權流程，不讀取既有 Codex credentials 或瀏覽器 cookies。依官方流程使用 Responses API、`store: false`、`stream: true`；處理 completed、failed、incomplete、用量限制及串流中斷，不能只因出現文字就算成功。

這項整合不代表一般 API key 用量由訂閱支付，也不代表能使用個人訂閱服務所有網站訪客。公開代管／商用 widget 的模型認證與供應另行設計；保留宿主 provider adapter。

參考：[官方整合範例](https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt)、[適用範圍](https://developers.openai.com/siwc/token-sharing-open-source)、[模型與推論](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)。外部規格可能更新，實作前重查。

## 實作里程碑

### M0-A：最小 Pi-in-browser 與 Groq 對話

建立最小 TypeScript/browser build 與測試環境，選擇並固定 Pi 版本。用公開核心入口注入 scripted model，驗證文字串流、唯一 terminal outcome、abort 後重用與同 session busy rejection；再接 Groq Chat Completions，以最小文字對話頁完成真實多輪對話。工具循環可用 scripted fixture 做技術 spike，完整 tool policy 不阻擋基本對話交付。

交付：可啟動頁面、可重現的測試指令、無 credentials 的範例設定、provider/version 記錄與 production browser smoke。先不搬入大型舊版模組。

### M0-B：Herdr 風格視窗與跨 tab 對話驗收

在相同核心上交付 tab shell：建立／命名／切換／關閉 tab、獨立歷史與草稿、串流與停止、執行狀態及未讀提示。提供「送到其他 tab」與關聯回覆；active target busy 時明確拒絕，不建立隱性 queue。

驗收至少包含：

1. Groq 真實多輪對話保持本 tab 上下文，停止後可再次送出。
2. Tab A 串流時切到 B，A 繼續執行，B 的歷史與草稿不被覆寫。
3. A 向 idle 的 B 送出明確問題，B 執行並回覆；A 可見來源、送達與回答結果，沒有自動訊息循環。
4. Busy、duplicate、target closed、abort/late result 以固定 fixtures 驗證，不污染其他 tab。
5. Desktop/mobile browser smoke 通過；由使用者實際確認視窗、捲動、鍵盤輸入與跨 tab 對話設計是否可行，記錄調整事項後再擴充產品功能。

這是第一個使用者產品驗收點，安排在 skills、MCP、持久化與完整工具層之前。

第一版實作紀錄（2026-10-31）：

- `src/core/tab-router.ts` 定義 `messageId`、`correlationId`、來源／目的 tab、明確 question/reply identity 與 route outcome；重複投遞去重，busy 不建立 queue，目標關閉、abort、error 與 late result 可辨識。
- UI 的 `ask another tab` 會在送出前顯示來源、目的與完整內容；接收端以來源資料／user input 顯示，回覆只寫回發送端 transcript，不自動觸發發送端模型。
- `src/core/tab-router.test.ts` 覆蓋成功回覆、busy rejection、duplicate、target closed、late result 與 aborted reply；browser smoke 已驗證 desktop 對話、360×740 mobile、路由預覽／回覆及既有 provider dialog 不互相污染。

尚待確認：使用者實際視覺／觸控接受度與 Groq live acceptance；這些不由 scripted regression 代替。

### M0-B.1：手機與 popup 的共用直式呈現（第一輪實作完成）

先不擴充工具或跨 tab 功能，處理既有 Herdr-inspired shell 在窄畫面與彈出視窗中的呈現。手機主畫面與 provider/settings popup 共用一套 vertical surface layout；只由外層決定是 full-screen mobile surface 或 anchored/overlay popup。共用內容順序、單欄表單、間距、按鈕排列、捲動區與 safe-area／鍵盤處理，避免 mobile 與 popup 逐漸分叉。

驗收至少包含：

1. 手機寬度下 sidebar、workspace header、tabs、agent pane 與 composer 不產生水平捲動；主要操作仍可觸控，長訊息與輸入區能正常捲動。
2. Provider/settings popup 在手機上以同一套直式內容呈現，標題、關閉、表單、remember/clear、狀態訊息與底部操作順序一致；開啟鍵盤後，輸入欄與提交操作不被遮住。
3. Popup 在 desktop 保持 overlay 可用，但內容仍是單欄直式，不引入第二種表單排列；開關、焦點與 Escape／關閉操作不污染目前 tab 狀態。
4. 以 browser smoke 實際檢查 desktop、窄手機寬度、popup 開啟與鍵盤狀態；記錄截圖與使用者視覺調整事項，確認後才回到跨 tab 訊息／回覆。

完成紀錄（2026-10-31）：

- `src/main.ts` 已加入 provider surface 的 dialog 語意、遮罩點擊關閉、Escape、focus trap、關閉後 focus 回復與 visual viewport 高度同步；popup 開關不改變 active tab。
- `src/styles.css` 已加入共用單欄 surface：desktop anchored overlay、mobile full-screen、固定標題／底部操作列、獨立捲動、safe-area、窄寬度防水平溢出與鍵盤可用高度處理。
- Browser smoke 已檢查 1280×800 desktop、360×740 mobile、360×400 keyboard-height viewport；確認 document 無水平捲動、mobile popup 寬高跟隨 viewport、Connect 操作仍在可視範圍、Escape 後 focus 回到 provider 按鈕且 tab 不變。
- `npm test`（目前 51 tests）、`npm run typecheck`、`npm run build` 均通過。
- Smoke 中發現並修正 `[hidden]` 被 flex layout 覆蓋的問題；popup 關閉狀態現已明確維持 `display: none`。

尚待確認：使用者在實際手機／瀏覽器上的視覺、觸控、長訊息捲動與軟鍵盤體驗；跨 tab 的 scripted/browser 第一輪已完成，但仍未宣稱 Groq live compatibility 或完整產品驗收通過。

### M1：可靠的小核心

在已可對話的核心補齊 typed tools、schema validation、approval、執行上限、版本化事件、memory store 與 deterministic regression。Pi 保持唯一 loop owner，工具預設依序執行；驗證工具往返、拒絕、取消、unknown outcome 與 late result。核心接受一個模型與少數工具即可執行，不依賴 UI、React、MCP 或 load balancer。

從本階段就讓獨立小範例透過公開 SDK/module 入口使用核心，避免到嵌入階段才發現 App 耦合。Groq 工具測試與上述三個任務分開記錄，基本聊天成功不能當成 tool-loop 通過。

第一輪實作紀錄（2026-10-31）：`AgentSession` 現在可注入 Pi `AgentTool`，由 Pi 負責 schema validation 與唯一 tool loop；產品邊界提供 `requiresApproval`、approval callback、每次 run 的 `maxToolCalls`、`deadlineMs`、`maxOutputCharacters`、abort-safe approval、version 1 public events 與 `MemorySessionEventStore`。`src/core/session-tools.test.ts` 與 `src/core/session.test.ts` 以 scripted fixtures 覆蓋 approved execution、approval rejection、invalid args、call limit、deadline、output limit、event recording 與 approval pending 時取消；`src/core/provider-transport.test.ts` 另以 localhost OpenAI-compatible SSE 驗證真實 provider adapter 的文字串流與 tool round-trip，但這不取代 Groq live acceptance。

### M2：持久化、恢復與最小 skills

依 M0-B 使用者回饋調整已存在的視窗；加入可替換 persistence，驗證 reload/recovery、tab/session identity 與未完成操作。補上最小 instructions/skills 載入，沿用同一工具與事件契約。完成三個 Groq 真實工具短任務，留下實際結果與失敗分類。

第一輪 persistence 實作紀錄（2026-10-31）：新增 `SessionStore`、`MemorySessionStore` 與注入 storage 的 `LocalStorageSessionStore`；`AgentSession.snapshot()`／`save()`／`fromSnapshot()` 保留 stable `sessionId`、model、system prompt 與 transcript，running session 不可 snapshot，snapshot version／identity／JSON/storage failure 均明確回報。`src/core/persistence.test.ts` 覆蓋 memory reload、local storage、identity mismatch、running session 與 event session filter。另加入 `WorkspaceStore`／`LocalStorageWorkspaceStore`，UI 會保存 tabs、active tab、draft、transcript 與 session snapshot，reload 後還原 identity；browser smoke 已驗證三個 tabs 與未送出 draft 可恢復，且 workspace snapshot 不承載 provider key。`LocalStorageSessionEventStore` 與 `inspectSessionRecovery()` 會保留可 replay 的 lifecycle metadata，reload 時只顯示 interrupted／outcome-unknown review notice，不自動重送工具副作用。`MemorySkillLoader`、`loadSkills()` 與 `composeSystemPrompt()` 提供按需、去重、大小受限的 deterministic skills 組合；`src/core/workspace-store.test.ts`、`src/core/session-recovery.test.ts` 與 `src/core/skills.test.ts` 覆蓋主要失敗路徑。Groq 三任務 live runner 已加入 `src/acceptance/groq-live.test.ts`／`npm run test:groq`，但本環境未提供 key，因此沒有虛構 PASS 結果。

### M3：可嵌入版本（第一輪 bridge 實作）

交付 JS loader、iframe bridge、SDK 入口與範例。目標使用方式是他人 HTML 以 `<script src=".../embed.js">` 載入，在宿主頁面 mount widget 或 popup；內部以 iframe 隔離 UI，再用 `postMessage` 傳遞 `ready`、`open`、`close`、`prompt`、`error` 等事件。純 HTML 與另一個框架專案完成導入，驗證隔離、destroy/remount 與宿主工具。提供清楚的認證／部署說明。

第一輪 embed 實作已完成：`src/embed.ts` 產生可用 ES module loader，支援 script data attributes、`window.AgentGoRound.mount()`、popup／inline surface、`open()`、`close()`、`toggle()`、`postMessage()`、`registerTool()`、`destroy()` 與 `ready` bridge；`src/core/embed-bridge.ts` 固定 bridge v2 的 instance／session／tool-call／request identity、allow-list、parent-side schema validation、host approval round-trip、一次性參數綁定 approval token、AbortSignal cancellation、timeout 與 `outcome_unknown`。`public/embed-example.html` 可作為純 HTML host page，`examples/react-host` 提供獨立 React host，兩者都註冊 read-only host tool；`src/main.ts` 已把 host tool catalog 映射到 Pi `AgentSession`，工具結果只透過已驗證的 parent origin 回傳，prompt／error lifecycle 也帶有 session／run identity。Browser smoke 已驗證 production preview 的同源與不同 localhost origin iframe handshake、host tool catalog ack、protected host tool approval callback、popup open／close、React mount 與 destroy/remount 基本 lifecycle。Bridge v2 與 SDK `0.2.0` 以 centralized exact-match compatibility guard fail closed；`npm run verify:dist` 會在部署前檢查 app、loader 與 example artifacts。已用 `VITE_BASE_PATH=/agent-go-round/ npm run build` 驗證 `index.html` assets、`embed.js` 與 GitHub Pages project-site 路徑；loader 預設 app URL 也會從 `embed.js` 所在目錄解析。正式遠端部署仍需 push 後由 GitHub Actions 發布並再次驗證公開 URL。

### M4：按實際需求擴充

評估 ChatGPT 訂閱 adapter、MCP discovery、context compaction 與 follow-up。模型可呼叫的跨 tab 詢問工具需沿用早期 router，加入授權、allow-list 與有限往返預算。Tree UI、steering、多模態、codemode、自動多代理編排及 voice 需有實際需求與獨立驗收後才加入。

目前已完成 M0-B 視覺與互動第一版、M0-B.1 手機／popup 共用直式 surface 第一輪實作與 browser smoke、M1 typed tool boundary 第一輪 deterministic regression、M2 persistence／workspace／skills／recovery 第一輪 regression，以及 M3 embed loader／iframe bridge／host-tool 第一輪 regression：Herdr-inspired sidebar、workspace tabs、獨立 agent pane、provider dialog、responsive surface、focus／Escape、使用者觸發跨 tab route、Pi-owned tool loop、approval／limit policy、versioned event sink、outcome-unknown handling、memory/local snapshot store、workspace reload、recovery review notice、on-demand skills composition、script embed、iframe isolation、origin-checked postMessage handshake、allow-listed host tools、approval-token permission boundary、bridge v2／SDK 0.2.0 exact-match compatibility 與 widget lifecycle 已建立。Groq live tool acceptance、公開 URL 更新與使用者實際視覺／觸控接受度仍需外部驗證，不宣稱 Groq live compatibility 或完整產品驗收已通過。
