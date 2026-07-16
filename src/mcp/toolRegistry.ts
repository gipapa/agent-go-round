import { McpTool } from "../types";
import type { McpClient } from "./client";

export type McpRequester = Pick<McpClient, "request">;

function isMcpTool(value: unknown): value is McpTool {
  return !!value && typeof value === "object" && typeof (value as { name?: unknown }).name === "string";
}

export async function listTools(client: McpRequester): Promise<McpTool[]> {
  const res = await client.request("tools/list");
  if (res.error) throw new Error(String(res.error));
  const tools = (res.result as { tools?: unknown } | undefined)?.tools;
  return Array.isArray(tools) ? tools.filter(isMcpTool) : [];
}

export async function callTool(client: McpRequester, name: string, input: unknown) {
  const res = await client.request("tools/call", { name, input });
  if (res.error) throw new Error(String(res.error));
  return res.result;
}
