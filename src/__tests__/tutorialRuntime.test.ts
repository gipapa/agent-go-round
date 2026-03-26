// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { getTutorialScenario, tutorialCatalog } from "../onboarding/catalog";
import { applyTutorialStepEntry, evaluateTutorialStep } from "../onboarding/runtime";
import type { TutorialEntryController, TutorialRuntimeState, TutorialStepDefinition } from "../onboarding/types";
import type { AgentConfig, ChatMessage, LoadBalancerConfig } from "../types";
import type { ModelCredentialEntry } from "../storage/settingsStore";

function makeTutorialCredential(): ModelCredentialEntry {
  const now = Date.now();
  return {
    id: "credential-groq",
    preset: "groq",
    label: "Groq",
    endpoint: "https://api.groq.com/openai/v1",
    keys: [{ id: "credential-groq-key-1", apiKey: "test-key", createdAt: now, updatedAt: now }],
    createdAt: now,
    updatedAt: now
  };
}

function makeTutorialLoadBalancer(): LoadBalancerConfig {
  const now = Date.now();
  return {
    id: "lb-groq",
    name: "Tutorial Groq LB",
    instances: [
      {
        id: "lb-groq-instance-1",
        credentialId: "credential-groq",
        credentialKeyId: "credential-groq-key-1",
        model: "moonshotai/kimi-k2-instruct-0905",
        description: "",
        maxRetries: 4,
        delaySecond: 5,
        failure: false,
        failureCount: 0,
        nextCheckTime: null,
        createdAt: now,
        updatedAt: now
      }
    ],
    createdAt: now,
    updatedAt: now
  };
}

function makeTutorialAgentBase(overrides?: Partial<AgentConfig>): AgentConfig {
  return {
    id: "agent-groq",
    name: "Tutorial Groq Agent",
    type: "openai_compat",
    loadBalancerId: "lb-groq",
    enableDocs: false,
    enableMcp: false,
    enableBuiltInTools: false,
    enableSkills: false,
    ...overrides
  };
}

function makeUser(content: string): ChatMessage {
  return { id: `user-${content}`, role: "user", content, ts: Date.now() };
}

function makeAssistant(id: string, content: string, patch?: Partial<ChatMessage>): ChatMessage {
  return { id, role: "assistant", content, ts: Date.now(), ...patch };
}

function makeTool(content: string): ChatMessage {
  return { id: `tool-${content}`, role: "tool", content, ts: Date.now() };
}

function makeState(patch?: Partial<TutorialRuntimeState>): TutorialRuntimeState {
  return {
    agents: [makeTutorialAgentBase()],
    skills: [],
    activeAgentId: "agent-groq",
    credentials: [makeTutorialCredential()],
    credentialTestResults: {},
    history: [],
    currentChatInput: "",
    historyMessageLimit: 10,
    builtInTools: [],
    docs: [],
    loadBalancers: [makeTutorialLoadBalancer()],
    mcpServers: [],
    mcpToolsByServer: {},
    userProfile: {
      name: "Test User",
      description: "Profile text",
      hasAvatar: false
    },
    openedToolResultMessageIds: [],
    ...patch
  };
}

function getStep(scenarioId: string, stepId: string): TutorialStepDefinition {
  const scenario = getTutorialScenario(scenarioId);
  if (!scenario) throw new Error(`Scenario not found: ${scenarioId}`);
  const step = scenario.steps.find((item) => item.id === stepId);
  if (!step) throw new Error(`Step not found: ${scenarioId}/${stepId}`);
  return step;
}

describe("tutorial YAML automation linkage", () => {
  it("keeps chat composer seeds and expected prompts in the same YAML source", () => {
    const automatedChatSteps = tutorialCatalog.flatMap((scenario) =>
      scenario.steps.filter((step) => step.tab === "chat" && step.automation?.expect)
    );

    expect(automatedChatSteps.length).toBeGreaterThan(0);

    automatedChatSteps.forEach((step) => {
      expect(step.automation?.composerSeed, `${step.id} should define composerSeed`).toBeTruthy();
      expect(step.automation?.expect?.userPrompt, `${step.id} should define expect.userPrompt`).toBeTruthy();
      expect(step.automation?.composerSeed).toBe(step.automation?.expect?.userPrompt);
    });
  });

  it("uses YAML automation to seed the composer for MCP snapshot steps", () => {
    const step = getStep("agent-browser-mcp-chat", "snapshot_trending");
    const controller: TutorialEntryController = {
      setActiveTab: vi.fn(),
      setConfigModal: vi.fn(),
      setActiveAgentId: vi.fn(),
      setSelectedAgentId: vi.fn(),
      setSkillExecutionMode: vi.fn(),
      setSkillVerifyMax: vi.fn(),
      setSkillToolLoopMax: vi.fn(),
      setAgentLoadBalancerRetryPolicy: vi.fn(),
      setComposerSeed: vi.fn(),
      clearChat: vi.fn(),
      seedTutorialLoadBalancerDraft: vi.fn(),
      ensureTutorialAgentBrowserMcpTools: vi.fn(),
      ensureTutorialSequentialSkill: vi.fn(),
      ensureTutorialChatgptBrowserSkill: vi.fn()
    };

    applyTutorialStepEntry(
      step,
      makeState({
        agents: [makeTutorialAgentBase({ enableMcp: true })]
      }),
      controller
    );

    expect(controller.setActiveTab).toHaveBeenCalledWith("chat");
    expect(controller.setComposerSeed).toHaveBeenCalledWith(
      "請明確使用 MCP 工具 browser_snapshot 讀取目前瀏覽器頁面，整理出 GitHub Trending 前十個熱門 repo 名稱。"
    );
  });

  it("requires tool result to be opened when YAML says requireOpenedToolResult", () => {
    const step = getStep("built-in-tools-chat", "chat-user-profile-tool");
    const prompt = step.automation?.expect?.userPrompt ?? "";
    const assistant = makeAssistant("assistant-1", "這是回覆");
    const history = [makeUser(prompt), makeTool("Built-in tool -> get_user_profile"), assistant];

    const incomplete = evaluateTutorialStep(step, makeState({ history }));
    expect(incomplete.completed).toBe(false);
    expect(incomplete.statusText).toContain("查看 tool result");

    const completed = evaluateTutorialStep(step, makeState({ history, openedToolResultMessageIds: [assistant.id] }));
    expect(completed.completed).toBe(true);
  });

  it("uses YAML skill-load assertions for sequential skill chat steps", () => {
    const step = getStep("sequential-skill-chat", "tone_chat");
    const prompt = step.automation?.expect?.userPrompt ?? "";
    const assistant = makeAssistant("assistant-skill", "冷靜又有條理的回答", {
      skillTrace: [
        {
          label: "Skill load",
          content: "已載入 skill：sequential-thinking (sequential-thinking-tutorial-skill)"
        }
      ]
    });
    const result = evaluateTutorialStep(step, makeState({ history: [makeUser(prompt), assistant] }));
    expect(result.completed).toBe(true);
  });

  it("requires messages sent to model to be 1 for history limit tutorial steps", () => {
    const step = getStep("built-in-tools-chat", "set-history-limit");
    expect(evaluateTutorialStep(step, makeState({ historyMessageLimit: 10 })).completed).toBe(false);
    expect(evaluateTutorialStep(step, makeState({ historyMessageLimit: 1 })).completed).toBe(true);
  });

  it("keeps multi-turn browser skill runtime parameters in YAML", () => {
    const step = getStep("chatgpt-browser-skill", "run_chatgpt_flow");
    expect(step.automation?.skillExecutionMode).toBe("multi_turn");
    expect(step.automation?.skillToolLoopMax).toBe(8);
    expect(step.automation?.skillVerifyMax).toBe(2);
    expect(step.automation?.loadBalancerDelaySecond).toBe(10);
    expect(step.automation?.loadBalancerMaxRetries).toBe(10);
    expect(step.automation?.composerSeed).toBe("請幫我打開 Google AI 模式並詢問「你是什麼模型，還有今天台北天氣如何」");
    expect(step.automation?.expect?.requireSkillTodo).toBe(true);
    expect(step.automation?.expect?.requireSkillTodoProgress).toBe(true);
  });

  it("uses multi-turn todo expectations for the Google AI browser skill step", () => {
    const step = getStep("chatgpt-browser-skill", "run_chatgpt_flow");
    const prompt = step.automation?.expect?.userPrompt ?? "";
    const assistant = makeAssistant("assistant-multi-turn", "這是多輪 skill 回覆", {
      skillTrace: [{ label: "Skill load", content: "已載入 skill：google-ai-browser-multiturn" }],
      skillTodo: [
        { id: "todo-1", label: "打開 Google", status: "completed", source: "planner", updatedAt: Date.now() },
        { id: "todo-2", label: "輸入問題", status: "in_progress", source: "planner", updatedAt: Date.now() }
      ],
      skillPhase: "act"
    });
    const tool = makeTool("MCP 教學用MCP -> browser_open");
    const result = evaluateTutorialStep(step, makeState({ history: [makeUser(prompt), tool, assistant], openedToolResultMessageIds: [assistant.id] }));
    expect(result.completed).toBe(true);
  });
});
