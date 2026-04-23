import { McpTool } from "../types";
import { McpSseClient } from "./sseClient";

function isMcpTool(value: unknown): value is McpTool {
  return !!value && typeof value === "object" && typeof (value as { name?: unknown }).name === "string";
}

export async function listTools(client: McpSseClient): Promise<McpTool[]> {
  const res = await client.request("tools/list");
  if (res.error) throw new Error(String(res.error));
  const tools = (res.result as { tools?: unknown } | undefined)?.tools;
  return Array.isArray(tools) ? tools.filter(isMcpTool) : [];
}

export async function callTool(client: McpSseClient, name: string, input: unknown) {
  const res = await client.request("tools/call", { name, input });
  if (res.error) throw new Error(String(res.error));
  return res.result;
}
