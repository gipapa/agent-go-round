# AgentGoRound

AgentGoRound 是一個 browser-first、frontend-only 的 agent workflow playground。它把 agents、load balancers、docs、MCP、built-in tools、skills、voice 與多代理模式整合在同一個 React 應用中，適合用來建立原型、驗證 workflow 與製作教學案例。

- [產品介紹](https://gipapa.github.io/agent-go-round/intro/) | [PPTX](./public/intro/agent-go-round.pptx)
- [Graphify WIKI](https://gipapa.github.io/agent-go-round/graphify/wiki/index.html) | [互動圖譜](https://gipapa.github.io/agent-go-round/graphify/graph.html) | [純文字報告](https://gipapa.github.io/agent-go-round/graphify/GRAPH_REPORT.md)
- [2026-07 App runtime 重構紀錄](./docs/app-runtime-refactor-2026-07.md)

## 核心能力

### Agents 與模型路由

- 一般一對一對話與 `S.C. MAGI` 多代理裁決模式
- Agent 綁定 load balancer，不直接綁死單一 provider key 或 model
- Load balancer 支援 retry、delay、暫停恢復、failure state 與 failover
- OpenAI-compatible、custom、Chrome Prompt 與 A2A adapter

### Context 與工具

- Docs 可注入 agent prompt context
- Built-in tools 可執行瀏覽器端 JavaScript，並支援確認與 timeout
- Skills 使用 `SKILL.md + references/ + assets/` 結構，支援 single-turn 與 multi-turn runtime
- Prompt Templates 可在 UI 中編輯、驗證格式並呼叫真實 API 測試

### Remote MCP

- 支援 Streamable HTTP 與 legacy SSE
- 支援 Bearer token、自訂 headers、MCP session headers 與 client reuse
- Tool catalog 會合併並去重並行的 `tools/list` 請求
- Tavily 等未開放 browser CORS 的服務，本機開發可使用內建 relay

瀏覽器或手機無法繞過第三方服務的 CORS 限制。若要從 GitHub Pages 或手機上的正式網址呼叫這類 remote MCP，應部署同源 HTTPS gateway，並將 API token 保存在 gateway 端，而不是打包進前端。

### Voice

- 對話輸入框可使用 STT 協助打字，辨識後仍可編輯再送出
- User 與 assistant 訊息可手動播放 TTS
- STT / TTS 各自使用 load balancer，保留 failure state 與 failover
- Voice Config 可獨立測試語音鏈路與參數

### Onboarding 與 Graphify

- YAML 教學案例會操作真實 UI，可同時作為 smoke test 基礎
- Graphify 將專案內容產生為 WIKI、知識圖譜與報告

## 架構

```text
src/app/          應用組裝與跨域 workflow orchestration
src/ui/           Panels、modals 與呈現元件
src/chat/         Chat history state、匯入匯出與 persistence controller
src/resources/    Docs 與 skills controllers
src/credentials/  Credential state 與 provider runtime
src/voice/        STT / TTS controller 與 runtime
src/runtime/      Decision、tool、skill、browser 與 load-balancer runtime
src/orchestrators/ One-to-one、MAGI 等高階 orchestrators
src/onboarding/   Tutorial catalog、session 與 workspace helpers
src/mcp/          MCP transports、client manager、routing 與 tool catalog
src/storage/      localStorage / IndexedDB stores 與 migrations
src/schemas/      模型結構化輸出的 Zod schemas
```

`App.tsx` 仍負責跨越多個 domain 的送訊息、multi-turn skill 與 tutorial transition orchestration；domain state、可獨立測試的 runtime 與 UI panels 已逐步移出。詳細邊界與兩次重構內容請見 [App runtime 重構紀錄](./docs/app-runtime-refactor-2026-07.md)。

## 資料儲存

- `localStorage`：agents、credentials、prompt templates 與部分 UI state
- `IndexedDB`：docs、chat history、skills 與 skill assets

資料預設只存在目前瀏覽器。清除網站資料、換裝置或換瀏覽器 profile 都可能看不到原本內容；重要資料應先使用各 panel 的匯出功能備份。

## 本機啟動

```bash
npm install
bash run.sh -dev
```

預設網址：<http://127.0.0.1:5566/>

也可以直接使用 Vite：

```bash
npm run dev
```

`predev` 與 `prebuild` 會自動執行 `scripts/sync-graphify.mjs`，同步 Graphify 靜態內容。

## 測試與建置

```bash
npm test                 # 完整 Vitest suite
npm run lint             # ESLint，禁止 warnings
npm run build            # TypeScript + production bundle
npm run test:tutorial    # Tutorial runtime smoke test
npm run test:real_tutorial
```

只執行單一 real tutorial：

```bash
REAL_TUTORIAL_ONLY=chatgpt-browser-skill npm run test:real_tutorial
```

## MCP 測試伺服器

```bash
cd mcp-test
bash run.sh -simple
```

其他模式：

```bash
bash run.sh -agent_browser
bash run.sh -uninstall
```

`mcp-test/server.js` 會驗證 JSON-RPC body、`id`、`method` 與 tool call 參數；格式錯誤會回傳 400，不會讓 fixture server crash。

## 文件

- [App runtime 重構紀錄](./docs/app-runtime-refactor-2026-07.md)
- [Multi-turn skill runtime 設計](./docs/skill-runtime-design.md)
- [Agentic workflow notes](./agentic.md)
- [Coding agent / contributor guide](./AGENTS.md)
- [Open issue batches](./issue/)

## 安全與部署限制

這個專案刻意採 frontend-only 設計，適合 prototype、教學與內部展示，不應直接視為 production secret architecture。

目前需要注意：

- Provider credentials 由瀏覽器端管理
- Custom built-in tools 會以同 origin 權限執行 JavaScript
- Docs、skills、prompt templates 與部分設定保存在使用者本機
- 未開放 CORS 的 remote MCP 需要 server-side gateway
- 靜態前端不應內嵌共享 API token

公開部署前，至少應加入 server-side gateway、secret 隔離、tool execution trust boundary 與多使用者資料隔離策略。
