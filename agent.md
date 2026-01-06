# Review notes
- `vite.config.ts` defaults to `/` for all builds. Set `BASE_PATH`/`VITE_BASE_PATH` when deploying under a subpath (e.g., `/agent-go-round/`) to avoid asset 404s.
- `README.md` documents the base-path override; keep it in sync with deployment expectations.

# Follow-ups
- Add tests around the new leader+team loop (JSON action parsing, unknown member IDs, and max-round finalization) to catch regressions early.
