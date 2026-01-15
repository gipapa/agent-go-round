# Code review notes
- `src/ui/McpPanel.tsx` and `src/app/App.tsx`: new `McpSseClient` instances are created for every list/call and never closed, so repeated MCP usage can leave hanging SSE connections in the browser.
- `src/app/App.tsx`: MCP server selection ignores `serverId` supplied by the model—`targetServer` always resolves to the active server—so multi-server setups cannot route tool calls as requested.
- `mcp-test/server.js`: assumes a parsed JSON body; malformed or missing `body.id/method` will throw before a response is sent.

# Follow-ups
- Reuse or close `McpSseClient` instances after tool calls; consider a per-server singleton with explicit `.close()` on removal.
- Fix MCP tool routing to honor `serverId` (fall back to active server when absent).
- Add request validation to `mcp-test/server.js` to avoid crashing on bad input and to return structured errors.
