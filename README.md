# AgentGoRound

**AgentGoRound is a browser-first, frontend-only agent playground.** It runs entirely in the browser with no required backend, making it easy to experiment with multi-agent chat, docs context, MCP tools, and browser-side built-in tools, then deploy directly to GitHub Pages.

**AgentGoRound 是一個 browser-first、frontend-only 的 agent playground。** 整個專案以純前端為核心，不依賴必要後端服務；你可以直接在瀏覽器中管理 agent、文件、MCP tools、built-in tools 與對話歷史，並部署到 GitHub Pages。

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
  - 設定名稱、描述、大頭照、provider、endpoint、model
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
- Skills
  - 使用 `skill-name/SKILL.md + references/ + scripts/ + assets/` 格式
  - 技能包與 skill references 透過 IndexedDB abstraction layer 儲存
  - 支援單輪與多輪 skill runtime
- Profile 與 Credentials
  - 可設定使用者名稱、自我描述、大頭照
  - `Credentials` 集中管理 OpenAI / Groq / Custom provider keys
  - 相同 endpoint 的 agent 可共用同一組 key

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

- 支援 `openai_compat`、`chrome_prompt`、`custom`
- `openai_compat` 可從 `/models` 載入 active models
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
- History & Retry
- Docs
- MCP
- Skills
- Built-in Tools

### 2.1 Onboarding / 案例教學

- 入口在首頁 `使用案例教學`
- 目前提供兩個案例：
  - `[1] 自訂 Agent 並完成第一次對話`
  - `[2] 建立 DOC 並驗證內容注入`
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
  catalog.ts         Tutorial catalog + safe YAML parsing
  runtime.ts         Step entry / validation / restore logic
  types.ts           Tutorial schema / runtime types
  tutorials/
    first-agent-chat.yaml
    docs-persona-chat.yaml
```

### 3. Docs

- 每份文件都儲存在瀏覽器本地
- agent 若被允許使用某份 doc，該內容會在送 request 前注入 prompt context
- 這不是向量資料庫 / RAG pipeline，而是直接 prompt injection 的 MVP 設計
- 目前 Docs 案例教學會示範把一份人設文件內容注入 prompt，觀察回答是否受影響

### 4. MCP

- 透過 SSE 連接 MCP server
- 支援列出工具與手動 call tool
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
  - 會先在背景執行 verify / refine
  - 最後一輪答案再以 streaming 顯示
  - 可設定 verify 次數與 verifier agent

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

執行測試：

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

專案內附一個簡單的本機 MCP 測試 server：

```bash
cd mcp-test
bash run.sh
```

預設端點：

```text
http://127.0.0.1:3333/mcp/sse
http://127.0.0.1:3333/mcp/rpc
```

如果你是在 Windows 瀏覽器 + WSL server 的環境中測試，通常應優先使用 WSL IP，而不是 `127.0.0.1`。

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
