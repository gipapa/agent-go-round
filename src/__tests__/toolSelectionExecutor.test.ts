import { afterEach, describe, expect, it, vi } from "vitest";
import { McpClientManager, type McpClientLike } from "../mcp/clientManager";
import {
  createToolSelectionExecutor,
  type ToolSelectionArgs
} from "../runtime/toolSelectionExecutor";
import type { AgentConfig, BuiltInToolConfig, ChatMessage, McpServerConfig } from "../types";
import type { PendingLogEntry } from "../runtime/logging";

const agent: AgentConfig = {
  id: "agent-1",
  name: "Agent One",
  type: "openai_compat"
};

function builtInTool(patch: Partial<BuiltInToolConfig> = {}): BuiltInToolConfig {
  return {
    id: "echo",
    name: "echo",
    description: "Return the supplied value",
    code: "return { value: input.value };",
    updatedAt: 0,
    ...patch
  };
}

function server(patch: Partial<McpServerConfig> = {}): McpServerConfig {
  return {
    id: "mcp-1",
    name: "MCP One",
    sseUrl: "https://example.com/mcp/sse",
    ...patch
  };
}

function args(patch: Partial<ToolSelectionArgs>): ToolSelectionArgs {
  return {
    selection: { type: "builtin_tool_call", tool: "echo", input: { value: 2 } },
    input: "question",
    agent,
    availableBuiltinTools: [builtInTool()],
    availableMcpServers: [],
    availableMcpTools: [],
    promptDetail: "default",
    ...patch
  };
}

function setup(manager = new McpClientManager()) {
  const messages: ChatMessage[] = [];
  const logs: PendingLogEntry[] = [];
  const executor = createToolSelectionExecutor({
    appendMessage: (message) => messages.push(message),
    pushLog: (entry) => logs.push(entry),
    mcpClientManager: manager,
    getUserProfilePayload: () => ({ name: "Alice", description: "Tester", hasAvatar: false })
  });
  return { executor, messages, logs, manager };
}

describe("tool selection executor", () => {
  const managers: McpClientManager[] = [];

  afterEach(() => {
    managers.splice(0).forEach((manager) => manager.closeAll());
  });

  it("reports a missing built-in tool without executing code", async () => {
    const runtime = setup();
    managers.push(runtime.manager);

    const result = await runtime.executor(args({ availableBuiltinTools: [] }));

    expect(result).toMatchObject({ status: "tool_called", ok: false, toolLabel: "Built-in echo" });
    expect(result.detail).toContain("找不到名稱為 echo");
    expect(runtime.messages[0].content).toContain("找不到名稱為 echo");
    expect(runtime.logs[0]).toMatchObject({ category: "tool", ok: false, stage: "tool execution" });
  });

  it("honors confirmation requirements before running a built-in tool", async () => {
    const runtime = setup();
    managers.push(runtime.manager);
    const confirm = vi.fn(() => false);
    const executor = createToolSelectionExecutor({
      appendMessage: (message) => runtime.messages.push(message),
      pushLog: (entry) => runtime.logs.push(entry),
      mcpClientManager: runtime.manager,
      getUserProfilePayload: () => ({ name: "Alice", description: "Tester", hasAvatar: false }),
      confirm
    });

    const result = await executor(args({ availableBuiltinTools: [builtInTool({ requireConfirmation: true })] }));

    expect(confirm).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ status: "tool_called", ok: false });
    expect(result.detail).toContain("使用者阻止");
  });

  it("executes a built-in tool and returns prompt-ready output", async () => {
    const runtime = setup();
    managers.push(runtime.manager);

    const result = await runtime.executor(args({}));

    expect(result).toMatchObject({ status: "tool_called", ok: true, toolOutput: { value: 2 } });
    expect(result.input).toContain("請根據以下工具摘要完成回答");
    expect(result.input).toContain("value");
    expect(runtime.messages[0].content).toContain('"value": 2');
    expect(runtime.logs[0]).toMatchObject({ category: "tool", ok: true });
  });

  it("routes and executes an MCP tool", async () => {
    class FakeClient implements McpClientLike {
      connect() {}
      close() {}
      request = vi.fn(async () => ({ id: "fake", result: { content: "search result" } }));
    }

    const client = new FakeClient();
    const manager = new McpClientManager({ createClient: () => client });
    const runtime = setup(manager);
    managers.push(manager);
    const mcpServer = server();

    const result = await runtime.executor(args({
      selection: { type: "mcp_call", serverId: mcpServer.id, tool: "search", input: { query: "news" } },
      availableBuiltinTools: [],
      availableMcpServers: [mcpServer],
      availableMcpTools: [{ server: mcpServer, tools: [{ name: "search", description: "Search content" }] }]
    }));

    expect(client.request).toHaveBeenCalledWith("tools/call", { name: "search", input: { query: "news" } });
    expect(result).toMatchObject({ status: "tool_called", ok: true, serverId: mcpServer.id });
    expect(result.toolOutput).toEqual({ content: "search result" });
    expect(runtime.logs[0]).toMatchObject({ category: "mcp", ok: true });
  });
});
