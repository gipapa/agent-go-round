# AgentGoRound

AgentGoRound 是一個 browser-first、frontend-only 的 agent playground。它把多代理對話、skills、tools、docs、MCP、prompt routing、知識圖譜與教學案例整合在同一個前端應用裡，方便你直接在瀏覽器中設計、驗證與展示 agent workflow。

- 產品介紹導覽頁：[線上瀏覽](https://gipapa.github.io/agent-go-round/intro/) ｜ [PPTX](./public/intro/agent-go-round.pptx)
- 專案介紹與知識圖譜：[WIKI](https://gipapa.github.io/agent-go-round/graphify/wiki/index.html) ｜ [互動圖譜](https://gipapa.github.io/agent-go-round/graphify/graph.html) ｜ [純文字報告](https://gipapa.github.io/agent-go-round/graphify/GRAPH_REPORT.md)

## 功能重點

- Agents 與多代理互動
  - 可建立多個 agent，分別配置描述、權限與 load balancer
  - 支援一般一對一對話、`Radio / Walkie-Talkie` 半雙工語音模式，以及 `S.C. MAGI` 多代理裁決模式
- Load Balancer
  - agent 不直接綁死單一模型，而是綁定一個由多個 instances 組成的 load balancer
  - 支援 retry、delay、resume minute、failure 狀態與 failover
- Docs / MCP / Built-in Tools / Skills
  - docs 可直接注入 prompt context
  - MCP 以 SSE 連接外部工具
  - built-in tools 可直接執行瀏覽器端 JavaScript
  - skills 支援單輪與多輪 runtime，可做較複雜的 workflow
- Radio Mode
  - 人類端以 STT 持續累積 live transcript draft，說完並停頓一小段時間後自動送出
  - 送出前會先用 LLM 整理 STT 草稿，再把乾淨句子送進既有 one-to-one agent 流程
  - Agent 回覆完成後會再交給 TTS 念出來，必須等音訊播放結束才切回人類說話
  - Radio config 可直接測試 STT / TTS load balancer 與提示音，方便在正式對話前先驗證語音鏈路
- Prompt Templates
  - 將 tool decision、skill decision、skill runtime 等提示詞抽成 YAML
  - 內建中英文模板，並可直接在 UI 內做格式檢查與 API 測試
  - 目前主要覆蓋一般 chat routing 與 skill runtime；`MAGI` 不走這套模板
- Onboarding / 教學案例
  - 以真實 UI 搭配 YAML 定義的案例，引導使用者逐步完成設定與對話驗證
  - 案例同時可作為 smoke test 與 real tutorial test 的基礎資料
- Graphify 整合
  - 專案本身可輸出為 concept-first 的 WIKI、知識圖譜與報告
  - 讓功能、設計概念與模組之間的關係更容易理解與展示

## 技術重點

- 前端技術棧
  - `Vite + React + TypeScript`
  - 可直接部署到 `GitHub Pages`
- Browser-first 資料模型
  - `localStorage`：agents、credentials、prompt templates、部分 UI state
  - `IndexedDB`：docs、chat history、skills 與 skill assets
- Model routing
  - 透過 OpenAI-compatible API + load balancer 管理 provider、model 與 key pool
  - 支援 tool decision、skill decision、chat response 等不同階段的 routing
- Voice I/O
  - Radio mode 的 STT / TTS 也走 load balancer，讓語音 I/O 與一般 chat 一樣有 key pool、failure state 與 failover
  - Radio settings 仍保留語音專屬參數，例如 `STT language`、`STT temperature`、`Whisper prompt`、`chunk seconds` 與 `voice`
- Skill runtime
  - `single_turn`：適合語氣控制、回答模板、輕量技能
  - `multi_turn`：適合 observe / act / verify 類流程，如 browser workflow
- Prompt engineering workflow
  - decision 類 prompt 以較保守的 machine-oriented 模板為主
  - 可直接在 Prompt Templates 面板裡用真實 API 驗證模板輸出是否符合預期
- MCP 與 browser workflow
  - 目前 MCP 以 SSE 為主，適合串接 agent-browser 這類工具
  - 多輪 skill 可根據工具結果持續規劃下一步
- 近期重構方向
  - 將 radio config、radio helpers、agent failure 分類與 load balancer diagnostics 從 `App.tsx` 中拆出，降低單一檔案承擔的邊界
  - 強化 tutorial 與 browser MCP 的 routing 容錯，減少 model 對工具名稱與 serverId 的輕微偏差造成的失敗

## 主要模組

- Chat Config
  - 管理 active agent、credentials、load balancers、docs、MCP、skills、built-in tools、prompt templates 與 radio settings
- Agents
  - 管理 agent profile、load balancer 與 access control
- Skills
  - 使用 `SKILL.md + references/ + assets/` 結構管理技能包
- Onboarding
  - 用案例教學帶使用者走過 agent、doc、tool、skill、MCP 與 browser automation
- MAGI
  - 提供三賢人表決與共識兩種多代理模式
  - MAGI 目前使用固定的內建 skills 與 orchestrator prompt，不經由 Prompt Templates 面板切換或編輯
- Radio
  - 提供半雙工對講機模式，重用現有 one-to-one agent runtime，外層再包 STT / refine / TTS / turn control
  - 使用獨立的 Radio config panel 與對講機 overlay UI，讓語音工作流不再直接塞在主聊天表單裡
- Graphify
  - 為專案本身生成 WIKI、互動圖譜與報告

## 本機啟動

```bash
bash run.sh -dev
```

預設網址：

```text
http://127.0.0.1:5566/
```

## 測試與建置

教學案例 smoke test：

```bash
npm run test:tutorial
```

真實案例測試：

```bash
npm run test:real_tutorial
```

這次重構完成後，已重新執行 real tutorial 作為回歸驗證。

只測單一案例：

```bash
REAL_TUTORIAL_ONLY=chatgpt-browser-skill npm run test:real_tutorial
```

建置：

```bash
npm run build
```

## MCP 測試伺服器

專案內附本機 MCP 測試環境：

```bash
cd mcp-test
bash run.sh -simple
```

常用模式：

- `bash run.sh -simple`
- `bash run.sh -agent_browser`
- `bash run.sh -uninstall`

## Frontend-only 風險與部署提醒

這個專案刻意採 frontend-only 設計，適合做 agent workflow 原型、教學、展示與 UI/UX 實驗，但不應直接視為可公開線上部署的安全架構。

需要注意：

- provider API keys 目前保存在瀏覽器端
- custom built-in tools 會以同 origin 權限執行 JavaScript
- docs、skills、prompt templates 與部分設定也都保存在使用者本機
- MCP 目前以 SSE 為主，整體能力邊界與傳統 server-side agent 平台不同

如果要對外正式提供服務，建議至少補上：

- server-side proxy / gateway
- secret 與 arbitrary JS execution 的隔離
- 更嚴格的 tool / credential trust boundary
- 明確的多使用者資料隔離策略
