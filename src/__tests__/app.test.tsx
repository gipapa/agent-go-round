import React, { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { ChatRequest } from "../adapters/base";
import type { AgentConfig, DocItem, McpServerConfig } from "../types";
import App from "../app/App";

const responderRef = vi.hoisted<{ current: (req: ChatRequest) => string }>(() => ({ current: () => "" }));
const docsFixtureRef = vi.hoisted(() => ({ current: [] as DocItem[] }));
const callTool = vi.hoisted(() =>
  vi.fn(async (_client: unknown, tool: string) => {
    if (tool === "time") return "2026-01-01 00:00:00";
    if (tool === "echo") return "echo";
    return null;
  })
);

vi.mock("../adapters/openaiCompat", () => ({
  OpenAICompatAdapter: {
    chat: async function* (req: ChatRequest) {
      const text = responderRef.current(req);
      yield { type: "delta", text };
    }
  }
}));

vi.mock("../storage/docStore", () => ({
  listDocs: vi.fn(async () => docsFixtureRef.current),
  upsertDoc: vi.fn(async () => {}),
  deleteDoc: vi.fn(async () => {})
}));

vi.mock("../mcp/toolRegistry", () => ({
  callTool
}));

vi.mock("../mcp/sseClient", () => ({
  McpSseClient: class {
    constructor(_cfg: unknown) {}
    connect() {}
  }
}));

const UI_KEY = "agr_ui_v1";
const AGENTS_KEY = "agr_agents_v1";
const MCP_KEY = "agr_mcp_v1";

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function flushPromises() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function seedAgents(agents: AgentConfig[]) {
  localStorage.setItem(AGENTS_KEY, JSON.stringify(agents));
}

function seedUi(state: Record<string, unknown>) {
  localStorage.setItem(UI_KEY, JSON.stringify(state));
}

function seedMcpServers(servers: McpServerConfig[]) {
  localStorage.setItem(MCP_KEY, JSON.stringify(servers));
}

async function renderApp() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<App />);
  });
  await flushPromises();
}

function getTextarea() {
  if (!container) throw new Error("Missing test container");
  const el = container.querySelector('textarea[placeholder="Type message..."]') as HTMLTextAreaElement | null;
  if (!el) throw new Error("Textarea not found");
  return el;
}

function getSendButton() {
  if (!container) throw new Error("Missing test container");
  const btns = Array.from(container.querySelectorAll("button"));
  const btn = btns.find((b) => b.textContent === "Send");
  if (!btn) throw new Error("Send button not found");
  return btn;
}

function getMessageContents() {
  if (!container) throw new Error("Missing test container");
  return Array.from(container.querySelectorAll("div"))
    .filter((el) => (el as HTMLElement).style.whiteSpace === "pre-wrap")
    .map((el) => el.textContent ?? "");
}

async function sendMessage(text: string) {
  const textarea = getTextarea();
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
    if (!setter) throw new Error("Textarea value setter not found");
    setter.call(textarea, text);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    textarea.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await act(async () => {
    getSendButton().click();
  });
  await flushPromises();
}

async function waitForText(text: string, timeoutMs = 2000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (container?.textContent?.includes(text)) return;
    await flushPromises();
  }
  throw new Error(`Timed out waiting for text: ${text}`);
}

beforeEach(() => {
  docsFixtureRef.current = [];
  responderRef.current = () => "";
  callTool.mockClear();
  localStorage.clear();
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  if (!globalThis.crypto?.randomUUID) {
    Object.defineProperty(globalThis, "crypto", {
      value: { randomUUID: () => "test-uuid" },
      configurable: true
    });
  }
});

afterEach(async () => {
  if (root && container) {
    await act(async () => {
      root!.unmount();
    });
    container.remove();
  }
  root = null;
  container = null;
});

describe("App chat flows (mocked)", () => {
  it("supports normal talking history memory", async () => {
    const agent: AgentConfig = {
      id: "agent-1",
      name: "Mock LLM",
      type: "openai_compat",
      endpoint: "http://mock-llm.test/v1",
      model: "mock"
    };

    responderRef.current = (req) => {
      if (req.input === "I'm John") return "ok";
      if (req.input === "who am I") {
        const hasName = req.history.some((m) => m.role === "user" && m.content.includes("I'm John"));
        return hasName ? "John" : "unknown";
      }
      return "";
    };

    seedAgents([agent]);
    seedUi({ activeTab: "chat", mode: "one_to_one", activeAgentId: agent.id, memberAgentIds: [] });

    await renderApp();
    await sendMessage("I'm John");
    await waitForText("ok");
    const afterFirst = getMessageContents().slice(-1)[0];
    expect(afterFirst).toBe("ok");

    await sendMessage("who am I");
    await waitForText("John");
    const afterSecond = getMessageContents().slice(-1)[0];
    expect(afterSecond).toBe("John");
  });

  it("supports normal talking doc context injection", async () => {
    const agent: AgentConfig = {
      id: "agent-2",
      name: "Mock LLM",
      type: "openai_compat",
      endpoint: "http://mock-llm.test/v1",
      model: "mock"
    };

    docsFixtureRef.current = [
      {
        id: "doc-1",
        title: "Jokes",
        content: 'the funniest joke: "What do you call a sad strawberry? Ans: A blueberry"',
        updatedAt: Date.now()
      }
    ];

    responderRef.current = (req) => {
      if (req.input === "tell me the funniest joke" && req.system?.includes("sad strawberry")) {
        return "What do you call a sad strawberry? Ans: A blueberry";
      }
      return "no idea";
    };

    seedAgents([agent]);
    seedUi({ activeTab: "chat", mode: "one_to_one", activeAgentId: agent.id, memberAgentIds: [] });

    await renderApp();
    await sendMessage("tell me the funniest joke");
    await waitForText("What do you call a sad strawberry? Ans: A blueberry");
    const reply = getMessageContents().slice(-1)[0];
    expect(reply).toBe("What do you call a sad strawberry? Ans: A blueberry");
  });

  it("supports normal talking MCP tool use (time)", async () => {
    const agent: AgentConfig = {
      id: "agent-4",
      name: "Mock LLM",
      type: "openai_compat",
      endpoint: "http://mock-llm.test/v1",
      model: "mock"
    };
    const server: McpServerConfig = {
      id: "mcp-2",
      name: "Mock MCP",
      sseUrl: "http://mock-mcp.test/mcp/sse"
    };

    let step = 0;
    responderRef.current = (req) => {
      if (req.input === "use time tool, tell me what time it is") {
        step += 1;
        return '{"type":"mcp_call","tool":"time","input":{}}';
      }
      if (req.input.startsWith("Tool result received")) {
        return "now: 2026-01-01 00:00:00";
      }
      return step > 0 ? "now: 2026-01-01 00:00:00" : "";
    };

    seedAgents([{ ...agent, allowedMcpServerIds: [server.id] }]);
    seedMcpServers([server]);
    seedUi({ activeTab: "chat", mode: "one_to_one", activeAgentId: agent.id, memberAgentIds: [] });

    await renderApp();
    await sendMessage("use time tool, tell me what time it is");
    await waitForText("now: 2026-01-01 00:00:00");
    expect(callTool).toHaveBeenCalledWith(expect.anything(), "time", {});
  });
});
