# Pi Agent 核心設計借鏡與純前端 Skill Harness 穩定化計畫

## 1. 最終判定

AgentGoRound 應借鏡 Pi Agent 的單一 tool loop，但不能只複製 loop 外型。Pi 的小核心建立在 provider-native tool calls、typed model errors、argument validation、可轉換的 context 與明確 effect hooks 上。AgentGoRound 目前缺少其中數項，若直接把既有 adapter 與 `createToolSelectionExecutor` 接進新 loop，只會得到比較簡單、但仍可能誤判錯誤、重複副作用、撐爆 context 或被 inline JavaScript 卡死的 harness。

因此本計畫的 go/no-go 判定是：

- 現有 multi-stage skill runtime 必須淘汰。
- 新 harness 可以維持 browser-first、frontend-only。
- 在 transport、effect、context 與 browser lifecycle contracts 完成前，不得把新 path 稱為 stable 或設為 default。
- 全部硬性 invariants 完成後，純前端不是穩定性的阻礙；外部 provider、CORS 與 MCP server 的失敗必須被 containment，而不是被假裝消除。

### 1.1 「穩定」的可驗證定義

本計畫中的 stable harness 不代表模型每次都會完成任務，而是同時符合以下條件：

| Property | Required invariant |
|---|---|
| Safety | 同一 `callId` 最多 dispatch 一次；未知副作用不自動重試；權限與 confirmation 不能由模型繞過 |
| Liveness | 每個 live run 都在 final、typed failure、abort、deadline 或 limit 中結束；可終止工具不能留下背景工作 |
| Boundedness | model context、tool catalog、skill instructions、resource、tool result、events 與 persisted projection 都有硬上限 |
| Consistency | Canonical transcript 只 append；UI 由 events 投影；abort 後的 late result 不能修改 run 或 chat |
| Diagnosability | 每個 run 都能還原 transport、tool dispatch/result、skill/resource load 與唯一 terminal reason |

模型提前 final、選錯工具或無法遵守 text action protocol 屬於 task/model reliability。Harness 必須清楚失敗，但不能用額外 planner、completion gate 或 verifier 掩蓋它。

## 2. 範圍與限制

1. AgentGoRound 維持 browser-first、frontend-only，不新增 application backend。
2. 所有 provider 呼叫仍經 adapter 與 load balancer；skill 不繞過 credential、retry 或 failover。
3. OpenAI-compatible 優先支援 provider-native tool calling；Custom 與 Chrome Prompt 可使用 text protocol compatibility path。
4. Adapter/model 未通過 action protocol conformance 時，只能執行 tool-less chat，不能假設「能回文字」就能跑 harness。
5. 不加入 steering、執行中的插入對話、follow-up queue 或 durable crash resume。
6. 一個 user run 最多載入一個 skill；skill 不互調，external tool 不能反向啟用另一個 skill。
7. Agent 與 skill 的 MCP / built-in tool 權限永遠取交集，skill instructions 與 resources 都視為 untrusted model context。
8. Skill package 的 `scripts/` 只保存、檢視與匯出，不成為 executable tools。
9. Arbitrary same-origin inline JavaScript 不屬於 stable path；可執行的 custom code 必須可隔離與終止。
10. 不把 Pi 的 Node filesystem、shell tools、durable session backend 或 TUI 搬進前端。
11. 靜態部署仍受 CORS 限制；remote MCP 若需要同源 HTTPS gateway，該 gateway 是 deployment dependency，不是 frontend harness backend。

## 3. Pi Agent 真正值得借鏡的核心

### 3.1 一個 loop，而不是多個 decision services

Pi 的 `agent-loop.ts` 每一 turn 只做三件事：

1. 將目前 transcript 送給模型。
2. 若模型產生 tool calls，驗證並執行，再把 tool results append 回 transcript。
3. 若模型沒有 tool calls，就以該 assistant response 結束 run。

Planning、tool selection、錯誤修復與 completion 都由同一個模型、同一份持續 context 完成。Harness 只負責 deterministic control flow，不另外詢問另一個模型「是否完成」。

### 3.2 Tool result 是 context，不是 prompt patch

Pi 將 assistant tool call 與 tool result 保存成 typed messages。工具失敗也會成為正常 tool result，讓模型在下一 turn 修正參數、換工具或說明阻塞原因。

AgentGoRound 現在多數工具結果被串進 `currentContext` 或 synthetic input，再由不同 decision prompt 截取一部分。新版必須使用 canonical run transcript，避免每一層重新摘要前一層。

### 3.3 Skill 是 progressive context

Pi 的 skill 系統只負責：

- catalog 放 name、description、location。
- task 符合時載入完整 `SKILL.md`。
- instructions 需要時再讀 references/assets。

Skill 不啟動專屬 planner engine。對 AgentGoRound 而言，`skill.load` 與 `skill.read` 應是同一個 loop 可呼叫的 internal tools。

### 3.4 Deterministic policy 放在 effect boundary

Pi 的 argument validation、`beforeToolCall`、`afterToolCall`、abort signal 與 stop hook 都位於 tool effect 邊界。權限、confirmation、參數 schema、deadline 與安全限制不交給模型自行遵守。

AgentGoRound 應保留相同分工：模型選擇 action；runtime 決定 action 是否存在、是否被允許、能否 dispatch，以及結果如何進入 transcript。

### 3.5 小 loop 依賴的 supporting contracts

Pi 的 loop 能維持小，是因為其他層已提供：

- provider-native assistant/tool result message types。
- model error、abort 與 stop reason，不以普通文字冒充錯誤。
- tool argument schema validation。
- `transformContext` 作 context pruning/轉換。
- effect hooks 與 tool execution lifecycle。

AgentGoRound 的 text-only adapters、string failure detection、heuristic tool intent 與 input augmentation 尚未提供這些保障。本計畫必須先建立等價 contracts，再縮小 core loop。

### 3.6 不直接照搬的部分

- Pi 的 steering / follow-up queues：本次明確排除。
- Pi durable harness 的 operation lanes、session replay 與 crash recovery：第一版不需要。
- Pi 的 bash/read/write tools：不符合純前端與目前安全邊界。
- Pi parallel tool batch：第一版維持 sequential，避免 confirmation、MCP lifecycle 與結果排序增加複雜度。

## 4. 現有 Harness 的不穩定來源

### 4.1 模型呼叫鏈過長

一次 multi-turn skill run 可能包含 skill decision、bootstrap、每步 planner、額外 tool decision、completion gate、final answer 與 verifier。Planner repair 或 verify/refine 又會增加呼叫。

問題：

- failure probability 隨模型呼叫數累積。
- 每個 stage 都可能觸發獨立 provider retry。
- 同一任務的 reasoning 被切散，無法沿用前一 turn 的 assistant context。
- load balancer failover 後，不同模型可能對各 stage 做出不一致判斷。

### 4.2 多個元件同時擁有流程決策權

目前下一步可能由 browser heuristic、bootstrap action、fast tool decision、skill planner、mustObserve/mustAct repair 或 completion gate 決定。它們各自合理，合在一起後卻難以回答「這一步為什麼發生」。

新版只能有一個 model action source。Runtime heuristics 只能做 validation 或 safety guard，不能替模型規劃另一條流程。

### 4.3 Context 以字串搬運並反覆壓縮

`currentContext` 混合 user input、tool summaries、browser observations 與 runtime hints，再被不同 prompt 以不同字數截斷。Tool messages 在部分 adapters 又被 history filter 排除。

這會造成：

- 早期工具結果在後續 step 消失。
- 模型難以區分 user intent、assistant decision 與 tool output。
- prompt marker 或工具輸出干擾下一個 JSON decision。
- trace 無法還原模型當時實際看到的 context。

### 4.4 Todo、phase 與 verifier 成為第二套真相

Todo status、`mustObserve`、completion status 與 verifier 結果可能和工具實際狀態不一致。Todo 適合顯示，不應控制 loop。

新版 UI 只由 loop events 投影。一般 assistant text 是唯一正常完成訊號，不再額外跑 completion gate。Verifier 若保留，只能是使用者明確啟動的 run 後操作，不屬於核心 harness。

### 4.5 Adapter errors 與正常文字共用通道

目前 `AgentAdapter.chat()` 的 `done.text` 同時承載正常回答與 `Request failed: ...`。Load balancer 再以字串規則判斷 retry/failover。這會導致 partial abort、provider 自己產生的相似文字或未涵蓋的新錯誤被誤判。

新 harness 不能直接建立在這個 string contract 上。

### 4.6 Tool timeout 不等於 tool cancellation

目前 MCP timeout 使用 `Promise.race`；client 端停止等待後，server-side tool 仍可能完成。Inline built-in JavaScript 的 timeout 也不能中止同步執行或 main-thread infinite loop。

如果 runtime 將 timeout 一律當成「未執行」，模型可能重複送出 click、submit、write 或其他 non-idempotent action。這是 effect correctness 問題，不是增加 retry 可以修復的問題。

### 4.7 Context、catalog 與 tool output 沒有共同 budget

Append-only transcript 若完整送入每次 model request，仍會隨 tool output、browser snapshot、docs、skill instructions 與 resource 增長。MCP tool schemas 也可能在第一步就超過較小模型的 context window。

Canonical transcript 與 model projection 必須分離；完整 logical history 不代表無限制傳給模型。

### 4.8 Browser lifecycle 會產生 late results

Abort、tab navigation、tutorial restore、component unmount 或新 run 取代舊 run 後，既有 async model/tool promise 仍可能 resolve。只靠 React `isStreaming` 或 skill ID lock，不能保證舊結果不 patch 新狀態。

Controller 必須擁有 run generation，所有 await boundary 都需重新驗證 ownership。

## 5. 目標架構：Minimal Browser Agent Loop

```text
Chat / Skill UI
      |
      v
AgentHarnessController  -- single active run owner / lifecycle
      |
      v
runAgentLoop(state, transport, contextProjector, registry, policy)
      |                 |                    |
      | model step      | bounded context    | validated effect
      v                 v                    v
HarnessTransport   ModelContextProjector   ToolEffectRunner
      |                                      |
      v                                      +-- internal skill tools
typed load balancer                           +-- isolated built-ins
and adapters                                  +-- MCP client manager
```

Core loop 是 pure runtime module，不讀 React state、不直接操作 IndexedDB、不顯示 dialog，也不認識 MCP client lifecycle。Side effects 經 injected transport、context projector、tool registry、effect runner、event sink 與 clock/deadline。

### 5.1 Canonical transcript 與 tool outcome

```ts
type HarnessToolOutcome =
  | "success"
  | "rejected"
  | "failed_before_dispatch"
  | "failed"
  | "outcome_unknown";

type HarnessToolCall = {
  callId: string; // runtime generated
  toolId: string;
  input: unknown;
  origin: "model" | "controller";
};

type HarnessMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; action?: HarnessToolCall; protocolValid: boolean }
  | {
      role: "tool";
      callId: string;
      toolId: string;
      outcome: HarnessToolOutcome;
      modelContent: string;
      errorCode?: string;
    }
  | {
      role: "runtime";
      kind: "protocol_error" | "context_notice";
      content: string;
    };
```

Invariants：

1. Transcript 在 run 內只 append，不重寫早期 message。
2. 每個 tool message 必須對應一個先前 assistant action 與唯一 `callId`。
3. `callId`、`origin`、outcome 與 `errorCode` 都由 runtime 產生，模型不能指定。
4. Transcript 只保存已正規化且有大小上限的 `modelContent`；raw tool details 不直接進 transcript。
5. 完整 transcript 預設只存在記憶體。Persisted chat 只保存 final/stop outcome 與 redacted event projection。

### 5.2 Bounded ModelContextProjector

`ModelContextProjector` 從 canonical transcript 產生每一步真正送給模型的 context。它是 deterministic pure function，不呼叫模型摘要。

```ts
type ContextBudget = {
  maxTotalChars: number;
  maxCatalogChars: number;
  maxSkillInstructionChars: number;
  maxResourceChars: number;
  maxSingleToolResultChars: number;
  maxModelResponseChars: number;
};
```

第一版 conservative fallback：

- `maxTotalChars = 48_000`
- `maxCatalogChars = 16_000`
- `maxSkillInstructionChars = 16_000`
- `maxResourceChars = 16_000` per run
- `maxSingleToolResultChars = 8_000`
- `maxModelResponseChars = 64_000`

Adapter/model capability 可以提供更小或更大的 budget，但不能靜默超過。Projection rules：

1. 永遠保留 base system/action protocol、最新 user goal、loaded skill instructions 與最近完整 tool-call/result pair。
2. Tool call 和 result 不可拆開裁切。
3. 舊 tool results 只保留 deterministic capped prefix、truncation marker、原始長度與 digest，不做 LLM summarization。
4. Tool schema 不可截成 invalid JSON。Catalog 超過 budget 時，要求使用者縮小 agent allowlist，或以 `tool_catalog_too_large` 在 preflight 結束。
5. Required context 本身超過 budget 時，以 `context_budget_exceeded` 結束，不送出註定失敗的 provider request。
6. Browser screenshot/binary/raw details 不放入 text projection；需要視覺能力時由支援的 native transport 處理，否則提供 bounded textual observation。

### 5.3 單一 model action protocol

Core loop 只接受 transport 正規化後的兩種 step：

```ts
type HarnessAssistantStep =
  | { type: "tool_call"; toolId: string; input: unknown; assistantText?: string }
  | { type: "final"; answer: string };
```

Provider wire format 由 transport 擁有，不能滲入 core loop。

#### NativeToolTransport

OpenAI-compatible provider 若支援 tools，應在第一個 production phase 使用 native tool definitions、assistant tool calls 與 tool result messages。Provider-specific function name 與 call ID aliases 只存在 transport projection 內，回到 core 前映射成 canonical IDs。下一步若 failover 到不同 candidate，該 candidate 從 canonical transcript 重建一組自己可接受、call/result 成對的 aliases。

第一版 native step 也只能包含一個 tool call。Provider 一次回多個 calls，或以 token/length stop reason 截斷 tool arguments 時，整個 step 視為 protocol error，所有 calls 都不得執行。Native assistant 同時提供的 bounded text 可保存為 `assistantText`，但不能被誤判為 final。

#### TextActionTransport

Text compatibility path 只將完整 response 符合以下 exact envelope 的內容視為 tool call：

```json
{"type":"tool_call","toolId":"internal:skill.load","input":{"skillId":"pdf-processing"}}
```

Rules：

1. 只接受完整 response 或包在單一 `json` code fence 內的單一 object；不使用 `extractJsonObject` 從任意敘述中挖 JSON。
2. Transport 只驗證 envelope 結構：`type` 必須正確、`toolId` 必須是 string 且 `input` 欄位存在。Unknown tool 與 tool-specific input schema invalid 由 core preflight 產生 paired `failed_before_dispatch` tool result，不消耗 protocol-repair 次數。
3. 一般非 action envelope 的 assistant text 是 final answer，不要求長文字包 JSON。
4. 看似 action envelope 但 malformed 時回 `protocol_error`，不能降級成 final。
5. 每個 model step 最多一個 tool call。
6. Tool results 使用結構化 serialization、escaping 與長度 marker；它們是 untrusted data，不直接拼接成新的 system instructions。
7. 每個 candidate response 完整 buffer 並通過 typed outcome/protocol parse 後才 commit；failover attempt 的 partial deltas 不進 chat。
8. Streaming response 超過 `maxModelResponseChars` 時立即 abort 該 attempt 並回 typed `response_limit`；不能持續累積到 browser memory exhausted。

### 5.4 Typed transport 與 adapter capability

```ts
type HarnessTransportResult =
  | { status: "step"; step: HarnessAssistantStep; candidateId: string }
  | { status: "protocol_error"; rawPreview: string; candidateId: string }
  | {
      status: "transport_error";
      kind: "network" | "http" | "rate_limit" | "auth" | "empty" | "provider" | "response_limit";
      retryable: boolean;
      message: string;
    }
  | { status: "aborted"; message: string };

type ToolCallingCapability = "native" | "text_protocol" | "none";
```

Required changes：

1. `AgentAdapter.chat()` 必須以 typed `error`/`aborted` event 回報失敗，不能再把 `Request failed:` 放在一般 `done.text`。
2. Load balancer 依 typed error 做 retry/failover；provider 成功回覆但 protocol invalid 不可被當成 network failure。
3. 每個 load-balancer candidate 記錄 tool-calling capability 與 context budget。Harness 只選擇 compatible candidates。
4. Custom adapter 必須真的轉送 system/action protocol 與 rendered transcript；若 body template 無法承載必要欄位，capability 為 `none`。
5. Text capability 必須通過無副作用 conformance probe；不能只依 adapter type 推定。結果依 candidate/model/template revision cache，任一 revision 改變就失效。
6. Native 與 text transport 都輸出同一 `HarnessTransportResult`，不分叉 core loop。

### 5.5 Headless ToolEffectRunner

新 harness 不直接重用目前的 `createToolSelectionExecutor`，因為它同時 append chat messages、組 prompt summary、顯示 confirmation 與執行 effect，會建立第二套 transcript ownership。

先抽出：

```ts
interface ToolEffectRunner {
  execute(call: HarnessToolCall, context: HarnessToolContext): Promise<HarnessToolResult>;
}

type HarnessToolResult = {
  outcome: HarnessToolOutcome;
  modelContent: string;
  displaySummary: string;
  errorCode?: string;
  rawDetails?: unknown;
};
```

`ToolEffectRunner` rules：

1. 不操作 React/chat history，不修改 prompt，不直接組 UI 文案。
2. Validation、authorization、confirmation、dispatch、normalization 各自留下 event。
3. Confirmation 是 injected、abortable async function；stable path 不依賴 synchronous `window.confirm`。
4. Raw details 只能交給當前 event/UI projection，必須先 redaction、serialization guard 與 size cap；不可持久化 arbitrary/circular value。
5. Core 對每個 `callId` 最多呼叫 runner 一次。Runner 不在 dispatch 後自動 retry effect。
6. 遷移期間由 legacy `createToolSelectionExecutor` 包裝新的 effect runner，不能反過來讓新 harness 包裝 legacy executor。

Canonical tool IDs：

- `internal:skill.load`
- `internal:skill.read`
- `builtin:<builtInToolId>`
- `mcp:<serverId>:<toolName>`

### 5.6 Explicit tool metadata 與 validation

```ts
type HarnessToolDefinition = {
  id: string;
  description: string;
  inputSchema: JSONSchema7;
  intent: "observe" | "mutate" | "control" | "context";
  idempotency: "idempotent" | "non_idempotent" | "unknown";
  cancellation: "terminable" | "cooperative" | "none";
  requireConfirmation: boolean;
  executionKind: "internal" | "worker" | "trusted_local" | "mcp" | "legacy_inline";
};
```

Rules：

1. 使用 Ajv 或等價的成熟 JSON Schema validator 編譯與驗證 arguments；validator 在目前 browser/CSP 不可用時 fail closed，schema invalid 的 tool 不進 run snapshot。
2. Intent 不再由名稱/description heuristic 決定 runtime security policy。Heuristic 只能在匯入 UI 提供建議值。
3. MCP annotations 若存在就保存；使用者可在 server/tool policy 覆寫。沒有可信 metadata 時，預設 `mutate + unknown idempotency + requireConfirmation`。
4. `legacy_inline` 不進 `pi_loop_v1` stable registry。
5. User-authored computation tools 只允許 Worker execution。Worker API/CSP 不可用時該 tool 標記 unavailable，不得 fallback inline。需要 DOM 的功能改成 reviewed、靜態匯入的 `trusted_local` declarative handler，不能執行 arbitrary same-origin code。
6. MCP timeout/abort 後 invalidate client；若 request 已 dispatch 且 server 不支援 cancellation，outcome 是 `outcome_unknown`。
7. 外部 schema 在 compile 前限制 serialized size、nesting depth、property count 與 combinator complexity；禁止 remote `$ref`。超限或 duplicate canonical tool ID 直接排除並產生 stable diagnostic。

### 5.7 Run state、ownership 與 events

```ts
type HarnessRunState = {
  runId: string;
  generation: number;
  stepCount: number;
  toolCallCount: number;
  transcript: HarnessMessage[];
  loadedSkillId?: string;
  loadedResourcePaths: string[];
  pendingObservation: boolean;
  terminal: boolean;
};

type HarnessStopReason =
  | "final"
  | "aborted"
  | "deadline"
  | "step_limit"
  | "stalled"
  | "protocol_error"
  | "transport_error"
  | "unsupported_transport"
  | "context_limit"
  | "response_limit"
  | "tool_unavailable"
  | "effect_unknown";
```

Controller invariants：

1. 每個 chat workspace 同時只有一個 active run；lock 以 run ownership 為單位，不以 skill ID 為單位。
2. 每次 model、confirmation、storage、MCP 與 tool await 後，都要檢查 `AbortSignal`、`runId` 與 generation。
3. Ownership 失效後的 late result 只能記錄 `late_result_dropped`，不能 append transcript、event projection 或 patch chat。
4. Live process 中每個 run 只 emit 一個 `run_end`。Browser 被直接關閉時不宣稱成功寫入 terminal event；下次 load 以 persisted UI state recovery 標記 interrupted。
5. `pagehide`、controller unmount、tutorial restore 與 stop action 都 best-effort abort active run；deadline 使用 absolute `expiresAt`，browser 從 background suspension 恢復後在下一個 boundary 重新檢查。

Event stream 至少包含 `run_start`、`model_step_start/end`、`transport_failover`、`tool_preflight`、`tool_dispatch`、`tool_result`、`skill_loaded`、`resource_loaded`、`context_projected`、`protocol_repair`、`late_result_dropped` 與 `run_end`。Core event sink 必須是 synchronous/non-blocking；persistence 在 loop 外訂閱。Sink exception 不得中斷 core loop。

### 5.8 Planned module boundaries

建議新增以下 ownership，不把新 state machine 塞回 `App.tsx`：

| Path | Responsibility |
|---|---|
| `src/runtime/harness/types.ts` | Canonical messages、events、outcomes、budgets 與 stop reasons |
| `src/runtime/harness/runAgentLoop.ts` | Pure sequential loop、dispatch ledger 與 terminal invariants |
| `src/runtime/harness/contextProjector.ts` | Bounded deterministic model projection |
| `src/runtime/harness/textActionProtocol.ts` | Exact text envelope render/parse；不呼叫 provider |
| `src/runtime/harness/toolRegistry.ts` | Snapshot tool definitions、metadata、schema validators 與 canonical IDs |
| `src/runtime/toolEffectRunner.ts` | Headless built-in/MCP/internal effect execution |
| `src/runtime/harness/transports.ts` | Native/text normalization，透過 injected load-balancer invoke |
| `src/chat/useAgentHarnessController.ts` | Single active run、snapshot、confirmation、UI/persistence projection |

現有 `createToolSelectionExecutor` 在 H-1 改成 legacy adapter；adapter-native wire parsing 可留在 `src/adapters/`，但只能輸出 typed events。Contracts 落地後同步更新 `AGENTS.md` 的 runtime convention。

## 6. Skill 如何進入同一個 Loop

### 6.1 Immutable capability snapshot

每個 user run 開始時建立 immutable snapshot：

- active agent、permission revision 與 selected load-balancer capabilities
- 已通過 validation 的 skill catalog
- 已成功載入 schema 的 MCP / built-in tools 與 explicit metadata
- docs、prompt template 與 storage revision
- context budgets 與 deadline

建立 snapshot 時先同步 MCP catalog。CORS、gateway、connection 或 schema validation 失敗的 tools 不得出現在 model catalog。Skill 的必要能力必須以 trusted metadata `requiredToolIds` 明確宣告，不能從 prose 猜測；只是 allowed/optional 的 unavailable tool 直接從交集移除。Explicit skill 缺 required tool 時，在第一個 model call 前以 `tool_unavailable` 結束；automatic catalog 則排除當下無法滿足 required capabilities 的 skill。

Registry 或 agent 設定在 run 中改變，只影響下一個 run。Snapshot 不跨 browser refresh durable；中斷 run 不做 crash resume。

### 6.2 Automatic activation

System 只放允許 automatic activation 且符合 catalog budget 的 skill name、description 與 logical location。Catalog entries 使用 bounded structured framing，description 只作 untrusted discovery data，不能插入 system policy。若完整 eligible catalog 超過 budget，automatic activation fail closed 並顯示 diagnostic；不能靜默漏掉部分 skills。使用者仍可 explicit activation。模型需要 skill 時呼叫：

```json
{"type":"tool_call","toolId":"internal:skill.load","input":{"skillId":"pdf-processing"}}
```

`invocationSource` 不屬於 model input。Registry 根據 `HarnessToolCall.origin` 注入 trusted execution context：model call 永遠是 `automatic`，controller synthetic call 才能是 `explicit`。

`skill.load` deterministic rules：

1. 驗證 skill 存在、有效且在 run snapshot 中 allowed。
2. Automatic activation 拒絕 `disable-model-invocation`；explicit activation 允許。
3. 若已載入同一 skill，回傳 idempotent success。
4. 若已載入不同 skill，回傳 `skill_switch_blocked`；不切換 skill。
5. Instructions 超過 context budget 時回傳 `skill_instructions_too_large`，不靜默裁掉必要規則。
6. 回傳 frontmatter-stripped instructions 與 bounded resource summaries，不預載全部 resources。
7. 依 agent scope 與 skill workflow policy 更新可見 external tools；只能縮小，不能擴大。

### 6.3 Explicit activation

使用者由 UI 或 `/skill:name args` 明確啟用時，controller 在第一次 model step 前呼叫同一個 internal loader，並 append `origin: "controller"` 的 synthetic assistant tool call + tool result。不建立另一條 execution path。

`disable-model-invocation` skill 不出現在 automatic catalog，但允許 explicit activation。

### 6.4 Resource read

`internal:skill.read` 只允許讀目前 loaded skill 的 canonical relative path。Input 可包含 `path`、`offset` 與 bounded `maxChars`，讓大型文字採 deterministic chunking，而不是整檔塞入 context。

第一版限制：

- 每個 run 最多讀 3 個 distinct resources。
- 所有 resource chunks 合計受 `ContextBudget.maxResourceChars` 限制。
- 單次最多回傳 8,000 chars；尚有內容時提供 `nextOffset`、total length 與 digest。
- 只將文字 references/assets 放入模型 transcript。
- absolute path、`..`、unknown path、binary、oversize package file 與 scripts 都回傳 stable error code。
- 同一路徑相同 range 重複讀取回傳 cached result，不重讀 IndexedDB。
- Resource content 永遠不能修改 tool scope、invocation source 或 runtime policy。

## 7. Loop 與 Failure Semantics

### 7.1 Straight-line procedure

```text
append user message
while limits/deadline/ownership allow:
  modelContext = project(transcript, snapshot, budget)
  transportResult = transport.runStep(modelContext, tools)

  if typed transport failure:
    finish(typed stop reason)

  if protocol invalid:
    append invalid assistant + runtime protocol error
    repair once, otherwise finish(protocol_error)

  if final:
    append assistant answer
    finish(final)

  if tool_call:
    runtime creates callId and appends assistant action
    validate -> authorize -> confirm -> dispatch once
    append normalized tool result
    continue
```

Completion 只有 final assistant text 一種正常來源。不執行 bootstrap planner、completion gate 或 automatic verifier。

### 7.2 固定 limits

第一版 defaults：

- `maxModelSteps = 12`
- `maxToolCalls = 10`
- `maxProtocolRepairs = 1`
- `maxDistinctSkillResources = 3`
- context、catalog、instruction 與 output limits 使用第 5.2、6.4 節設定
- 沿用 app-level `ExecutionDeadline` 與 `AbortSignal`

達到 limit 時以明確 failure outcome 結束，不要求模型勉強產生 fallback answer，也不把 tool output 拼成看似成功的回覆。

### 7.3 Protocol repair

模型回傳 malformed action 時：

1. Append bounded invalid assistant output，標記 `protocolValid: false`。
2. Append `runtime/protocol_error`，只描述 exact contract 與 validation error，不包含新的 task instructions。
3. 同一 run 允許一次 repair model step。
4. 第二次仍 invalid 就以 `protocol_error` 結束。

Protocol repair 不使用 provider retry delay。Network/429 retry 屬於 typed transport/load balancer；格式修復屬於 loop，兩者不能共用 counter。

### 7.4 Dispatch 與 effect outcome

1. Model request retry/failover 發生在接受 assistant step 前，不會觸發 tool effect。
2. Tool connection setup 只能在 request 尚未 dispatch 前 retry。
3. Core 對同一 `callId` 最多 dispatch 一次；tool runner 不做透明 effect retry。
4. `failed_before_dispatch` 可讓模型修正後建立新 call。
5. `outcome_unknown` 表示 effect 可能已發生。對 non-idempotent mutate/control call，禁止相同 signature 直接重試，先進入 observation/reconciliation。
6. 沒有可用 observation tool，或 observation 仍無法確認狀態時，以 `effect_unknown` 結束並清楚告知使用者。

這提供 run 內 at-most-once dispatch，但不宣稱在 browser hard crash 與遠端 server 之間提供 distributed exactly-once。

### 7.5 Tool failure recovery

Unknown tool、invalid arguments、permission denied、confirmation rejected、MCP routing failure 與 tool exception 都轉成具 stable `errorCode` 的 tool result。Transport envelope/schema failure 才屬於 protocol error；tool-specific argument validation 屬於 effect preflight。

模型可以在下一 step 修正，但 runtime 套用：

- 同一 `toolId + normalized input + errorCode` 連續兩次，結束為 `stalled`。
- `rejected` 不得再次要求同一 confirmation。
- `outcome_unknown` 套用第 7.4 節，不當成一般 retryable error。
- Tool output serialization 失敗時回 `tool_result_unserializable`，不能讓 core loop throw。

### 7.6 Deterministic browser guard

Browser effect guard 使用 explicit tool metadata：

- `mutate/control` dispatch 後立即設定 `pendingObservation = true`；即使 outcome unknown 也保留。
- pending 時若模型再選 `mutate/control`，preflight 回傳 `observation_required`。
- 成功 `observe` 後清除 pending；若 observation 顯示狀態仍未知，維持 pending。

這取代 `mustObserve` planner repair；不新增模型 decision，也不替模型挑 observation tool。

### 7.7 Abort、confirmation 與 late result

- Abort/deadline 先阻止後續 dispatch，再要求 transport/terminable tools cancellation。
- Worker tool 以 terminate 結束；MCP 盡力 cancel/close client，dispatch 後無法確認時回 `outcome_unknown`。
- Confirmation 由 controller 提供 abortable async modal。Run ownership 失效時 modal 自動關閉並視為 aborted，不回到舊 run。
- Late model/tool result 一律丟棄，不得產生 assistant final 或 success event。
- 第一版不支援 pause/resume。

## 8. UI、Persistence 與相容性

### 8.1 新 UI projection

- Chat 顯示 model/tool/skill status 與 terminal outcome。
- Todo panel 改為 activity timeline：skill loaded、resource read、tool preflight、dispatch、result、final/stop reason。
- Trace 顯示 canonical tool ID、bounded input/result summary、duration、outcome、error code 與 effect certainty。
- Text transport 的中間 JSON action、protocol repair raw output與完整 skill instructions不顯示成 assistant 對話。
- `outcome_unknown` 必須使用明確警示，不得顯示成功或自動隱藏。

### 8.2 Persistence policy

Canonical run transcript 與 raw details 預設 ephemeral。IndexedDB 只保存：

- user message 與 final/typed failure content
- redacted bounded activity projection
- runId、skill ID、counts、duration 與 terminal reason

不保存 credentials、完整 skill instructions、完整 MCP output、binary、unredacted tool input 或 confirmation payload。

Browser reload 時，persisted `isStreaming` 或沒有 terminal outcome 的新-harness assistant message正規化為 interrupted/aborted display state；不嘗試重播 effect。

### 8.3 舊 history

既有 `skillTodo`、`skillPhase` 與 `skillTrace` 維持可讀，舊訊息使用目前 renderer。新 harness 不再寫 planner todo/phase；persisted shape 改動使用 backward-compatible normalization。

### 8.4 Settings migration

遷移期間新增 internal feature flag：

```ts
type SkillHarnessVersion = "legacy" | "pi_loop_v1";
```

- 初始整合預設 `legacy`，供現有使用者回退。
- `pi_loop_v1` 通過第 10 節 gates 後改為預設。
- 最終移除 legacy path 時一併移除 `SkillExecutionMode`、single/multi toggle、verifier agent、verify max 與 planner tool-loop settings。
- 舊 localStorage keys 可忽略，不做 destructive migration。
- 不做 shadow model/tool execution，避免雙倍 provider 成本與重複外部副作用。

## 9. 分階段實作

### H-1：Transport、Effect 與 Browser Safety Contracts

這是進入新 loop 前的 blocking phase。

1. 為現有 one-to-one、skill、load balancer、MCP timeout、abort 與 built-in execution 補 characterization tests。
2. 將 adapter/model completion 改成 typed success/error/aborted contract，移除新 path 對 `Request failed:` 字串判斷的依賴。
3. 為 load-balancer candidate 加入 `ToolCallingCapability` 與 context budget。
4. 抽出 headless `ToolEffectRunner`；legacy executor 改為包裝它並維持舊行為。
5. 加入成熟、browser-compatible 的 JSON Schema validation、schema complexity limits、explicit intent/idempotency/cancellation metadata 與 conservative defaults。
6. 定義 `ContextBudget`、bounded result normalization、async confirmation 與 run ownership primitives。
7. Stable registry 排除 arbitrary `legacy_inline` tools；不切換 App 使用者 path。

完成條件：底層 contract 可獨立測試，現有 legacy workflow behavior 不變，且新 core 不需要依賴 string errors、UI append 或 inline executor。

### H0：Pure loop、transcript 與 context projector

1. 實作 pure `runAgentLoop`、canonical types、event sink 與 scripted fake transport/effect runner。
2. 實作 transcript invariants、唯一 terminal event、limits、protocol repair、stall detection、abort/deadline 與 late-result drop。
3. 實作 deterministic `ModelContextProjector` 與所有 budgets。
4. 實作 dispatch ledger 與 `outcome_unknown` semantics。
5. 不接 App、不改使用者行為。

完成條件：core 不依賴 React、storage、adapter、MCP 或 browser globals；所有 success/failure branches 可由 fake clock、transport 與 tools 驅動。

### H1：Native/Text transports 與 effect integration

1. 實作 OpenAI-compatible `NativeToolTransport`，正確累積 streaming tool-call arguments 與 provider stop/error reason；multiple/truncated calls 整批拒絕且不 dispatch。
2. 實作 strict `TextActionTransport`，供 Custom/Chrome 與不支援 native tools 的 compatible provider 使用，並在 streaming boundary 執行 response size limit。
3. 實作 capability probe；`none` candidate 不進 harness load-balancer plan。
4. 將 built-in/MCP definitions 映射成 validated `HarnessToolDefinition`，執行走 headless effect runner 與 `mcpClientManager`。
5. MCP calls 傳遞 signal、timeout 後 invalidate client，並正確產生 `outcome_unknown`。
6. User code 僅允許 terminable Worker；Worker/CSP unavailable 時 fail closed。Reviewed static system handlers 才能標記 `trusted_local`。
7. MCP catalog/schema/connection failure 在 snapshot 階段收斂成 unavailable capability。

完成條件：不載入 skill 的一般 tool workflow，可在 native 與合格 text transport 完成 final、success、rejected、failed、unknown outcome、abort 與 failover；不直接呼叫 legacy executor。

### H2：Skill internal tools 與 progressive disclosure

1. 建立 immutable capability snapshot。
2. 實作 `internal:skill.load` 與 chunked `internal:skill.read`。
3. Automatic/explicit activation 都寫入同一 transcript，且 invocation source 無法由模型偽造。
4. 套用單 skill、instruction/resource budgets、agent intersection、explicit `requiredToolIds`、tool availability 與 scripts 禁止執行規則。
5. Skill instructions/resource output 使用 untrusted-data framing，不得改寫 runtime policy。

完成條件：skill activation、resource read、external tool 與 final 全部在一個 loop 中完成，不呼叫 legacy planner/gate/verifier；缺 tool 或超出 context 時 deterministic fail-fast。

### H3：Controller、App/UI 遷移與 legacy 移除

1. 建立 `useAgentHarnessController` 或等價 controller，負責一般 tool 與 skill 共用的 active run ownership、snapshot、async confirmation、page lifecycle 與 UI event projection。
2. `sendOneToOneTurn` 以 feature flag 接入 controller，不在 `App.tsx` 增加另一組 domain state machine。
3. 更新 deterministic tutorials、real browser skill tutorial 與 persisted interrupted-state normalization。
4. 新 path 通過 rollout gates 後改為 default。
5. 移除 legacy skill decision、bootstrap planner、step planner、completion gate、verify/refine、multi-turn state machine 與 prompt templates。
6. 移除 single/multi/verifier runtime controls；保留舊 history renderer。

最終 App 仍可協調 chat、tutorial、deadline、load balancer 與 streaming，但不再包含 skill 專用 planner callbacks。

### H4：Agent Skills package hardening

Harness 穩定後再完成 package 相容性：

1. 使用現有 `yaml` package 實作完整 frontmatter parser 與 stable diagnostics。
2. 驗證 name/description、單一 root、唯一 `SKILL.md`、duplicate path、absolute path、root escape 與 package/file size。
3. 缺 description、malformed YAML 或 instructions 超出 runtime budget 的 skill 不進 automatic catalog。
4. DB schema 保存 source/provenance、diagnostics、`disableModelInvocation`、media type、size 與 digest。
5. Blob-backed resources 確保 arbitrary package file import/export bytes 不變；scripts 仍不可執行。
6. 保留 fenced `skill-config` 作 legacy adapter，新 package 使用標準 frontmatter 加 namespaced AgentGoRound metadata 或獨立 `agr.json`。

格式正確不能修復 multi-decision pipeline，因此 H4 不得阻塞 H-1 至 H3；H2 仍先實作必要的 runtime size/path validation。

## 10. 測試與 Rollout Gates

### 10.1 Pure loop/property tests

- 第一個 step 直接 final。
- tool success -> result -> final。
- rejected/failed-before-dispatch/failed -> model recovery -> final。
- malformed action -> repair success；第二次 malformed -> protocol_error。
- 每個 action 都有唯一 runtime callId；同一 callId 永不 dispatch 兩次。
- outcome unknown -> observation required；沒有 observation -> effect_unknown。
- 相同 definitive failure 連續兩次 -> stalled。
- max steps/tools、context limit、deadline 與 abort 各自只產生一個 terminal event。
- 任意 event sink throw 不會破壞 loop terminal invariant。
- Transcript append-only、tool pairing 與 event ordering property tests。

### 10.2 Context與 protocol tests

- Total/catalog/skill/resource/tool-result budgets 各自超限。
- Tool call/result pair 不被 projection 拆開。
- Tool schema 不被截斷；oversized catalog fail-fast。
- Oversized/deep/combinator-heavy schema、remote `$ref` 與 duplicate canonical tool ID 被 fail-closed 排除。
- Model response stream 超限時中止並回 response_limit，不保留 unbounded raw output。
- Untrusted tool output 包含 action envelope、delimiter、HTML、system-like text 時只當 data。
- Untrusted skill catalog description 無法插入或覆蓋 system policy。
- Exact text envelope、single code fence、narrative + JSON、multiple objects、unknown tool 與 invalid input。
- Native single call、multiple calls、truncated arguments 與 length stop reason；invalid batch 零 dispatch。
- Custom adapter 缺 system/history placeholder 時 capability 為 none。
- Protocol invalid 不觸發 network retry counter。

### 10.3 Tool/effect tests

- JSON Schema validator compile/argument validation success 與 failure。
- Intent metadata 缺失時保守預設，不依工具名稱猜 safety policy。
- Permission、async confirmation accept/reject/abort 與 repeated rejection。
- MCP unavailable、routing failure、timeout before dispatch、timeout after dispatch 與 late success。
- Timeout 後 client invalidation；late success 不改寫 outcome_unknown。
- Worker terminate、Worker/CSP unavailable fail closed；legacy inline tool 不進 stable registry。
- Circular/oversized/binary tool output 正規化。
- Mutate dispatch 後必須 observe，包含 error/unknown outcome。

### 10.4 Skill tests

- Disabled/no allowed skills 時 catalog 為空但一般 loop可 final。
- Automatic skill catalog 超出 budget 時 fail closed，explicit activation 仍可用。
- Automatic、explicit 與 `disable-model-invocation`；模型不能偽造 explicit source。
- 第二個 skill load 被阻擋。
- Agent/skill tool scope intersection，skill 無法擴權。
- Explicit `requiredToolIds` unavailable 時 explicit fail-fast、automatic catalog exclude；optional tool unavailable 只縮小交集。
- Instruction budget exceeded。
- Resource chunk/cache、unknown path、`..`、binary、oversize、total budget 與 count limit。
- Skill/resource prompt injection 無法改寫 tool scope 或 runtime policy。
- Scripts 永遠不會成為 executable tool。

### 10.5 Controller/browser lifecycle tests

- 同時 send 只建立一個 active run。
- Abort 發生在 model、confirmation、MCP、Worker、resource read 各 await boundary。
- Stop、pagehide、tutorial restore、unmount 後 late results 全部 dropped。
- Background suspension 超過 absolute deadline，恢復後不得繼續 dispatch。
- 舊 run generation 不可 patch 新 assistant message。
- Reload 後 stale `isStreaming` 正規化為 interrupted，不重播工具。
- Storage quota/corruption 不影響 core terminal outcome。
- Persisted projection 不含 raw skill/tool/credential data。

### 10.6 Transport/integration matrix

- OpenAI-compatible native tool call streaming、arguments accumulation、tool result與 failover。
- Native failover 跨 candidate/provider 時 function/call ID aliases 重新投影且保持 call/result pairing。
- OpenAI-compatible text fallback conformance。
- Custom 與 Chrome Prompt text transcript rendering、system forwarding 與 capability rejection。
- Typed network/HTTP/429/auth/abort/empty failures不會成為 final answer。
- Failover candidate 不同 model/context budget 時重新 projection，但 canonical transcript 不變。
- App 中間 action/failover delta 不顯示半截 JSON。
- MCP CORS/gateway unavailable 時在 snapshot/preflight 被 containment。
- 舊 persisted history 仍可 render。

### 10.7 Default switch gates

`pi_loop_v1` 只有同時符合以下條件才改為預設：

1. Affected tests、`npm run lint`、`npm run build`、完整 `npm test` 與 `npm run test:tutorial` 通過。
2. Fault-injection suite 對 timeout、abort、late completion、malformed stream、quota 與 unavailable MCP 全部通過。
3. Primary native-tool configuration 的 `chatgpt-browser-skill` real tutorial 在 fresh browser sessions 連續成功 10 次，沒有 protocol_error、stalled、step_limit、deadline 或 duplicate effect。
4. 每個宣稱支援的 text adapter/model configuration 至少通過 3 次 non-destructive conformance/tutorial；未通過者維持 `none` 或 experimental，不阻塞 native default。
5. 所有 run trace 可還原 context projection、model step、tool preflight/dispatch/result、effect certainty、skill/resource load 與唯一 terminal reason。
6. Injected timeout/late-result tests 中，non-idempotent tool 的 duplicate dispatch 數必須為 0。
7. Stable path 沒有 `legacy_inline` tool，也沒有 legacy planner/gate/verifier calls。

三次 real tutorial 只算 smoke test，不足以單獨支持 default switch。

## 11. 本機可觀測性

每個 run 記錄但不上傳：

- `runId`、generation、skill ID、transport kind、candidate capability
- model step、tool dispatch、resource read、protocol repair 與 failover counts
- projected context/catalog/skill/resource/tool-result chars
- tool outcome、effect certainty、late-result drop count
- stop reason、duration、最後 stable error code

不要記錄 credentials、完整 user prompt、完整 skill instructions、confirmation payload 或未遮罩 tool output。Metrics 只用來比較 legacy 與 `pi_loop_v1` 的 task success、平均模型呼叫數、protocol conformance 與 harness invariant violations，不做背景 telemetry。

## 12. 最終完成條件

1. 所有 skill execution 只使用一個 canonical action loop；沒有 bootstrap planner、step planner、completion gate 或 automatic verifier。
2. Adapter 與 load balancer 使用 typed outcome；正常回答和 provider failure 不共用 string channel。
3. OpenAI-compatible primary path 使用 native tool calls；text path 需通過 capability conformance。
4. Canonical transcript、model context、model response、catalog、skill/resources、tool outputs、events 與 persistence 全部有硬上限。
5. 新 harness 使用 headless `ToolEffectRunner`，不直接包裝 legacy `createToolSelectionExecutor`。
6. 同一 callId 最多 dispatch 一次；unknown effect 不自動重試，late result 不修改 terminal run。
7. Tool intent/idempotency/cancellation 是 explicit metadata，input 經成熟且 browser-compatible 的 JSON Schema validation，未知 policy 採 conservative default。
8. Stable registry 不執行 arbitrary same-origin inline JavaScript，Worker 不可用時不 fallback inline；skills scripts 永不執行。
9. Controller 保證 single active run、generation ownership、page lifecycle abort 與 interrupted-state recovery。
10. Skill activation/resource read/MCP/built-in tools全部以 action/result 進入同一 transcript，invocation source 無法由模型偽造。
11. 新 harness 成為 default，legacy skill runtime、single/multi mode 與 verifier controls 已移除。
12. AgentGoRound 仍為純前端；外部 provider/MCP 不可用時以 typed failure containment，不偽造成功。

## 13. 參考資料

Pi Agent clone：`/Users/gipapa/work/pi-agent`

- Pi core loop: `packages/agent/src/agent-loop.ts`
- Pi agent event/tool contracts: `packages/agent/src/types.ts`
- Pi skill loader: `packages/agent/src/harness/skills.ts`
- Pi system skill catalog: `packages/agent/src/harness/system-prompt.ts`

AgentGoRound current boundaries：

- Adapter text contract: `src/adapters/base.ts`
- Load-balancer string outcome: `src/runtime/loadBalancerRunner.ts`
- Legacy combined executor: `src/runtime/toolSelectionExecutor.ts`
- MCP timeout behavior: `src/runtime/toolExecution.ts`
- Built-in Worker/inline execution: `src/utils/runBuiltInScriptTool.ts`
- Current App run ownership: `src/app/App.tsx`

External specifications：

- Pi Skills documentation: https://pi.dev/docs/latest/skills
- Agent Skills specification: https://agentskills.io/specification
- Agent Skills client implementation: https://agentskills.io/client-implementation/adding-skills-support
