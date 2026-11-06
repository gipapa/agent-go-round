// @vitest-environment node
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { Type } from "@earendil-works/pi-ai";
import { AgentSession } from "./session";
import { createGroqRuntime } from "./provider";

const servers: ReturnType<typeof createServer>[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

describe("Groq OpenAI-compatible transport", () => {
  it("streams a text response through the real provider adapter boundary", async () => {
    const requests: Array<{ authorization?: string; body: Record<string, unknown> }> = [];
    const server = createServer(async (request, response) => {
      let raw = "";
      for await (const chunk of request) raw += chunk;
      requests.push({
        authorization: request.headers.authorization,
        body: JSON.parse(raw) as Record<string, unknown>
      });
      response.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive"
      });
      const chunks = [
        { id: "chatcmpl-test", object: "chat.completion.chunk", created: 1, model: "openai/gpt-oss-120b", choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] },
        { id: "chatcmpl-test", object: "chat.completion.chunk", created: 1, model: "openai/gpt-oss-120b", choices: [{ index: 0, delta: { content: "hello " }, finish_reason: null }] },
        { id: "chatcmpl-test", object: "chat.completion.chunk", created: 1, model: "openai/gpt-oss-120b", choices: [{ index: 0, delta: { content: "world" }, finish_reason: null }] },
        { id: "chatcmpl-test", object: "chat.completion.chunk", created: 1, model: "openai/gpt-oss-120b", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }
      ];
      for (const chunk of chunks) response.write(`data: ${JSON.stringify(chunk)}\n\n`);
      response.end("data: [DONE]\n\n");
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const port = (server.address() as AddressInfo).port;
    const runtime = await createGroqRuntime({
      apiKey: "test-key",
      baseUrl: `http://127.0.0.1:${port}/v1`,
      model: "openai/gpt-oss-120b"
    });

    const session = new AgentSession({
      sessionId: "transport-test",
      model: runtime.model,
      streamFn: runtime.streamFn
    });
    await expect(session.prompt("say hello")).resolves.toMatchObject({ status: "success", text: "hello world" });
    expect(requests).toHaveLength(1);
    expect(requests[0].authorization).toBe("Bearer test-key");
    expect(requests[0].body).toMatchObject({ model: "openai/gpt-oss-120b", stream: true });
  });

  it.each([429, 413])("recovers an HTTP %s after a tool without repeating its side effect", async status => {
    const requests: Array<Record<string, unknown>> = [];
    const server = createServer(async (request, response) => {
      let raw = "";
      for await (const chunk of request) raw += chunk;
      requests.push(JSON.parse(raw) as Record<string, unknown>);
      if (requests.length === 2) {
        response.writeHead(status, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: { message: status === 429 ? "Rate limit reached. Please try again in 0.001s."
          : "Request too large for model on input tokens per minute (ITPM): Limit 7000, Requested 7033, please reduce your message size and try again.", type: "tokens", code: "rate_limit_exceeded" } }));
        return;
      }
      response.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
      const chunks = requests.length === 1
        ? [
            { id: "chatcmpl-tool", object: "chat.completion.chunk", created: 1, model: "openai/gpt-oss-120b", choices: [{ index: 0, delta: { role: "assistant", tool_calls: [{ index: 0, id: "call-1", type: "function", function: { name: "lookup", arguments: '{"id":"cust-42"}' } }] }, finish_reason: "tool_calls" }] }
          ]
        : [
            { id: "chatcmpl-tool-2", object: "chat.completion.chunk", created: 1, model: "openai/gpt-oss-120b", choices: [{ index: 0, delta: { role: "assistant", content: "verified pro" }, finish_reason: "stop" }] }
          ];
      for (const chunk of chunks) response.write(`data: ${JSON.stringify(chunk)}\n\n`);
      response.end("data: [DONE]\n\n");
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const port = (server.address() as AddressInfo).port;
    const runtime = await createGroqRuntime({ apiKey: "test-key", baseUrl: `http://127.0.0.1:${port}/v1`, model: "openai/gpt-oss-120b" });
    const calls: unknown[] = [];
    const session = new AgentSession({
      sessionId: "transport-tool-test",
      model: runtime.model,
      streamFn: runtime.streamFn,
      tools: [{
        name: "lookup",
        label: "Lookup",
        description: "Look up a customer record",
        parameters: Type.Object({ id: Type.String() }),
        execute: async (_toolCallId, args) => {
          calls.push(args);
          return { content: [{ type: "text", text: "customer cust-42 is pro" }], details: { id: "cust-42", plan: "pro" } };
        }
      }]
    });

    session.addContextMessage("obsolete history ".repeat(1200));
    await expect(session.prompt("Look up cust-42 and report the plan")).resolves.toMatchObject({ status: "success", text: "verified pro" });
    expect(calls).toEqual([{ id: "cust-42" }]);
    expect(requests).toHaveLength(3);
    expect(JSON.stringify(requests[1])).toContain("customer cust-42 is pro");
    if (status === 429) expect(requests[2]).toEqual(requests[1]);
    else {
      expect(JSON.stringify(requests[2])).not.toContain("obsolete history");
      expect(JSON.stringify(requests[2])).toContain("customer cust-42 is pro");
      expect(session.contextUsage().inputTokenLimit).toBe(7000);
    }
  });
});
