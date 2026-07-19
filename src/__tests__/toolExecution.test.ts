import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildObservationSignature,
  buildToolActionSignature,
  callMcpToolWithTimeout,
  classifyMcpToolIntent,
  getMcpToolTimeoutMs
} from "../runtime/toolExecution";
import type { McpServerConfig } from "../types";

function server(toolTimeoutSecond?: number): McpServerConfig {
  return { id: "mcp", name: "MCP", sseUrl: "https://example.com/mcp", toolTimeoutSecond };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("tool execution runtime", () => {
  it("builds stable action signatures while ignoring transient fields", () => {
    const first = buildToolActionSignature({
      kind: "mcp",
      serverId: "browser",
      toolName: "browser_open",
      input: { url: "https://example.com", headed: false, requestId: "one", nested: { b: 2, a: 1 } }
    });
    const second = buildToolActionSignature({
      kind: "mcp",
      serverId: "browser",
      toolName: "browser_open",
      input: { nested: { a: 1, b: 2 }, session: "temporary", url: "https://example.com" }
    });

    expect(first).toBe(second);
  });

  it("deduplicates equivalent observations despite key order and transient metadata", () => {
    expect(buildObservationSignature({ title: "Page", data: { b: 2, a: 1 }, timestamp: 1 })).toBe(
      buildObservationSignature({ data: { a: 1, b: 2 }, title: "Page", timestamp: 999 })
    );
  });

  it("keeps configured and heuristic MCP timeout behavior", () => {
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
    const assertion = expect(pending).rejects.toThrow("MCP tool timed out after 2s");
    await vi.advanceTimersByTimeAsync(2000);
    await assertion;
  });

  it("classifies control, observation, and state-changing tools", () => {
    expect(classifyMcpToolIntent({ name: "request_confirmation", description: "Ask user for approval" })).toBe("control");
    expect(classifyMcpToolIntent({ name: "browser_snapshot", description: "Read current content" })).toBe("observe");
    expect(classifyMcpToolIntent({ name: "browser_click", description: "Click a target" })).toBe("state_change");
    expect(classifyMcpToolIntent({ name: "unknown", description: "Unknown behavior" })).toBe("state_change");
  });
});
