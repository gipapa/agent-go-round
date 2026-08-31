import { describe, expect, it } from "vitest";
import { evaluateTextCapabilityProbe, getTextCapabilityRevision, negotiateToolCallingCapability, probeNativeCapability, probeTextCapability, TextCapabilityProbeCache } from "../runtime/harness/capability";
import { normalizeToolTransportPolicy } from "../types";
import type { AgentAdapter } from "../adapters/base";

describe("harness capability probes", () => {
  it("normalizes legacy and unknown persisted policies fail-closed", () => {
    expect(normalizeToolTransportPolicy("native")).toBe("native_only");
    expect(normalizeToolTransportPolicy("text_protocol")).toBe("text_only");
    expect(normalizeToolTransportPolicy("auto")).toBe("auto");
    expect(normalizeToolTransportPolicy("forged" as never)).toBe("disabled");
    expect(normalizeToolTransportPolicy(undefined)).toBe("disabled");
  });

  it("requires an exact side-effect-free text action envelope", () => {
    expect(evaluateTextCapabilityProbe({ response: '{"type":"tool_call","toolId":"probe","input":{}}', expectedToolId: "probe" })).toMatchObject({ capability: "text_protocol", ok: true });
    expect(evaluateTextCapabilityProbe({ response: "narrative {\"type\":\"tool_call\",\"toolId\":\"probe\",\"input\":{}}", expectedToolId: "probe" })).toMatchObject({ capability: "none", ok: false });
    expect(evaluateTextCapabilityProbe({ response: '{"type":"tool_call","toolId":"other","input":{}}', expectedToolId: "probe" })).toMatchObject({ capability: "none", ok: false });
  });

  it("probes through the typed text transport and caches by candidate revision", async () => {
    const cache = new TextCapabilityProbeCache();
    const calls = { count: 0 };
    const adapter: AgentAdapter = {
      async *chat() {
        calls.count += 1;
        yield { type: "done", text: '{"type":"tool_call","toolId":"internal:capability.probe","input":{}}' };
      }
    };
    const args = {
      candidateId: "candidate-1",
      agent: { id: "agent", name: "Agent", type: "custom" as const },
      adapter,
      revision: "template-v1",
      cache
    };
    await expect(probeTextCapability(args)).resolves.toMatchObject({ capability: "text_protocol", ok: true, cached: false });
    await expect(probeTextCapability(args)).resolves.toMatchObject({ capability: "text_protocol", ok: true, cached: true });
    expect(calls.count).toBe(1);
  });

  it("invalidates capability revisions without exposing credential material", () => {
    const first = getTextCapabilityRevision({
      id: "agent",
      name: "Agent",
      type: "openai_compat",
      endpoint: "https://example.com/v1",
      apiKey: "secret-a",
      headers: { "X-Provider-Key": "header-a" },
      model: "model-a"
    });
    const second = getTextCapabilityRevision({
      id: "agent",
      name: "Agent",
      type: "openai_compat",
      endpoint: "https://example.com/v1",
      apiKey: "secret-b",
      headers: { "X-Provider-Key": "header-b" },
      model: "model-a"
    });

    expect(second).not.toBe(first);
    expect(first).not.toContain("secret-a");
    expect(first).not.toContain("header-a");
  });

  it("does not cache transient text probe failures", async () => {
    let calls = 0;
    const adapter: AgentAdapter = {
      async *chat() {
        calls += 1;
        yield { type: "error", kind: "network", retryable: true, message: "temporary network failure" };
      }
    };
    const args = {
      candidateId: "transient-candidate",
      agent: { id: "agent", name: "Agent", type: "openai_compat" as const },
      adapter,
      cache: new TextCapabilityProbeCache()
    };

    await expect(probeTextCapability(args)).resolves.toMatchObject({ status: "unknown", cached: false });
    await expect(probeTextCapability(args)).resolves.toMatchObject({ status: "unknown", cached: false });
    expect(calls).toBe(2);
  });

  it("does not classify a narrative response as a compatible text candidate", async () => {
    const adapter: AgentAdapter = {
      async *chat() {
        yield { type: "done", text: "I can use tools: {\"type\":\"tool_call\",\"toolId\":\"internal:capability.probe\",\"input\":{}}" };
      }
    };
    await expect(probeTextCapability({
      candidateId: "candidate-narrative",
      agent: { id: "agent", name: "Agent", type: "custom" },
      adapter,
      cache: new TextCapabilityProbeCache()
    })).resolves.toMatchObject({ capability: "none", ok: false });
  });

  it("fails closed before network when a custom template cannot carry the protocol", async () => {
    const adapter: AgentAdapter = {
      chat: async function* () {
        throw new Error("custom probe should not reach the network");
      }
    };
    await expect(probeTextCapability({
      candidateId: "custom-missing-system",
      agent: {
        id: "agent",
        name: "Agent",
        type: "custom",
        custom: {
          method: "POST",
          url: "https://example.com",
          bodyTemplate: "{\"input\":\"{{input}}\"}",
          responseJsonPath: "$.answer"
        }
      },
      adapter,
      cache: new TextCapabilityProbeCache()
    })).resolves.toMatchObject({ capability: "none", ok: false });
  });

  it("selects native transport only after a no-side-effect native probe", async () => {
    const adapter: AgentAdapter = {
      async *chat() {
        throw new Error("text probe should not run");
      },
      async *nativeChat() {
        yield { type: "tool_call_delta", call: { index: 0, name: "agr_tool_0", id: "probe-call", arguments: "{}" } };
        yield { type: "done", finishReason: "tool_calls" };
      }
    };
    await expect(probeNativeCapability({
      candidateId: "native-candidate",
      agent: { id: "agent", name: "Agent", type: "openai_compat" },
      adapter,
      cache: new TextCapabilityProbeCache()
    })).resolves.toMatchObject({ capability: "native", ok: true, status: "supported" });
  });

  it("falls back from an unsupported native probe to a strict text probe", async () => {
    const adapter: AgentAdapter = {
      async *chat() {
        yield { type: "done", text: '{"type":"tool_call","toolId":"internal:capability.probe","input":{}}' };
      },
      async *nativeChat() {
        yield { type: "error", kind: "http", retryable: false, message: "HTTP 400\nTool calling is not supported" };
      }
    };
    await expect(negotiateToolCallingCapability({
      policy: "auto",
      candidateId: "fallback-candidate",
      agent: { id: "agent", name: "Agent", type: "openai_compat" },
      adapter,
      cache: new TextCapabilityProbeCache()
    })).resolves.toMatchObject({ capability: "text_protocol", ok: true, status: "supported" });
  });

  it("treats a native probe that returns ordinary text as unsupported", async () => {
    const adapter: AgentAdapter = {
      async *chat() {
        yield { type: "done", text: '{"type":"tool_call","toolId":"internal:capability.probe","input":{}}' };
      },
      async *nativeChat() {
        yield { type: "text_delta", text: "I cannot call tools." };
        yield { type: "done", finishReason: "stop" };
      }
    };

    await expect(negotiateToolCallingCapability({
      policy: "auto",
      candidateId: "text-fallback-candidate",
      agent: { id: "agent", name: "Agent", type: "openai_compat" },
      adapter,
      cache: new TextCapabilityProbeCache()
    })).resolves.toMatchObject({ capability: "text_protocol", ok: true, status: "supported" });
  });
});
