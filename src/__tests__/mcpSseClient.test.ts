import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { McpSseClient } from "../mcp/sseClient";

class FakeEventSource {
  static instances: FakeEventSource[] = [];

  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  closed = false;

  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }

  close() {
    this.closed = true;
  }

  emitOpen() {
    this.onopen?.(new Event("open"));
  }

  emitMessage(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) } as MessageEvent<string>);
  }
}

describe("McpSseClient", () => {
  beforeEach(() => {
    FakeEventSource.instances = [];
    vi.stubGlobal("EventSource", FakeEventSource as unknown as typeof EventSource);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("returns direct JSON RPC replies from the POST endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "server-id", result: { tools: [] } }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new McpSseClient({
      id: "mcp-1",
      name: "Demo",
      sseUrl: "https://example.com/mcp/sse"
    });
    client.connect();
    FakeEventSource.instances[0]?.emitOpen();

    const response = await client.request("tools/list");

    expect(response.result).toEqual({ tools: [] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("waits for deferred RPC replies that arrive later over SSE", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("", { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new McpSseClient({
      id: "mcp-1",
      name: "Demo",
      sseUrl: "https://example.com/mcp/sse"
    });
    client.connect();
    const es = FakeEventSource.instances[0];
    es?.emitOpen();

    const responsePromise = client.request("tools/call", { name: "visit", input: { url: "https://example.com" } });
    await Promise.resolve();

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const requestBody = JSON.parse(String(init.body ?? "{}")) as { id: string };
    es?.emitMessage({
      id: requestBody.id,
      result: { ok: true, output: "visited" }
    });

    await expect(responsePromise).resolves.toEqual({
      id: requestBody.id,
      result: { ok: true, output: "visited" },
      error: undefined
    });
  });
});
