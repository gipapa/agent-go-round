import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { parseTutorialScenario } from "../src/onboarding/catalogCore";
import { applyTutorialStepEntry, evaluateTutorialStep } from "../src/onboarding/runtime";
import type { TutorialEntryController, TutorialRuntimeState, TutorialStepDefinition } from "../src/onboarding/types";
import type { AgentConfig, ChatMessage, LoadBalancerConfig } from "../src/types";
import type { ModelCredentialEntry } from "../src/storage/settingsStore";

const TUTORIAL_DIR = path.resolve(import.meta.dirname, "../src/onboarding/tutorials");
const TUTORIAL_FILES = [
  "first-agent-chat.yaml",
  "docs-persona-chat.yaml",
  "built-in-tools-chat.yaml",
  "sequential-skill-chat.yaml",
  "agent-browser-mcp-chat.yaml",
  "chatgpt-browser-skill.yaml"
];

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

let tutorialCatalogPromise: Promise<ReturnType<typeof parseTutorialScenario>[]> | null = null;

async function loadTutorialCatalog() {
  if (!tutorialCatalogPromise) {
    tutorialCatalogPromise = Promise.all(
      TUTORIAL_FILES.map(async (file) => parseTutorialScenario(await fs.readFile(path.join(TUTORIAL_DIR, file), "utf8")))
    );
  }
  return tutorialCatalogPromise;
}

async function getStep(scenarioId: string, stepId: string): Promise<TutorialStepDefinition> {
  const tutorialCatalog = await loadTutorialCatalog();
  const scenario = tutorialCatalog.find((item) => item.id === scenarioId);
  assert.ok(scenario, `Scenario not found: ${scenarioId}`);
  const step = scenario.steps.find((item) => item.id === stepId);
  assert.ok(step, `Step not found: ${scenarioId}/${stepId}`);
  return step;
}

async function assertAllAutomatedChatStepsAreYamlDriven() {
  const tutorialCatalog = await loadTutorialCatalog();
  const automatedChatSteps = tutorialCatalog.flatMap((scenario) =>
    scenario.steps.filter((step) => step.tab === "chat" && step.automation?.expect)
  );

  assert.ok(automatedChatSteps.length > 0, "Expected at least one automated chat step.");

  automatedChatSteps.forEach((step) => {
    assert.ok(step.automation?.composerSeed, `${step.id} should define automation.composerSeed`);
    assert.ok(step.automation?.expect?.userPrompt, `${step.id} should define automation.expect.userPrompt`);
    assert.equal(
      step.automation?.composerSeed,
      step.automation?.expect?.userPrompt,
      `${step.id} should keep composerSeed and expect.userPrompt in sync`
    );
  });
}

async function assertApplyEntryUsesYamlSeed() {
  const step = await getStep("agent-browser-mcp-chat", "snapshot_trending");
  const calls: Record<string, any[]> = {
    setActiveTab: [],
    setConfigModal: [],
    setActiveAgentId: [],
    setSkillExecutionMode: [],
    setSkillVerifyMax: [],
    setSkillToolLoopMax: [],
    setAgentLoadBalancerRetryPolicy: [],
    setComposerSeed: [],
    clearChat: [],
    seedTutorialLoadBalancerDraft: [],
    ensureTutorialSequentialSkill: [],
    ensureTutorialChatgptBrowserSkill: []
  };
  const controller: TutorialEntryController = {
    setActiveTab: (value) => calls.setActiveTab.push(value),
    setConfigModal: (value) => calls.setConfigModal.push(value),
    setActiveAgentId: (value) => calls.setActiveAgentId.push(value),
    setSelectedAgentId: () => {},
    setSkillExecutionMode: (value) => calls.setSkillExecutionMode.push(value),
    setSkillVerifyMax: (value) => calls.setSkillVerifyMax.push(value),
    setSkillToolLoopMax: (value) => calls.setSkillToolLoopMax.push(value),
    setAgentLoadBalancerRetryPolicy: (agentId, value) => calls.setAgentLoadBalancerRetryPolicy.push({ agentId, ...value }),
    setComposerSeed: (value) => calls.setComposerSeed.push(value),
    clearChat: () => calls.clearChat.push(true),
    seedTutorialLoadBalancerDraft: (kind) => calls.seedTutorialLoadBalancerDraft.push(kind),
    ensureTutorialAgentBrowserMcpTools: () => {},
    ensureTutorialSequentialSkill: () => calls.ensureTutorialSequentialSkill.push(true),
    ensureTutorialChatgptBrowserSkill: () => calls.ensureTutorialChatgptBrowserSkill.push(true)
  };

  applyTutorialStepEntry(
    step,
    makeState({
      agents: [makeTutorialAgentBase({ enableMcp: true })]
    }),
    controller
  );

  assert.equal(calls.setActiveTab[0], "chat");
  assert.equal(
    calls.setComposerSeed[0],
    "請明確使用 MCP 工具 browser_snapshot 讀取目前瀏覽器頁面，整理出 GitHub Trending 前十個熱門 repo 名稱。"
  );
}

async function assertToolResultOpenIsRequired() {
  const step = await getStep("built-in-tools-chat", "chat-user-profile-tool");
  const prompt = step.automation?.expect?.userPrompt ?? "";
  const assistant = makeAssistant("assistant-1", "這是回覆");
  const history = [makeUser(prompt), makeTool("Built-in tool -> get_user_profile"), assistant];

  const incomplete = evaluateTutorialStep(step, makeState({ history }));
  assert.equal(incomplete.completed, false);
  assert.match(incomplete.statusText ?? "", /tool result/);

  const complete = evaluateTutorialStep(step, makeState({ history, openedToolResultMessageIds: [assistant.id] }));
  assert.equal(complete.completed, true);
}

async function assertSkillLoadExpectationUsesYamlValues() {
  const step = await getStep("sequential-skill-chat", "tone_chat");
  const prompt = step.automation?.expect?.userPrompt ?? "";
  const assistant = makeAssistant("assistant-skill", "冷靜又有條理的回答", {
    skillTrace: [{ label: "Skill load", content: "已載入 skill：sequential-thinking (sequential-thinking-tutorial-skill)" }]
  });

  const result = evaluateTutorialStep(step, makeState({ history: [makeUser(prompt), assistant] }));
  assert.equal(result.completed, true);
}

async function assertHistoryLimitStepRequiresOne() {
  const step = await getStep("agent-browser-mcp-chat", "set-history-limit");
  assert.equal(evaluateTutorialStep(step, makeState({ historyMessageLimit: 10 })).completed, false);
  assert.equal(evaluateTutorialStep(step, makeState({ historyMessageLimit: 1 })).completed, true);
}

async function assertChatgptBrowserSkillAutomationExists() {
  const step = await getStep("chatgpt-browser-skill", "run_chatgpt_flow");
  assert.equal(step.automation?.skillExecutionMode, "multi_turn");
  assert.equal(step.automation?.skillToolLoopMax, 8);
  assert.equal(step.automation?.skillVerifyMax, 2);
  assert.equal(step.automation?.loadBalancerDelaySecond, 10);
  assert.equal(step.automation?.loadBalancerMaxRetries, 10);
  assert.equal(step.automation?.composerSeed, "幫我打開 https://github.com/trending，點進第一名的 repo，然後告訴我它的內容摘要");
  assert.equal(step.automation?.expect?.requireSkillTodo, true);
  assert.equal(step.automation?.expect?.requireSkillTodoProgress, true);
}

async function main() {
  await assertAllAutomatedChatStepsAreYamlDriven();
  await assertApplyEntryUsesYamlSeed();
  await assertToolResultOpenIsRequired();
  await assertSkillLoadExpectationUsesYamlValues();
  await assertHistoryLimitStepRequiresOne();
  await assertChatgptBrowserSkillAutomationExists();
  console.log("tutorial-runtime-check: ok");
}

await main();
