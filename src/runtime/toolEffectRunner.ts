import type { AgentConfig, BuiltInToolConfig, McpServerConfig, McpTool } from "../types";
import { McpClientManager } from "../mcp/clientManager";
import { callMcpToolWithTimeout, getMcpToolTimeoutMs, McpToolExecutionError } from "./toolExecution";
import { BuiltInToolExecutionError, runBuiltInScriptTool } from "../utils/runBuiltInScriptTool";
import { errorMessage } from "../utils/errors";
import { SYSTEM_BUILT_IN_TOOLS } from "../utils/systemBuiltInTools";
import type {
  HarnessToolCall,
  HarnessToolDefinition,
  HarnessToolResult,
  HarnessToolContext
} from "./harness/types";

const MAX_MODEL_CONTENT_CHARS = 8_000;

function textDigest(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function capText(value: string) {
  if (value.length <= MAX_MODEL_CONTENT_CHARS) return value;
  const marker = `\n[… tool output truncated; original_chars=${value.length}; digest=${textDigest(value)}]`;
  return `${value.slice(0, Math.max(0, MAX_MODEL_CONTENT_CHARS - marker.length))}${marker}`.slice(0, MAX_MODEL_CONTENT_CHARS);
}

function serialize(value: unknown) {
  const marker = "\n[… structured tool output truncated]";
  const limit = Math.max(0, MAX_MODEL_CONTENT_CHARS - marker.length);
  let output = "";
  let truncated = false;
  const seen = new WeakSet<object>();

  const append = (text: string) => {
    if (output.length >= limit) {
      truncated = true;
      return;
    }
    const remaining = limit - output.length;
    if (text.length > remaining) {
      output += text.slice(0, remaining);
      truncated = true;
    } else {
      output += text;
    }
  };

  const write = (current: unknown, depth: number) => {
    if (output.length >= limit) {
      truncated = true;
      return;
    }
    if (depth > 8) {
      append('"[nested value truncated]"');
      return;
    }
    if (current === null) {
      append("null");
      return;
    }
    if (typeof current === "string") {
      const remaining = Math.max(0, limit - output.length - 4);
      const text = current.length > remaining ? `${current.slice(0, remaining)}…` : current;
      append(JSON.stringify(text));
      if (text.length < current.length) truncated = true;
      return;
    }
    if (typeof current === "number" || typeof current === "boolean") {
      append(JSON.stringify(current));
      return;
    }
    if (typeof current === "bigint") {
      append(JSON.stringify(`${current}n`));
      return;
    }
    if (typeof current === "function") {
      append('"[function]"');
      return;
    }
    if (ArrayBuffer.isView(current)) {
      append(JSON.stringify(`[binary ${current.byteLength} bytes]`));
      return;
    }
    if (current instanceof ArrayBuffer) {
      append(JSON.stringify(`[binary ${current.byteLength} bytes]`));
      return;
    }
    if (typeof current !== "object") {
      append(JSON.stringify(String(current)));
      return;
    }
    if (seen.has(current)) {
      append('"[circular]"');
      return;
    }
    seen.add(current);
    if (Array.isArray(current)) {
      append("[");
      for (let index = 0; index < current.length && output.length < limit; index += 1) {
        if (index > 0) append(",");
        write(current[index], depth + 1);
      }
      if (current.length > 0 && output.length >= limit) truncated = true;
      append("]");
    } else {
      append("{");
      const entries = Object.entries(current as Record<string, unknown>);
      for (let index = 0; index < entries.length && output.length < limit; index += 1) {
        if (index > 0) append(",");
        append(JSON.stringify(entries[index][0]));
        append(":");
        write(entries[index][1], depth + 1);
      }
      if (entries.length > 0 && output.length >= limit) truncated = true;
      append("}");
    }
    seen.delete(current);
  };

  try {
    write(value, 0);
  } catch {
    return { text: "[unserializable tool output]", failed: true };
  }
  return {
    text: truncated ? `${output}${marker}`.slice(0, MAX_MODEL_CONTENT_CHARS) : output,
    failed: false
  };
}

function builtInToolId(tool: BuiltInToolConfig) {
  return `builtin:${tool.id}`;
}

function mcpToolId(serverId: string, toolName: string) {
  return `mcp:${serverId}:${toolName}`;
}

function isTrustedSystemBuiltin(tool: BuiltInToolConfig) {
  return SYSTEM_BUILT_IN_TOOLS.some((systemTool) => systemTool === tool);
}

export function buildBuiltinHarnessToolDefinitions(tools: readonly BuiltInToolConfig[]): HarnessToolDefinition[] {
  return tools.map((tool) => {
    const readOnly = tool.readonly === true;
    const trustedSystemBuiltin = isTrustedSystemBuiltin(tool);
    return {
    id: builtInToolId(tool),
    description: tool.description,
    inputSchema: tool.inputSchema ?? {},
    intent: readOnly ? "observe" : "control",
    idempotency: readOnly ? "idempotent" : "unknown",
    cancellation: trustedSystemBuiltin ? "cooperative" : "terminable",
    requireConfirmation: typeof tool.requireConfirmation === "boolean" ? tool.requireConfirmation : !readOnly,
    executionKind: trustedSystemBuiltin ? "trusted_local" : "worker"
    };
  });
}

export function buildMcpHarnessToolDefinitions(entries: readonly { server: McpServerConfig; tools: readonly McpTool[] }[]): HarnessToolDefinition[] {
  return entries.flatMap(({ server, tools }) => tools.map((tool) => {
    const annotationIsReadOnly = tool.annotations?.readOnlyHint === true && tool.annotations.destructiveHint !== true;
    const policy = server.toolPolicies?.[tool.name] ?? {};
    return {
      id: mcpToolId(server.id, tool.name),
      description: tool.description?.trim() || `MCP tool ${tool.name}`,
      inputSchema: tool.inputSchema ?? {},
      // Only explicit MCP annotations can make an action observational. Missing
      // or contradictory annotations remain conservative control actions. An
      // explicit user policy may intentionally override that default.
      intent: policy.intent ?? (annotationIsReadOnly ? "observe" : "control"),
      idempotency: policy.idempotency ?? (tool.annotations?.idempotentHint === true ? "idempotent" : "unknown"),
      cancellation: policy.cancellation ?? "cooperative",
      requireConfirmation: policy.requireConfirmation ?? !annotationIsReadOnly,
      executionKind: "mcp" as const
    };
  }));
}

export type ToolEffectRunnerDependencies = {
  agent: AgentConfig;
  availableBuiltinTools: readonly BuiltInToolConfig[];
  availableMcpServers: readonly McpServerConfig[];
  availableMcpTools: readonly { server: McpServerConfig; tools: readonly McpTool[] }[];
  mcpClientManager: McpClientManager;
  getUserProfilePayload?: () => { name: string; description: string; hasAvatar: boolean };
  pickBestAgentForQuestion?: (question: string) => Promise<string> | string;
  confirm?: (message: string, signal: AbortSignal) => Promise<boolean>;
  requestId?: string;
};

function result(outcome: HarnessToolResult["outcome"], message: string, errorCode?: string, effectDispatched = false): HarnessToolResult {
  return {
    outcome,
    errorCode,
    modelContent: capText(message),
    displaySummary: capText(message),
    effectDispatched
  };
}

export function createToolEffectRunner(dependencies: ToolEffectRunnerDependencies) {
  const builtins = new Map<string, BuiltInToolConfig>();
  for (const tool of dependencies.availableBuiltinTools) {
    const id = builtInToolId(tool);
    if (!builtins.has(id)) builtins.set(id, tool);
  }
  const mcpServers = new Map<string, McpServerConfig>();
  for (const server of dependencies.availableMcpServers) {
    if (!mcpServers.has(server.id)) mcpServers.set(server.id, server);
  }
  const mcpTools = new Map<string, { server: McpServerConfig; tool: McpTool }>();
  for (const { server, tools } of dependencies.availableMcpTools) {
    for (const tool of tools) {
      const id = mcpToolId(server.id, tool.name);
      if (!mcpTools.has(id)) mcpTools.set(id, { server, tool });
    }
  }

  const confirm = async (message: string, signal: AbortSignal) => {
    if (signal.aborted) return false;
    if (!dependencies.confirm) return false;
    return (await dependencies.confirm(message, signal)) === true;
  };

  return {
    async execute(call: HarnessToolCall, context: HarnessToolContext): Promise<HarnessToolResult> {
      const definition = context.definition;
      if (context.signal.aborted) return result("rejected", "Tool execution was aborted before dispatch.", "aborted");

      if (definition.requireConfirmation) {
        const serializedInput = serialize(call.input);
        let allowed: boolean;
        try {
          allowed = await confirm(
            `允許 agent ${dependencies.agent.name} 執行工具「${definition.id}」嗎？\n\ninput:\n${serializedInput.text}`,
            context.signal
          );
        } catch (error) {
          if (context.signal.aborted) return result("rejected", "Tool execution was aborted before dispatch.", "aborted");
          return result("failed_before_dispatch", `Tool confirmation failed: ${errorMessage(error)}`, "confirmation_failed");
        }
        if (!allowed) return result("rejected", `Tool execution was rejected by the user: ${definition.id}.`, "confirmation_rejected");
      }
      if (context.signal.aborted) return result("rejected", "Tool execution was aborted before dispatch.", "aborted");

      const builtin = builtins.get(call.toolId);
      if (builtin) {
        const system: NonNullable<Parameters<typeof runBuiltInScriptTool>[2]>["system"] = {};
        const trustedSystemBuiltin = isTrustedSystemBuiltin(builtin);
        if (trustedSystemBuiltin && builtin.systemHandler === "user_profile") system.get_user_profile = dependencies.getUserProfilePayload;
        if (trustedSystemBuiltin && builtin.systemHandler === "agent_directory") system.pick_best_agent_for_question = dependencies.pickBestAgentForQuestion;
        if (trustedSystemBuiltin && builtin.id === "system:request_user_confirmation") {
          system.request_user_confirmation = async (message: string) => ({
            confirmed: await confirm(String(message ?? "").trim() || "是否繼續？", context.signal)
          });
        }
        try {
          const output = await runBuiltInScriptTool(
            builtin,
            call.input,
            { system },
            {
              signal: context.signal,
              sandbox: trustedSystemBuiltin ? "inline" : "worker",
              fallbackToInline: trustedSystemBuiltin,
              onDispatch: context.onDispatch
            }
          );
          const serialized = serialize(output);
          if (serialized.failed) return result("failed", `Built-in tool ${builtin.name} returned an unserializable result.`, "tool_result_unserializable", true);
          return {
            outcome: "success",
            modelContent: capText(serialized.text),
            displaySummary: `Built-in tool ${builtin.name} completed.`,
            effectDispatched: true
          };
        } catch (error) {
          const message = errorMessage(error);
          if (error instanceof BuiltInToolExecutionError && !error.effectDispatched) {
            return result("failed_before_dispatch", `Built-in tool ${builtin.name} was not dispatched: ${message}`, error.errorCode, false);
          }
          return result(context.signal.aborted ? "outcome_unknown" : "failed", `Built-in tool ${builtin.name} failed: ${message}`, "tool_execution_failed", true);
        }
      }

      const mcpTarget = mcpTools.get(call.toolId);
      if (mcpTarget) {
        const server = mcpServers.get(mcpTarget.server.id);
        if (!server) return result("failed_before_dispatch", `MCP server ${mcpTarget.server.id} is unavailable.`, "mcp_unavailable");
        let dispatchStarted = false;
        try {
          const output = await dependencies.mcpClientManager.run(
            server,
            (client) => {
              return callMcpToolWithTimeout(
                client,
                mcpTarget.tool.name,
                call.input ?? {},
                getMcpToolTimeoutMs(server, mcpTarget.tool.name),
                context.signal,
                () => {
                  dispatchStarted = true;
                  context.onDispatch?.();
                }
              );
            },
            () => undefined
          );
          const serialized = serialize(output);
          if (serialized.failed) return result("failed", `MCP tool ${mcpTarget.tool.name} returned an unserializable result.`, "tool_result_unserializable", true);
          return {
            outcome: "success",
            modelContent: capText(serialized.text),
            displaySummary: `MCP tool ${mcpTarget.tool.name} completed.`,
            effectDispatched: true
          };
        } catch (error) {
          const effectDispatched = dispatchStarted || (error instanceof McpToolExecutionError && error.effectDispatched);
          if (effectDispatched) dependencies.mcpClientManager.invalidate(server.id);
          const message = errorMessage(error);
          if (effectDispatched) {
            return result("outcome_unknown", `MCP tool ${mcpTarget.tool.name} outcome is unknown: ${message}`, "mcp_outcome_unknown", true);
          }
          if (context.signal.aborted) return result("rejected", "MCP tool execution was aborted before dispatch.", "aborted");
          return result("failed_before_dispatch", `MCP tool ${mcpTarget.tool.name} failed before dispatch: ${message}`, "mcp_routing_failed");
        }
      }

      return result("failed_before_dispatch", `Tool ${call.toolId} is unavailable.`, "tool_unavailable");
    }
  };
}
