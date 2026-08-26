import { describe, expect, it } from "vitest";
import { evaluateTextCapabilityProbe, normalizeToolCallingCapability, probeTextCapability, TextCapabilityProbeCache } from "../runtime/harness/capability";
import type { AgentAdapter } from "../adapters/base";

describe("harness capability probes", () => {
  it("normalizes unknown persisted capabilities to none", () => {
    expect(normalizeToolCallingCapability("native")).toBe("native");
    expect(normalizeToolCallingCapability("text_protocol")).toBe("text_protocol");
    expect(normalizeToolCallingCapability("forged" as never)).toBe("none");
    expect(normalizeToolCallingCapability(undefined)).toBe("none");
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
});
