# AgentGoRound

**AgentGoRound** is a **browser-first agent playground** where multiple AI agents “go round”, collaborate, and solve tasks through simple orchestration patterns — **normal talking** and **goal-driven talking**.

This repository contains a working MVP built with **Vite + React + TypeScript**, designed to be deployed to **GitHub Pages**.

## Features (MVP)

- **Agent management**
  - Add / edit / delete agents
  - Upload agent profile photos for lists, settings, and chat messages
  - Edit agent settings inside a modal, with detect results shown in a separate modal
  - Built-in adapters:
    - `chrome_prompt` (Chrome built-in AI / Prompt API)
    - `openai_compat` (OpenAI-compatible `/v1/chat/completions` streaming)
    - `custom` (manual mapping: body template + response JSONPath)
  - OpenAI-compatible endpoint presets for OpenAI and Groq
  - **Auto-detect** for OpenAI-compatible endpoints via `GET /v1/models`
  - Load active OpenAI-compatible models from `GET /models`, then choose from a dropdown or switch to custom model input
  - Per-agent access control for docs, MCP servers, the built-in `user info` tool, and custom browser-side JS tools

- **Chat with history**
  - Frontend stores and injects history; adapters translate it into provider-specific formats.
  - Control how many recent messages are sent back to the model (default: 10)
  - Persist the current conversation in IndexedDB so reloading the page can continue the same chat
  - Import raw history or compressed carry-over summaries to continue a previous conversation
  - Export raw history or ask the active model to generate a compressed summary export

- **Docs (local)**
  - Simple plaintext document vault backed by **IndexedDB**
  - Allowed docs for the active agent are injected into the system context (MVP)

### Docs usage and testing

- In `normal talking`, allowed docs are assembled in `src/app/App.tsx` and injected as extra system context before the model request is sent through `src/orchestrators/oneToOne.ts` and the active adapter such as `src/adapters/openaiCompat.ts`.
- This means docs are not retrieved by a separate vector search step. They are appended directly into the prompt for the currently active agent.

How to test docs locally:

1. Start the app with `bash run.sh -dev`.
2. Open `Chat Config` and create a doc in the `Docs` panel.
3. Put obvious test content in the doc, for example `彩蛋碼是 42`.
4. In `Agents`, make sure the current agent is allowed to access that doc.
5. Go back to `Chat`, keep mode on `normal talking`, and ask something like `根據文件，彩蛋碼是多少？`
6. If docs are working, the model should answer using the doc content.

### Built-in tools usage and testing

- Custom built-in tools are defined in `Chat Config -> Built-in Tools` and stored locally in `src/storage/builtInToolStore.ts`.
- Tool code runs in the browser through `src/utils/runBuiltInScriptTool.ts`, and both the editor test button and the actual agent flow use the same execution path.
- During `normal talking`, the active tool-decision prompt can ask the model to return:

```json
{"type":"builtin_tool_call","tool":"your_tool_name","input":{}}
```

- The app executes the JavaScript, captures the returned value, and injects that result back into the user question before the final answer is generated.

How to test built-in tools locally:

1. Open `Chat Config -> Built-in Tools`.
2. Create a tool with a unique name and a clear description.
3. Write JavaScript that returns a value, for example:
   ```js
   const joke = "冷知識：CSS 最會的不是排版，是讓人懷疑人生。";
   alert(joke);
   return {
     joke,
     source: "built-in tool"
   };
   ```
4. Click `Test Tool` to execute the current code directly in the browser.
5. In `Agents`, allow the target agent to use that custom JS tool.
6. Go back to `Chat` and ask something that should cause the model to choose the tool.

- **MCP (SSE)**
  - Connect to MCP servers via **SSE**
  - Rename MCP servers for easier identification
  - List tools and call tools (client expects an accompanying POST RPC endpoint — see below)
  - Configure a `Tool Decision Prompt` with Chinese and English templates while keeping JSON schema examples in English

- **Built-in tools**
  - Agents can optionally use a local `user info` tool to read the current profile name, self-description, and whether a profile photo is configured
  - Create custom browser-side JavaScript tools in `Chat Config -> Built-in Tools`
  - Each custom tool includes `name`, `description`, optional `input schema`, and JavaScript code
  - Test custom tool code directly in the editor before letting agents use it
  - Built-in tools are enabled per-agent from the `Agents` tab and documented with dedicated help modals

- **Orchestration modes**
  - `normal talking`
  - `goal-driven talking` (leader plans tasks → dispatches to workers → leader synthesizes)
- **Polished dark UI**
  - Consistent card, button, and input styling with subtle gradients and shadows
  - Tabs (Chat / Chat Config / Agents / Profile) in a framed bar with clearer active state
  - Social-style chat bubbles with speaker names, timestamps, and avatars for multi-agent conversations
  - MCP tool results in normal talking can be expanded under the final assistant reply instead of occupying a separate bubble
  - Assistant replies that contain `<think>...</think>` render the visible answer normally and expose the thinking block through a collapsible section
  - Mobile chat layout keeps desktop styling intact while improving small-screen controls, spacing, and horizontal action scrolling

- **Resource and settings hub**
  - `Chat Config` centralizes active agent, chat mode, history window, retry policy, docs, MCP, built-in tools, and future skills
  - Includes a reserved `Skills` section for upcoming configuration work
  - Docs and MCP panels include centered help modals mounted above the page, dim the rest of the layout, and close with `Close` or `Esc`

- **Profile settings**
  - Set your own character name, self-description, and profile photo from the dedicated `Profile` tab

- **Chat controls**
  - `Alt+Enter` sends the message
  - Clear chat button resets the current conversation
  - Full-page chat mode opens the conversation in a large modal focused on messages, input, send, and exit controls
  - New messages and local typing keep the chat view pinned to the latest entry

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
4) You can manually call a tool in the panel and configure the `Tool Decision Prompt` template used before automatic tool selection.
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

Custom built-in tools execute user-provided JavaScript in the same browser context as the app. There is no sandbox yet, so only run code you trust.

## Known issues (current review)

- MCP SSE clients are created per list/call and never closed (`src/ui/McpPanel.tsx`, `src/app/App.tsx`), so repeated tool use can leak browser EventSource connections.
- The sample MCP server lacks request validation and will throw on malformed JSON or missing fields (`mcp-test/server.js`); add guards before reading `req.body.id/method`.

## Repo structure

```
src/
  adapters/        # Provider adapters (Chrome Prompt API, OpenAI-compatible, Custom)
  orchestrators/   # Collaboration patterns (normal talking, goal-driven talking)
  mcp/             # MCP SSE client + tool registry
  storage/         # agent/settings (localStorage) + docs/chat history (IndexedDB)
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
