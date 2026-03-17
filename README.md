# AgentGoRound

**AgentGoRound is a browser-first, frontend-only agent playground.** It runs entirely in the browser with no required backend, making it easy to experiment with multi-agent chat, docs context, MCP tools, and browser-side built-in tools, then deploy directly to GitHub Pages.

**AgentGoRound 是一個 browser-first、frontend-only 的 agent playground。** 整個專案以純前端為核心，不依賴必要後端服務；你可以直接在瀏覽器中管理 agent、文件、MCP tools、built-in tools 與對話歷史，並部署到 GitHub Pages。

## 專案特色

- 純前端架構
  - 主要由 `Vite + React + TypeScript` 組成
  - 可直接部署到 `GitHub Pages`
  - 不需要自建 app server 才能使用主要功能
- Agent 管理
  - 新增 / 編輯 / 刪除 agent
  - 設定名稱、描述、大頭照、provider、endpoint、model
  - 依 agent 控制可使用的 docs、MCP、built-in tools
- Chat
  - 支援一般聊天與 leader / team 協作
  - 對話歷史會保存在 IndexedDB，重新整理後可延續
  - 可匯入 / 匯出原始歷史與濃縮歷史
  - 支援全頁聊天模式
- Docs
  - 以 IndexedDB 儲存文件
  - 允許的 docs 會被注入對應 agent 的 system context
- MCP
  - 以 SSE 連接 MCP server
  - 可自訂 Tool Decision Prompt
  - 支援中文 / English template
- Built-in Tools
  - 可直接撰寫瀏覽器端 JavaScript 工具
  - 可在編輯器內直接測試
  - 支援內建 helper，例如 `pick_best_agent_for_question`
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
  - Docs
  - MCP tools
  - Custom JS tools
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
- Built-in Tools
- Skills（預留）

### 3. Docs

- 每份文件都儲存在瀏覽器本地
- agent 若被允許使用某份 doc，該內容會在送 request 前注入 prompt context
- 這不是向量資料庫 / RAG pipeline，而是直接 prompt injection 的 MVP 設計

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
- 目前也有隱藏內建工具可供 agent 使用：
  - `get_user_profile`
  - `pick_best_agent_for_question`

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
  orchestrators/   Chat orchestration
  storage/         localStorage / IndexedDB helpers
  ui/              React panels
  utils/           Shared utilities
mcp-test/          Local MCP test server
run.sh             Dev / run helper
```
