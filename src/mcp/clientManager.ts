import { McpServerConfig } from "../types";
import { createMcpClient, type McpClient } from "./client";

export type McpClientLike = McpClient;

type ManagedClient = {
  client: McpClientLike;
  fingerprint: string;
};

export type McpClientManagerOptions = {
  idleMs?: number;
  createClient?: (server: McpServerConfig) => McpClientLike;
};

function serverFingerprint(server: McpServerConfig) {
  return [
    server.transport ?? "sse",
    server.sseUrl.trim(),
    server.authToken?.trim() ?? "",
    JSON.stringify(server.customHeaders ?? {}),
    server.useLocalProxy ? "proxy" : "direct",
    typeof server.toolTimeoutSecond === "number" ? Math.max(1, Math.round(server.toolTimeoutSecond)) : "",
    typeof server.heartbeatSecond === "number" ? Math.max(0, Math.round(server.heartbeatSecond)) : ""
  ].join("\n");
}

function canReuseClient(client: McpClientLike) {
  return client.isReusable ? client.isReusable() : true;
}

export class McpClientManager {
  private clients = new Map<string, ManagedClient>();
  private idleTimers = new Map<string, number>();
  private idleMs: number;
  private createClient: (server: McpServerConfig) => McpClientLike;

  constructor(options: McpClientManagerOptions = {}) {
    this.idleMs = options.idleMs ?? 60_000;
    this.createClient = options.createClient ?? createMcpClient;
  }

  get(server: McpServerConfig, onLog?: (message: string) => void) {
    const fingerprint = serverFingerprint(server);
    const existing = this.clients.get(server.id);
    if (existing && (existing.fingerprint !== fingerprint || !canReuseClient(existing.client))) {
      this.closeClient(server.id);
    }

    let entry = this.clients.get(server.id);
    if (!entry) {
      entry = { client: this.createClient(server), fingerprint };
      this.clients.set(server.id, entry);
    }

    this.clearIdleTimer(server.id);
    entry.client.connect(onLog);
    this.scheduleIdleClose(server.id);
    return entry.client;
  }

  async run<T>(
    server: McpServerConfig,
    task: (client: McpClientLike) => Promise<T>,
    onLog?: (message: string) => void
  ) {
    const client = this.get(server, onLog);
    this.clearIdleTimer(server.id);
    try {
      return await task(client);
    } finally {
      this.scheduleIdleClose(server.id);
    }
  }

  invalidate(serverId?: string) {
    if (serverId) {
      this.closeClient(serverId);
      return;
    }

    for (const id of Array.from(this.clients.keys())) {
      this.closeClient(id);
    }
  }

  closeAll() {
    this.invalidate();
  }

  activeClientCount() {
    return this.clients.size;
  }

  private scheduleIdleClose(serverId: string) {
    this.clearIdleTimer(serverId);
    const timerId = window.setTimeout(() => {
      this.closeClient(serverId);
    }, this.idleMs);
    this.idleTimers.set(serverId, timerId);
  }

  private clearIdleTimer(serverId: string) {
    const timerId = this.idleTimers.get(serverId);
    if (timerId === undefined) return;
    window.clearTimeout(timerId);
    this.idleTimers.delete(serverId);
  }

  private closeClient(serverId: string) {
    this.clearIdleTimer(serverId);
    const entry = this.clients.get(serverId);
    if (entry) {
      entry.client.close();
      this.clients.delete(serverId);
    }
  }
}
