import { afterEach, describe, expect, it, vi } from "vitest";
import {
  callMcpToolWithTimeout,
  getMcpToolTimeoutMs,
  McpToolExecutionError
} from "../runtime/toolExecution";
import type { McpServerConfig } from "../types";

function server(toolTimeoutSecond?: number): McpServerConfig {
  return { id: "mcp", name: "MCP", sseUrl: "https://example.com/mcp", toolTimeoutSecond };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("tool execution runtime", () => {
  it("keeps configured MCP timeout behavior", () => {
    expect(getMcpToolTimeoutMs(server(12), "browser_open")).toBe(12000);
    expect(getMcpToolTimeoutMs(server(0), "browser_open")).toBe(1000);
    expect(getMcpToolTimeoutMs(server(), "browser_open")).toBe(45000);
    expect(getMcpToolTimeoutMs(server(), "browser_snapshot")).toBe(30000);
  });

  it("returns MCP results and rejects stalled calls at the deadline", async () => {
    const successfulClient = {
      request: vi.fn(async () => ({ id: "ok", result: { value: 42 } }))
    };
    await expect(callMcpToolWithTimeout(successfulClient, "read", {}, 1000)).resolves.toEqual({ value: 42 });

    vi.useFakeTimers();
    const stalledClient = {
      request: vi.fn(() => new Promise<never>(() => {}))
    };
    const pending = callMcpToolWithTimeout(stalledClient, "read", {}, 2000);
    const assertion = expect(pending).rejects.toBeInstanceOf(McpToolExecutionError);
    await vi.advanceTimersByTimeAsync(2000);
    await assertion;
  });

});
