// @vitest-environment node

import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { getTutorialScenario, tutorialCatalog } from "../onboarding/catalog";
import { parseTutorialScenario } from "../onboarding/catalogCore";
import {
  applyTutorialStepEntry,
  TUTORIAL_AGENT_ROLE,
  evaluateTutorialStep,
  isTutorialHarnessStabilityTool,
  isTutorialTimeTool,
  TUTORIAL_TIME_TOOL_CODE,
  TUTORIAL_TIME_TOOL_DESCRIPTION,
  TUTORIAL_TIME_TOOL_INPUT_SCHEMA,
  TUTORIAL_TIME_TOOL_NAME,
  TUTORIAL_PRIMARY_MODEL,
  TUTORIAL_SECONDARY_MODEL,
  TUTORIAL_TEXT_PROTOCOL_MODEL,
  TUTORIAL_TEXT_PROTOCOL_LOAD_BALANCER_NAME,
  resolveTutorialExecutionDeadlineMs
} from "../onboarding/runtime";
import {
  TUTORIAL_HARNESS_STABILITY_TOOL_CODE,
  TUTORIAL_HARNESS_STABILITY_TOOL_DESCRIPTION,
  TUTORIAL_HARNESS_STABILITY_TOOL_INPUT_SCHEMA,
  TUTORIAL_HARNESS_STABILITY_TOOL_NAME
} from "../onboarding/tutorialHarnessStabilityToolTemplate";
import type { TutorialEntryController, TutorialRuntimeState, TutorialStepDefinition } from "../onboarding/types";
import type { AgentConfig, ChatMessage, LoadBalancerConfig, SkillConfig } from "../types";
import type { ModelCredentialEntry } from "../storage/settingsStore";
import {
  assertRealTutorialGate,
  assertRealTutorialScenariosSupported,
  LOCALHOST_GROQ_ENDPOINT,
  normalizeRealTutorialConfig,
  parseRealTutorialSessionCount,
  REAL_TUTORIAL_RUNNER_BEHAVIORS
} from "../onboarding/realTutorialContract";

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
        model: TUTORIAL_PRIMARY_MODEL,
        description: "",
        maxRetries: 4,
        delaySecond: 5,
        resumeMinute: 60,
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
    tutorialRole: TUTORIAL_AGENT_ROLE,
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

  it("gives the sequential references check an explicit bounded read sequence", () => {
    const step = getStep("sequential-skill-chat", "references_chat");
    const prompt = step.automation?.composerSeed ?? "";

    expect(prompt).toContain("skill.read");
    expect(prompt).toContain("references/advanced.md");
    expect(prompt).toContain("references/examples.md");
    expect(prompt).toContain("不要先回答");
  });

  it("explicitly activates the skill before tutorial skill chat steps", () => {
    const controller: TutorialEntryController = {
      setActiveTab: vi.fn(),
      setConfigModal: vi.fn(),
      setActiveAgentId: vi.fn(),
      setSelectedAgentId: vi.fn(),
      setAgentLoadBalancerRetryPolicy: vi.fn(),
      setExplicitSkillId: vi.fn(),
      setComposerSeed: vi.fn(),
      clearChat: vi.fn(),
      seedTutorialLoadBalancerDraft: vi.fn(),
      ensureTutorialAgentBrowserMcpTools: vi.fn(),
      ensureTutorialSequentialSkill: vi.fn(),
      ensureTutorialChatgptBrowserSkill: vi.fn(),
      ensureTutorialHarnessStabilityTool: vi.fn(),
      ensureTutorialHarnessStabilitySkill: vi.fn(),
      ensureTutorialTextProtocolLoadBalancer: vi.fn()
    };
    const skill = {
      id: "tutorial-skill-id",
      name: "Sequential Thinking Tutorial Skill",
      rootPath: "sequential-thinking-tutorial-skill"
    } as SkillConfig;

    applyTutorialStepEntry(
      getStep("sequential-skill-chat", "profile_tool_chat"),
      makeState({ skills: [skill] }),
      controller
    );

    expect(controller.setExplicitSkillId).toHaveBeenCalledWith(skill.id);

    const browserSkill = {
      ...skill,
      id: "browser-skill-id",
      name: "Browser Workflow Multi-turn Skill",
      rootPath: "browser-workflow-multi-turn-skill",
      skillMarkdown: "---\nname: browser-workflow-multiturn\n---\n"
    } as SkillConfig;
    applyTutorialStepEntry(
      getStep("chatgpt-browser-skill", "run_chatgpt_flow"),
      makeState({ skills: [browserSkill] }),
      controller
    );

    expect(controller.setExplicitSkillId).toHaveBeenLastCalledWith(browserSkill.id);

    const harnessSkill = {
      ...skill,
      id: "harness-skill-id",
      name: "Harness Stability Tutorial Skill",
      rootPath: "harness-stability-tutorial-skill",
      skillMarkdown: "---\nname: harness-stability\n---\n"
    } as SkillConfig;
    applyTutorialStepEntry(
      getStep("harness-stability-skill", "run-harness-flow"),
      makeState({ skills: [harnessSkill] }),
      controller
    );

    expect(controller.setExplicitSkillId).toHaveBeenLastCalledWith(harnessSkill.id);
  });

  it("defines grilling_invest as a bounded multi-turn, on-demand reference tutorial", () => {
    const scenario = getTutorialScenario("grilling-invest-skill");
    expect(scenario).toBeTruthy();
    const steps = scenario?.steps ?? [];
    expect(steps.find((step) => step.behavior === "set_history_limit_for_multiturn")?.automation).toBeDefined();
    const chatSteps = steps.filter((step) => step.behavior === "first_chat_skill_grilling_invest");
    expect(chatSteps.length).toBe(5);
    expect(chatSteps.slice(0, -1).every((step) => step.automation?.expect?.assistantQuestionCountMax === 1)).toBe(true);
    expect(chatSteps.slice(0, -1).every((step) => step.automation?.expect?.skillTraceExcludes?.includes("references/companies/"))).toBe(true);
    const finalStep = chatSteps.at(-1);
    expect(finalStep?.automation?.expect?.skillTraceIncludes).toContain("references/twse-top10-index.md");
    expect(finalStep?.automation?.expect?.skillTraceIncludesAny).toContain("references/companies/");
    expect(finalStep?.automation?.composerSeed).toContain("最多兩家");
  });

  it("evaluates Grill Me one-question and deferred-company checks from YAML", () => {
    const firstStep = getStep("grilling-invest-skill", "interview-start");
    const prompt = firstStep.automation?.expect?.userPrompt ?? "";
    const trace = [
      { label: "Skill load", content: "grilling_invest" },
      { label: "Skill resource", content: "references/risk-framework.md (1264 chars)" }
    ];
    expect(evaluateTutorialStep(firstStep, makeState({
      history: [makeUser(prompt), makeAssistant("assistant-invest-1", "我先確認你的投資期限？接著還想知道你的收入？", { skillTrace: trace })]
    })).completed).toBe(false);
    expect(evaluateTutorialStep(firstStep, makeState({
      history: [makeUser(prompt), makeAssistant("assistant-invest-2", "我先確認你的投資期限？", { skillTrace: trace })]
    })).completed).toBe(true);
    expect(evaluateTutorialStep(firstStep, makeState({
      history: [
        makeUser(prompt),
        makeAssistant("assistant-invest-company-leak", "我先確認你的投資期限？", {
          skillTrace: [
            ...trace,
            { label: "Skill resource", content: "references/companies/2330.md (500 chars)" }
          ]
        })
      ]
    })).completed).toBe(false);
    expect(evaluateTutorialStep(firstStep, makeState({
      history: [makeUser(prompt), makeAssistant("assistant-invest-duplicate-punctuation", "我先確認你的投資期限？？", { skillTrace: trace })]
    })).completed).toBe(true);

    const finalStep = getStep("grilling-invest-skill", "recommendation");
    const finalPrompt = finalStep.automation?.expect?.userPrompt ?? "";
    const indexOnlyTrace = [
      { label: "Skill load", content: "resource_paths=references/twse-top10-index.md,references/companies/2330.md" },
      { label: "Tool result", content: "internal:skill.read: success; path=references/twse-top10-index.md" }
    ];
    expect(evaluateTutorialStep(finalStep, makeState({
      history: [makeUser(finalPrompt), makeAssistant("assistant-invest-final", "2025 的教育性分析，這不是買賣指示。", { skillTrace: indexOnlyTrace })]
    })).completed).toBe(false);
  });

  it("requires both local tool successes and the fixed report for the harness stability chat", () => {
    const step = getStep("harness-stability-skill", "run-harness-flow");
    const prompt = step.automation?.expect?.userPrompt ?? "";
    const completeHistory = [
      makeUser(prompt),
      makeAssistant("assistant-harness", "【Harness 狀態】完成\n【Profile】Test User\n【驗證戳記】AGR-HARNESS-STABLE-V1", {
        skillTrace: [
          { label: "Skill loaded", content: "harness-stability-tutorial-skill" },
          { label: "Tool result", content: "builtin:system:get_user_profile [get_user_profile]: success; certainty=dispatched" },
          { label: "Tool result", content: "builtin:custom [教學 Harness 驗證戳記工具]: success; certainty=dispatched" }
        ]
      })
    ];
    expect(evaluateTutorialStep(step, makeState({ history: completeHistory })).completed).toBe(true);

    const missingStamp = completeHistory.map((item) => ({ ...item }));
    const assistant = missingStamp[1];
    if (assistant.role === "assistant") {
      assistant.skillTrace = assistant.skillTrace?.filter((entry) => !entry.content.includes("教學 Harness 驗證戳記工具"));
    }
    expect(evaluateTutorialStep(step, makeState({ history: missingStamp })).completed).toBe(false);
  });

  it("uses YAML automation to seed the composer for MCP snapshot steps", () => {
    const step = getStep("agent-browser-mcp-chat", "snapshot_trending");
    const controller: TutorialEntryController = {
      setActiveTab: vi.fn(),
      setConfigModal: vi.fn(),
      setActiveAgentId: vi.fn(),
      setSelectedAgentId: vi.fn(),
      setAgentLoadBalancerRetryPolicy: vi.fn(),
      setComposerSeed: vi.fn(),
      clearChat: vi.fn(),
      seedTutorialLoadBalancerDraft: vi.fn(),
      ensureTutorialAgentBrowserMcpTools: vi.fn(),
      ensureTutorialSequentialSkill: vi.fn(),
      ensureTutorialChatgptBrowserSkill: vi.fn(),
      ensureTutorialHarnessStabilityTool: vi.fn(),
      ensureTutorialHarnessStabilitySkill: vi.fn(),
      ensureTutorialTextProtocolLoadBalancer: vi.fn()
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

  it("requires the tutorial secondary load balancer to put the alternate key first", () => {
    const step = getStep("first-agent-chat", "create-multi-load-balancer");
    const now = Date.now();
    const primaryKey = { id: "credential-groq-key-1", apiKey: "test-key-1", createdAt: now, updatedAt: now };
    const alternateKey = { id: "credential-groq-key-2", apiKey: "test-key-2", createdAt: now, updatedAt: now };
    const primaryLoadBalancer = {
      ...makeTutorialLoadBalancer(),
      name: "教學用Load Balancer 1"
    };
    const baseInstance = primaryLoadBalancer.instances[0];
    const secondaryLoadBalancer: LoadBalancerConfig = {
      id: "lb-groq-secondary",
      name: "教學用Load Balancer 2",
      instances: [
        { ...baseInstance, id: "secondary-1", credentialKeyId: primaryKey.id, model: TUTORIAL_PRIMARY_MODEL },
        { ...baseInstance, id: "secondary-2", credentialKeyId: alternateKey.id, model: TUTORIAL_SECONDARY_MODEL },
        { ...baseInstance, id: "secondary-3", credentialKeyId: primaryKey.id, model: TUTORIAL_PRIMARY_MODEL }
      ],
      createdAt: now,
      updatedAt: now
    };
    const credential = { ...makeTutorialCredential(), keys: [primaryKey, alternateKey] };
    const state = makeState({
      credentials: [credential],
      loadBalancers: [primaryLoadBalancer, secondaryLoadBalancer]
    });

    expect(evaluateTutorialStep(step, state).completed).toBe(true);
    expect(evaluateTutorialStep(step, makeState({
      credentials: [credential],
      loadBalancers: [{
        ...secondaryLoadBalancer,
        instances: [secondaryLoadBalancer.instances[0], { ...secondaryLoadBalancer.instances[1], credentialKeyId: primaryKey.id }, { ...secondaryLoadBalancer.instances[2], credentialKeyId: alternateKey.id }]
      }, primaryLoadBalancer]
    })).completed).toBe(false);
  });

  it("requires the first tutorial load balancer to include both configured keys", () => {
    const step = getStep("first-agent-chat", "create-single-load-balancer");
    const now = Date.now();
    const primaryKey = { id: "credential-groq-key-1", apiKey: "test-key-1", createdAt: now, updatedAt: now };
    const alternateKey = { id: "credential-groq-key-2", apiKey: "test-key-2", createdAt: now, updatedAt: now };
    const credential = { ...makeTutorialCredential(), keys: [primaryKey, alternateKey] };
    const firstInstance = makeTutorialLoadBalancer().instances[0];
    const loadBalancer = {
      ...makeTutorialLoadBalancer(),
      name: "教學用Load Balancer 1",
      instances: [
        { ...firstInstance, credentialId: credential.id, credentialKeyId: primaryKey.id },
        { ...firstInstance, id: "lb-groq-instance-2", credentialId: credential.id, credentialKeyId: alternateKey.id }
      ]
    };

    expect(evaluateTutorialStep(step, makeState({ credentials: [credential], loadBalancers: [loadBalancer] })).completed).toBe(true);
    expect(evaluateTutorialStep(step, makeState({
      credentials: [credential],
      loadBalancers: [{ ...loadBalancer, instances: [loadBalancer.instances[0]] }]
    })).completed).toBe(false);
  });

  it("requires an exact single text protocol instance for tutorial 9", () => {
    const step = getStep("text-protocol-conformance", "create-text-protocol-load-balancer");
    const baseInstance = makeTutorialLoadBalancer().instances[0];
    const textLoadBalancer: LoadBalancerConfig = {
      ...makeTutorialLoadBalancer(),
      id: "lb-text-protocol",
      name: TUTORIAL_TEXT_PROTOCOL_LOAD_BALANCER_NAME,
      instances: [{ ...baseInstance, model: TUTORIAL_TEXT_PROTOCOL_MODEL, toolTransportPolicy: "text_only" }]
    };

    expect(evaluateTutorialStep(step, makeState({ loadBalancers: [textLoadBalancer] })).completed).toBe(true);
    expect(evaluateTutorialStep(step, makeState({
      loadBalancers: [{ ...textLoadBalancer, instances: [{ ...baseInstance, toolTransportPolicy: "native_only" }] }]
    })).completed).toBe(false);
    expect(evaluateTutorialStep(step, makeState({
      loadBalancers: [{ ...textLoadBalancer, instances: [textLoadBalancer.instances[0], { ...baseInstance, id: "text-2", toolTransportPolicy: "text_only" }] }]
    })).completed).toBe(false);
  });

  it("requires the tutorial agent to use the dedicated text protocol load balancer", () => {
    const step = getStep("text-protocol-conformance", "switch-agent-to-text-protocol-load-balancer");
    const loadBalancer: LoadBalancerConfig = {
      ...makeTutorialLoadBalancer(),
      id: "lb-text-protocol",
      name: TUTORIAL_TEXT_PROTOCOL_LOAD_BALANCER_NAME
    };

    expect(evaluateTutorialStep(step, makeState({
      agents: [makeTutorialAgentBase({ loadBalancerId: loadBalancer.id })],
      loadBalancers: [loadBalancer]
    })).completed).toBe(true);
    expect(evaluateTutorialStep(step, makeState({ loadBalancers: [loadBalancer] })).completed).toBe(false);
  });

  it("ensures the text protocol load balancer when entering tutorial 9", () => {
    const ensureTextLoadBalancer = vi.fn();
    const controller: TutorialEntryController = {
      setActiveTab: vi.fn(),
      setConfigModal: vi.fn(),
      setActiveAgentId: vi.fn(),
      setSelectedAgentId: vi.fn(),
      setAgentLoadBalancerRetryPolicy: vi.fn(),
      setComposerSeed: vi.fn(),
      clearChat: vi.fn(),
      ensureTutorialPrimaryLoadBalancer: vi.fn(),
      ensureTutorialSecondaryLoadBalancer: vi.fn(),
      ensureTutorialTextProtocolLoadBalancer: ensureTextLoadBalancer,
      seedTutorialLoadBalancerDraft: vi.fn(),
      ensureTutorialDoc: vi.fn(),
      ensureTutorialTimeTool: vi.fn(),
      ensureTutorialAgentBrowserMcpTools: vi.fn(),
      ensureTutorialSequentialSkill: vi.fn(),
      ensureTutorialChatgptBrowserSkill: vi.fn(),
      ensureTutorialHarnessStabilityTool: vi.fn(),
      ensureTutorialHarnessStabilitySkill: vi.fn()
    };

    applyTutorialStepEntry(
      getStep("text-protocol-conformance", "create-text-protocol-load-balancer"),
      makeState(),
      controller
    );

    expect(ensureTextLoadBalancer).toHaveBeenCalledTimes(1);
  });

  it("never selects managed MAGI agents as tutorial active agents", () => {
    const step = getStep("agent-browser-mcp-chat", "set-history-limit");
    const controller: TutorialEntryController = {
      setActiveTab: vi.fn(),
      setConfigModal: vi.fn(),
      setActiveAgentId: vi.fn(),
      setSelectedAgentId: vi.fn(),
      setAgentLoadBalancerRetryPolicy: vi.fn(),
      setComposerSeed: vi.fn(),
      clearChat: vi.fn(),
      seedTutorialLoadBalancerDraft: vi.fn(),
      ensureTutorialAgentBrowserMcpTools: vi.fn(),
      ensureTutorialSequentialSkill: vi.fn(),
      ensureTutorialChatgptBrowserSkill: vi.fn(),
      ensureTutorialHarnessStabilityTool: vi.fn(),
      ensureTutorialHarnessStabilitySkill: vi.fn(),
      ensureTutorialTextProtocolLoadBalancer: vi.fn()
    };
    const now = Date.now();
    const magiAgent = makeTutorialAgentBase({
      id: "agent-casper",
      name: "Casper",
      tutorialRole: undefined,
      managedBy: "magi",
      managedUnitId: "Casper"
    });
    const tutorialAgent = makeTutorialAgentBase({
      id: "agent-tutorial",
      name: "教學測試 Agent"
    });

    applyTutorialStepEntry(
      step,
      makeState({
        agents: [magiAgent, tutorialAgent],
        activeAgentId: tutorialAgent.id,
        selectedAgentId: tutorialAgent.id,
        loadBalancers: [
          {
            id: "lb-groq",
            name: "教學用Load Balancer 1",
            instances: [
              {
                id: "lb-groq-instance-1",
                credentialId: "credential-groq",
                credentialKeyId: "credential-groq-key-1",
                model: TUTORIAL_PRIMARY_MODEL,
                description: "",
                maxRetries: 4,
                delaySecond: 5,
                resumeMinute: 60,
                failure: false,
                failureCount: 0,
                nextCheckTime: null,
                createdAt: now,
                updatedAt: now
              }
            ],
            createdAt: now,
            updatedAt: now
          }
        ]
      }),
      controller
    );

    expect(controller.setActiveAgentId).toHaveBeenCalledWith(tutorialAgent.id);
    expect(controller.setSelectedAgentId).toHaveBeenCalledWith(tutorialAgent.id);
  });

  it("requires the explicit tutorial tag instead of any random matching load balancer agent", () => {
    const step = getStep("agent-browser-mcp-chat", "set-history-limit");
    const controller: TutorialEntryController = {
      setActiveTab: vi.fn(),
      setConfigModal: vi.fn(),
      setActiveAgentId: vi.fn(),
      setSelectedAgentId: vi.fn(),
      setAgentLoadBalancerRetryPolicy: vi.fn(),
      setComposerSeed: vi.fn(),
      clearChat: vi.fn(),
      seedTutorialLoadBalancerDraft: vi.fn(),
      ensureTutorialAgentBrowserMcpTools: vi.fn(),
      ensureTutorialSequentialSkill: vi.fn(),
      ensureTutorialChatgptBrowserSkill: vi.fn(),
      ensureTutorialHarnessStabilityTool: vi.fn(),
      ensureTutorialHarnessStabilitySkill: vi.fn(),
      ensureTutorialTextProtocolLoadBalancer: vi.fn()
    };

    const untaggedAgent = makeTutorialAgentBase({
      id: "agent-untagged",
      name: "一般 Agent",
      tutorialRole: undefined
    });

    applyTutorialStepEntry(
      step,
      makeState({
        agents: [untaggedAgent],
        activeAgentId: "",
        selectedAgentId: ""
      }),
      controller
    );

    expect(controller.setActiveAgentId).not.toHaveBeenCalled();
    expect(controller.setSelectedAgentId).not.toHaveBeenCalled();
  });

  it("uses activity trace for a successful built-in tool call", () => {
    const step = getStep("built-in-tools-chat", "chat-user-profile-tool");
    const prompt = step.automation?.expect?.userPrompt ?? "";
    const assistant = makeAssistant("assistant-1", "這是回覆", {
      skillTrace: [{ label: "Tool result", content: "Built-in tool get_user_profile completed. [builtin:get_user_profile] success" }]
    });
    const history = [makeUser(prompt), assistant];

    const result = evaluateTutorialStep(step, makeState({ history }));
    expect(result.completed).toBe(true);
  });

  it("accepts alternative tool ids when the tutorial step defines trace namesAny", () => {
    const step = getStep("agent-browser-mcp-chat", "open_trending");
    const prompt = step.automation?.expect?.userPrompt ?? "";
    const assistant = makeAssistant("assistant-open", "已成功打開 GitHub Trending。", {
      skillTrace: [{ label: "Tool result", content: "MCP tool visit completed. [mcp:tutorial:visit] success" }]
    });
    const history = [makeUser(prompt), assistant];

    const result = evaluateTutorialStep(step, makeState({ history }));
    expect(result.completed).toBe(true);
  });

  it("uses the latest assistant reply within the same chat turn for tool-result steps", () => {
    const step = getStep("built-in-tools-chat", "chat-time-tool");
    const prompt = step.automation?.expect?.userPrompt ?? "";
    const assistantEarly = makeAssistant("assistant-early", "我先確認一下要呼叫哪個工具");
    const assistantFinal = makeAssistant("assistant-final", "已打開時鐘 dashboard，目前時區是 Asia/Taipei。", {
      skillTrace: [{ label: "Tool result", content: "Built-in tool 教學用時鐘工具 completed. [builtin:tutorial-time-tool] success" }]
    });
    const history = [
      makeUser(prompt),
      assistantEarly,
      assistantFinal
    ];

    const result = evaluateTutorialStep(step, makeState({ history, openedToolResultMessageIds: [assistantFinal.id] }));
    expect(result.completed).toBe(true);
  });

  it("accepts All built-in tools for the tutorial built-in access step", () => {
    const step = getStep("built-in-tools-chat", "enable-tool-access");
    const result = evaluateTutorialStep(
      step,
      makeState({
        agents: [
          makeTutorialAgentBase({
            enableBuiltInTools: true,
            allowedBuiltInToolIds: undefined
          })
        ],
        builtInTools: [
          {
            id: "tutorial-time-tool",
            name: "教學用時鐘工具",
            description: "desc",
            inputSchema: {},
            code: "return {}",
            source: "custom",
            createdAt: Date.now(),
            updatedAt: Date.now()
          }
        ]
      })
    );

    expect(result.completed).toBe(true);
  });

  it("uses YAML skill-load assertions for sequential skill chat steps", () => {
    const step = getStep("sequential-skill-chat", "tone_chat");
    const prompt = step.automation?.expect?.userPrompt ?? "";
    const assistant = makeAssistant("assistant-skill", "冷靜又有條理的回答", {
      skillTrace: [
        {
          label: "Skill loaded",
          content: "已載入 skill：sequential-thinking (sequential-thinking-tutorial-skill)"
        }
      ]
    });
    const result = evaluateTutorialStep(step, makeState({ history: [makeUser(prompt), assistant] }));
    expect(result.completed).toBe(true);
  });

  it("keeps the sequential profile check focused on the natural user question", () => {
    const step = getStep("sequential-skill-chat", "profile_tool_chat");
    expect(step.automation?.composerSeed).toBe("你知道我是誰嗎?!?!?!");
    expect(step.automation?.expect?.userPrompt).toBe(step.automation?.composerSeed);
  });

  it("requires messages sent to model to be 1 for history limit tutorial steps", () => {
    const step = getStep("built-in-tools-chat", "set-history-limit");
    expect(evaluateTutorialStep(step, makeState({ historyMessageLimit: 10 })).completed).toBe(false);
    expect(evaluateTutorialStep(step, makeState({ historyMessageLimit: 1 })).completed).toBe(true);
  });

  it("keeps browser skill workflow expectations in YAML", () => {
    const step = getStep("chatgpt-browser-skill", "run_chatgpt_flow");
    expect(step.automation?.loadBalancerDelaySecond).toBe(10);
    expect(step.automation?.loadBalancerMaxRetries).toBe(10);
    expect(step.automation?.executionDeadlineMs).toBe(900000);
    expect(step.automation?.composerSeed).toContain("幫我打開 https://github.com/trending?since=daily，點進第一名的 repo，然後告訴我它的內容摘要");
    expect(step.automation?.composerSeed).toContain("provider rate limit");
    expect(step.automation?.composerSeed).toContain("先等待 runtime 的 retry 或 Load Balancer failover");
    expect(step.automation?.expect?.userPrompt).toBe(step.automation?.composerSeed);
  });

  it("applies a configured tutorial deadline without changing the normal fallback", () => {
    const browserStep = getStep("chatgpt-browser-skill", "run_chatgpt_flow");
    const normalStep = getStep("first-agent-chat", "intro");
    expect(resolveTutorialExecutionDeadlineMs(browserStep, 300000)).toBe(900000);
    expect(resolveTutorialExecutionDeadlineMs(normalStep, 300000)).toBe(300000);
    expect(
      resolveTutorialExecutionDeadlineMs(
        { ...normalStep, automation: { executionDeadlineMs: 1 } },
        300000
      )
    ).toBe(10000);
  });

  it("uses activity trace and tool expectations for the browser workflow skill step", () => {
    const step = getStep("chatgpt-browser-skill", "run_chatgpt_flow");
    const prompt = step.automation?.expect?.userPrompt ?? "";
    const assistant = makeAssistant("assistant-multi-turn", "已完成 GitHub repo README 摘要。", {
      skillTrace: [
        { label: "Skill loaded", content: "已載入 skill：browser-workflow-multiturn" },
        { label: "Tool result", content: "MCP tool browser_open completed. [mcp:tutorial:browser_open] success" },
        { label: "Tool result", content: "MCP tool browser_snapshot completed. [mcp:tutorial:browser_snapshot] success" },
        { label: "Tool result", content: "MCP tool browser_click completed. [mcp:tutorial:browser_click] success" }
      ],
    });
    const openTool = makeTool("MCP 教學用MCP -> browser_open");
    const snapshotTool = makeTool("MCP 教學用MCP -> browser_snapshot");
    const clickTool = makeTool("MCP 教學用MCP -> browser_click");
    const result = evaluateTutorialStep(
      step,
      makeState({ history: [makeUser(prompt), openTool, snapshotTool, clickTool, assistant], openedToolResultMessageIds: [assistant.id] })
    );
    expect(result.completed).toBe(true);
  });

  it("rejects structured assistant failure content even if tokens match the expectation", () => {
    const step = getStep("chatgpt-browser-skill", "run_chatgpt_flow");
    const prompt = step.automation?.expect?.userPrompt ?? "";
    const assistant = makeAssistant(
      "assistant-failure",
      [
        "【執行失敗】",
        "這一輪請求沒有成功完成，系統已停止重試。",
        "",
        "【原始任務】",
        prompt,
        "",
        "【錯誤訊息】",
        "browser_click 呼叫失敗（✗ Unknown ref: e47）",
        "",
        "GitHub repo README"
      ].join("\n"),
      {
        skillTrace: [{ label: "Skill loaded", content: "已載入 skill：browser-workflow-multiturn" }],
      }
    );
    const openTool = makeTool("MCP 教學用MCP -> browser_open");
    const snapshotTool = makeTool("MCP 教學用MCP -> browser_snapshot");
    const clickTool = makeTool("MCP 教學用MCP -> browser_click");
    const result = evaluateTutorialStep(step, makeState({ history: [makeUser(prompt), openTool, snapshotTool, clickTool, assistant] }));
    expect(result.completed).toBe(false);
    expect(result.statusText).toContain("執行失敗");
  });

  it("does not accept a failed built-in tool trace as a successful step", () => {
    const step = getStep("built-in-tools-chat", "chat-time-tool");
    const prompt = step.automation?.expect?.userPrompt ?? "";
    const result = evaluateTutorialStep(
      step,
      makeState({
        history: [
          makeUser(prompt),
          makeAssistant("assistant-failed-builtin", "我目前無法打開時鐘。", {
            skillTrace: [{ label: "Tool result", content: "教學用時鐘工具: failed; certainty=dispatched; error=tool_execution_failed" }]
          })
        ]
      })
    );
    expect(result.completed).toBe(false);
  });

  it("does not accept a failed MCP tool trace as a successful step", () => {
    const step = getStep("agent-browser-mcp-chat", "open_trending");
    const prompt = step.automation?.expect?.userPrompt ?? "";
    const result = evaluateTutorialStep(
      step,
      makeState({
        history: [
          makeUser(prompt),
          makeAssistant("assistant-failed-mcp", "我目前無法開啟頁面。", {
            skillTrace: [{ label: "Tool result", content: "mcp:tutorial:browser_open: failed_before_dispatch; certainty=not_dispatched; error=mcp_routing_failed" }]
          })
        ]
      })
    );
    expect(result.completed).toBe(false);
  });

  it("does not accept a failed browser-skill tool trace as a completed workflow", () => {
    const step = getStep("chatgpt-browser-skill", "run_chatgpt_flow");
    const prompt = step.automation?.expect?.userPrompt ?? "";
    const result = evaluateTutorialStep(
      step,
      makeState({
        history: [
          makeUser(prompt),
          makeAssistant("assistant-failed-browser", "GitHub repo 摘要如下。", {
            skillTrace: [
              { label: "Skill loaded", content: "已載入 skill：browser-workflow-multiturn" },
              { label: "Tool result", content: "mcp:tutorial:browser_open: success; certainty=dispatched" },
              { label: "Tool result", content: "mcp:tutorial:browser_snapshot: success; certainty=dispatched" },
              { label: "Tool result", content: "mcp:tutorial:browser_click: failed; certainty=dispatched; error=mcp_outcome_unknown" }
            ]
          })
        ]
      })
    );
    expect(result.completed).toBe(false);
  });

  it("keeps the real runner behavior contract in sync with every tutorial YAML", async () => {
    const tutorialDir = path.resolve(import.meta.dirname, "../onboarding/tutorials");
    const files = [
      "first-agent-chat.yaml",
      "docs-persona-chat.yaml",
      "built-in-tools-chat.yaml",
      "sequential-skill-chat.yaml",
      "agent-browser-mcp-chat.yaml",
      "chatgpt-browser-skill.yaml",
      "harness-stability-skill.yaml",
      "grilling-invest-skill.yaml"
    ];
    const scenarios = await Promise.all(files.map(async (file) => parseTutorialScenario(await fs.readFile(path.join(tutorialDir, file), "utf8"))));
    expect(() => assertRealTutorialScenariosSupported(scenarios)).not.toThrow();
    expect(() => assertRealTutorialScenariosSupported([{
      id: "future-scenario",
      title: "",
      description: "",
      exitTitle: "",
      exitBody: "",
      steps: [{ id: "future-step", behavior: "future_behavior" as TutorialStepDefinition["behavior"] } as TutorialStepDefinition]
    }])).toThrow("future-scenario/future-step");

    const runnerSource = await fs.readFile(path.resolve(import.meta.dirname, "../../scripts/real-tutorial-runner.ts"), "utf8");
    REAL_TUTORIAL_RUNNER_BEHAVIORS.forEach((behavior) => {
      expect(runnerSource).toContain(`case "${behavior}"`);
    });
  });

  it("validates the real tutorial provider config and fixed tutorial model", () => {
    expect(normalizeRealTutorialConfig({
      provider: "groq",
      apiKey: ["key-1", "key-2"],
      endpoint: `${LOCALHOST_GROQ_ENDPOINT}/`,
      model: TUTORIAL_PRIMARY_MODEL
    })).toEqual({
      provider: "groq",
      apiKeys: ["key-1", "key-2"],
      endpoint: LOCALHOST_GROQ_ENDPOINT,
      model: TUTORIAL_PRIMARY_MODEL
    });
    expect(() => normalizeRealTutorialConfig({ provider: "groq", apiKey: "key", endpoint: LOCALHOST_GROQ_ENDPOINT })).toThrow("model");
    expect(() => normalizeRealTutorialConfig({
      provider: "groq",
      apiKey: "key",
      endpoint: LOCALHOST_GROQ_ENDPOINT,
      model: "another-model"
    })).toThrow(TUTORIAL_PRIMARY_MODEL);
  });

  it("classifies only the exact tutorial clock as presentation-only", () => {
    const tool = {
      name: TUTORIAL_TIME_TOOL_NAME,
      description: TUTORIAL_TIME_TOOL_DESCRIPTION,
      inputSchema: TUTORIAL_TIME_TOOL_INPUT_SCHEMA,
      code: "return 'clock';"
    };
    expect(isTutorialTimeTool(tool)).toBe(false);
    expect(isTutorialTimeTool({
      ...tool,
      code: "if (!dashboard) throw new Error('missing');\nreturn {};"
    })).toBe(false);
    expect(isTutorialTimeTool({ ...tool, code: TUTORIAL_TIME_TOOL_CODE })).toBe(true);
  });

  it("recognizes only the exact deterministic harness stability tool", () => {
    const tool = {
      name: TUTORIAL_HARNESS_STABILITY_TOOL_NAME,
      description: TUTORIAL_HARNESS_STABILITY_TOOL_DESCRIPTION,
      inputSchema: TUTORIAL_HARNESS_STABILITY_TOOL_INPUT_SCHEMA,
      code: "return { stamp: 'unexpected' };"
    };
    expect(isTutorialHarnessStabilityTool(tool)).toBe(false);
    expect(isTutorialHarnessStabilityTool({ ...tool, code: TUTORIAL_HARNESS_STABILITY_TOOL_CODE })).toBe(true);
  });

  it("validates real tutorial session counts and rollout gate requirements", () => {
    expect(parseRealTutorialSessionCount(undefined)).toBe(1);
    expect(parseRealTutorialSessionCount("10")).toBe(10);
    expect(parseRealTutorialSessionCount("100")).toBe(100);
    expect(() => parseRealTutorialSessionCount("0")).toThrow("1 到 100");
    expect(() => parseRealTutorialSessionCount("101")).toThrow("1 到 100");
    expect(() => parseRealTutorialSessionCount("not-a-number")).toThrow("1 到 100");

    expect(() => assertRealTutorialGate({ enabled: false, only: "", sessions: 1 })).not.toThrow();
    expect(() => assertRealTutorialGate({ enabled: true, only: "chatgpt-browser-skill", sessions: 10 })).not.toThrow();
    expect(() => assertRealTutorialGate({ enabled: true, only: "harness-stability-skill", sessions: 10 })).not.toThrow();
    expect(() => assertRealTutorialGate({ enabled: true, only: "grilling-invest-skill", sessions: 10 })).not.toThrow();
    expect(() => assertRealTutorialGate({ enabled: true, only: "text-protocol-conformance", sessions: 3 })).not.toThrow();
    expect(() => assertRealTutorialGate({ enabled: true, only: "chatgpt-browser-skill", sessions: 9 })).toThrow("至少為 10");
    expect(() => assertRealTutorialGate({ enabled: true, only: "text-protocol-conformance", sessions: 2 })).toThrow("至少為 3");
    expect(() => assertRealTutorialGate({ enabled: true, only: "built-in-tools-chat", sessions: 10 })).toThrow("grilling-invest-skill");
  });

});
