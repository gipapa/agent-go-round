import type { AgentConfig, BuiltInToolConfig, McpServerConfig, McpTool } from "../../types";
import { SYSTEM_BUILT_IN_TOOLS } from "../../utils/systemBuiltInTools";

type McpToolEntry = { server: McpServerConfig; tools: readonly McpTool[] };

function isArrayValue<T>(value: unknown): value is readonly T[] {
  return Array.isArray(value);
}

function normalizeAllowlist(value: unknown) {
  try {
    if (value === undefined) return null;
    if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) return new Set<string>();
    return new Set(value as string[]);
  } catch {
    return new Set<string>();
  }
}

function cloneImmutable<T>(value: T, seen = new WeakMap<object, unknown>()): T {
  if (!value || typeof value !== "object") return value;
  if (value instanceof Uint8Array) return value.slice() as T;
  const existing = seen.get(value);
  if (existing) return existing as T;
  if (Array.isArray(value)) {
    const clone: unknown[] = [];
    seen.set(value, clone);
    value.forEach((entry) => clone.push(cloneImmutable(entry, seen)));
    return Object.freeze(clone) as T;
  }
  const clone: Record<string, unknown> = {};
  seen.set(value, clone);
  Object.entries(value as Record<string, unknown>).forEach(([key, entry]) => {
    clone[key] = cloneImmutable(entry, seen);
  });
  return Object.freeze(clone) as T;
}

function snapshotList<T>(values: readonly T[], keep: (value: T) => boolean = () => true, preserve?: (value: T) => boolean): readonly T[] {
  const snapshot: T[] = [];
  for (const value of values) {
    try {
      if (!keep(value)) continue;
      snapshot.push(preserve?.(value) ? value : cloneImmutable(value));
    } catch {
      // A malformed external object must not enter a run snapshot.
    }
  }
  return Object.freeze(snapshot);
}

/**
 * Apply the agent boundary before tools enter the harness catalog or effect
 * runner. Undefined category flags preserve the historical default-on policy;
 * malformed persisted allowlists fail closed.
 */
export function filterAgentHarnessCapabilities(args: {
  agent: AgentConfig;
  builtins: readonly BuiltInToolConfig[];
  mcpServers: readonly McpServerConfig[];
  mcpTools: readonly McpToolEntry[];
}) {
  const builtinAllowlist = normalizeAllowlist(args.agent.allowedBuiltInToolIds);
  const mcpAllowlist = normalizeAllowlist(args.agent.allowedMcpServerIds);
  const builtins = args.agent.enableBuiltInTools === false
    ? Object.freeze([])
    : snapshotList(
        isArrayValue<BuiltInToolConfig>(args.builtins) ? args.builtins : [],
        (tool) => !builtinAllowlist || (typeof tool.id === "string" && builtinAllowlist.has(tool.id)),
        (tool) => SYSTEM_BUILT_IN_TOOLS.includes(tool)
      );
  const mcpServers = args.agent.enableMcp === false
    ? Object.freeze([])
    : snapshotList(
        isArrayValue<McpServerConfig>(args.mcpServers) ? args.mcpServers : [],
        (server) => !mcpAllowlist || (typeof server.id === "string" && mcpAllowlist.has(server.id))
      );
  const serversById = new Map(mcpServers.map((server) => [server.id, server]));
  const mcpTools: readonly McpToolEntry[] = args.agent.enableMcp === false
    ? Object.freeze([])
    : Object.freeze((isArrayValue<McpToolEntry>(args.mcpTools) ? args.mcpTools : []).flatMap(({ server, tools }) => {
      try {
        const canonicalServer = serversById.get(server.id);
        if (!canonicalServer) return [];
        return [Object.freeze({ server: canonicalServer, tools: snapshotList(isArrayValue<McpTool>(tools) ? tools : []) })];
      } catch {
        return [];
      }
    }));
  return { builtins, mcpServers, mcpTools };
}
