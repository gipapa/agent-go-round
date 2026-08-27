import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenAICompatAdapter } from "../adapters/openaiCompat";
import type { ChatRequest, NativeChatRequest } from "../adapters/base";

const request: NativeChatRequest = {
  agent: { id: "agent", name: "Agent", type: "openai_compat", endpoint: "https://example.com/v1", model: "model" },
  messages: [{ role: "user", content: "open the page" }],
  tools: [{ type: "function", function: { name: "mcp:browser:open", description: "Open", parameters: { type: "object" } } }]
};

describe("OpenAI-compatible native adapter", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("normalizes native tool calls without converting them to assistant text", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { tools?: unknown[]; max_tokens?: number };
      expect(body.tools).toHaveLength(1);
      expect(body.max_tokens).toBe(4_096);
      return new Response(JSON.stringify({
        choices: [{
          message: { content: "", tool_calls: [{ id: "call-1", type: "function", function: { name: "mcp:browser:open", arguments: "{\"url\":\"https://example.com\"}" } }] },
          finish_reason: "tool_calls"
        }]
      }), { headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const events = [];
    for await (const event of OpenAICompatAdapter.nativeChat!(request)) events.push(event);
    expect(events).toEqual([
      { type: "tool_call_delta", call: { index: 0, id: "call-1", name: "mcp:browser:open", arguments: "{\"url\":\"https://example.com\"}" } },
      { type: "done", finishReason: "tool_calls" }
    ]);
  });

  it("requests low reasoning for Groq GPT-OSS native calls", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { reasoning_effort?: string; max_tokens?: number };
      expect(body.reasoning_effort).toBe("low");
      expect(body.max_tokens).toBe(1_024);
      return new Response(JSON.stringify({ choices: [{ message: { content: "done" }, finish_reason: "stop" }] }), {
        headers: { "content-type": "application/json" }
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const events = [];
    for await (const event of OpenAICompatAdapter.nativeChat!({
      ...request,
      agent: { ...request.agent, model: "openai/gpt-oss-20b" }
    })) events.push(event);
    expect(events).toEqual([{ type: "text_delta", text: "done" }, { type: "done", finishReason: "stop" }]);
  });

  it("reports HTTP failures as typed errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("unavailable", { status: 503 })));
    const events = [];
    for await (const event of OpenAICompatAdapter.nativeChat!(request)) events.push(event);
    expect(events).toEqual([{ type: "error", kind: "http", retryable: true, message: "HTTP 503\nunavailable" }]);
  });

  it("does not retry organization-wide daily token limits", async () => {
    const fetchMock = vi.fn(async () => new Response(
      '{"error":{"message":"tokens per day (TPD) limit reached"}}',
      { status: 429 }
    ));
    vi.stubGlobal("fetch", fetchMock);
    const events = [];
    for await (const event of OpenAICompatAdapter.nativeChat!({ ...request, retry: { max: 3, delaySec: 0 } })) events.push(event);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(events).toEqual([{
      type: "error",
      kind: "rate_limit",
      retryable: false,
      message: "HTTP 429\n{\"error\":{\"message\":\"tokens per day (TPD) limit reached\"}}"
    }]);
  });

  it("retries an empty native stream before yielding a later tool call", async () => {
    const onLog = vi.fn();
    const fetchMock = vi.fn(async () => {
      if (fetchMock.mock.calls.length === 1) {
        return new Response("data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
      }
      return new Response(
        `data: ${JSON.stringify({
          choices: [{
            delta: { tool_calls: [{ index: 0, id: "call-2", function: { name: "mcp:browser:open", arguments: "{}" } }] },
            finish_reason: "tool_calls"
          }]
        })}\n\n`,
        { headers: { "content-type": "text/event-stream" } }
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const events = [];
    for await (const event of OpenAICompatAdapter.nativeChat!({ ...request, retry: { max: 1, delaySec: 0 }, onLog })) events.push(event);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(onLog).toHaveBeenCalledWith("[retry] native empty response, attempt 1/1, waiting 0s");
    expect(events).toEqual([
      { type: "tool_call_delta", call: { index: 0, id: "call-2", name: "mcp:browser:open", arguments: "{}" } },
      { type: "done", finishReason: "tool_calls" }
    ]);
  });

  it("returns a typed empty error after native empty-response retries are exhausted", async () => {
    const fetchMock = vi.fn(async () => new Response("data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } }));
    vi.stubGlobal("fetch", fetchMock);

    const events = [];
    for await (const event of OpenAICompatAdapter.nativeChat!({ ...request, retry: { max: 1, delaySec: 0 } })) events.push(event);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(events).toEqual([{ type: "error", kind: "empty", retryable: true, message: "Native model returned an empty response." }]);
  });

  it("retries an empty non-streaming native completion", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      choices: [{
        message: { content: fetchMock.mock.calls.length === 1 ? "" : "recovered" },
        finish_reason: "stop"
      }]
    }), { headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const events = [];
    for await (const event of OpenAICompatAdapter.nativeChat!({ ...request, retry: { max: 1, delaySec: 0 } })) events.push(event);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(events).toEqual([{ type: "text_delta", text: "recovered" }, { type: "done", finishReason: "stop" }]);
  });

  it("does not retry a native stream that produced partial tool-call payload", async () => {
    const fetchMock = vi.fn(async () => new Response(
      `data: ${JSON.stringify({
        choices: [{
          delta: { tool_calls: [{ index: 0, function: { name: "mcp:browser:open", arguments: "{" } }] },
          finish_reason: "length"
        }]
      })}\n\n`,
      { headers: { "content-type": "text/event-stream" } }
    ));
    vi.stubGlobal("fetch", fetchMock);

    const events = [];
    for await (const event of OpenAICompatAdapter.nativeChat!({ ...request, retry: { max: 1, delaySec: 0 } })) events.push(event);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(events).toEqual([
      { type: "tool_call_delta", call: { index: 0, id: undefined, name: "mcp:browser:open", arguments: "{" } },
      { type: "done", finishReason: "length" }
    ]);
  });

  it("limits non-streaming native responses as well", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: "12345" }, finish_reason: "stop" }] }), { headers: { "content-type": "application/json" } })));
    const events = [];
    for await (const event of OpenAICompatAdapter.nativeChat!({ ...request, maxModelResponseChars: 4 })) events.push(event);
    expect(events).toEqual([{ type: "error", kind: "response_limit", retryable: false, message: "Native model response exceeded 4 chars." }]);
  });

  it("does not turn an invalid non-streaming provider body into a final answer", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("provider exploded", { headers: { "content-type": "application/json" } })));
    const chatRequest: ChatRequest = {
      agent: request.agent,
      input: "hello",
      history: []
    };
    const events = [];
    for await (const event of OpenAICompatAdapter.chat(chatRequest)) events.push(event);
    expect(events).toEqual([{ type: "error", kind: "provider", retryable: false, message: "Provider returned an invalid OpenAI-compatible JSON response." }]);
  });

  it("reports malformed streaming chunks as typed provider failures", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("data: {not-json}\n\n", { headers: { "content-type": "text/event-stream" } })));
    const events = [];
    for await (const event of OpenAICompatAdapter.nativeChat!(request)) events.push(event);
    expect(events).toEqual([{ type: "error", kind: "provider", retryable: false, message: "Provider returned a malformed OpenAI-compatible native SSE chunk." }]);
  });

  it("rejects native streaming tool calls without a valid provider index", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ id: "call-1", function: { name: "mcp:browser:open", arguments: "{}" } }] } }] })}\n\n`,
      { headers: { "content-type": "text/event-stream" } }
    )));
    const events = [];
    for await (const event of OpenAICompatAdapter.nativeChat!(request)) events.push(event);
    expect(events).toEqual([{ type: "error", kind: "provider", retryable: false, message: "Provider returned a native tool call without a valid index." }]);
  });
});
