import { afterEach, describe, expect, it, vi } from "vitest";
import { CustomAdapter, supportsCustomTextProtocol } from "../adapters/custom";

describe("custom text adapter", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("forwards the protocol system and canonical rendered input", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { system?: string; input?: string };
      expect(body.system).toContain("TEXT_ACTION_PROTOCOL");
      expect(body.input).toContain("USER:");
      return new Response(JSON.stringify({ answer: "done" }), { headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const events = [];
    for await (const event of CustomAdapter.chat({
      agent: {
        id: "agent",
        name: "Agent",
        type: "custom",
        custom: {
          method: "POST",
          url: "https://example.com",
          bodyTemplate: '{"system":"{{system}}","input":"{{input}}"}',
          responseJsonPath: "$.answer"
        }
      },
      input: "USER:\\ngoal",
      history: [],
      system: "[TEXT_ACTION_PROTOCOL]"
    })) events.push(event);
    expect(events).toEqual([{ type: "done", text: "done" }]);
    expect(supportsCustomTextProtocol({ custom: { bodyTemplate: "{{system}} {{input}}" } })).toBe(true);
  });

  it("escapes multiline protocol context in JSON custom templates", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { system?: string; input?: string };
      expect(body.system).toContain("[TEXT_ACTION_PROTOCOL]");
      expect(body.input).toContain("USER:\nhello");
      return new Response(JSON.stringify({ answer: "done" }), { headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const events = [];
    for await (const event of CustomAdapter.chat({
      agent: {
        id: "agent",
        name: "Agent",
        type: "custom",
        custom: {
          method: "POST",
          url: "https://example.com",
          bodyTemplate: '{"system":"{{system}}","input":"{{input}}"}',
          responseJsonPath: "$.answer"
        }
      },
      input: "USER:\nhello",
      history: [],
      system: "[TEXT_ACTION_PROTOCOL]\nReply with JSON"
    })) events.push(event);
    expect(events).toEqual([{ type: "done", text: "done" }]);
  });

  it("uses a safe default when the response limit is malformed", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ answer: "done" }), { headers: { "content-type": "application/json" } })));
    const events = [];
    for await (const event of CustomAdapter.chat({
      agent: {
        id: "agent",
        name: "Agent",
        type: "custom",
        custom: {
          method: "POST",
          url: "https://example.com",
          bodyTemplate: '{"system":"{{system}}","input":"{{input}}"}',
          responseJsonPath: "$.answer"
        }
      },
      input: "hello",
      history: [],
      maxModelResponseChars: Number.NaN
    })) events.push(event);
    expect(events).toEqual([{ type: "done", text: "done" }]);
  });
});
