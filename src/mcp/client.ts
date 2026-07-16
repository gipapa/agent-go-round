import type { McpServerConfig } from "../types";
import { McpSseClient } from "./sseClient";
import { McpStreamableHttpClient } from "./streamableHttpClient";

export type McpClient = Pick<McpSseClient, "connect" | "close" | "request"> & {
  isReusable?: () => boolean;
};

export function createMcpClient(server: McpServerConfig): McpClient {
  return server.transport === "streamable_http"
    ? new McpStreamableHttpClient(server)
    : new McpSseClient(server);
}
