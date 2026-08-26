import { McpServerConfig, McpTool } from "../types";
import { McpClientManager } from "./clientManager";
import { listTools } from "./toolRegistry";

type ToolCatalogClientManager = Pick<McpClientManager, "run">;

type CachedCatalog = {
  fingerprint: string;
  tools: McpTool[];
};

type InflightCatalog = {
  fingerprint: string;
  promise: Promise<McpTool[]>;
};

function serverFingerprint(server: McpServerConfig) {
  return [
    server.transport ?? "sse",
    server.sseUrl.trim(),
    server.authToken?.trim() ?? "",
    JSON.stringify(server.customHeaders ?? {}),
    server.useLocalProxy ? "proxy" : "direct"
  ].join("\n");
}

export class McpToolCatalog {
  private cache = new Map<string, CachedCatalog>();
  private inflight = new Map<string, InflightCatalog>();
  private versions = new Map<string, number>();

  async load(
    server: McpServerConfig,
    manager: ToolCatalogClientManager,
    onLog?: (message: string) => void
  ) {
    const fingerprint = serverFingerprint(server);
    const cached = this.cache.get(server.id);
    if (cached?.fingerprint === fingerprint) return cached.tools;

    const existing = this.inflight.get(server.id);
    if (existing?.fingerprint === fingerprint) return existing.promise;
    if (existing) {
      this.inflight.delete(server.id);
      this.versions.set(server.id, (this.versions.get(server.id) ?? 0) + 1);
    }

    const version = this.versions.get(server.id) ?? 0;
    const promise = manager
      .run(server, (client) => listTools(client), onLog)
      .then((tools) => {
        if ((this.versions.get(server.id) ?? 0) === version) {
          this.cache.set(server.id, { fingerprint, tools });
        }
        return tools;
      })
      .finally(() => {
        if (this.inflight.get(server.id)?.promise === promise) {
          this.inflight.delete(server.id);
        }
      });

    this.inflight.set(server.id, { fingerprint, promise });
    return promise;
  }

  set(server: McpServerConfig, tools: McpTool[]) {
    this.inflight.delete(server.id);
    this.versions.set(server.id, (this.versions.get(server.id) ?? 0) + 1);
    this.cache.set(server.id, { fingerprint: serverFingerprint(server), tools });
  }

  invalidate(serverId?: string) {
    if (!serverId) {
      const ids = new Set([...this.cache.keys(), ...this.inflight.keys(), ...this.versions.keys()]);
      ids.forEach((id) => this.versions.set(id, (this.versions.get(id) ?? 0) + 1));
      this.cache.clear();
      this.inflight.clear();
      return;
    }

    this.cache.delete(serverId);
    this.inflight.delete(serverId);
    this.versions.set(serverId, (this.versions.get(serverId) ?? 0) + 1);
  }
}
