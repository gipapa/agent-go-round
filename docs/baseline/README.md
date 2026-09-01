# Phase 0 baseline artifacts

Baseline label: `pre-pi-native-v2-2026-09`

Environment used for the reproducible measurements:

| Field | Value |
|---|---|
| Date | 2026-09-01 (Asia/Taipei) |
| Node / npm | 22.23.2 / 10.9.8 |
| Vite / Vitest | 6.4.1 / 3.2.4 |
| Base path | `/agent-go-round/` |

## Automated evidence

| Check | Result |
|---|---|
| `npm run lint` | PASS; 0 warnings |
| `npm test` | PASS; 52 files, 343 tests, 22.47s |
| `npm run build` | PASS; `tsc -b` clean; Vite emitted the existing >500 kB chunk advisory |
| `npm run test:tutorial` | PASS; `tutorial-runtime-check: ok` |
| `npm run check:bundle` | PASS; initial/max JS 304,550 B gzip, total 371,844 B gzip |

The full dependency summary is the command output from:

```bash
npm ls --omit=dev --depth=0
```

It resolved `ajv@8.20.0`, `jszip@3.10.1`, `react@18.3.1`,
`react-dom@18.3.1`, `yaml@2.8.2`, and `zod@4.3.6`.

The real-provider tutorial gate is intentionally recorded separately because it
requires a quota check and consumes provider requests. Existing project evidence
does not claim that gate passed; see [`docs/gates/phase-0.md`](../gates/phase-0.md).

## Browser evidence

- [`desktop.png`](./desktop.png) — 1440 × 1000, app shell after `開始使用`.
- [`mobile.png`](./mobile.png) — 390 × 844, same app shell at mobile width.
- [`base-path.png`](./base-path.png) — 1280 × 577, production build served at `/agent-go-round/`.
- [`preview-base-path.png`](./preview-base-path.png) — 1280 × 577, preview build served at `/agent-go-round/preview/`.
- [`pre-pi-native-v2-2026-09-dist.tar.gz`](./pre-pi-native-v2-2026-09-dist.tar.gz) — production `dist/` artifact.
