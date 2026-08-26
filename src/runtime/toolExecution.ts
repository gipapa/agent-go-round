import type { McpRequester } from "../mcp/toolRegistry";
import { callTool } from "../mcp/toolRegistry";
import type { McpServerConfig } from "../types";
import { MAX_RUNTIME_TIMEOUT_MS } from "../utils/deadline";

const DEFAULT_MCP_TOOL_TIMEOUT_MS = 30000;

export class McpToolExecutionError extends Error {
  readonly effectDispatched: boolean;

  constructor(message: string, effectDispatched = true) {
    super(message);
    this.name = "McpToolExecutionError";
    this.effectDispatched = effectDispatched;
  }
}

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

export async function callMcpToolWithTimeout(
  client: McpRequester,
  name: string,
  input: unknown,
  timeoutMs: number,
  signal?: AbortSignal,
  onDispatch?: () => void
) {
  const boundedTimeoutMs = Number.isFinite(timeoutMs)
    ? Math.min(MAX_RUNTIME_TIMEOUT_MS, Math.max(1, Math.round(timeoutMs)))
    : DEFAULT_MCP_TOOL_TIMEOUT_MS;
  let timeoutId: ReturnType<typeof globalThis.setTimeout> | null = null;
  const abortCleanup: { current?: () => void } = {};
  try {
    if (signal?.aborted) {
      throw new McpToolExecutionError(signal.reason ? String(signal.reason) : "MCP tool aborted", false);
    }
    const abortPromise = signal
      ? new Promise<never>((_, reject) => {
          const onAbort = () => reject(new McpToolExecutionError(signal.reason ? String(signal.reason) : "MCP tool aborted", true));
          if (signal.aborted) onAbort();
          else {
            signal.addEventListener("abort", onAbort, { once: true });
            abortCleanup.current = () => signal.removeEventListener("abort", onAbort);
          }
        })
      : null;
    onDispatch?.();
    return await Promise.race([
      callTool(client, name, input ?? {}),
      new Promise<never>((_, reject) => {
        timeoutId = globalThis.setTimeout(() => {
          reject(new McpToolExecutionError(`MCP tool timed out after ${Math.round(boundedTimeoutMs / 1000)}s`, true));
        }, boundedTimeoutMs);
      }),
      ...(abortPromise ? [abortPromise] : [])
    ]);
  } finally {
    if (timeoutId !== null) {
      globalThis.clearTimeout(timeoutId);
    }
    abortCleanup.current?.();
  }
}
