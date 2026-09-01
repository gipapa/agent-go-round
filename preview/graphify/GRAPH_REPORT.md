# Graph Report - AgentGoRound Concept Corpus  (2026-04-08)

## Corpus Check
- Concept-first curated corpus; the graph is meant to expose cross-feature links, not just compress a large raw corpus.

## Summary
- 32 nodes · 55 edges · 5 communities detected
- Extraction: 89% EXTRACTED · 11% INFERRED · 0% AMBIGUOUS · INFERRED: 6 edges (avg confidence: 0.68)
- Token cost: 0 input · 0 output

## God Nodes (most connected - your core abstractions)
1. `AgentGoRound` - 10 edges
2. `Browser Workflow Skill` - 6 edges
3. `Tutorial Scenarios` - 6 edges
4. `MAGI Mode` - 6 edges
5. `MCP Integration` - 5 edges
6. `Multi-turn Skill Runtime` - 5 edges
7. `Case 6 GitHub Trending Tutorial` - 5 edges
8. `Graphify Concept Graph` - 5 edges

## Surprising Connections (you probably didn't know these)
- `Load Balancer` --conceptually_related_to--> `Skills`  [INFERRED]
  src/utils/loadBalancer.ts -> README.md
- `AgentGoRound` --conceptually_related_to--> `MCP Integration`  [EXTRACTED]
  README.md -> src/ui/McpPanel.tsx
- `AgentGoRound` --conceptually_related_to--> `Built-in Tools`  [EXTRACTED]
  README.md -> src/ui/BuiltInToolsPanel.tsx
- `AgentGoRound` --conceptually_related_to--> `Tutorial Scenarios`  [EXTRACTED]
  README.md -> src/onboarding/catalog.ts
- `AgentGoRound` --conceptually_related_to--> `MAGI Mode`  [EXTRACTED]
  README.md -> src/orchestrators/magi.ts
- `MCP Integration` --references--> `Vendored agent-browser`  [EXTRACTED]
  src/ui/McpPanel.tsx -> mcp-test/agent-browser-sse/vendor/agent-browser/README.md
- `Render Anything Pattern` --semantically_similar_to--> `Graphify Concept Graph`  [INFERRED] [semantically similar]
  render_anything.md -> src/graphify/corpus/06-visualization-and-rendering.md
- `Multi-turn Skill Runtime` --references--> `Browser Observation Digest`  [EXTRACTED]
  agentic.md -> src/runtime/browserObservation.ts

## Hyperedges (group relationships)
- **Core Product Surface** — agent_workspace, docs_context, mcp_integration, built_in_tools, skills, tutorials [EXTRACTED 1.00]
- **Agent Execution Stack** — agent_workspace, load_balancer, credential_pool, skills [EXTRACTED 1.00]
- **Browser Automation Loop** — mcp_integration, browser_workflow, multi_turn_runtime, browser_observation, case6 [EXTRACTED 1.00]

## Communities

### Community 0 - "Browser Automation"
Cohesion: 0.38
Nodes (10): Browser Observation Digest, Browser Workflow Skill, Case 5 Browser MCP Tutorial, Case 6 GitHub Trending Tutorial, MCP Integration, Multi-turn Skill Runtime, Skill Runtime Design Draft, Tutorial Runtime (+2 more)

### Community 1 - "Tooling & Visualization"
Cohesion: 0.38
Nodes (7): Built-in Tools, Concept-first graph avoids vendor noise and code-only bias, Dashboard Helper, Graphify Concept Graph, Intro Guide, Landing Page, Render Anything Pattern

### Community 2 - "Product Narrative"
Cohesion: 0.47
Nodes (6): Browser-first Frontend-only Playground, Docs Context, GitHub Pages Deployment, Local-first experimentation without mandatory backend, AgentGoRound, Skills

### Community 3 - "Magi Deliberation"
Cohesion: 0.6
Nodes (5): Controlled access avoids agent behavior drift, Magi Consensus, MAGI Mode, Magi Skills, Magi Vote

### Community 4 - "Agent Configuration"
Cohesion: 0.67
Nodes (4): Agent Workspace, App.tsx Shell, Credential Pool, Load Balancer

## Knowledge Gaps
- **3 isolated node(s):** `Local-first experimentation without mandatory backend`, `Controlled access avoids agent behavior drift`, `Concept-first graph avoids vendor noise and code-only bias`
  These have ≤1 connection - possible missing edges or undocumented components.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `AgentGoRound` connect `Product Narrative` to `Browser Automation`, `Tooling & Visualization`, `Magi Deliberation`, `Agent Configuration`?**
  _High betweenness centrality (0.614) - this node is a cross-community bridge._
- **Why does `MAGI Mode` connect `Magi Deliberation` to `Product Narrative`, `Agent Configuration`?**
  _High betweenness centrality (0.251) - this node is a cross-community bridge._
- **Why does `Tutorial Scenarios` connect `Browser Automation` to `Tooling & Visualization`, `Product Narrative`?**
  _High betweenness centrality (0.175) - this node is a cross-community bridge._
- **Are the 2 inferred relationships involving `Browser Workflow Skill` (e.g. with `Case 5 Browser MCP Tutorial` and `Vendored agent-browser`) actually correct?**
  _`Browser Workflow Skill` has 2 INFERRED edges - model-reasoned connections that need verification._
- **What connects `Local-first experimentation without mandatory backend`, `Controlled access avoids agent behavior drift`, `Concept-first graph avoids vendor noise and code-only bias` to the rest of the system?**
  _3 weakly-connected nodes found - possible documentation gaps or missing edges._