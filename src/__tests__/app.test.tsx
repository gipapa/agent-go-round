import React, { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { ChatRequest } from "../adapters/base";
import type { AgentConfig, BuiltInToolConfig, DocItem, LoadBalancerConfig, McpServerConfig } from "../types";
import type { ModelCredentials } from "../storage/settingsStore";
import App from "../app/App";
import { TUTORIAL_PRIMARY_MODEL, TUTORIAL_TEXT_PROTOCOL_LOAD_BALANCER_NAME, TUTORIAL_TEXT_PROTOCOL_MODEL } from "../onboarding/runtime";

const responderRef = vi.hoisted<{ current: (req: ChatRequest) => string }>(() => ({ current: () => "" }));
const docsFixtureRef = vi.hoisted(() => ({ current: [] as DocItem[] }));
const callTool = vi.hoisted(() =>
  vi.fn(async (_client: unknown, tool: string) => {
    if (tool === "time") return "2026-01-01 00:00:00";
    if (tool === "echo") return "echo";
    return null;
  })
);
const listTools = vi.hoisted(() =>
  vi.fn(async () => [
    { name: "time", description: "Get current server time", annotations: { readOnlyHint: true } },
    { name: "echo", description: "Echo input text" }
  ])
);

vi.mock("../adapters/openaiCompat", () => ({
  OpenAICompatAdapter: {
    chat: async function* (req: ChatRequest) {
      const text = req.system?.includes("internal:capability.probe")
        ? '{"type":"tool_call","toolId":"internal:capability.probe","input":{}}'
        : responderRef.current(req);
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
  callTool,
  listTools
}));

vi.mock("../mcp/sseClient", () => ({
  McpSseClient: class {
    constructor(_cfg: unknown) {}
    connect() {}
    close() {}
    isReusable() {
      return true;
    }
    async request(method: string, params?: unknown) {
      const record = params && typeof params === "object" && !Array.isArray(params) ? (params as Record<string, unknown>) : null;
      if (method === "tools/list") {
        return {
          id: "tools-list",
          result: {
            tools: [
              { name: "time", description: "Get current server time", annotations: { readOnlyHint: true } },
              { name: "echo", description: "Echo input text" }
            ]
          }
        };
      }
      if (method === "tools/call") {
        return {
          id: "tools-call",
          result: record?.name === "time" ? { now: "2026-01-01 00:00:00" } : { text: "echo" }
        };
      }
      return { id: "unknown", error: "unknown" };
    }
  }
}));

const UI_KEY = "agr_ui_v1";
const AGENTS_KEY = "agr_agents_v1";
const MCP_KEY = "agr_mcp_v1";
const CREDENTIALS_KEY = "agr_model_credentials_v1";
const LOAD_BALANCERS_KEY = "agr_load_balancers_v1";
const BUILT_IN_TOOLS_KEY = "agr_built_in_tools_v1";

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function flushPromises() {
  return act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
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

function seedBuiltInTools(tools: BuiltInToolConfig[]) {
  localStorage.setItem(BUILT_IN_TOOLS_KEY, JSON.stringify(tools));
}

function seedLoadBalancedAgent(agent: AgentConfig) {
  const credentialId = `cred-${agent.id}`;
  const keyId = `key-${agent.id}`;
  const loadBalancerId = `lb-${agent.id}`;
  const credentials: ModelCredentials = [
    {
      id: credentialId,
      preset: "custom",
      label: `${agent.name} credential`,
      endpoint: agent.endpoint ?? "http://mock-llm.test/v1",
      // The agent id is only a non-secret configured sentinel; it is not an API credential.
      keys: [{ id: keyId, apiKey: agent.id, createdAt: 1, updatedAt: 1 }],
      createdAt: 1,
      updatedAt: 1
    }
  ];
  const loadBalancers: LoadBalancerConfig[] = [
    {
      id: loadBalancerId,
      name: `${agent.name} LB`,
      instances: [
        {
          id: `instance-${agent.id}`,
          credentialId,
          credentialKeyId: keyId,
          model: agent.model ?? "mock",
          description: "test instance",
          maxRetries: 0,
          delaySecond: 0,
          resumeMinute: 1,
          failure: false,
          failureCount: 0,
          nextCheckTime: null,
          toolCallingCapability: "text_protocol",
          createdAt: 1,
          updatedAt: 1
        }
      ],
      createdAt: 1,
      updatedAt: 1
    }
  ];
  localStorage.setItem(CREDENTIALS_KEY, JSON.stringify(credentials));
  localStorage.setItem(LOAD_BALANCERS_KEY, JSON.stringify(loadBalancers));
  return {
    ...agent,
    loadBalancerId
  };
}

function seedTutorialBaseResources() {
  const credential = {
    id: "tutorial-groq-credential",
    preset: "groq" as const,
    label: "Groq",
    endpoint: "https://api.groq.com/openai/v1",
    keys: [{ id: "tutorial-groq-key-1", apiKey: "tutorial-test-key", createdAt: 1, updatedAt: 1 }],
    createdAt: 1,
    updatedAt: 1
  };
  const loadBalancer: LoadBalancerConfig = {
    id: "tutorial-primary-load-balancer",
    name: "教學用Load Balancer 1",
    description: "教學用 key failover Load Balancer",
    instances: [{
      id: "tutorial-primary-instance",
      credentialId: credential.id,
      credentialKeyId: credential.keys[0].id,
      model: TUTORIAL_PRIMARY_MODEL,
      description: "Primary tutorial instance",
      maxRetries: 4,
      delaySecond: 5,
      resumeMinute: 60,
      failure: false,
      failureCount: 0,
      nextCheckTime: null,
      toolCallingCapability: "native",
      createdAt: 1,
      updatedAt: 1
    }],
    createdAt: 1,
    updatedAt: 1
  };
  const agent: AgentConfig = {
    id: "tutorial-agent",
    name: "教學測試 Agent",
    type: "openai_compat",
    loadBalancerId: loadBalancer.id,
    tutorialRole: "primary",
    enableDocs: false,
    enableMcp: false,
    enableBuiltInTools: false,
    enableSkills: false
  };
  localStorage.setItem(CREDENTIALS_KEY, JSON.stringify([credential]));
  localStorage.setItem(LOAD_BALANCERS_KEY, JSON.stringify([loadBalancer]));
  seedAgents([agent]);
  seedUi({
    activeTab: "chat",
    mode: "one_to_one",
    activeAgentId: agent.id,
    memberAgentIds: [],
    historyMessageLimit: 1,
    userName: "教學測試使用者",
    userDescription: "用來驗證 tutorial harness 的測試使用者。"
  });
}

async function renderApp(options: { startTutorial?: boolean } = {}) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<App />);
  });
  await flushPromises();
  // Dismiss the landing page so workspace UI (textarea, tabs) becomes available.
  const landingStart = container.querySelector<HTMLButtonElement>(
    `button[data-tutorial-id="${options.startTutorial ? "landing-start-tutorial" : "landing-start"}"]`
  );
  if (landingStart) {
    await act(async () => {
      landingStart.click();
    });
    await flushPromises();
  }
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

function getBodyButtonByText(text: string) {
  const btn = Array.from(document.body.querySelectorAll("button")).find((candidate) => candidate.textContent?.trim() === text);
  if (!btn) throw new Error(`Body button not found: ${text}`);
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
  throw new Error(`Timed out waiting for text: ${text}\nDOM: ${container?.textContent?.slice(0, 1200) ?? ""}`);
}

async function waitForCondition(check: () => boolean, timeoutMs = 2000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (check()) return;
    await flushPromises();
  }
  throw new Error("Timed out waiting for condition");
}

async function advanceTutorialWhenReady(timeoutMs = 3000) {
  await waitForCondition(() => {
    const button = container?.querySelector<HTMLButtonElement>('button[data-tutorial-id="tutorial-next"]');
    return !!button && !button.disabled;
  }, timeoutMs);
  await act(async () => {
    container?.querySelector<HTMLButtonElement>('button[data-tutorial-id="tutorial-next"]')?.click();
  });
  await flushPromises();
}

async function waitForBodyText(text: string, timeoutMs = 2000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (document.body.textContent?.includes(text)) return;
    await flushPromises();
  }
  throw new Error(`Timed out waiting for body text: ${text}`);
}

beforeEach(() => {
  docsFixtureRef.current = [];
  responderRef.current = () => "";
  callTool.mockClear();
  localStorage.clear();
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
  vi.spyOn(window, "confirm").mockReturnValue(true);
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
  vi.restoreAllMocks();
});

describe("App chat flows (mocked)", () => {
  it("creates one dedicated text protocol load balancer in tutorial 9", async () => {
    seedTutorialBaseResources();

    await renderApp({ startTutorial: true });
    for (let index = 0; index < 8; index += 1) {
      await act(async () => {
        container?.querySelector<HTMLButtonElement>('button[data-tutorial-id="tutorial-skip-case"]')?.click();
      });
      await flushPromises();
    }
    await waitForText("[9]（進階驗證）Strict Text Protocol 相容性測試");

    await advanceTutorialWhenReady();
    await advanceTutorialWhenReady();
    await advanceTutorialWhenReady();
    await advanceTutorialWhenReady();
    await advanceTutorialWhenReady();
    await waitForText("建立只使用 text protocol 的測試 instance");
    await waitForCondition(() => {
      const raw = localStorage.getItem(LOAD_BALANCERS_KEY);
      const parsed = raw ? JSON.parse(raw) as LoadBalancerConfig[] | { data?: LoadBalancerConfig[] } : [];
      const loadBalancers = Array.isArray(parsed) ? parsed : parsed.data ?? [];
      const matches = loadBalancers.filter((entry) => entry.name === TUTORIAL_TEXT_PROTOCOL_LOAD_BALANCER_NAME);
      return matches.length === 1 && matches[0].instances.length === 1 &&
        matches[0].instances[0].model === TUTORIAL_TEXT_PROTOCOL_MODEL &&
        matches[0].instances[0].toolCallingCapability === "text_protocol";
    });
  });

  it("supports normal talking history memory", async () => {
    const agent: AgentConfig = {
      id: "agent-1",
      name: "Mock LLM",
      type: "openai_compat",
      endpoint: "http://mock-llm.test/v1",
      model: "mock"
    };

    responderRef.current = (req) => {
      if (req.input.includes("who am I")) return req.input.includes("I'm John") ? "John" : "unknown";
      if (req.input.includes("I'm John")) return "ok";
      return "";
    };

    const seededAgent = seedLoadBalancedAgent(agent);
    seedAgents([seededAgent]);
    seedUi({ activeTab: "chat", mode: "one_to_one", activeAgentId: seededAgent.id, memberAgentIds: [] });

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

  it("uses the Pi loop harness by default", async () => {
    const agent: AgentConfig = {
      id: "agent-harness",
      name: "Harness LLM",
      type: "openai_compat",
      endpoint: "http://mock-llm.test/v1",
      model: "mock"
    };
    responderRef.current = () => "harness answer";

    const seededAgent = seedLoadBalancedAgent(agent);
    seedAgents([seededAgent]);
    seedUi({
      activeTab: "chat",
      mode: "one_to_one",
      activeAgentId: seededAgent.id,
      memberAgentIds: []
    });

    await renderApp();
    await sendMessage("use the new harness");
    await waitForText("harness answer");
    expect(getMessageContents().slice(-1)[0]).toBe("harness answer");
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
      if (req.input.includes("tell me the funniest joke") && req.system?.includes("sad strawberry")) {
        return "What do you call a sad strawberry? Ans: A blueberry";
      }
      return "no idea";
    };

    const seededAgent = seedLoadBalancedAgent(agent);
    seedAgents([seededAgent]);
    seedUi({ activeTab: "chat", mode: "one_to_one", activeAgentId: seededAgent.id, memberAgentIds: [] });

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
      if (req.input.includes("use time tool") && !req.input.includes("[UNTRUSTED_TOOL_RESULT")) {
        return `{"type":"tool_call","toolId":"mcp:${server.id}:time","input":{}}`;
      }
      if (req.input.includes("[UNTRUSTED_TOOL_RESULT") || req.input.includes("2026-01-01 00:00:00")) {
        return "now: 2026-01-01 00:00:00";
      }
      return "";
    };

    const seededAgent = seedLoadBalancedAgent({ ...agent, allowedMcpServerIds: [server.id] });
    seedAgents([seededAgent]);
    seedMcpServers([server]);
    seedUi({ activeTab: "chat", mode: "one_to_one", activeAgentId: seededAgent.id, memberAgentIds: [] });

    await renderApp();
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
      if (req.input.includes("我是誰") && !req.input.includes("[UNTRUSTED_TOOL_RESULT")) {
        return '{"type":"tool_call","toolId":"builtin:system:get_user_profile","input":{}}';
      }
      if (req.input.includes("Alice") && req.input.includes("PM who prefers Traditional Chinese.")) {
        return "你是 Alice，一位偏好繁體中文的 PM。";
      }
      return "";
    };

    const seededAgent = seedLoadBalancedAgent(agent);
    seedAgents([seededAgent]);
    seedUi({
      activeTab: "chat",
      mode: "one_to_one",
      activeAgentId: seededAgent.id,
      memberAgentIds: [],
      userName: "Alice",
      userDescription: "PM who prefers Traditional Chinese."
    });

    await renderApp();
    await sendMessage("我是誰？");
    await waitForText("你是 Alice，一位偏好繁體中文的 PM。");
    const reply = getMessageContents().slice(-1)[0];
    expect(reply).toBe("你是 Alice，一位偏好繁體中文的 PM。");
    expect(container?.textContent).toContain("Tool result");
  });

  it("uses the abortable in-app confirmation modal for mutating harness tools", async () => {
    const agent: AgentConfig = {
      id: "agent-confirmation",
      name: "Confirmation LLM",
      type: "openai_compat",
      endpoint: "http://mock-llm.test/v1",
      model: "mock"
    };
    const tool: BuiltInToolConfig = {
      id: "confirm-tool",
      name: "Confirm tool",
      description: "A tool that requires user confirmation",
      code: "return 'executed';",
      requireConfirmation: true,
      updatedAt: 0,
      source: "custom"
    };
    responderRef.current = (req) => req.input.includes("[UNTRUSTED_TOOL_RESULT") ? "done after confirmation" : JSON.stringify({
      type: "tool_call",
      toolId: "builtin:confirm-tool",
      input: {}
    });
    const seededAgent = seedLoadBalancedAgent(agent);
    seedAgents([seededAgent]);
    seedBuiltInTools([tool]);
    seedUi({ activeTab: "chat", mode: "one_to_one", activeAgentId: seededAgent.id, memberAgentIds: [] });

    await renderApp();
    await sendMessage("run the confirmed tool");
    await waitForBodyText("確認工具操作");
    expect(document.body.textContent).toContain("builtin:confirm-tool");
    await act(async () => {
      getBodyButtonByText("允許執行").click();
    });
    await flushPromises();
    await waitForText("done after confirmation");
  });
});
