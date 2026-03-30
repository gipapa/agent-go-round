# AgentGoRound

**AgentGoRound is a browser-first, frontend-only agent playground.** It runs entirely in the browser with no required backend, making it easy to experiment with multi-agent chat, docs context, MCP tools, and browser-side built-in tools, then deploy directly to GitHub Pages.

**AgentGoRound 是一個 browser-first、frontend-only 的 agent playground。** 整個專案以純前端為核心，希望從網頁前端直接提供agentic所需能力，不依賴必要後端服務；你可以直接在瀏覽器中管理 agent、文件、MCP tools、built-in tools 與對話歷史，並部署到 GitHub Pages。

## 專案特色

- Landing / Onboarding
  - 首頁提供 `開始使用` 與 `使用案例教學`
  - 教學模式採左側 checklist + 右側真實操作介面
  - 案例內容以 YAML 定義，適合人類操作與 agent 驗證
  - YAML 解析失敗時不會讓整個 app 白屏，只會停用案例教學
- 純前端架構
  - 主要由 `Vite + React + TypeScript` 組成
  - 可直接部署到 `GitHub Pages`
  - 不需要自建 app server 才能使用主要功能
- Agent 管理
  - 新增 / 編輯 / 刪除 agent
  - 設定名稱、描述、大頭照與 load balancer
  - 依 agent 控制可使用的 docs、MCP、built-in tools、skills
- Chat
  - 支援一般聊天與 legacy 的 leader / team 協作模式
  - 對話歷史會保存在 IndexedDB，重新整理後可延續
  - 可匯入 / 匯出原始歷史與濃縮歷史
  - 支援全頁聊天模式
  - assistant 訊息可顯示思考中 / skill / tool 狀態
  - fenced code block 會以卡片方式顯示，並支援複製與收合
- Docs
  - 以 IndexedDB 儲存文件
  - 允許的 docs 會被注入對應 agent 的 system context
  - Docs 設定頁改成列表選取後再進入 `Edit` modal
- MCP
  - 以 SSE 連接 MCP server
  - 可自訂 Tool Decision Prompt
  - 支援中文 / English template
- Built-in Tools
  - 可直接撰寫瀏覽器端 JavaScript 工具
  - 可在編輯器內直接測試
  - 支援系統工具，例如 `get_user_profile`、`pick_best_agent_for_question`
  - 提供一個即時渲染的 tool 寫法，但因為可能有較大的失敗率所以不放在案例中：[render_anything.md](render_anything.md)

- Skills
  - 使用 `skill-name/SKILL.md + references/ + scripts/ + assets/` 格式
  - 技能包與 skill references 透過 IndexedDB abstraction layer 儲存
  - 支援單輪與多輪 skill runtime
- Profile 與 Credentials
  - 可設定使用者名稱、自我描述、大頭照
  - `Credentials` 集中管理 OpenAI-compatible provider 與多把 keys
  - 同一個 credential 可維護 key pool，供 load balancer instances 重複使用
  - 相同 endpoint 的多個 instances 可共用同一組 credential
- Load Balancer
  - agent 不再直接綁 provider / endpoint / model，而是綁一個 load balancer
  - 每個 load balancer 由多個有序 instances 組成
  - instance 可設定 model、description、retry 與 delay
  - 若 instance 失敗，runtime 會依序掃描下一個可用 instance

## 架構重點

### Frontend-only

這個專案刻意強調 frontend-only：

- agent 設定、credentials、MCP prompt templates 等資料主要存在 `localStorage`
- docs 與 chat history 主要存在 `IndexedDB`
- built-in tools 直接在目前頁面的瀏覽器環境中執行
- 如果 provider 支援 CORS，前端可以直接呼叫模型 API

這代表：

- 優點：部署簡單、開發快速、很適合做 agent workflow 原型
- 代價：API keys 與自訂 JS tool 都在瀏覽器端，安全性不適合作為正式生產方案

## 主要功能

### 1. Agents

- 遠端模型 agent 目前透過 load balancer 運作
- agent 編輯頁主要設定：
  - `Profile`
  - `Load Balancer`
  - `Access Control`
- `Load Balancer` 會決定：
  - provider / endpoint / key
  - model
  - retry / delay
  - failover 行為
- `chrome_prompt` 已改成 pseudo provider，可作為 load balancer instance 使用
- 編輯視窗可設定：
  - `Profile`
  - `Access Control`
- `Access Control` 可控制：
  - Skills
  - Docs
  - MCP tools
  - Custom JS tools / system built-in tools
  - `get_user_profile`
  - `pick_best_agent_for_question`

### 2. Chat Config

`Chat Config` 集中管理：

- Active agent
- Credentials
- Mode
- History
- Load Balancer
- Docs
- MCP
- Skills
- Built-in Tools

### 2.1 Credentials

- 一筆 credential 代表一個 provider/endpoint 設定
- 每筆 credential 底下可維護多把 key
- key 可逐把測試連線
- load balancer instance 會選擇：
  - credential
  - credential key

### 2.2 Load Balancer

- `Chat Config > Load Balancer` 採列表 + `Edit/Delete` modal
- 每個 load balancer 由多個有序 instances 組成
- instance 可設定：
  - credential
  - credential key
  - model
  - description
  - `maxRetries`
  - `delaySecond`
  - `resumeMinute`
- runtime 每次都從第 1 個 instance 開始掃描：
  - 若 instance 被標記 `failure` 且尚未到 `nextCheckTime`，會跳過
  - 若已超過 `nextCheckTime`，會重新嘗試
- `resumeMinute` 代表 instance 被標記 failure 後，要等多久才允許重新嘗試
- 請求成功後會清掉 failure 狀態；失敗則累積 `failureCount`

### 2.3 Onboarding / 案例教學

- 入口在首頁 `使用案例教學`
- 目前提供六個案例：
  - `[1] 自訂 Agent 並完成第一次對話`
  - `[2] 建立 DOC 並驗證內容注入`
  - `[3] 使用 Built-in Tools 完成工具對話`
  - `[4] 使用 Sequential Thinking Skill 驗證單輪能力`
  - `[5] 使用 agent-browser MCP 讀取 GitHub Trending`
  - `[6] 使用多輪 Skill 操作 GitHub Trending`
- 教學模式特性：
  - 左側固定 checklist 與系統提示
  - 右側保留真實可操作的 app 介面
  - 案例第一步介紹時可先保留 landing preview，再進入實際操作
  - 可 `略過案例` 或 `離開教學`
- 離開教學時：
  - 可選擇是否保留教學期間的 `doc / tool / mcp / skill`
  - `tool / skill` 會還原到教學開始前狀態
  - `Docs / MCP` 會清掉固定教學資源名稱：
    - `教學用DOC`
    - `教學用MCP`

- 教學案例以 YAML 定義，並搭配 runtime 驗證：

```text
src/onboarding/
  catalog.ts         Tutorial catalog + scenario wiring
  catalogCore.ts     YAML parser / normalization
  runtime.ts         Step entry / validation / restore logic
  types.ts           Tutorial schema / runtime types
  tutorials/
    first-agent-chat.yaml
    docs-persona-chat.yaml
    built-in-tools-chat.yaml
    sequential-skill-chat.yaml
    agent-browser-mcp-chat.yaml
```

#### 案例也可同時當作 Test Case

- onboarding 案例不是只有 UI 文案；預填對話、完成條件、工具 / skill 驗證條件也會跟同一份 YAML 連動
- 同一份案例資料可以同時服務：
  - 人類操作的導覽流程
  - 本地 smoke check
  - 真實瀏覽器端的 end-to-end 測試
- 這樣如果 YAML、runtime 行為與 UI selector 不同步，測試會直接失敗，不會等到上線才發現教學壞掉

### 3. Docs

- 每份文件都儲存在瀏覽器本地
- agent 若被允許使用某份 doc，該內容會在送 request 前注入 prompt context
- 這不是向量資料庫 / RAG pipeline，而是直接 prompt injection 的 MVP 設計
- 目前 Docs 案例教學會示範把一份人設文件內容注入 prompt，觀察回答是否受影響

### 4. MCP

- 透過 SSE 連接 MCP server
- 支援列出工具與手動 call tool
- 每個 MCP server 可設定：
  - `toolTimeoutSecond`
  - `heartbeatSecond`
- `toolTimeoutSecond` 會中止卡住的 RPC，避免工具無限執行中
- `heartbeatSecond` 代表閒置超過多久後，下一次工具呼叫前先做一次 `tools/list` 存活檢查；設為 `0` 可停用
- 自動工具判斷會先跑 `Tool Decision Prompt`
- 如果 model 回傳合法 schema，前端才會代呼叫 MCP 並把結果回填到最終問題中

### 5. Built-in Tools

- 自訂 JS tool 可直接使用：
  - `alert`
  - `window`
  - `document`
  - 其他目前頁面可用的瀏覽器環境
- `Test Runner` 可直接測試 `input schema` 與 JS code
- 內建系統工具也走同一套 built-in tools 架構：
  - `get_user_profile`
  - `pick_best_agent_for_question`
- 可設定「使用工具前需使用者確認」

### 6. Skills

- 匯入格式：

```text
skill-name/
├── SKILL.md
├── scripts/
├── references/
└── assets/
```

- `SKILL.md` 使用 YAML frontmatter + Markdown body
- `references/` 會依 `SKILL.md` 內的引用按需載入
- `scripts/` 與 `assets/` 會被存檔，但 script 目前不執行
- 支援建立空白 skill、編輯 `SKILL.md`、新增/刪除文字型 `references` 與 `assets`、重新匯出 zip

#### Skill Runtime

- `single_turn`
  - 輕量 skill 模式
  - 適合語氣調整、回答框架、輕量 docs/tool 輔助
  - 不會在最終回答後做 refine
- `multi_turn`
  - 採顯式 phase runtime，而不是單輪 tool decision 疊補丁
  - 會建立 todo 清單、追蹤 phase、在 chat 內顯示唯讀 todo 面板
  - completion gate 通過後，剩餘 todo 會自動收斂成 `completed`
  - 適合 browser automation、需要 `observe -> act -> observe` 的 workflow
  - 可設定工具步數上限、verify 次數與 verifier agent

多輪 skill 的完整設計與實作細節已整理在：

- [agentic.md](./agentic.md)

#### 技能與工具整合

- skill 先做 `skill decision`
- 若命中 skill，會載入 `SKILL.md`、references 與 skill scope
- 接著再進入 tool decision
- tool 仍然受 agent access control 與 skill workflow 的交集限制

### 7. Chat UI 行為

- 一般回答：直接 streaming 顯示
- `<think>...</think>`：
  - `</think>` 前只顯示「思考中…」
  - `</think>` 後的正式內容會繼續 streaming
- tool / skill：
  - 執行期間會顯示狀態，例如：
    - `正在載入 skill...`
    - `正在呼叫 MCP 工具...`
    - `正在進行 skill verify...`
  - multi-turn skill 命中時，assistant 訊息下方會直接顯示 todo 面板：
    - 目標
    - 待辦清單
    - 目前進行中
    - blocked 原因
  - 完成後可展開查看：
    - `查看思考過程`
    - `查看 tool result`
    - `查看 skill 流程紀錄`
- 第一、第二個 onboarding 案例在進入聊天步驟前，會自動清空對話歷史，避免驗證干擾

### 8. Legacy Goal-Driven Mode

- `goal-driven talking` 仍保留在專案中
- 目前已視為 legacy / deprecated 模式
- 新的 skill 多輪邏輯不依賴這條 orchestrator

## 本機啟動

安裝並啟動 dev server：

```bash
bash run.sh -dev
```

預設網址：

```text
http://127.0.0.1:5566/
```

一般啟動：

```bash
bash run.sh
```

## 測試與建置

教學案例 smoke check：

```bash
npm run test:tutorial
```

這個測試不會真的呼叫 LLM，主要確認：

- tutorial YAML 與 runtime 的預填對話保持同步
- 教學步驟完成條件能正確連動
- 關鍵案例不會因為文案或 selector 漂移而失效

真實教學案例測試：

```bash
npm run test:real_tutorial
```

這個測試會：

- 讀取專案根目錄的 `.tutorial-test.local.json`
- 自動啟動 `./run.sh -dev`
- 自動啟動 `./mcp-test/run.sh -agent_browser`
- 用真實瀏覽器跑完整個 onboarding 案例
- 逐案例列印真實執行狀態與 assistant 回覆
- 測試完成後自動清除本網站的 `localStorage` 與 `IndexedDB`

若你只想針對某一個案例做真實驗證，可以指定：

```bash
REAL_TUTORIAL_ONLY=chatgpt-browser-skill npm run test:real_tutorial
```

這對 multi-turn skill / agent-browser 這類高成本案例特別有用。

`.tutorial-test.local.json` 範例：

```json
{
  "provider": "groq",
  "apiKey": ["YOUR_GROQ_API_KEY_1", "YOUR_GROQ_API_KEY_2"],
  "endpoint": "https://api.groq.com/openai/v1",
  "model": "moonshotai/kimi-k2-instruct-0905"
}
```

注意：

- `test:real_tutorial` 目前是 `Groq-only`
- 案例 5 只驗證 MCP / browser automation 流程能跑通，不驗證最終內容品質
- 案例 6 的 acceptance 允許兩條成功路徑：
  - 真正完成 GitHub Trending -> 點第一名 repo -> 摘要內容
  - 正確辨識 blocked / manual 狀態並給出最終總結

Vitest 全量測試：

```bash
npm test
```

執行 build：

```bash
npm run build
```

## GitHub Pages 部署

直接部署：

```bash
npm run deploy
```

此指令會：

1. build 專案
2. 將 `dist/` 推到 `gh-pages` branch

## MCP 測試伺服器

專案內附一個本機 MCP 測試環境：

```bash
cd mcp-test
bash run.sh -simple
```

提供三種模式：

- `bash run.sh -simple`
  - 啟動簡單 SSE MCP server
  - 內含 `echo` 與 `time`
- `bash run.sh -agent_browser`
  - 自動 clone `vercel-labs/agent-browser`
  - 安裝相依與本地瀏覽器執行環境
  - 啟動 browser automation 的 SSE MCP server
- `bash run.sh -uninstall`
  - 清除這個專案在 `mcp-test` 目錄下建立的 node_modules / vendor / local browser home
  - 不會刪除使用者原本系統上的 Chrome / Chromium

常用端點：

```text
simple:
  http://127.0.0.1:3333/mcp/sse
  http://127.0.0.1:3333/mcp/rpc

agent-browser:
  http://127.0.0.1:3334/mcp/sse
  http://127.0.0.1:3334/mcp/rpc
```

如果你是在 Windows 瀏覽器 + WSL server 的環境中測試，通常應優先使用 WSL IP，而不是 `127.0.0.1`。

如果你的環境有全域 `HTTP_PROXY / HTTPS_PROXY`，記得把本機 MCP 加進 `NO_PROXY`，不然 `127.0.0.1` 的請求可能會被代理攔走。

## 資料儲存

- `localStorage`
  - agents
  - credentials
  - MCP prompt templates
  - UI state
- `IndexedDB`
  - docs
  - chat history
  - skills
  - skill references / scripts / assets

## 安全性注意事項

- 這個專案是純前端，所以 provider API keys 會存在瀏覽器端
- Custom built-in tools 會直接執行使用者輸入的 JavaScript
- 目前沒有 sandbox
- 正式上線若要保護 secrets，建議改成 server-side proxy 或自建 gateway

## 專案結構

```text
src/
  adapters/        Provider adapters
  app/             App shell
  mcp/             MCP SSE client + tool registry
  onboarding/      Tutorial schema / runtime / YAML scenarios
  orchestrators/   Chat orchestration
  runtime/         Skill runtime / executor
  storage/         localStorage / IndexedDB helpers
  ui/              React panels
  utils/           Shared utilities
docs/              Design notes
mcp-test/          Local MCP test server
run.sh             Dev / run helper
```
