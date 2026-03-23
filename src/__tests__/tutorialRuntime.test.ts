// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { getTutorialScenario, tutorialCatalog } from "../onboarding/catalog";
import { applyTutorialStepEntry, evaluateTutorialStep } from "../onboarding/runtime";
import type { TutorialEntryController, TutorialRuntimeState, TutorialStepDefinition } from "../onboarding/types";
import type { AgentConfig, ChatMessage } from "../types";

function makeTutorialAgentBase(overrides?: Partial<AgentConfig>): AgentConfig {
  return {
    id: "agent-groq",
    name: "Tutorial Groq Agent",
    type: "openai_compat",
    endpoint: "https://api.groq.com/openai/v1",
    model: "moonshotai/kimi-k2-instruct-0905",
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
    credentials: [],
    credentialTestResults: {},
    history: [],
    currentChatInput: "",
    builtInTools: [],
    docs: [],
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
      setSkillExecutionMode: vi.fn(),
      setComposerSeed: vi.fn(),
      clearChat: vi.fn(),
      ensureTutorialSequentialSkill: vi.fn()
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
});
