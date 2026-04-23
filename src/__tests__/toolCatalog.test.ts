import { describe, expect, it, vi } from "vitest";
import { McpClientManager } from "../mcp/clientManager";
import { McpToolCatalog } from "../mcp/toolCatalog";
import type { McpClientLike } from "../mcp/clientManager";
import type { McpServerConfig } from "../types";

function server(): McpServerConfig {
  return {
    id: "mcp-1",
    name: "MCP One",
    sseUrl: "https://example.com/mcp/sse"
  };
}

function createClient(): McpClientLike {
  return {
    connect() {},
    close() {},
    async request() {
      return {
        id: "tools-list",
        result: {
          tools: [{ name: "echo" }]
        }
      };
    }
  };
}

describe("McpToolCatalog", () => {
  it("deduplicates concurrent tools/list loads for the same server", async () => {
    const catalog = new McpToolCatalog();
    const client = createClient();
    const manager = new McpClientManager({ createClient: () => client });
    const runSpy = vi.spyOn(manager, "run");

    const [first, second, third] = await Promise.all([
      catalog.load(server(), manager),
      catalog.load(server(), manager),
      catalog.load(server(), manager)
    ]);

    expect(first).toEqual([{ name: "echo" }]);
    expect(second).toBe(first);
    expect(third).toBe(first);
    expect(runSpy).toHaveBeenCalledTimes(1);
    manager.closeAll();
  });

  it("uses the cached tool list until invalidated", async () => {
    const catalog = new McpToolCatalog();
    const manager = new McpClientManager({ createClient });
    const runSpy = vi.spyOn(manager, "run");

    await catalog.load(server(), manager);
    await catalog.load(server(), manager);
    expect(runSpy).toHaveBeenCalledTimes(1);

    catalog.invalidate("mcp-1");
    await catalog.load(server(), manager);
    expect(runSpy).toHaveBeenCalledTimes(2);
    manager.closeAll();
  });
});
