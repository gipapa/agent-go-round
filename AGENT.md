# AGENT.md

Working notes for AI coding agents.
End-user docs: [README.md](README.md). Multi-turn skill runtime: [agentic.md](agentic.md). Remaining refactor backlog: [issue/](issue/).

## Stack

Vite 6 + React 18 + TS 5.6, frontend-only. State in `localStorage` + `IndexedDB`. No router (tab state in `App.tsx`).

## Run

```bash
bash run.sh -dev           # dev on :5566 (kills anything on that port first)
npm run build              # tsc -b && vite build (base = /agent-go-round/, override via BASE_PATH)
npm test                   # vitest
npm run lint               # eslint --max-warnings 0
npm run test:tutorial      # tutorial smoke
npm run test:real_tutorial # full real-tutorial regression
cd mcp-test && bash run.sh -simple    # local MCP fixture on :3333
```

`predev` / `prebuild` auto-run `scripts/sync-graphify.mjs`.

## Things you should know before editing

Landmines that aren't obvious from the code. Skim before any non-trivial change.

- **`src/app/App.tsx` is 8800+ lines, god component.** 30+ `useState`, modals + orchestrators inlined. Don't add more `useState` — extract a hook/context. [issue/issue1.md](issue/issue1.md), [issue/BATCH4.md](issue/BATCH4.md).
- **`utils/runBuiltInScriptTool.ts` runs user JS via `new Function()` with no sandbox / no timeout.** Anything you put in `helpers` becomes part of the untrusted-code surface. [issue/issue10.md](issue/issue10.md).
- **Adapter layer accepts `signal` + `timeoutMs`, but most callers don't thread it.** Only `oneToOne.ts` actually passes a signal down; MAGI / leaderTeam / multiTurnSkillRuntime / radio / ChatPanel don't, so the user-visible "stop" still fails for those paths. [issue/issue13.md](issue/issue13.md), [issue/BATCH4.5.md](issue/BATCH4.5.md).
- **Skill runtime / MAGI have no wall-clock timeout.** `toolLoopMax` only caps step count. MAGI has no deadlock detection or majority early-exit. [issue/issue13.md](issue/issue13.md), [issue/issue15.md](issue/issue15.md).
- **`localStorage.setItem` is never wrapped — quota errors silent.** On load, `JSON.parse` failure silently falls back to `[]` (data loss invisible). No schema versioning despite `_v1` suffix. [issue/issue12.md](issue/issue12.md).
- **API keys are plaintext in `localStorage`.** Combined with the unsandboxed script tool → complete exfil chain. [issue/issue7.md](issue/issue7.md).
- **Concurrent skills share refs** (`skillTraceRef` etc.) — two skills running at once corrupt each other's trace. (MCP tool list stampede is already deduped via `McpToolCatalog`.) [issue/issue14.md](issue/issue14.md).
- **Test coverage is still thin.** `app.test.tsx` has 4 known-failing flows pending fixture rewrite (LB/credential seed + Chat-Config card-grid navigation). Fix this before refactoring App.tsx. [issue/issue9.md](issue/issue9.md), [issue/BATCH4.md](issue/BATCH4.md) Phase 4.1.

### Already hardened (don't redo)

ErrorBoundary at root + key panels, fetch `signal`/`timeoutMs` + `Retry-After`, `extractJsonObject` brace-counting + Zod schemas, ESLint with `no-explicit-any: error`, MCP `clientManager` pool with idle close, `serverResolver` (with `mcp_routing_fallback` log), `McpToolCatalog` in-flight dedup, `mcp-test/server.js` input validation. See git history (`git log --grep batch`) for details.

## Conventions

- **Storage keys**: `agr_*_v1`, all defined in `src/storage/*.ts`.
- **Logging**: `pushLog()` / `logNow()` in `App.tsx` (in-memory + UI panel, not persisted).
- **Tutorial selectors**: real UI elements use `data-tutorial-id` attributes.
- **MAGI** uses fixed prompts in `src/magi/magiSkills.ts`, **not** the Prompt Templates panel.
- **Agents bind a load balancer**, not a model directly. Instances inside the LB hold credential + model.
- **JSON from model output**: import `extractJsonObject` from `src/utils/safeJson.ts`. For new normalize paths use the Zod schemas in `src/schemas/decisions.ts`.
- **Errors**: use `errorMessage(e)` from `src/utils/errors.ts` instead of `catch (e: any)` — ESLint will reject the latter.
- **MCP**: go through `mcpClientManager.run(server, ...)` and `mcpToolCatalogCache.load(server, manager, ...)`. Don't `new McpSseClient()` directly except for the McpPanel test-connection button.

## Things that look broken but are intentional

- `base: "/agent-go-round/"` in build → GitHub Pages path. Override via `BASE_PATH`.
- `run.sh -dev` does `fuser -k 5566/tcp` deliberately.
- MAGI prompts are not user-editable by design.
- Many panels live inline in `App.tsx` — extraction is scheduled in BATCH4, not a bug.
- McpPanel test-connection bypasses the client pool — it's an instant health check.

## Refactor backlog

Only the open batches remain. Earlier batches (BATCH1 reliability, BATCH2 type safety, BATCH3 MCP layer) have been delivered and removed from this folder; check git history if you need their context.

| Batch | Focus | Effort |
|---|---|---|
| [BATCH4.5](issue/BATCH4.5.md) | deadline / abort wiring / sandbox / MAGI deadlock | 3–5 d |
| [BATCH4](issue/BATCH4.md) | tests → split App.tsx → storage hardening → credential vault | 2–4 wk |

Before touching:

| Touching... | Read first |
|---|---|
| `App.tsx` | issue 1, 14 |
| `runBuiltInScriptTool` / helpers | issue 10 |
| any adapter / `fetch` cancellation chain | issue 13 |
| storage / credentials | issue 12, 7 |
| MAGI | issue 15 |
| tests | issue 9 |
