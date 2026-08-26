import { afterEach, describe, expect, it, vi } from "vitest";
import { McpClientManager, type McpClientLike } from "../mcp/clientManager";
import {
  buildBuiltinHarnessToolDefinitions,
  buildMcpHarnessToolDefinitions,
  createToolEffectRunner
} from "../runtime/toolEffectRunner";
import { SYSTEM_BUILT_IN_TOOLS } from "../utils/systemBuiltInTools";
import { createToolDashboardHelpers } from "../utils/toolDashboard";
import type { AgentConfig, BuiltInToolConfig, McpServerConfig } from "../types";

const agent: AgentConfig = { id: "agent-1", name: "Agent One", type: "openai_compat" };

function builtin(patch: Partial<BuiltInToolConfig> = {}): BuiltInToolConfig {
  return {
    id: "echo",
    name: "echo",
    description: "Echo input",
    code: "return input.value;",
    inputSchema: { type: "object", required: ["value"], properties: { value: { type: "number" } } },
    updatedAt: 0,
    ...patch
  };
}

function server(patch: Partial<McpServerConfig> = {}): McpServerConfig {
  return { id: "mcp-1", name: "MCP", sseUrl: "https://example.com/mcp", ...patch };
}

function context(definition: ReturnType<typeof buildBuiltinHarnessToolDefinitions>[number]) {
  return { signal: new AbortController().signal, runId: "run", generation: 1, definition };
}

describe("headless tool effect runner", () => {
  const managers: McpClientManager[] = [];

  afterEach(() => managers.splice(0).forEach((manager) => manager.closeAll()));

  it("runs a built-in without appending chat messages", async () => {
    const target = SYSTEM_BUILT_IN_TOOLS[0];
    const manager = new McpClientManager();
    managers.push(manager);
    const runner = createToolEffectRunner({
      agent,
      availableBuiltinTools: [target],
      availableMcpServers: [],
      availableMcpTools: [],
      mcpClientManager: manager,
      confirm: vi.fn(async () => true),
      getUserProfilePayload: () => ({ name: "Alice", description: "PM", hasAvatar: false })
    });
    const definition = buildBuiltinHarnessToolDefinitions([target])[0];
    const onDispatch = vi.fn();
    const result = await runner.execute({ callId: "call-1", toolId: definition.id, input: {}, origin: "model" }, {
      ...context(definition),
      onDispatch
    });
    expect(result).toMatchObject({ outcome: "success", effectDispatched: true });
    expect(onDispatch).toHaveBeenCalledOnce();
  });

  it("runs custom page tools with the injected dashboard helper", async () => {
    const target = builtin({
      id: "dashboard-tool",
      name: "dashboard-tool",
      description: "Show a dashboard",
      code: `
        const panel = dashboard.show({ key: "test-dashboard", title: "Test dashboard" });
        panel.body.textContent = "ready";
        return { dashboardId: panel.id };
      `,
      inputSchema: {},
      requireConfirmation: false,
      source: "custom"
    });
    const manager = new McpClientManager();
    managers.push(manager);
    const dashboard = createToolDashboardHelpers();
    const runner = createToolEffectRunner({
      agent,
      availableBuiltinTools: [target],
      availableMcpServers: [],
      availableMcpTools: [],
      mcpClientManager: manager,
      ui: { dashboard }
    });
    const definition = buildBuiltinHarnessToolDefinitions([target])[0];
    expect(definition.intent).toBe("control");
    const result = await runner.execute({ callId: "call-dashboard", toolId: definition.id, input: {}, origin: "model" }, context(definition));

    expect(result).toMatchObject({ outcome: "success", effectDispatched: true });
    expect(result.modelContent).toContain("dashboardId");
    expect(document.querySelector('[data-agr-tool-dashboard="true"]')).toHaveTextContent("ready");
    dashboard.close("test-dashboard");
  });

  it("does not trust a forged system source for inline execution", async () => {
    const target = builtin({ source: "system" });
    const manager = new McpClientManager();
    managers.push(manager);
    const runner = createToolEffectRunner({
      agent,
      availableBuiltinTools: [target],
      availableMcpServers: [],
      availableMcpTools: [],
      mcpClientManager: manager,
      confirm: vi.fn(async () => true)
    });
    const definition = buildBuiltinHarnessToolDefinitions([target])[0];
    expect(definition.executionKind).toBe("worker");
    const result = await runner.execute({ callId: "call-forged", toolId: definition.id, input: { value: 7 }, origin: "model" }, context(definition));
    expect(result).toMatchObject({ outcome: "failed_before_dispatch", errorCode: "worker_unavailable" });
  });

  it("requires injected async confirmation and does not execute a rejected effect", async () => {
    const target = builtin({ requireConfirmation: true });
    const manager = new McpClientManager();
    managers.push(manager);
    const confirm = vi.fn(async () => false);
    const runner = createToolEffectRunner({
      agent,
      availableBuiltinTools: [target],
      availableMcpServers: [],
      availableMcpTools: [],
      mcpClientManager: manager,
      confirm
    });
    const definition = buildBuiltinHarnessToolDefinitions([target])[0];
    const onDispatch = vi.fn();
    const result = await runner.execute({ callId: "call-1", toolId: definition.id, input: { value: 7 }, origin: "model" }, { ...context(definition), onDispatch });
    expect(result).toMatchObject({ outcome: "rejected", errorCode: "confirmation_rejected", effectDispatched: false });
    expect(confirm).toHaveBeenCalledOnce();
    expect(onDispatch).not.toHaveBeenCalled();
  });

  it("contains a confirmation failure before dispatch", async () => {
    const target = builtin({ requireConfirmation: true });
    const manager = new McpClientManager();
    managers.push(manager);
    const runner = createToolEffectRunner({
      agent,
      availableBuiltinTools: [target],
      availableMcpServers: [],
      availableMcpTools: [],
      mcpClientManager: manager,
      confirm: vi.fn(async () => { throw new Error("confirmation UI failed"); })
    });
    const definition = buildBuiltinHarnessToolDefinitions([target])[0];
    const onDispatch = vi.fn();
    const result = await runner.execute({ callId: "call-confirm-error", toolId: definition.id, input: { value: 7 }, origin: "model" }, {
      ...context(definition),
      onDispatch
    });
    expect(result).toMatchObject({ outcome: "failed_before_dispatch", errorCode: "confirmation_failed", effectDispatched: false });
    expect(onDispatch).not.toHaveBeenCalled();
  });

  it("requires the injected confirmation result to be exactly true", async () => {
    const target = builtin({ requireConfirmation: true });
    const manager = new McpClientManager();
    managers.push(manager);
    const runner = createToolEffectRunner({
      agent,
      availableBuiltinTools: [target],
      availableMcpServers: [],
      availableMcpTools: [],
      mcpClientManager: manager,
      confirm: vi.fn(async () => "yes" as never)
    });
    const definition = buildBuiltinHarnessToolDefinitions([target])[0];
    const result = await runner.execute({ callId: "call-confirm-strict", toolId: definition.id, input: { value: 7 }, origin: "model" }, context(definition));
    expect(result).toMatchObject({ outcome: "rejected", errorCode: "confirmation_rejected", effectDispatched: false });
  });

  it("does not let a forged trusted-local definition enable inline user code", async () => {
    const target = builtin({ source: "custom" });
    const manager = new McpClientManager();
    managers.push(manager);
    const runner = createToolEffectRunner({
      agent,
      availableBuiltinTools: [target],
      availableMcpServers: [],
      availableMcpTools: [],
      mcpClientManager: manager,
      confirm: vi.fn(async () => true)
    });
    const definition = { ...buildBuiltinHarnessToolDefinitions([target])[0], executionKind: "trusted_local" as const };
    const result = await runner.execute({ callId: "call-forged-inline", toolId: definition.id, input: { value: 7 }, origin: "model" }, context(definition));
    expect(result).toMatchObject({ outcome: "failed_before_dispatch", errorCode: "worker_unavailable", effectDispatched: false });
  });

  it("defaults malformed readonly metadata to a state-changing tool", () => {
    const definition = buildBuiltinHarnessToolDefinitions([builtin({ readonly: "false" as never })])[0];
    expect(definition).toMatchObject({ intent: "control", idempotency: "unknown", requireConfirmation: true });
  });

  it("allows explicit MCP policy overrides while keeping annotation defaults conservative", () => {
    const mcpServer = server({ toolPolicies: { search: { intent: "observe", requireConfirmation: false, idempotency: "idempotent" } } });
    const definitions = buildMcpHarnessToolDefinitions([{
      server: mcpServer,
      tools: [
        { name: "search", annotations: { destructiveHint: true }, inputSchema: { type: "object" } },
        { name: "unknown", inputSchema: { type: "object" } }
      ]
    }]);
    expect(definitions[0]).toMatchObject({ intent: "observe", idempotency: "idempotent", requireConfirmation: false });
    expect(definitions[1]).toMatchObject({ intent: "control", idempotency: "unknown", requireConfirmation: true });
  });

  it("does not dispatch when confirmation resolves after abort", async () => {
    class FakeClient implements McpClientLike {
      connect() {}
      close() {}
      request = vi.fn(async () => ({ id: "1", result: { ok: true } }));
    }
    const client = new FakeClient();
    const manager = new McpClientManager({ createClient: () => client });
    managers.push(manager);
    const mcpServer = server();
    const mcpTool = { name: "mutate", inputSchema: { type: "object" as const } };
    let resolveConfirmation: ((allowed: boolean) => void) | undefined;
    const confirm = vi.fn(() => new Promise<boolean>((resolve) => {
      resolveConfirmation = resolve;
    }));
    const runner = createToolEffectRunner({
      agent,
      availableBuiltinTools: [],
      availableMcpServers: [mcpServer],
      availableMcpTools: [{ server: mcpServer, tools: [mcpTool] }],
      mcpClientManager: manager,
      confirm
    });
    const definition = buildMcpHarnessToolDefinitions([{ server: mcpServer, tools: [mcpTool] }])[0];
    const controller = new AbortController();
    const execution = runner.execute({ callId: "call-abort-confirm", toolId: definition.id, input: {}, origin: "model" }, {
      signal: controller.signal,
      runId: "run",
      generation: 1,
      definition
    });
    await vi.waitFor(() => expect(confirm).toHaveBeenCalledOnce());
    controller.abort("cancelled");
    resolveConfirmation?.(true);
    await expect(execution).resolves.toMatchObject({ outcome: "rejected", errorCode: "aborted", effectDispatched: false });
    expect(client.request).not.toHaveBeenCalled();
  });

  it("keeps duplicate builtin ids aligned with the first catalog definition", async () => {
    const target = SYSTEM_BUILT_IN_TOOLS[0];
    const forged = { ...target, code: "return 'forged';", source: "custom" as const };
    const manager = new McpClientManager();
    managers.push(manager);
    const runner = createToolEffectRunner({
      agent,
      availableBuiltinTools: [target, forged],
      availableMcpServers: [],
      availableMcpTools: [],
      mcpClientManager: manager,
      getUserProfilePayload: () => ({ name: "Alice", description: "PM", hasAvatar: false })
    });
    const definition = buildBuiltinHarnessToolDefinitions([target, forged])[0];
    const result = await runner.execute({ callId: "call-duplicate", toolId: definition.id, input: {}, origin: "model" }, context(definition));
    expect(result).toMatchObject({ outcome: "success", effectDispatched: true });
    expect(result.modelContent).toContain("Alice");
    expect(result.modelContent).not.toContain("forged");
  });

  it("fails closed when a user tool cannot use a Worker", async () => {
    const target = builtin({ source: "custom" });
    const manager = new McpClientManager();
    managers.push(manager);
    const runner = createToolEffectRunner({
      agent,
      availableBuiltinTools: [target],
      availableMcpServers: [],
      availableMcpTools: [],
      mcpClientManager: manager,
      confirm: vi.fn(async () => true)
    });
    const definition = buildBuiltinHarnessToolDefinitions([target])[0];
    const result = await runner.execute({ callId: "call-1", toolId: definition.id, input: { value: 7 }, origin: "model" }, context(definition));
    expect(result).toMatchObject({ outcome: "failed_before_dispatch", errorCode: "worker_unavailable", effectDispatched: false });
  });

  it("reports a Worker construction failure as before-dispatch", async () => {
    const target = builtin({ source: "custom" });
    const originalWorker = globalThis.Worker;
    const originalUrl = globalThis.URL;
    const revokeObjectURL = vi.fn();
    class ThrowingWorker {
      constructor() {
        throw new Error("CSP blocked blob workers");
      }
    }
    vi.stubGlobal("Worker", ThrowingWorker);
    vi.stubGlobal("URL", { ...originalUrl, createObjectURL: () => "blob:test", revokeObjectURL });
    try {
      const manager = new McpClientManager();
      managers.push(manager);
      const runner = createToolEffectRunner({
        agent,
        availableBuiltinTools: [target],
        availableMcpServers: [],
        availableMcpTools: [],
        mcpClientManager: manager,
        confirm: vi.fn(async () => true)
      });
      const definition = buildBuiltinHarnessToolDefinitions([target])[0];
      const result = await runner.execute({ callId: "call-csp", toolId: definition.id, input: { value: 7 }, origin: "model" }, context(definition));
      expect(result).toMatchObject({ outcome: "failed_before_dispatch", errorCode: "worker_unavailable", effectDispatched: false });
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:test");
    } finally {
      if (originalWorker) vi.stubGlobal("Worker", originalWorker);
      else vi.unstubAllGlobals();
      vi.stubGlobal("URL", originalUrl);
    }
  });

  it("does not mark an inline compile failure as dispatched", async () => {
    const target = SYSTEM_BUILT_IN_TOOLS[0];
    const originalCode = target.code;
    target.code = "return (";
    const manager = new McpClientManager();
    managers.push(manager);
    try {
      const runner = createToolEffectRunner({
        agent,
        availableBuiltinTools: [target],
        availableMcpServers: [],
        availableMcpTools: [],
        mcpClientManager: manager
      });
      const definition = buildBuiltinHarnessToolDefinitions([target])[0];
      const onDispatch = vi.fn();
      const result = await runner.execute({ callId: "call-compile", toolId: definition.id, input: {}, origin: "model" }, { ...context(definition), onDispatch });
      expect(result).toMatchObject({ outcome: "failed_before_dispatch", errorCode: "tool_compile_failed", effectDispatched: false });
      expect(onDispatch).not.toHaveBeenCalled();
    } finally {
      target.code = originalCode;
    }
  });

  it("routes MCP calls through the manager and returns canonical output", async () => {
    class FakeClient implements McpClientLike {
      connect() {}
      close() {}
      request = vi.fn(async () => ({ id: "1", result: { content: "hello" } }));
    }
    const client = new FakeClient();
    const manager = new McpClientManager({ createClient: () => client });
    managers.push(manager);
    const mcpServer = server();
    const mcpTool = { name: "search", description: "Search", inputSchema: { type: "object" as const } };
    const runner = createToolEffectRunner({
      agent,
      availableBuiltinTools: [],
      availableMcpServers: [mcpServer],
      availableMcpTools: [{ server: mcpServer, tools: [mcpTool] }],
      mcpClientManager: manager,
      confirm: vi.fn(async () => true)
    });
    const definition = buildMcpHarnessToolDefinitions([{ server: mcpServer, tools: [mcpTool] }])[0];
    const result = await runner.execute({ callId: "call-1", toolId: definition.id, input: {}, origin: "model" }, {
      signal: new AbortController().signal,
      runId: "run",
      generation: 1,
      definition
    });
    expect(client.request).toHaveBeenCalledWith("tools/call", { name: "search", input: {} });
    expect(result.outcome).toBe("success");
    expect(result.modelContent).toContain("hello");
  });

  it("invalidates the MCP client when an in-flight effect becomes unknown", async () => {
    class FakeClient implements McpClientLike {
      connect() {}
      close = vi.fn();
      request = vi.fn(() => new Promise<{ id: string; result?: unknown }>(() => {}));
    }
    const client = new FakeClient();
    const manager = new McpClientManager({ createClient: () => client });
    managers.push(manager);
    const mcpServer = server();
    const mcpTool = { name: "slow", inputSchema: { type: "object" as const } };
    const runner = createToolEffectRunner({
      agent,
      availableBuiltinTools: [],
      availableMcpServers: [mcpServer],
      availableMcpTools: [{ server: mcpServer, tools: [mcpTool] }],
      mcpClientManager: manager,
      confirm: vi.fn(async () => true)
    });
    const definition = buildMcpHarnessToolDefinitions([{ server: mcpServer, tools: [mcpTool] }])[0];
    const controller = new AbortController();
    const execution = runner.execute({ callId: "call-unknown", toolId: definition.id, input: {}, origin: "model" }, {
      signal: controller.signal,
      runId: "run",
      generation: 1,
      definition
    });
    await vi.waitFor(() => expect(client.request).toHaveBeenCalledWith("tools/call", { name: "slow", input: {} }));
    controller.abort("cancelled");
    await expect(execution).resolves.toMatchObject({ outcome: "outcome_unknown", errorCode: "mcp_outcome_unknown", effectDispatched: true });
    expect(client.close).toHaveBeenCalled();
  });

  it("keeps client setup failures before dispatch retryable", async () => {
    const manager = new McpClientManager({ createClient: () => { throw new Error("MCP connection refused"); } });
    managers.push(manager);
    const mcpServer = server();
    const mcpTool = { name: "search", inputSchema: { type: "object" as const } };
    const runner = createToolEffectRunner({
      agent,
      availableBuiltinTools: [],
      availableMcpServers: [mcpServer],
      availableMcpTools: [{ server: mcpServer, tools: [mcpTool] }],
      mcpClientManager: manager,
      confirm: vi.fn(async () => true)
    });
    const definition = buildMcpHarnessToolDefinitions([{ server: mcpServer, tools: [mcpTool] }])[0];
    const onDispatch = vi.fn();
    const result = await runner.execute({ callId: "call-setup-failure", toolId: definition.id, input: {}, origin: "model" }, {
      ...context(definition),
      onDispatch
    });
    expect(result).toMatchObject({ outcome: "failed_before_dispatch", errorCode: "mcp_routing_failed", effectDispatched: false });
    expect(onDispatch).not.toHaveBeenCalled();
  });

  it("invalidates after a dispatched MCP server error", async () => {
    class FakeClient implements McpClientLike {
      connect() {}
      close = vi.fn();
      request = vi.fn(async () => ({ id: "1", error: "server rejected the request" }));
    }
    const client = new FakeClient();
    const manager = new McpClientManager({ createClient: () => client });
    managers.push(manager);
    const mcpServer = server();
    const mcpTool = { name: "reject", inputSchema: { type: "object" as const } };
    const runner = createToolEffectRunner({
      agent,
      availableBuiltinTools: [],
      availableMcpServers: [mcpServer],
      availableMcpTools: [{ server: mcpServer, tools: [mcpTool] }],
      mcpClientManager: manager,
      confirm: vi.fn(async () => true)
    });
    const definition = buildMcpHarnessToolDefinitions([{ server: mcpServer, tools: [mcpTool] }])[0];
    const result = await runner.execute({ callId: "call-server-error", toolId: definition.id, input: {}, origin: "model" }, {
      signal: new AbortController().signal,
      runId: "run",
      generation: 1,
      definition
    });
    expect(result).toMatchObject({ outcome: "outcome_unknown", errorCode: "mcp_outcome_unknown", effectDispatched: true });
    expect(client.close).toHaveBeenCalled();
  });

  it("bounds circular and binary tool output before model projection", async () => {
    const output: Record<string, unknown> = { binary: new Uint8Array([1, 2, 3]) };
    output.self = output;
    output.huge = "x".repeat(100_000);
    class FakeClient implements McpClientLike {
      connect() {}
      close() {}
      request = vi.fn(async () => ({ id: "1", result: output }));
    }
    const client = new FakeClient();
    const manager = new McpClientManager({ createClient: () => client });
    managers.push(manager);
    const mcpServer = server();
    const mcpTool = { name: "inspect", description: "Inspect", inputSchema: { type: "object" as const } };
    const runner = createToolEffectRunner({
      agent,
      availableBuiltinTools: [],
      availableMcpServers: [mcpServer],
      availableMcpTools: [{ server: mcpServer, tools: [mcpTool] }],
      mcpClientManager: manager,
      confirm: vi.fn(async () => true)
    });
    const definition = buildMcpHarnessToolDefinitions([{ server: mcpServer, tools: [mcpTool] }])[0];
    const result = await runner.execute({ callId: "call-1", toolId: definition.id, input: {}, origin: "model" }, context(definition));
    expect(result.modelContent.length).toBeLessThanOrEqual(8_000);
    expect(result.modelContent).toContain("binary 3 bytes");
    expect(result.modelContent).toContain("circular");
  });

  it("turns an unserializable dispatched result into a typed failure", async () => {
    const unserializable = new Proxy({}, { ownKeys: () => { throw new Error("cannot inspect result"); } });
    class FakeClient implements McpClientLike {
      connect() {}
      close() {}
      request = vi.fn(async () => ({ id: "1", result: unserializable }));
    }
    const client = new FakeClient();
    const manager = new McpClientManager({ createClient: () => client });
    managers.push(manager);
    const mcpServer = server();
    const mcpTool = { name: "broken-output", inputSchema: { type: "object" as const } };
    const runner = createToolEffectRunner({
      agent,
      availableBuiltinTools: [],
      availableMcpServers: [mcpServer],
      availableMcpTools: [{ server: mcpServer, tools: [mcpTool] }],
      mcpClientManager: manager,
      confirm: vi.fn(async () => true)
    });
    const definition = buildMcpHarnessToolDefinitions([{ server: mcpServer, tools: [mcpTool] }])[0];
    const result = await runner.execute({ callId: "call-unserializable", toolId: definition.id, input: {}, origin: "model" }, {
      signal: new AbortController().signal,
      runId: "run",
      generation: 1,
      definition
    });
    expect(result).toMatchObject({ outcome: "failed", errorCode: "tool_result_unserializable", effectDispatched: true });
    expect(client.request).toHaveBeenCalledOnce();
  });
});
