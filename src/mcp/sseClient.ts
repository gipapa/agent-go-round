import { McpServerConfig } from "../types";
import { errorMessage } from "../utils/errors";
import { generateId } from "../utils/id";

type RpcReq<P = unknown> = { id: string; method: string; params?: P };
type RpcRes<R = unknown> = { id: string; result?: R; error?: unknown };
type PendingRpc = { settle: (res: RpcRes) => void };
type RpcPostDispatch = { kind: "reply"; response: RpcRes } | { kind: "deferred" };

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
  private pending = new Map<string, PendingRpc>();
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
    for (const [id, entry] of this.pending.entries()) {
      entry.settle({ id, error });
    }
    this.pending.clear();
  }

  private normalizeRpcResponse(id: string, response: Partial<RpcRes> | null | undefined): RpcRes {
    return {
      id: typeof response?.id === "string" && response.id.trim() ? response.id : id,
      result: response?.result,
      error: response?.error
    };
  }

  private createPendingRequest(id: string) {
    let settled = false;
    let settle = (_res: RpcRes) => {};
    let timeoutId = 0;
    const promise = new Promise<RpcRes>((resolve) => {
      settle = (response) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeoutId);
        const entry = this.pending.get(id);
        if (entry?.settle === settle) {
          this.pending.delete(id);
        }
        resolve(this.normalizeRpcResponse(id, response));
      };
      timeoutId = window.setTimeout(() => {
        settle({ id, error: `MCP RPC timed out after ${Math.round(this.getToolTimeoutMs() / 1000)}s` });
      }, this.getToolTimeoutMs());
    });
    this.pending.set(id, { settle });
    return { promise, settle };
  }

  private settlePending(response: RpcRes) {
    const entry = this.pending.get(response.id);
    if (!entry) return false;
    entry.settle(response);
    return true;
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
        this.settlePending(msg);
      } catch {
        this.onLog?.(`MCP SSE parse failed: ${ev.data}`);
      }
    };
  }

  close() {
    this.invalidateConnection("MCP SSE closed");
  }

  private async postRpc(req: RpcReq): Promise<RpcPostDispatch> {
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
        return { kind: "reply", response: { id: req.id, error: `HTTP ${res.status}` } };
      }
      this.markHealthy();
      const bodyText = await res.text().catch(() => "");
      const trimmed = bodyText.trim();
      if (!trimmed) {
        return { kind: "deferred" };
      }
      try {
        const parsed = JSON.parse(trimmed) as Partial<RpcRes>;
        if (parsed && typeof parsed === "object" && ("result" in parsed || "error" in parsed)) {
          return { kind: "reply", response: this.normalizeRpcResponse(req.id, parsed) };
        }
        return { kind: "deferred" };
      } catch {
        if (res.status === 202 || res.status === 204) {
          return { kind: "deferred" };
        }
        return {
          kind: "reply",
          response: {
            id: req.id,
            error: `Invalid MCP RPC response: ${trimmed.slice(0, 300)}`
          }
        };
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return {
          kind: "reply",
          response: { id: req.id, error: `MCP RPC timed out after ${Math.round(this.getToolTimeoutMs() / 1000)}s` }
        };
      }
      return {
        kind: "reply",
        response: { id: req.id, error: errorMessage(error) }
      };
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
      const probe = await this.request("tools/list");
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

  async request(method: string, params?: unknown): Promise<RpcRes> {
    if (!this.es) {
      this.connect(this.onLog);
    }
    const id = generateId();
    const req: RpcReq = { id, method, params };

    if (method !== "tools/list") {
      try {
        await this.ensureHealthy();
      } catch (error) {
        return { id, error: `MCP heartbeat failed: ${errorMessage(error)}` };
      }
    }

    const pendingRequest = this.createPendingRequest(id);
    const httpDispatch = await this.postRpc(req);
    if (httpDispatch.kind === "reply") {
      pendingRequest.settle(httpDispatch.response);
    }
    return await pendingRequest.promise;
  }
}
