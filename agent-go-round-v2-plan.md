# AgentGoRound v2：Browser-Native Pi + Herdr-like UI 完整遷移計畫

> 日期：2026-09-01  
> 狀態：**Approved to start Phase 0** — Phase 1 之後的推進由 §6.5 的 sizing Go/No-Go、§0.1 的 G1–G3 與各 phase 的 acceptance gate 逐關控制。這不是「整份計畫已核准執行到底」。
> 目標：將 AgentGoRound 從自製 Pi-style harness 遷移為「真正的 Pi Agent Core 直接在 Browser JavaScript 執行」，同時將 UI 重構為 Herdr-like、agent/workspace-centric 的操作介面。
>
> 最重要的原則：
>
> **先做 PoC 證明 Pi-in-Browser 可行 → 建立正式 Pi Runtime Foundation → 立即建立 Herdr-like UI Shell → 再將 Docs / MCP / Built-ins / Skills / Persistence / LB / Voice / MAGI 一一遷移到 Pi。**
>
> **WebContainer 不屬於第一階段。** 未來若加入 Computer Mode，WebContainer 只作為 Pi tools 的 execution substrate，而不是 Pi Agent Core 的宿主。

---

## 0. 審閱狀態

- 2026-09-01 技術審閱：upstream Pi 假設已對 `@earendil-works/pi-agent-core@0.84.4` 與 `@earendil-works/pi-ai@0.84.4` 的實際 npm artifact 逐項驗證，結果彙整於 **§4.1**；bundling 限制見 **§4.2**。
- 2026-09-01 決策確認：**D1–D11 全部拍板**，理由與 gate 已寫入對應章節，索引見 **§103**。
- 本次審閱新增的章節：§4.0.1、§4.1、§4.2、§6.3.1、§6.5（sizing gate）、§22.1、§31.0、§36.1–36.3、§37.1、§43.1–43.2、§46.1–46.2、§47.1、§50.1–50.2、§52.1–52.5、§56.1–56.3、§58.2、§59.1、§64.1–64.3、§79.1–79.2、§101（Rollback）、§102（資料遷移）、§103（決策紀錄）。
- 原 §103.1 的三項架構缺口已升級為明確 phase scope：**context/compaction ownership → Phase 4（§37.1）**、**token 會計 → Phase 9（§58.2）**、**多分頁併發 → Phase 8（§52.5）**。其餘留作 enhancement（§103.2）。
- 2026-09-01 **第二次獨立審閱**：Claude 提 Q1–Q6、Codex 提 C1–C4，全部接受並寫入對應章節，索引見 **§104**。新增章節：§20.1、§20.2、§28.1、§37.2、§63.1、§64.4、§81.1、§101.5、§101.6、§101.7、§102.4；修訂章節：§52.4.1、§52.5、§56.2、§58、§77、§79.2、§0.1（G1 擴大、新增 G4）。
- 日常工作、owner、日期與 gate evidence 請更新 [v2-execution-board.md](./v2-execution-board.md)；本文件保留架構與驗收規格的唯一來源。

### 0.1 計畫狀態

```text
狀態：Approved to start Phase 0（條件式推進）

可以立即開始 Phase 0 / PR 0，不需要再等任何決策。
Phase 1 之後的每一步都由下列 gate 逐關控制。

Phase 1 的前置閘門：
  G0  §6.5 的 sizing Go/No-Go 由 owner 完成
      → 這是 Phase 0 的交付物之一，未完成不進 Phase 1

其餘條件式閘門（未通過就停，不要往下推）：
  G1  PR 2S 通過（範圍已於第二次審閱擴大，見 §104.4）
      (a) first-token gate 結論為可行（§56.3.1 Q1）
      (b) 核准／問答 API 定案（§20.1）
      (c) blocked 期間 deadline 可暫停（§81.1、§56.2 Q2）
      → 三者都會改變 §20 的介面形狀，必須在 PR 2 merge 前定案
      → PR 2S 可與 PR 2 實作並行，但任一項未過，PR 2 不得合併
  G2  Phase 1 重跑 §4.1 的 F1–F16 全部成立
      → 否則對應章節要改寫，而不是繼續推進
  G3  Milestone B 的 rollback 演練通過（§101.3）
      → 否則 Phase 8 之後的資料遷移沒有安全網
  G4  Rollback 演練涵蓋三個面向（§104.4）
      (a) localStorage 回退相容（§101.5）
      (b) 單一 production 部署管線已收斂（§101.6）
      (c) warm-cache 分頁可恢復（§101.7）
      → 任一未驗，Milestone B 不得結案
```

---

## 1. Executive Summary

AgentGoRound v2 不應繼續維護一套「Pi-inspired / Pi-style」agent runtime。

目標架構應改為：

```text
Browser Tab
│
├── AgentGoRound Product Layer
│   ├── Herdr-like UI
│   ├── Agents / Workspaces
│   ├── Docs
│   ├── MCP
│   ├── Skills
│   ├── Load Balancer
│   ├── Voice
│   ├── MAGI
│   └── Credential Vault
│
├── AgentGoRound Pi Integration Layer
│   ├── PiAgentRuntime
│   ├── PiEventBridge
│   ├── PiToolRegistry
│   ├── PiContextAssembler
│   ├── PiSessionBridge
│   └── PiProviderAdapter
│
└── REAL upstream Pi
    ├── @earendil-works/pi-agent-core
    └── @earendil-works/pi-ai
         │
         ├── Browser-native tools
         ├── MCP tools
         ├── AgentGoRound tools
         └── Future Computer Tools
                    │
                    └── WebContainer / Succinix
                        (optional, later)
```

AgentGoRound 的價值從：

```text
「自己重做 Pi」
```

轉為：

```text
「Browser-native Pi multi-agent environment」
```

---

## 2. 核心決策

### Decision A — Pi 是唯一 Agent Engine

正式 migration 完成後：

```text
User
↓
Pi Agent
↓
Pi AgentTool
↓
AgentGoRound Tool Adapter
↓
MCP / Built-in / Skill / Browser / Computer
```

不再存在：

```text
User
↓
AgentGoRound custom canonical harness
↓
custom Pi-like action protocol
↓
tool
```

### Decision B — Pi 直接跑 Browser JavaScript

核心 runtime：

```text
Browser JS
└── @earendil-works/pi-agent-core
```

不是：

```text
Browser
↓
WebContainer
↓
Node
↓
Pi
```

原因（已於 2026-09-01 對 0.84.4 的實際 dist 驗證，見 §4.1）：

- Pi core 本身已可作為可嵌入 Agent runtime 使用。
- `@earendil-works/pi-agent-core` 的 `.` entry 靜態相依圖**完全沒有 `node:*` import**；Node-only 實作（`child_process` / `fs` / `os` / `readline` …）被隔離在 `./node` subpath export。
- `@earendil-works/pi-ai` 的 `.` entry 同樣沒有 `node:*` import；provider 實作全部走 lazy dynamic import，且 OpenAI / Anthropic client 皆已帶 `dangerouslyAllowBrowser: true`。
- Browser UI、abort、streaming、tool approval 不需要跨 WebContainer RPC boundary。
- 沒有 Computer Mode 時仍能完整使用 Pi chat / MCP / Docs / Skills / MAGI。
- WebContainer crash 不會直接摧毀 agent runtime。

### Decision C — WebContainer 延後，而且只是 Computer

未來：

```text
Pi Agent
↓
read / write / edit / bash AgentTools
↓
ComputerAdapter
↓
WebContainer
```

不要：

```text
WebContainer
└── Pi
```

### Decision D — Herdr-like UI 在 Pi Foundation 後立即做

不要：

```text
全部 Pi migration 完成
↓
最後才換 UI
```

因為 Docs / MCP / Skills / MAGI 會先被接進舊 UI，最後又重接一次。

也不要：

```text
現在先改 UI
↓
之後再換 Pi runtime
```

因為現在 UI 還依賴 legacy runtime state assumptions。

最合理：

```text
PoC
↓
Pi Runtime Foundation
↓
Herdr-like UI Foundation
↓
功能逐步遷移
```

---

## 3. Roadmap Overview

```text
PHASE 0
Freeze Legacy + Baseline
        │
        ▼
PHASE 1
Browser Pi PoC
        │
        │ PASS?
        ├────────────── NO → investigate blocker / stop migration
        │
        ▼ YES
PHASE 2
Production Pi Runtime Foundation
        │
        ▼
PHASE 3
Herdr-like UI Foundation
  (⚠ tutorial oracle 會在此失效，見 §36.1)
        │
        ▼
PHASE 4
Docs
        │
        ▼
PHASE 5
MCP
        │
        ▼
PHASE 6
Built-in Tools + ToolEffectRunner
        │
        ▼
PHASE 7
Skills
        │
        ▼
PHASE 8
Chat / Session Persistence
        │
        ▼
PHASE 9
Load Balancer / Providers
  (⚠ streamFn 阻抗最大，spike 應提前，見 §56.3)
        │
        ▼
PHASE 10
Voice
        │
        ▼
PHASE 11
MAGI
        │
        ▼
PHASE 12
Tutorial / Regression / Rollout
        │
        ▼
PHASE 13
Delete Legacy Harness
        │
        ▼
PHASE 14 (Optional)
Computer Mode / WebContainer
```

---

## 4. Current Technical Baseline

截至 2026-09-01：

```text
@earendil-works/pi-agent-core  0.84.4
@earendil-works/pi-ai          0.84.4
```

PoC 建議 exact pin：

```json
{
  "dependencies": {
    "@earendil-works/pi-agent-core": "0.84.4",
    "@earendil-works/pi-ai": "0.84.4"
  },
  "overrides": {
    "@earendil-works/pi-ai": "0.84.4",
    "@earendil-works/pi-telemetry": "0.84.4"
  }
}
```

不要 PoC 一開始使用：

```json
"^0.84.4"
```

**只 pin top-level 是不夠的。** `pi-agent-core@0.84.4` 自己宣告 `"@earendil-works/pi-ai": "^0.84.4"` 與 `"@earendil-works/pi-telemetry": "^0.84.4"`，所以在沒有 `overrides` 的情況下，npm 仍可能為巢狀相依安裝較新的 pi-ai/pi-telemetry，導致「top-level pin 住、實際跑的是別的版本」。因此：

- 使用 `overrides` 鎖住整個 `@earendil-works/*` 版本面。
- `package-lock.json` 必須 commit，CI 使用 `npm ci`（現有 workflow 已是 `npm ci`）。
- PoC 完成後在計畫中記錄實際 resolved 版本（`npm ls @earendil-works/pi-ai`）。

Pi 目前仍在快速迭代。

### 4.0.1 Node engine note

兩個 package 都宣告：

```json
"engines": { "node": ">=22.19.0" }
```

但 PR 0 前 `.github/workflows/pages.yml` 與 `gh-pages.yml` 都使用 `node-version: "20"`；PR 0 已將保留的 production workflow 與 preview workflow 對齊 Node 22。

安裝時 npm 預設只會 warn 不會 fail，但這是計畫必須明確處理的一件事。

**決策 D3 — 升級到 Node 22 LTS。**

理由：`test:tutorial` 與 `test:real_tutorial` 是用 `tsx` 在 Node 上跑的，會實際 import 到 Pi 的程式碼路徑；「build 只需要 bundler」這個風險接受理由對 tutorial runner 不成立。與其在遇到怪問題時才回頭懷疑 Node 版本，不如一開始就對齊 upstream 宣告的下限。

PR 0 的具體工作：

- [x] `.github/workflows/gh-pages.yml` 的 `node-version` 由 `"20"` 改為 `"22"`；舊 `pages.yml` 已移除
- [x] 新增 `.nvmrc`（`22`），讓本機與 CI 一致
- [x] `package.json` 加上 `"engines": { "node": ">=22.19.0" }`
- [x] 在 Node 22 上重跑並記錄 §6.3 的完整 deterministic baseline（**baseline 必須在升版後的環境量測**）；結果見 `docs/baseline/README.md`
- [x] 確認 Vite 6 / Vitest 3 / tsx 在 Node 22 無新工具鏈警告；`npm ci` 僅有既存 transitive deprecation warnings，build 保留既存 chunk advisory

排序很重要：**Node 升級要在量 baseline 之前完成**，不要量完 baseline 才升。

---

## 4.1 Verified Upstream Pi Facts（2026-09-01，對 0.84.4 dist 實測）

以下每一項都是本計畫其他章節的前提。**任何一項在 Phase 1 重新驗證時不成立，對應章節必須改寫，而不是繼續推進。**

| # | 事實 | 影響章節 |
|---|---|---|
| F1 | `pi-agent-core` 的 `.` entry（41 個檔案）與 `pi-ai` 的 `.` entry（23 個檔案）靜態圖中 **0 個 `node:*` import** | Decision B、§15 |
| F2 | Node-only 實作在 `pi-agent-core/node`（`harness/env/nodejs.js` → `child_process`/`fs`/`os`/`readline`/`crypto`/`path`/`url`）。**Browser 端不得 import `/node`** | §15、§19 |
| F3 | `new Agent(options)` 的 `options.streamFn` 是**必填**，型別為 `(model, context, options?) => AssistantMessageEventStream \| Promise<...>` | §20、§56–58 |
| F4 | `Agent` 提供 `subscribe()`、`abort()`、`waitForIdle()`、`reset()`、`prompt()`、`continue()`、`steer()`、`followUp()` | §13、§20 |
| F5 | `AgentEvent.type` 實際值：`agent_start`、`agent_end`、`turn_start`、`turn_end`、`message_start`、`message_update`、`message_end`、`tool_execution_start`、`tool_execution_update`、`tool_execution_end` | §12、§28、§33 |
| F6 | `AgentOptions.beforeToolCall` 回傳 `{ block?, reason?, terminate? }`；`afterToolCall` 可覆寫 `content`/`details`/`isError`/`usage`/`terminate`（欄位級取代，無 deep merge） | §34、§45–47 |
| F7 | `AgentTool` 的 schema 是 **TypeBox `TSchema`**（`typebox@1.3.7`），不是 JSON Schema | §42–43 |
| F8 | `AgentToolResult.addedToolNames` 可在 tool result 後動態新增可用 tool | §49–50 |
| F9 | `Agent.state` 的 `pendingToolCalls`、`isStreaming`、`streamingMessage`、`errorMessage` 是 readonly，且被 `AgentOptions.initialState` 的型別明確 `Omit` 掉 | §14、§52–54 |
| F10 | `toolExecution: "sequential" \| "parallel"`（全域）＋ `AgentTool.executionMode`（單一 tool 覆寫） | §45–47 |
| F11 | core 匯出 `SessionStorage` interface、`InMemory*` 與 `JsonlSessionRepo`；**core 內完全沒有 sqlite**。另有 `@earendil-works/pi-agent-core/session/testing` 匯出 `createSessionBackendConformance(factory)` | §52–54 |
| F12 | `pi-ai` 的 `createModels(options?)` 只接受 `{ credentials, modelsStore, authContext }`；自訂 provider 走 `createProvider({ id, baseUrl, headers, auth, models, api })` | §19、§56 |
| F13 | provider API 實作是 lazy dynamic import（`api/openai-completions.lazy.js` 等），從 `@earendil-works/pi-ai/api/*` subpath 取得 | §19、§56 |
| F14 | `api/openai-completions.js`、`api/anthropic-messages.js` 建立 client 時已設 `dangerouslyAllowBrowser: true` | §79 |
| F15 | Bedrock 走 variable-specifier dynamic import 刻意讓 bundler 追不進 AWS SDK（upstream 註解明寫是為了 "browser smoke"） | §15、§4.2 |
| F16 | `pi-ai/dist/providers/data` 有 652KB model metadata；`providers/all.js` 會把全部 provider 拉進來 | §4.2 |

驗證方式（Phase 1 必須重跑並把結果寫回本節）：

```bash
npm view @earendil-works/pi-agent-core@<pin> dependencies engines exports
npm ls @earendil-works/pi-ai
# 對 node_modules/@earendil-works/*/dist 做 import graph 檢查，確認 `.` entry 無 node:*
```

---

## 4.2 Bundling Constraints（必須寫進 Phase 1 驗收）

1. **不要 `import "@earendil-works/pi-ai/providers/all"`。** 那會把 16 個 provider 與 652KB model metadata 打進 bundle。AgentGoRound 應該用 `createProvider()` 自行組出 OpenAI-compatible provider，API 用 `@earendil-works/pi-ai/api/openai-completions.lazy`。
2. **Bedrock 的 variable-specifier dynamic import 會讓 Vite 印出 "dynamic import cannot be analyzed" 警告。** Phase 1 必須確認：(a) build 不因此失敗；(b) 產物中沒有殘留會在 runtime 404 的相對路徑；必要時用 Vite alias 把 `bedrock-converse-stream` stub 掉。
3. **Bundle 預算是驗收條件，不是「之後再看」。** AgentGoRound 部署在 GitHub Pages 且要支援手機。Phase 0 先量 `dist/` 的 gzip 總量與最大 chunk，Phase 1/2/3 各記錄一次；單次 phase 增幅超過協議值（建議 initial route JS gzip +300KB）要先解釋再合併。
4. `@earendil-works/pi-ai` 依賴 `openai@6.40.0`、`@anthropic-ai/sdk@0.91.1`、`@google/genai@1.52.0`。PoC 只需要驗證實際會用到的那一條路徑（OpenAI-compatible），但要確認未使用的 provider **不會**被靜態拉進 initial chunk。

---

## 5. Important Pi Package Notes

### 5.1 不使用 pi-coding-agent 作 Browser Core

PoC 與正式 Browser Runtime 應使用：

```text
@earendil-works/pi-agent-core
@earendil-works/pi-ai
```

不要把：

```text
@earendil-works/pi-coding-agent
```

整包搬進 browser。

pi-coding-agent 是 terminal coding agent product；AgentGoRound 應使用 lower-level agent runtime。

### 5.2 不使用 /base

Pi 曾在 0.79.8 加入：

```text
@earendil-works/pi-agent-core/base
```

`/base` 只存在於 0.79.8 / 0.79.9 / 0.79.10；0.80.0 未發布，從 0.80.1 起 exports map 已無 `./base`（已對 npm registry metadata 逐版驗證）。

目前應：

```ts
import { Agent } from "@earendil-works/pi-agent-core";
import { createModels } from "@earendil-works/pi-ai";
```

並顯式建立 Models / Provider。

---

## 6. Phase 0 — Freeze Legacy

### 目標

保留現在可工作的 AgentGoRound 作 migration oracle。

### 6.1 建立 baseline tag

```text
pre-pi-native-v2-2026-09
```

### 6.2 Legacy Harness 進入 Maintenance-only

以下不再加新 feature：

```text
src/runtime/harness/
src/chat/useAgentHarnessController.ts
src/chat/harnessChatTurn.ts
```

只接受：

- regression fix
- critical security fix
- migration blocker fix

### 6.3 建立測試基線

記錄：

```bash
npm test
npm run lint
npm run build
npm run test:tutorial
```

Phase 0 的產出**不是「跑過了」，而是一張填好數字的表**，之後每個 phase 都要對照它：

| 指標 | 取得方式 | Baseline 值 | 說明 |
|---|---|---|---|
| Vitest 檔案數 / 測試數 / 耗時 | `npm test` | 52 files / 343 tests / 22.47s | Node 22.23.2；預期 localStorage/safeStorage stderr 已保留 |
| ESLint warnings | `npm run lint` | 0；PASS | `--max-warnings 0` |
| `tsc -b` 是否乾淨 | `npm run build` | PASS；clean | Vite build 另有既存單一 chunk >500 kB advisory |
| `dist/` 總大小 / gzip | `npm run build` 後量測 | 1,554,111 B / 371,844 B gzip | §4.2 bundle 預算的基準；gzip 為每個 dist file level 9 後加總 |
| 最大單一 JS chunk（gzip） | 同上 | 304,550 B gzip | `assets/index-zfTQ_v5j.js` |
| `npm run test:tutorial` | deterministic runner | PASS；`tutorial-runtime-check: ok` | |
| Real tutorial gate ×4 | 見 §64.1 | Partial；`harness-stability-skill` 10/10、`text-protocol-conformance` 3/3；`chatgpt-browser-skill` 0/10、`grilling-invest-skill` 2/10，後兩組受 Groq TPM/TPD 與 browser step limit 阻擋 | 不宣稱 pass；完整診斷與成功率見 `docs/gates/phase-0.md` |
| Desktop / mobile smoke | 手動 | PASS；1440×1000、390×844、`/agent-go-round/` base path | 截圖存於 `docs/baseline/` |

同時保存：

- baseline tag 的 production build artifacts（`dist/`），作為 §101 rollback 的可部署回退點
- Chrome smoke test 與 mobile smoke test 的截圖
- `npm ls --omit=dev --depth=0` 輸出（migration 期間相依變化的對照）

### 6.3.1 CI 現況與 PR 0 結果

PR 0 前 `.github/workflows/pages.yml` 與 `gh-pages.yml` 都是：

```text
push to main → npm ci → npm run build → deploy
```

**沒有任何 test / lint gate。** 這表示：

- 合併到 main 就會自動部署到 GitHub Pages。
- 沒有任何機制阻止一個壞掉的 Pi runtime 直接上線。

PR 0 已把現況改為：

- `.github/workflows/gh-pages.yml` 的 `verify` job 依序跑 `npm run lint`、`npm test`、`npm run build` 與 `npm run check:bundle`（deterministic 部分）。
- `deploy` job 明確 `needs: verify`；失敗的 gate 不會部署。
- `.github/workflows/pages.yml` 已移除；GitHub Pages source 已確認為 `gh-pages` branch `/`，設定與回退指令見 `docs/deployment.md`。
- 這是後續 12 個 phase 唯一的自動化安全網，不做等於整份計畫沒有 gate。

### 6.4 禁止同時大改舊 runtime

這一階段不要：

- 重做 contextProjector
- 擴充 custom canonical protocol
- 加新的 planner
- 加新的 legacy transport
- 加新的 legacy skill action semantics

---

### 6.5 Sizing Gate（Phase 0 交付物，Phase 1 開始前的 Go/No-Go）

這是計畫唯一剩下的重大未知。技術路徑已經逐項驗證過，但**沒有任何規模估計**——而 D1（T1，成本前置）與 D9（spike 提前）都是刻意把成本往前挪的決定。如果總容量撐不到 Milestone C，這些前置成本就變成純損失。

**定位：** 這不是精確承諾，也不是排程。它是一個**由 owner 以實際團隊容量做的 Go/No-Go 判斷**，在 Phase 0 結束、Phase 1 開始前完成。輸出只有三種：

```text
GO          容量足以走到至少 Milestone C（單 Agent parity）
GO (縮減)   先砍範圍再開始（例如 MAGI 延後、Voice 延後）
NO-GO       不啟動；維持 legacy harness 並只做維護
```

**為什麼門檻設在 Milestone C：** Milestone A/B 結束時，產品處於「新 runtime + 新 shell，但功能還沒遷移完」的中間狀態——比現況差。走到 C（單 Agent parity）才第一次回到「不比現在差」。**在 C 之前停手，是淨損失。** 所以容量評估的問題不是「能不能做完全部」，而是「能不能保證走到 C」。

#### 6.5.1 要填的表

單位：**工程週（engineer-week）**，一人全職一週。給**範圍**不給單點值。

| PR 組合 | 範圍(eng-wk) | 關鍵假設 | 無法並行的依賴 |
|---|---|---|---|
| PR 0（freeze + CI gate + Node 22 + baseline） | 1 | CI 改動不需重寫 workflow 架構 | 阻擋所有後續工作 |
| PR 1（Browser Pi PoC） | 3 | §4.1 F1–F16 重驗後成立 | 嚴格序列：必須先於 PR 2 |
| PR 2S（LB streaming spike） | 1.5 | 可用 fixture provider 驗，不需真實 failover | 與 PR 2 並行，閘控其 merge |
| PR 2（Pi runtime foundation） | 4 | PR 2S 的 Q1 為可行 | 嚴格序列：阻擋 PR 3 以後全部 |
| PR 3a/3b/3c（UI v2 + anchor 契約 + 文案審查） | 10 | D1=T1 的 anchor 契約可涵蓋現有 11 個 targetId | 嚴格序列：阻擋 PR 4 以後全部 |
| PR 4（Docs + §37.1 context ownership） | 3 | 現有 docs 資料不需轉換 | PR 4–7 之間可部分並行 |
| PR 5（MCP + TypeBox 轉換） | 4 | D4=S1，轉不動的 tool 直接排除 | 同上 |
| PR 6（Built-ins + §46.1 outcome 對應） | 3 | 不重做 sandbox（§48） | 同上 |
| PR 7（Skills） | 3 | D11 成立，不換 artifact 格式 | 同上 |
| PR 8（Persistence + §102 遷移 + §52.5 多分頁） | 8 | upstream conformance 可直接套用 | 嚴格序列：阻擋 PR 9/11 的 session 相關部分 |
| PR 9（LB + §58.2 token 會計） | 4 | PR 2S 的結論仍成立 | 依賴 PR 8 |
| PR 10（Voice） | 1.5 | 只換送出接點 | 可與 PR 9 並行 |
| PR 11（MAGI） | 4 | 沿用同一套 AgentRuntimeView | 依賴 PR 8 |
| PR 12（Tutorial / regression + 新 conformance 案例） | 3 | D8=A 的新案例可涵蓋 tutorial 9 的價值 | 依賴前面全部 |
| PR 13（刪除 legacy + 文件） | 2 | §66 刪除門檻全過 | 依賴前面全部 |

#### 6.5.2 審閱者初估（供 owner 校準，**不是承諾、不是排程**）

我沒有這個團隊的生產力數據，以下純粹是依 §4.1 驗證過的技術面與 repo 現況（3,164 行 legacy harness、53 個測試檔、9 個 tutorial、118 處 anchor 引用）推出的量級，**owner 必須用實際容量取代**：

```text
PR 0                    0.5 –  1.5
PR 1                    1   –  3
PR 2S                   0.5 –  1.5
PR 2                    2   –  4
PR 3a/3b/3c             5   – 10     ← 最大單項
PR 4                    1.5 –  3
PR 5                    2   –  4
PR 6                    1.5 –  3
PR 7                    1.5 –  3
PR 8                    4   –  8     ← 次大單項
PR 9                    2   –  4
PR 10                   0.5 –  1.5
PR 11                   2   –  4
PR 12                   1.5 –  3
PR 13                   1   –  2
                       ─────────────
總計                    27  – 55 eng-wk
到 Milestone C（PR 0–10） 22  – 47 eng-wk
```

兩個大項（PR 3 與 PR 8）合計佔總量約三分之一，而且**兩者都在嚴格序列上**——無法用加人縮短。這是估計裡最需要 owner 挑戰的部分。

#### 6.5.3 依賴鏈（限制可並行度）

```text
PR 0 → PR 1 → PR 2(+2S) → PR 3 ─┬→ PR 4 ┐
                                 ├→ PR 5 ├→ PR 8 ─┬→ PR 9 ─┐
                                 ├→ PR 6 │        ├→ PR 11 ├→ PR 12 → PR 13
                                 └→ PR 7 ┘        └→ PR 10 ┘
```

- 前段 `PR 0 → 1 → 2 → 3` 完全無法並行，約佔總量的三分之一。
- PR 4–7 是唯一有明顯並行空間的區段。
- **加人只能壓縮 PR 4–7。** 用「總工程週 ÷ 人數」估算完成時間會嚴重低估，這是本表最容易被誤用的地方。

#### 6.5.4 Go/No-Go 判準

- [ ] 表已由實際會做這件事的人填完，不是由估計者填
- [ ] 已標出「到 Milestone C」的容量需求，並與實際可投入容量比較
- [ ] 若容量不足以保證走到 C，已明確選擇縮減範圍或 NO-GO（**不允許「先做做看」**——中途停在 A/B 是淨損失）
- [ ] 決策與理由寫回本節，含填表日期與 owner
- [ ] 已識別「若某一項超出上界 50%」的重新評估點（建議在 PR 3 與 PR 8 結束時各設一次）

#### 6.5.5 Phase 0 執行狀態（2026-09-01）

PR 0 已完成本地工程護欄、Node 22 deterministic baseline、bundle budget 與
preview/rollback 方案；2026-09-02 owner 已授權由 Codex 估算容量，採完整 scope。

#### 6.5.6 Owner capacity input and G0 decision（2026-09-02）

| Owner | Available executor | Capacity through Milestone C | Full-scope capacity | Scope | Decision |
|---|---|---:|---:|---|---|
| gipapa | 1 Codex engineering agent | 60 eng-wk | 60 eng-wk | 完整（PR 0–13） | **GO** |

這是 owner 明確授權的 planning envelope，不是對人類團隊產能的觀察，也不是
日曆排程。PR 0–10 的審閱者範圍上界是 47 eng-wk，完整 PR 0–13 的上界是
55 eng-wk；60 eng-wk 因此保留 5 eng-wk 的全程 buffer。採單一 executor，
不假設可把嚴格序列壓縮成平行工作；PR 4–7 仍依依賴圖安排可並行項目。

G0 結論為 **GO**：容量足以保證至少走到 Milestone C，也足以涵蓋完整 scope。
若 PR 3 或 PR 8 任一實際成本超過本表上界 50%，或 buffer 被耗盡，必須在
該 PR 結束重新 sizing；若無法再保證到 C，應改判 `GO (縮減)` 或 `NO-GO`，
不得中途停在 Milestone A/B。

---

## 7. Phase 1 — Browser Pi PoC

### 7.1 Branch

```text
spike/pi-browser-poc
```

### 7.2 PoC 的問題只有一個

> 真正 upstream Pi Agent 能不能直接在 AgentGoRound 的 Vite/React Browser runtime 中完成完整 agent/tool loop？

必須：

```text
NO backend
NO local Pi
NO WebContainer
NO Node server
```

---

## 8. PoC Scope

PoC 只做：

1. new Agent(...)
2. 一個 browser-compatible provider
3. streaming
4. deterministic AgentTool
5. tool result
6. automatic next Pi turn
7. final answer
8. abort
9. reload restore
10. production build

### PoC 明確不做

- Docs
- MCP
- Skills
- MAGI
- Voice
- Load Balancer failover
- WebContainer
- Succinix
- current ToolEffectRunner
- UI redesign

PoC UI 越醜越好。

---

## 9. PoC Architecture

```text
PiPocPage
   │
   ▼
createModels()
   │
   ▼
new Agent()
   │
   ├── model streaming
   │
   └── add_numbers AgentTool
          │
          ▼
       Browser JS
```

---

## 10. PoC Suggested Files

```text
src/pi-poc/
├── PiPocPage.tsx
├── createPiModels.ts
├── createPiAgent.ts
├── piPocEventLog.ts
├── piPocSessionStore.ts
└── tools/
    └── addNumbersTool.ts
```

---

## 11. PoC Tool Test

Prompt：

```text
請一定要使用 add_numbers 工具計算 123 + 456，
並根據工具結果回答。
```

期待：

```text
User
↓
Pi model
↓
tool_call add_numbers
↓
execute
↓
tool_result 579
↓
Pi model follow-up
↓
Final answer
```

不能只測 plain text completion。

---

## 12. PoC Event Debug UI

顯示：

```text
agent_start
message_start
message_update
message_end
tool_execution_start
tool_execution_update
tool_execution_end
agent_end
```

PoC 不要做漂亮 chat UI。

只要能看出事件順序。

---

## 13. PoC Abort Gate

必須：

```text
prompt
↓
streaming
↓
STOP
↓
abort
↓
agent cleanly stops
↓
next prompt still works
```

如果 abort 不能可靠工作：

> 不進正式 migration。

---

## 14. PoC Restore Gate

最小保存：

```text
agent.state.messages
```

到：

```text
IndexedDB
```

Reload：

```text
IndexedDB
↓
new Agent(initialState.messages)
↓
continue
```

PoC 不需要先實作完整 session repository。

---

## 15. PoC Production Gate

必須：

```bash
npm run build
```

並用 production build 測試。

確認：

- no node:* unresolved imports
- no native addon
- no process is not defined
- no Buffer is not defined
- chunks 可正常載入
- static hosting 正常
- Agent tool loop 正常

---

## 16. PoC PASS Criteria

全部必須通過：

- [ ] Real @earendil-works/pi-agent-core
- [ ] Browser JS execution
- [ ] No backend
- [ ] No local Pi
- [ ] No WebContainer
- [ ] Real provider streaming
- [ ] AgentTool call
- [ ] Tool result
- [ ] Automatic follow-up turn
- [ ] Final response
- [ ] Abort
- [ ] New prompt after abort
- [ ] Minimal IndexedDB persistence
- [ ] Reload restore
- [ ] Vite production build
- [ ] Static production smoke test

---

## 17. PoC GO / NO-GO

### GO

全部 PASS：

```text
Adopt upstream Pi as canonical AgentGoRound engine.
```

### NO-GO

只有遇到不可修正的：

- Browser bundling blocker
- Pi runtime Node-only dependency
- Tool loop browser incompatibility
- critical restore impossibility

才重新評估其他 architecture。

Provider CORS failure 不算 Pi runtime failure。

---

## 18. Phase 2 — Production Pi Runtime Foundation

PoC 通過後，不直接把 PoC code 擴建。

新增：

```text
src/pi/
```

---

## 19. Suggested Production Structure

```text
src/pi/
├── runtime/
│   ├── PiAgentRuntime.ts
│   ├── createPiAgentRuntime.ts
│   ├── piAgentRegistry.ts
│   └── types.ts
│
├── events/
│   ├── PiEventBridge.ts
│   ├── PiRuntimeProjector.ts
│   └── types.ts
│
├── tools/
│   ├── PiToolRegistry.ts
│   ├── createBuiltinPiTool.ts
│   ├── createMcpPiTool.ts
│   ├── createSkillPiTools.ts
│   └── types.ts
│
├── providers/
│   ├── createPiModels.ts
│   └── piLoadBalancerAdapter.ts
│
├── context/
│   └── PiContextAssembler.ts
│
└── session/
    ├── PiSessionBridge.ts
    └── PiSessionPersistence.ts
```

> 兩點修正：
> 1. `providers/piLoadBalancerAdapter.ts` 屬於 **Phase 9**，Phase 2 只需要 `createPiModels.ts` 加單一 provider（與 §57 的順序一致）。Phase 2 建立檔案骨架可以，但不要在這個 PR 實作 failover。
> 2. `session/PiSessionPersistence.ts` 屬於 **Phase 8**。Phase 2 的 `PiSessionBridge` 只負責把 Pi events 投影出去，不負責落地。

---

## 20. PiAgentRuntime

這是 AgentGoRound product layer 與 Pi 的唯一主要 runtime boundary。

概念：

```ts
interface PiAgentRuntime {
  agentId: string;
  sessionId: string;

  prompt(text: string): Promise<void>;
  abort(): Promise<void>;

  getStatus(): AgentRuntimeView;
  subscribe(listener: RuntimeListener): () => void;

  updateTools(): void;
  updateContext(): void;

  dispose(): Promise<void>;
}
```

UI 不應直接到處 new Agent()。

### 20.1 這個介面缺了核准與問答（Q1，必須在 PR 2S 一併定案）

上面的介面只有 `prompt / abort / getStatus / subscribe / updateTools / updateContext / dispose`——**沒有任何 approve / reject / answer**。但：

- §34 要求 [Approve] [Reject] 按鈕
- §36 把 "approval UX" 列為 Phase 3 驗收
- §79.1 第 4 點規定 `beforeToolCall` 是唯一核准入口

UI 該呼叫什麼來解除一個 blocked？計畫原本沒有答案。若不補，PR 3 會被迫繞過 `PiAgentRuntime` 直接接某個全域佇列，違反 §75 的 runtime/UI 邊界。

補上顯式 API：

```ts
interface PiAgentRuntime {
  // ... 原有成員

  /** 解除一個等待中的 tool 核准。callId 來自 AgentRuntimeView.currentActivity。 */
  resolveApproval(callId: string, decision: "approve" | "reject", reason?: string): void;

  /** 回答 agent 的 ask-user 提問。 */
  answer(promptId: string, text: string): void;

  /** 對執行中的 run 插話（upstream Agent.steer，§4.1 F4）。 */
  steer(text: string): void;

  /** 排入下一輪（upstream Agent.followUp）。 */
  followUp(text: string): void;

  /** 等待目前 run 與所有 listener 收斂（upstream Agent.waitForIdle）。 */
  waitForIdle(): Promise<void>;
}
```

兩個語意要一併寫死：

- `prompt(text)` 的 Promise 在 **run 結束**時 resolve（沿用 upstream `Agent.prompt` 語意），不是「已送出」。UI 不應 await 它來決定何時解鎖輸入框，應該用 `subscribe` 的狀態。
- `abort()` 宣告為 `Promise<void>`，但 upstream `Agent.abort()` 是同步 `void`。這裡的 Promise **必須明確定義為 abort + `waitForIdle()`**，否則呼叫端無法知道何時可以安全 dispose 或換 session。

### 20.2 核准是「在 `beforeToolCall` 內部 await」——這個實作方式的後果要寫清楚

upstream 的 `beforeToolCall?: (context, signal?) => Promise<BeforeToolCallResult | undefined>` 回傳 Promise，所以核准的實作方式就是**在裡面 await 使用者的決定**。這是唯一符合 §79.1「`beforeToolCall` 是唯一核准入口」的做法。

但這代表：**Pi 的 run 在等待人類時仍然存活、仍然持有 abort signal、仍然佔著 §52.5 的分頁寫入鎖。** 這個後果延伸出 §81.1 的整個問題，必須一起看。

---

## 21. 不要建立第二套 Agent Engine

PiAgentRuntime 只能做：

- Pi instance lifecycle
- event bridge
- app config mapping
- tool registry mapping
- persistence bridge
- UI view projection

不能做：

- 自己的 agent loop
- 自己的 tool-call protocol
- 自己的 message orchestration semantics
- 自己的 planner

---

## 22. Runtime Feature Flag

Migration 期間：

```ts
type RuntimeEngine = "legacy" | "pi";
```

可用：

```text
?engine=pi
```

或 per-agent developer setting。

目的：

- regression comparison
- incremental migration
- safe rollback

不是永久 dual-engine product。

### 22.1 Flag 的有效範圍（重要，避免與 §36 / §78 矛盾）

原始寫法有一個未解的矛盾：

- §22 說 flag 提供 "safe rollback"
- §36 又說「legacy engine 也可以 temporary project into same UI，若 migration 需要」
- §78 又說不可以有兩套 ownership

三者不能同時成立。**本計畫採用以下明確界線：**

```text
Phase 2 期間（舊 UI 仍在）
  → ?engine=legacy | pi 兩者都可用
  → 這是 flag 唯一真正有意義的期間

Phase 3 之後（UI v2 成為 shell）
  → flag 只切換「哪一個 runtime 驅動 UI v2」是 NON-GOAL
  → 不為 legacy harness 撰寫第二套 AgentRuntimeView projector
  → rollback 改用 §101 的部署層 rollback
```

理由：為 legacy harness 再寫一套 → `AgentRuntimeView` 的 projector，等於在 migration 中途多做一套會被刪掉的 adapter，且直接違反 §21 / §78。AgentGoRound 是純靜態前端，部署層 rollback 便宜且可靠，不需要用 runtime 複雜度去買。

因此 §36 的「legacy engine 也可以 temporary project into same UI」條目**移除**，改為 §101 的部署 rollback 條件。

---

## 23. Phase 3 — Herdr-like UI Foundation

這是整個計畫最重要的 UI phase。

### Timing

必須在：

```text
Pi Runtime Foundation
```

完成後。

並且在：

```text
Docs / MCP / Skills / MAGI 大規模遷移
```

之前。

---

## 24. Herdr-like 的真正意思

不是：

```text
clone Herdr pixel-for-pixel
```

而是借它的 information architecture：

```text
Agent / Workspace first
Conversation second
Attention state first-class
Tool/activity visible
Mobile usable
```

---

## 25. Herdr-like UI 核心概念

每一個 Agent 都有 semantic state：

```text
idle
working
blocked
done
error
```

其中：

```text
blocked
```

代表：

> Agent 正在等使用者處理。

例如：

- tool approval
- credential
- confirmation
- ask-user
- MCP auth
- recoverable error decision

---

## 26. Attention-Oriented Sorting

Agent list 預設排序：

```text
blocked
↓
error
↓
done unseen
↓
working
↓
idle
```

而不是：

```text
alphabetical
```

或：

```text
creation time
```

---

## 27. AgentRuntimeView

Herdr-like UI 不直接讀 Pi internal state。

建立：

```ts
interface AgentRuntimeView {
  agentId: string;
  sessionId: string;

  status:
    | "idle"
    | "working"
    | "blocked"
    | "done"
    | "error";

  attentionRequired: boolean;
  unseen: boolean;

  currentActivity?: {
    kind:
      | "thinking"
      | "responding"
      | "tool"
      | "approval"
      | "waiting";
    label?: string;
    toolName?: string;
  };

  lastActivityAt: number;
  latestPreview?: string;
}
```

---

## 28. UI Projection Architecture

```text
Pi Agent Events
      │
      ▼
PiEventBridge
      │
      ▼
PiRuntimeProjector
      │
      ▼
AgentRuntimeView
      │
      ▼
Herdr-like React UI
```

注意：

> `PiRuntimeProjector` 是 presentation projection，不是新的 agent harness。

### 28.1 單一輸入的投影鏈產生不出 `blocked`（Q1 的另一半）

上面的箭頭圖只有一個輸入源：Pi events。但 §4.1 F5 已經列出 Pi 的完整事件集合：

```text
agent_start / agent_end / turn_start / turn_end
message_start / message_update / message_end
tool_execution_start / tool_execution_update / tool_execution_end
```

**沒有任何 approval 相關事件。** 核准是 AgentGoRound 在 `beforeToolCall` 裡自己 await 出來的狀態，Pi 完全不知情。所以 §33 的「tool approval requested → blocked」在單一輸入的投影模型下**無法實作**。

修正為雙輸入投影：

```text
Pi Agent Events ─────┐
                     ├─→ PiRuntimeProjector ─→ AgentRuntimeView ─→ UI
AgentGoRound         │
policy state ────────┘
  ├── pending approvals（callId / toolName / server / args）
  ├── pending ask-user
  ├── credential missing
  └── unseen / attention 標記
```

**這不算違反 §78。** §78 禁止的是「同一個事實有兩個互相矛盾的來源」。這裡兩邊擁有的是不同事實：

| 事實 | 擁有者 |
|---|---|
| run 是否進行中、訊息順序、tool-call 生命週期 | **Pi**（唯一來源） |
| 是否有待核准／待回答、是否需要注意、是否已讀 | **AgentGoRound**（唯一來源） |

§77 的 ownership 表要據此補上：`blocked` / `attentionRequired` / `unseen` 明確歸 AgentGoRound；Pi 只提供 `running` / `idle` / `error`。投影器負責合成，不負責決定。

- [ ] `AgentRuntimeView` 的 `status` 推導規則寫成純函式並有測試：`(piRunState, policyState) => status`
- [ ] 有測試：Pi 回報 running、同時存在 pending approval → view 必須是 `blocked`，不能是 `working`

---

## 29. Desktop Layout

第一版：

```text
┌──────────────────┬──────────────────────────────────────┐
│ AGENTS           │ WORKSPACE                            │
│                  │                                      │
│ ⚠ Research       │ Agent: Research                      │
│   blocked        │ Status: needs approval               │
│                  │                                      │
│ ● Coder          │ ┌──────────────────────────────────┐ │
│   working        │ │ Conversation                     │ │
│                  │ │                                  │ │
│ ✓ Reviewer       │ │                                  │ │
│   done           │ └──────────────────────────────────┘ │
│                  │                                      │
│ ○ Writer         │ Activity / Tool / Approval           │
│   idle           │                                      │
│                  │                                      │
├──────────────────┤                                      │
│ + New Agent      │                                      │
│ MAGI             │                                      │
│ Docs             │                                      │
│ Skills           │                                      │
│ MCP              │                                      │
└──────────────────┴──────────────────────────────────────┘
```

---

## 30. Mobile Layout

```text
┌────────────────────────────────────┐
│ ⚠ A   ● B   ✓ C   ○ D             │
├────────────────────────────────────┤
│ Research                           │
│ blocked · waiting approval         │
├────────────────────────────────────┤
│                                    │
│ Conversation                       │
│                                    │
│                                    │
├────────────────────────────────────┤
│ Tool approval                      │
├────────────────────────────────────┤
│ Message...                  Send   │
└────────────────────────────────────┘
```

Agent status row 是主要 navigation。

---

## 31. UI Navigation Model

### 31.0 先解決一個前提：目前沒有 router

AgentGoRound 目前**沒有任何 router**（AGENTS.md：「沒有 router；主要頁籤與 modal 由 React state 控制」），也沒有 router 相依。而且部署在 GitHub Pages、base 是 `/agent-go-round/`，deep link 的 history fallback 需要額外處理。

所以 §31 這一節其實隱含了一個沒有被任何 phase 認領的工作項。評估過的三個選項：

| 選項 | 成本 | 影響 |
|---|---|---|
| A（建議）第一版不引入 router，`AgentRoute` 用 state + `history.pushState` 的極薄 wrapper | 低 | 可分享的 URL 有限，但 Phase 3 範圍不爆炸 |
| B 引入 `react-router` 並用 HashRouter | 中 | URL 變 `#/agents/...`，GitHub Pages 不需 404 fallback |
| C 引入 `react-router` BrowserRouter + `dist/404.html` fallback | 中高 | URL 最漂亮，但要處理 base path 與 Pages 的 SPA fallback |

**決策 D2 — 採用 A：不引入 router，用 state + 極薄的 history wrapper。**

理由：Phase 3 已經要同時扛新 shell 與 tutorial anchor 契約（§36.1 T1），再加一個 router 相依與 Pages 的 SPA fallback，是把三個獨立風險綁在同一個 PR。可分享的 deep link 不是 v2 的核心價值主張，可以之後再補。

**但 A 有一個必須寫死的技術約束：**

GitHub Pages 是純靜態託管，base 為 `/agent-go-round/`。如果 thin wrapper 用 `history.pushState` 推出真實路徑片段（`/agent-go-round/agents/abc`），使用者一 reload 或直接開連結就會拿到 404——Pages 不會 fallback 到 `index.html`。

所以：

```text
允許：?agent=<id>&pane=conversation        （query form，reload 安全）
允許：#/agents/<id>                        （hash form，reload 安全）
禁止：pushState 出新的 path 片段            （除非同時交付 dist/404.html fallback）
```

- [ ] wrapper 只操作 query 或 hash，不推 path 片段
- [ ] 有測試涵蓋：帶著 `?agent=<id>` 直接載入 → 正確開啟該 agent；agent 不存在 → 安全 fallback 到預設 pane
- [ ] `popstate`（上一頁 / 下一頁）行為正確，不會讓 UI 與 URL 不同步
- [ ] production build 後在 Pages base path 下實測 reload

下面的 route 表在 A 之下應讀作「pane 識別碼」而非真實 URL。

第一版 routes / panes：

```text
/agents/:agentId
/agents/:agentId/session/:sessionId

/docs
/skills
/mcp
/settings
/magi
```

> 注意：`/agents/:agentId/session/:sessionId` 依賴 §55 的「Agent → many sessions」資料模型，而該模型要到 Phase 8 才存在（見 §102）。Phase 3 只需要讓 view model **允許** sessionId，實際仍只指向單一 current session。

主 workspace 中用 tabs：

```text
Conversation
Activity
Context
```

Computer Mode 出現後才增加：

```text
Files
Terminal
Preview
```

---

## 32. 第一版 UI 不做的東西

Phase 3 不做：

- terminal
- file explorer
- browser preview
- WebContainer
- split panes
- spatial terminal grid
- fancy animations
- full MAGI visualization
- pixel clone Herdr

第一版只把：

```text
Agent
Status
Conversation
Activity
Attention
Approval
Navigation
```

架構定對。

---

## 33. Agent Status Mapping

Pi event → UI：

```text
agent_start
→ working

message_update
→ working/responding

tool_execution_start
→ working/tool

tool approval requested
→ blocked

ask user
→ blocked

tool execution failed recoverably
→ blocked or error

agent_end + unseen
→ done

user opens completed agent
→ idle/done seen depending session semantics
```

---

## 34. Approval UX

Tool confirmation 不要只是一個 modal。

應成為 agent state：

```text
Agent A
⚠ blocked
"GitHub create_issue requires approval"
```

點 agent：

```text
[Approve] [Reject]

Tool: create_issue
Server: GitHub
Arguments:
...
```

這正是 Herdr-style attention UX 的價值。

---

## 35. Global Attention Center

增加：

```text
bell / attention queue
```

聚合：

- blocked agents
- failed agents
- completed unseen agents

點擊後輪流跳到下一個需要處理的 agent。

---

## 36. Phase 3 UI Acceptance Criteria

- [ ] Agent list 顯示 semantic states
- [ ] blocked 狀態一眼可見
- [ ] attention sorting
- [ ] desktop usable
- [ ] mobile usable
- [ ] Pi streaming 正常顯示
- [ ] tool executing 顯示 activity
- [ ] abort visible
- [ ] approval UX
- [ ] switching agents 不丟 session state
- [ ] UI 不直接依賴 Pi internal implementation
- [ ] Tutorial anchor 契約已重新對齊（見 §36.1），`npm run test:tutorial` 通過
- [ ] Bundle 預算對照 Phase 0 baseline 已記錄（§4.2）
- [ ] Router 決策（§31.0 A/B/C）已在 PR 描述中明確選定

> 原本的「legacy engine 也可以 temporary project into same UI，若 migration 需要」已依 §22.1 移除。Phase 3 之後的 rollback 走 §101 部署層。

---

## 36.1 Phase 3 最大的隱藏成本：Tutorial 會在這裡壞掉，不是 Phase 12

這是原計畫的一個排程錯誤，必須修正。

現況（已實測）：

- `src/onboarding/tutorials/` 有 9 個 YAML 案例。
- 這些 YAML 共有 118 處 `tab:` / `targetId:` 引用、39 個不同的 `behavior:`。
- `src/ui/`、`src/app/` 有 10 個檔案掛著 tutorial anchor。
- `npm run test:tutorial` 與 `npm run test:real_tutorial` 都是**驅動真實 UI** 的 runner，不是純 runtime 測試。

也就是說：

```text
Phase 3 把 shell 換成 UI v2
        ↓
tab / targetId / behavior 全部失效
        ↓
test:tutorial 與 test:real_tutorial 在 Phase 3 就全紅
        ↓
Phase 4–11 完全失去 regression oracle
```

而原計畫把 tutorial 放在 Phase 12。這代表 Phase 4 到 Phase 11 這八個 phase 會在**沒有端到端 regression**的情況下進行。這是整份計畫最大的可交付性風險。

### 修正做法（評估過的三個選項，結論見下方 D1）

**T1（建議）Phase 3 同時交付 tutorial anchor 契約層。**
把 `tab` / `targetId` 從「UI 內部實作細節」提升成明確契約：UI v2 元件必須提供同名 anchor（或提供 old→new 對照表由 runtime 解析）。Phase 3 的 DoD 包含 `npm run test:tutorial` 綠燈。成本前置，但 Phase 4–11 全程保有 oracle。

**T2 Phase 3 只在 `?ui=v2` 下啟用，舊 shell 保持預設。**
tutorial 繼續跑舊 shell，直到 Phase 11 之後才切換預設。代價是舊 shell 要活到很後面，且部分功能會被接兩次 UI——正好是 Decision D 想避免的事。

**T3 明確接受在 Phase 3 失去 tutorial oracle，並補一組不依賴 UI 的 runtime 契約測試作為替代 oracle。**
必須在 Phase 3 之前先寫好這組測試，且要在計畫中誠實寫明「Phase 4–11 沒有端到端 UI regression」。

**決策 D1 — 採用 T1：Phase 3 同時交付 tutorial anchor 契約層。**

理由：T2 讓舊 shell 活到 Phase 11，正好製造 Decision D 想避免的「功能接兩次 UI」；T3 要求先寫一組替代 oracle，成本不比 T1 低，卻換來八個 phase 沒有端到端驗證。T1 把成本前置在一個 phase，換取 Phase 4–11 全程有 regression oracle——對一個要連續做 12 個遷移 phase 的計畫，這是唯一划算的選擇。

### 36.2 T1 的具體交付內容

把 `tab` / `targetId` 從「UI 內部實作細節」升級成**明確契約**：

```ts
// 建議：單一來源的 anchor 契約，UI v2 元件必須掛上對應 anchor
export const TUTORIAL_ANCHORS = {
  chatConfigHistoryCard: "chat-config-history-card",
  // ...
} as const;
export type TutorialAnchorId = typeof TUTORIAL_ANCHORS[keyof typeof TUTORIAL_ANCHORS];
```

- [ ] 現有 11 個 `targetId` 與所有 `tab` 值收斂成一份 TypeScript 常數表
- [ ] YAML 的 `targetId` / `tab` 對照該表做**編譯期或載入期驗證**，打錯字要立刻失敗，而不是在 tutorial 跑到一半才發現
- [ ] UI v2 元件掛上對應 anchor；若 UI v2 的資訊架構讓某個舊 anchor 不再有意義，必須在同一個 PR 更新對應 YAML，不允許留下失效 anchor
- [ ] 39 個 `behavior:` 逐一確認語意在 UI v2 下仍成立（多數是狀態斷言而非 DOM 操作，應可沿用；`set_history_limit_to_one` 與 `set_history_limit_for_multiturn` 依賴 §37.1 的 `historyMessageLimit` 決策）
- [ ] **Phase 3 的 DoD 包含 `npm run test:tutorial` 全綠**
- [ ] Milestone B 依 §64.2 跑指定的 real tutorial gate

### 36.3 T1 的已知風險

anchor 契約只保證「元素找得到」，不保證「操作流程仍合理」。UI v2 是 agent/workspace-centric，舊 tutorial 的敘述文字（例如「請前往 Chat Config 頁籤」）可能在新資訊架構下指向不存在的路徑。

所以 T1 必須包含一次 **tutorial 文案審查**：每個案例至少手動走一次，確認敘述與新 UI 相符。這件事無法自動化，要排進 Phase 3 的工時。

---

## 37. Phase 4 — Docs

### 保留

```text
Docs storage
Docs CRUD
Docs IndexedDB
Docs UI
```

### 重寫的只有 Integration

舊：

```text
Docs
↓
legacy contextProjector
```

新：

```text
Docs
↓
PiContextAssembler
↓
Pi
```

---

## 37.1 Context / Compaction Ownership（Phase 4 範圍，原本只列在 §103.1）

這是原計畫最大的一個未定義邊界。Pi 有自己的 compaction（`shouldCompact` / `prepareCompaction` / `compact` / branch summary / `estimateContextTokens`），AgentGoRound 有自己的 `contextProjector` 字元預算（`maxTotalChars`、`maxCatalogChars`、`maxResourceChars`、`maxSingleToolResultChars` …）與一個使用者可見的 `historyMessageLimit`（「Messages sent to model」）。

兩套都在做「決定什麼進 context」。不切清楚，會出現雙重截斷、預算互相打架、以及使用者調了設定卻沒效果。

### 37.1.1 職責切分（決策）

```text
Pi 擁有：
  transcript 本身的壓縮（compaction / branch summary）
  token 層級的 context 計算
  超過 model context window 時的處理

AgentGoRound 擁有：
  「注入什麼」——docs、skills、tool catalog、system prompt 的組裝
  注入內容的大小預算（字元層級，沿用現有 contextProjector 的 budget 概念）
  historyMessageLimit 這個使用者可見的行為
```

一句話規則：**AgentGoRound 決定「放什麼進去」，Pi 決定「太長了怎麼辦」。**

### 37.1.2 接點

Pi 的 `AgentOptions` 提供兩個現成 hook（§4.1 F3 同源的 `AgentOptions`）：

| Hook | 用途 |
|---|---|
| `transformContext(messages, signal)` | 每輪送出前對 transcript 做處理 — `historyMessageLimit` 在這裡實作 |
| `convertToLlm(messages)` | `AgentMessage[]` → provider `Message[]` 的轉換 |

`PiContextAssembler` 只負責組裝 system prompt 與注入內容；**不要**在 assembler 裡自己做 transcript 截斷——那會和 Pi 的 compaction 重複。

### 37.1.3 `historyMessageLimit` 必須保留（不是可選項）

這不是內部細節：

- 它是 Chat Config 裡使用者可見的設定，存在 `agr_ui_v1`
- **兩個 tutorial 直接斷言它**：`set_history_limit_to_one`（tutorial 5）與 `set_history_limit_for_multiturn`（要求 ≥ 8）
- tutorial 5 的敘述明講：把它調成 1 是為了避免免費模型在 MCP 測試時吃滿 context

所以 §36.1 T1 的 anchor 契約與這個設定是綁在一起的。移除或改語意 = 同時弄壞 UI、設定遷移與兩個 tutorial。

### 37.1.4 已知交互風險

`historyMessageLimit` 做的是「只送最後 N 則」，Pi 的 compaction 做的是「太長時摘要前面」。同時開啟時：

```text
transformContext 砍到只剩最後 1 則
        ↓
Pi 看到的 transcript 很短
        ↓
shouldCompact() 永遠為 false
        ↓
compaction 實際上被停用（可能正是使用者要的，但必須是明確行為而非意外）
```

必須決定並記錄：`historyMessageLimit` 生效時，Pi 的 compaction 是「自然不觸發」還是「明確停用」。建議前者（不特別處理，讓它自然不觸發），但要在 UI 說明這個設定會讓長對話摘要不生效。

### 37.1.5 Phase 4 驗收

- [ ] `PiContextAssembler` 不做 transcript 截斷，只做注入內容組裝
- [ ] 注入內容（docs / skills / catalog）的字元預算 deterministic，超限行為與 Phase 0 baseline 一致
- [ ] `historyMessageLimit` 透過 `transformContext` 實作，行為與 legacy 相同
- [ ] tutorial 的 `set_history_limit_to_one` 與 `set_history_limit_for_multiturn` 通過
- [ ] 有測試涵蓋「注入內容超預算」與「transcript 超過 model window」兩條路徑，且兩者不會互相重複截斷
- [ ] Pi compaction 觸發時，注入的 docs / skills 內容不會被摘要掉（否則 agent 會在對話中途失去它的資料）

最後一項特別重要：如果 docs 是以 message 形式注入 transcript，Pi 的 compaction 會把它當成一般歷史摘要掉。**建議 docs / skills 走 system prompt 或每輪重新注入，而不是一次性放進 transcript。**

---

## 37.2 Context Projection 的最小不可分割單位（C1）

§37.1.2 說 `historyMessageLimit` 用 `transformContext` 實作。**如果實作成「取最後 N 則訊息」，會產生 provider 直接拒收的 transcript。**

失敗形狀有兩種：

```text
情況 A：切點落在 tool call 與 tool result 之間
  [... , assistant(toolCall#7), | tool_result#7]   ← 只取到右邊
  → 出現沒有對應 tool call 的孤兒 tool result

情況 B：切點落在 tool result 之後
  [assistant(toolCall#7), tool_result#7 | , ...]   ← 只取到左邊
  → assistant 宣告了 toolCall 卻沒有結果
```

OpenAI / Anthropic 兩邊都會對這兩種形狀回 400，而且錯誤訊息出現在 provider 端、很難在前端診斷。

### 37.2.1 這是回歸風險，不是新設計題

**現有 legacy `contextProjector.ts` 已經正確處理了這件事**，而且程式碼裡有明確註解：

```ts
// src/runtime/harness/contextProjector.ts
// messageGroups(): assistant+action 與其後的 tool 訊息組成一個 group
// "A pair is admitted atomically so a tool result can never be shown without its call."
// 最新的完整 pair 是 mandatory context：放不下就 fail closed（context_budget_exceeded）
```

也就是說「不可分割單位」在目前的程式碼裡已經定義好了。遷移時如果用一個天真的 `slice(-N)` 取代它，是**把已經正確的行為改壞**。

### 37.2.2 定義

```text
Protocol Unit（不可分割）：
  U1  user 訊息                          → 單獨一個 unit
  U2  assistant(含 toolCall) + 其所有對應 tool result → 一個 unit
      （parallel 情境下一個 assistant 可能有多個 toolCall，
        必須全部到齊才算一個完整 unit）
  U3  assistant 純文字                    → 單獨一個 unit
  U4  未完成的 tool interaction
      （有 toolCall、result 尚未產生）     → 不可被截斷，也不可被摘要
```

規則：

1. `historyMessageLimit` 的 **N 計算單位是 protocol unit，不是訊息數**。UI 文案可維持「Messages sent to model」，但實作與測試以 unit 為準。
2. **最新的完整 unit 與最新的 user 訊息永遠保留**，沿用 legacy 的 mandatory 語意。
3. 放不下時 **fail closed**（回報 context 超限），不得送出殘缺 transcript——與 Phase 0 baseline 行為一致。
4. **U4 永遠不可被裁掉。** 這同時約束 `transformContext` 與 Pi 的 compaction。

### 37.2.3 Pi compaction 也要驗，不能假設

upstream 有 `findTurnStartIndex(entries, entryIndex, startIndex)` 與 `findCutPoint(entries, startIndex, endIndex, keepRecentTokens)`，看起來是 turn-aware 的切點搜尋。但「turn-aware」不等於「保證 tool pair 原子性」，尤其在 parallel tool call 之下。

- [ ] Phase 4 必須用 fixture 實測：構造一個 tool pair 橫跨 compaction 切點的 transcript，確認 upstream 不會拆開
- [ ] 若會拆開 → 用 `transformContext` 在 compaction 之前先保護 U2/U4，並把結論寫回本節與 §4.1

### 37.2.4 驗收（併入 §37.1.5）

- [ ] `transformContext` 以 protocol unit 為單位截斷，有測試涵蓋 A / B 兩種切點
- [ ] parallel 多 toolCall 的 assistant：所有 result 到齊才算一個 unit，測試涵蓋只到齊一部分的情況
- [ ] `historyMessageLimit = 1` 時仍產生合法 transcript（tutorial 5 的實際設定）
- [ ] 未完成的 tool interaction 不會被 `transformContext` 或 compaction 移除
- [ ] 超限時 fail closed，錯誤訊息與 Phase 0 的 `context_budget_exceeded` 語意一致
- [ ] 有一個「送給 provider 之前」的 transcript 合法性斷言（每個 toolCall 都有 result、每個 result 都有 call），在 dev build 下對每次請求生效

---

## 38. Docs UI 在 Herdr-like Shell 的位置

Global：

```text
Docs
```

Agent workspace：

```text
Context
├── Attached Docs
├── Skills
└── Runtime Context
```

讓使用者看得出：

> 這個 Agent 現在帶了哪些資料。

---

## 39. Docs Acceptance

- [ ] 現有 Doc 資料不用重建
- [ ] Agent 可 attach / detach Docs
- [ ] Pi 下一輪拿到更新內容
- [ ] Context tab 可看到 active docs
- [ ] budget / truncation deterministic

---

## 40. Phase 5 — MCP

### 保留

```text
MCP clients
Streamable HTTP
legacy SSE
server resolver
tool catalog
tool registry
response limits
CORS rules
MCP UI
```

---

## 41. 新 MCP Path

```text
MCP Server
↓
existing MCP Client
↓
existing Tool Catalog
↓
McpPiToolAdapter
↓
Pi AgentTool
↓
Pi Agent
```

---

## 42. MCP Adapter

建立：

```text
createMcpPiTool(...)
```

mapping：

```text
MCP name
→ Pi tool name

MCP description
→ Pi description

MCP inputSchema
→ Pi / TypeBox schema

Pi execute()
→ ToolEffectRunner
→ existing MCP callTool()
```

---

## 43. MCP JSON Schema → TypeBox Normalization

Pi 的 `AgentTool` 用的是 **TypeBox `TSchema`**（`typebox@1.3.7`），不是 JSON Schema（§4.1 F7）。AgentGoRound 目前的 `HarnessToolDefinition.inputSchema` 是 `JSONSchema7`，驗證用 `ajv`。所以這一步是真的型別轉換，不是改名。

正式建立：

```ts
normalizeMcpSchemaToPiSchema(schema: JSONSchema7): TSchema
```

至少支援：

- object
- string
- number
- integer
- boolean
- array
- enum
- nested objects
- required
- nullable / union
- additionalProperties

### 43.1 無法轉換時的行為

MCP server 的 schema 品質不可控，一定會遇到轉不動的情況（`$ref`、`oneOf` 組合、遞迴、自訂 keyword）。必須明確選一個策略，而不是讓 adapter 在 runtime 丟例外：

| 策略 | 行為 | 建議 |
|---|---|---|
| S1 | 轉不動就把該 tool 從 catalog 排除，並在 MCP panel 顯示原因 | 安全，建議作為預設 |
| S2 | 降級成 `Type.Object({}, { additionalProperties: true })`，完全靠 host-side ajv 驗證 | 可用，但模型會失去參數提示，容易產生錯誤呼叫 |
| S3 | 直接把原始 JSON Schema 塞進 TypeBox 的 `Unsafe` 逃生口 | 只在確認 Pi 會原樣轉發給 provider 時可用，須在 PoC/Phase 5 實測 |

**決策 D4 — 採用 S1：轉換失敗的 tool 從 Pi catalog 排除，並在 UI 明確顯示原因。**

理由：S2 會讓模型在沒有參數提示的情況下呼叫具有副作用的遠端 tool，錯誤呼叫率上升而且錯誤很難診斷——把 schema 問題轉嫁成 runtime 行為問題。S3 依賴「Pi 會原樣轉發」這個尚未驗證的假設，不該作為預設。S1 的失敗模式是可見且安全的：tool 不見了，而且 UI 說得出為什麼。

無論如何，**host-side ajv 驗證都必須保留**：TypeBox 的驗證是給模型看的契約，ajv 是給 AgentGoRound 的信任邊界，兩者職責不同，不可互相取代。

### 43.1.1 S1 的可見性要求

「排除」不能是無聲的。否則使用者只會看到「Agent 說它沒有這個工具」，卻不知道是 schema 轉換失敗。

- [ ] McpPanel 的 tool 清單顯示該 server 的 `可用 / 總數`
- [ ] 被排除的 tool 個別列出，附上失敗原因（不支援的 keyword、無法解析的 `$ref` 等）
- [ ] 排除事件寫入 app log，保留 `requestId` 與 `stage`
- [ ] 被排除的 tool **不出現在送給模型的 tool 清單中**，避免模型以為它存在
- [ ] 有測試：一個含不支援 schema 的 fixture tool → 被排除、其餘 tool 正常可用（不因單一 tool 失敗而整個 server 不可用）

### 43.2 驗收

- [ ] 對 `mcp-test` fixture server 的所有 tool 完成轉換
- [ ] 至少 3 個真實 MCP server 的 catalog 全量轉換測試
- [ ] 轉不動的 schema 有 deterministic 的降級行為與可見的使用者訊息
- [ ] 轉換後參數驗證仍會擋下 host-side 不合法輸入

---

## 44. MCP UI Integration

Agent workspace Activity：

```text
MCP · GitHub
create_issue
running...
```

blocked：

```text
MCP · GitHub
create_issue
needs approval
```

完成：

```text
✓ create_issue
```

---

## 45. Phase 6 — Built-in Tools + ToolEffectRunner

ToolEffectRunner 不刪。

角色改變：

舊：

```text
AgentGoRound Agent Harness
↓
ToolEffectRunner
```

新：

```text
Pi AgentTool.execute()
↓
ToolEffectRunner
↓
actual effect
```

---

## 46. 保留 ToolEffectRunner Semantics

尤其保留：

```text
abort before dispatch
timeout before dispatch

dispatch

success
failure

abort after dispatch
timeout after dispatch

outcome_unknown
```

---

### 46.1 Outcome → Pi 契約的對應表（原計畫缺這一塊，缺了就不可執行）

Pi 的契約是（§4.1 F6/F10）：

- `AgentTool.execute` **失敗時應該 throw**，不是把錯誤編進 `content`
- `beforeToolCall` 回傳 `{ block: true, reason }` 會讓 loop 產生一則 error tool result
- `afterToolCall` 可以覆寫 `content` / `details` / `isError` / `terminate`

AgentGoRound 的 `HarnessToolOutcome` 有五個值。對應必須明確寫死：

| AgentGoRound outcome | Pi 側做法 | 模型看到 | `details` 保留 |
|---|---|---|---|
| `success` | 正常 return `AgentToolResult` | 正常結果 | 完整 metadata |
| `rejected`（使用者拒絕） | `beforeToolCall` → `{ block: true, reason }` | 被拒絕的原因 | audit 記錄拒絕者與時間 |
| `failed_before_dispatch` | `execute` throw | 失敗訊息，可重試 | 記錄未送出 |
| `failed`（已送出並確定失敗） | `execute` throw | 失敗訊息 | 記錄已送出 |
| `outcome_unknown` | **return（不 throw）**，`content` 為固定告警字串，`details.outcome = "unknown"`，並考慮 `terminate: true` | 「結果未知，不要自動重試」 | 完整 dispatch metadata |

`outcome_unknown` 之所以必須 return 而不是 throw：throw 在 Pi 語意上等同「這次呼叫失敗了」，會誘導模型重試——而重試正是 `outcome_unknown` 要避免的事。這是本次遷移中最容易被無聲弄壞的語意，必須有專門測試。

### 46.2 執行模式

`toolExecution` 預設必須設為 `"sequential"`。

理由：目前 legacy harness 是逐一 dispatch，`outcome_unknown` 與 approval 的語意都建立在序列執行上。改成 `"parallel"` 會同時改變（a）approval 排隊順序（b）abort 時有多少 side effect 已送出（c）audit trace 的可讀性。這是獨立的優化題目，不要和 migration 綁在一起。

---

## 47. outcome_unknown

不可退化。

如果：

```text
request dispatched
+
response lost
```

Pi 看到：

```text
Tool outcome is unknown after dispatch.
Do not retry automatically.
```

AgentGoRound internal audit 保留完整 metadata。

### 47.1 Phase 6 驗收

- [ ] 五種 outcome 各有測試，且驗證模型端看到的文字與 `isError` 旗標
- [ ] `outcome_unknown` 後模型不會自動重試（用 deterministic transport fixture 驗）
- [ ] abort 發生在 dispatch 前 / dispatch 後，分別產生正確 outcome
- [ ] timeout 同上
- [ ] `beforeToolCall` 拒絕路徑會讓 agent 進入 `blocked`，而不是直接 error
- [ ] built-in tool 的 confirmation 行為與 Phase 0 baseline **完全一致**（不放寬、不收緊）
- [ ] `toolExecution` 為 `"sequential"`

---

## 48. Built-in Sandbox

Pi migration 時不要同時重做 security sandbox。

先維持現有 JS built-in semantics。

Sandbox redesign 另開專案。

---

## 49. Phase 7 — Skills

### 保留

```text
SKILL.md
references/
assets/
import/export
skillStore
validation
Skills UI
```

---

## 50. 第一版 Skills 接 Pi

不要改資料格式。

提供：

```text
skill_load
skill_read
```

作 Pi AgentTools。

### 50.1 用 upstream 既有機制，不要自己做 tool gating

Pi 的 `AgentToolResult.addedToolNames`（§4.1 F8）就是「執行完某個 tool 之後，從這個 transcript 位置起多出哪些可用 tool」的官方機制。`skill_load` 成功後應該用它把該 skill 的 tool 暴露出來，而不是在 AgentGoRound 這一側自己維護一份「目前允許哪些 tool」的狀態——後者會直接重蹈 §21 的覆轍。

同時注意 upstream `pi-agent-core` 本身也有 `harness/skills.js` 與 `SKILL.md` 概念。Phase 7 開始前必須先做一次比對並記錄結論：

- 若 upstream 的 skill 模型能涵蓋 AgentGoRound 的 `SKILL.md + references/ + assets/`，就直接沿用，不要平行維護。
- 若不能，要寫清楚差在哪，以及為什麼 AgentGoRound 保留自己的一套。

**決策 D11 — 保留 AgentGoRound 既有的 skill artifact 格式與儲存；只使用 upstream 的 AgentTool lifecycle 與 `addedToolNames`；不導入 upstream 的 skill persistence。**

理由：AgentGoRound 的 skill 是使用者資產（已在 `agr_skills_db` 中，含 assets、匯入匯出、驗證）。改動格式等於再加一次資料遷移，而 §102 已經有一次要做。upstream 的 skill 模型服務的是 filesystem-based 的 coding agent，其 persistence 假設與 browser IndexedDB 不同。真正有價值、且無可取代的，是 upstream 的 **tool lifecycle**——`addedToolNames` 讓「load 之後才出現對應 tool」這件事由 Pi 的 transcript 語意保證，不需要 AgentGoRound 自己維護 gating 狀態（§21）。

界線：

```text
使用 upstream：AgentTool 定義、execute lifecycle、addedToolNames、tool 可見性語意
不使用 upstream：skill 檔案格式、skill 儲存、skill 發現機制、SKILL.md 的解析與載入
```

- [ ] 既有 skill 套件不需重新匯入或轉檔（與 §50.2 第一項一致）
- [ ] AgentGoRound 這一側**不維護**任何「目前允許哪些 tool」的平行狀態
- [ ] 不 import `@earendil-works/pi-agent-core` 的 skill persistence 相關 API

**例外條款：** 若 Phase 7 的 spike 證明 upstream skill 模型與 AgentGoRound 的 `SKILL.md + references/ + assets/` **完整語意等價**，且改用它有明確收益（例如可直接沿用 upstream 的 skill 相關測試），才重新評估。舉證責任在提案方，預設是不換。

比對結論必須寫回本節。這個比對沒做而直接開工，Phase 7 很可能做出第三套 skill 語意。

### 50.1.1 Bundle 附帶事實

`pi-agent-core` 的 `.` entry 會靜態 import `harness/skills.js`（→ `ignore`）、`harness/prompt-templates.js`（→ `yaml`）、`harness/tools/edit-diff.js`（→ `diff`）。也就是說**即使 D11 決定不使用 upstream 的 skill 機制，這些相依仍可能被打進 bundle**（取決於 tree-shaking 效果）。

- [ ] Phase 1 量測時確認這三個套件是否進入 initial chunk，並記入 §4.2 的 bundle 預算
- [ ] `yaml` 專案本身已有（`yaml@^2.8.2`），注意與 Pi pin 的 `yaml@2.9.0` 可能產生雙版本

### 50.2 Phase 7 驗收

- [ ] 既有 skill 套件不需重新匯入
- [ ] `skill_load` / `skill_read` 走同一個 ToolEffectRunner outcome 契約（§46.1）
- [ ] `addedToolNames` 正確擴充可用 tool，且 abort / 換 session 後不殘留
- [ ] skill 內部 tool 不會在未 load 前被模型呼叫
- [ ] `references/` 讀取有大小上限，且超限行為 deterministic
- [ ] 既有 skill 相關 tutorial（tutorial 7 / 8 / 9）通過

---

## 51. Herdr-like Skill UX

Agent workspace Context：

```text
Skills
├── ✓ Research Skill
├── ✓ GitHub Skill
└── + Attach Skill
```

Activity：

```text
skill_read
research/references/source.md
```

---

## 52. Phase 8 — Chat / Session Persistence

這裡開始把 Pi 當 source of truth。

### 52.1 現況（必須先承認的起點）

`src/storage/chatStore.ts` 目前是：

```text
IndexedDB "agr_chat_db" v1
└── object store "chat_state"
    └── 單一 record id = "current"
        └── { messages: ChatMessage[] }
```

也就是說，**整個 App 只有一份全域對話**。沒有 per-agent、沒有 per-session、沒有 branch、沒有 tool-call 生命週期紀錄。

而 §55 要的是「Agent → many sessions」，UI v2 的左側 rail 也預設要顯示 session 清單。這中間隔著一次真正的資料遷移，原計畫只在 §84 的矩陣裡寫了一格 "Persistence / Migrate"，沒有任何細節。§102 補上遷移規格。

### 52.2 兩個層級的持久化，不要混為一談

| 層級 | 內容 | 用途 |
|---|---|---|
| L1 `Agent.state.messages` | 純 transcript 陣列 | PoC 的 restore gate（§14）夠用 |
| L2 upstream `SessionStorage` | entries / records / lanes / branches / compaction / tool 生命週期 | Phase 8 的真正目標 |

原計畫在 §14 用 L1、在 §54 講「durable Pi/session events」用 L2，但沒說明兩者關係。明確化：

- **L1 是 PoC 專用的一次性做法，Phase 8 不得直接沿用。**
- Phase 8 的目標是實作一個 IndexedDB 版的 upstream `SessionStorage`。

### 52.3 用 upstream 的 conformance suite 當 gate

`@earendil-works/pi-agent-core/session/testing` 匯出 `createSessionBackendConformance(factory)`（§4.1 F11）。這是 Phase 8 最有價值的一個發現：

```ts
// vitest
import { createSessionBackendConformance } from "@earendil-works/pi-agent-core/session/testing";

for (const testCase of createSessionBackendConformance(() => createIndexedDbFixture())) {
  it(testCase.name, testCase.run);
}
```

**Phase 8 的 DoD 包含這組 conformance 全綠。** 這比自己補測試可靠得多，也能在 Pi 升版時立刻發現後端不相容。

### 52.4 `pendingToolCalls` 無法還原（重要）

`AgentOptions.initialState` 的型別明確 `Omit` 掉 `pendingToolCalls` / `isStreaming` / `streamingMessage` / `errorMessage`（§4.1 F9）。

代表這個情境**沒有 upstream 支援的還原路徑**：

```text
tool 已 dispatch
        ↓
使用者關掉分頁 / reload
        ↓
新 Agent 只能從 messages 還原
        ↓
那個 tool 的結果永遠不會回到 transcript
```

**決策 D5 — 採用 P1：還原時為未完成的 tool call 補一則 `outcome_unknown` tool result，然後 `continue()`。**

理由：P2 會把已經發生的 side effect 變成沒有紀錄的孤兒，是三者中唯一會造成資料不誠實的選項。P3 的 UX 最誠實但要求使用者在 reload 後回答一個他們通常無法回答的問題（「那個 GitHub issue 到底建立了沒？」）。P1 直接沿用 §46.1 已經定義好的 `outcome_unknown` 語意：告訴模型結果未知、不要自動重試，並把判斷留在對話裡由模型與使用者自然處理。這讓「reload」和「回應遺失」走同一條已測試過的路徑，而不是新增第三種狀態。

### 52.4.1 P1 的實作與驗收

還原流程：

```text
載入 transcript
      ↓
掃描尾端：assistant 訊息中的 toolCall 是否都有對應 toolResult？
      ↓ 有缺
為每個缺漏的 toolCall 補一則 tool result：
  content = "Tool outcome is unknown after dispatch. Do not retry automatically."
  details = { outcome: "unknown", reason: "session_restored", originalDispatchAt }
      ↓
new Agent({ initialState: { messages } }) → continue()
```

- [ ] 補進去的 tool result 的 `toolCallId` 與原 tool call 完全對應（否則 provider 會拒絕整段 transcript）
- [ ] 多個未完成 tool call（parallel 情境）全部補齊，不能只補一個
- [ ] 補齊後模型不會自動重試該 tool（用 deterministic fixture 驗，與 §47.1 共用測試基礎建設）
- [ ] 還原後的 transcript 在 UI 上可見地標示「這裡有一次結果未知的工具呼叫」，不是靜默補上
- [ ] audit log 記錄補齊事件，保留 `requestId` 與原始 dispatch metadata
- [ ] `continue()` 前若 transcript 尾端不是合法的可續接狀態（例如最後是 assistant 純文字），不呼叫 `continue()`，直接進 idle

**修正（Q2）：未完成的 tool call 有兩種，不能一律補 `outcome_unknown`。**

```text
awaiting_approval（尚未 dispatch）
  → 還原為 rejected：「核准未完成，工具未執行」
  → 這是確定的事實，不是不確定

dispatched（已送出，回應遺失）
  → 還原為 outcome_unknown（原 P1 行為）
```

把「還在等核准」還原成「結果未知」，是在製造假的不確定性，並可能誘導使用者去檢查一個根本沒發生的副作用。

這對 Phase 8 的資料模型有硬性要求：**session store 必須在 dispatch 之前就記錄「這個 call 正在等核准」**，否則重開時分不出兩者。這是資料模型需求，不是 UI 需求。

- [ ] session store 在核准開始等待時就寫入 `awaiting_approval` 狀態（dispatch 前）
- [ ] 還原時依狀態分流：`awaiting_approval` → rejected，`dispatched` → outcome_unknown
- [ ] 有測試涵蓋兩種還原路徑，且 UI 文案不同

**side effect 已發生但 transcript 沒紀錄**這件事必須寫進 audit log。

### 52.5 多分頁併發（Phase 8 範圍，原本只列在 §103.1）

現況之所以沒問題，是因為只有一份全域對話、寫入是整份覆蓋、而且使用者通常只開一個分頁。變成事件式 session store 之後，這個假設會壞：

```text
分頁 A 的 Pi Agent 正在跑 session S，持續 append entries
分頁 B 同時開著 session S，也在 append
        ↓
兩個 Agent 實例對同一個 transcript 交錯寫入
        ↓
entry 順序錯亂 / seq 衝突 / tool call 與 result 對不起來
```

這不是理論風險：使用者「開新分頁看一下」是很常見的行為，而 UI v2 的 agent rail 會鼓勵在多個 agent 之間切換。

### 52.5.1 決策：單一 writer

```text
一個 session 在同一時間只能有一個分頁持有寫入權。
其他分頁對該 session 為唯讀，並明確顯示狀態。
```

實作建議（依可用性排序）：

1. **Web Locks API**（`navigator.locks.request`）——現代瀏覽器普遍支援，語意最貼近需求，分頁關閉時自動釋放
2. `BroadcastChannel` 心跳 + 租約——需自行處理 crash 後的租約過期
3. IndexedDB 內的租約記錄 + timestamp——最不建議，需要自己做過期判斷

搭配 `BroadcastChannel` 通知其他分頁「這個 session 有新內容」，讓唯讀分頁能即時更新畫面。

**兩點補充（Q5 / Q2）：**

1. **同一個分頁同時持有多個 session 的寫入權是合法的。** MAGI 目前就是 `Promise.all` 並發跑 N 個 unit（§63.1），每個 member 一個 session。鎖的粒度是 session，不是分頁，也不是整個 DB。N 個並發 session 寫入同一個 IndexedDB 時，`seq` 配置必須保證單調——這需要 read-then-write 在同一個 transaction 內完成。
2. **長期 blocked 的分頁不釋放鎖。** agent 停在 blocked 等核准可能長達數小時（§81.1）。此時鎖仍由該分頁持有，但其他分頁必須能看到具體原因，而不是只看到「被佔用」：

```text
其他分頁顯示：
  「這個 session 正由另一個分頁使用，目前正在等待工具核准。」
  [在此分頁接管]   ← 明確動作，接管後原分頁轉為唯讀
```

### 52.5.2 驗收

- [ ] 兩個分頁開同一個 session：只有一個可送出 prompt，另一個顯示唯讀狀態與原因
- [ ] 持有寫入權的分頁關閉後，另一個分頁可在合理時間內取得寫入權
- [ ] 兩個分頁開**不同** session：兩邊都可正常運作（鎖的粒度是 session，不是整個 DB）
- [ ] 分頁在 agent 執行中被關閉 → 下次開啟走 §52.4 的 P1 還原路徑
- [ ] 唯讀分頁能看到另一個分頁產生的新訊息（不必即時，但不能顯示過期內容而不自知）
- [ ] 不支援 Web Locks 的瀏覽器有 degraded 但安全的行為（例如：偵測不到鎖就一律唯讀，並提示）
- [ ] 同一分頁並發持有 N 個 session 寫入權（N ≥ 4）：`seq` 單調、entry 不交錯錯亂
- [ ] 分頁長期停在 blocked：鎖不釋放，其他分頁看到「等待核准中」並可明確接管
- [ ] 接管後原分頁轉為唯讀，不會兩邊同時寫入

---

## 53. 過渡期

```text
Pi state
↓
PiEventBridge
↓
Chat projection
↓
existing UI persistence
```

---

## 54. 最終建議

```text
durable Pi/session events
↓
projection
├── Conversation
├── AgentRuntimeView
└── Activity timeline
```

避免三份狀態 drift：

```text
Pi messages
UI messages
chatStore messages
```

---

## 55. Session UX

Herdr-like 左側 Agent 下可以有：

```text
Research
├── Current session
├── Yesterday: Market report
└── Aug 30: Competitor scan
```

第一版不需要複雜 tree。

但 data model 應允許：

```text
Agent
└── many sessions
```

> 排程依賴：這個資料模型在 **Phase 8** 才存在（§52.1）。Phase 3 的 UI 只能顯示單一 current session，並保留可擴充成清單的 view model 形狀。若 Phase 3 就想顯示歷史 session 清單，Phase 8 的 schema 與 §102 的遷移必須提前到 Phase 3 之前——但那會讓 Phase 3 同時扛 UI 與資料遷移兩個大風險，不建議。

---

## 56. Phase 9 — Load Balancer

LB 保留。

但位置改成：

```text
Pi
↓
stream/model function
↓
AgentGoRound Load Balancer
↓
Provider candidates
```

不是再透過 legacy agent transport。

### 56.1 這是整份計畫技術阻抗最大的一段（矩陣標 High 是對的）

Pi 的接點是 `AgentOptions.streamFn`（§4.1 F3）：

```ts
type StreamFn = (model, context, options?) =>
  AssistantMessageEventStream | Promise<AssistantMessageEventStream>;
```

AgentGoRound 現有的 LB 是 **promise-based、非串流**：

```ts
runLoadBalancedTask<T>({ candidates, execute: (candidate) => Promise<T>, ... })
runLoadBalancedTextTask({ execute: (candidate) => Promise<string>, ... })
```

它的 failover 決策建立在「等一個完整結果回來再判斷」。Pi 要的是「立刻給我一個會逐步吐 event 的 stream」。這兩者不是換個 wrapper 就能接起來。

### 56.2 三個必須由 PR 2S spike 回答的語意問題（D9）

**Q1：failover 的截止點在哪裡？**

一旦把某個 candidate 的 event 往下游送出，就不能再無痛換 candidate——已經進 transcript 的 partial assistant 文字會和新 candidate 的輸出拼在一起。建議：

```text
在收到第一個內容 event 之前 → 可以自由 failover
第一個內容 event 送出之後   → 只能讓該次 turn 以 error/aborted 結束，由上層決定重跑
```

這個「first-token gate」必須明確寫進 adapter，並有測試。

**Q2：deadline 怎麼過去？**

現有程式用 `ExecutionDeadline` / `deadline.throwIfExpired()`；Pi 只認 `AbortSignal`。adapter 必須把 deadline 轉成 signal，並確保 abort 之後 `Agent.abort()` → `waitForIdle()` 能乾淨收尾。

**擴大範圍（Q2 / §81.1）：** 不只是「怎麼轉」，還要驗證「**blocked 期間如何暫停**」。§81.1.1 決定 `ExecutionDeadline` 只計算 agent-active 時間，等待人類的時間不計。Pi 只認 signal、不認可暫停的 deadline，所以暫停必須在 AgentGoRound 這一側實作成「blocked 期間不觸發 abort，解除後重新計時」。spike 要證明這個做法在 Pi 的 run 生命週期內可行，且不會讓已逾時的 run 逃過中斷。

**Q3：retry 的重複 side effect。**

§58 已經列了「side-effect tool 不因 provider retry 重複執行」，但沒說機制。實際保障來自 Q1：LB 的 retry 只發生在 turn 開始、任何 tool 被呼叫之前。若允許 turn 中途換 candidate，這條保證就沒了。兩者必須一起決定。

### 56.3 建議把 Phase 9 提前評估

Phase 9 排在 Docs / MCP / Skills 之後，但它是唯一可能推翻 `PiAgentRuntime` 介面設計的一項。

**決策 D9 — 在 Phase 2 執行 LB streaming spike（PR 2S），不合併到產品路徑；可與 PR 2 並行開發，但必須在 PR 2 merge 前通過。**

理由：Phase 3–8 全部建立在 `PiAgentRuntime` 的介面形狀之上。如果 first-token gate 不可行、或 failover 必須改變 turn 的生命週期，那個介面就得改——在 Phase 9 才發現，代表六個 phase 的整合工作要回頭修。spike 的成本是幾天，錯過的成本是數週。

### 56.3.1 PR 2S 的產出

spike **不需要**完整實作 failover，只需要回答三個問題並留下可執行的證據：

- [ ] Q1：first-token gate 可行嗎？產出一個最小 `streamFn` wrapper，證明「第一個內容 event 送出前可換 candidate、送出後不換」在 Pi 的 `AssistantMessageEventStream` 上做得到
- [ ] Q2：`ExecutionDeadline` → `AbortSignal` 轉換後，`Agent.abort()` → `waitForIdle()` 能乾淨收斂
- [ ] Q3：確認 LB retry 只發生在任何 tool 被呼叫之前（觀察 `tool_execution_start` 與 candidate 切換的相對順序）
- [ ] 產出一份「`PiAgentRuntime` 介面是否需要調整」的明確結論，寫回 §20

若 Q1 結論為否，**PR 2 不得合併**，必須先重新設計 §20 的介面。

---

## 57. LB Migration Order

先：

```text
Pi + 1 Provider
```

再：

```text
Pi + AgentGoRound LB
```

最後：

```text
Pi + multi candidate failover
```

---

## 58. LB Acceptance

- [ ] candidate failover
- [ ] abort propagation
- [ ] streaming
- [ ] provider failure 不吃 agent tool budget
- [ ] side-effect tool 不因 provider retry 重複執行
- [ ] session/routing IDs 正常
- [ ] first-token gate（§56.2 Q1）有測試：第一個內容 event 之後不會再切 candidate
- [ ] `ExecutionDeadline` → `AbortSignal` 轉換正確，逾時後 `waitForIdle()` 能收斂
- [ ] LB 的 failure state / 暫停恢復 / failureCount 行為與 Phase 0 baseline 一致
- [ ] 未使用的 provider 實作沒有被靜態打進 initial chunk（§4.2）
- [ ] Token / 成本會計依 §58.2 對齊，無重複計算
- [ ] **並發（§63.1）**：N 路並發下 `failureCount` / 暫停恢復無 lost update
- [ ] **並發**：同一 provider 的 429 觸發退避，不會把所有 candidate 一次標成失敗
- [ ] **並發**：對同一 LB 的並發度有預設上限且可設定
- [ ] blocked 期間 `ExecutionDeadline` 暫停（§81.1.1），不會中斷等待核准的 run

---

## 58.2 Token 與成本會計（Phase 9 範圍，原本只列在 §103.1）

Pi 的 `AssistantMessage.usage` 帶有 `input` / `output` / `cacheRead` / `cacheWrite` / `totalTokens` 與 `cost` 明細，而 AgentGoRound 的 LB 目前有自己的成功/失敗統計。不定義清楚會出現兩種錯誤：同一輪被計兩次，或 failover 掉的那次完全沒被計。

### 58.2.1 決策：Pi 的 usage 是唯一真實來源

```text
Pi usage（per assistant message）
        ↓
PiEventBridge 擷取
        ↓
AgentGoRound 歸戶：agent / session / candidate / provider
```

- AgentGoRound **不自己估算 token**（不要用字元數推估，Pi 已經有 provider 回報的真實值）
- LB 只負責把 usage 歸到正確的 candidate 與 provider
- `AgentToolResult.usage` 是 tool 自身的用量，upstream 已註明**不計入主 LLM context 會計**，不可與 assistant usage 相加

### 58.2.2 Failover 的計費歸屬

一次 turn 可能觸及多個 candidate。失敗的那次**通常也已經產生費用**（provider 可能已計費），所以：

- [ ] 每個 candidate 的嘗試各自記錄 usage，不是只記成功的那一次
- [ ] session 層級的總計 = 所有嘗試的總和（含失敗），不是只有成功的
- [ ] UI 若顯示成本，要能區分「成功的用量」與「含 failover 的實際用量」

### 58.2.3 驗收

- [ ] 單一 turn 的 usage 只被記錄一次（無重複計算）
- [ ] failover 情境下，失敗 candidate 的 usage 有被記錄且歸戶正確
- [ ] compaction 產生的額外模型呼叫（Pi 的 `generateSummary`）其 usage 也被記錄
- [ ] tool usage 與 LLM usage 分開統計，不混算
- [ ] 沒有任何自行估算 token 的程式碼路徑

---

## 59. Phase 10 — Voice

Voice 本體保留：

```text
STT
TTS
playback queue
settings
```

改：

```text
send → PiAgentRuntime.prompt()
```

與：

```text
Pi final message → TTS
```

### 59.1 Phase 10 驗收

- [ ] STT 結果進 composer 後仍可編輯再送出（維持現有行為）
- [ ] TTS 只朗讀最終 assistant 訊息，不會朗讀 streaming 中的片段或 tool result
- [ ] agent 進入 `blocked` 時不會誤觸發 TTS
- [ ] STT / TTS 各自的 load balancer failure state 與 failover 維持不變
- [ ] abort 後 playback queue 會停止

---

## 60. Phase 11 — MAGI

MAGI 最後做。

---

## 61. MAGI New Architecture

```text
                  MAGI
       ┌───────────┼───────────┐
       ▼           ▼           ▼
    Pi Agent A   Pi Agent B   Pi Agent C
       │           │           │
       └───────────┼───────────┘
                   ▼
            Pi Adjudicator
```

每個都是真正 Pi runtime。

---

## 62. MAGI + Herdr-like UI

這其實會是 AgentGoRound v2 的核心特色。

例如：

```text
MAGI / Project X

● Analyst          working
⚠ Researcher       needs MCP approval
✓ Critic           done
○ Judge            waiting
```

UI 可以直接利用同一套：

```text
AgentRuntimeView
```

不用為 MAGI 做第二套 status system。

---

## 63. MAGI Acceptance

- [ ] 每個 member 有自己的 Pi Agent
- [ ] 每個 member 有自己的 session
- [ ] status 獨立
- [ ] blocked 狀態獨立
- [ ] user 可直接進任何 member workspace
- [ ] adjudicator 是 Pi runtime
- [ ] abort 可單 agent 或整個 MAGI run

---

## 63.1 MAGI 的並發現在就存在，§52.5 / §58 / §63 都是照單一 agent 寫的（Q5）

已驗證：`src/orchestrators/magi.ts:216-217` 目前就是

```ts
const roundResults = await withTimeout(
  Promise.all(args.units.map((unit) => runUnit(unit))), ...
);
```

每個 unit 各自 `createDeadline`，整輪外面再包一層 `withTimeout`。Phase 11 之後這會變成**一個分頁裡 N 個 Pi Agent 同時跑**。四個章節都沒有對應：

**1. §52.5 的鎖粒度。** 規格寫「一個 session 同時只能有一個分頁持有寫入權」，但 MAGI 讓**同一個分頁同時持有 N 個 session 的寫入權**。§52.5 必須明寫這是合法情境，而且 N 個並發 session 寫同一個 IndexedDB 時，`seq` 配置必須保證單調。§52.5.2 的六個驗收項全是「兩分頁一 session」，驗不出這個。

**2. §58 的「LB 行為與 baseline 一致」。** N 個 Pi Agent 共用一個 LB，`markSuccess` / `markFailure` / `failureCount` / 暫停恢復時間變成並發可變狀態。而且同一把 key 上 N 路並發極易觸發 429，可能把所有 candidate 一次標成失敗，整個 MAGI run 陣亡。§58 沒有任何一項驗收涵蓋並發。

**3. §63 的「abort 整個 MAGI run」。** §20 只有 per-instance `abort()`，§19 的 `piAgentRegistry.ts` 只有檔名沒有語意。目前這個能力由 `withTimeout(Promise.all(...))` 提供，新架構沒有對應機制。

**4. §58.2 的 token 歸戶。** 並發時事件流是交錯的，usage 要歸到「哪個 agent 的哪個 session 的哪個 candidate」。§58.2.3 的驗收假設單一 turn。

### 63.1.1 要補的東西

- **§19 / §20：`piAgentRegistry` 補 run-scope API**，至少 `abortGroup(groupId)` 與 `waitForGroupIdle(groupId)`；MAGI run 是一個 group。
- **§52.5：明寫「同一分頁持有多個 session 寫入權」合法**，並補 `seq` 單調性的並發測試。
- **§58：補並發驗收**（見下）。
- **並發上限與退避**：MAGI 對同一個 LB 的並發度要可設定且有預設上限；429 應觸發退避，而不是把 candidate 標成永久失敗。這是與 Phase 0 baseline 的**行為差異**，必須明確記錄而不是宣稱「一致」。

### 63.1.2 驗收（併入 §58 與 §63）

- [ ] N 個 Pi Agent 並發寫入 session store：`seq` 單調、entry 不交錯錯亂（用 fixture 驗，N ≥ 4）
- [ ] N 路並發下 LB 的 `failureCount` / 暫停恢復狀態轉換正確，無 lost update
- [ ] 同一 provider 的 429 觸發退避，不會把所有 candidate 一次標成失敗
- [ ] `abortGroup()` 能中止整個 MAGI run，且每個 member 都乾淨收斂（各自 `waitForIdle`）
- [ ] 單一 member 的 abort 不影響其他 member
- [ ] 並發情境下 usage 歸戶正確（每個 agent / session / candidate 分開，總和等於各次嘗試之和）
- [ ] MAGI 對同一 LB 的並發度有預設上限且可設定

---

## 64. Phase 12 — Tutorial / Regression

Tutorial 要變成 final migration gate。

> 前提：§36.1 已經說明 tutorial 其實會在 **Phase 3** 先壞一次。本節談的是最終 rollout gate，不是「第一次讓 tutorial 通過」。

### 64.1 直接沿用 repo 既有的 gate 定義，不要另創一套

README 已經定義了可執行的 rollout gate，計畫應該直接引用而不是重新發明：

```bash
npm run test:tutorial          # deterministic，每個 PR 都要跑

REAL_TUTORIAL_GATE=1 REAL_TUTORIAL_ONLY=chatgpt-browser-skill    REAL_TUTORIAL_SESSIONS=10 npm run test:real_tutorial
REAL_TUTORIAL_GATE=1 REAL_TUTORIAL_ONLY=harness-stability-skill  REAL_TUTORIAL_SESSIONS=10 npm run test:real_tutorial
REAL_TUTORIAL_GATE=1 REAL_TUTORIAL_ONLY=grilling-invest-skill    REAL_TUTORIAL_SESSIONS=10 npm run test:real_tutorial
REAL_TUTORIAL_GATE=1 REAL_TUTORIAL_ONLY=text-protocol-conformance REAL_TUTORIAL_SESSIONS=3 npm run test:real_tutorial
```

注意 tutorial 9（`text-protocol-conformance`）驗的是 **legacy strict text protocol**。Pi 用的是 provider 原生 tool call，不是自訂文字協議。所以 Phase 12 面對的兩個選項：

- 選項 A：tutorial 9 隨 legacy harness 一起在 Phase 13 刪除，並在 Phase 12 補一個等價的「Pi native tool-call conformance」案例。
- 選項 B：保留 tutorial 9 作為歷史相容測試——但那等於保留 legacy transport，與 §66 的刪除門檻矛盾。

**決策 D8 — 採用 A：tutorial 9 隨 legacy harness 在 Phase 13 一併刪除，Phase 12 先補一個等價的 Pi native tool-call conformance 案例。**

理由：B 等於為了保住一個測試而保留整條 legacy transport，直接和 §66 的刪除門檻衝突。tutorial 9 真正的價值不是「文字協議」本身，而是「工具呼叫協議在真實 provider 上穩定」——那個價值在 Pi native tool call 上同樣需要被測，只是換一種形式。

### 64.1.1 新案例：Pi native tool-call conformance

至少涵蓋（對應 tutorial 9 現有 3 sessions 的 gate 強度）：

- [ ] 單一 tool call → tool result → follow-up turn → 最終答案
- [ ] 連續多次 tool call（同一輪多個 / 跨輪）
- [ ] tool 執行中 abort，之後新的 prompt 仍可正常運作（對應 §13）
- [ ] `outcome_unknown` 後模型不自動重試（對應 §47.1）
- [ ] tool 參數驗證失敗時的可恢復行為
- [ ] `toolExecution: "sequential"` 下的執行順序符合預期（§46.2）

時程：**新案例必須在 Phase 12 結束前通過，才允許進入 Phase 13。** 在那之前 tutorial 9 繼續存在並繼續跑（它驗的是還沒被刪除的 legacy path，仍然有效）。

### 64.2 Gate 的通過定義

| Gate | 何時跑 | 通過條件 |
|---|---|---|
| `npm run lint` / `npm test` / `npm run build` | 每個 PR（CI，§6.3.1） | 全綠、0 warning |
| `npm run test:tutorial` | 每個 PR | 全綠 |
| Session backend conformance（§52.3） | Phase 8 起每個 PR | 全綠 |
| Real tutorial gate ×4 | 每個 milestone 結束 | 與 Phase 0 baseline 相同的成功率門檻 |
| Bundle 預算（§4.2） | 每個 phase | 未超出協議增幅 |
| Desktop / mobile smoke | 每個 milestone | 對照 Phase 0 截圖 |

Real tutorial 需要 provider quota 且會消耗實際費用；哪些 milestone 要跑滿 4 組、哪些只跑 1 組，必須事先講定，否則實務上一定會被跳過。

### 64.3 決策 D10 — 依功能成熟度分層的 real gate

原則：**只跑當時「已遷移且語意上仍適用」的案例。** 在 MCP 尚未遷移時跑 MCP 案例，得到的紅燈沒有資訊量，只會訓練團隊忽略紅燈。

| Milestone | 範圍 | 要跑的 real gate | 說明 |
|---|---|---|---|
| **A**（PoC，§87） | Browser Pi PoC | PoC 專屬的 real-provider gate（1 組，建議 3 sessions） | 不套用既有 tutorial；只驗 §16 的 PASS criteria 在真實 provider 下穩定 |
| **B**（Pi Foundation + UI v2，§88） | 核心 Pi + 新 shell | `harness-stability-skill`（10）＋ `npm run test:tutorial` 全綠 | 這組只用本機 skill、不依賴 MCP 或外部網站，最適合驗新 shell 與 Pi loop 的穩定性 |
| **C**（單 Agent parity，§89） | Docs / MCP / Built-ins / Skills / Persistence / LB / Voice | 當時已遷移且相容的全部 real gate：`chatgpt-browser-skill`(10)、`harness-stability-skill`(10)、`grilling-invest-skill`(10)，以及已就緒的 native tool-call conformance | Phase 逐步推進時，每完成一個對應 phase 就把該案例加入常態 gate |
| **D**（MAGI，§90） | Multi-agent | C 的全部 ＋ MAGI 相關案例 | MAGI 會放大 runtime bug，不可只跑單 agent 案例 |
| **E**（Legacy removal，§91） | 最終 | **完整最終套件，一項不漏** | 含 §64.1.1 的新 conformance 案例；tutorial 9 在此之後才隨 legacy 刪除 |

補充規則：

- [ ] 每個 milestone 的 gate 結果（成功率、失敗案例、provider）記錄在計畫或 `docs/`，與 Phase 0 baseline 對照
- [ ] 某個案例因「該功能尚未遷移」而跳過時，必須明確記錄為 **skipped（原因）**，不得記為 pass
- [ ] 成功率門檻沿用 Phase 0 baseline 的實測值，不是「跑過一次就算」
- [ ] real gate 需要 `.tutorial-test.local.json` 與 provider quota；跑之前先確認額度，避免 gate 因額度耗盡而被判定為功能失敗

---

## 64.4 兩個關鍵 gate 目前沒有執行機制（Q6）

在一個 push-to-main 即自動部署的 repo 裡（§101.6），純人工榮譽制的 gate 在時程壓力下一定第一個被跳過——而這正是整份計畫最依賴的兩道防線。

**1. Bundle 預算（§4.2 第 3 點）目前沒有牙齒。**

PR 0 前的現況：只有一句「超過協議值要先解釋再合併」，沒有腳本、沒有 CI job、沒有存放基準值的檔案，§6.3 的表格裡 `dist/` 大小還是 `_(待填)_`。

改為可執行：

- [x] PR 0 產出 `bundle-budget.json`（initial route JS gzip、最大單一 chunk gzip、總 gzip），數值來自 Phase 0 baseline
- [x] 新增 `npm run check:bundle`：build 後量測並與預算比對，超標 exit 非 0
- [x] 掛進 §6.3.1 的 CI `verify` job，與 lint / test 同級
- [ ] 需要調高預算時，**修改 `bundle-budget.json` 本身**成為 PR 的一部分——這樣「放寬預算」會出現在 diff 裡被 review，而不是無聲發生

**2. Real tutorial gate 無法在 CI 跑，需要可稽核的登記機制。**

它需要 `.tutorial-test.local.json`（未納版控）與 provider quota，本質上是人工執行。§64.3 規定了「哪個 milestone 跑哪幾組」，但沒說誰跑、在哪跑、結果登記在哪、以及沒跑時什麼機制會擋住 merge。

改為可執行：

- [x] 每個 milestone 的結果以檔案形式保存到 `docs/gates/<milestone>.md`，內容含日期、執行者、provider、model、每組案例的 sessions 與成功率；格式見 `template.md`
- [ ] milestone 收尾的 PR 描述必須連結該檔案；沒有該檔案不得 merge
- [ ] 跳過的案例必須在該檔案中記為 **skipped（原因）**（§64.3 已有此規則，這裡給它一個實際存放位置）
- [x] CI 加一個輕量檢查：`gate-evidence.yml` 會讓 milestone 標記的 PR 若沒有對應的 `docs/gates/<milestone>.md` 更動就 fail

---

## 65. Tutorial Classification

```text
Tier 1
Pure Pi Chat

Tier 2
Docs

Tier 3
Built-in

Tier 4
MCP

Tier 5
Skills

Tier 6
Multi-turn tool workflows

Tier 7
Voice

Tier 8
MAGI
```

---

## 66. Phase 13 — Delete Legacy Harness

只有全部通過才刪。

### Deletion Gate

- [ ] Pi browser production stable
- [ ] Herdr-like UI stable
- [ ] Docs migrated
- [ ] MCP migrated
- [ ] Built-ins migrated
- [ ] Skills migrated
- [ ] session restore
- [ ] LB migrated
- [ ] Voice migrated
- [ ] MAGI migrated
- [ ] tutorials pass
- [ ] production build pass
- [ ] static deployment pass
- [ ] `RuntimeEngine` feature flag 與所有 `?engine=` 分支已移除（§22.1）
- [ ] `src/ui/` 與 `src/ui-v2/` 已合併，不留兩套 shell
- [ ] tutorial 9（strict text protocol）已依 §64.1 的決策處理
- [ ] `AGENTS.md` / `README.md` / `docs/` 已更新，不再描述已刪除的 canonical harness
- [ ] 上一個可用版本的 production build 仍可依 §101 部署（刪除後的第一週保留回退能力）

---

## 67. 要刪的 Legacy

預期：

```text
src/runtime/harness/
legacy canonical action protocol
legacy context transcript engine
legacy provider transport normalization
legacy skill action loop glue
```

---

## 68. 要保留的 AgentGoRound 資產

| 模組 | 決策 |
|---|---|
| React App / component library | KEEP |
| Agents UI / data | KEEP + redesign |
| Docs | KEEP |
| MCP client stack | KEEP |
| MCP management UI | KEEP |
| Skills storage/package | KEEP |
| Credential Vault | KEEP |
| Voice | KEEP |
| Load Balancer | KEEP, new Pi adapter |
| MAGI | KEEP concept + UI, runtime rewire |
| ToolEffectRunner | KEEP semantics |
| Tutorial | KEEP as regression suite |
| Legacy Harness | REMOVE |
| Legacy ContextProjector transcript ownership | REMOVE |
| Legacy Pi-like protocol | REMOVE |

---

## 69. Phase 14 — Optional Computer Mode

只有 AgentGoRound v2 core 完成後才開始。

---

## 70. Computer Architecture

```text
Browser JS
│
├── Pi Agent
│     │
│     └── Computer AgentTools
│             │
│             ▼
│       ComputerAdapter
│             │
│             ▼
│      WebContainer/Succinix
│
└── Herdr-like UI
      ├── Conversation
      ├── Files
      ├── Terminal
      └── Preview
```

---

## 71. Computer Tools

第一版只需要：

```text
read
write
edit
bash
```

再考慮：

```text
grep
git
npm
python
ports
browser preview
```

---

## 72. Computer UI

這時候 Herdr-like shell 已經準備好了。

只需要新增 workspace tabs：

```text
Conversation
Files
Terminal
Preview
Activity
Context
```

而不需要再重做整個 App。

---

## 73. Browser Compatibility Strategy

### Core Mode

```text
Pi
Chat
Docs
MCP
Skills
Voice
MAGI
```

盡可能支援 modern browsers。

### Computer Mode

```text
WebContainer
```

可以限定 Chromium desktop。

不要因 Computer Mode 而把整個 AgentGoRound 變 Chromium-only。

---

## 74. UI Component Architecture

建議：

```text
src/ui-v2/
├── shell/
│   ├── AppShell.tsx
│   ├── DesktopShell.tsx
│   └── MobileShell.tsx
│
├── agents/
│   ├── AgentRail.tsx
│   ├── AgentStatusItem.tsx
│   ├── AgentAttentionQueue.tsx
│   └── AgentHeader.tsx
│
├── workspace/
│   ├── AgentWorkspace.tsx
│   ├── WorkspaceTabs.tsx
│   └── WorkspaceActivity.tsx
│
├── conversation/
│   ├── Conversation.tsx
│   ├── MessageList.tsx
│   └── Composer.tsx
│
├── approvals/
│   ├── ApprovalCard.tsx
│   └── ApprovalQueue.tsx
│
└── context/
    ├── ContextPanel.tsx
    ├── AttachedDocs.tsx
    └── AttachedSkills.tsx
```

---

## 75. Runtime/UI Boundary

React 接：

```text
AgentRuntimeView
ConversationView
ActivityView
```

不要：

```text
React
↓
Pi internal object graph everywhere
```

---

## 76. Suggested View Models

```ts
type AgentRuntimeView = {
  agentId: string;
  sessionId: string;
  status: "idle" | "working" | "blocked" | "done" | "error";
  attentionRequired: boolean;
  unseen: boolean;
  currentActivity?: RuntimeActivity;
  lastActivityAt: number;
};

type RuntimeActivity = {
  kind: "thinking" | "responding" | "tool" | "approval" | "waiting";
  label: string;
  toolName?: string;
};

type ActivityItem = {
  id: string;
  timestamp: number;
  kind: string;
  title: string;
  status: "running" | "done" | "blocked" | "error";
};
```

---

## 77. Source-of-Truth Rules

### Pi owns

- agent loop
- model/tool message ordering
- active run
- tool-call lifecycle
- agent message state

### AgentGoRound owns

- **`blocked` / `attentionRequired` / `unseen`（§28.1 — Pi 不知道核准的存在）**
- **pending approval 與 pending ask-user 的佇列**
- product-level Agent metadata
- attached Docs
- selected Skills
- MCP server configuration
- credentials
- LB config
- permission policy
- UI attention state
- workspace layout
- persistence adapters
- MAGI orchestration

---

## 78. Do Not Duplicate Ownership

不要再出現：

```text
Pi says run active
AgentGoRound harness says idle
UI says blocked
```

新的 runtime view 必須只 projection Pi + AgentGoRound policy。

---

## 79. Security

Pi 官方本身不替 host 提供完整 filesystem/process/network permission sandbox。

因此：

```text
Pi Agent Core
```

與：

```text
AgentGoRound Tool Permission Layer
```

必須分開。

AgentGoRound 現有 confirmation / ToolEffectRunner semantics 仍重要。

### 79.1 這次遷移實際改變的信任邊界

原節只講了「要分開」，但沒說遷移本身會動到什麼。以下每一項都必須在對應 phase 處理：

**1. Credentials 不得進入 Pi 的持久化狀態。**
Pi 有 `getApiKey(provider)` callback 與 `InMemoryCredentialStore`。正確用法是讓 Pi 在需要時**回呼**AgentGoRound 取 key，而不是把 key 放進 `Models` / session state。Phase 8 開始持久化 session 之後，這條會直接決定「API key 會不會被寫進 IndexedDB」。

- [ ] session 持久化前有 redaction 層，明確剔除 credential、`Authorization` header、自訂 MCP header
- [ ] 有測試證明匯出的 session 檔案不含 token

**2. Session 持久化 = 把更多東西寫上磁碟。**
upstream `SessionStorage` 記錄的東西比現在的 `chatStore` 多得多：tool 參數、tool 結果、usage、compaction summary。使用者的 MCP tool 參數（可能含私密查詢）與 doc 內容都會落地在 IndexedDB，且目前是**明碼**。這是相對現況的實質擴大，計畫必須明確承認並選擇：

**決策 D6 — 採用選項 1：session 維持本機明碼儲存；UI 明確告知並可清除；credential redaction 為 hard gate。完整 session 加密另案處理。**

理由：AGENTS.md 已經明確警告過，只把單一 write path 改成加密而不做完整的 unlock lifecycle / migration / failure recovery / UI，是比不加密更糟的狀態——使用者以為資料受保護，實際上有沒被涵蓋的路徑，而且一旦 unlock 流程出錯就是資料取不回來。把它塞進已經很滿的 Phase 8 幾乎保證做成半套。維持現況定位（資料只在本機、公開部署前需要另外的架構）是誠實的，而且與 README 現有的安全聲明一致。

但「維持明碼」不等於「什麼都不做」。以下三項是 Phase 8 的 hard gate，不是 nice-to-have：

### 79.2 D6 的 hard gate

**1. Credential redaction（不可協商）—— 但必須是結構化契約，不是字串掃描（C3）**

原本這一條只寫「剔除 token / header」。這不夠，而且照字面實作會做成「掃描字串找 secret」，那有三種失效方式：

```text
漏掉  token 經過編碼、拼接、或出現在未預期欄位 → 掃不到
誤刪  使用者對話裡剛好有像 key 的字串 → 內容被破壞
漏網  redaction 只掛在其中一條 persistence 路徑，
      audit / details / export 其中之一沒經過
```

**改為以 provenance（來源）分類，而不是以 content（內容）分類。** 一個欄位該不該 redact，由它從哪裡來決定，不由它長什麼樣子決定。

**(a) 敏感欄位 registry（單一來源）**

```ts
// 明確列舉，新增 credential 類欄位時必須同步更新此表
export const SENSITIVE_FIELDS = {
  providerApiKey:      { source: "credential-store", policy: "drop" },
  authorizationHeader: { source: "mcp-config",       policy: "drop" },
  mcpCustomHeaders:    { source: "mcp-config",       policy: "drop-values-keep-keys" },
  credentialVaultBlob: { source: "vault",            policy: "drop" },
  providerBaseUrlAuth: { source: "provider-config",  policy: "strip-userinfo" },
} as const;
```

**(b) 結構化 redaction 位置（不是全文掃描）**

| 位置 | 處理 |
|---|---|
| tool call arguments | 依 tool schema：被標記為 secret 的參數 → drop；其餘原樣保留 |
| tool result content | **不掃描**（這是模型與使用者要看的內容） |
| tool result `details` | **allowlist 序列化**：只有明確列出的欄位會被持久化 |
| MCP request metadata | header 值一律 drop，保留 header 名稱以利除錯 |
| provider request metadata | 只保留 provider id / model id / candidate id |
| usage / audit record | allowlist 序列化 |
| export | 與持久化**共用同一個 redactor**，不得另寫一份 |

**(c) 無法安全分類時的策略**

以 provenance 分類的好處是：正常路徑不存在「分類不出來」的情況——欄位要嘛來自已知 secret 來源，要嘛不是。剩下的只有兩種例外，各有明確處理：

```text
redactor 對某欄位拋例外
  → 該欄位以 "[redaction-failed]" 標記寫入，其餘照常持久化
  → 寫 audit 事件
  → 不中斷整個 session 的持久化

details / metadata 出現 registry 未涵蓋的新欄位
  → 因為是 allowlist 序列化，預設就是「不寫入」
  → 開發期用 assertion 提醒補 registry
```

這是對本節先前寫法的**修正**：原本寫「redaction 失敗則拒絕寫入」。那會讓一個欄位的問題癱瘓整個 session 的持久化——使用者失去對話，比洩漏風險更立即。改為**欄位級 fail-closed**：壞掉的欄位不寫，其他照寫。

**(d) 單一必經點**

- [ ] 所有持久化與匯出路徑都呼叫同一個 `redactForPersistence()`，型別上讓「未經 redact 的物件」無法被寫入（例如 store 的寫入 API 只接受 `Redacted<T>` 品牌型別）
- [ ] 有一個測試列舉**所有**寫入 / 匯出路徑，斷言每一條都經過 redactor（新增路徑而沒接上時，測試要失敗）
- [ ] 有測試：構造含 token 的 tool 參數、MCP header、provider metadata → 落地與匯出資料皆不含該 token
- [ ] 有測試：對話內容裡出現長得像 API key 的字串 → **不被刪改**（防誤刪回歸）
- [ ] 有測試：`details` 出現未登錄欄位 → 不被持久化
- [ ] redaction 失敗為欄位級，不中斷 session 持久化，且有 audit 紀錄

**2. UI 告知**

- [ ] Settings 或 session 面板明確說明：對話、工具參數與工具結果會以明碼儲存在這台裝置的瀏覽器中
- [ ] README 的「安全與部署限制」段落同步更新（現有條列已提到 docs/skills 存在本機，需補上 session 內容與工具參數）

**3. 可清除**

- [ ] 提供「清除所有 session 資料」的明確動作，且真的刪掉 IndexedDB 內容（不是只清 UI state）
- [ ] 提供單一 session 刪除
- [ ] 清除前提示可先匯出

**另案：** 完整 session 加密（含 unlock lifecycle、migration、failure recovery、UI）另開專案，不進 v2 遷移路徑。

**3. `dangerouslyAllowBrowser: true` 不是新風險，但要寫清楚。**
pi-ai 的 OpenAI / Anthropic client 已經內建這個旗標（§4.1 F14）。它沒有讓 AgentGoRound 比現在更不安全——本專案本來就是 browser 端持有 credential——但 README 的安全聲明應同步：現在有第三方 SDK 直接在瀏覽器持有並送出使用者 key。

**4. 模型自主選擇 tool 的面變大了。**
legacy harness 走自訂 text/native action protocol，可控點多；Pi 是原生 tool calling，模型會更主動、更頻繁地呼叫 tool。搭配 built-in tool 具有 same-origin JavaScript 能力（AGENTS.md），這代表：

- [ ] 遷移**不得放寬**任何現有 confirmation。預設政策為：所有 mutating / non-idempotent tool 一律需要核准。
- [ ] `beforeToolCall` 是唯一的核准入口，不允許有繞過它的 tool 執行路徑。
- [ ] Phase 6 要有測試比對「Phase 0 需要確認的 tool 集合」與「Pi 遷移後需要確認的 tool 集合」，兩者必須相同。

**5. Prompt injection 面擴大。**
MCP tool 結果、docs、skill references 都會進入 context，而 Pi 的 loop 比現在更長、更自動。惡意 MCP server 或被污染的文件可以嘗試誘導 agent 呼叫其他 tool。第一版不做內容過濾，但：

- [ ] 核准 UI 必須顯示**完整的 tool 名稱、server 與參數**（§34 已有雛形），使用者才有機會攔下來
- [ ] 這一點要寫進 README 的安全限制段落

**6. §48 說不要同時重做 sandbox — 同意，但要有明確界線。**
「不重做」的意思是不改變 built-in tool 的執行機制，不是「安全性不變就好」。上面第 4 點的「不放寬」是硬性條件。

---

## 80. Herdr-like blocked semantics

blocked 必須由 AgentGoRound runtime 明確知道。

不要靠：

```text
讀 terminal 畫面猜
```

因為 Browser Pi 有真正 typed events。

例如：

```text
approval requested
→ blocked

ask_user active
→ blocked

credential missing
→ blocked
```

這其實可以比 Herdr 的 terminal detection 更準。

---

## 81. Error vs Blocked

### blocked

使用者有明確下一步可做：

```text
Approve tool
Enter credential
Answer question
Choose recovery
```

### error

沒有立即 user interaction 就能自然繼續：

```text
runtime crashed
invalid state
unrecoverable transport error
```

---

## 81.1 `blocked` 的時鐘問題（Q2，本輪最嚴重的一項）

已驗證的現況：

- `src/app/App.tsx:214` — `DEFAULT_EXECUTION_DEADLINE_MS = 5 * 60 * 1000`，使用者可調，tutorial 可覆寫（README 記載 browser workflow 用 15 分鐘）
- `src/runtime/toolEffectRunner.ts:193` — 現有核准是 `confirm(message, signal): Promise<boolean>`，signal 由 deadline 合成
- §20.2 — Pi 的核准實作方式是在 `beforeToolCall` 內部 await，run 保持存活並受同一個 signal 控制

而 Herdr-like 模型的整個價值主張建立在**長人類延遲**上：§35 的 attention queue、§26 把 blocked 排最前面、§82 的 done-unseen——這些都假設「使用者晚點回來處理」。

把 5 分鐘的 execution deadline 原樣轉成 AbortSignal 交給 Pi（§56.2 Q2），結果是：

```text
agent 進入 blocked，等待核准
        ↓
使用者去開會 / 切到別的 agent
        ↓
5 分鐘後 deadline 到期 → signal abort
        ↓
run 被中斷，核准 UI 變成殭屍
        ↓
attention 模型整個失效
```

§56.2 Q2 只問「怎麼把 deadline 轉成 signal」，從來沒問**「blocked 期間這個時鐘要不要繼續走」**。

### 81.1.1 決策：分離兩個時鐘

```text
agent-active clock   只在 agent 實際在跑（模型推論、tool 執行）時累加
                     → ExecutionDeadline 綁這一個

wall-clock           包含等待人類的時間
                     → 只用於 approval 逾時，且預設值完全不同
```

- **`ExecutionDeadline` 在 agent 進入 `blocked` 時暫停，解除後恢復。** 這保留了 deadline 原本的用途（防止 runaway 推論／卡住的 tool），又不會懲罰人類的思考時間。
- **Approval 另有獨立逾時**，預設值應該以小時計（建議預設 24 小時，可設定，可設為永不逾時）。逾時的結果是 `rejected`（明確、未執行），**不是** `outcome_unknown`。

### 81.1.2 §81 要多一個狀態

原本只有 blocked / error 兩分。要補第三種終止情境：

```text
blocked → approval 逾時
  → tool 以 rejected 結束（未 dispatch）
  → agent 回到 idle 或依 terminate 提示停止
  → UI 明確顯示「核准逾時，工具未執行」
```

### 81.1.3 連鎖影響（三處都要一起改）

**1. §52.4 的還原政策要分兩種未完成狀態。** 目前 P1 把所有未完成 tool call 一律補 `outcome_unknown`。但等待核准中的 tool **根本還沒 dispatch**，補「結果未知」是製造假的不確定性。

```text
awaiting_approval（未 dispatch） → 還原為 rejected：「核准未完成，工具未執行」
dispatched（已送出）             → 還原為 outcome_unknown（原 P1 行為）
```

這要求 session store 必須**在 dispatch 之前**就記錄「這個 call 正在等核准」，否則重開時分不出兩者。這是 Phase 8 的資料模型需求，不是 UI 需求。

**2. §52.5 的分頁鎖。** blocked 的分頁會長時間持有寫入鎖。§52.5.2 只驗了「分頁關閉後可取得寫入權」，沒驗「分頁還開著但卡在 blocked 好幾小時」。要決定：長期 blocked 是否釋放鎖（建議：不釋放，但其他分頁要能看到「session 被另一個分頁持有，且正在等待核准」，並提供「接管」動作）。

**3. §56.2 Q2 的 spike 範圍要擴大。** 原本只驗 deadline → signal 的轉換，現在要一併驗證「暫停／恢復 deadline」在 Pi 的 `AbortSignal` 模型下做得到（Pi 只認 signal，不認可暫停的 deadline，所以暫停必須在 AgentGoRound 這一側實作成「不要在 blocked 期間 abort」）。

### 81.1.4 驗收

- [ ] agent 在 blocked 停留超過 `ExecutionDeadline` 後，run 不被中斷
- [ ] agent-active 時間累計超過 deadline 時，仍正確中斷（deadline 沒有被整個停用）
- [ ] approval 逾時產生 `rejected` 而非 `outcome_unknown`，且 UI 說明清楚
- [ ] 等待核准中重新載入 → 還原為「未執行」，不是「結果未知」
- [ ] tutorial 的 15 分鐘 browser workflow deadline 語意不變

---

## 82. Done Semantics

建議：

```text
done + unseen
```

顯示：

```text
✓
```

使用者打開後：

```text
done seen
```

可降為普通 completed state。

避免完成 Agent 搶 attention forever。

---

## 83. Suggested PR Sequence

> 這份序列有兩個必須調整的地方：
> - **PR 0 必須包含 CI test gate**（§6.3.1）。目前 main 是「push 即部署、無測試」，在這個狀態下跑 15+ 個 PR 的重構沒有安全網。
> - **PR 3 太大。** 「整個新 shell」放一個 PR 會無法審、無法回退。建議拆成 PR 3a（shell + agent rail + 語意狀態）、PR 3b（workspace + conversation + activity）、PR 3c（approval + attention queue + tutorial anchor 契約）。
> - **編號不等於時間順序。** PR 2S 與 PR 2 並行開發（見下方），其餘編號才是序列。規模與依賴鏈見 §6.5。

### PR 0

```text
chore: freeze legacy runtime, add CI test gate, capture baseline
```

### PR 1

```text
spike: prove upstream Pi runs directly in browser
```

### PR 2S — LB streaming spike（**PR 2 的合併前置條件**）

```text
spike(pi): validate load-balanced streamFn failover semantics
```

**排序語意（重要，不要照字面讀成「PR 2 之後」）：**

```text
時間軸：  PR 2 實作  ├────────────────────────┤
          PR 2S      ├──────────┤
                                 ▲
                                 └── PR 2S 必須在此通過，PR 2 才能 merge
```

- **可以與 PR 2 的實作並行開發。** spike 不需要等 foundation 寫完，foundation 也不需要停下來等 spike。
- **但 PR 2S 的結論必須在 PR 2 merge 之前產出並通過。** 這是硬性 gate（§0.1 G1）。
- 原因：`PiAgentRuntime` 的介面形狀（§20）是 Phase 3–8 的地基。如果 first-token gate 不可行、或 failover 必須改變 turn 的生命週期，介面就要改 — 讓 foundation 先落地再驗證核心介面，等於把返工推遲到六個 phase 之後。
- PR 2S **不合併到產品路徑**，只回答 §56.2 的 Q1/Q2/Q3 並留下可執行證據。
- 若 Q1 結論為否：PR 2 不得 merge，先依 spike 結論重新設計 §20，再重跑本 gate。

> 命名說明：本節原本叫「PR 2.5」，因為編號會被讀成「排在 PR 2 之後」而與上述 gate 語意衝突，已改名為 **PR 2S**（S = spike）。文件其他位置一律使用 PR 2S。

### PR 2 — Pi runtime foundation（merge 受 PR 2S 閘控）

```text
feat(pi): add production Pi runtime foundation
```

### PR 3（建議拆成 3a / 3b / 3c）

```text
feat(ui): add agent-centric Herdr-like application shell
```

### PR 4

```text
feat(pi): migrate docs context
```

### PR 5

```text
feat(pi): expose MCP catalog as Pi AgentTools
```

### PR 6

```text
feat(pi): adapt built-in tools through ToolEffectRunner
```

### PR 7

```text
feat(pi): migrate skills
```

### PR 8

```text
feat(pi): migrate session persistence
```

### PR 9

```text
feat(pi): integrate load balancer
```

### PR 10

```text
feat(pi): migrate voice
```

### PR 11

```text
feat(pi): migrate MAGI orchestration
```

### PR 12

```text
test(pi): move tutorials and production smoke tests to Pi runtime
```

### PR 13

```text
refactor: remove legacy custom harness
```

### PR 14 (later)

```text
feat(computer): add optional WebContainer execution machine
```

---

## 84. Feature Migration Matrix

| Feature | Existing Data | Existing UI | Runtime Work | UI v2 Work | Risk |
|---|---|---|---|---|---|
| Browser Pi | N/A | PoC only | New | minimal | Medium |
| Agent config | Keep | Redesign | map to Pi | High | Medium |
| Docs | Keep | Reuse/adapt | context adapter | attach/context UI | Low |
| MCP | Keep | Reuse/adapt | Pi tool adapter | activity/approval | Medium |
| Built-ins | Keep | Reuse/adapt | Pi tool adapter | activity | Medium |
| ToolEffectRunner | Keep | approval redesign | execution policy | blocked state | Medium |
| Skills | Keep | Reuse/adapt | Pi tool adapter | context UI | Medium |
| Chat | Keep initially | Replace shell | projection | conversation | Medium |
| Persistence | Migrate | session UX | Pi session bridge | session list | Medium |
| LB | Keep | Settings keep | Pi provider adapter | mostly unchanged | High |
| Voice | Keep | Adapt | prompt/event bridge | minimal | Low |
| MAGI | Keep concept | Redesign | multi Pi runtime | agent status UX | High |
| Computer | New | New | WebContainer adapter | files/terminal | High |

---

## 85. What Not To Do

### 不要先 clone Herdr UI

PoC 前不做 UI redesign。

### 不要等 migration 全部結束才改 UI

這會讓所有功能接兩次 UI。

### 不要把 Pi 放 WebContainer

Pi 直接 Browser JS。

### 不要 fork Pi agent loop

使用 upstream package。

### 不要把 Pi events 再轉成 legacy canonical action protocol

只做 UI/event projection。

### 不要 migration 同時重做 custom sandbox

先維持 current execution behavior。

### 不要同時做 Computer Mode

WebContainer 最後。

---

## 86. Definition of Done — AgentGoRound v2

產品可以準確描述為：

> AgentGoRound is a browser-native multi-agent environment powered by the real Pi agent runtime.

且具備：

```text
REAL upstream Pi in Browser JS
+
Herdr-like agent/workspace UI
+
Docs
+
MCP
+
Skills
+
ToolEffectRunner permissions
+
Load Balancer
+
Voice
+
MAGI
+
Persistent browser state
```

Computer Mode 是 optional enhancement。

---

## 87. Milestone A — 技術方向成立

完成：

```text
Browser Pi PoC
```

Definition：

```text
Pi + Browser JS + streaming + tool + abort + restore
```

---

## 88. Milestone B — 新核心成立

完成：

```text
Pi Runtime Foundation
+
Herdr-like UI Foundation
```

Definition：

> 一個真正 Pi Agent 可以透過新的 AgentGoRound workspace UI 使用，而且 working / blocked / done / idle state 全部可靠。

---

## 89. Milestone C — 單 Agent parity

完成：

```text
Docs
MCP
Built-ins
Skills
Persistence
LB
Voice
```

Definition：

> One-to-one Agent 不需要 legacy harness。

---

## 90. Milestone D — Multi-Agent parity

完成：

```text
MAGI
```

Definition：

> 每個 MAGI member 都是真正 Pi runtime，並透過同一套 Herdr-like attention UI 操作。

---

## 91. Milestone E — Legacy Removal

完成：

```text
Tutorials
Regression
Static deployment
Legacy deletion
```

---

## 92. Milestone F — Browser Computer

未來：

```text
Pi
+
WebContainer
+
Files / Terminal / Preview
```

---

## 93. First Engineering Ticket

```markdown
# Spike: Browser-native upstream Pi

## Goal

Prove that `@earendil-works/pi-agent-core@0.84.4` can execute
directly inside AgentGoRound's Vite/React browser runtime.

## Required

- [ ] Add exact Pi dependencies
- [ ] Create explicit Pi Models instance
- [ ] Create real Pi Agent
- [ ] Use one existing browser-compatible provider
- [ ] Stream assistant output
- [ ] Add deterministic `add_numbers` AgentTool
- [ ] Complete tool-call → tool-result → follow-up loop
- [ ] Abort active run
- [ ] Run another prompt after abort
- [ ] Persist minimal message state in IndexedDB
- [ ] Restore after reload
- [ ] Pass Vite production build
- [ ] Pass static production smoke test

## Explicitly out of scope

- Herdr-like UI
- Docs
- MCP
- Skills
- MAGI
- Voice
- LB failover
- WebContainer
- Succinix
- legacy removal

## Success

If all checks pass, upstream Pi becomes the new canonical AgentGoRound runtime.
```

---

## 94. Second Engineering Ticket

PoC PASS 後：

```markdown
# Foundation: Production Pi runtime boundary

## Goal

Create a stable application boundary around upstream Pi without introducing
a second agent engine.

## Required

- [ ] PiAgentRuntime
- [ ] PiAgentRegistry
- [ ] PiEventBridge
- [ ] PiRuntimeProjector
- [ ] PiToolRegistry
- [ ] PiContextAssembler
- [ ] PiSessionBridge
- [ ] runtime feature flag
- [ ] unit tests
- [ ] integration tests

## Non-goal

Do not migrate Docs/MCP/Skills yet.
Do not redesign UI in this PR.
```

---

## 95. Third Engineering Ticket

```markdown
# UI v2: Herdr-like agent workspace shell

## Goal

Replace the chat-centric navigation model with an agent/workspace-centric,
attention-oriented shell.

## Required

- [ ] Agent rail
- [ ] semantic state: idle / working / blocked / done / error
- [ ] attention sorting
- [ ] current activity
- [ ] conversation workspace
- [ ] activity panel
- [ ] approval card
- [ ] global attention queue
- [ ] responsive mobile layout
- [ ] desktop layout
- [ ] Pi Runtime View Model integration

## Explicitly out of scope

- Terminal
- Files
- WebContainer
- Browser Preview
- full MAGI visualization
```

---

## 96. Why This Order Is Important

### PoC before UI

避免：

```text
漂亮 UI
+
runtime 不可行
```

### Pi Foundation before UI

避免 UI 綁：

```text
Pi raw events
```

### UI before feature migration

避免：

```text
Docs/MCP/Skills
→ old UI
→ new UI again
```

### One-to-one before MAGI

避免 multi-agent 把 runtime bugs 放大。

### Everything before WebContainer

避免把：

```text
Pi migration
+
UI migration
+
computer runtime
```

三個大風險綁在一起。

---

## 97. Recommended Project Identity After Migration

AgentGoRound 不需要跟 Sunam 比：

```text
誰更像 Pi coding CLI
```

也不需要跟 webdsh 比：

```text
誰 browser computer 更完整
```

可以有自己的定位：

> **A persistent, browser-native Pi multi-agent workspace.**

核心差異：

```text
Real Pi
+
multi-agent attention UI
+
MAGI
+
Docs
+
MCP
+
Skills
+
LB
+
browser persistence
```

---

## 98. References

技術基線與 UI 參考：

1. [Pi repository](https://github.com/earendil-works/pi)
2. [@earendil-works/pi-agent-core](https://www.npmjs.com/package/@earendil-works/pi-agent-core)
3. [Pi Agent changelog](https://github.com/earendil-works/pi/blob/main/packages/agent/CHANGELOG.md)
4. [Herdr Web](https://github.com/eyalev/herdr-web)
5. [Herdr GUI](https://github.com/powerfooI/herdr-gui)
6. [Herdr agent state documentation](https://github.com/herdrdev/herdr)
7. [AgentGoRound](https://github.com/gipapa/agent-go-round)

§4.1 的事實是用以下方式取得的（可重跑驗證）：

```bash
npm view @earendil-works/pi-agent-core@0.84.4 dependencies engines exports
npm view @earendil-works/pi-ai@0.84.4 dependencies engines exports
npm pack @earendil-works/pi-agent-core@0.84.4   # 解開後檢查 dist/*.d.ts 與 import graph
npm pack @earendil-works/pi-ai@0.84.4
```

repo 側的事實來自：`package.json`、`.github/workflows/*.yml`、`src/storage/chatStore.ts`、
`src/runtime/loadBalancerRunner.ts`、`src/runtime/toolEffectRunner.ts`、`src/runtime/harness/types.ts`、
`src/onboarding/tutorials/*.yaml`、`AGENTS.md`、`README.md`。

---

## 99. Final Recommended Sequence

```text
1. Freeze legacy

2. PoC:
   Real Pi directly in Browser JS

3. Production Pi Foundation:
   stable runtime boundary

4. Herdr-like UI:
   agent/workspace/attention first

5. Migrate:
   Docs
   MCP
   Built-ins
   Skills

6. Migrate:
   Session Persistence
   Load Balancer
   Voice

7. Migrate:
   MAGI

8. Regression:
   Tutorials
   production build
   static deploy

9. Delete:
   custom Pi-style harness

10. Later:
    WebContainer Computer Mode
```

---

## 100. 一句話版本

```text
不要先重寫所有功能，也不要先重畫 UI。

先證明「真正 Pi 可以直接在 Browser JS 跑」。

證明後建立一個薄的 Pi Runtime Foundation，
馬上把 App shell 改成 Herdr-like 的 agent/workspace/attention UI，
然後讓 Docs、MCP、Skills、LB、Voice、MAGI 一個一個只接一次新架構。

最後刪掉自製 Pi-style harness。

WebContainer 最後再加，而且只是一台 Pi 能操作的 computer。
```

---

## 101. Release / Rollback 策略（原計畫缺）

原計畫只有 §22 的 feature flag 提到 "safe rollback"，而 §22.1 已經說明那個 flag 在 Phase 3 之後就不再是有效的 rollback 手段。這一節補上真正可執行的做法。

### 101.1 AgentGoRound 的 rollback 其實很便宜

這是一個純靜態前端，沒有 application backend、沒有 server-side schema。所以：

```text
rollback = 重新部署上一個已知良好的 dist/
```

不需要 dual-engine、不需要保留兩套 runtime。**前提是三件事必須先做到：**

1. 每個 milestone 的 `dist/` 都有保存（Phase 0 已要求，見 §6.3）。
2. Deploy 有 CI gate（§6.3.1），否則壞版本會自動上線。
3. **持久化資料是 forward-compatible 的**——這是唯一真正不可逆的部分，見 §102。

### 101.2 唯一不可逆的東西是使用者資料

程式碼可以回退，`localStorage` / IndexedDB 不行。若新版把 `agr_chat_db` 就地改寫成新格式，回退後舊版讀不到自己的資料，rollback 就變成「資料遺失」。

因此本計畫要求：

```text
Migration 期間，任何 v1 資料都不得被就地覆寫或刪除。
新格式一律寫入新的 store / 新的 key，v1 保持可讀。
v1 的實際刪除只能發生在 Phase 13 之後，且必須是使用者可見的明確動作。
```

### 101.3 Rollback 演練

Milestone B（Pi Foundation + UI v2）結束時**必須實際演練一次**：

- [ ] 部署 milestone B 的版本
- [ ] 建立資料（agent、doc、對話、skill）
- [ ] 回退部署到 Phase 0 baseline 的 `dist/`
- [ ] 確認舊版仍可正常啟動，且原有資料完整可見
- [ ] 再前進到 milestone B，確認資料仍在

沒演練過的 rollback 等於沒有 rollback。

### 101.4 Rollback 的失效點

明確寫下來，讓決策者知道界線在哪：

| 時點 | Rollback 手段 | 代價 |
|---|---|---|
| Phase 0–2 | `?engine=legacy` 或重新部署 | 幾乎為零 |
| Phase 3–7 | 重新部署舊 `dist/` | 使用者失去該期間在新 UI 產生的**新格式**資料（v1 資料完好） |
| Phase 8–12 | 重新部署舊 `dist/` | 同上，但新 session 資料量更大，使用者感受更明顯 |
| Phase 13 之後 | 只剩 git revert + 重建 | 實質上是新的一輪開發 |

---

## 101.5 localStorage 的回退安全（Q3，§101.2 只保護了 IndexedDB）

§101.2 的規則只講 `agr_chat_db`。但已驗證的失敗路徑在 localStorage：

```ts
// src/storage/safeStorage.ts:100-105
if (options.validate && !options.validate(migrated)) {
  backupCorruptedData(key, raw, "schema_mismatch");   // 寫到 __backup_<key>_<ts>_...
  warn(...);
  return options.defaultValue;                        // agr_agents_v1 的 default 是 []
}
```

搭配 `src/storage/agentStore.ts:7` 的 `isAgentArray`（要求每個元素都有 string 的 `id` / `name` / `type`），完整的災難路徑是：

```text
UI v2 把 agents 形狀改成舊版 validator 驗不過的樣子
        ↓
回退部署到 Phase 0 baseline
        ↓
readJsonStorage 驗證失敗 → 回傳 []
        ↓
使用者看到「0 個 agent」
        ↓
只要做任何一次 CRUD，saveAgents 就把 agr_agents_v1 覆寫成新陣列
        ↓
原始資料只剩在一個沒有任何 UI 會顯示的 __backup_* key 裡
```

§101.4 目前把 Phase 3–7 的回退代價寫成「v1 資料完好」——**這句話對 localStorage 不成立**。

### 101.5.1 規則

1. **§101.2 的 forward-compatible 規則擴及所有 `agr_*` localStorage key**，不只 IndexedDB。
2. **舊版 validator 必須能通過新版寫出的資料。** 這要有測試：把 Phase 0 tag 的 validator 函式複製一份進測試（或從 tag checkout），對新版的輸出做斷言。
3. **優先用新 key 而不是擴充舊 key。** UI v2 的 Pi 相關 agent 欄位放 `agr_agents_pi_v1`（以 agentId 為索引的側表），不改 `agr_agents_v1` 的形狀。UI v2 的 layout state 同理（§102.1 已有此要求，這裡擴為通則）。
4. **`__backup_*` key 要有出口。** 目前備份了卻沒有任何介面能還原。Settings 補一個「偵測到無法讀取的舊資料」的提示與下載按鈕。

### 101.5.2 驗收

- [ ] 有測試：Phase 0 的 `isAgentArray` 可以通過 UI v2 寫出的 `agr_agents_v1`
- [ ] 每一個 `agr_*` key 都有「新版寫、舊版讀」的相容性測試
- [ ] §101.3 的演練腳本加入：**回退後編輯一個 agent，再前進，確認資料仍完整**
- [ ] `__backup_*` 資料在 UI 上可見且可匯出

---

## 101.6 部署管線必須先收斂成一條（Q4）

PR 0 前實際檢查 `.github/workflows/`：

| Workflow | 觸發 | 部署機制 | concurrency group |
|---|---|---|---|
| `pages.yml` | push main | `upload-pages-artifact` + `deploy-pages@v4` | `pages` |
| `gh-pages.yml` | push main | `peaceiris/actions-gh-pages@v4` → `gh-pages` 分支 | `gh-pages` |

**兩個都會跑**（concurrency group 不同，不會互相取消），用兩種不同機制部署同一個 commit。實際生效的是哪一個，取決於 repo 的 Pages source 設定——計畫從頭到尾沒提。

這讓 §101.1 的「rollback = 重新部署上一個已知良好的 `dist/`」不可執行：若不知道哪條管線在服務 production，很可能透過 gh-pages 分支回退，而 Pages source 其實設在 artifact，於是回退**看起來失敗**。

### 101.6.1 PR 0 的工作

- [x] 確認 repo 的 Pages source 實際設定為 `gh-pages` branch `/`，已寫入 `docs/deployment.md`
- [x] **停用或刪除另一條 workflow**：`pages.yml` 已刪除，只保留 `gh-pages.yml` 作 production
- [x] §6.3.1 的 CI gate 已掛在保留的 workflow，`deploy` job `needs: verify`
- [x] 在 `docs/deployment.md` 記錄「如何回退」的實際指令

### 101.6.2 沒有 staging 這件事要明確承認

D1 選了 T1（不做 `?ui=v2` 旗標），所以 UI v2 在 Phase 3 直接成為預設 shell。加上 push-to-main 即部署，結論是：

> **使用者第一次看到半遷移狀態的產品，就是 production。** 而 §6.5 自己承認 Milestone A/B 的產品「比現況差」。

至少要有一條可點的預覽途徑，讓團隊在成為預設之前實際操作：

- [x] PR 0 已建立 `.github/workflows/preview.yml`：手動或 `next` 分支觸發，部署 `gh-pages/preview/`，`BASE_PATH` 使用 `/${repository}/preview/`；預覽 URL 與 smoke 方法見 `docs/deployment.md`
- 這條預覽環境**必須在 PR 3a 之前完成首次部署並 smoke**，否則 UI v2 沒有任何非 production 的驗證場所。

---

## 101.7 Build / 版本相容與 warm-cache 回退（C4）

§101.3 的演練只驗資料，沒驗「一個已經載入過新版的瀏覽器能不能恢復」。

問題形狀：Vite 產出 hashed chunk，`index.html` 指向它們。回退之後，手上還快取著新版 `index.html` 的分頁（或正開著的分頁做 lazy import）會去要求**已經不存在的 chunk**，得到 404 → 白畫面。GitHub Pages 不讓我們控制 HTML 的 cache header，所以**只能在客戶端偵測**。

### 101.7.1 機制

1. **每個 build 帶版本識別。** build 時注入 `__APP_BUILD_ID__`（commit sha 或 timestamp），同時輸出一個**不帶 hash** 的 `version.json`（`{ buildId, builtAt }`）到部署根目錄。
2. **偵測 chunk 載入失敗。** Vite 在動態 import 失敗時會在 window 上派發 `vite:preloadError`。監聽它，並對所有 lazy import 加上 catch。
3. **顯示可恢復狀態，不要白畫面。** 偵測到失敗時，抓 `version.json` 比對 `__APP_BUILD_ID__`：
   - 不一致 → 顯示「應用程式已更新（或已回退），請重新載入」＋一個會強制繞過快取的重新載入按鈕
   - 一致 → 是真的資源錯誤，顯示一般錯誤畫面與診斷資訊
4. **啟動時也比對一次**，讓長時間開著的分頁能主動發現版本已變。

### 101.7.2 驗收（併入 §101.3 的演練）

- [ ] Phase 1 確認 `vite:preloadError` 在本專案的 Vite 6 設定下確實會派發（不要假設）
- [ ] 演練：開著新版分頁 → 部署回退 → 在該分頁觸發一次 lazy import → 出現可恢復提示，不是白畫面
- [ ] 演練：新版分頁做硬重整 → 正常載入回退版
- [ ] 演練：完全冷啟動的瀏覽器 → 正常載入回退版
- [ ] `version.json` 本身不帶 hash、且不被長期快取

---

## 102. 資料遷移規格（原計畫缺，且是最被低估的一塊）

§84 的矩陣只寫了 "Persistence / Migrate" 一格。實際要處理的東西如下。

### 102.1 現有持久化盤點

| 位置 | Key / DB | 內容 | v2 影響 |
|---|---|---|---|
| localStorage | `agr_agents_v1` | Agent 設定 | 需要新增 Pi runtime 相關欄位（backward-compatible 追加） |
| localStorage | `agr_ui_v1` | UI state | UI v2 的 layout state 用**新 key**，不要污染 v1 |
| localStorage | `agr_mcp_v1` / `agr_mcp_aliases_v1` | MCP 設定 | 不變 |
| localStorage | `agr_model_credentials_v1` | Credentials | 不變；且不得進入 Pi session（§79.1） |
| localStorage | `agr_load_balancers_v1` | LB 設定 | 不變 |
| localStorage | `agr_built_in_tools_v1` | Built-in tools | 不變 |
| IndexedDB | `agr_docs_db` | Docs | 不變 |
| IndexedDB | `agr_skills_db` | Skills + assets | 不變 |
| IndexedDB | `agr_chat_db` v1 | **單一 `current` record 的全域對話** | 這是唯一需要真正遷移的資料 |

好消息：真正要動的只有一項。壞消息：那一項是從「一份全域對話」變成「Agent × N sessions 的事件式 store」，落差很大。

### 102.2 遷移方向

```text
agr_chat_db v1
  chat_state / "current" / { messages: ChatMessage[] }
        │
        │  一次性、非破壞性
        ▼
agr_pi_session_db v1   (新 DB，不動舊 DB)
  sessions        { sessionId, agentId, title, createdAt, updatedAt }
  entries         upstream SessionStorage 的 entry lane
  records         upstream SessionStorage 的 record lane
```

規則：

1. **新 DB，不是新版本號。** 用獨立的 `agr_pi_session_db` 而不是把 `agr_chat_db` 升到 v2。IndexedDB 的版本升級是單向的——一旦升版，舊程式碼再也打不開這個 DB，直接毀掉 §101 的 rollback。
2. 舊 `agr_chat_db` **保持 v1、保持可讀**，直到 Phase 13 之後。
3. 遷移是 idempotent 的：以 `migratedFrom: "agr_chat_db/current"` 標記，重跑不會產生重複 session。
4. 遷移失敗必須是**非致命**的：新版啟動時若遷移失敗，應該以空的 Pi session 啟動並記錄錯誤，而不是白畫面。
5. 遷移前提示使用者先用既有匯出功能備份（README 已建議重要資料先匯出）。

### 102.3 舊 `ChatMessage` → Pi transcript 的語意落差

這不是欄位改名。至少要先回答：

- 舊訊息裡的 tool 呼叫紀錄，在 Pi transcript 中要重建成真正的 tool call / tool result 對，還是降級成純文字？
- 舊訊息沒有 `toolCallId`，重建出來的 tool call 對 provider 是否合法？
- legacy 的 `runtime` 角色訊息（`protocol_error` / `context_notice`）在 Pi 中沒有對應角色，要丟棄還是轉成 system/user 註記？
- 匯入的歷史對話若被送回模型，會不會因為格式不合被 provider 拒絕？

**決策 D7 — 純文字唯讀遷移：只遷移 user / assistant 純文字訊息；含 tool 的歷史降級成不可續接的唯讀存檔。**

理由：舊 `ChatMessage` 沒有 `toolCallId`。任何「重建 tool call / tool result 對」的嘗試都要憑空發明 id，而重建出來的 transcript 是否被 provider 接受，無法在遷移前驗證——只會在使用者接續舊對話時才炸開，而且錯誤訊息會出現在 provider 端。把「歷史對話可以無縫接續」明確定為**非目標**，可以刪掉一整類無法測試的邊界情況。

### 102.3.1 D7 的具體規則

```text
user / assistant 純文字      → 遷移，可讀
含 tool call 的 assistant    → 遷移文字部分，標記 archived
legacy tool 訊息             → 遷移為唯讀顯示，不進 Pi transcript
legacy runtime 訊息          → 不遷移（protocol_error / context_notice 無對應角色）
```

- [ ] 遷移後的 session 帶 `continuable: false` 旗標
- [ ] UI 明確顯示「這是匯入的歷史紀錄，無法接續對話」，並提供「以此為基礎開新對話」（複製純文字內容當作新 session 的起點）
- [ ] `continuable: false` 的 session 不會被送進 `Agent.initialState`
- [ ] 有測試：含 tool 訊息的 v1 資料遷移後可正常顯示，且不會被誤送給 provider
- [ ] 原始 `agr_chat_db` v1 保持完整可讀（§101.2），使用者要完整原貌時仍可回退查看

### 102.4 Legacy archive 的歸屬（C2）

v1 的 `agr_chat_db` 是**單一全域對話，沒有 agentId**。而 §102.2 的 v2 schema 是 `sessions { sessionId, agentId, ... }`。D7 遷移出來的唯讀存檔要歸給哪個 agent？

不能讓實作者當場選一個 active agent——那會把一段與該 agent 無關的歷史掛到它名下，污染它的 session 清單，而且不同使用者的「當時 active agent」不同，遷移結果不可重現。

評估過的三個選項：

| 選項 | 問題 |
|---|---|
| 掛到目前 active agent | 不可重現、污染無關 agent、跨裝置結果不一致 |
| 建立一個 synthetic agent（例如「Legacy」） | 會出現在 agent rail、參與 §26 attention 排序、可被選進 MAGI、可被使用者誤刪或誤用、還會佔一個 `?agent=<id>` deep link |
| **獨立 archive container（採用）** | 需要 schema 允許 `agentId: null` 與一個新的 UI 入口 |

**決策：採用獨立 archive container。**

```text
agr_pi_session_db
  sessions
    { sessionId, agentId: string | null, kind: "live" | "legacy_archive",
      continuable: boolean, migratedFrom?: string, ... }
```

- 遷移產生的 session 一律 `agentId: null`、`kind: "legacy_archive"`、`continuable: false`（沿用 §102.3.1）
- **不建立任何 synthetic agent**，`agr_agents_v1` 完全不被遷移碰觸
- UI 入口放在全域導覽（與 Docs / Skills / MCP 同層）的「封存對話」，**不出現在 agent rail**
- 因此它不參與 attention 排序、不參與 MAGI、不會被 agent CRUD 影響
- 「以此為基礎開新對話」（§102.3.1）時，才由使用者**明確選擇**要指派給哪個 agent，並產生一個新的 `kind: "live"` session

### 102.4.1 驗收

- [ ] 遷移後 `agr_agents_v1` 的內容與數量**完全未變**（逐欄位比對）
- [ ] agent rail 不出現任何 legacy／synthetic 條目
- [ ] 封存對話有獨立入口，且標示為不可接續
- [ ] `agentId: null` 的 session 不會被 §26 的 attention 排序或 §63 的 MAGI 成員選單納入
- [ ] 同一份 v1 資料在兩台裝置上遷移，產生**相同**的歸屬結果（不依賴當下 active agent）
- [ ] 「以此為基礎開新對話」需要使用者明確指定 agent，不自動指派

### 102.5 遷移整體驗收

- [ ] 有 v1 資料的瀏覽器升級後，歷史對話仍看得到
- [ ] 沒有 v1 資料的全新瀏覽器可正常啟動
- [ ] 遷移重跑兩次不會產生重複 session
- [ ] 遷移失敗時 App 仍可用
- [ ] 回退到 Phase 0 baseline 後，舊 App 讀 `agr_chat_db` 仍完整（§101.3）
- [ ] 匯出 / 匯入功能在新舊格式都可用
- [ ] 匯出檔案不含任何 credential（§79.1）

---

## 103. 決策紀錄（D1–D11，已拍板）

全部 11 項已決定。每一項的理由與可驗證 gate 寫在對應章節，本表是索引。

| # | 決策 | 結論 | 理由摘要 | Gate 位置 |
|---|---|---|---|---|
| D1 | Tutorial 在 Phase 3 壞掉怎麼處理 | **T1** — Phase 3 同時交付 tutorial anchor 契約 | T2 讓舊 shell 活到 Phase 11，正是 Decision D 要避免的「接兩次 UI」；T3 成本不低卻放棄八個 phase 的 oracle | §36.1 / §36.2 / §36.3 |
| D2 | Router | **A** — 不引入 router，state + 極薄 history wrapper | 避免 Phase 3 同時扛新 shell、anchor 契約、router 三個風險 | §31.0（含靜態託管約束） |
| D3 | Node 版本 | **升 Node 22 LTS** | tutorial runner 用 tsx 實際執行 Pi 程式碼路徑，「只用到 bundler」的風險接受理由不成立 | §4.0.1 |
| D4 | MCP schema 轉不動時的降級 | **S1** — 排除該 tool 並在 UI 可見 | S2 讓模型無提示呼叫有副作用的遠端 tool；S3 依賴未驗證假設 | §43.1 / §43.1.1 |
| D5 | 未完成 tool call 的還原政策 | **P1** — 補 `outcome_unknown` 後 `continue()` | 唯一不製造「無紀錄 side effect」的選項，且沿用已定義的 §46.1 語意 | §52.4 / §52.4.1 |
| D6 | Session 落地是否加密 | **選項 1** — 本機明碼 + UI 告知 + 可清除；credential redaction 為 hard gate | AGENTS.md 已警告半套加密比不加密更糟；完整加密另案 | §79.1 / §79.2 |
| D7 | 歷史對話遷移深度 | **純文字唯讀遷移** | 舊 `ChatMessage` 無 `toolCallId`，重建的 transcript 無法在遷移前驗證 | §102.3 / §102.3.1 |
| D8 | tutorial 9 去留 | **A** — 隨 legacy 刪除，先補 Pi native tool-call conformance | B 等於為保住一個測試而保留整條 legacy transport | §64.1 / §64.1.1 |
| D9 | LB streaming spike 何時做 | **Phase 2（PR 2S），與 PR 2 並行、閘控其 merge** | Phase 3–8 全部建立在 `PiAgentRuntime` 介面上，介面若要改必須在此之前發現 | §56.3 / §56.3.1 |
| D10 | Real tutorial gate 分佈 | **依功能成熟度分層**（A 專屬 PoC gate；B 核心；C/D 當時已遷移且相容者；E 完整套件） | 跑尚未遷移功能的案例只會訓練團隊忽略紅燈 | §64.3 |
| D11 | upstream skill 模型是否沿用 | **保留既有 artifact 格式與儲存；只用 AgentTool lifecycle 與 `addedToolNames`** | skill 是使用者資產，換格式等於再做一次資料遷移；真正無可取代的是 tool 可見性語意 | §50.1 / §50.1.1 |

### 103.0 決策的連動關係

有三組決策彼此相依，改動其中一項時必須一併重新檢視：

```text
D1（T1 anchor 契約）
  └── 依賴 D2（不引入 router，anchor 才只需對應 pane 而非 route）
  └── 依賴 §37.1.3（historyMessageLimit 保留，兩個 tutorial 才會過）

D5（P1 補 outcome_unknown）
  └── 共用 §46.1 的 outcome 對應與 §47.1 的測試基礎建設
  └── 被 §52.5.2 的分頁關閉情境引用

D9（Phase 2 spike）
  └── 若 Q1 結論為否 → §20 的 PiAgentRuntime 介面要改 → PR 2 不得合併
      → 連帶影響 D1 的 Phase 3 排程
```

### 103.1 已升級為明確 phase scope 的項目

以下三項原本列在「尚未涵蓋」，現已具備 scope 與 gate：

| 項目 | 歸屬 | 章節 |
|---|---|---|
| Context / compaction ownership | Phase 4 | §37.1（含 `historyMessageLimit` 保留要求與 compaction 交互風險） |
| Token / 成本會計 | Phase 9 | §58.2（Pi usage 為唯一真實來源，failover 計費歸屬） |
| 多分頁併發 | Phase 8 | §52.5（單一 writer，Web Locks 優先） |

### 103.2 仍未涵蓋（後續 enhancement，不阻擋 v2）

誠實列出，避免被當成已解決：

- **錯誤訊息在地化。** 現有 UI 是繁中；Pi 的錯誤文字是英文，且會進 transcript。第一版接受混語，之後再處理。影響體驗，不影響正確性。
- ~~**時程與人力估計。**~~ 已升級為 **§6.5 的 Phase 0 sizing gate**（含要填的表、審閱者初估、依賴鏈與 Go/No-Go 判準）。這是 Phase 1 的前置閘門 G0。
- **Pi 版本升級策略。** §4 pin 死了 0.84.4，但沒有說之後怎麼跟上 upstream。建議 migration 期間完全不升版，Phase 13 之後再定期升級流程（升版時 §4.1 的 F1–F16 與 §52.3 的 conformance 是現成的回歸檢查）。
- **Computer Mode 的一切**（Phase 14，本來就是 optional）。

---

## 104. 第二次審閱紀錄（2026-09-01）

雙方各自完整重讀本計畫後獨立提出質疑，逐項討論並將結論寫入對應章節。本節只記錄索引與結論，不重複內文。

### 104.1 Claude 提出（Q1–Q6）

| # | 質疑 | 結論 | 落點 |
|---|---|---|---|
| Q1 | §20 的 `PiAgentRuntime` 沒有核准／問答 API；§28 的單一輸入投影鏈產生不出 `blocked`（§4.1 F5 顯示 Pi 沒有 approval 事件） | 接受。補顯式 API；投影改為雙輸入；`blocked`/`attention`/`unseen` 明確歸 AgentGoRound | §20.1、§20.2、§28.1、§77 |
| Q2 | `blocked` 的人類等待時間與 `ExecutionDeadline`（實測預設 5 分鐘）衝突，attention 模型會失效 | 接受。分離 agent-active clock 與 wall-clock；deadline 在 blocked 暫停；approval 另有以小時計的逾時，逾時結果為 `rejected` | §81.1、§52.4.1、§52.5.1、§56.2 Q2 |
| Q3 | Rollback 只保護 IndexedDB；`readJsonStorage` 驗證失敗會回傳 `defaultValue`，`agr_agents_v1` 會被靜默歸零 | 接受。forward-compat 規則擴及所有 `agr_*` key；新欄位走新 key；`__backup_*` 要有出口 | §101.5 |
| Q4 | 兩個 workflow 同時對 main 部署，production 管線不明；且沒有 staging | 接受。PR 0 收斂成一條管線並記錄；PR 3a 前提供預覽環境 | §101.6 |
| Q5 | MAGI 目前就是 `Promise.all` 並發（`magi.ts:216`），§52.5 / §58 / §63 都照單一 agent 寫 | 接受。鎖允許同分頁多 session；LB 補並發驗收與 429 退避；`piAgentRegistry` 補 group abort | §63.1、§52.5、§58 |
| Q6 | Bundle 預算與 real tutorial gate 沒有執行機制，在自動部署的 repo 裡等於不存在 | 接受。bundle 預算變 CI job ＋ committed 預算檔；real gate 結果 commit 到 `docs/gates/` 並作為 merge 條件 | §64.4 |

### 104.2 Codex 提出（C1–C4）

| # | 質疑 | 結論 | 落點 |
|---|---|---|---|
| C1 | `historyMessageLimit` 若取最後 N 則，會產生孤兒 tool result 或無結果的 tool call；compaction 也不得摘要未完成的 tool interaction | 接受，並強化為「回歸風險」：legacy `contextProjector.ts` 已實作原子配對與 fail-closed。定義 protocol unit（U1–U4），N 以 unit 計，upstream compaction 需實測不可假設 | §37.2 |
| C2 | v1 沒有 agentId，D7 的唯讀存檔歸屬未定，不能讓實作者任選 active agent | 接受，並在三個選項中明確選定**獨立 archive container**（`agentId: null`），拒絕 synthetic agent（會污染 agent rail、attention 排序、MAGI 成員與 deep link） | §102.4 |
| C3 | redaction 只說剔除 token/header，缺資料分類與 transformation 契約；字串掃描會漏掉、誤刪或漏路徑；「拒絕寫入」會癱瘓持久化 | 接受，並**修正本計畫先前的寫法**：改為 provenance-based 分類 ＋ 敏感欄位 registry ＋ allowlist 序列化 ＋ 單一 redactor 覆蓋所有 persistence/export 路徑；失敗改為欄位級 fail-closed，不中斷整個 session | §79.2 |
| C4 | 需定義 build/version 相容：warm-cache 分頁在 hard reload 時如何偵測 asset 版本不符並顯示可恢復狀態 | 接受。注入 `__APP_BUILD_ID__` ＋ 不帶 hash 的 `version.json`；監聽 `vite:preloadError`；演練必須涵蓋 warm cache | §101.7、§101.3 |

### 104.3 本輪的交叉影響

三組質疑其實指向同一個根因，改動時要一起看：

```text
Q1（沒有核准 API）
  └─ Q2（核准會等很久）
      ├─ §52.4.1  awaiting_approval ≠ dispatched
      ├─ §52.5    blocked 期間的鎖
      └─ §56.2 Q2 deadline 要能暫停
  → 三者都必須在 PR 2S 一併定案，不能留給 PR 3

Q3 + Q4 + C4
  → 共同構成「rollback 實際上能不能執行」
  → §101.3 的演練腳本要同時涵蓋 localStorage、管線、warm cache

C1 + C2 + C3
  → 共同構成「資料正確性」：送出去的 transcript 合法、
     遷移的歸屬可重現、落地的內容不含 secret 也不被誤刪
```

### 104.4 對 §0.1 閘門的影響

**G1 的範圍擴大。** PR 2S 原本只驗 LB streaming 的 Q1/Q2/Q3，現在必須一併定案 §20.1 的核准 API 與 §81.1 的時鐘語意——因為兩者都會改變 `PiAgentRuntime` 的介面形狀，而那是 Phase 3–8 的地基。

**新增 G4。** §101.3 的 rollback 演練必須同時涵蓋 §101.5（localStorage）、§101.6（單一管線）與 §101.7（warm cache）；三者任一未驗，Milestone B 不得結案。
