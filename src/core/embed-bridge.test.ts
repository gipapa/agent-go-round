import { describe, expect, it, vi } from "vitest";
import { EMBED_BRIDGE_VERSION, EMBED_SDK_VERSION, HostToolBridge, HostToolBridgeError, isSupportedEmbedBridgeVersion, isSupportedEmbedSdkVersion, type HostToolCall } from "./embed-bridge";
import { Type } from "@earendil-works/pi-ai";

function call(overrides: Partial<HostToolCall> = {}): HostToolCall {
  return {
    version: EMBED_BRIDGE_VERSION,
    instanceId: "widget-1",
    requestId: "request-1",
    sessionId: "session-1",
    toolCallId: "call-1",
    toolName: "lookup",
    args: { id: "order-1" },
    ...overrides
  };
}

describe("HostToolBridge", () => {
  it("fails closed for unsupported bridge and SDK versions", () => {
    expect(isSupportedEmbedBridgeVersion(EMBED_BRIDGE_VERSION)).toBe(true);
    expect(isSupportedEmbedBridgeVersion(EMBED_BRIDGE_VERSION + 1)).toBe(false);
    expect(isSupportedEmbedSdkVersion(EMBED_SDK_VERSION)).toBe(true);
    expect(isSupportedEmbedSdkVersion("0.1.0")).toBe(false);
  });

  it("exposes only registered tools and carries session/request identity", async () => {
    const bridge = new HostToolBridge("widget-1");
    const requests: unknown[] = [];
    bridge.register(
      { name: "lookup", label: "Lookup", description: "Read an order", parameters: { type: "object" } },
      async (request) => {
        requests.push({ instanceId: request.instanceId, requestId: request.requestId, sessionId: request.sessionId, toolCallId: request.toolCallId, args: request.args });
        return { state: "ready" };
      }
    );

    await expect(bridge.execute(call())).resolves.toMatchObject({ status: "success", result: { state: "ready" } });
    expect(requests).toEqual([{ instanceId: "widget-1", requestId: "request-1", sessionId: "session-1", toolCallId: "call-1", args: { id: "order-1" } }]);
    await expect(bridge.execute(call({ toolName: "delete" }))).resolves.toMatchObject({ status: "error", error: "Host tool delete is not allowed" });
    expect(bridge.list()).toHaveLength(1);
  });

  it("validates host arguments before running a registered side effect", async () => {
    const bridge = new HostToolBridge("widget-1");
    let executed = false;
    bridge.register(
      { name: "lookup", label: "Lookup", description: "Read an order", parameters: Type.Object({ id: Type.String({ minLength: 1 }) }) },
      async () => {
        executed = true;
        return { state: "ready" };
      }
    );

    await expect(bridge.execute(call({ args: { id: "" } }))).resolves.toMatchObject({ status: "error" });
    expect(executed).toBe(false);
  });

  it("rejects duplicate registrations and mismatched bridge identity", async () => {
    const bridge = new HostToolBridge("widget-1");
    const spec = { name: "lookup", label: "Lookup", description: "Read an order", parameters: {} };
    bridge.register(spec, () => "ok");
    expect(() => bridge.register(spec, () => "duplicate")).toThrow(HostToolBridgeError);
    await expect(bridge.execute(call({ instanceId: "other-widget" }))).resolves.toMatchObject({ status: "error", error: "Host tool bridge identity mismatch" });
    await expect(bridge.execute(call({ version: (EMBED_BRIDGE_VERSION - 1) as HostToolCall["version"] }))).resolves.toMatchObject({ status: "error", error: "Host tool bridge identity mismatch" });
  });

  it("supports explicit cancellation and marks timeout as unknown", async () => {
    const bridge = new HostToolBridge("widget-1");
    bridge.register(
      { name: "slow", label: "Slow", description: "Slow operation", parameters: {}, timeoutMs: 10 },
      ({ signal }) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason)))
    );
    const pending = bridge.execute(call({ requestId: "cancel-me", toolName: "slow" }));
    expect(bridge.cancel("cancel-me")).toBe(true);
    await expect(pending).resolves.toMatchObject({ status: "aborted" });

    bridge.register(
      { name: "timeout", label: "Timeout", description: "Never settles", parameters: {}, timeoutMs: 5 },
      () => new Promise(() => undefined)
    );
    await expect(bridge.execute(call({ requestId: "timeout-me", toolName: "timeout" }))).resolves.toMatchObject({ status: "outcome_unknown" });
  });

  it("requires an explicit approval handler for protected host tools", async () => {
    const bridge = new HostToolBridge("widget-1");
    await expect(bridge.approve({ ...call({ requestId: "" }), runId: "run-1", toolCallId: "call-1" })).resolves.toMatchObject({ approved: false, reason: "Host tool approval request is missing identity" });
    const approvals: string[] = [];
    bridge.registerWithApproval(
      { name: "mutate", label: "Mutate", description: "Change host state", parameters: {}, requiresApproval: true },
      async () => ({ changed: true }),
      async (request) => {
        approvals.push(`${request.sessionId}:${request.toolName}`);
        return true;
      }
    );
    const decision = await bridge.approve({ ...call({ toolName: "mutate" }), runId: "run-1", toolCallId: "call-1" });
    expect(decision).toMatchObject({ approved: true, approvalToken: expect.any(String) });
    expect(approvals).toEqual(["session-1:mutate"]);
    await expect(bridge.execute(call({ toolName: "mutate", approvalToken: decision.approvalToken }))).resolves.toMatchObject({ status: "success", result: { changed: true } });
    await expect(bridge.execute(call({ toolName: "mutate", requestId: "replay" }))).resolves.toMatchObject({ status: "error", error: "Host tool mutate requires approval" });

    const mismatched = await bridge.approve({ ...call({ toolName: "mutate", requestId: "approval-2", toolCallId: "call-2", args: { id: "order-2" } }), runId: "run-1", toolCallId: "call-2" });
    await expect(bridge.execute(call({ toolName: "mutate", requestId: "mismatched", toolCallId: "call-2", args: { id: "order-3" }, approvalToken: mismatched.approvalToken }))).resolves.toMatchObject({ status: "error", error: "Host tool approval does not match request" });

    const noApproval = new HostToolBridge("widget-1");
    noApproval.register({ name: "mutate", label: "Mutate", description: "Change host state", parameters: {}, requiresApproval: true }, async () => undefined);
    await expect(noApproval.approve({ ...call({ toolName: "mutate" }), runId: "run-1", toolCallId: "call-1" })).resolves.toMatchObject({ approved: false, reason: "Host tool approval is not configured" });
    await expect(noApproval.execute(call({ toolName: "mutate" }))).resolves.toMatchObject({ status: "error", error: "Host tool mutate requires approval" });
  });

  it("cancels a pending host approval without calling the tool", async () => {
    const bridge = new HostToolBridge("widget-1");
    bridge.registerWithApproval(
      { name: "mutate", label: "Mutate", description: "Change host state", parameters: {}, requiresApproval: true },
      async () => ({ changed: true }),
      () => new Promise<boolean>(() => undefined)
    );
    const pending = bridge.approve({ ...call({ toolName: "mutate", requestId: "approval-cancel" }), runId: "run-1", toolCallId: "call-1" });
    expect(bridge.cancelApproval("approval-cancel")).toBe(true);
    await expect(pending).resolves.toMatchObject({ approved: false, reason: "Host tool approval denied" });
  });

  it("expires approval tokens before dispatch", async () => {
    vi.useFakeTimers();
    try {
      const bridge = new HostToolBridge("widget-1");
      bridge.registerWithApproval(
        { name: "mutate", label: "Mutate", description: "Change host state", parameters: {}, requiresApproval: true },
        async () => ({ changed: true }),
        async () => true
      );
      const decision = await bridge.approve({ ...call({ toolName: "mutate", requestId: "approval-expiring" }), runId: "run-1", toolCallId: "call-1" });
      vi.advanceTimersByTime(60_001);
      await expect(bridge.execute(call({ toolName: "mutate", approvalToken: decision.approvalToken }))).resolves.toMatchObject({ status: "error", error: "Host tool approval has expired" });
    } finally {
      vi.useRealTimers();
    }
  });
});
