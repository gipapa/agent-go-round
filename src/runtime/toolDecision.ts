import { resolveMcpServerId } from "../mcp/serverResolver";
import { normalizeToolDecision, type ToolDecision } from "../schemas/decisions";
import type { BuiltInToolConfig, McpServerConfig, McpTool } from "../types";
import { extractJsonObject } from "../utils/safeJson";

export type ToolEntry =
  | {
      kind: "mcp";
      server: McpServerConfig;
      tool: McpTool;
    }
  | {
      kind: "builtin";
      tool: BuiltInToolConfig;
    };

type McpToolCatalogEntry = { server: McpServerConfig; tools: McpTool[] };

export function normalizeToolDecisionAgainstAvailableTools(args: {
  decision: ToolDecision;
  availableBuiltinTools: BuiltInToolConfig[];
  availableMcpServers: McpServerConfig[];
  availableMcpTools: McpToolCatalogEntry[];
}) {
  if (args.decision.type === "no_tool" || args.decision.type === "builtin_tool_call") {
    return args.decision;
  }

  const decision = args.decision;
  const exactMatch = args.availableMcpTools.some((entry) => entry.tools.some((tool) => tool.name === decision.tool));
  const aliases = new Map<string, string>([
    ["visit", "browser_open"],
    ["open_url", "browser_open"],
    ["openurl", "browser_open"],
    ["open", "browser_open"],
    ["snapshot", "browser_snapshot"],
    ["read", "browser_snapshot"]
  ]);
  const resolvedToolName = exactMatch
    ? decision.tool
    : aliases.get(decision.tool.trim().toLowerCase()) ?? decision.tool;
  const serverResolution = resolveMcpServerId({
    requestedServerId: decision.serverId,
    toolName: resolvedToolName,
    availableMcpTools: args.availableMcpTools
  });
  const resolvedServerId = serverResolution.ok ? serverResolution.serverId : undefined;
  const matchingBuiltIn = args.availableBuiltinTools.find((tool) => tool.name === resolvedToolName) ?? null;
  if (!matchingBuiltIn) {
    return {
      ...decision,
      tool: resolvedToolName,
      serverId: resolvedServerId
    };
  }

  const matchingServer = resolvedServerId
    ? args.availableMcpServers.find((server) => server.id === resolvedServerId) ?? null
    : null;
  const matchingMcpTool = resolvedServerId
    ? args.availableMcpTools
        .find((entry) => entry.server.id === resolvedServerId)
        ?.tools.find((tool) => tool.name === resolvedToolName) ?? null
    : null;

  if (matchingServer && matchingMcpTool) {
    return {
      ...decision,
      tool: resolvedToolName,
      serverId: resolvedServerId
    };
  }

  return {
    type: "builtin_tool_call" as const,
    tool: resolvedToolName,
    input: decision.input
  };
}

export function inferExplicitToolDecision(args: {
  input: string;
  availableBuiltinTools: BuiltInToolConfig[];
  availableMcpTools: McpToolCatalogEntry[];
}) {
  const normalizedInput = String(args.input ?? "").toLowerCase();
  if (!/(明確使用|使用|呼叫|call|use)/i.test(normalizedInput)) {
    return null;
  }

  const findMcpTool = (toolName: string) =>
    args.availableMcpTools.find((entry) => entry.tools.some((tool) => tool.name === toolName)) ?? null;

  if (normalizedInput.includes("browser_open")) {
    const match = findMcpTool("browser_open");
    const url = extractFirstUrl(args.input);
    if (match && url) {
      return { type: "mcp_call" as const, serverId: match.server.id, tool: "browser_open", input: { url } };
    }
  }

  if (normalizedInput.includes("browser_snapshot")) {
    const match = findMcpTool("browser_snapshot");
    if (match) {
      return { type: "mcp_call" as const, serverId: match.server.id, tool: "browser_snapshot", input: {} };
    }
  }

  if (normalizedInput.includes("get_user_profile")) {
    const builtIn = args.availableBuiltinTools.find((tool) => tool.name === "get_user_profile") ?? null;
    if (builtIn) {
      return { type: "builtin_tool_call" as const, tool: "get_user_profile", input: {} };
    }
  }

  return null;
}

function extractPlainTextToolDecision(text: string): ToolDecision | null {
  const raw = String(text ?? "").trim();
  if (!raw) return null;
  if (/^no_tool$/i.test(raw)) return { type: "no_tool" };

  const matchToolCall = (toolName: string) => {
    const regex = new RegExp(`\\b${toolName}\\s*\\(([^)]*)\\)`, "i");
    return raw.match(regex);
  };
  const extractFirstArgument = (value: string) => {
    const cleaned = String(value ?? "")
      .trim()
      .replace(/^["'`]/, "")
      .replace(/["'`]$/, "");
    return cleaned.split(/\s*,\s*/, 1)[0]?.trim() ?? "";
  };

  const browserOpenCall = matchToolCall("browser_open") ?? matchToolCall("visit");
  if (browserOpenCall) {
    const url = extractFirstArgument(browserOpenCall[1]);
    return {
      type: "mcp_call",
      serverId: "",
      tool: /visit/i.test(browserOpenCall[0]) ? "visit" : "browser_open",
      input: url ? { url } : {}
    };
  }

  const browserSnapshotCall = matchToolCall("browser_snapshot") ?? matchToolCall("snapshot") ?? matchToolCall("read");
  if (browserSnapshotCall) {
    return {
      type: "mcp_call",
      serverId: "",
      tool: /browser_snapshot/i.test(browserSnapshotCall[0]) ? "browser_snapshot" : "snapshot",
      input: {}
    };
  }

  return null;
}

export function parseToolDecision(raw: string) {
  return normalizeToolDecision(extractJsonObject(raw)) ?? extractPlainTextToolDecision(raw);
}

export function extractFirstUrl(text: string) {
  const direct = String(text ?? "").match(/https?:\/\/[^\s"'`)>]+/i)?.[0];
  if (direct) return direct;
  const www = String(text ?? "").match(/\bwww\.[^\s"'`)>]+/i)?.[0];
  return www ? `https://${www}` : undefined;
}

export function resolvePreferredBrowserHeadedMode(text: string) {
  const normalized = String(text ?? "").toLowerCase();
  if (!normalized.trim()) return false;

  const headedPatterns = [
    /視窗模式/,
    /有視窗/,
    /可見瀏覽器/,
    /顯示瀏覽器/,
    /headed/,
    /\bhead mode\b/,
    /head模式/,
    /window mode/,
    /visible browser/
  ];
  if (headedPatterns.some((pattern) => pattern.test(normalized))) {
    return true;
  }

  const headlessPatterns = [/headless/, /無視窗/, /不要開視窗/, /hidden browser/];
  if (headlessPatterns.some((pattern) => pattern.test(normalized))) {
    return false;
  }

  return false;
}
