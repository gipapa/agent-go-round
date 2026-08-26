import { describe, expect, it } from "vitest";
import { filterAgentHarnessCapabilities } from "../runtime/harness/agentScope";
import type { AgentConfig, BuiltInToolConfig, McpServerConfig } from "../types";

const builtin = (id: string): BuiltInToolConfig => ({
  id,
  name: id,
  description: id,
  code: "return null;",
  inputSchema: { type: "object" },
  updatedAt: 0
});

const mcpServer = (id: string): McpServerConfig => ({
  id,
  name: id,
  sseUrl: `https://example.com/${id}`
});

describe("agent harness capability scope", () => {
  it("applies category switches, allowlists, and server existence before catalog creation", () => {
    const allowedServer = mcpServer("allowed-server");
    const blockedServer = mcpServer("blocked-server");
    const scoped = filterAgentHarnessCapabilities({
      agent: {
        id: "agent",
        name: "Agent",
        type: "custom",
        enableBuiltInTools: true,
        enableMcp: true,
        allowedBuiltInToolIds: ["allowed-builtin"],
        allowedMcpServerIds: ["allowed-server"]
      },
      builtins: [builtin("allowed-builtin"), builtin("blocked-builtin")],
      mcpServers: [allowedServer, blockedServer],
      mcpTools: [
        { server: allowedServer, tools: [{ name: "search", inputSchema: { type: "object" } }] },
        { server: blockedServer, tools: [{ name: "delete", inputSchema: { type: "object" } }] },
        { server: mcpServer("orphan-server"), tools: [{ name: "orphan", inputSchema: { type: "object" } }] }
      ]
    });
    expect(scoped.builtins.map((tool) => tool.id)).toEqual(["allowed-builtin"]);
    expect(scoped.mcpServers.map((server) => server.id)).toEqual(["allowed-server"]);
    expect(scoped.mcpTools.map(({ server }) => server.id)).toEqual(["allowed-server"]);
  });

  it("freezes the run containers and isolates them from source mutations", () => {
    const sourceBuiltin = builtin("source-builtin");
    const sourceServer = mcpServer("source-server");
    const scoped = filterAgentHarnessCapabilities({
      agent: { id: "agent", name: "Agent", type: "custom" },
      builtins: [sourceBuiltin],
      mcpServers: [sourceServer],
      mcpTools: [{ server: sourceServer, tools: [{ name: "search", inputSchema: { type: "object" } }] }]
    });

    expect(Object.isFrozen(scoped.builtins)).toBe(true);
    expect(Object.isFrozen(scoped.mcpServers)).toBe(true);
    expect(Object.isFrozen(scoped.mcpTools)).toBe(true);
    sourceBuiltin.description = "mutated after snapshot";
    sourceServer.name = "mutated after snapshot";
    expect(scoped.builtins[0].description).toBe("source-builtin");
    expect(scoped.mcpServers[0].name).toBe("source-server");
    expect(scoped.mcpTools[0].server.name).toBe("source-server");
  });

  it("fails closed for malformed persisted allowlists while preserving default-on categories", () => {
    const scoped = filterAgentHarnessCapabilities({
      agent: {
        id: "agent",
        name: "Agent",
        type: "custom",
        allowedBuiltInToolIds: ["valid", 42] as never,
        allowedMcpServerIds: "not-an-array" as never
      },
      builtins: [builtin("valid")],
      mcpServers: [mcpServer("server")],
      mcpTools: [{ server: mcpServer("server"), tools: [] }]
    });
    expect(scoped.builtins).toEqual([]);
    expect(scoped.mcpServers).toEqual([]);
    expect(scoped.mcpTools).toEqual([]);
  });

  it("disables both external capability categories explicitly", () => {
    const server = mcpServer("server");
    const scoped = filterAgentHarnessCapabilities({
      agent: { id: "agent", name: "Agent", type: "custom", enableBuiltInTools: false, enableMcp: false },
      builtins: [builtin("tool")],
      mcpServers: [server],
      mcpTools: [{ server, tools: [{ name: "search", inputSchema: { type: "object" } }] }]
    });
    expect(scoped).toEqual({ builtins: [], mcpServers: [], mcpTools: [] });
    expect(Object.isFrozen(scoped.builtins)).toBe(true);
    expect(Object.isFrozen(scoped.mcpServers)).toBe(true);
    expect(Object.isFrozen(scoped.mcpTools)).toBe(true);
  });
});
