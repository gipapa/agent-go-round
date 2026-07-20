# App Runtime Refactor - 2026-07

這份文件記錄 2026-07 針對 `src/app/App.tsx` 進行的兩次重構。目標不是追求單純的行數下降，而是把 domain state、可測試 runtime 與 UI ownership 從 app composition root 中分離，同時維持既有 chat、voice、MCP、skills、tutorial 與 MAGI 行為。

## Baseline

重構前 `App.tsx` 為 8,362 行，混合了：

- React state 與 persistence effects
- Credentials、voice、docs、skills、history CRUD
- Load balancer 與 model invocation
- Tool/skill decision prompts、retry 與 schema parsing
- MCP 與 built-in tool execution
- Tutorial session 與 workspace transitions
- Large UI panels、logs 與 error presentation

這使得小型修改也需要理解多個 domain，且許多流程只能透過整個 App 間接測試。

## Phase 1: Runtime And UI Boundaries

Commit: [`2b5cb11`](https://github.com/gipapa/agent-go-round/commit/2b5cb114be7867660b40d83c11c81fec4f9b0eba) `Refactor app runtime into tested modules`

`App.tsx`：8,362 -> 5,874 行。

### Extracted ownership

| Area | New modules | Responsibility |
|---|---|---|
| Credentials | `credentials/runtime.ts`, `credentials/useCredentialController.ts` | Credential state、provider/model lookup、API test helpers |
| Voice | `voice/useVoiceController.ts` | STT recording/transcription、TTS playback、probe state |
| Logging | `app/useAppLog.ts`, `runtime/logging.ts`, `ui/LogPanel.tsx` | Log normalization、sorting、display |
| Load balancing | `runtime/loadBalancerRunner.ts` | Candidate execution、retry/failover、diagnostics hooks |
| Tool decisions | `runtime/toolDecision.ts`, `toolDecisionPrompt.ts`, `toolExecution.ts` | Explicit routing、prompt catalog、intent/signatures/timeouts |
| Chat messages | `runtime/chatMessages.ts` | Message creation、tool summary markers、streaming helpers |
| Browser workflow | `runtime/browserWorkflow.ts` | Observation enrichment、grounded summaries、heuristics |
| Prompt tests | `runtime/promptTemplateTests.ts` | Prompt template API test specs and result normalization |
| MAGI/tutorial | `magi/managedAgents.ts`, `onboarding/agentManagement.ts` | Managed-agent and tutorial-agent normalization |
| UI | `ui/CredentialsPanel.tsx` | Credential editing presentation |

### Result

- App 主要保留組裝、跨 domain callbacks 與 workflow sequencing。
- Runtime logic 有明確輸入輸出，可直接單元測試。
- Voice 與 credentials 不再各自在 App 維護整套 state/effects。
- 新增 13 個聚焦測試檔，涵蓋 routing、LB、voice、credentials、logging 與 browser workflow。

## Phase 2: Controllers And Decision Execution

Commit: [`0eb8b9f`](https://github.com/gipapa/agent-go-round/commit/0eb8b9f97fdf4218d13da9e3ac0d91c0863571cb) `Extract app controllers and decision runtimes`

`App.tsx`：5,874 -> 4,633 行。

### Extracted ownership

| Area | New modules | Responsibility |
|---|---|---|
| Chat history | `chat/useChatHistoryController.ts` | Restore/persist、append/patch、limit、import/export、composer/fullscreen state |
| Docs | `resources/useDocsController.ts` | Loading、selection validity、create/save/delete/reload |
| Skills | `resources/useSkillsController.ts` | Skill package selection、docs/files、CRUD、import/export |
| Tutorial session | `onboarding/useTutorialSession.ts` | Scenario/step state、evaluations、hints、opened tool result state |
| Decision retry | `runtime/structuredDecision.ts` | Invoke/parse/retry/terminal failure lifecycle |
| Decision runners | `runtime/decisionRunners.ts` | Tool/skill/planner/verifier prompt execution and logging |
| Tool execution | `runtime/toolSelectionExecutor.ts` | Built-in/MCP routing、confirmation、execution、summary and logs |

Controllers 使用 injected stores 或 side-effect dependencies，讓測試不需要真實 IndexedDB、download 或 model provider。Decision runners 只由 App 注入 agent invocation 與 log sink，不再直接依賴 UI state。

### Result

- 第二階段新增 7 個測試檔。
- Tool executor 直接覆蓋 missing、blocked、built-in success 與 MCP success。
- Decision runner 直接覆蓋 prompt execution、normalization 與 deterministic fallback。
- 完整回歸驗證為 40 個 Vitest files、162 tests，另通過 ESLint、production build 與 browser smoke test。

## Architecture After Refactor

```text
App.tsx
  |
  +-- controller hooks --------> storage / browser side effects
  |     chat, docs, skills, credentials, voice, tutorial session
  |
  +-- runtime services --------> pure or dependency-injected decisions
  |     load balancing, prompts, schemas, tool execution, browser workflow
  |
  +-- orchestrators -----------> one-to-one, MAGI, multi-turn skill
  |
  +-- UI panels ---------------> props + callbacks
```

主要方向是讓 App 負責 wiring，而 controllers 負責 domain state，runtime services 負責 deterministic logic，UI components 負責 rendering。

## Intentionally Remaining In App

以下流程仍同時依賴多個 domain，目前保留在 App 以避免過早建立大型 context 或隱藏 dependency：

- `sendOneToOneTurn` / `onSend`
- `prepareSkillExecution` / `executeMultiTurnSkill`
- Tutorial workspace capture、transition、restore
- App-level load balancer、MAGI 與 deadline wiring

下一次拆分應先以 characterization tests 固定其 observable behavior，再將 orchestration 做成明確 state machine 或 application service。單純把大函式移到另一個檔案不算完成 ownership 分離。

## Rules For Future Work

1. Domain state、persistence 與 CRUD 放進 controller hook。
2. Prompt、parse、retry、routing 與 formatting 放進 runtime module。
3. UI component 不直接呼叫 provider、storage 或 MCP transport。
4. App 只保留跨 domain orchestration 與 dependency wiring。
5. 抽取時先維持 behavior，再做 contract redesign。
6. 每個新 boundary 至少補成功、失敗與 cancellation/retry 中相關的測試。

實作細節與日常修改規則請見 [AGENTS.md](../AGENTS.md)。
