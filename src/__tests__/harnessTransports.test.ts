import { describe, expect, it } from "vitest";
import {
  createAdapterTextTransport,
  createAdapterNativeToolTransport,
  createNativeToolTransport,
  createTextActionTransport,
  normalizeNativeToolStream,
  type TextTransportEvent
} from "../runtime/harness/transports";
import type { HarnessModelContext } from "../runtime/harness/types";
import type { AgentAdapter } from "../adapters/base";

const context = { system: "", messages: [], tools: [], chars: 0 } satisfies HarnessModelContext;

async function* events(items: TextTransportEvent[]) {
  yield* items;
}

describe("harness transports", () => {
  it("normalizes strict text actions and normal answers", async () => {
    const transport = createTextActionTransport({
      maxModelResponseChars: 100,
      invoke: async (_context, _signal) => ({
        candidateId: "text-1",
        events: events([{ type: "delta", text: '{"type":"tool_call","toolId":"x","input":{}}' }])
      })
    });
    await expect(transport.runStep(context, new AbortController().signal)).resolves.toMatchObject({ status: "step", step: { type: "tool_call", toolId: "x" } });
  });

  it("converts malformed text actions and oversized streams into typed outcomes", async () => {
    const malformed = createTextActionTransport({
      maxModelResponseChars: 100,
      invoke: async () => ({ candidateId: "text-1", events: events([{ type: "done", text: '{"type":"tool_call"}' }]) })
    });
    await expect(malformed.runStep(context, new AbortController().signal)).resolves.toMatchObject({ status: "protocol_error" });

    const oversized = createTextActionTransport({
      maxModelResponseChars: 4,
      invoke: async () => ({ candidateId: "text-1", events: events([{ type: "delta", text: "12345" }]) })
    });
    await expect(oversized.runStep(context, new AbortController().signal)).resolves.toMatchObject({ status: "transport_error", kind: "response_limit" });

    const oversizedDone = createTextActionTransport({
      maxModelResponseChars: 4,
      invoke: async () => ({ candidateId: "text-1", events: events([{ type: "done", text: "12345" }]) })
    });
    await expect(oversizedDone.runStep(context, new AbortController().signal)).resolves.toMatchObject({ status: "transport_error", kind: "response_limit" });

    const malformedEvent = createTextActionTransport({
      maxModelResponseChars: 100,
      invoke: async () => ({
        candidateId: "text-1",
        events: events([{ type: "error", kind: "provider", retryable: "yes" as never, message: "bad event" } as never])
      })
    });
    await expect(malformedEvent.runStep(context, new AbortController().signal)).resolves.toMatchObject({ status: "protocol_error" });
  });

  it("accumulates one native tool call and rejects multiple/truncated calls without dispatch", () => {
    expect(normalizeNativeToolStream({
      candidateId: "native-1",
      events: [
        { type: "tool_call_delta", call: { index: 0, name: "x", arguments: "{\"value\":" } },
        { type: "tool_call_delta", call: { index: 0, arguments: "2}" } },
        { type: "done", finishReason: "tool_calls" }
      ]
    })).toMatchObject({ status: "step", step: { type: "tool_call", toolId: "x", input: { value: 2 } } });
    expect(normalizeNativeToolStream({
      candidateId: "native-1",
      events: [
        { type: "tool_call_delta", call: { index: 0, name: "x", arguments: "{}" } },
        { type: "tool_call_delta", call: { index: 1, name: "y", arguments: "{}" } },
        { type: "done", finishReason: "tool_calls" }
      ]
    })).toMatchObject({ status: "protocol_error" });
    expect(normalizeNativeToolStream({
      candidateId: "native-1",
      events: [{ type: "tool_call_delta", call: { index: 0, name: "x", arguments: "{" } }, { type: "done", finishReason: "length" }]
    })).toMatchObject({ status: "protocol_error" });
  });

  it("exposes native transport through the common HarnessTransport shape", async () => {
    const transport = createNativeToolTransport({
      invoke: async () => ({ candidateId: "native-1", events: [{ type: "text_delta" as const, text: "answer" }, { type: "done" as const }] })
    });
    await expect(transport.runStep(context, new AbortController().signal)).resolves.toMatchObject({ status: "step", step: { type: "final" } });

    const empty = createNativeToolTransport({
      invoke: async () => ({ candidateId: "native-empty", events: [{ type: "done" as const }] })
    });
    await expect(empty.runStep(context, new AbortController().signal)).resolves.toMatchObject({ status: "transport_error", kind: "empty" });

    const limited = createNativeToolTransport({
      maxModelResponseChars: 4,
      invoke: async () => ({ candidateId: "native-1", events: [{ type: "text_delta" as const, text: "12345" }] })
    });
    await expect(limited.runStep(context, new AbortController().signal)).resolves.toMatchObject({ status: "transport_error", kind: "response_limit" });

    const tooManyEvents = createNativeToolTransport({
      invoke: async () => ({
        candidateId: "native-1",
        events: (function* () {
          for (let index = 0; index < 10_001; index += 1) yield { type: "done" as const };
        })()
      })
    });
    await expect(tooManyEvents.runStep(context, new AbortController().signal)).resolves.toMatchObject({ status: "transport_error", kind: "response_limit" });

    const malformedDirect = createNativeToolTransport({
      invoke: async () => ({ candidateId: "native-invalid", events: [{ type: "tool_call_delta" as const, call: { index: -1 } }] })
    });
    await expect(malformedDirect.runStep(context, new AbortController().signal)).resolves.toMatchObject({ status: "protocol_error" });
  });

  it("renders canonical tool results into a text adapter request without dropping them", async () => {
    let received = "";
    let receivedSystem = "";
    let receivedMaxResponseChars: number | undefined;
    const adapter: AgentAdapter = {
      async *chat(request) {
        received = request.input;
        receivedSystem = request.system ?? "";
        receivedMaxResponseChars = request.maxModelResponseChars;
        yield { type: "done", text: "final answer" };
      }
    };
    const transport = createAdapterTextTransport({
      adapter,
      agent: { id: "agent", name: "Agent", type: "custom" },
      candidateId: "custom-1",
      maxModelResponseChars: 100
    });
    const result = await transport.runStep({
      ...context,
      messages: [
        { role: "user", content: "goal" },
        { role: "assistant", content: "", protocolValid: true, action: { callId: "c1", toolId: "x", input: {}, origin: "model" } },
        { role: "tool", callId: "c1", toolId: "x", outcome: "success", modelContent: "untrusted result" }
      ]
    }, new AbortController().signal);
    expect(result).toMatchObject({ status: "step", step: { type: "final", answer: "final answer" } });
    expect(received).toContain("untrusted result");
    expect(received).toContain('"toolId":"x"');
    expect(received).toContain('"input":{}');
    expect(receivedSystem).toContain("TEXT_ACTION");
    expect(receivedSystem).toContain("ACTIVE_SKILL_INSTRUCTIONS");
    expect(receivedSystem).toContain("UNTRUSTED_TOOL_CATALOG");
    expect(receivedMaxResponseChars).toBe(100);
  });

  it("retries empty adapter text responses using the candidate retry policy", async () => {
    let calls = 0;
    const logs: string[] = [];
    const adapter: AgentAdapter = {
      async *chat() {
        calls += 1;
        yield { type: "done", text: calls === 1 ? "" : "recovered" };
      }
    };
    const transport = createAdapterTextTransport({
      adapter,
      agent: { id: "agent", name: "Agent", type: "openai_compat" },
      candidateId: "text-retry",
      retry: { delaySec: 0, max: 1 },
      onLog: (text) => logs.push(text),
      maxModelResponseChars: 100
    });

    await expect(transport.runStep(context, new AbortController().signal)).resolves.toMatchObject({
      status: "step",
      step: { type: "final", answer: "recovered" }
    });
    expect(calls).toBe(2);
    expect(logs).toEqual([expect.stringContaining("retry 1/1")]);
  });

  it("stops retrying empty adapter text responses at the configured limit", async () => {
    let calls = 0;
    const adapter: AgentAdapter = {
      async *chat() {
        calls += 1;
        yield { type: "done", text: "" };
      }
    };
    const transport = createAdapterTextTransport({
      adapter,
      agent: { id: "agent", name: "Agent", type: "openai_compat" },
      candidateId: "text-retry-exhausted",
      retry: { delaySec: 0, max: 2 },
      maxModelResponseChars: 100
    });

    await expect(transport.runStep(context, new AbortController().signal)).resolves.toMatchObject({
      status: "transport_error",
      kind: "empty"
    });
    expect(calls).toBe(3);
  });

  it("keeps native historical calls paired with structured tool outcomes", async () => {
    let received: import("../adapters/base").NativeChatMessage[] = [];
    const adapter: AgentAdapter = {
      async *chat() { yield { type: "done", text: "unused" }; },
      async *nativeChat(request) {
        received = request.messages;
        yield { type: "text_delta", text: "done" };
        yield { type: "done", finishReason: "stop" };
      }
    };
    const transport = createAdapterNativeToolTransport({
      adapter,
      agent: { id: "agent", name: "Agent", type: "openai_compat" },
      candidateId: "native-history",
      maxModelResponseChars: 100
    });
    await transport.runStep({
      ...context,
      system: "SYSTEM POLICY",
      messages: [
        { role: "user", content: "goal" },
        { role: "assistant", content: "trying", protocolValid: true, action: { callId: "c1", toolId: "x", input: { value: 1 }, origin: "model" } },
        { role: "tool", callId: "c1", toolId: "x", outcome: "failed", errorCode: "invalid_arguments", modelContent: "bad args" }
      ]
    }, new AbortController().signal);
    const assistant = received.find((message) => message.role === "assistant");
    const toolMessage = received.find((message) => message.role === "tool");
    expect(received[0]).toEqual({ role: "system", content: "SYSTEM POLICY" });
    expect(assistant).toMatchObject({ role: "assistant", tool_calls: [{ id: "agr_call_0" }] });
    expect((assistant as Extract<typeof assistant, { role: "assistant" }>)?.tool_calls?.[0]?.function.arguments).toBe('{"value":1}');
    expect(toolMessage).toMatchObject({ role: "tool", tool_call_id: "agr_call_0" });
    expect(toolMessage?.role === "tool" ? toolMessage.content : "").toContain("invalid_arguments");
  });

  it("passes a transport tool-choice policy to native adapters", async () => {
    let receivedToolChoice: string | undefined;
    const adapter: AgentAdapter = {
      async *chat() { yield { type: "done", text: "unused" }; },
      async *nativeChat(request) {
        receivedToolChoice = request.toolChoice;
        yield { type: "text_delta", text: "done" };
        yield { type: "done", finishReason: "stop" };
      }
    };
    const transport = createAdapterNativeToolTransport({
      adapter,
      agent: { id: "agent", name: "Agent", type: "openai_compat" },
      candidateId: "native-choice",
      toolChoice: () => "required",
      maxModelResponseChars: 100
    });
    await expect(transport.runStep(context, new AbortController().signal)).resolves.toMatchObject({
      status: "step",
      step: { type: "final", answer: "done" }
    });
    expect(receivedToolChoice).toBe("required");
  });

  it("rejects a native tool finish reason without a tool payload", () => {
    expect(normalizeNativeToolStream({
      candidateId: "native-empty-call",
      events: [{ type: "done", finishReason: "tool_calls" }]
    })).toMatchObject({ status: "protocol_error" });
  });

  it("fails closed on malformed native stream events and bounds direct normalization", () => {
    expect(normalizeNativeToolStream({
      candidateId: "native-invalid-index",
      events: [{ type: "tool_call_delta", call: { index: -1, name: "x", arguments: "{}" } }]
    })).toMatchObject({ status: "protocol_error" });
    expect(normalizeNativeToolStream({
      candidateId: "native-invalid-event",
      events: [{ type: "unexpected" } as never]
    })).toMatchObject({ status: "protocol_error" });
    expect(normalizeNativeToolStream({
      candidateId: "native-invalid-error",
      events: [{ type: "error", kind: "provider", retryable: "yes", message: "bad event" } as never]
    })).toMatchObject({ status: "protocol_error" });
    expect(normalizeNativeToolStream({
      candidateId: "native-default-limit",
      events: [{ type: "text_delta", text: "x".repeat(64_001) }]
    })).toMatchObject({ status: "transport_error", kind: "response_limit" });
  });

  it("contains transport invocation and stream failures as typed provider errors", async () => {
    const throwingText = createTextActionTransport({
      maxModelResponseChars: 100,
      invoke: async () => { throw new Error("text transport exploded"); }
    });
    await expect(throwingText.runStep(context, new AbortController().signal)).resolves.toMatchObject({
      status: "transport_error",
      kind: "provider",
      retryable: false,
      message: "text transport exploded"
    });

    const throwingNative = createNativeToolTransport({
      invoke: async () => ({
        candidateId: "native-throwing-stream",
        events: (async function* () {
          throw new Error("native stream exploded");
        })()
      })
    });
    await expect(throwingNative.runStep(context, new AbortController().signal)).resolves.toMatchObject({
      status: "transport_error",
      kind: "provider",
      retryable: false,
      message: "native stream exploded"
    });
  });

  it("uses provider-safe aliases for native tools and maps back to canonical ids", async () => {
    let receivedToolName = "";
    const adapter: AgentAdapter = {
      async *chat() { yield { type: "done", text: "unused" }; },
      async *nativeChat(request) {
        receivedToolName = request.tools[0].function.name;
        yield { type: "tool_call_delta", call: { index: 0, name: receivedToolName, arguments: "{}" } };
        yield { type: "done", finishReason: "tool_calls" };
      }
    };
    const transport = createAdapterNativeToolTransport({
      adapter,
      agent: { id: "agent", name: "Agent", type: "openai_compat" },
      candidateId: "native-1",
      maxModelResponseChars: 100
    });
    const nativeTool = {
      id: "mcp:server:open",
      description: "Open",
      inputSchema: { type: "object" as const },
      intent: "observe" as const,
      idempotency: "idempotent" as const,
      cancellation: "cooperative" as const,
      requireConfirmation: false,
      executionKind: "mcp" as const
    };
    const result = await transport.runStep({ ...context, tools: [nativeTool] }, new AbortController().signal);
    expect(receivedToolName).toBe("agr_tool_0");
    expect(result).toMatchObject({ status: "step", step: { type: "tool_call", toolId: "mcp:server:open" } });
  });
});
