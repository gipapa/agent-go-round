import { describe, expect, it } from "vitest";
import {
  extractFirstUrl,
  inferExplicitToolDecision,
  normalizeToolDecisionAgainstAvailableTools,
  parseToolDecision,
  resolvePreferredBrowserHeadedMode
} from "../runtime/toolDecision";
import type { BuiltInToolConfig, McpServerConfig, McpTool } from "../types";

function server(id: string, name = id): McpServerConfig {
  return { id, name, sseUrl: `https://example.com/${id}/mcp` };
}

function tool(name: string): McpTool {
  return { name };
}

function builtIn(name: string): BuiltInToolConfig {
  return {
    id: `builtin:${name}`,
    name,
    description: `${name} description`,
    code: "return input;",
    updatedAt: 0
  };
}

const browserServer = server("browser-1", "Browser");
const browserCatalog = [
  { server: browserServer, tools: [tool("browser_open"), tool("browser_snapshot")] }
];

describe("tool decision runtime", () => {
  it("parses structured and plain-text tool decisions", () => {
    expect(parseToolDecision('{"type":"builtin_tool_call","tool":"clock","input":{}}')).toEqual({
      type: "builtin_tool_call",
      tool: "clock",
      input: {}
    });
    expect(parseToolDecision("visit('https://example.com/path')")).toEqual({
      type: "mcp_call",
      serverId: "",
      tool: "visit",
      input: { url: "https://example.com/path" }
    });
    expect(parseToolDecision("NO_TOOL")).toEqual({ type: "no_tool" });
  });

  it("normalizes browser aliases and resolves the matching MCP server", () => {
    expect(
      normalizeToolDecisionAgainstAvailableTools({
        decision: { type: "mcp_call", serverId: "", tool: "visit", input: { url: "https://example.com" } },
        availableBuiltinTools: [],
        availableMcpServers: [browserServer],
        availableMcpTools: browserCatalog
      })
    ).toEqual({
      type: "mcp_call",
      serverId: "browser-1",
      tool: "browser_open",
      input: { url: "https://example.com" }
    });
  });

  it("corrects an MCP-shaped decision to a built-in tool when MCP cannot serve it", () => {
    expect(
      normalizeToolDecisionAgainstAvailableTools({
        decision: { type: "mcp_call", serverId: "missing", tool: "clock", input: { timezone: "UTC" } },
        availableBuiltinTools: [builtIn("clock")],
        availableMcpServers: [browserServer],
        availableMcpTools: browserCatalog
      })
    ).toEqual({ type: "builtin_tool_call", tool: "clock", input: { timezone: "UTC" } });
  });

  it("keeps an MCP decision when both MCP and built-in catalogs expose the tool", () => {
    const sharedServer = server("shared");
    expect(
      normalizeToolDecisionAgainstAvailableTools({
        decision: { type: "mcp_call", serverId: "shared", tool: "clock", input: {} },
        availableBuiltinTools: [builtIn("clock")],
        availableMcpServers: [sharedServer],
        availableMcpTools: [{ server: sharedServer, tools: [tool("clock")] }]
      })
    ).toEqual({ type: "mcp_call", serverId: "shared", tool: "clock", input: {} });
  });

  it("infers only explicit, available tool requests", () => {
    expect(
      inferExplicitToolDecision({
        input: "請明確使用 browser_open 開啟 https://example.com/page",
        availableBuiltinTools: [],
        availableMcpTools: browserCatalog
      })
    ).toEqual({
      type: "mcp_call",
      serverId: "browser-1",
      tool: "browser_open",
      input: { url: "https://example.com/page" }
    });
    expect(
      inferExplicitToolDecision({
        input: "browser_open https://example.com/page",
        availableBuiltinTools: [],
        availableMcpTools: browserCatalog
      })
    ).toBeNull();
  });

  it("extracts URLs and preserves the existing headed-mode preference rules", () => {
    expect(extractFirstUrl("open www.example.com/docs")).toBe("https://www.example.com/docs");
    expect(resolvePreferredBrowserHeadedMode("請使用可見瀏覽器")).toBe(true);
    expect(resolvePreferredBrowserHeadedMode("use a headless browser")).toBe(false);
    expect(resolvePreferredBrowserHeadedMode("use the browser")).toBe(false);
  });
});
