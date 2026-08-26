import type { McpServerConfig, McpTool } from "../types";

/**
 * Keep only catalog entries that still belong to the current server
 * configuration. A changed endpoint must be re-listed before a run can use
 * any of its previous tool schemas.
 */
export function retainMcpToolCatalog(
  previous: Readonly<Record<string, McpTool[]>>,
  servers: readonly Pick<McpServerConfig, "id">[],
  invalidatedServerIds: ReadonlySet<string> = new Set()
): Record<string, McpTool[]> {
  const entries = servers
    .filter((server) => !invalidatedServerIds.has(server.id))
    .filter((server) => Object.prototype.hasOwnProperty.call(previous, server.id))
    .map((server) => [server.id, previous[server.id]] as const);
  return Object.fromEntries(entries);
}
