# AGENT.md

Working notes for AI coding agents on this repo.
For end-user docs see [README.md](README.md). For multi-turn skill runtime details see [agentic.md](agentic.md).

---

## What this project is

`AgentGoRound` — browser-first, frontend-only agent playground.
Vite + React 18 + TypeScript 5.6, no backend. Persists everything in `localStorage` + `IndexedDB`.

Integrates: multi-agent orchestration, load balancers, skills, built-in JS tools, MCP (SSE), prompt routing, voice (Radio/STT-TTS), MAGI consensus, knowledge graphs (Graphify), interactive tutorials.

---

## Repo map

```
src/
  main.tsx                 React entry → <App />
  types.ts                 Shared types (ChatMessage, SkillPhase, MagiVerdict, McpServerConfig, ...)
  app/
    App.tsx                Root component (currently 8000+ lines god-component, see issue/issue1.md)
    styles.css
  adapters/                Model provider adapters
    base.ts                AgentAdapter interface + ChatRequest/ChatEvent
    openaiCompat.ts        OpenAI / Groq / Gemini-compat (streaming)
    custom.ts              User-defined endpoint via mustache templating
    chromePrompt.ts        Browser built-in Prompt API
  mcp/
    sseClient.ts           MCP-over-SSE client (RPC POST + SSE stream)
    toolRegistry.ts        listTools / callTool helpers
  orchestrators/
    oneToOne.ts            Single-agent chat
    leaderTeam.ts          Leader + members (legacy)
    magi.ts                3-unit vote / consensus
  runtime/                 Skill runtime (single + multi-turn)
    skillRuntime.ts        Skill load / snapshot / refs / assets
    multiTurnSkillRuntime.ts  Multi-turn loop (observe → plan → act → verify)
    skillPlanner.ts        Bootstrap plan + step decisions
    skillExecutor.ts       Tool selection + execution
    skillState.ts          SkillRunState (phase, todo, manualGate, signatures)
    skillTodo.ts           Todo data model
    skillTrace.ts          Trace entries pushed into ChatMessage.skillTrace
    skillReferenceResolver.ts  Resolve {{refs}} / asset paths
    browserObservation.ts  Distill MCP browser snapshots → BrowserObservationDigest
  storage/                 Persistence layer
    settingsStore.ts       UI state, MCP, prompt templates, credentials, load balancers
    agentStore.ts          Agents (localStorage)
    chatStore.ts           Chat history (IndexedDB)
    skillStore.ts          Skills + assets (IndexedDB)
    docStore.ts            Docs (IndexedDB)
    builtInToolStore.ts    Built-in JS tools
  ui/                      Panels & modals
    ChatPanel.tsx, AgentsPanel.tsx, SkillsPanel.tsx, McpPanel.tsx,
    LoadBalancersPanel.tsx, PromptTemplatesPanel.tsx, BuiltInToolsPanel.tsx,
    DocsPanel.tsx, RadioConfigPanel.tsx, TutorialGuide.tsx, HelpModal.tsx, LandingPage.tsx
  radio/
    runtime.ts             Half-duplex STT → refine → existing one-to-one → TTS loop
    helpers.ts             VAD / chunk handling / mic permission
  magi/
    magiSkills.ts          Built-in MAGI ballot/consensus prompts (NOT user-editable)
  promptTemplates/
    store.ts               YAML template loader for chat / skill decision prompts
  onboarding/
    catalog.ts / catalogCore.ts  Tutorial scenario catalog (YAML-defined)
    runtime.ts             Step expectation evaluation + workspace snapshot restore
    tutorialSkillTemplate.ts, tutorialBuiltInToolTemplate.ts  Default content for tutorials
    types.ts
  utils/
    runBuiltInScriptTool.ts  Executes user-defined JS via new Function (see issue/issue10.md)
    loadBalancer.ts          Instance selection / failover
    loadBalancerDiagnostics.ts
    agentFailure.ts          Failure classification
    credential.ts            Resolve credential → endpoint+key
    toolDashboard.ts, toolResultSummary.ts, systemBuiltInTools.ts
    agentDirectoryTool.ts, id.ts, resetAppStorage.ts
  graphify/                  Graphify UI integration (read-only viewer)
  __tests__/                 6 test files (vitest)
scripts/
  sync-graphify.mjs          predev/prebuild: sync graphify outputs into public/
  tutorial-runtime-check.ts  npm run test:tutorial (smoke)
  real-tutorial-runner.ts    npm run test:real_tutorial (end-to-end)
mcp-test/
  server.js                  Local MCP test server (SSE + RPC, port 3333)
  agent-browser-sse/         Bundled agent-browser MCP
public/
  graphify/, intro/          Static assets (synced by sync-graphify.mjs)
issue/                       Code-review backlog (issues 1-15, batches 1-4.5)
docs/
  skill-runtime-design.md
```

---

## Run / test / build

```bash
bash run.sh -dev           # vite dev on http://127.0.0.1:5566/  (will kill anything on :5566)
npm run dev                # raw vite dev
npm run build              # tsc -b && vite build
npm run preview            # preview built dist
npm run deploy             # gh-pages deploy
npm test                   # vitest run (6 test files)
npm run test:tutorial      # tutorial smoke
npm run test:real_tutorial # full real-tutorial regression
REAL_TUTORIAL_ONLY=<scenario-id> npm run test:real_tutorial   # filter
cd mcp-test && bash run.sh -simple       # local MCP echo/time server
cd mcp-test && bash run.sh -agent_browser
```

`predev` and `prebuild` automatically run `node scripts/sync-graphify.mjs`.
Vite `base` is `/agent-go-round/` for `build`, `/` for `dev`. Override with `BASE_PATH` env.

---

## Architecture key points

- **Single-page React app**, no router. `App.tsx` switches between tabs (`chat` / `chat_config` / `resources` / `agents` / `profile`) via internal state.
- **Agents do not bind a model directly** — they bind a *load balancer*, which holds a list of instances; each instance binds a credential + key + model. Failover / retry / resume-minute live in `utils/loadBalancer.ts`.
- **Adapters** all implement `AgentAdapter` from `adapters/base.ts` and yield `ChatEvent` async generators (`token` / `done`). Streaming for `openai_compat`, single-response for `custom` / `chrome_prompt`.
- **MCP** is SSE-based. Each call currently does `new McpSseClient(server) → connect → list/call → close()` — connections are properly closed but not pooled (see `issue/issue2.md`).
- **Skill runtime** has two modes:
  - `single_turn`: model + skill prompt → 1 response.
  - `multi_turn`: explicit phase machine (`skill_load → bootstrap_plan → observe → plan_next_step → act → sync_state → completion_gate → final_answer → verify_refine`), see [agentic.md](agentic.md).
- **MAGI** lives in `orchestrators/magi.ts` + `magi/magiSkills.ts`. Not user-configurable, not driven by `promptTemplates/`.
- **Radio** wraps the existing one-to-one orchestrator with STT → LLM-refine → TTS, plus voice-activity-driven turn switching.
- **Tutorial / onboarding** drives real UI elements via `data-tutorial-id` attributes and YAML-declared expectations.

---

## Conventions when editing

### Storage keys
All `localStorage` keys prefixed `agr_*` and suffixed `_v1` (e.g. `agr_ui_v1`, `agr_model_credentials_v1`, `agr_mcp_v1`).
Schema migration is **not** implemented — adding/removing fields silently keeps or drops data. See `issue/issue12.md`.

### Type safety
`tsconfig` has strict mode, but the codebase still has many `any` (mostly in `normalize*`, adapters, RPC types). Use `unknown` + type guards or Zod for new code. See `issue/issue8.md`.

### JSON from model output
Use `extractJsonObject()` in `App.tsx` and `orchestrators/leaderTeam.ts` (two duplicate copies; see `issue/issue5.md`). The current regex-based version is fragile; if introducing a new normalize path, prefer adding a Zod schema.

### Logging
`pushLog()` and `logNow()` (defined in `App.tsx`) are the standard logging primitives. Categories include `mcp`, `tool execution`, `model_request`, etc. Log entries are kept in memory + UI panel; not persisted.

### MCP tool routing
The model returns `{ type: "mcp_call", tool, serverId?, input }`. `serverId` resolution lives in `App.tsx:281` (`normalizeToolDecisionAgainstAvailableTools`) and is duplicated at `App.tsx:5066`. Prefer fixing both if you touch one. See `issue/issue3.md`.

### React patterns
- App.tsx has 30+ `useState`. Any state change re-renders the whole app. **Do not add more useState to `App.tsx`** — extract to a hook or context (eventual Batch 4 work, see `issue/BATCH4.md`).
- No `ErrorBoundary` exists. Risky render code may white-screen the app. See `issue/issue6.md`.
- Refs (`*Ref.current`) are used heavily for radio / tutorial / skill trace state. Be careful with concurrent execution — see `issue/issue14.md`.

### Built-in tool execution
`utils/runBuiltInScriptTool.ts` runs user JS via `new Function(...)` with **no timeout, no sandbox**. Anything you expose in `helpers` becomes part of the tool API surface and is reachable from untrusted code. See `issue/issue10.md` before adding helpers.

### Adapter calls
None of the adapter `fetch()` calls have `AbortController` or timeout; `ChatRequest` does not have a `signal`. If you add cancellation anywhere, you'll need to thread `signal?: AbortSignal` through `adapters/base.ts` first. See `issue/issue11.md`, `issue/issue13.md`, `issue/BATCH1.md`.

### Skill / orchestrator timeouts
None exist — `toolLoopMax` only caps step count, not wall-clock time. See `issue/issue13.md`, `issue/BATCH4.5.md`.

### MAGI consensus
No deadlock detection, no early-exit on majority, no per-round timeout. See `issue/issue15.md`.

### Tests
Only 6 vitest files in `src/__tests__/`. `@testing-library/react` is **not installed**. App.tsx orchestration logic has zero coverage. Adding integration tests is a prerequisite for Batch 4 refactors. See `issue/issue9.md`.

---

## Known issues & refactor backlog

The `issue/` folder is the source of truth for the current code-review backlog. Ordered by recommended execution sequence:

| Batch | File | Issues | Effort | Risk |
|---|---|---|---|---|
| 1 | [issue/BATCH1.md](issue/BATCH1.md) | 4, 6, 11 (mcp-test validation, ErrorBoundary, fetch timeout) | 1-1.5 d | Low |
| 2 | [issue/BATCH2.md](issue/BATCH2.md) | 5, 8 (safe JSON + Zod, kill `any`, add ESLint) | 2-3 d | Medium |
| 3 | [issue/BATCH3.md](issue/BATCH3.md) | 2, 3, 14-partial (MCP client manager + serverResolver + cache stampede) | 3-5 d | Medium-High |
| 4.5 | [issue/BATCH4.5.md](issue/BATCH4.5.md) | 10, 13, 15 (deadline / abort / sandbox / MAGI deadlock) | 3-5 d | Medium |
| 4 | [issue/BATCH4.md](issue/BATCH4.md) | 9, 1, 7, 12, 14-rest (tests → split App.tsx → storage hardening → credential vault → execution lock) | 2-4 wk | High |

Individual issue files: `issue/issue1.md` through `issue/issue15.md`. Each has source file:line refs, severity, and concrete fix steps.

Always check the relevant `issue/issue*.md` before touching:
- `App.tsx` → issue 1 (god component) + 14 (race conditions)
- Anything `runBuiltInScriptTool` related → issue 10 (sandbox)
- Adapter / `fetch` → issues 11, 13
- MCP layer → issues 2, 3
- JSON parsing / normalize functions → issues 5, 8
- `localStorage` / IndexedDB writes → issue 12 + 7 (credential storage)
- MAGI orchestrator → issue 15

---

## Things that look broken but are intentional

- **`base: "/agent-go-round/"` in build**: GitHub Pages deploy path. Override via `BASE_PATH` env var if hosting elsewhere.
- **`mcp-test/server.js` minimalism**: it's a dev fixture, not production. Hardening tracked in `issue/issue4.md`.
- **MAGI uses fixed prompts (not Prompt Templates)**: by design, kept in `magi/magiSkills.ts`.
- **`run.sh -dev` calls `fuser -k 5566/tcp`**: deliberately kills any prior dev server. Don't run two dev sessions on different ports without removing this.
- **Many panels live inline in `App.tsx`** (modals for Credentials, MCP, Skills, Prompts, Tools, Mode): scheduled extraction is part of `issue/BATCH4.md` Phase 4.2.

---

## Frontend-only security boundary (recap)

This codebase is intentionally a **frontend-only playground**, not a production-safe deployment target.

- API keys live in `localStorage` (plaintext today; encryption tracked in `issue/issue7.md`)
- User-defined built-in tools execute arbitrary JS at same origin (`issue/issue10.md`)
- Docs / skills / prompt templates persist client-side
- MCP is SSE-only; multi-tenant isolation is out of scope

Before any "real" deployment add: server-side proxy, JS-execution isolation, credential vault, multi-user data partitioning. See README "Frontend-only 風險與部署提醒".
