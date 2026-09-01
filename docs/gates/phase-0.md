# Real tutorial gate — Phase 0 baseline

## Run metadata

| Field | Value |
|---|---|
| Date (Asia/Taipei) | 2026-09-02 |
| Executor / owner | Codex, authorized by gipapa |
| Commit / tag | PR0 verified commit `71aa59f38b3c43710c1b56dda15966f2300b91e9`; deterministic baseline tag `pre-pi-native-v2-2026-09` → `6d56d8ae23ec2a672ff1acd9353add8c601bface` |
| Provider | Groq; two configured local keys, contents not recorded |
| Model | `openai/gpt-oss-20b` |
| Environment | macOS arm64; Node 22.23.2 / npm 10.9.8; disposable fresh agent-browser sessions; runner child shells preserve Node 22 PATH |
| Config source | `.tutorial-test.local.json` (never committed) |
| Command(s) | The four canonical commands in §64.1 / README; `REAL_TUTORIAL_API_KEY_INDEX=0` or `1` was used only to select the configured key for quota diagnosis |

## Success criteria

- [x] The tested feature set matches the Phase 0 tutorial scope.
- [x] Every required scenario is listed below with its executed result.
- [x] Provider failures and incomplete session counts are recorded as non-pass.
- [x] The result is compared with the deterministic Phase 0 baseline.

## Scenario results

| Scenario | Required sessions | Completed sessions | Successful sessions | Success rate | Status | Failure / skip reason |
|---|---:|---:|---:|---:|---|---|
| `chatgpt-browser-skill` | 10 | 0 | 0 | N/A | blocked / not pass | Key 0: HTTP 413, requested 8,122 tokens against 8,000 TPM. Key 1: one attempt reached `step_limit` after 10 tool calls; retries were then stopped by HTTP 429 TPD. |
| `harness-stability-skill` | 10 | 10 | 10 | 100% | passed | All 10 fresh browser sessions completed; deterministic profile + local worker stamp report passed. |
| `grilling-invest-skill` | 10 | 4 | 2 | 50% of attempted sessions | partial / not pass | Key 1 session 1 passed and session 2 stopped at TPD. Key 0 session 1 passed and session 2 stopped at TPD. Remaining sessions were not run. |
| `text-protocol-conformance` | 3 | 3 | 3 | 100% | passed | All 3 fresh sessions completed; protocol repair was exercised in session 1 and the final reports/tool calls passed. |

The full 33-session rollout gate is **not passed**. The two passing scenario
groups provide real-provider evidence, but they cannot substitute for the
missing browser and investment sessions.

## Provider observations

The configured Groq keys were valid enough to complete the setup and multiple
real sessions. The observed quota failures were:

- Key 0 organization: HTTP 413 at 8,122 requested tokens versus an 8,000 TPM limit; later HTTP 429 at 196,782/200,000 TPD with a 5,614-token request.
- Key 1 organization: HTTP 429 at 195,096/200,000 TPD with a 4,941-token request, and later 199,648/200,000 TPD with a 4,104-token request.
- The key 1 browser retry also produced a genuine `step_limit` result after 10 browser tool calls, independent of the later quota failure.

These are provider/runtime constraints, not evidence of a passing gate. A future
rerun needs sufficient TPM/TPD for the canonical model and must repeat the
missing sessions with the unmodified scenario prompts.

## Evidence

- Deterministic baseline: [`docs/baseline/README.md`](../baseline/README.md)
- Baseline tag: `pre-pi-native-v2-2026-09`
- Runner output and failure diagnostics: captured during the commands above and summarized in this file; no credential-bearing logs were saved.
- Screenshots or browser session evidence: deterministic desktop/mobile/base-path screenshots are in [`docs/baseline/`](../baseline/); real sessions used disposable profiles and were cleaned up after each attempt.
- Remote CI: [production verify/deploy run 33541521415](https://github.com/gipapa/agent-go-round/actions/runs/33541521415) passed; [preview verify/deploy run 33541767158](https://github.com/gipapa/agent-go-round/actions/runs/33541767158) passed.
- Remote browser smoke: production and preview URLs both returned HTTP 200 with title `AgentGoRound`, heading `Agent Go Round`, and zero alert elements after Pages propagation.
- Provider quota checked at: 2026-09-02, during each failed request; see observations above.
- Follow-up issue: replenish/raise provider quota, then rerun `chatgpt-browser-skill` (10) and the remaining `grilling-invest-skill` sessions before claiming a complete Phase 0 real gate.
