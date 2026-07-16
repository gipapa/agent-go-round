import type { McpServerConfig } from "../types";
import { errorMessage } from "../utils/errors";
import { generateId } from "../utils/id";
import { redactMcpUrl } from "./url";

type JsonRpcRequest = {
  jsonrpc: "2.0";
  id: string;
  method: string;
  params?: unknown;
};

type JsonRpcNotification = {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
};

export type JsonRpcResponse = {
  jsonrpc?: "2.0";
  id: string;
  result?: unknown;
  error?: unknown;
};

const DEFAULT_MCP_TOOL_TIMEOUT_SECOND = 30;
const LATEST_SUPPORTED_PROTOCOL_VERSION = "2025-11-25";
const LOCAL_PROXY_PATH = "/__agr_mcp_proxy";

function isJsonRpcResponse(value: unknown): value is JsonRpcResponse {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (typeof record.id === "string" || typeof record.id === "number") && ("result" in record || "error" in record);
}

function parseJsonRpcResponse(body: string, expectedId: string): JsonRpcResponse {
  const candidates: unknown[] = [];
  const trimmed = body.trim();

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    const parsed = JSON.parse(trimmed) as unknown;
    candidates.push(...(Array.isArray(parsed) ? parsed : [parsed]));
  } else {
    const events = trimmed.split(/\r?\n\r?\n/);
    for (const event of events) {
      const data = event
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n")
        .trim();
      if (!data || data === "[DONE]") continue;
      const parsed = JSON.parse(data) as unknown;
      candidates.push(...(Array.isArray(parsed) ? parsed : [parsed]));
    }
  }

  const response = candidates.find(
    (candidate) => isJsonRpcResponse(candidate) && String(candidate.id) === expectedId
  );
  if (!isJsonRpcResponse(response)) {
    throw new Error("MCP response did not contain the matching JSON-RPC result.");
  }
  return { ...response, id: String(response.id) };
}

export class McpStreamableHttpClient {
  private connected = false;
  private initialized = false;
  private initializePromise: Promise<void> | null = null;
  private sessionId: string | null = null;
  private protocolVersion = LATEST_SUPPORTED_PROTOCOL_VERSION;
  private onLog?: (message: string) => void;

  constructor(private cfg: McpServerConfig) {}

  connect(onLog?: (message: string) => void) {
    this.onLog = onLog ?? this.onLog;
    this.connected = true;
  }

  close() {
    this.connected = false;
    this.initialized = false;
    this.initializePromise = null;
    this.sessionId = null;
  }

  isReusable() {
    return this.connected;
  }

  private getTimeoutMs() {
    const seconds =
      typeof this.cfg.toolTimeoutSecond === "number" && Number.isFinite(this.cfg.toolTimeoutSecond)
        ? Math.max(1, Math.round(this.cfg.toolTimeoutSecond))
        : DEFAULT_MCP_TOOL_TIMEOUT_SECOND;
    return seconds * 1000;
  }

  private requestUrl() {
    if (!this.cfg.useLocalProxy) return this.cfg.sseUrl;
    return `${LOCAL_PROXY_PATH}?url=${encodeURIComponent(this.cfg.sseUrl)}`;
  }

  private requestHeaders(method: string, params?: unknown) {
    const headers = new Headers({
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json"
    });
    if (this.cfg.authToken?.trim()) {
      headers.set("Authorization", `Bearer ${this.cfg.authToken.trim()}`);
    }
    for (const [name, value] of Object.entries(this.cfg.customHeaders ?? {})) {
      if (name.trim() && value.trim()) headers.set(name.trim(), value.trim());
    }
    if (this.initialized || method !== "initialize") {
      headers.set("MCP-Protocol-Version", this.protocolVersion);
    }
    if (this.sessionId) headers.set("MCP-Session-Id", this.sessionId);
    headers.set("Mcp-Method", method);
    if (method === "tools/call" && params && typeof params === "object" && !Array.isArray(params)) {
      const name = (params as Record<string, unknown>).name;
      if (typeof name === "string" && name.trim()) headers.set("Mcp-Name", name.trim());
    }
    return headers;
  }

  private async post(payload: JsonRpcRequest | JsonRpcNotification, expectReply: boolean): Promise<JsonRpcResponse | null> {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), this.getTimeoutMs());
    try {
      const response = await fetch(this.requestUrl(), {
        method: "POST",
        headers: this.requestHeaders(payload.method, payload.params),
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      if (!response.ok) {
        const details = (await response.text().catch(() => "")).trim().slice(0, 300);
        throw new Error(`MCP HTTP ${response.status}${details ? `: ${details}` : ""}`);
      }

      const sessionId = response.headers.get("Mcp-Session-Id");
      if (sessionId) this.sessionId = sessionId;
      if (!expectReply) return null;

      const body = await response.text();
      if (!body.trim()) throw new Error("MCP server returned an empty response.");
      return parseJsonRpcResponse(body, String((payload as JsonRpcRequest).id));
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new Error(`MCP request timed out after ${Math.round(this.getTimeoutMs() / 1000)}s`);
      }
      throw new Error(errorMessage(error));
    } finally {
      window.clearTimeout(timeoutId);
    }
  }

  private async ensureInitialized() {
    if (this.initialized) return;
    if (this.initializePromise) return this.initializePromise;

    this.initializePromise = (async () => {
      const id = generateId();
      const response = await this.post(
        {
          jsonrpc: "2.0",
          id,
          method: "initialize",
          params: {
            protocolVersion: LATEST_SUPPORTED_PROTOCOL_VERSION,
            capabilities: {},
            clientInfo: { name: "agent-go-round", version: "0.0.1" }
          }
        },
        true
      );
      if (response?.error) throw new Error(String(response.error));
      const result = response?.result;
      if (result && typeof result === "object" && !Array.isArray(result)) {
        const negotiatedVersion = (result as Record<string, unknown>).protocolVersion;
        if (typeof negotiatedVersion === "string" && negotiatedVersion.trim()) {
          this.protocolVersion = negotiatedVersion;
        }
      }
      this.initialized = true;
      await this.post({ jsonrpc: "2.0", method: "notifications/initialized" }, false);
      this.onLog?.(`MCP Streamable HTTP connected: ${redactMcpUrl(this.cfg.sseUrl)}`);
    })().catch((error) => {
      this.initialized = false;
      throw error;
    }).finally(() => {
      this.initializePromise = null;
    });

    return this.initializePromise;
  }

  async request(method: string, params?: unknown): Promise<JsonRpcResponse> {
    if (!this.connected) this.connect(this.onLog);
    await this.ensureInitialized();
    const id = generateId();
    const wireParams =
      method === "tools/call" && params && typeof params === "object" && !Array.isArray(params)
        ? (() => {
            const record = params as Record<string, unknown>;
            return "input" in record && !("arguments" in record)
              ? { ...record, arguments: record.input, input: undefined }
              : params;
          })()
        : params;
    try {
      const response = await this.post({ jsonrpc: "2.0", id, method, params: wireParams }, true);
      return response ?? { id, error: "MCP server returned no response." };
    } catch (error) {
      return { id, error: errorMessage(error) };
    }
  }
}
