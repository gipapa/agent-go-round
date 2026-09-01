# AgentGoRound v2 Execution Board

> 狀態：Phase 0 實作收尾中；deterministic 護欄、GitHub CI/Preview remote verification 與 G0 已完成，real tutorial 為 partial（quota/step-limit 阻擋）
> 架構與遷移規格：[agent-go-round-v2-plan.md](./agent-go-round-v2-plan.md)
> 使用方式：本文件是日常執行與決策紀錄；架構理由、技術契約與完整驗收規格一律以主計畫為準。

## Operating Rules

- 每個工作項開始前必須有 owner、目標日期與可驗證 evidence。
- 一個 PR 未達其 acceptance gate，不得標示完成或開始其被阻擋的後續 PR。
- G0–G4 的結論與 evidence 必須寫回本文件與主計畫指定章節。
- Owner 尚未指定時，狀態一律是 `Not started`，不可視為已排程。

## Current Focus — PR 0

PR 0：`chore: freeze legacy runtime, add CI test gate, capture baseline`

| ID | 工作項 | Owner | 目標日期 | 狀態 | Evidence / 完成條件 |
|---|---|---|---|---|---|
| P0-1 | 確認 GitHub Pages 實際 production source，停用另一條部署 workflow | Codex | 2026-09-02 | Complete | `gh api repos/gipapa/agent-go-round/pages` confirmed `gh-pages`/`/`; remote `pages.yml` is `disabled_manually`, local `pages.yml` deleted, `gh-pages.yml` retained; production deploy verified in [run 33541521415](https://github.com/gipapa/agent-go-round/actions/runs/33541521415); config/rollback: [`docs/deployment.md`](./docs/deployment.md) |
| P0-2 | 升級 CI、本機 runtime 與宣告到 Node 22 | Codex | 2026-09-02 | Complete | `.nvmrc=22`, `package.json`/lock `engines >=22.19.0`, active project workflows use Node 22; Node 22.23.2 arm64 local baseline PASS; real-tutorial child shells now preserve Node 22 PATH; remote verify passed in [run 33541521415](https://github.com/gipapa/agent-go-round/actions/runs/33541521415) |
| P0-3 | 建立 baseline tag `pre-pi-native-v2-2026-09` | Codex | 2026-09-01 | Complete | pushed tag resolves to `6d56d8ae23ec2a672ff1acd9353add8c601bface`; `git ls-remote --tags origin` verified |
| P0-4 | CI 加入 lint、test、build gate；deploy 依賴 gate | Codex | 2026-09-02 | Complete | `gh-pages.yml`: `verify` runs lint/test/build/check:bundle and `deploy` has `needs: verify`; local and remote [run 33541521415](https://github.com/gipapa/agent-go-round/actions/runs/33541521415) all PASS |
| P0-5 | 填完 §6.3 baseline 表與保存 artifacts/screenshots | Codex / gipapa | 2026-09-02 | Partial — real gate executed but not pass | deterministic baseline and §6.3 table recorded; `dist` tarball (`sha256 e9baefa5cf0e39936f9e7e497cbf5dbd64917fa381a9848ba902889ca6b05d28`) plus 1440×1000 desktop, 390×844 mobile, production and preview base-path screenshots in [`docs/baseline/`](./docs/baseline/); `harness-stability-skill` 10/10 and `text-protocol-conformance` 3/3 PASS, `grilling-invest-skill` 2/10 completed PASS before TPD, `chatgpt-browser-skill` 0/10 due 413/step-limit/429; remote CI/Preview and URL smoke PASS; details in [`docs/gates/phase-0.md`](./docs/gates/phase-0.md) |
| P0-6 | 建立 committed bundle budget 檔與 CI 比對 | Codex | 2026-09-02 | Complete | [`bundle-budget.json`](./bundle-budget.json), [`scripts/check-bundle-budget.mjs`](./scripts/check-bundle-budget.mjs); production measured 304,550 B / 371,844 B and preview 304,555 B / 371,856 B, both below ceilings 306,000 B / 374,000 B; deliberate undersized budget correctly exits 1; local and remote checks PASS |
| P0-7 | 建立 real tutorial gate evidence 格式與 `docs/gates/` 位置 | Codex | 2026-09-01 | Complete — local checker PASS | [`docs/gates/template.md`](./docs/gates/template.md), [`docs/gates/README.md`](./docs/gates/README.md), [`gate-evidence.yml`](./.github/workflows/gate-evidence.yml), local no-label check PASS, and synthetic `milestone-a` PR without evidence correctly exited 1 |
| P0-8 | 完成 G0 sizing Go/No-Go | gipapa / Codex | 2026-09-02 | Complete — GO | Owner authorized Codex planning estimate: 1 Codex engineering agent, 60 eng-wk through Milestone C and full scope, complete PR 0–13; 47 eng-wk C upper bound / 55 eng-wk full upper bound leaves 5 eng-wk buffer; decision and +50% reassessment points in §6.5.6 |
| P0-9 | 建立 preview deployment，最晚 PR 3a 前可用 | Codex | 2026-09-02 | Complete | [`preview.yml`](./.github/workflows/preview.yml) publishes `gh-pages/preview/` with `BASE_PATH=/${repository}/preview/`; [preview run 33541767158](https://github.com/gipapa/agent-go-round/actions/runs/33541767158) PASS; production and preview URLs browser smoke PASS |

### PR0 Verification Checklist

| ID | 可重跑步驟 | 預期結果 |
|---|---|---|
| P0-1 | `gh api repos/gipapa/agent-go-round/pages --jq '{build_type,source,url}'`; inspect `.github/workflows/`; compare `git diff --name-status` | Pages source is `gh-pages`/`/`; only `gh-pages.yml` is production; `pages.yml` is deleted; rollback instructions exist |
| P0-2 | `cat .nvmrc`; inspect `package.json`, `package-lock.json`, and active workflows; run `node --version`/`npm --version` with Node 22 | Node 22 is declared in all required surfaces; local baseline uses Node 22.23.2 / npm 10.9.8 |
| P0-3 | `git show --no-patch pre-pi-native-v2-2026-09`; `git ls-remote --tags origin 'pre-pi-native-v2-2026-09*'` | Tag and peeled commit resolve to `6d56d8ae23ec2a672ff1acd9353add8c601bface` |
| P0-4 | `npm run lint`; `npm test`; `BASE_PATH=/agent-go-round/ npm run build`; `npm run check:bundle`; inspect `gh-pages.yml` | All local and remote gates pass; deploy has `needs: verify`; [run 33541521415](https://github.com/gipapa/agent-go-round/actions/runs/33541521415) |
| P0-5 | Run the four deterministic commands and bundle check; use browser smoke at desktop/mobile and production/preview base paths; inspect `docs/baseline/` | Metrics, artifact hash, screenshots, and command results are recorded; real gate is not marked pass without quota-backed runs |
| P0-6 | Set a deliberately undersized budget, run `npm run check:bundle`, assert exit 1, restore the baseline budget, then run it again | Oversize fails; baseline budget passes; both values remain reviewable in `bundle-budget.json` |
| P0-7 | `node scripts/check-gate-evidence.mjs`; inspect `docs/gates/` and `gate-evidence.yml` | Local check passes; milestone-labeled PRs require matching evidence-file changes |
| P0-8 | Fill §6.5.1 with owner ranges and actual available capacity; compare the serial dependency path through Milestone C; record a dated GO / GO (縮減) / NO-GO | `GO` recorded in §6.5.6 with 1 Codex agent, 60 eng-wk envelope, complete scope, and PR3/PR8 +50% reassessment points |
| P0-9 | Run `Deploy preview to gh-pages` with a selected ref; open `https://gipapa.github.io/agent-go-round/preview/`; smoke `BASE_PATH=/${repository}/preview/` locally before first remote deploy | [run 33541767158](https://github.com/gipapa/agent-go-round/actions/runs/33541767158) passed; preview URL is reachable and production root is unchanged |

### PR 0 Exit Criteria

- [ ] P0-1 至 P0-4、P0-6 至 P0-9 完成；P0-5 的 deterministic baseline 已完成，但 real gate 尚未達完整 33-session pass。
- [x] G0 已得出 `GO`、`GO (reduced scope)` 或 `NO-GO`，且理由已記錄。
- [ ] 若為 `GO (reduced scope)`，被延後功能與更新後的 Milestone C 定義已寫回主計畫。
- [ ] 若為 `NO-GO`，停止後續 PR，維持 legacy harness maintenance-only。

## Program Gates

| Gate | 何時判定 | Owner | 狀態 | Required evidence |
|---|---|---|---|---|
| G0 — sizing Go/No-Go | Phase 0 結束前 | gipapa / Codex | **GO** — 2026-09-02 | §6.5.1 / §6.5.6：1 Codex engineering agent、60 eng-wk through C/full scope、完整 scope；PR 3/8 +50% reassessment |
| G1 — PR 2S | PR 2 merge 前 | Unassigned | Not evaluated | first-token gate、approval/ask-user API、blocked deadline 暫停的 spike evidence |
| G2 — Pi facts revalidation | Phase 1 結束前 | Unassigned | Not evaluated | §4.1 F1–F16 對 exact pins 的重驗結果 |
| G3 — rollback rehearsal | Milestone B 結束前 | Unassigned | Not evaluated | §101.3 replay：v2 → baseline → v2 的資料驗證 |
| G4 — rollback coverage | Milestone B 結束前 | Unassigned | Not evaluated | localStorage 相容、單一 production pipeline、warm-cache recovery |

## PR Tracker

| PR | 範圍 | 前置條件 | Owner | 目標日期 | 狀態 | 完成證據 |
|---|---|---|---|---|---|---|
| 0 | Freeze、CI、baseline、sizing | — | Codex / gipapa | 2026-09-02 | Implemented — remote CI/Preview PASS; real gate partial | PR 0 exit criteria；real gate partial，G0 GO |
| 1 | Browser-native Pi PoC | G0=GO | Unassigned | — | Blocked | §16 PASS、G2 |
| 2S | LB / approval / deadline spike | PR 1 的 Pi runtime path | Unassigned | — | Blocked | G1 全部 evidence |
| 2 | Pi runtime foundation | G1 pass | Unassigned | — | Blocked | §94 acceptance |
| 3a | Shell、agent rail、semantic state | PR 2 | Unassigned | — | Blocked | review + tutorial contract work started |
| 3b | Workspace、conversation、activity | PR 3a | Unassigned | — | Blocked | §36 acceptance subset |
| 3c | Approval、attention、tutorial anchors | PR 3b | Unassigned | — | Blocked | `npm run test:tutorial` pass |
| 4 | Docs and context ownership | PR 3c | Unassigned | — | Blocked | §37.1/§37.2 acceptance |
| 5 | MCP Pi tools | PR 3c | Unassigned | — | Blocked | §43 acceptance |
| 6 | Built-ins and ToolEffectRunner | PR 3c | Unassigned | — | Blocked | §47.1 acceptance |
| 7 | Skills | PR 3c | Unassigned | — | Blocked | §50.2 acceptance |
| 8 | Persistence and migration | PR 4–7 | Unassigned | — | Blocked | session conformance + §102.5 |
| 9 | Load balancer and accounting | PR 8 | Unassigned | — | Blocked | §58 acceptance |
| 10 | Voice | PR 8 | Unassigned | — | Blocked | §59.1 acceptance |
| 11 | MAGI | PR 8 | Unassigned | — | Blocked | §63.1 acceptance |
| 12 | Tutorials and regression | PR 9–11 | Unassigned | — | Blocked | §64 gate artifacts |
| 13 | Legacy deletion | PR 12 and §66 | Unassigned | — | Blocked | §66 deletion gate |

## Weekly Decision Log

| Date | Decision / risk | Owner | Impacted PRs or gates | Evidence / link | Next review |
|---|---|---|---|---|---|
| 2026-09-01 | PR0 local safeguards are ready, but formal close is blocked: quota-backed real tutorial results, actual Milestone C capacity, and a post-merge CI/preview run are absent. Do not start PR1. | gipapa | P0-5, P0-8, P0-9, G0 | [`docs/gates/phase-0.md`](./docs/gates/phase-0.md), [`docs/baseline/README.md`](./docs/baseline/README.md), local Node 22 verification, `gh` Pages/workflow state | After owner supplies quota/window, capacity/scope, and commit authorization |
| 2026-09-02 | Owner authorized commit/push, complete scope, and real tutorial execution. G0 is GO with a 60 eng-wk Codex planning envelope. Real tutorial evidence is partial: harness 10/10 and text protocol 3/3 pass; browser/long investment gates were stopped by provider TPM/TPD and browser step-limit failures. Remote CI and Preview now pass, but PR0 remains open until the missing real sessions are rerun with sufficient quota. | gipapa / Codex | P0-5, P0-8, P0-9, G0 | [`docs/gates/phase-0.md`](./docs/gates/phase-0.md), §6.5.6, [CI run 33541521415](https://github.com/gipapa/agent-go-round/actions/runs/33541521415), [Preview run 33541767158](https://github.com/gipapa/agent-go-round/actions/runs/33541767158) | Replenish quota, rerun missing canonical sessions, then reassess the PR0 exit checkbox |

## Immediate Next Action

Next action: replenish/raise provider quota and rerun the missing 10 browser + 8 investment sessions with canonical prompts; keep PR1 blocked until the PR0 exit decision is recorded. CI, deploy, Preview, and G0 evidence are complete.
