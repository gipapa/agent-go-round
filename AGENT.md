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

- **`src/app/App.tsx` is ~8990 lines, god component.** ~58 `useState`, modals + orchestrators inlined. Don't add more `useState` — extract a hook/context. BATCH4's new lock / abort refs (`activeChatAbortRef`, `skillExecutionLocksRef`) all live here too. [issue/issue1.md](issue/issue1.md), [issue/BATCH6.md](issue/BATCH6.md).
- **API keys are still plaintext in `localStorage`.** `credentialVault.ts` exists with full AES-GCM + PBKDF2 + tests, but is **not wired** into App / settingsStore / Credentials Modal. The exfil surface is reduced (script tool helpers no longer expose credentials, key is on its own storage key) but not eliminated. [issue/issue7.md](issue/issue7.md).
- **Test coverage is still thin at the integration layer.** Infra is in (testing-library / happy-dom / coverage-v8) and 76 unit tests pass, but the 4 high-level scenarios (skill multi-turn / LB failover / radio / tutorial) listed for BATCH6 Phase 6.1 are not yet written. Add them **before** refactoring App.tsx. [issue/issue9.md](issue/issue9.md), [issue/BATCH6.md](issue/BATCH6.md).

### Already hardened (don't redo)

ErrorBoundary at root + key panels, fetch `signal`/`timeoutMs` + `Retry-After`, `extractJsonObject` brace-counting + Zod schemas, ESLint with `no-explicit-any: error`, MCP `clientManager` pool with idle close, `serverResolver` (with `mcp_routing_fallback` log), `McpToolCatalog` in-flight dedup, `mcp-test/server.js` input validation.

BATCH4 additions (2026-04):
- `src/utils/deadline.ts` — `createDeadline` / `combineSignals` / `withTimeout`, threaded through `oneToOne` / `leaderTeam` / `magi` / `multiTurnSkillRuntime`.
- `src/utils/runBuiltInScriptTool.ts` — Web Worker sandbox + 10s timeout + external abort; `helpers` no longer exposes credentials.
- `src/orchestrators/magi.ts` — majority early-exit, round / unit timeout, deadlock detection.
- `src/storage/safeStorage.ts` + versioned envelope + corrupt-payload backup; IndexedDB errors wrapped in real `Error` objects. All stores migrated.
- `src/storage/credentialVault.ts` — Web Crypto AES-GCM + PBKDF2 (210k iters). **Not yet wired**, see issue 7.
- Chat stop button + `skillExecutionLocksRef` (skill execution lock) + tutorial restore lock. Refs still inside `App.tsx`.
- Testing infra: `@testing-library/*`, `happy-dom`, `coverage-v8`, `setup.ts`. 17 files / 76 tests, all green.

See git history (`git log --grep batch`) for details.

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
- Many panels live inline in `App.tsx` — extraction is scheduled in BATCH6, not a bug.
- McpPanel test-connection bypasses the client pool — it's an instant health check.

## Refactor backlog

Only the open batches remain. Earlier batches (BATCH1 reliability, BATCH2 type safety, BATCH3 MCP layer, BATCH4 deadline / abort / sandbox / storage envelope / credential vault code) have been delivered and removed from this folder; check git history if you need their context. BATCH5 was retired — its scope (testing infra, storage hardening, execution lock, vault code) was absorbed into BATCH4.

| Batch | Focus | Effort |
|---|---|---|
| [BATCH6](issue/BATCH6.md) | high-level integration tests → split `App.tsx` → wire credential vault + master-password UI | 2–4 wk |

Before touching:

| Touching... | Read first |
|---|---|
| `App.tsx` | issue 1 |
| credentials / vault wiring | issue 7 |
| tests | issue 9 |
