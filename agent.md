# Review notes
- `src/ui/McpPanel.tsx` and `src/orchestrators/goalDrivenTalk.ts` create new `McpSseClient` connections per call without closing them, so repeated tool use can leak SSE connections.
- `mcp-test/server.js` assumes `req.body` exists; malformed JSON or missing bodies will throw before any response is sent.

# Follow-ups
- Reuse or close `McpSseClient` instances after tool calls to avoid accumulating SSE connections.
- Add basic request validation to `mcp-test/server.js` (guard `req.body`, missing `id`, missing `method`).
