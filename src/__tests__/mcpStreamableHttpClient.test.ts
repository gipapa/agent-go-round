import { afterEach, describe, expect, it, vi } from "vitest";
import { McpStreamableHttpClient } from "../mcp/streamableHttpClient";

function requestBody(init?: RequestInit) {
  return JSON.parse(String(init?.body ?? "{}")) as {
    id?: string;
    method: string;
    params?: Record<string, unknown>;
  };
}

describe("McpStreamableHttpClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("initializes before listing tools and carries auth, protocol, and session headers", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = requestBody(init);
      if (body.method === "initialize") {
        return new Response(
          `event: message\ndata: ${JSON.stringify({
            jsonrpc: "2.0",
            id: body.id,
            result: { protocolVersion: "2025-11-25", capabilities: {}, serverInfo: { name: "test", version: "1" } }
          })}\n\n`,
          { status: 200, headers: { "Content-Type": "text/event-stream", "Mcp-Session-Id": "session-1" } }
        );
      }
      if (body.method === "notifications/initialized") return new Response("", { status: 202 });
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { tools: [{ name: "search" }] } }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new McpStreamableHttpClient({
      id: "remote-1",
      name: "Remote",
      sseUrl: "https://example.com/mcp",
      transport: "streamable_http",
      authToken: "secret"
    });
    client.connect();

    const response = await client.request("tools/list");

    expect(response.result).toEqual({ tools: [{ name: "search" }] });
    expect(fetchMock.mock.calls.map((call) => requestBody(call[1]).method)).toEqual([
      "initialize",
      "notifications/initialized",
      "tools/list"
    ]);
    const initializeHeaders = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    const listHeaders = new Headers(fetchMock.mock.calls[2]?.[1]?.headers);
    expect(initializeHeaders.get("Authorization")).toBe("Bearer secret");
    expect(initializeHeaders.has("MCP-Protocol-Version")).toBe(false);
    expect(listHeaders.get("MCP-Protocol-Version")).toBe("2025-11-25");
    expect(listHeaders.get("MCP-Session-Id")).toBe("session-1");
  });

  it("maps the legacy input field to standard MCP tool arguments and can use the local relay", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = requestBody(init);
      if (body.method === "initialize") {
        return new Response(JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: { protocolVersion: "2025-11-25", capabilities: {}, serverInfo: { name: "test", version: "1" } }
        }));
      }
      if (body.method === "notifications/initialized") return new Response("", { status: 202 });
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { content: [{ type: "text", text: "ok" }] } }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new McpStreamableHttpClient({
      id: "remote-1",
      name: "Remote",
      sseUrl: "https://example.com/mcp",
      transport: "streamable_http",
      useLocalProxy: true
    });
    const response = await client.request("tools/call", { name: "search", input: { query: "MCP" } });

    expect(response.error).toBeUndefined();
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "/__agr_mcp_proxy?url=https%3A%2F%2Fexample.com%2Fmcp"
    );
    expect(requestBody(fetchMock.mock.calls[2]?.[1]).params).toEqual({
      name: "search",
      arguments: { query: "MCP" }
    });
  });
});
