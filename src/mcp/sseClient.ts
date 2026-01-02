import { McpServerConfig } from "../types";

type RpcReq = { id: string; method: string; params?: any };
type RpcRes = { id: string; result?: any; error?: any };

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

  constructor(private cfg: McpServerConfig) {}

  connect(onLog?: (msg: string) => void) {
    if (this.connected) return;
    this.es = new EventSource(this.cfg.sseUrl);
    this.connected = true;

    this.es.onopen = () => onLog?.(`MCP SSE connected: ${this.cfg.sseUrl}`);
    this.es.onerror = () => onLog?.("MCP SSE error");

    this.es.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data) as RpcRes;
        const cb = this.pending.get(msg.id);
        if (cb) {
          this.pending.delete(msg.id);
          cb(msg);
        }
      } catch {
        onLog?.(`MCP SSE parse failed: ${ev.data}`);
      }
    };
  }

  close() {
    this.es?.close();
    this.connected = false;
  }

  private async postRpc(req: RpcReq): Promise<RpcRes> {
    const url = new URL(this.cfg.sseUrl);
    url.pathname = url.pathname.replace(/\/sse$/, "/rpc");
    const postUrl = url.toString();

    const res = await fetch(postUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req)
    });

    if (!res.ok) {
      return { id: req.id, error: `HTTP ${res.status}` };
    }
    return await res.json();
  }

  async request(method: string, params?: any): Promise<RpcRes> {
    const id = crypto.randomUUID();
    const req: RpcReq = { id, method, params };

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
