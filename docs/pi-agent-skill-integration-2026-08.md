# Pi Agent Harness 大改完成紀錄 - 2026-08

這份文件記錄 `docs/pi-agent-skill-integration-plan.md` 所規劃的 Pi-style canonical action loop、Skill runtime 與 App boundary 重構，在 2026-08 的實際落地結果。原 plan 保留作為設計決策、限制與 rollout gate 的基準；本文件記錄實際完成的程式邊界、相容性與驗證狀態。

## 結果摘要

- One-to-one 與 Skill execution 共用單一 sequential canonical action loop，不再依賴 bootstrap planner、step planner、completion gate 或 verifier。
- OpenAI-compatible provider 優先使用 native tool calls；Custom 與 Chrome Prompt 保留 strict text action protocol 相容路徑。
- Canonical transcript、bounded context projection、tool catalog、skill/resource loading 與 typed terminal outcome 都由 runtime contract 管理。
- Built-in、MCP 與 internal skill tools 經 `ToolEffectRunner` 統一執行；confirmation、permission、schema validation、deadline、abort 與 unknown effect 不由模型自行決定。
- App 保留跨 domain wiring、chat streaming、tutorial transition 與 load-balancer orchestration；controller、runtime 與 UI ownership 已移到各自模組。
- 舊的 multi-stage skill runtime、planner、verifier、tool-selection executor 與相關 prompt templates 已移除。

## 實作邊界

| Layer | 主要實作 | 責任 |
|---|---|---|
| Harness core | `src/runtime/harness/` | canonical transcript、action loop、events、limits、ownership 與 terminal semantics |
| Context | `src/runtime/harness/contextProjector.ts` | deterministic bounded model projection、catalog/skill/resource/tool-result budgets |
| Transport | `src/runtime/harness/transports.ts`、`src/adapters/` | native/text action normalization、typed provider failure、failover 與 capability |
| Effects | `src/runtime/toolEffectRunner.ts` | internal skill tools、built-in tools、MCP routing、confirmation、outcome normalization |
| Skill | `src/runtime/harness/skillTools.ts`、`src/storage/skillStore.ts` | progressive `skill.load` / `skill.read`、package validation、scope intersection 與 resource limits |
| Chat | `src/chat/useAgentHarnessController.ts`、`src/chat/harnessChatTurn.ts` | single active run、generation ownership、late-result drop 與 UI/persistence projection |
| App/UI | `src/app/App.tsx`、`src/ui/` | cross-domain composition、panel/modal presentation、tutorial workflow |
| Browser test | `mcp-test/agent-browser-sse/`、`scripts/real-tutorial-runner.ts` | local agent-browser MCP、macOS lifecycle、fresh-session tutorial verification |

## 重要行為變更

### 一般對話與 Skill 共用同一條 loop

模型每一步只會產生 typed `tool_call` 或 `final`。Tool result 會以 canonical message 回到同一份 transcript，錯誤會保留 outcome 與 error code，讓模型能修正、換工具或清楚回報阻塞原因。

### Tool effect 與 UI/persistence 分離

`ToolEffectRunner` 不直接修改 React state 或 chat history。每個 call ID 最多 dispatch 一次；MCP timeout 或取消後若無法確認 server-side effect，會保留 `outcome_unknown`，不自動重送可能有副作用的操作。

### Skill 是 progressive context

Skill catalog 只提供 metadata；符合任務後由 internal `skill.load` 載入 instructions，需要時再由 `skill.read` 載入 references/assets。Skill 權限與 Agent 權限取交集，`scripts/` 只保存、檢視與匯出，不會成為 executable tool。

### Context 有共同上限

Model projection 對 system protocol、tool catalog、skill instructions、resources、tool results 與 model response 都套用上限。Tool result 只保留 bounded data 與 truncation marker，不以另一個模型重新摘要來掩蓋 context limit。

### Adapter failure 使用 typed contract

Network、HTTP、rate limit、auth、abort、empty response、provider failure 與 response limit 不再以一般 assistant 文字表示。Load balancer 依 typed failure 做 retry/failover，protocol invalid 不會被當成網路失敗。

## 相容性與限制

- 既有 persisted chat history 維持可 render；新 run 的完整 canonical transcript 只存在記憶體，UI/persistence 使用 redacted projection。
- 專案仍是 browser-first、frontend-only。第三方 remote MCP 若沒有 CORS，正式部署仍需要同源 HTTPS gateway；gateway secret 不應打包到前端。
- Native tool calling 是 primary path。Text protocol 只在 adapter/model 通過 capability conformance 後使用；不符合者維持 tool-less 或 unavailable。
- Tutorial 的 Groq 本機設定放在被 `.gitignore` 排除的 `.tutorial-test.local.json`，不應提交任何 credential、token 或測試資料。

## 驗證結果

截至 2026-08-26：

- `npm test -- --run`：52 個 test files、291 個 tests 全數通過。
- `npm run lint`：通過，無 warning。
- `npm run build`：通過；Vite 仍提示主 JavaScript bundle 超過 500 kB，這是 bundle size warning，不影響建置。
- `npm run test:tutorial`：通過。
- `git diff --check`：通過。
- Desktop/mobile browser smoke test：通過。

Plan 中要求的 primary native-tool real tutorial「fresh browser session 連續成功 10 次」尚未宣稱完成。實際驗證已確認 skill loading、Groq native model call、browser open 與 snapshot 可運作；後續一次流程受到 Groq 免費 tier 的 rate limit 影響，另一次在低成本模型下出現不穩定的 GitHub element ref。這是 provider quota 與 model/browser action reliability 問題，不應被記錄成成功的 rollout gate。

## 後續工作

1. 使用新的或等待恢復額度的 Groq key，在 fresh browser profile 重新跑 `REAL_TUTORIAL_GATE=1` 的 10-session gate。
2. 若 real gate 仍失敗，優先分析 `skill trace`、typed transport failure 與 browser MCP stderr，再決定是否調整模型、context budget 或 browser tool contract。
3. 若要支援正式多使用者部署，補上 server-side gateway、secret isolation、tool trust boundary 與資料隔離。
