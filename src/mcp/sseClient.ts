import { McpServerConfig } from "../types";
import { generateId } from "../utils/id";

type RpcReq = { id: string; method: string; params?: any };
type RpcRes = { id: string; result?: any; error?: any };

const DEFAULT_MCP_TOOL_TIMEOUT_SECOND = 30;
const DEFAULT_MCP_HEARTBEAT_SECOND = 30;

/**
 * MCP over SSE (client side)
 *
 * Notes:
 * - EventSource cannot set custom headers. If you need auth, use:
 *   - a querystring token (e.g. ?token=...)
 *   - same-site cookies (best if you host MCP and playground on same origin)
 *
 * - SSE is server -> client only. For client -> server requests, this MVP expects
 *   a POST endpoint at: <sseUrl with /sse replaced by /rpc>
 *   e.g. https://host/mcp/sse  + POST https://host/mcp/rpc
 */
export class McpSseClient {
  private es?: EventSource;
  private pending = new Map<string, (res: RpcRes) => void>();
  private connected = false;
  private onLog?: (msg: string) => void;
  private lastHealthyAt = 0;
  private connectTimeoutId: number | null = null;
  private healthCheckPromise: Promise<void> | null = null;

  constructor(private cfg: McpServerConfig) {}

  private clearConnectTimeout() {
    if (this.connectTimeoutId !== null) {
      window.clearTimeout(this.connectTimeoutId);
      this.connectTimeoutId = null;
    }
  }

  private failPending(error: string) {
    if (this.pending.size === 0) return;
    for (const [id, resolve] of this.pending.entries()) {
      resolve({ id, error });
    }
    this.pending.clear();
  }

  private invalidateConnection(pendingError?: string) {
    this.clearConnectTimeout();
    if (this.es) {
      this.es.onopen = null;
      this.es.onmessage = null;
      this.es.onerror = null;
      this.es.close();
      this.es = undefined;
    }
    this.connected = false;
    if (pendingError) {
      this.failPending(pendingError);
    }
  }

  private getToolTimeoutMs() {
    const seconds =
      typeof this.cfg.toolTimeoutSecond === "number" && Number.isFinite(this.cfg.toolTimeoutSecond)
        ? Math.max(1, Math.round(this.cfg.toolTimeoutSecond))
        : DEFAULT_MCP_TOOL_TIMEOUT_SECOND;
    return seconds * 1000;
  }

  private getHeartbeatMs() {
    const seconds =
      typeof this.cfg.heartbeatSecond === "number" && Number.isFinite(this.cfg.heartbeatSecond)
        ? Math.max(0, Math.round(this.cfg.heartbeatSecond))
        : DEFAULT_MCP_HEARTBEAT_SECOND;
    return seconds * 1000;
  }

  private markHealthy() {
    this.lastHealthyAt = Date.now();
  }

  connect(onLog?: (msg: string) => void) {
    if (this.connected && this.es) return;
    this.onLog = onLog ?? this.onLog;
    this.invalidateConnection();
    const es = new EventSource(this.cfg.sseUrl);
    this.es = es;
    this.connected = false;
    this.connectTimeoutId = window.setTimeout(() => {
      this.onLog?.(`MCP SSE open timed out after ${Math.round(this.getToolTimeoutMs() / 1000)}s`);
    }, this.getToolTimeoutMs());

    es.onopen = () => {
      if (this.es !== es) return;
      this.clearConnectTimeout();
      this.connected = true;
      this.markHealthy();
      this.onLog?.(`MCP SSE connected: ${this.cfg.sseUrl}`);
    };
    es.onerror = () => {
      if (this.es !== es) return;
      this.onLog?.("MCP SSE error");
      this.invalidateConnection("MCP SSE disconnected");
    };

    es.onmessage = (ev) => {
      if (this.es !== es) return;
      try {
        this.markHealthy();
        const msg = JSON.parse(ev.data) as RpcRes;
        const cb = this.pending.get(msg.id);
        if (cb) {
          this.pending.delete(msg.id);
          cb(msg);
        }
      } catch {
        this.onLog?.(`MCP SSE parse failed: ${ev.data}`);
      }
    };
  }

  close() {
    this.invalidateConnection("MCP SSE closed");
  }

  private async postRpc(req: RpcReq): Promise<RpcRes> {
    const url = new URL(this.cfg.sseUrl);
    url.pathname = url.pathname.replace(/\/sse$/, "/rpc");
    const postUrl = url.toString();
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), this.getToolTimeoutMs());

    try {
      const res = await fetch(postUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req),
        signal: controller.signal
      });

      if (!res.ok) {
        return { id: req.id, error: `HTTP ${res.status}` };
      }
      const parsed = await res.json();
      this.markHealthy();
      return parsed;
    } catch (error: any) {
      if (error?.name === "AbortError") {
        return { id: req.id, error: `MCP RPC timed out after ${Math.round(this.getToolTimeoutMs() / 1000)}s` };
      }
      return { id: req.id, error: String(error?.message ?? error) };
    } finally {
      window.clearTimeout(timeoutId);
    }
  }

  private async ensureHealthy() {
    const heartbeatMs = this.getHeartbeatMs();
    if (!heartbeatMs) return;
    if (!this.lastHealthyAt) return;
    if (Date.now() - this.lastHealthyAt < heartbeatMs) return;
    if (this.healthCheckPromise) return this.healthCheckPromise;

    this.healthCheckPromise = (async () => {
      const probe = await this.postRpc({ id: generateId(), method: "tools/list" });
      if (probe.error) {
        this.onLog?.(`MCP heartbeat failed: ${probe.error}`);
        this.invalidateConnection("MCP heartbeat failed");
        throw new Error(String(probe.error));
      }
      this.onLog?.(`MCP heartbeat OK: ${this.cfg.sseUrl}`);
    })().finally(() => {
      this.healthCheckPromise = null;
    });

    return this.healthCheckPromise;
  }

  async request(method: string, params?: any): Promise<RpcRes> {
    const id = generateId();
    const req: RpcReq = { id, method, params };

    if (method !== "tools/list") {
      try {
        await this.ensureHealthy();
      } catch (error: any) {
        return { id, error: `MCP heartbeat failed: ${String(error?.message ?? error)}` };
      }
    }

    const httpRes = await this.postRpc(req);
    if (httpRes?.result !== undefined || httpRes?.error !== undefined) return httpRes;

    return await new Promise<RpcRes>((resolve) => {
      this.pending.set(id, resolve);
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          resolve({ id, error: "timeout" });
        }
      }, 15000);
    });
  }
}
