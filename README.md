# AgentGoRound

**AgentGoRound** is a **browser-first agent playground** where multiple AI agents “go round”, collaborate, and solve tasks through simple orchestration patterns — **normal talking** and **goal-driven talking**.

This repository contains a working MVP built with **Vite + React + TypeScript**, designed to be deployed to **GitHub Pages**.

## Features (MVP)

- **Agent management**
  - Add / edit / delete agents
  - Built-in adapters:
    - `chrome_prompt` (Chrome built-in AI / Prompt API)
    - `openai_compat` (OpenAI-compatible `/v1/chat/completions` streaming)
    - `custom` (manual mapping: body template + response JSONPath)
  - **Auto-detect** for OpenAI-compatible endpoints via `GET /v1/models`

- **Chat with history**
  - Frontend stores and injects history; adapters translate it into provider-specific formats.

- **Docs (local)**
  - Simple plaintext document vault backed by **IndexedDB**
  - Allowed docs for the active agent are injected into the system context (MVP)

- **MCP (SSE)**
  - Connect to MCP servers via **SSE**
  - Rename MCP servers for easier identification
  - List tools and call tools (client expects an accompanying POST RPC endpoint — see below)

- **Orchestration modes**
  - `normal talking`
  - `goal-driven talking` (leader plans tasks → dispatches to workers → leader synthesizes)

- **Chat controls**
  - `Alt+Enter` sends the message
  - Clear chat button resets the current conversation

## goal-driven talking (agent-to-agent coordination)

In **goal-driven talking** mode you explicitly configure:

1. **Leader agent**
2. **Member agents**

Then, in chat, your message is treated as a **GOAL**. The leader runs a controlled loop:

- Leader decides the next action (**ask one member**, or **finish**)
- The chosen member replies
- Leader updates progress and decides who to ask next
- Leader ends the session when the goal is achieved (or max rounds is reached)

Implementation detail: the leader is instructed to output a strict JSON action object:
- `{ "type": "ask_member", "memberId": "...", "message": "..." }`
- `{ "type": "finish", "answer": "..." }`

## Quick start

```bash
bash run.sh
```

During local dev the app is served from `/`. Production builds default to `/agent-go-round/` for GitHub Pages; override with `BASE_PATH` or `VITE_BASE_PATH` when deploying to a different subpath.

## Tests

Run the test suite:

```bash
npm test
```

This repo uses a versioned pre-push hook to run tests before pushing. If hooks are not active, enable them with:

```bash
git config core.hooksPath .githooks
```

## Deploy to GitHub Pages (two options)

### Option A: `gh-pages` script

1) Make sure your repo name is: **agent-go-round**  
2) In `vite.config.ts`, `repoName` should match the repo name.

Deploy:

```bash
npm run deploy
```

This builds to `dist/` and pushes it to the `gh-pages` branch.

### Option B: GitHub Actions (recommended)

Create `.github/workflows/pages.yml` (template included below), then enable Pages with “GitHub Actions” as the source.

## MCP over SSE notes (important)

This MVP uses `EventSource` for SSE. **EventSource cannot send custom headers.**  
If you need auth, prefer:
- Querystring token (e.g. `.../sse?token=...`), or
- Same-site cookies (host MCP and AgentGoRound on the same origin)

Also: SSE is **server → client** only. To send requests from client → server, the MVP expects an HTTP POST endpoint:

- SSE endpoint: `https://your-host/mcp/sse`
- RPC endpoint: `https://your-host/mcp/rpc` (derived by replacing `/sse` with `/rpc`)

The client sends JSON like:

```json
{ "id": "uuid", "method": "tools/list", "params": {} }
```

And expects either:
- An immediate JSON response to the POST, **or**
- A response later via SSE with the same `id`.

### MCP quickstart (local)

1) Run an MCP server that exposes:
   - SSE: `http://localhost:3333/mcp/sse`
   - RPC: `http://localhost:3333/mcp/rpc` (POST) implementing `tools/list` and `tools/call`
2) In the **MCP (SSE)** panel (right column), paste the SSE URL and click **Add**.
3) Click **Connect & List Tools**. The returned tools are saved for that server and shown in the panel.
4) You can manually call a tool in the panel; the active MCP server + its tool list are injected into the agent prompt so it can pick `mcp_call` actions.
5) You can edit the MCP server name in the MCP panel for easier identification.

#### Example MCP server (repo: `./mcp-test`)

- Location: `./mcp-test`
- Tools: `echo` (returns text) and `time` (returns current server time)
- Run it:
  ```bash
  cd mcp-test
  bash run.sh
  ```
- Endpoints exposed: `http://localhost:3333/mcp/sse` and `http://localhost:3333/mcp/rpc` (printed on startup with the tool list)

## Security

This MVP stores API keys in the browser (localStorage). Users can inspect the page and extract the key.
For production, use a small server-side proxy (or your own gateway) to protect secrets.

## Known issues (current review)

- MCP SSE clients are created per list/call and never closed (`src/ui/McpPanel.tsx`, `src/app/App.tsx`), so repeated tool use can leak browser EventSource connections.
- MCP tool routing ignores `serverId` provided by the model and always uses the active server (`src/app/App.tsx`), so multi-server setups cannot target a specific MCP server.
- The sample MCP server lacks request validation and will throw on malformed JSON or missing fields (`mcp-test/server.js`); add guards before reading `req.body.id/method`.

## Repo structure

```
src/
  adapters/        # Provider adapters (Chrome Prompt API, OpenAI-compatible, Custom)
  orchestrators/   # Collaboration patterns (normal talking, goal-driven talking)
  mcp/             # MCP SSE client + tool registry
  storage/         # agentStore (localStorage) + docStore (IndexedDB)
  ui/              # React panels
run.sh             # Install deps if needed and start the dev server
mcp-test/          # Example MCP server for local testing
  run.sh           # Install deps and start the MCP test server
  app/             # App shell
```

## GitHub Actions Pages workflow (copy/paste)

Create `.github/workflows/pages.yml`:

```yml
name: Deploy to GitHub Pages
on:
  push:
    branches: [ "main" ]

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: "pages"
  cancel-in-progress: true

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
      - run: npm ci
      - run: npm run build
      - uses: actions/upload-pages-artifact@v3
        with:
          path: dist

  deploy:
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    runs-on: ubuntu-latest
    needs: build
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

## License

MIT
