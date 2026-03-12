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
    async request(method: string, params?: any) {
      if (method === "tools/list") {
        return {
          id: "tools-list",
          result: {
            tools: [
              { name: "time", description: "Get current server time" },
              { name: "echo", description: "Echo input text" }
            ]
          }
        };
      }
      if (method === "tools/call") {
        return {
          id: "tools-call",
          result: params?.name === "time" ? { now: "2026-01-01 00:00:00" } : { text: "echo" }
        };
      }
      return { id: "unknown", error: "unknown" };
    }
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

function getButtonByText(text: string) {
  if (!container) throw new Error("Missing test container");
  const btn = Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.trim() === text);
  if (!btn) throw new Error(`Button not found: ${text}`);
  return btn as HTMLButtonElement;
}

function getMessageContents() {
  if (!container) throw new Error("Missing test container");
  return Array.from(container.querySelectorAll(".chat-message-text"))
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

async function clickButton(text: string) {
  await act(async () => {
    getButtonByText(text).click();
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

    responderRef.current = (req) => {
      if (req.input.includes("請判斷這次是否需要使用工具")) {
        return `{"type":"mcp_call","serverId":"${server.id}","tool":"time","input":{}}`;
      }
      if (req.input.includes("工具執行結果")) {
        return "now: 2026-01-01 00:00:00";
      }
      return "";
    };

    seedAgents([{ ...agent, allowedMcpServerIds: [server.id] }]);
    seedMcpServers([server]);
    seedUi({ activeTab: "chat", mode: "one_to_one", activeAgentId: agent.id, memberAgentIds: [] });

    await renderApp();
    await clickButton("Chat Config");
    await clickButton("Connect & List Tools");
    await clickButton("Chat");
    await sendMessage("use time tool, tell me what time it is");
    await waitForText("now: 2026-01-01 00:00:00");
    expect(callTool).toHaveBeenCalledWith(expect.anything(), "time", {});
  });

  it("supports built-in user info tool use", async () => {
    const agent: AgentConfig = {
      id: "agent-5",
      name: "Mock LLM",
      type: "openai_compat",
      endpoint: "http://mock-llm.test/v1",
      model: "mock",
      allowUserProfileTool: true
    };

    responderRef.current = (req) => {
      if (req.input.includes("請判斷這次是否需要使用工具")) {
        return '{"type":"user_profile_call","tool":"get_user_profile"}';
      }
      if (req.input.includes('"name": "Alice"') && req.input.includes('"description": "PM who prefers Traditional Chinese."')) {
        return "你是 Alice，一位偏好繁體中文的 PM。";
      }
      return "";
    };

    seedAgents([agent]);
    seedUi({
      activeTab: "chat",
      mode: "one_to_one",
      activeAgentId: agent.id,
      memberAgentIds: [],
      userName: "Alice",
      userDescription: "PM who prefers Traditional Chinese."
    });

    await renderApp();
    await sendMessage("我是誰？");
    await waitForText("你是 Alice，一位偏好繁體中文的 PM。");
    const reply = getMessageContents().slice(-1)[0];
    expect(reply).toBe("你是 Alice，一位偏好繁體中文的 PM。");
    expect(container?.textContent).toContain("查看 tool result");
  });
});
