# AgentGoRound v2：Browser-Native Pi + Herdr-like UI 完整遷移計畫

> 日期：2026-09-01  
> 狀態：Proposed  
> 目標：將 AgentGoRound 從自製 Pi-style harness 遷移為「真正的 Pi Agent Core 直接在 Browser JavaScript 執行」，同時將 UI 重構為 Herdr-like、agent/workspace-centric 的操作介面。
>
> 最重要的原則：
>
> **先做 PoC 證明 Pi-in-Browser 可行 → 建立正式 Pi Runtime Foundation → 立即建立 Herdr-like UI Shell → 再將 Docs / MCP / Built-ins / Skills / Persistence / LB / Voice / MAGI 一一遷移到 Pi。**
>
> **WebContainer 不屬於第一階段。** 未來若加入 Computer Mode，WebContainer 只作為 Pi tools 的 execution substrate，而不是 Pi Agent Core 的宿主。

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

原因：

- Pi core 本身已可作為可嵌入 Agent runtime 使用。
- Core 的 Node SQLite backend 已拆成獨立 package。
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
  "@earendil-works/pi-agent-core": "0.84.4",
  "@earendil-works/pi-ai": "0.84.4"
}
```

不要 PoC 一開始使用：

```json
"^0.84.4"
```

Pi 目前仍在快速迭代。

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

但 0.80.0 已移除。

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

並保存：

- test count
- tutorial gates
- production build artifacts
- Chrome smoke test
- mobile smoke test

### 6.4 禁止同時大改舊 runtime

這一階段不要：

- 重做 contextProjector
- 擴充 custom canonical protocol
- 加新的 planner
- 加新的 legacy transport
- 加新的 legacy skill action semantics

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
- [ ] legacy engine 也可以 temporary project into same UI，若 migration 需要

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

## 43. MCP JSON Schema Normalization

正式建立：

```text
normalizeMcpSchemaToPiSchema()
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

Host-side validation 繼續保留。

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

## 64. Phase 12 — Tutorial / Regression

Tutorial 要變成 final migration gate。

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

### PR 0

```text
chore: freeze legacy runtime and capture baseline
```

### PR 1

```text
spike: prove upstream Pi runs directly in browser
```

### PR 2

```text
feat(pi): add production Pi runtime foundation
```

### PR 3

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
