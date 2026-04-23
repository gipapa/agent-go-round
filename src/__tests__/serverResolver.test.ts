import { describe, expect, it } from "vitest";
import { resolveMcpServerId } from "../mcp/serverResolver";
import type { McpServerConfig, McpTool } from "../types";

function server(id: string, name: string): McpServerConfig {
  return {
    id,
    name,
    sseUrl: `https://example.com/${id}/sse`
  };
}

function tool(name: string): McpTool {
  return { name };
}

const browserServer = server("browser-1", "Browser MCP");
const backupBrowserServer = server("browser-2", "Backup Browser MCP");
const timeServer = server("time-1", "Time MCP");

const catalog = [
  { server: browserServer, tools: [tool("browser_open"), tool("browser_snapshot")] },
  { server: backupBrowserServer, tools: [tool("browser_open")] },
  { server: timeServer, tools: [tool("time_now")] }
];

describe("resolveMcpServerId", () => {
  it("matches an exact server id", () => {
    expect(
      resolveMcpServerId({
        requestedServerId: "browser-1",
        toolName: "browser_open",
        availableMcpTools: catalog
      })
    ).toEqual({ ok: true, serverId: "browser-1", matchedBy: "exact-id" });
  });

  it("matches an exact server name", () => {
    expect(
      resolveMcpServerId({
        requestedServerId: "Browser MCP",
        toolName: "browser_open",
        availableMcpTools: catalog
      })
    ).toEqual({ ok: true, serverId: "browser-1", matchedBy: "exact-name" });
  });

  it("matches server id or name case-insensitively as fuzzy", () => {
    expect(
      resolveMcpServerId({
        requestedServerId: "browser mcp",
        toolName: "browser_snapshot",
        availableMcpTools: catalog
      })
    ).toEqual({ ok: true, serverId: "browser-1", matchedBy: "fuzzy" });
  });

  it("falls back to the only server exposing the requested tool", () => {
    expect(
      resolveMcpServerId({
        requestedServerId: null,
        toolName: "time_now",
        availableMcpTools: catalog
      })
    ).toEqual({ ok: true, serverId: "time-1", matchedBy: "single-tool-match" });
  });

  it("does not guess when multiple servers expose the same tool", () => {
    const resolution = resolveMcpServerId({
      requestedServerId: null,
      toolName: "browser_open",
      availableMcpTools: catalog
    });

    expect(resolution.ok).toBe(false);
    if (!resolution.ok) {
      expect(resolution.reason).toBe("ambiguous");
      expect(resolution.candidates).toEqual(["Browser MCP (browser-1)", "Backup Browser MCP (browser-2)"]);
    }
  });

  it("does not return a garbage server id when no route is available", () => {
    expect(
      resolveMcpServerId({
        requestedServerId: "not-real",
        toolName: "missing_tool",
        availableMcpTools: catalog
      })
    ).toEqual({
      ok: false,
      reason: "no-match",
      candidates: ["Browser MCP (browser-1)", "Backup Browser MCP (browser-2)", "Time MCP (time-1)"]
    });
  });
});
