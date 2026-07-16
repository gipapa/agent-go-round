import { afterEach, describe, expect, it, vi } from "vitest";
import { McpClientManager, type McpClientLike } from "../mcp/clientManager";
import type { McpServerConfig } from "../types";

class FakeClient implements McpClientLike {
  connectCalls = 0;
  closeCalls = 0;
  reusable = true;

  connect() {
    this.connectCalls += 1;
  }

  close() {
    this.closeCalls += 1;
    this.reusable = false;
  }

  isReusable() {
    return this.reusable;
  }

  async request() {
    return { id: "fake", result: {} };
  }
}

function server(patch: Partial<McpServerConfig> = {}): McpServerConfig {
  return {
    id: "mcp-1",
    name: "MCP One",
    sseUrl: "https://example.com/mcp/sse",
    ...patch
  };
}

describe("McpClientManager", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("reuses a live client for the same server settings", () => {
    const created: FakeClient[] = [];
    const manager = new McpClientManager({
      createClient: () => {
        const client = new FakeClient();
        created.push(client);
        return client;
      }
    });

    const first = manager.get(server());
    const second = manager.get(server());

    expect(first).toBe(second);
    expect(created).toHaveLength(1);
    expect(created[0].connectCalls).toBe(2);
  });

  it("rebuilds the client when connection settings change", () => {
    const created: FakeClient[] = [];
    const manager = new McpClientManager({
      createClient: () => {
        const client = new FakeClient();
        created.push(client);
        return client;
      }
    });

    manager.get(server());
    manager.get(server({ sseUrl: "https://example.com/other/sse" }));

    expect(created).toHaveLength(2);
    expect(created[0].closeCalls).toBe(1);
    expect(manager.activeClientCount()).toBe(1);
  });

  it("rebuilds the client when remote transport authentication changes", () => {
    const created: FakeClient[] = [];
    const manager = new McpClientManager({
      createClient: () => {
        const client = new FakeClient();
        created.push(client);
        return client;
      }
    });

    manager.get(server({ transport: "streamable_http", authToken: "first" }));
    manager.get(server({ transport: "streamable_http", authToken: "second" }));

    expect(created).toHaveLength(2);
    expect(created[0].closeCalls).toBe(1);
  });

  it("closes idle clients after the configured idle timeout", () => {
    vi.useFakeTimers();
    const created: FakeClient[] = [];
    const manager = new McpClientManager({
      idleMs: 1000,
      createClient: () => {
        const client = new FakeClient();
        created.push(client);
        return client;
      }
    });

    manager.get(server());
    expect(manager.activeClientCount()).toBe(1);

    vi.advanceTimersByTime(1000);

    expect(created[0].closeCalls).toBe(1);
    expect(manager.activeClientCount()).toBe(0);
  });
});
