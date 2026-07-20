# AGENTS.md

本文件提供 coding agents 與 contributors 修改 AgentGoRound 時需要的架構、驗證與安全規則。使用者文件請看 [README.md](./README.md)，近期 App 拆分背景請看 [docs/app-runtime-refactor-2026-07.md](./docs/app-runtime-refactor-2026-07.md)。

## Project Snapshot

- Vite 6、React 18、TypeScript 5.6
- Browser-first、frontend-only，沒有 application backend
- 沒有 router；主要頁籤與 modal 由 React state 控制
- `localStorage` 儲存設定，IndexedDB 儲存 docs、history 與 skills
- Agents 綁定 load balancers；instances 才持有 credential/model 選擇
- Build base 預設為 `/agent-go-round/`，可用 `BASE_PATH` 覆寫

## Commands

```bash
bash run.sh -dev           # :5566，啟動前會清掉該 port
npm run dev                # Vite 預設 dev server
npm test                   # Vitest full suite
npm run lint               # ESLint，max warnings = 0
npm run build              # tsc -b && vite build
npm run test:tutorial      # deterministic tutorial runtime check
npm run test:real_tutorial # real API/browser tutorial regression
cd mcp-test && bash run.sh -simple
```

`predev` 與 `prebuild` 會執行 `scripts/sync-graphify.mjs`。Build 因此可能重寫 `public/graphify/` 的 generated assets；不要手動修改那些輸出檔，應修改 `src/graphify/` 的來源。

## Source Boundaries

| Path | Responsibility |
|---|---|
| `src/app/` | App composition、跨 domain orchestration、app-level logging |
| `src/ui/` | React panels、modals、presentational components |
| `src/chat/` | Chat history state、persistence、import/export controller |
| `src/resources/` | Docs 與 skills state/controllers |
| `src/credentials/` | Credential controller、provider/model runtime |
| `src/voice/` | STT/TTS state、execution 與 playback |
| `src/runtime/` | 可獨立測試的 decision、tool、skill、browser 與 LB logic |
| `src/orchestrators/` | One-to-one、MAGI 等 model orchestration |
| `src/onboarding/` | Tutorial definitions、session state、workspace transitions |
| `src/mcp/` | MCP transports、client reuse、routing、tool catalog |
| `src/storage/` | Storage keys、serialization、migration、IndexedDB access |
| `src/schemas/` | Model structured output 的 Zod schemas |
| `src/__tests__/` | Unit、hook/controller 與 integration tests |

## App.tsx Rules

`src/app/App.tsx` 已從 8,362 行降到 4,633 行，但仍是跨 domain workflow 的組裝點。修改時遵守以下原則：

- 不要為單一 domain 直接增加一組新的 `useState`、storage effect 與 CRUD handlers；建立 controller hook。
- 純 prompt 組裝、schema normalization、retry、routing 或 result formatting 應放進 `src/runtime/`。
- 大型 panel 或 modal 應放進 `src/ui/`，由 props 接收 state/actions。
- App 可以保留需要同時協調 chat、skill、tool、tutorial、deadline 與 streaming 的 workflow。
- 抽取時先維持行為，再改善 API；不要同時重寫 prompt contract 或 persistence format。
- 新模組優先使用 dependency injection，讓 storage、download、confirm、model invoke 與 logging 可在測試替換。

目前刻意仍留在 App 的主要流程：

- `sendOneToOneTurn` 與 `onSend`
- `prepareSkillExecution` 與 `executeMultiTurnSkill`
- Tutorial scenario transition / workspace restore
- App-level load balancer 與 MAGI wiring

若要繼續拆分，先為欲移動流程補足 characterization tests，再移動 ownership。

## Runtime Conventions

- Model JSON：使用 `extractJsonObject`，再交給 `src/schemas/decisions.ts` 的 Zod normalizer。
- Structured retries：使用 `runStructuredDecision`，不要在每個 decision loop 重寫 retry/sleep。
- Tool execution：從 `createToolSelectionExecutor` 進入；MCP routing 走 `resolveMcpServerId`。
- MCP calls：使用 `mcpClientManager.run(server, ...)`；tool list 使用 `McpToolCatalog`，避免重複 client lifecycle。
- Logging：模組接受 `PendingLogEntry` sink；App 透過 `useAppLog` 顯示。保留 `requestId` 與 `stage`。
- Errors：使用 `errorMessage(error)`，不要使用 `catch (error: any)`。
- Cancellation：長時間工作要傳遞 `ExecutionDeadline` 或 `AbortSignal`。
- Agent model calls：優先走 load-balancer runner，不要在 UI component 直接呼叫 adapter。

## State And Storage

- Storage key 使用 `agr_*_v1` 命名並集中在 `src/storage/`。
- Persisted shape 改動需要 migration 或 backward-compatible normalization。
- 不要在 render path 直接讀寫 IndexedDB。
- Controller 應負責 load/reload、selection validity、CRUD completion 與 user-facing log。
- 不要將 API token、測試 credential 或使用者匯入資料寫入 repository、fixture 或 snapshot。

Credential vault 的 crypto implementation 位於 `src/storage/credentialVault.ts`，但目前 credential controller 仍使用既有 browser storage flow。除非同時完成 unlock lifecycle、migration、failure recovery 與 UI，否則不要只把其中一個 write path 改成加密。

## Testing Expectations

依變更範圍選擇最小測試，完成前再跑完整驗證：

```bash
npm test -- --run src/__tests__/affected.test.ts
npm run lint
npm run build
npm test
```

- Pure runtime：測成功、invalid schema、terminal failure 與 retry exhausted。
- Controller hook：使用 `renderHook`，注入 fake store，驗證 load、selection、CRUD 與 error log。
- Tool/MCP：至少測 unavailable、blocked/confirmation、success 與 routing failure。
- App workflow：行為改動需更新 `app.test.tsx` 或對應 integration test。
- UI/layout：啟動 dev server，以 desktop 與 mobile viewport 做 browser smoke test。
- Tutorial definition/runtime：至少跑 `npm run test:tutorial`；牽涉真實 provider/browser 時再跑 `test:real_tutorial`。

已知的 `--localstorage-file` warning 與 `safeStorage` corruption/quota stderr 是測試環境的預期輸出；不能因此忽略新的 warnings 或 failures。

## Frontend And MCP Constraints

- Browser 無法繞過第三方 CORS。Local relay 只解決本機開發，不代表 GitHub Pages 或手機可直連。
- 正式 remote MCP 應透過同源 HTTPS gateway，API token 留在 server-side secret store。
- Custom built-in tools 具有同-origin JavaScript 能力；新增 helper 前要重新評估資料外洩面。
- McpPanel 的 test connection 是一次性 health check，可以不經 pooled client；正式 tool execution 必須經 manager。
- MAGI 使用 `src/magi/magiSkills.ts` 固定 prompts，不走 Prompt Templates panel。

## Before Committing

1. `git diff --check`
2. 確認沒有 credentials、token、generated local data
3. 跑 affected tests、lint、build
4. 依風險跑完整 `npm test` 與 browser smoke test
5. 確認 `git status` 只包含本次工作

不要修改或回復不屬於目前任務的 dirty files。不要使用 destructive git commands 清理使用者變更。

## Further Reading

- [README.md](./README.md)
- [App runtime refactor](./docs/app-runtime-refactor-2026-07.md)
- [Multi-turn skill runtime design](./docs/skill-runtime-design.md)
- [Agentic workflow notes](./agentic.md)
- [Issue batches](./issue/)
