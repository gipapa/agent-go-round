import type { McpRequester } from "../mcp/toolRegistry";
import { callTool } from "../mcp/toolRegistry";
import type { BuiltInToolConfig, McpServerConfig, McpTool } from "../types";

export type ToolIntent = "observe" | "state_change" | "control";

function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  return `{${Object.keys(value as Record<string, unknown>)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`)
    .join(",")}}`;
}

function normalizeToolInputForSignature(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeToolInputForSignature(item));
  }
  if (!value || typeof value !== "object") {
    return value;
  }

  const normalizedEntries = Object.entries(value as Record<string, unknown>)
    .filter(([key, entryValue]) => {
      if (entryValue === undefined || entryValue === null || entryValue === "" || entryValue === false) return false;
      if (key === "session" || key === "timestamp" || key === "requestId") return false;
      return true;
    })
    .map(([key, entryValue]) => [key, normalizeToolInputForSignature(entryValue)]);

  return Object.fromEntries(normalizedEntries);
}

export function buildToolActionSignature(args: {
  kind: "builtin" | "mcp";
  toolName: string;
  serverId?: string;
  input?: unknown;
}) {
  return `${args.kind}:${args.serverId ?? ""}:${args.toolName}:${stableStringify(normalizeToolInputForSignature(args.input ?? {}))}`;
}

const DEFAULT_MCP_TOOL_TIMEOUT_MS = 30000;

export function getMcpToolTimeoutMs(server: McpServerConfig, toolName: string) {
  if (typeof server.toolTimeoutSecond === "number" && Number.isFinite(server.toolTimeoutSecond)) {
    return Math.max(1000, Math.round(server.toolTimeoutSecond) * 1000);
  }
  const normalized = String(toolName ?? "").trim().toLowerCase();
  if (!normalized) return DEFAULT_MCP_TOOL_TIMEOUT_MS;
  if (normalized.includes("open")) return 45000;
  if (normalized.includes("wait")) return 45000;
  if (normalized.includes("snapshot") || normalized.includes("screenshot")) return 30000;
  return DEFAULT_MCP_TOOL_TIMEOUT_MS;
}

export async function callMcpToolWithTimeout(client: McpRequester, name: string, input: unknown, timeoutMs: number) {
  let timeoutId: number | null = null;
  try {
    return await Promise.race([
      callTool(client, name, input ?? {}),
      new Promise<never>((_, reject) => {
        timeoutId = window.setTimeout(() => {
          reject(new Error(`MCP tool timed out after ${Math.round(timeoutMs / 1000)}s`));
        }, timeoutMs);
      })
    ]);
  } finally {
    if (timeoutId !== null) {
      window.clearTimeout(timeoutId);
    }
  }
}

function hashString(value: string) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

export function buildObservationSignature(output: unknown) {
  return hashString(stableStringify(normalizeToolInputForSignature(output ?? {})));
}

function classifyToolIntentFromText(name: string, description?: string): ToolIntent {
  const haystack = `${name} ${description ?? ""}`.toLowerCase();
  const controlHints = ["confirm", "approval", "consent", "request", "ask user", "prompt user", "manual"];
  const observeHints = ["snapshot", "get ", "get_", "read", "inspect", "list", "query", "text", "content", "url", "status", "state", "screenshot"];
  const stateChangeHints = ["open", "click", "fill", "type", "write", "submit", "wait", "close", "navigate", "press"];

  if (controlHints.some((hint) => haystack.includes(hint))) return "control";
  if (observeHints.some((hint) => haystack.includes(hint))) return "observe";
  if (stateChangeHints.some((hint) => haystack.includes(hint))) return "state_change";
  return "state_change";
}

export function classifyBuiltInToolIntent(tool: BuiltInToolConfig): ToolIntent {
  return classifyToolIntentFromText(tool.name, tool.description);
}

export function classifyMcpToolIntent(tool: McpTool): ToolIntent {
  return classifyToolIntentFromText(tool.name, tool.description);
}
