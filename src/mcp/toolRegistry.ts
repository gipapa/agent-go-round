import { McpSseClient } from "./sseClient";

export type McpTool = {
  name: string;
  description?: string;
  inputSchema?: any;
};

export async function listTools(client: McpSseClient): Promise<McpTool[]> {
  const res = await client.request("tools/list");
  if (res.error) throw new Error(String(res.error));
  return res.result?.tools ?? [];
}

export async function callTool(client: McpSseClient, name: string, input: any) {
  const res = await client.request("tools/call", { name, input });
  if (res.error) throw new Error(String(res.error));
  return res.result;
}
