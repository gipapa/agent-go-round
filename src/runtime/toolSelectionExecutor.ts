import { AgentConfig, BuiltInToolConfig, ChatMessage, McpServerConfig, McpTool, BrowserObservationDigest } from "../types";
import { McpClientManager } from "../mcp/clientManager";
import { formatMcpServerResolutionFailure, resolveMcpServerId } from "../mcp/serverResolver";
import { BuiltInToolAction, McpAction } from "../schemas/decisions";
import { PendingLogEntry } from "./logging";
import { appendToolPromptSummary, msg, stringifyAny } from "./chatMessages";
import { extractBrowserObservation } from "./browserObservation";
import {
  buildObservationSignature,
  buildToolActionSignature,
  callMcpToolWithTimeout,
  classifyBuiltInToolIntent,
  classifyMcpToolIntent,
  getMcpToolTimeoutMs,
  ToolIntent
} from "./toolExecution";
import { runBuiltInScriptTool } from "../utils/runBuiltInScriptTool";
import { createToolDashboardHelpers } from "../utils/toolDashboard";
import { buildToolResultPromptBlock, ToolPromptDetailMode } from "../utils/toolResultSummary";
import {
  SYSTEM_AGENT_DIRECTORY_TOOL_ID,
  SYSTEM_REQUEST_CONFIRMATION_TOOL_ID,
  SYSTEM_USER_PROFILE_TOOL_ID
} from "../utils/systemBuiltInTools";
import { loadSavedAgentsFromStorage, pickBestAgentNameForQuestion } from "../utils/agentDirectoryTool";
import { errorMessage } from "../utils/errors";
import { ExecutionDeadline } from "../utils/deadline";

export type ToolAugmentationResult = {
  input: string;
  status: "no_entries" | "decision_failed" | "no_tool" | "tool_called";
  ok?: boolean;
  toolLabel?: string;
  detail?: string;
  actionSignature?: string;
  toolIntent?: ToolIntent;
  observationSignature?: string;
  decisionSummary?: string;
  toolOutput?: unknown;
  browserObservation?: BrowserObservationDigest | null;
  serverId?: string;
};

export type ToolSelectionArgs = {
  selection: BuiltInToolAction | McpAction;
  input: string;
  agent: AgentConfig;
  availableBuiltinTools: BuiltInToolConfig[];
  availableMcpServers: McpServerConfig[];
  availableMcpTools: Array<{ server: McpServerConfig; tools: McpTool[] }>;
  onStatus?: (text: string) => void;
  promptDetail: ToolPromptDetailMode;
  requestId?: string;
  deadline?: ExecutionDeadline;
};

type ToolSelectionDependencies = {
  appendMessage: (message: ChatMessage) => void;
  pushLog: (entry: PendingLogEntry) => void;
  mcpClientManager: McpClientManager;
  getUserProfilePayload: () => { name: string; description: string; hasAvatar: boolean };
  confirm?: (message: string) => boolean;
};

export function createToolSelectionExecutor(dependencies: ToolSelectionDependencies) {
  const confirm = dependencies.confirm ?? ((message: string) => window.confirm(message));

  return async function executeToolSelection(args: ToolSelectionArgs): Promise<ToolAugmentationResult> {
    const decision = args.selection;
    if (decision.type === "builtin_tool_call") {
      const actionSignature = buildToolActionSignature({ kind: "builtin", toolName: decision.tool, input: decision.input });
      args.onStatus?.(`正在呼叫內建工具「${decision.tool}」中…`);
      const targetTool = args.availableBuiltinTools.find((tool) => tool.name === decision.tool) ?? null;
      if (!targetTool) {
        const summary = `工具執行失敗：找不到名稱為 ${decision.tool} 的 built-in tool。`;
        dependencies.appendMessage(msg("tool", summary, "builtin_tool", { displayName: "Built-in Tool" }));
        dependencies.pushLog({
          category: "tool", agent: args.agent.name, ok: false, requestId: args.requestId, stage: "tool execution",
          message: `Built-in tool not found: ${decision.tool}`, details: JSON.stringify(decision)
        });
        return failedToolResult(args.input, `Built-in ${decision.tool}`, summary, actionSignature, false);
      }

      try {
        const allowed = !targetTool.requireConfirmation || confirm(
          `允許 agent ${args.agent.name} 執行工具「${targetTool.displayLabel ?? targetTool.name}」嗎？\n\ninput:\n${stringifyAny(decision.input ?? {})}`
        );
        if (!allowed) {
          const summary = `工具執行已被使用者阻止：${decision.tool}`;
          dependencies.appendMessage(msg("tool", summary, "builtin_tool", { displayName: "Built-in Tool" }));
          dependencies.pushLog({
            category: "tool", agent: args.agent.name, ok: false, requestId: args.requestId, stage: "tool execution",
            message: `Built-in tool blocked by user: ${decision.tool}`, details: stringifyAny(decision.input ?? {})
          });
          return failedToolResult(args.input, `Built-in ${decision.tool}`, summary, actionSignature, false);
        }

        const system: NonNullable<Parameters<typeof runBuiltInScriptTool>[2]>["system"] = {};
        if (args.availableBuiltinTools.some((tool) => tool.id === SYSTEM_USER_PROFILE_TOOL_ID)) {
          system.get_user_profile = dependencies.getUserProfilePayload;
        }
        if (args.availableBuiltinTools.some((tool) => tool.id === SYSTEM_AGENT_DIRECTORY_TOOL_ID)) {
          system.pick_best_agent_for_question = async (question: string) =>
            pickBestAgentNameForQuestion(question, loadSavedAgentsFromStorage(), args.agent.name);
        }
        if (args.availableBuiltinTools.some((tool) => tool.id === SYSTEM_REQUEST_CONFIRMATION_TOOL_ID)) {
          system.request_user_confirmation = async (message: string) => ({
            confirmed: confirm(String(message ?? "").trim() || "是否繼續？")
          });
        }

        const toolOutput = await runBuiltInScriptTool(
          targetTool,
          decision.input ?? {},
          { system, ui: { dashboard: createToolDashboardHelpers() } },
          { signal: args.deadline?.signal }
        );
        const toolIntent = classifyBuiltInToolIntent(targetTool);
        const outputText = stringifyAny(toolOutput);
        const browserObservation = extractBrowserObservation({ toolName: decision.tool, output: toolOutput });
        const summary = buildToolResultPromptBlock({
          kind: "builtin", toolName: decision.tool, input: decision.input ?? {}, output: toolOutput
        }, args.promptDetail);
        dependencies.appendMessage(msg(
          "tool",
          `Built-in tool -> ${decision.tool}\ninput:\n${stringifyAny(decision.input ?? {})}\noutput:\n${outputText}`,
          "builtin_tool",
          { displayName: "Built-in Tool" }
        ));
        dependencies.pushLog({
          category: "tool", agent: args.agent.name, ok: true, requestId: args.requestId, stage: "tool execution",
          message: `Built-in tool call OK: ${decision.tool}`, details: outputText
        });
        return {
          input: appendToolPromptSummary(args.input, summary),
          ok: true,
          status: "tool_called",
          toolLabel: `Built-in ${decision.tool}`,
          detail: summary,
          actionSignature,
          toolIntent,
          observationSignature: toolIntent === "observe" ? buildObservationSignature(toolOutput) : undefined,
          decisionSummary: `builtin:${decision.tool}\ninput:\n${stringifyAny(decision.input ?? {})}`,
          toolOutput,
          browserObservation
        };
      } catch (error) {
        const briefError = errorMessage(error);
        const summary = `工具執行失敗：${decision.tool} 執行失敗（${briefError}）。`;
        dependencies.appendMessage(msg("tool", summary, "builtin_tool", { displayName: "Built-in Tool" }));
        dependencies.pushLog({
          category: "tool", agent: args.agent.name, ok: false, requestId: args.requestId, stage: "tool execution",
          message: `Built-in tool call failed: ${decision.tool}`, details: briefError
        });
        return failedToolResult(args.input, `Built-in ${decision.tool}`, summary, actionSignature, false);
      }
    }

    const resolution = resolveMcpServerId({
      requestedServerId: decision.serverId,
      toolName: decision.tool,
      availableMcpTools: args.availableMcpTools
    });
    const serverId = resolution.ok ? resolution.serverId : decision.serverId;
    const actionSignature = buildToolActionSignature({ kind: "mcp", serverId, toolName: decision.tool, input: decision.input });
    const targetServer = args.availableMcpServers.find((server) => server.id === serverId) ?? null;
    const targetTool = args.availableMcpTools
      .find((entry) => entry.server.id === serverId)?.tools.find((tool) => tool.name === decision.tool) ?? null;
    args.onStatus?.(`正在呼叫 MCP 工具「${decision.tool}」中…`);

    if (!resolution.ok) {
      const detail = formatMcpServerResolutionFailure(resolution);
      const summary = `工具執行失敗：無法解析 MCP server（tool=${decision.tool}, serverId=${decision.serverId ?? "(none)"}, ${detail}）。`;
      dependencies.pushLog({
        category: "mcp", agent: args.agent.name, ok: false, requestId: args.requestId, stage: "mcp_routing_fallback",
        message: `MCP server resolution failed: ${decision.tool}`, details: JSON.stringify({ decision, resolution }, null, 2)
      });
      dependencies.appendMessage(msg("tool", summary, "mcp", { displayName: "MCP Tool" }));
      return failedToolResult(args.input, `MCP ${decision.serverId ?? "unknown"} -> ${decision.tool}`, summary, actionSignature, true);
    }

    const requestedServerId = String(decision.serverId ?? "").trim();
    if (requestedServerId && requestedServerId !== resolution.serverId) {
      dependencies.pushLog({
        category: "mcp", agent: args.agent.name, ok: true, requestId: args.requestId, stage: "mcp_routing_fallback",
        message: `MCP serverId corrected: ${requestedServerId} -> ${resolution.serverId}`,
        details: JSON.stringify({ decision, resolution }, null, 2)
      });
    }

    if (!targetServer) {
      const summary = `工具執行失敗：找不到 serverId=${serverId} 的可用 MCP server。`;
      dependencies.pushLog({
        category: "mcp", agent: args.agent.name, ok: false, requestId: args.requestId, stage: "tool execution",
        message: `Tool decision selected unavailable server: ${serverId}`, details: JSON.stringify(decision)
      });
      dependencies.appendMessage(msg("tool", summary, "mcp", { displayName: "MCP Tool" }));
      return failedToolResult(args.input, `MCP ${serverId ?? "unknown"} -> ${decision.tool}`, summary, actionSignature, true);
    }

    if (!targetTool) {
      const summary = `工具執行失敗：${targetServer.name} 沒有 ${decision.tool} 這個工具。`;
      dependencies.pushLog({
        category: "mcp", agent: args.agent.name, ok: false, requestId: args.requestId, stage: "tool execution",
        message: `Tool decision selected unavailable tool: ${decision.tool}`, details: JSON.stringify(decision)
      });
      dependencies.appendMessage(msg("tool", summary, "mcp", { displayName: "MCP Tool" }));
      return failedToolResult(args.input, `MCP ${targetServer.name} -> ${decision.tool}`, summary, actionSignature, true);
    }

    try {
      const timeoutMs = getMcpToolTimeoutMs(targetServer, decision.tool);
      const toolOutput = await dependencies.mcpClientManager.run(
        targetServer,
        (client) => callMcpToolWithTimeout(client, decision.tool, decision.input ?? {}, timeoutMs),
        (text) => dependencies.pushLog({
          category: "mcp", agent: targetServer.name, requestId: args.requestId, stage: "tool execution", message: text
        })
      );
      const toolIntent = classifyMcpToolIntent(targetTool);
      const outputText = stringifyAny(toolOutput);
      const browserObservation = extractBrowserObservation({ toolName: decision.tool, output: toolOutput });
      const summary = buildToolResultPromptBlock({
        kind: "mcp", serverName: targetServer.name, toolName: decision.tool, input: decision.input ?? {}, output: toolOutput
      }, args.promptDetail);
      dependencies.pushLog({
        category: "mcp", agent: targetServer.name, ok: true, requestId: args.requestId, stage: "tool execution",
        message: `MCP tool call OK: ${decision.tool}`, details: outputText
      });
      dependencies.appendMessage(msg(
        "tool",
        `MCP ${targetServer.name} -> ${decision.tool}\ninput:\n${stringifyAny(decision.input ?? {})}\noutput:\n${outputText}`,
        "mcp",
        { displayName: "MCP Tool" }
      ));
      return {
        input: appendToolPromptSummary(args.input, summary),
        ok: true,
        status: "tool_called",
        toolLabel: `MCP ${targetServer.name} -> ${decision.tool}`,
        detail: summary,
        actionSignature,
        toolIntent,
        observationSignature: toolIntent === "observe" ? buildObservationSignature(toolOutput) : undefined,
        decisionSummary: `mcp:${targetServer.name}/${decision.tool}\ninput:\n${stringifyAny(decision.input ?? {})}`,
        toolOutput,
        browserObservation,
        serverId: targetServer.id
      };
    } catch (error) {
      const briefError = errorMessage(error);
      const summary = `工具執行失敗：${decision.tool} 呼叫失敗（${briefError}）。`;
      dependencies.appendMessage(msg("tool", summary, "mcp", { displayName: "MCP Tool" }));
      dependencies.pushLog({
        category: "mcp", agent: targetServer.name, ok: false, requestId: args.requestId, stage: "tool execution",
        message: `Tool call failed: ${decision.tool}`, details: briefError
      });
      return failedToolResult(args.input, `MCP ${targetServer.name} -> ${decision.tool}`, summary, actionSignature, true);
    }
  };
}

function failedToolResult(
  input: string,
  toolLabel: string,
  detail: string,
  actionSignature: string,
  useSummaryMarkers: boolean
): ToolAugmentationResult {
  return {
    input: useSummaryMarkers
      ? appendToolPromptSummary(input, detail)
      : `${input}\n\n請將以下工具資訊一起納入回答：\n${detail}`,
    ok: false,
    status: "tool_called",
    toolLabel,
    detail,
    actionSignature
  };
}
