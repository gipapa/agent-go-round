import { McpServerConfig, McpTool } from "../types";
import { McpClientManager } from "./clientManager";
import { listTools } from "./toolRegistry";

type ToolCatalogClientManager = Pick<McpClientManager, "run">;

export class McpToolCatalog {
  private cache = new Map<string, McpTool[]>();
  private inflight = new Map<string, Promise<McpTool[]>>();
  private versions = new Map<string, number>();

  async load(
    server: McpServerConfig,
    manager: ToolCatalogClientManager,
    onLog?: (message: string) => void
  ) {
    const cached = this.cache.get(server.id);
    if (cached) return cached;

    const existing = this.inflight.get(server.id);
    if (existing) return existing;

    const version = this.versions.get(server.id) ?? 0;
    const promise = manager
      .run(server, (client) => listTools(client), onLog)
      .then((tools) => {
        if ((this.versions.get(server.id) ?? 0) === version) {
          this.cache.set(server.id, tools);
        }
        return tools;
      })
      .finally(() => {
        if (this.inflight.get(server.id) === promise) {
          this.inflight.delete(server.id);
        }
      });

    this.inflight.set(server.id, promise);
    return promise;
  }

  set(serverId: string, tools: McpTool[]) {
    this.cache.set(serverId, tools);
  }

  invalidate(serverId?: string) {
    if (!serverId) {
      this.cache.clear();
      this.inflight.clear();
      this.versions.clear();
      return;
    }

    this.cache.delete(serverId);
    this.inflight.delete(serverId);
    this.versions.set(serverId, (this.versions.get(serverId) ?? 0) + 1);
  }
}
