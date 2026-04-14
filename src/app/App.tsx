import React, { useMemo, useState } from "react";
import {
  AgentConfig,
  BrowserObservationDigest,
  BuiltInToolConfig,
  ChatTraceEntry,
  ChatMessage,
  DetectResult,
  LoadedSkillRuntime,
  MagiMode,
  MagiRenderState,
  MagiUnitId,
  OrchestratorMode,
  SkillExecutionMode,
  SkillStepDecision,
  SkillCompletionDecision,
  SkillPhase,
  SkillRunState,
  SkillTodoItem,
  DocItem,
  McpServerConfig,
  McpTool,
  LogEntry,
  LogOutcome,
  LoadBalancerConfig,
  SkillConfig,
  SkillDocItem,
  SkillFileItem
} from "../types";
import { loadAgents, upsertAgent, deleteAgent, saveAgents } from "../storage/agentStore";
import { loadChatHistory, saveChatHistory } from "../storage/chatStore";
import { loadBuiltInTools, saveBuiltInTools } from "../storage/builtInToolStore";
import { listDocs, upsertDoc, deleteDoc } from "../storage/docStore";
import {
  createEmptySkill,
  deleteSkill,
  deleteSkillTextFile,
  exportSkillZip,
  importSkillZip,
  listSkillDocs,
  listSkillFiles,
  listSkills,
  updateSkillMarkdown,
  upsertSkillTextFile
} from "../storage/skillStore";
import {
  loadModelCredentials,
  ModelCredentialEntry,
  McpPromptTemplates,
  loadLoadBalancers,
  loadMcpPromptTemplates,
  loadMcpServers,
  loadUiState,
  saveLoadBalancers,
  saveModelCredentials,
  saveMcpPromptTemplates,
  saveMcpServers,
  saveUiState
} from "../storage/settingsStore";

import { OpenAICompatAdapter } from "../adapters/openaiCompat";
import { ChromePromptAdapter } from "../adapters/chromePrompt";
import { CustomAdapter } from "../adapters/custom";

import { runOneToOne } from "../orchestrators/oneToOne";
import { createInitialState as createMagiRenderState, MAGI_UNIT_LAYOUT, MagiPreparedUnit, runMagi } from "../orchestrators/magi";
import { McpSseClient } from "../mcp/sseClient";
import { callTool, listTools } from "../mcp/toolRegistry";
import { createToolDashboardHelpers } from "../utils/toolDashboard";

import AgentsPanel from "../ui/AgentsPanel";
import BuiltInToolsPanel from "../ui/BuiltInToolsPanel";
import ChatPanel from "../ui/ChatPanel";
import DocsPanel from "../ui/DocsPanel";
import HelpModal from "../ui/HelpModal";
import LandingPage from "../ui/LandingPage";
import McpPanel from "../ui/McpPanel";
import SkillsPanel from "../ui/SkillsPanel";
import TutorialGuide from "../ui/TutorialGuide";
import LoadBalancersPanel from "../ui/LoadBalancersPanel";
import PromptTemplatesPanel from "../ui/PromptTemplatesPanel";
import { getTutorialCatalogError, getTutorialScenario, tutorialCatalog } from "../onboarding/catalog";
import {
  applyTutorialStepEntry,
  TUTORIAL_DOC_CONTENT,
  TUTORIAL_AGENT_ROLE,
  captureTutorialWorkspaceSnapshot,
  evaluateTutorialStep,
  restoreTutorialWorkspaceSnapshot,
  TUTORIAL_DOC_NAME,
  TUTORIAL_TIME_TOOL_CODE,
  TUTORIAL_TIME_TOOL_DESCRIPTION,
  TUTORIAL_TIME_TOOL_INPUT_SCHEMA,
  TUTORIAL_TIME_TOOL_NAME,
  TUTORIAL_MCP_NAME,
  TUTORIAL_PRIMARY_LOAD_BALANCER_NAME,
  TUTORIAL_PRIMARY_MODEL,
  TUTORIAL_SECONDARY_LOAD_BALANCER_NAME,
  TUTORIAL_SECONDARY_MODEL
} from "../onboarding/runtime";
import {
  TUTORIAL_CHATGPT_BROWSER_ASSET_CONTENT,
  TUTORIAL_CHATGPT_BROWSER_ASSET_PATH,
  TUTORIAL_CHATGPT_BROWSER_REFERENCE_CONTENT,
  TUTORIAL_CHATGPT_BROWSER_REFERENCE_PATH,
  TUTORIAL_CHATGPT_BROWSER_SKILL_MARKDOWN,
  TUTORIAL_CHATGPT_BROWSER_SKILL_NAME,
  TUTORIAL_CHATGPT_BROWSER_SKILL_ROOT,
  TUTORIAL_SEQUENTIAL_ADVANCED_CONTENT,
  TUTORIAL_SEQUENTIAL_ADVANCED_PATH,
  TUTORIAL_SEQUENTIAL_ASSET_CONTENT,
  TUTORIAL_SEQUENTIAL_ASSET_PATH,
  TUTORIAL_SEQUENTIAL_EXAMPLES_CONTENT,
  TUTORIAL_SEQUENTIAL_EXAMPLES_PATH,
  TUTORIAL_SEQUENTIAL_SKILL_MARKDOWN,
  TUTORIAL_SEQUENTIAL_SKILL_NAME,
  TUTORIAL_SEQUENTIAL_SKILL_ROOT
} from "../onboarding/tutorialSkillTemplate";
import { TutorialScenarioDefinition, TutorialStepEvaluation, TutorialWorkspaceSnapshot } from "../onboarding/types";
import { getMagiSkillBundle } from "../magi/magiSkills";
import {
  buildPromptTemplateRuntime,
  getDefaultPromptTemplate,
  getPromptTemplateFileId,
  loadPromptTemplateFiles,
  PromptTemplateBaseId,
  PromptTemplateFileState,
  resetPromptTemplateToDefault,
  savePromptTemplateFiles
} from "../promptTemplates/store";
import {
  buildSkillDecisionCatalog,
  buildSkillDecisionPrompt,
  buildSkillSessionSnapshot,
  getAllowedSkillsFromSnapshot,
  loadSkillRuntime,
  pushSkillTrace
} from "../runtime/skillRuntime";
import {
  buildSkillRefinementInput,
  buildSkillVerifyPrompt,
  clampSkillToolLoopMax,
  clampSkillVerifyMax,
  normalizeSkillVerifyDecision,
  pushSkillExecutionModeTrace
} from "../runtime/skillExecutor";
import {
  buildBootstrapPlanPrompt,
  buildCompletionGatePrompt,
  buildPlannerStepPrompt,
  normalizeSkillCompletionDecision,
  normalizeSkillStepDecision
} from "../runtime/skillPlanner";
import { runMultiTurnSkillRuntime } from "../runtime/multiTurnSkillRuntime";
import { extractBrowserObservation, formatBrowserObservationDigest } from "../runtime/browserObservation";
import { bootstrapTodoList, summarizeTodo } from "../runtime/skillTodo";
import { generateId } from "../utils/id";
import { runBuiltInScriptTool } from "../utils/runBuiltInScriptTool";
import { pickBestAgentNameForQuestion, loadSavedAgentsFromStorage } from "../utils/agentDirectoryTool";
import {
  SYSTEM_AGENT_DIRECTORY_TOOL_ID,
  SYSTEM_BUILT_IN_TOOLS,
  SYSTEM_REQUEST_CONFIRMATION_TOOL_ID,
  SYSTEM_USER_PROFILE_TOOL_ID
} from "../utils/systemBuiltInTools";
import { buildToolResultPromptBlock, ToolPromptDetailMode } from "../utils/toolResultSummary";
import { normalizeCredentialUrl } from "../utils/credential";
import { resetAgentGoRoundStorage } from "../utils/resetAppStorage";
import {
  applyInstanceFailure,
  applyInstanceSuccess,
  createCredentialEntry,
  createCredentialKeyEntry,
  createLoadBalancer,
  createLoadBalancerInstance,
  DEFAULT_INSTANCE_DELAY_SECOND,
  DEFAULT_INSTANCE_MAX_RETRIES,
  DEFAULT_INSTANCE_RESUME_MINUTE,
  describeCredentialPreset,
  getLoadBalancerResumeMs,
  migrateAgentsToLoadBalancers,
  resolveLoadBalancerCandidates,
  ResolvedLoadBalancerInstance,
  setLoadBalancerRetryPolicy
} from "../utils/loadBalancer";

function pickAdapter(a: AgentConfig) {
  if (a.type === "chrome_prompt") return ChromePromptAdapter;
  if (a.type === "custom") return CustomAdapter;
  return OpenAICompatAdapter;
}

function msg(
  role: ChatMessage["role"],
  content: string,
  name?: string,
  meta?: { displayName?: string; avatarUrl?: string }
): ChatMessage {
  return { id: generateId(), role, content, name, displayName: meta?.displayName, avatarUrl: meta?.avatarUrl, ts: Date.now() };
}

type McpAction = { type: "mcp_call"; tool: string; input?: any; serverId?: string };
type BuiltInToolAction = { type: "builtin_tool_call"; tool: string; input?: any };
type ToolDecision = { type: "no_tool" } | McpAction | BuiltInToolAction;
type SkillAction = { type: "skill_call"; skillId: string; input?: any };
type SkillDecision = { type: "no_skill" } | SkillAction;
type SkillBootstrapPlan = {
  todo: string[];
  taskSummary?: string;
  startUrl?: string;
  notes?: string[];
};
type PreparedSkillExecution = {
  baseInput: string;
  finalInput: string;
  toolAugmentation?: ToolAugmentationResult | null;
  system?: string;
  trace: ChatTraceEntry[];
  runtime: LoadedSkillRuntime;
  scopedBuiltInTools: BuiltInToolConfig[];
  scopedMcpServers: McpServerConfig[];
  scopedMcpTools: Array<{ server: McpServerConfig; tools: McpTool[] }>;
  decisionContext?: string;
};
type ToolEntry =
  | {
      kind: "mcp";
      server: McpServerConfig;
      tool: McpTool;
    }
  | {
      kind: "builtin";
      tool: BuiltInToolConfig;
    };

function normalizeToolDecisionAgainstAvailableTools(args: {
  decision: ToolDecision;
  availableBuiltinTools: BuiltInToolConfig[];
  availableMcpServers: McpServerConfig[];
  availableMcpTools: Array<{ server: McpServerConfig; tools: McpTool[] }>;
}) {
  if (args.decision.type === "no_tool" || args.decision.type === "builtin_tool_call") {
    return args.decision;
  }

  const decision = args.decision;
  const matchingBuiltIn = args.availableBuiltinTools.find((tool) => tool.name === decision.tool) ?? null;
  if (!matchingBuiltIn) {
    return decision;
  }

  const matchingServer = decision.serverId
    ? args.availableMcpServers.find((server) => server.id === decision.serverId) ?? null
    : null;
  const matchingMcpTool = decision.serverId
    ? args.availableMcpTools
        .find((entry) => entry.server.id === decision.serverId)
        ?.tools.find((tool) => tool.name === decision.tool) ?? null
    : null;

  if (matchingServer && matchingMcpTool) {
    return decision;
  }

  return {
    type: "builtin_tool_call" as const,
    tool: decision.tool,
    input: decision.input
  };
}
type ExportPayload =
  | { kind: "raw_history"; exportedAt: number; history: ChatMessage[] }
  | { kind: "summary_history"; exportedAt: number; summary: string; agent?: { id?: string; name?: string; model?: string } };

function extractJsonObject(text: string): any | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]);
  } catch {
    return null;
  }
}

function normalizeMcpAction(obj: any): McpAction | null {
  if (!obj || typeof obj !== "object") return null;
  const type =
    typeof obj.type === "string"
      ? obj.type.toLowerCase()
      : typeof obj.action === "string"
      ? obj.action.toLowerCase()
      : "";
  if (type === "mcp_call" && typeof obj.tool === "string") {
    return { type: "mcp_call", tool: obj.tool, input: obj.input, serverId: typeof obj.serverId === "string" ? obj.serverId : undefined };
  }
  return null;
}

function normalizeToolDecision(obj: any): ToolDecision | null {
  if (!obj || typeof obj !== "object") return null;
  if (obj.type === "no_tool") return { type: "no_tool" };
  if (obj.type === "user_profile_call" && obj.tool === "get_user_profile") {
    return { type: "builtin_tool_call", tool: "get_user_profile", input: {} };
  }
  if (obj.type === "builtin_tool_call" && typeof obj.tool === "string") {
    return { type: "builtin_tool_call", tool: obj.tool, input: obj.input };
  }
  const action = normalizeMcpAction(obj);
  if (!action?.serverId) return null;
  return action;
}

function normalizeSkillDecision(obj: any): SkillDecision | null {
  if (!obj || typeof obj !== "object") return null;
  if (obj.type === "no_skill") return { type: "no_skill" };
  if (obj.type === "skill_call" && typeof obj.skillId === "string" && obj.skillId.trim()) {
    return { type: "skill_call", skillId: obj.skillId.trim(), input: obj.input };
  }
  return null;
}

function normalizeSkillBootstrapPlan(obj: any): SkillBootstrapPlan | null {
  if (!obj || typeof obj !== "object" || !Array.isArray(obj.todo)) return null;
  const todo = obj.todo.filter((item: unknown) => typeof item === "string" && item.trim()).map((item: string) => item.trim()).slice(0, 7);
  if (!todo.length) return null;
  const taskSummary = typeof obj.taskSummary === "string" && obj.taskSummary.trim() ? obj.taskSummary.trim() : undefined;
  const startUrl = typeof obj.startUrl === "string" && obj.startUrl.trim() ? obj.startUrl.trim() : undefined;
  const notes = Array.isArray(obj.notes)
    ? obj.notes.filter((item: unknown) => typeof item === "string" && item.trim()).map((item: string) => item.trim()).slice(0, 5)
    : undefined;
  return { todo, taskSummary, startUrl, notes };
}

function extractFirstUrl(text: string) {
  const direct = String(text ?? "").match(/https?:\/\/[^\s"'`)>]+/i)?.[0];
  if (direct) return direct;
  const www = String(text ?? "").match(/\bwww\.[^\s"'`)>]+/i)?.[0];
  return www ? `https://${www}` : undefined;
}

function resolvePreferredBrowserHeadedMode(text: string) {
  const normalized = String(text ?? "").toLowerCase();
  if (!normalized.trim()) return false;

  const headedPatterns = [
    /視窗模式/,
    /有視窗/,
    /可見瀏覽器/,
    /顯示瀏覽器/,
    /headed/,
    /\bhead mode\b/,
    /head模式/,
    /window mode/,
    /visible browser/
  ];
  if (headedPatterns.some((pattern) => pattern.test(normalized))) {
    return true;
  }

  const headlessPatterns = [/headless/, /無視窗/, /不要開視窗/, /hidden browser/];
  if (headlessPatterns.some((pattern) => pattern.test(normalized))) {
    return false;
  }

  return false;
}

const MAGI_MODE_LABELS: Record<MagiMode, string> = {
  magi_vote: "S.C. Magi System (基本版: 三賢人同時表決)",
  magi_consensus: "S.C. Magi System (進階版: 三賢人共識)"
};

const MAGI_RESERVED_PREFIX = "[系統保留]";
const TUTORIAL_LOAD_BALANCER_NAMES = new Set([TUTORIAL_PRIMARY_LOAD_BALANCER_NAME, TUTORIAL_SECONDARY_LOAD_BALANCER_NAME]);

const MAGI_AGENT_DESCRIPTIONS: Record<MagiUnitId, string> = {
  Melchior: "S.C. MAGI 科學家單元。偏邏輯、證據、技術可行性與錯誤檢查。",
  Balthasar: "S.C. MAGI 母親單元。偏安全、人因、照護、營運穩定與使用者影響。",
  Casper: "S.C. MAGI 女人單元。偏直覺、自保、政治現實、風險與動機判讀。"
};

function normalizeMagiLookupKey(name: string) {
  return name.trim().toLowerCase();
}

function formatManagedMagiAgentName(unitId: MagiUnitId) {
  return `${MAGI_RESERVED_PREFIX} ${unitId}`;
}

function formatMagiUnitTitle(unitId: MagiUnitId) {
  const entry = MAGI_UNIT_LAYOUT.find((item) => item.unitId === unitId);
  return entry ? `${unitId} · ${entry.unitNumber}` : unitId;
}

function isManagedMagiAgent(agent: AgentConfig | null | undefined) {
  return !!agent && agent.managedBy === "magi" && !!agent.managedUnitId;
}

function matchesManagedMagiUnit(agent: AgentConfig, unitId: MagiUnitId) {
  if (agent.managedBy !== "magi") return false;
  if (agent.managedUnitId === unitId) return true;
  const normalizedName = normalizeMagiLookupKey(agent.name);
  return normalizedName === normalizeMagiLookupKey(unitId) || normalizedName === normalizeMagiLookupKey(formatManagedMagiAgentName(unitId));
}

function isTutorialPrimaryAgent(agent: AgentConfig | null | undefined) {
  return !!agent && agent.tutorialRole === TUTORIAL_AGENT_ROLE && !isManagedMagiAgent(agent);
}

function usesTutorialLoadBalancer(agent: AgentConfig, loadBalancers: LoadBalancerConfig[]) {
  if (!agent.loadBalancerId) return false;
  const loadBalancer = loadBalancers.find((entry) => entry.id === agent.loadBalancerId) ?? null;
  return !!loadBalancer && TUTORIAL_LOAD_BALANCER_NAMES.has(loadBalancer.name.trim());
}

function createManagedMagiAgent(unitId: MagiUnitId): AgentConfig {
  return {
    id: generateId(),
    name: formatManagedMagiAgentName(unitId),
    type: "openai_compat",
    description: MAGI_AGENT_DESCRIPTIONS[unitId],
    loadBalancerId: "",
    managedBy: "magi",
    managedUnitId: unitId,
    tutorialRole: undefined,
    enableDocs: false,
    enableMcp: false,
    enableBuiltInTools: false,
    enableSkills: true,
    allowedDocIds: [],
    allowedMcpServerIds: [],
    allowedBuiltInToolIds: [],
    allowedSkillIds: [],
    capabilities: { streaming: true }
  };
}

function normalizeManagedMagiAgent(agent: AgentConfig, unitId: MagiUnitId): AgentConfig {
  return {
    ...agent,
    name: formatManagedMagiAgentName(unitId),
    type: "openai_compat",
    description: MAGI_AGENT_DESCRIPTIONS[unitId],
    managedBy: "magi",
    managedUnitId: unitId,
    tutorialRole: undefined,
    enableDocs: false,
    enableMcp: false,
    enableBuiltInTools: false,
    enableSkills: true,
    allowedDocIds: [],
    allowedMcpServerIds: [],
    allowedBuiltInToolIds: [],
    allowedSkillIds: []
  };
}

function stringifyAny(v: any): string {
  if (v === null || v === undefined) return String(v);
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

function getThinkStreamingState(buffer: string) {
  const trimmed = buffer.trimStart();
  const lower = trimmed.toLowerCase();
  if (lower.startsWith("<think>")) {
    return {
      hideWhileStreaming: !lower.includes("</think>"),
      statusText: lower.includes("</think>") ? undefined : "思考中…"
    };
  }
  if ("<think>".startsWith(lower)) {
    return {
      hideWhileStreaming: true,
      statusText: "思考中…"
    };
  }
  return {
    hideWhileStreaming: false,
    statusText: undefined
  };
}

type ActiveTab = "chat" | "chat_config" | "agents" | "profile";
type LogSortKey = "category" | "agent" | "outcome" | "requestId" | "ts" | "message";
type UserProfile = { name: string; avatarUrl?: string; description?: string };
type AppEntryMode = "landing" | "workspace";
const PROMPT_JSON_PLACEHOLDERS = {
  noToolJson: '{"type":"no_tool"}',
  userProfileJson: '{"type":"builtin_tool_call","tool":"get_user_profile","input":{}}',
  builtinToolJson: '{"type":"builtin_tool_call","tool":"your_tool_name","input":{}}',
  mcpCallJson: '{"type":"mcp_call","serverId":"...","tool":"...","input":{}}'
} as const;

function inferLogOutcome(entry: Pick<LogEntry, "ok" | "level" | "outcome">): LogOutcome {
  if (entry.outcome) return entry.outcome;
  if (entry.ok === true) return "success";
  if (entry.ok === false) return "failure";
  if (entry.level === "error") return "failure";
  if (entry.level === "warn") return "degraded";
  return "info";
}

function createLogRequestId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${generateId().slice(0, 6)}`;
}

function formatLogOutcomeLabel(outcome: LogOutcome) {
  switch (outcome) {
    case "success":
      return "SUCCESS";
    case "failure":
      return "FAILURE";
    case "degraded":
      return "DEGRADED";
    case "info":
    default:
      return "INFO";
  }
}

function formatLogEntryForClipboard(entry: LogEntry) {
  const lines = [
    `request_id=${entry.requestId ?? "-"}`,
    `category=${entry.category}`,
    `agent=${entry.agent ?? "-"}`,
    `stage=${entry.stage ?? "-"}`,
    `outcome=${entry.outcome ?? inferLogOutcome(entry)}`,
    `time=${new Date(entry.ts).toISOString()}`,
    `message=${entry.message}`
  ];
  if (entry.details?.trim()) {
    lines.push("", entry.details.trim());
  }
  return lines.join("\n");
}

async function copyText(value: string) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Fall through to textarea fallback below.
  }

  try {
    const area = document.createElement("textarea");
    area.value = value;
    area.setAttribute("readonly", "true");
    area.style.position = "fixed";
    area.style.opacity = "0";
    area.style.pointerEvents = "none";
    document.body.appendChild(area);
    area.focus();
    area.select();
    area.setSelectionRange(0, area.value.length);
    const copied = document.execCommand("copy");
    area.remove();
    return copied;
  } catch {
    return false;
  }
}

function getUserProfileToolPayload(profile: UserProfile) {
  return {
    name: profile.name,
    description: profile.description?.trim() || "",
    hasAvatar: !!profile.avatarUrl
  };
}

function clampHistoryLimit(value: number) {
  if (!Number.isFinite(value)) return 10;
  return Math.max(1, Math.min(200, Math.round(value)));
}

function findTutorialAgentBaseInList(agents: AgentConfig[], _loadBalancers: LoadBalancerConfig[]) {
  return agents.find((agent) => isTutorialPrimaryAgent(agent)) ?? null;
}

function findTutorialAgentInList(agents: AgentConfig[], loadBalancers: LoadBalancerConfig[]) {
  const agent = findTutorialAgentBaseInList(agents, loadBalancers);
  if (!agent) return null;
  if (
    agent.enableDocs === false &&
    agent.enableMcp === false &&
    agent.enableBuiltInTools === false &&
    agent.enableSkills === false
  ) {
    return agent;
  }
  return null;
}

function normalizeTutorialPrimaryAgentList(agents: AgentConfig[], loadBalancers: LoadBalancerConfig[]) {
  const taggedAgents = agents.filter((agent) => isTutorialPrimaryAgent(agent));
  const preferredTagged = taggedAgents[0] ?? null;
  const legacyCandidates = agents.filter((agent) => !isManagedMagiAgent(agent) && usesTutorialLoadBalancer(agent, loadBalancers));
  const fallbackLegacy = !preferredTagged && legacyCandidates.length === 1 ? legacyCandidates[0] : null;
  const primaryId = preferredTagged?.id ?? fallbackLegacy?.id ?? null;

  let changed = false;
  const next = agents.map((agent) => {
    if (isManagedMagiAgent(agent)) {
      if (agent.tutorialRole !== undefined) {
        changed = true;
        return { ...agent, tutorialRole: undefined };
      }
      return agent;
    }

    const shouldBePrimary = primaryId !== null && agent.id === primaryId;
    const nextRole: AgentConfig["tutorialRole"] = shouldBePrimary ? TUTORIAL_AGENT_ROLE : undefined;
    if (agent.tutorialRole !== nextRole) {
      changed = true;
      return { ...agent, tutorialRole: nextRole };
    }
    return agent;
  });

  return changed ? next : agents;
}

function ensureManagedMagiAgents(agents: AgentConfig[]) {
  let changed = false;
  const next = [...agents];

  MAGI_UNIT_LAYOUT.forEach(({ unitId }) => {
    const matches = next.filter((agent) => matchesManagedMagiUnit(agent, unitId));
    if (matches.length === 0) {
      next.push(createManagedMagiAgent(unitId));
      changed = true;
      return;
    }
    const current = matches[0];
    const normalized = normalizeManagedMagiAgent(current, unitId);
    if (JSON.stringify(current) !== JSON.stringify(normalized)) {
      const index = next.findIndex((agent) => agent.id === current.id);
      if (index >= 0) {
        next[index] = normalized;
        changed = true;
      }
    }
  });

  return changed ? next : agents;
}

function normalizeImportedMessage(input: any): ChatMessage | null {
  if (!input || typeof input !== "object") return null;
  if (typeof input.role !== "string" || typeof input.content !== "string") return null;
  if (!["system", "user", "assistant", "tool"].includes(input.role)) return null;
  const skillTrace = Array.isArray(input.skillTrace)
    ? input.skillTrace
        .filter((entry: any) => entry && typeof entry.label === "string" && typeof entry.content === "string")
        .map((entry: any) => ({ label: entry.label, content: entry.content } satisfies ChatTraceEntry))
    : undefined;
  const skillTodo = Array.isArray(input.skillTodo)
    ? input.skillTodo
        .filter(
          (item: any) =>
            item &&
            typeof item.id === "string" &&
            typeof item.label === "string" &&
            ["pending", "in_progress", "completed", "blocked"].includes(item.status) &&
            ["skill", "planner", "system"].includes(item.source)
        )
        .map(
          (item: any) =>
            ({
              id: item.id,
              label: item.label,
              status: item.status,
              source: item.source,
              reason: typeof item.reason === "string" ? item.reason : undefined,
              updatedAt: typeof item.updatedAt === "number" ? item.updatedAt : Date.now()
            }) satisfies SkillTodoItem
        )
    : undefined;
  const skillPhase =
    typeof input.skillPhase === "string" &&
    [
      "skill_load",
      "bootstrap_plan",
      "observe",
      "plan_next_step",
      "act",
      "sync_state",
      "completion_gate",
      "manual_gate",
      "final_answer",
      "verify_refine"
    ].includes(input.skillPhase)
      ? (input.skillPhase as SkillPhase)
      : undefined;
  return {
    id: typeof input.id === "string" ? input.id : generateId(),
    role: input.role,
    content: input.content,
    name: typeof input.name === "string" ? input.name : undefined,
    displayName: typeof input.displayName === "string" ? input.displayName : undefined,
    avatarUrl: typeof input.avatarUrl === "string" ? input.avatarUrl : undefined,
    statusText: typeof input.statusText === "string" ? input.statusText : undefined,
    isStreaming: input.isStreaming === true,
    hideWhileStreaming: input.hideWhileStreaming === true,
    skillTrace: skillTrace?.length ? skillTrace : undefined,
    skillGoal: typeof input.skillGoal === "string" && input.skillGoal.trim() ? input.skillGoal : undefined,
    skillTodo: skillTodo?.length ? skillTodo : undefined,
    skillPhase,
    ts: typeof input.ts === "number" ? input.ts : Date.now()
  };
}

function downloadBlob(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(href);
}

function downloadFileBlob(filename: string, blob: Blob) {
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(href);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const TOOL_SUMMARY_MARKERS = ["\n\n請根據以下工具摘要完成回答：\n", "\n\n請將以下工具資訊一起納入回答：\n"];

function stripPreviousToolPromptSummaries(input: string) {
  let next = input;
  for (const marker of TOOL_SUMMARY_MARKERS) {
    const index = next.indexOf(marker);
    if (index !== -1) {
      next = next.slice(0, index).trimEnd();
    }
  }
  return next;
}

function appendToolPromptSummary(input: string, summaryBlock: string) {
  const base = stripPreviousToolPromptSummaries(input);
  return `${base}\n\n請根據以下工具摘要完成回答：\n${summaryBlock}\n\n請從目前已建立的頁面、session、工具結果或上下文繼續下一步，不要無理由重複上一個工具動作。若已成功打開頁面，優先觀察、讀取、填寫、點擊或等待，而不是再次打開同一個網址。`;
}

type ToolIntent = "observe" | "state_change" | "control";

function compactSupportText(text: string, maxChars: number) {
  const normalized = text.replace(/\r/g, "").trim();
  return normalized.length <= maxChars ? normalized : `${normalized.slice(0, Math.max(0, maxChars - 1))}…`;
}

function buildCompactSkillDecisionContext(args: {
  instructions?: string;
  references: Array<{ path: string; content: string }>;
  assets: Array<{ path: string; content: string }>;
}) {
  const sections: string[] = [];

  if (args.instructions?.trim()) {
    sections.push(`Skill workflow:\n${compactSupportText(args.instructions, 900)}`);
  }

  if (args.references.length) {
    sections.push(
      `Loaded references:\n${args.references
        .slice(0, 2)
        .map((doc) => `[${doc.path}]\n${compactSupportText(doc.content, 320)}`)
        .join("\n\n")}`
    );
  }

  if (args.assets.length) {
    sections.push(
      `Loaded assets:\n${args.assets
        .slice(0, 2)
        .map((file) => `[${file.path}]\n${compactSupportText(file.content, 240)}`)
        .join("\n\n")}`
    );
  }

  return sections.filter(Boolean).join("\n\n");
}

function filterPreparedToolScopeByIntent(
  prepared: PreparedSkillExecution,
  allowedIntents: Set<ToolIntent>
): {
  toolEntries: ToolEntry[];
  scopedBuiltInTools: BuiltInToolConfig[];
  scopedMcpTools: Array<{ server: McpServerConfig; tools: McpTool[] }>;
} {
  const scopedBuiltInTools = prepared.scopedBuiltInTools.filter((tool) => allowedIntents.has(classifyBuiltInToolIntent(tool)));
  const scopedMcpTools = prepared.scopedMcpTools
    .map((entry) => ({
      server: entry.server,
      tools: entry.tools.filter((tool) => allowedIntents.has(classifyMcpToolIntent(tool)))
    }))
    .filter((entry) => entry.tools.length > 0);
  const toolEntries: ToolEntry[] = [
    ...scopedMcpTools.flatMap(({ server, tools }) => tools.map((tool) => ({ kind: "mcp" as const, server, tool }))),
    ...scopedBuiltInTools.map((tool) => ({ kind: "builtin" as const, tool }))
  ];
  return { toolEntries, scopedBuiltInTools, scopedMcpTools };
}

function formatToolScopeSummary(toolEntries: ToolEntry[]) {
  if (!toolEntries.length) return "沒有可用工具";
  return toolEntries
    .map((entry) =>
      entry.kind === "mcp"
        ? `MCP:${entry.server.name}/${entry.tool.name} [${classifyMcpToolIntent(entry.tool)}]`
        : `Built-in:${entry.tool.name} [${classifyBuiltInToolIntent(entry.tool)}]`
    )
    .join("\n");
}

function formatSkillPhaseStatus(phase: SkillPhase) {
  switch (phase) {
    case "skill_load":
      return "正在載入 skill…";
    case "bootstrap_plan":
      return "正在建立多輪 todo…";
    case "observe":
      return "正在觀察目前狀態…";
    case "plan_next_step":
      return "正在規劃下一步…";
    case "act":
      return "正在執行下一步操作…";
    case "sync_state":
      return "正在同步 skill 狀態…";
    case "completion_gate":
      return "正在檢查任務是否完成…";
    case "manual_gate":
      return "正在等待使用者確認…";
    case "verify_refine":
      return "正在驗證與修正結果…";
    case "final_answer":
    default:
      return "正在整理最終回覆…";
  }
}

type ToolAugmentationResult = {
  input: string;
  status: "no_entries" | "decision_failed" | "no_tool" | "tool_called";
  ok?: boolean;
  toolLabel?: string;
  detail?: string;
  actionSignature?: string;
  toolIntent?: ToolIntent;
  observationSignature?: string;
  decisionSummary?: string;
  toolOutput?: any;
  browserObservation?: BrowserObservationDigest | null;
  serverId?: string;
};

function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  return `{${Object.keys(value as Record<string, unknown>)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`)
    .join(",")}}`;
}

function normalizeToolInputForSignature(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeToolInputForSignature(item));
  }
  if (!value || typeof value !== "object") {
    return value;
  }

  const normalizedEntries = Object.entries(value as Record<string, unknown>)
    .filter(([key, entryValue]) => {
      if (entryValue === undefined || entryValue === null || entryValue === "" || entryValue === false) return false;
      if (key === "session" || key === "timestamp" || key === "requestId") return false;
      return true;
    })
    .map(([key, entryValue]) => [key, normalizeToolInputForSignature(entryValue)]);

  return Object.fromEntries(normalizedEntries);
}

function buildToolActionSignature(args: {
  kind: "builtin" | "mcp";
  toolName: string;
  serverId?: string;
  input?: unknown;
}) {
  return `${args.kind}:${args.serverId ?? ""}:${args.toolName}:${stableStringify(normalizeToolInputForSignature(args.input ?? {}))}`;
}

const DEFAULT_MCP_TOOL_TIMEOUT_MS = 30000;

function getMcpToolTimeoutMs(server: McpServerConfig, toolName: string) {
  if (typeof server.toolTimeoutSecond === "number" && Number.isFinite(server.toolTimeoutSecond)) {
    return Math.max(1000, Math.round(server.toolTimeoutSecond) * 1000);
  }
  const normalized = String(toolName ?? "").trim().toLowerCase();
  if (!normalized) return DEFAULT_MCP_TOOL_TIMEOUT_MS;
  if (normalized.includes("open")) return 45000;
  if (normalized.includes("wait")) return 45000;
  if (normalized.includes("snapshot") || normalized.includes("screenshot")) return 30000;
  return DEFAULT_MCP_TOOL_TIMEOUT_MS;
}

async function callMcpToolWithTimeout(client: McpSseClient, name: string, input: unknown, timeoutMs: number) {
  let timeoutId: number | null = null;
  try {
    return await Promise.race([
      callTool(client, name, input ?? {}),
      new Promise<never>((_, reject) => {
        timeoutId = window.setTimeout(() => {
          reject(new Error(`MCP tool timed out after ${Math.round(timeoutMs / 1000)}s`));
        }, timeoutMs);
      })
    ]);
  } finally {
    if (timeoutId !== null) {
      window.clearTimeout(timeoutId);
    }
  }
}

function hashString(value: string) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function buildObservationSignature(output: unknown) {
  return hashString(stableStringify(normalizeToolInputForSignature(output ?? {})));
}

function goalWantsFirstRankedTarget(text: string) {
  const normalized = String(text ?? "").toLowerCase();
  return /(第一名|第一個|首個|top|first)/i.test(normalized) && /(repo|repository|專案|trend|trending|熱門|排行)/i.test(normalized);
}

function goalWantsRepoSummary(text: string) {
  return /(內容|摘要|summary|介紹|readme|repo|repository|專案)/i.test(String(text ?? ""));
}

function normalizeRepoLabel(value: string) {
  return String(value ?? "").replace(/\s*\/\s*/g, "/").replace(/\.git$/i, "").trim();
}

function getMeaningfulContentHints(observation?: BrowserObservationDigest | null) {
  if (!observation) return [];
  return observation.contentHints
    .map((hint) => String(hint ?? "").trim())
    .filter(Boolean)
    .filter((hint) => !/^(homepage|platform|solutions|resources|open source|enterprise)$/i.test(hint))
    .filter((hint) => !/^(sign in|sign up|登入|註冊)$/i.test(hint))
    .filter((hint) => !/^(issues \d+|pull requests \d+|fork \d+|actions|projects|security|insights)$/i.test(hint))
    .filter((hint) => !/^permalink:/i.test(hint));
}

function hasGroundedRepoSummary(observation?: BrowserObservationDigest | null) {
  if (!observation || observation.pageKind !== "repo_page") return false;
  return !!observation.repoName || getMeaningfulContentHints(observation).length > 0;
}

function buildGroundedRepoSummaryAnswer(observation?: BrowserObservationDigest | null) {
  if (!hasGroundedRepoSummary(observation)) return null;
  const repoName = observation?.repoName ? normalizeRepoLabel(observation.repoName) : "目前頁面上的目標 repository";
  const hints = getMeaningfulContentHints(observation).slice(0, 6);

  return [
    "【目前狀態】",
    `已成功進入目標 repository 頁面：${repoName}。`,
    "",
    "【頁面內容摘要】",
    `專案名稱：${repoName}`,
    hints.length ? `可見重點：\n- ${hints.join("\n- ")}` : "這一輪已確認進入 repo 頁面，但沒有擷取到足夠的 README 文字重點。",
    "",
    "【說明】",
    "以上摘要直接根據目前頁面可見內容整理，避免引用未觀察到的 README 細節。"
  ].join("\n");
}

function detectTerminalAgentFailure(text: string) {
  const normalized = String(text ?? "").trim();
  if (!normalized) return null;
  if (/^Request failed:/i.test(normalized)) return normalized;
  if (/^HTTP \d+/i.test(normalized)) return normalized;
  if (/rate_limit_exceeded|insufficient_quota|quota|api key|invalid api key/i.test(normalized)) return normalized;
  if (/Chrome Prompt API not available/i.test(normalized)) return normalized;
  return null;
}

function buildAgentFailureContent(errorText: string, task?: string) {
  const lines = ["【執行失敗】", "這一輪請求沒有成功完成，系統已停止重試。"];
  if (task) {
    lines.push("", "【原始任務】", task);
  }
  lines.push("", "【錯誤訊息】", String(errorText ?? "").trim());
  return lines.join("\n");
}

function isSequentialThinkingSkill(skill?: SkillConfig | null) {
  if (!skill) return false;
  const id = String(skill.id ?? "").toLowerCase();
  const name = String(skill.name ?? "").toLowerCase();
  return (
    id.includes("sequential-thinking") ||
    id.includes(TUTORIAL_SEQUENTIAL_SKILL_ROOT) ||
    name.includes("sequential-thinking") ||
    name.includes("sequential thinking")
  );
}

function buildSequentialThinkingFallbackContent(task: string) {
  const normalized = String(task ?? "").trim();

  if (/模板整理|格式化|【問題】|【拆解】|【最終回答】/.test(normalized)) {
    return [
      "模型沒有回傳文字內容，因此以下依照目前的 Sequential Thinking 模板補上：",
      "",
      "【問題】",
      normalized,
      "",
      "【拆解】",
      "1. 先確認問題真正要問的是什麼。",
      "2. 把答案拆成幾個最小、最穩定的步驟。",
      "3. 用簡單語句把每一步重新串起來。",
      "",
      "【關鍵依據】",
      "這裡採用的是 calm + structured 的回答方式：先重述問題，再分步拆解，最後給出直接結論。",
      "",
      "【最終回答】",
      /1\s*\+\s*1\s*=\s*2/.test(normalized)
        ? "因為第一個 1 代表一個單位，第二個 1 再加入後，總數就會從 1 增加到 2，所以 1+1=2。"
        : "以上已先依模板整理出穩定的回答框架；如果你要，我也可以再把它改寫成更短或更口語的版本。"
    ].join("\n");
  }

  if (/進階模式|revi(?:se|sion)|branch|實戰範例|範例/.test(normalized)) {
    return [
      "模型沒有回傳文字內容，因此以下先用 Sequential Thinking 的方式補一版簡短回答：",
      "",
      "1. 如果原本的方向已經明顯錯了，就用 revise，重新修正問題框架或假設。",
      "2. 如果有兩條以上都合理的路線要比較，就用 branch，把各自的成本、速度與風險列出來。",
      "3. 實戰上可以先各做一個最小版本，再根據結果決定保留哪一條路。",
      "",
      "簡單例子：如果 production 壞掉而你一開始懷疑是 API key，但後來發現其實是環境變數名稱不同，這就是 revise；如果你在比較兩種都可行的部署方式，那就是 branch。"
    ].join("\n");
  }

  if (/1\s*\+\s*1\s*=\s*2/.test(normalized)) {
    return [
      "模型沒有回傳文字內容，因此以下先用冷靜、有條理的方式補上說明：",
      "",
      "1. 先把第一個 1 看成一個單位。",
      "2. 再把第二個 1 加進來，代表總數多了一個單位。",
      "3. 原本有 1 個，現在再加 1 個，所以總數會變成 2 個。",
      "",
      "所以 1+1=2，意思就是把兩個單位合在一起計數，最後得到 2。"
    ].join("\n");
  }

  return [
    "模型沒有回傳文字內容，因此以下先用 Sequential Thinking 的方式補一版簡短回答：",
    "",
    "1. 先把問題拆成最小步驟。",
    "2. 每一步只處理一個重點。",
    "3. 最後再把這些步驟整理成清楚結論。",
    "",
    `原始問題：${normalized || "（未提供）"}`
  ].join("\n");
}

function buildEmptyResponseFallbackContent(task: string, toolResult?: ToolAugmentationResult | null, skill?: SkillConfig | null) {
  if (toolResult?.status === "tool_called") {
    const label = toolResult.toolLabel?.trim() || "最近一次工具";
    const output = toolResult.toolOutput;

    if (label.includes("get_user_profile") && output && typeof output === "object" && !Array.isArray(output)) {
      const name = typeof (output as { name?: unknown }).name === "string" ? String((output as { name?: string }).name).trim() : "";
      const description =
        typeof (output as { description?: unknown }).description === "string"
          ? String((output as { description?: string }).description).trim()
          : "";
      if (name || description) {
        return [
          "【工具已成功執行】",
          "模型沒有回傳文字內容，因此以下直接根據工具結果整理：",
          "",
          description ? `你是 ${name || "這位使用者"}，${description}` : `你是 ${name || "這位使用者"}。`
        ].join("\n");
      }
    }

    if (output && typeof output === "object" && !Array.isArray(output)) {
      const timezone =
        typeof (output as { timezone?: unknown }).timezone === "string"
          ? String((output as { timezone?: string }).timezone).trim()
          : "";
      const now = typeof (output as { now?: unknown }).now === "string" ? String((output as { now?: string }).now).trim() : "";
      if (timezone || now) {
        return [
          "【工具已成功執行】",
          "模型沒有回傳文字內容，因此以下直接根據工具結果整理：",
          "",
          now && timezone ? `時鐘 dashboard 已打開，目前時間是 ${now}，時區是 ${timezone}。` : `目前時區是 ${timezone || "未知"}。`
        ].join("\n");
      }
    }

    return [
      "【工具已成功執行】",
      "模型沒有回傳文字內容，因此以下直接保留最近一次工具結果：",
      "",
      `工具：${label}`,
      output !== undefined ? `結果：\n${stringifyAny(output)}` : toolResult.detail?.trim() || "（沒有可顯示的工具內容）"
    ].join("\n");
  }

  if (isSequentialThinkingSkill(skill)) {
    return buildSequentialThinkingFallbackContent(task);
  }

  return buildAgentFailureContent("模型沒有回傳任何內容。", task);
}

function normalizeBrowserWorkflowStartUrl(userInput: string, startUrl: string) {
  const raw = String(startUrl ?? "").trim();
  if (!raw) return raw;
  try {
    const url = new URL(raw);
    const isGitHubTrending = /(^|\.)github\.com$/i.test(url.hostname) && url.pathname === "/trending";
    if (isGitHubTrending && goalWantsFirstRankedTarget(userInput)) {
      url.searchParams.delete("language");
      url.searchParams.delete("spoken_language_code");
      url.searchParams.delete("spokenLanguage");
      url.searchParams.delete("dateRange");
      url.searchParams.set("since", "daily");
    }
    return url.toString();
  } catch {
    return raw;
  }
}

function buildBrowserHeuristicDecision(args: {
  state: SkillRunState;
  userInput: string;
  resolveMcpServerId: (toolName: string) => string | null;
}) {
  const observation = args.state.lastBrowserObservation;
  if (!observation) return null;

  if (goalWantsFirstRankedTarget(args.userInput) && observation.pageKind === "ranked_list" && observation.rankedTargets.length) {
    const browserClickServerId = args.resolveMcpServerId("browser_click");
    if (browserClickServerId) {
      const topTarget = observation.rankedTargets[0];
      return {
        type: "act" as const,
        reason: `Structured browser observation identified the top ranked target ${topTarget.label}; click it directly to advance the workflow.`,
        toolKind: "mcp" as const,
        toolName: "browser_click",
        input: {
          selector: topTarget.ref
        }
      };
    }
  }

  if (goalWantsRepoSummary(args.userInput) && hasGroundedRepoSummary(observation)) {
    return {
      type: "finish" as const,
      reason:
        observation.repoName && getMeaningfulContentHints(observation).length
          ? `Structured browser observation confirms the workflow is already on repo page ${observation.repoName} with grounded content hints collected.`
          : "Structured browser observation confirms the workflow reached the target repository page."
    };
  }

  return null;
}

function buildBrowserHeuristicCompletion(args: {
  state: SkillRunState;
  userInput: string;
}) {
  const observation = args.state.lastBrowserObservation;
  if (!observation) return null;
  if (observation.blockedReason) {
    return {
      type: "complete" as const,
      reason: observation.blockedReason,
      todoIds: args.state.todo.map((item) => item.id)
    };
  }
  if (goalWantsRepoSummary(args.userInput) && hasGroundedRepoSummary(observation)) {
    return {
      type: "complete" as const,
      reason:
        observation.repoName && getMeaningfulContentHints(observation).length
          ? `Reached repository page ${observation.repoName} and collected grounded page content hints for final summarization.`
          : "Reached the requested repository page and observed its main content."
    };
  }
  return null;
}

function enrichActionBrowserObservation(args: {
  state: SkillRunState;
  decision: Extract<SkillStepDecision, { type: "act" }>;
  browserObservation?: BrowserObservationDigest | null;
}) {
  const observation = args.browserObservation ? { ...args.browserObservation } : null;
  if (!observation) return observation;

  if (args.decision.toolName === "browser_click" && typeof args.decision.input?.selector === "string") {
    const selector = String(args.decision.input.selector).trim();
    const clickedTarget = args.state.lastBrowserObservation?.rankedTargets.find((target) => target.ref === selector) ?? null;
    if (clickedTarget && !observation.repoName) {
      observation.repoName = normalizeRepoLabel(clickedTarget.label);
    }
    if (/^done$/i.test(String(observation.title ?? "").trim())) {
      observation.title = undefined;
    }
    if (observation.pageKind === "ranked_list" && !observation.rankedTargets.length && !observation.url) {
      observation.pageKind = "unknown";
      observation.contentHints = [];
    }
  }

  return observation;
}

function classifyToolIntentFromText(name: string, description?: string): ToolIntent {
  const haystack = `${name} ${description ?? ""}`.toLowerCase();
  const controlHints = ["confirm", "approval", "consent", "request", "ask user", "prompt user", "manual"];
  const observeHints = ["snapshot", "get ", "get_", "read", "inspect", "list", "query", "text", "content", "url", "status", "state", "screenshot"];
  const stateChangeHints = ["open", "click", "fill", "type", "write", "submit", "wait", "close", "navigate", "press"];

  if (controlHints.some((hint) => haystack.includes(hint))) return "control";
  if (observeHints.some((hint) => haystack.includes(hint))) return "observe";
  if (stateChangeHints.some((hint) => haystack.includes(hint))) return "state_change";
  return "state_change";
}

function classifyBuiltInToolIntent(tool: BuiltInToolConfig): ToolIntent {
  return classifyToolIntentFromText(tool.name, tool.description);
}

function classifyMcpToolIntent(tool: McpTool): ToolIntent {
  return classifyToolIntentFromText(tool.name, tool.description);
}

type CredentialTestState = {
  ok: boolean;
  message: string;
};

async function testCredentialConnection(slot: ModelCredentialEntry, apiKey: string): Promise<CredentialTestState> {
  const endpoint = normalizeCredentialUrl(slot.endpoint);
  if (!endpoint) {
    throw new Error("請先設定 endpoint。");
  }
  if (slot.preset === "chrome_prompt") {
    return { ok: true, message: "Chrome Prompt provider 不需要遠端連線測試。" };
  }

  const res = await fetch(`${endpoint}/models`, {
    headers: apiKey.trim() ? { Authorization: `Bearer ${apiKey.trim()}` } : undefined
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    if (res.status === 401 || res.status === 403) {
      throw new Error("已連到 provider，但 API key 無效或沒有權限。");
    }
    if (res.status === 404) {
      throw new Error("已連到 endpoint，但找不到 /models。請確認這是不是 OpenAI-compatible endpoint。");
    }
    throw new Error(text ? `HTTP ${res.status}: ${text}` : `HTTP ${res.status}`);
  }

  const json = await res.json().catch(() => null);
  const count = Array.isArray(json?.data) ? json.data.filter((item: any) => item?.active !== false).length : undefined;
  return {
    ok: true,
    message: count === undefined ? "測試成功：provider 有回應。" : `測試成功：可用模型 ${count} 個。`
  };
}

async function fetchCredentialModels(slot: ModelCredentialEntry, apiKey: string): Promise<string[]> {
  if (slot.preset === "chrome_prompt") {
    return ["chrome_prompt"];
  }
  const endpoint = normalizeCredentialUrl(slot.endpoint);
  if (!endpoint) {
    throw new Error("請先設定 endpoint。");
  }

  const res = await fetch(`${endpoint}/models`, {
    headers: apiKey.trim() ? { Authorization: `Bearer ${apiKey.trim()}` } : undefined
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text ? `HTTP ${res.status}: ${text}` : `HTTP ${res.status}`);
  }

  const json = await res.json().catch(() => null);
  const models = Array.isArray(json?.data)
    ? json.data
        .map((item: any) => String(item?.id ?? "").trim())
        .filter(Boolean)
    : [];

  if (!models.length) {
    throw new Error("這個 endpoint 沒有回傳可用模型。");
  }

  return models;
}

function EyeIcon(props: { open: boolean }) {
  return props.open ? (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2 8s2.2-3.5 6-3.5S14 8 14 8s-2.2 3.5-6 3.5S2 8 2 8Z" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8 9.7a1.7 1.7 0 1 0 0-3.4 1.7 1.7 0 0 0 0 3.4Z" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  ) : (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2 8s2.2-3.5 6-3.5S14 8 14 8s-2.2 3.5-6 3.5S2 8 2 8Z" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="m3 13 10-10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function isCategoryEnabled(flag: boolean | undefined) {
  return flag !== false;
}

function buildToolDecisionPrompt(template: string, fallbackTemplate: string, userInput: string, toolListJson: string) {
  const baseTemplate = template.trim() || fallbackTemplate;
  const replacements: Record<string, string> = {
    "{{userInput}}": userInput,
    "{{toolListJson}}": toolListJson,
    "{{noToolJson}}": PROMPT_JSON_PLACEHOLDERS.noToolJson,
    "{{userProfileJson}}": PROMPT_JSON_PLACEHOLDERS.userProfileJson,
    "{{builtinToolJson}}": PROMPT_JSON_PLACEHOLDERS.builtinToolJson,
    "{{mcpCallJson}}": PROMPT_JSON_PLACEHOLDERS.mcpCallJson
  };

  let prompt = baseTemplate;
  Object.entries(replacements).forEach(([placeholder, value]) => {
    prompt = prompt.split(placeholder).join(value);
  });

  if (!baseTemplate.includes("{{userInput}}")) {
    prompt += `\n\nUser request:\n${userInput}`;
  }
  if (!baseTemplate.includes("{{toolListJson}}")) {
    prompt += `\n\nAvailable tools:\n${toolListJson}`;
  }
  if (!baseTemplate.includes("{{noToolJson}}")) {
    prompt += `\n\nIf no tool is needed, return:\n${PROMPT_JSON_PLACEHOLDERS.noToolJson}`;
  }
  if (!baseTemplate.includes("{{userProfileJson}}")) {
    prompt += `\n\nIf the user profile tool is needed, return:\n${PROMPT_JSON_PLACEHOLDERS.userProfileJson}`;
  }
  if (!baseTemplate.includes("{{builtinToolJson}}")) {
    prompt += `\n\nIf a built-in browser tool is needed, return:\n${PROMPT_JSON_PLACEHOLDERS.builtinToolJson}`;
  }
  if (!baseTemplate.includes("{{mcpCallJson}}")) {
    prompt += `\n\nIf an MCP tool is needed, return:\n${PROMPT_JSON_PLACEHOLDERS.mcpCallJson}`;
  }

  return prompt;
}

function compactDecisionCatalogText(value: string | undefined, maxChars: number) {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  return normalized.length <= maxChars ? normalized : `${normalized.slice(0, Math.max(0, maxChars - 1))}…`;
}

function buildToolDecisionCatalog(toolEntries: ToolEntry[]) {
  return toolEntries.map((entry) =>
    entry.kind === "mcp"
      ? {
          kind: "mcp",
          server: entry.server.name,
          tool: entry.tool.name,
          summary: compactDecisionCatalogText(entry.tool.description ?? "", 180)
        }
      : {
          kind: "builtin",
          tool: entry.tool.name,
          summary: compactDecisionCatalogText(entry.tool.description ?? "", 180)
        }
  );
}

type PromptTemplateApiTestState = {
  status: "idle" | "running" | "success" | "failure";
  summary?: string;
  expected?: string;
  requestId?: string;
  agentName?: string;
  prompt?: string;
  system?: string;
  rawOutput?: string;
  parsedOutput?: string;
  updatedAt?: number;
};

type PromptTemplateApiTestValidation = {
  pass: boolean;
  summary: string;
  parsed?: unknown;
};

type PromptTemplateApiTestSpec = {
  title: string;
  description: string;
  expected: string;
  prompt: string;
  system?: string;
  validate: (raw: string) => PromptTemplateApiTestValidation;
};

function buildPromptTemplateTestSkill(args: { id: string; name: string; description: string; instructions: string }): {
  skill: SkillConfig;
  runtime: LoadedSkillRuntime;
} {
  const skill: SkillConfig = {
    id: args.id,
    name: args.name,
    version: "1.0.0",
    description: args.description,
    decisionHint: args.description,
    workflow: {
      instructions: args.instructions
    },
    skillMarkdown: `# ${args.name}`,
    rootPath: `/prompt-template-tests/${args.id}`,
    fileCount: 1,
    docCount: 0,
    scriptCount: 0,
    assetCount: 0,
    updatedAt: 0
  };
  const runtime: LoadedSkillRuntime = {
    skillId: skill.id,
    name: skill.name,
    description: skill.description,
    instructions: args.instructions,
    referencedPaths: [],
    loadedReferences: [],
    assetPaths: [],
    loadedAssets: [],
    allowMcp: false,
    allowBuiltInTools: false
  };
  return { skill, runtime };
}

function renderPromptTemplate(template: string, replacements: Record<string, string>) {
  let prompt = template;
  Object.entries(replacements).forEach(([placeholder, value]) => {
    prompt = prompt.split(placeholder).join(value);
  });
  return prompt;
}

function buildPromptTemplateApiTestSpec(args: {
  baseId: PromptTemplateBaseId;
  language: "zh" | "en";
  template: string;
}): PromptTemplateApiTestSpec {
  const isEn = args.language === "en";
  const sequential = buildPromptTemplateTestSkill({
    id: "sequential-thinking-test",
    name: "sequential-thinking",
    description: isEn ? "Calm, structured, step-by-step explanations." : "冷靜、有條理、逐步說明。",
    instructions: isEn
      ? "Give calm, structured answers. Break the answer into small stable steps."
      : "請冷靜、有條理地回答，並拆成穩定的小步驟。"
  });
  const browserWorkflow = buildPromptTemplateTestSkill({
    id: "browser-workflow-multiturn-test",
    name: "browser-workflow-multiturn",
    description: isEn ? "Open pages, click targets, and summarize results." : "打開頁面、點擊目標並整理結果。",
    instructions: isEn
      ? "Use the browser session step by step and summarize what you observed."
      : "逐步使用瀏覽器 session，並整理觀察結果。"
  });

  switch (args.baseId) {
    case "tool-decision": {
      const expectedToolName =
        SYSTEM_BUILT_IN_TOOLS.find((tool) => tool.id === SYSTEM_USER_PROFILE_TOOL_ID)?.name ?? "get_user_profile";
      const userInput = isEn ? "Read my personal profile before answering." : "在回答前先讀取我的個人資訊。";
      const toolListJson = JSON.stringify(
        [
          { kind: "builtin", tool: expectedToolName, summary: isEn ? "Read the current user's profile." : "讀取目前使用者個人資訊。" },
          { kind: "builtin", tool: "clock_dashboard_demo", summary: isEn ? "Open a live clock dashboard in the page." : "在頁面中打開即時時鐘 dashboard。" },
          { kind: "mcp", server: "Browser", tool: "browser_open", summary: isEn ? "Open a URL in a browser session." : "在瀏覽器 session 中打開網址。" }
        ],
        null,
        2
      );
      return {
        title: isEn ? "Tool decision chooses get_user_profile" : "Tool decision 會選 get_user_profile",
        description: isEn
          ? "Uses a fake tool catalog and expects a builtin tool decision for the current user profile."
          : "使用假的工具清單，預期會回傳讀取使用者個人資訊的 builtin tool decision。",
        expected: isEn
          ? 'Expected JSON: {"type":"builtin_tool_call","tool":"get_user_profile","input":{}}'
          : '預期 JSON：{"type":"builtin_tool_call","tool":"get_user_profile","input":{}}',
        prompt: buildToolDecisionPrompt(
          args.template,
          getDefaultPromptTemplate(`tool-decision.${args.language}`),
          userInput,
          toolListJson
        ),
        validate: (raw) => {
          const parsed = normalizeToolDecision(extractJsonObject(raw));
          if (!parsed) return { pass: false, summary: isEn ? "Output is not valid tool-decision JSON." : "輸出不是有效的 tool-decision JSON。" };
          if (parsed.type !== "builtin_tool_call" || parsed.tool !== expectedToolName) {
            return {
              pass: false,
              summary: isEn
                ? `Expected ${expectedToolName}, got ${JSON.stringify(parsed)}.`
                : `預期 ${expectedToolName}，實際得到 ${JSON.stringify(parsed)}。`,
              parsed
            };
          }
          return {
            pass: true,
            summary: isEn
              ? `Parsed a valid ${expectedToolName} tool decision.`
              : `已解析成正確的 ${expectedToolName} tool decision。`,
            parsed
          };
        }
      };
    }
    case "skill-decision": {
      const userInput = isEn
        ? "I am anxious. Please explain calmly and step by step why 1+1=2."
        : "我有點慌，請冷靜又有條理地逐步解釋為什麼 1+1=2。";
      const skillListJson = JSON.stringify(
        [
          { id: sequential.skill.id, name: sequential.skill.name, summary: sequential.skill.description },
          { id: browserWorkflow.skill.id, name: browserWorkflow.skill.name, summary: browserWorkflow.skill.description }
        ],
        null,
        2
      );
      return {
        title: isEn ? "Skill decision chooses sequential-thinking" : "Skill decision 會選 sequential-thinking",
        description: isEn
          ? "Uses a fake skill catalog and expects a skill_call for calm structured reasoning."
          : "使用假的 skill 清單，預期會對冷靜有條理的需求選擇 sequential-thinking。",
        expected: isEn
          ? `Expected JSON: {"type":"skill_call","skillId":"${sequential.skill.id}","input":{}}`
          : `預期 JSON：{"type":"skill_call","skillId":"${sequential.skill.id}","input":{}}`,
        prompt: buildSkillDecisionPrompt(userInput, skillListJson, args.language, args.template),
        validate: (raw) => {
          const parsed = normalizeSkillDecision(extractJsonObject(raw));
          if (!parsed) return { pass: false, summary: isEn ? "Output is not valid skill-decision JSON." : "輸出不是有效的 skill-decision JSON。" };
          if (parsed.type !== "skill_call" || parsed.skillId !== sequential.skill.id) {
            return {
              pass: false,
              summary: isEn ? `Expected ${sequential.skill.id}, got ${JSON.stringify(parsed)}.` : `預期 ${sequential.skill.id}，實際得到 ${JSON.stringify(parsed)}。`,
              parsed
            };
          }
          return { pass: true, summary: isEn ? "Parsed a valid sequential-thinking skill decision." : "已解析成正確的 sequential-thinking skill decision。", parsed };
        }
      };
    }
    case "skill-runtime-system": {
      const system = renderPromptTemplate(args.template, {
        "{{skillName}}": sequential.skill.name,
        "{{skillId}}": sequential.skill.id
      });
      return {
        title: isEn ? "Skill runtime system prompt preserves direct answers" : "Skill runtime system prompt 不會妨礙直接回答",
        description: isEn
          ? "Applies the selected system prompt and checks that the model can still follow a strict direct instruction."
          : "套用目前的 system prompt，確認模型仍然能遵守明確的直接指令。",
        expected: isEn ? 'Expected text containing: READY_ONLY' : "預期文字包含：READY_ONLY",
        system,
        prompt: isEn ? "Reply with exactly READY_ONLY. No markdown." : "請只回覆 READY_ONLY，不要加 markdown。",
        validate: (raw) => {
          if (!String(raw ?? "").trim()) return { pass: false, summary: isEn ? "Model returned empty output." : "模型回傳空內容。" };
          const pass = String(raw).includes("READY_ONLY");
          return {
            pass,
            summary: pass
              ? isEn
                ? "Model followed the direct instruction under the current runtime system prompt."
                : "模型在目前 runtime system prompt 下仍能遵守直接指令。"
              : isEn
                ? "Output did not contain READY_ONLY."
                : "輸出未包含 READY_ONLY。",
            parsed: raw.trim()
          };
        }
      };
    }
    case "skill-verify": {
      const prompt = buildSkillVerifyPrompt({
        skill: sequential.skill,
        runtime: sequential.runtime,
        userInput: isEn
          ? "Please explain calmly and step by step why 1+1=2."
          : "請冷靜又有條理地逐步解釋為什麼 1+1=2。",
        currentInput: isEn
          ? "Give a calm, structured, step-by-step answer."
          : "請給出冷靜、有條理、逐步的回答。",
        answer: isEn
          ? "1. One unit plus one more unit makes two units. 2. Counting the combined units gives 2."
          : "1. 一個單位再加上一個單位，總數會變成兩個單位。2. 把它們一起計數，就會得到 2。",
        round: 1,
        template: args.template
      });
      return {
        title: isEn ? "Skill verify returns pass for a good answer" : "Skill verify 對良好答案回傳 pass",
        description: isEn
          ? "Uses a clearly acceptable structured answer and expects a pass decision."
          : "提供一個明顯可接受的結構化回答，預期回傳 pass。",
        expected: isEn ? 'Expected JSON: {"type":"pass","reason":"..."}' : '預期 JSON：{"type":"pass","reason":"..."}',
        prompt,
        validate: (raw) => {
          const parsed = normalizeSkillVerifyDecision(extractJsonObject(raw));
          if (!parsed) return { pass: false, summary: isEn ? "Output is not valid skill-verify JSON." : "輸出不是有效的 skill-verify JSON。" };
          if (parsed.type !== "pass") {
            return {
              pass: false,
              summary: isEn ? `Expected pass, got ${JSON.stringify(parsed)}.` : `預期 pass，實際得到 ${JSON.stringify(parsed)}。`,
              parsed
            };
          }
          return { pass: true, summary: isEn ? "Parsed a valid pass decision." : "已解析成正確的 pass decision。", parsed };
        }
      };
    }
    case "skill-bootstrap-plan": {
      const prompt = buildBootstrapPlanPrompt({
        skill: browserWorkflow.skill,
        runtime: browserWorkflow.runtime,
        userInput: isEn
          ? "Open https://github.com/trending?since=daily, click the first repository, then summarize the README."
          : "打開 https://github.com/trending?since=daily，點進第一名的 repository，然後整理 README 摘要。",
        template: args.template
      });
      return {
        title: isEn ? "Bootstrap plan returns todo + startUrl" : "Bootstrap plan 會回傳 todo 與 startUrl",
        description: isEn
          ? "Checks that the bootstrap prompt returns a valid task summary and non-empty todo list."
          : "確認 bootstrap prompt 會回傳有效的 task summary 與非空 todo 清單。",
        expected: isEn
          ? 'Expected JSON with taskSummary, todo[3+], and startUrl close to https://github.com/trending?since=daily'
          : "預期 JSON 具有 taskSummary、至少 3 個 todo，且 startUrl 接近 https://github.com/trending?since=daily",
        prompt,
        validate: (raw) => {
          const parsed = normalizeSkillBootstrapPlan(extractJsonObject(raw));
          if (!parsed) return { pass: false, summary: isEn ? "Output is not valid bootstrap-plan JSON." : "輸出不是有效的 bootstrap-plan JSON。" };
          const hasStartUrl = String(parsed.startUrl ?? "").includes("github.com/trending");
          const pass = parsed.todo.length >= 3 && !!parsed.taskSummary && hasStartUrl;
          return {
            pass,
            summary: pass
              ? isEn
                ? "Parsed a valid bootstrap plan with todo and direct startUrl."
                : "已解析成有效的 bootstrap plan，包含 todo 與直接 startUrl。"
              : isEn
                ? `Bootstrap plan parsed but missing required fields: ${JSON.stringify(parsed)}`
                : `已解析 bootstrap plan，但缺少必要欄位：${JSON.stringify(parsed)}`,
            parsed
          };
        }
      };
    }
    case "skill-planner-step": {
      const prompt = buildPlannerStepPrompt({
        skill: browserWorkflow.skill,
        runtime: browserWorkflow.runtime,
        userInput: isEn
          ? "Open GitHub Trending, click the first repo, and summarize it."
          : "打開 GitHub Trending，點進第一名 repo，然後整理摘要。",
        currentContext: isEn
          ? "The previous action changed state. The page is already open. A fresh observation is required before clicking anything."
          : "上一個動作已改變狀態，頁面已打開。在點擊任何目標前，必須先重新 observe。",
        currentPhaseHint: isEn ? "The previous action changed state; observe next." : "上一個動作已改變狀態，下一步請先 observe。",
        toolScopeSummary: isEn
          ? "MCP:Browser/browser_snapshot [observe]\nMCP:Browser/browser_click [state_change]"
          : "MCP:Browser/browser_snapshot [observe]\nMCP:Browser/browser_click [state_change]",
        todoSummary: isEn
          ? "1. [in_progress] Open GitHub Trending\n2. [pending] Click the first repository"
          : "1. [in_progress] 打開 GitHub Trending\n2. [pending] 點擊第一個 repository",
        mustObserve: true,
        mustAct: false,
        template: args.template
      });
      return {
        title: isEn ? "Planner step chooses observe after state change" : "Planner step 會在狀態改變後選 observe",
        description: isEn
          ? "Checks the mustObserve path and expects an observe decision."
          : "驗證 mustObserve 路徑，預期回傳 observe。",
        expected: isEn ? 'Expected JSON: {"type":"observe","reason":"..."}' : '預期 JSON：{"type":"observe","reason":"..."}',
        prompt,
        validate: (raw) => {
          const parsed = normalizeSkillStepDecision(extractJsonObject(raw));
          if (!parsed) return { pass: false, summary: isEn ? "Output is not valid planner-step JSON." : "輸出不是有效的 planner-step JSON。" };
          if (parsed.type !== "observe") {
            return {
              pass: false,
              summary: isEn ? `Expected observe, got ${JSON.stringify(parsed)}.` : `預期 observe，實際得到 ${JSON.stringify(parsed)}。`,
              parsed
            };
          }
          return { pass: true, summary: isEn ? "Parsed a valid observe decision." : "已解析成正確的 observe decision。", parsed };
        }
      };
    }
    case "skill-completion-gate": {
      const prompt = buildCompletionGatePrompt({
        skill: browserWorkflow.skill,
        runtime: browserWorkflow.runtime,
        userInput: isEn
          ? "Open GitHub Trending, click the first repo, and summarize it."
          : "打開 GitHub Trending，點進第一名 repo，然後整理摘要。",
        todoSummary: isEn
          ? "1. [completed] Open GitHub Trending\n2. [completed] Click the first repo\n3. [completed] Summarize the README"
          : "1. [completed] 打開 GitHub Trending\n2. [completed] 點擊第一名 repo\n3. [completed] 整理 README 摘要",
        currentContext: isEn
          ? "Reached repository page mvanhorn/last30days-skill and collected grounded page content hints for final summarization."
          : "已到達 repository 頁面 mvanhorn/last30days-skill，並擷取足夠的 grounded page content hints，可直接整理最終摘要。",
        template: args.template
      });
      return {
        title: isEn ? "Completion gate recognizes a finished workflow" : "Completion gate 能辨識已完成的 workflow",
        description: isEn
          ? "Checks a clearly finished browser workflow and expects complete."
          : "驗證明顯已完成的 browser workflow，預期回傳 complete。",
        expected: isEn ? 'Expected JSON: {"type":"complete","reason":"..."}' : '預期 JSON：{"type":"complete","reason":"..."}',
        prompt,
        validate: (raw) => {
          const parsed = normalizeSkillCompletionDecision(extractJsonObject(raw));
          if (!parsed) return { pass: false, summary: isEn ? "Output is not valid completion-gate JSON." : "輸出不是有效的 completion-gate JSON。" };
          if (parsed.type !== "complete") {
            return {
              pass: false,
              summary: isEn ? `Expected complete, got ${JSON.stringify(parsed)}.` : `預期 complete，實際得到 ${JSON.stringify(parsed)}。`,
              parsed
            };
          }
          return { pass: true, summary: isEn ? "Parsed a valid complete decision." : "已解析成正確的 complete decision。", parsed };
        }
      };
    }
    default:
      return {
        title: isEn ? "Prompt template test" : "Prompt template 測試",
        description: isEn ? "No test definition is available." : "沒有可用的測試定義。",
        expected: isEn ? "No expected output defined." : "未定義預期輸出。",
        prompt: "",
        validate: () => ({ pass: false, summary: isEn ? "No validator defined." : "未定義驗證器。" })
      };
  }
}

export default function App() {
  const [appEntryMode, setAppEntryMode] = useState<AppEntryMode>("landing");
  const initialUi = loadUiState();
  const [agents, setAgents] = useState<AgentConfig[]>(() => {
    const existing = loadAgents();
    if (existing.length) return existing;

    const seed: AgentConfig[] = [
      {
        id: generateId(),
        name: "Local Chrome LLM",
        type: "chrome_prompt",
        capabilities: { streaming: true }
      },
      {
        id: generateId(),
        name: "OpenAI-compatible",
        type: "openai_compat",
        endpoint: "https://api.openai.com/v1",
        model: "gpt-4o-mini",
        capabilities: { streaming: true }
      }
    ];
    saveAgents(seed);
    return seed;
  });

  const [activeTab, setActiveTab] = useState<ActiveTab>(() =>
    initialUi.activeTab === "resources" ? "chat_config" : (initialUi.activeTab ?? "chat")
  );
  const [activeAgentId, setActiveAgentId] = useState<string>(() => initialUi.activeAgentId ?? agents[0]?.id ?? "");
  const [selectedAgentId, setSelectedAgentId] = useState<string>(() => initialUi.activeAgentId ?? agents[0]?.id ?? "");
  const activeAgent = useMemo(() => agents.find((a) => a.id === activeAgentId) ?? null, [agents, activeAgentId]);

  const [mode, setMode] = useState<OrchestratorMode>(() => {
    const storedMode = initialUi.mode;
    if (storedMode === "leader_team") return "magi_vote";
    if (storedMode === "magi_vote" || storedMode === "magi_consensus" || storedMode === "one_to_one") return storedMode;
    return "one_to_one";
  });
  const [skillExecutionMode, setSkillExecutionMode] = useState<SkillExecutionMode>(() =>
    initialUi.skillExecutionMode === "multi_turn" ? "multi_turn" : "single_turn"
  );
  const [skillVerifyMax, setSkillVerifyMax] = useState<number>(() => clampSkillVerifyMax(initialUi.skillVerifyMax ?? 1));
  const [skillToolLoopMax, setSkillToolLoopMax] = useState<number>(() => clampSkillToolLoopMax(initialUi.skillToolLoopMax ?? 6));
  const [skillVerifierAgentId, setSkillVerifierAgentId] = useState<string>(() => initialUi.skillVerifierAgentId ?? "");
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [chatComposerDraft, setChatComposerDraft] = useState("");
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [isChatFullscreen, setIsChatFullscreen] = useState(false);

  const [historyMessageLimit, setHistoryMessageLimit] = useState<number>(() => clampHistoryLimit(initialUi.historyMessageLimit ?? 10));
  const [userName, setUserName] = useState<string>(() => initialUi.userName ?? "You");
  const [userAvatarUrl, setUserAvatarUrl] = useState<string | undefined>(() => initialUi.userAvatarUrl);
  const [userDescription, setUserDescription] = useState<string>(() => initialUi.userDescription ?? "");
  const [isSummaryExporting, setIsSummaryExporting] = useState(false);

  type ConfigModalKey = "agent" | "credentials" | "mode" | "history" | "docs" | "mcp" | "skills" | "tools" | "team" | "load_balancers" | "prompts" | null;
  const [configModal, setConfigModal] = useState<ConfigModalKey>(null);
  const [loadBalancerDraftSeed, setLoadBalancerDraftSeed] = useState<{ token: number; draft: LoadBalancerConfig } | null>(null);

  const [docs, setDocs] = useState<DocItem[]>([]);
  const [docsLoaded, setDocsLoaded] = useState(false);
  const [docEditorId, setDocEditorId] = useState<string | null>(null);
  const [skills, setSkills] = useState<SkillConfig[]>([]);
  const [skillsLoaded, setSkillsLoaded] = useState(false);
  const [skillPanelSelectedId, setSkillPanelSelectedId] = useState<string | null>(null);
  const [skillPanelDocs, setSkillPanelDocs] = useState<SkillDocItem[]>([]);
  const [skillPanelFiles, setSkillPanelFiles] = useState<SkillFileItem[]>([]);
  const [builtInTools, setBuiltInTools] = useState<BuiltInToolConfig[]>(() => loadBuiltInTools());
  const [modelCredentials, setModelCredentials] = useState<ModelCredentialEntry[]>(() => loadModelCredentials());
  const [loadBalancers, setLoadBalancers] = useState<LoadBalancerConfig[]>(() => loadLoadBalancers());
  const [loadBalancerPanelSelectedId, setLoadBalancerPanelSelectedId] = useState<string | null>(null);
  const systemBuiltInTools = useMemo(() => SYSTEM_BUILT_IN_TOOLS, []);
  const allBuiltInTools = useMemo(
    () => [...systemBuiltInTools, ...builtInTools.map((tool) => ({ ...tool, source: "custom" as const, readonly: false }))],
    [builtInTools, systemBuiltInTools]
  );

  const [mcpServers, setMcpServers] = useState<McpServerConfig[]>(() => loadMcpServers());
  const [mcpPromptTemplates, setMcpPromptTemplates] = useState<McpPromptTemplates>(() => loadMcpPromptTemplates());
  const [promptTemplateFiles, setPromptTemplateFiles] = useState<PromptTemplateFileState[]>(() => loadPromptTemplateFiles());
  const [promptTemplateTestStates, setPromptTemplateTestStates] = useState<Record<string, PromptTemplateApiTestState>>({});
  const [promptTemplateTestsRunning, setPromptTemplateTestsRunning] = useState(false);
  const [mcpPanelActiveId, setMcpPanelActiveId] = useState<string | null>(null);
  const [mcpToolsByServer, setMcpToolsByServer] = useState<Record<string, McpTool[]>>({});
  const globalMcpToolCatalog = useMemo(
    () =>
      mcpServers.map((server) => ({
        server,
        tools: mcpToolsByServer[server.id] ?? []
      })),
    [mcpServers, mcpToolsByServer]
  );
  const [log, setLog] = useState<LogEntry[]>([]);
  const [visibleCredentialIds, setVisibleCredentialIds] = useState<Record<string, boolean>>({});
  const [credentialTestResults, setCredentialTestResults] = useState<Record<string, CredentialTestState | undefined>>({});
  const promptTemplateRuntime = useMemo(() => buildPromptTemplateRuntime(promptTemplateFiles), [promptTemplateFiles]);
  const [testingCredentialIds, setTestingCredentialIds] = useState<Record<string, boolean>>({});
  const [tutorialScenario, setTutorialScenario] = useState<TutorialScenarioDefinition | null>(null);
  const [tutorialScenarioIndex, setTutorialScenarioIndex] = useState<number | null>(null);
  const [tutorialStepIndex, setTutorialStepIndex] = useState(0);
  const [showTutorialExitPrompt, setShowTutorialExitPrompt] = useState(false);
  const [tutorialUnavailableMessage, setTutorialUnavailableMessage] = useState<string | null>(null);
  const [tutorialComposerSeed, setTutorialComposerSeed] = useState<{ value: string; token: number } | null>(null);
  const [tutorialOpenedToolResultMessageIds, setTutorialOpenedToolResultMessageIds] = useState<string[]>([]);
  const [logCollapsed, setLogCollapsed] = useState(true);
  const [logHeight, setLogHeight] = useState(160);
  const [logSort, setLogSort] = useState<{ key: LogSortKey; dir: "asc" | "desc" }>({ key: "ts", dir: "desc" });
  const pushLog = (entry: Omit<LogEntry, "id" | "ts"> & { ts?: number }) => {
    const normalized: LogEntry = {
      id: generateId(),
      ts: entry.ts ?? Date.now(),
      category: entry.category || "general",
      agent: entry.agent,
      ok: entry.ok,
      message: entry.message,
      level: entry.level,
      outcome: inferLogOutcome(entry),
      requestId: entry.requestId?.trim() || undefined,
      stage: entry.stage?.trim() || undefined,
      details: entry.details
    };
    setLog((x) => [normalized, ...x].slice(0, 200));
  };
  const logResizeRef = React.useRef<{ startY: number; startHeight: number } | null>(null);
  const logNow = (entry: Omit<LogEntry, "id" | "ts"> & { ts?: number }) => pushLog(entry);
  const sortedLogEntries = useMemo(() => {
    return log
      .map((item, index) => ({ item, index }))
      .sort((a, b) => {
        const key = logSort.key;
        let cmp = 0;
        if (key === "ts") cmp = a.item.ts - b.item.ts;
        if (key === "outcome") cmp = formatLogOutcomeLabel(a.item.outcome ?? inferLogOutcome(a.item)).localeCompare(formatLogOutcomeLabel(b.item.outcome ?? inferLogOutcome(b.item)));
        if (key === "requestId") cmp = (a.item.requestId || "").toLowerCase().localeCompare((b.item.requestId || "").toLowerCase());
        if (key === "category") cmp = (a.item.category || "").toLowerCase().localeCompare((b.item.category || "").toLowerCase());
        if (key === "agent") cmp = (a.item.agent || "").toLowerCase().localeCompare((b.item.agent || "").toLowerCase());
        if (key === "message") cmp = (a.item.message || "").toLowerCase().localeCompare((b.item.message || "").toLowerCase());
        if (cmp === 0) cmp = a.index - b.index;
        return logSort.dir === "asc" ? cmp : -cmp;
      })
      .map(({ item }) => item);
  }, [log, logSort]);
  const visibleLogText = useMemo(
    () => sortedLogEntries.map((item) => formatLogEntryForClipboard(item)).join("\n\n---\n\n"),
    [sortedLogEntries]
  );
  const mcpCountRef = React.useRef(mcpServers.length);
  const tutorialSnapshotRef = React.useRef<TutorialWorkspaceSnapshot | null>(null);
  const tutorialStepKeyRef = React.useRef("");
  const tutorialHistoryLimitRestoreRef = React.useRef<number | null>(null);
  const tutorialLoadBalancerRetryRestoreRef = React.useRef<Record<string, Array<{ instanceId: string; maxRetries: number; delaySecond: number; resumeMinute: number }>> | null>(null);
  const tutorialRuntimeState = useMemo(
    () => ({
      scenarioId: tutorialScenario?.id,
      agents,
      skills,
      activeAgentId,
      credentials: modelCredentials,
      credentialTestResults,
      history,
      currentChatInput: chatComposerDraft,
      historyMessageLimit,
      builtInTools,
      docs,
      loadBalancers,
      mcpServers,
      mcpToolsByServer,
      userProfile: {
        name: userName,
        description: userDescription,
        hasAvatar: !!userAvatarUrl
      },
      openedToolResultMessageIds: tutorialOpenedToolResultMessageIds
    }),
    [
      agents,
      skills,
      activeAgentId,
      modelCredentials,
      credentialTestResults,
      history,
      chatComposerDraft,
      historyMessageLimit,
      builtInTools,
      docs,
      loadBalancers,
      mcpServers,
      mcpToolsByServer,
      userName,
      userDescription,
      userAvatarUrl,
      tutorialOpenedToolResultMessageIds,
      tutorialScenario?.id
    ]
  );
  const tutorialEvaluations = useMemo<TutorialStepEvaluation[]>(
    () => (tutorialScenario ? tutorialScenario.steps.map((step) => evaluateTutorialStep(step, tutorialRuntimeState)) : []),
    [tutorialScenario, tutorialRuntimeState]
  );
  const currentTutorialStep = tutorialScenario?.steps[tutorialStepIndex] ?? null;
  const currentTutorialEvaluation = tutorialScenario ? tutorialEvaluations[tutorialStepIndex] ?? null : null;
  const tutorialExpectedAgent = useMemo(() => {
    const preset = currentTutorialStep?.automation?.activeAgentPreset;
    if (preset === "tutorial_agent") return findTutorialAgentInList(agents, loadBalancers);
    if (preset === "tutorial_agent_base") return findTutorialAgentBaseInList(agents, loadBalancers);
    return null;
  }, [currentTutorialStep, agents, loadBalancers]);
  const tutorialActiveAgentHint = useMemo(() => {
    const preset = currentTutorialStep?.automation?.activeAgentPreset;
    if (!preset) return null;
    if (tutorialExpectedAgent) return `案例鎖定：${tutorialExpectedAgent.name}`;
    return "案例鎖定：尚未找到教學用主要 Agent";
  }, [currentTutorialStep, tutorialExpectedAgent]);
  const tutorialActiveAgentWarning = useMemo(() => {
    const preset = currentTutorialStep?.automation?.activeAgentPreset;
    if (!preset || tutorialExpectedAgent) return null;
    return "目前找不到這個案例需要的主要 Agent。若你略過案例 1 的建立 Agent，後續案例將無法完成。";
  }, [currentTutorialStep, tutorialExpectedAgent]);
  const tutorialActive = !!tutorialScenario;
  const tutorialPreviewLocked = tutorialActive && tutorialStepIndex === 0;
  const tutorialShowLandingPreview = tutorialPreviewLocked && tutorialScenarioIndex === 0;
  const tutorialKeepChangesHint = "即使選擇保留這次教學變更，系統仍會刪除「教學用DOC」，避免之後的問答持續被案例 2 的人格設定影響。";

  React.useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!logResizeRef.current) return;
      const delta = logResizeRef.current.startY - e.clientY;
      const next = Math.min(360, Math.max(80, logResizeRef.current.startHeight + delta));
      setLogHeight(next);
    }

    function onUp() {
      logResizeRef.current = null;
      document.body.style.userSelect = "";
    }

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  React.useEffect(() => {
    (async () => {
      try {
        const list = await listDocs();
        setDocs(list);
        setDocsLoaded(true);
        logNow({ category: "docs", ok: true, message: `Docs loaded: ${list.length}` });
      } catch (e: any) {
        logNow({ category: "docs", ok: false, message: "Docs load failed", details: String(e?.message ?? e) });
      }
    })();
  }, []);

  React.useEffect(() => {
    (async () => {
      try {
        const list = await listSkills();
        setSkills(list);
        setSkillsLoaded(true);
        setSkillPanelSelectedId((current) => current ?? list[0]?.id ?? null);
        logNow({ category: "skills", ok: true, message: `Skills loaded: ${list.length}` });
      } catch (e: any) {
        logNow({ category: "skills", ok: false, message: "Skills load failed", details: String(e?.message ?? e) });
      }
    })();
  }, []);

  React.useEffect(() => {
    if (!skillPanelSelectedId) {
      setSkillPanelDocs([]);
      setSkillPanelFiles([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const [docs, files] = await Promise.all([listSkillDocs(skillPanelSelectedId), listSkillFiles(skillPanelSelectedId)]);
        if (!cancelled) {
          setSkillPanelDocs(docs);
          setSkillPanelFiles(files);
        }
      } catch (e: any) {
        if (!cancelled) {
          setSkillPanelDocs([]);
          setSkillPanelFiles([]);
          logNow({ category: "skills", ok: false, message: "Skill docs load failed", details: String(e?.message ?? e) });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [skillPanelSelectedId]);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const restored = (await loadChatHistory()).map(normalizeImportedMessage).filter(Boolean) as ChatMessage[];
        if (cancelled) return;
        setHistory((current) => (current.length === 0 ? restored : current));
        logNow({ category: "chat", ok: true, message: `History restored (${restored.length})` });
      } catch (e: any) {
        if (cancelled) return;
        logNow({ category: "chat", ok: false, message: "History restore failed", details: String(e?.message ?? e) });
      } finally {
        if (!cancelled) setHistoryLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  React.useEffect(() => {
    saveAgents(agents);

    if (!agents.some((a) => a.id === activeAgentId)) {
      setActiveAgentId(agents[0]?.id ?? "");
    }
  }, [agents, activeAgentId]);

  React.useEffect(() => {
    if (!agents.some((a) => a.id === selectedAgentId)) {
      setSelectedAgentId(activeAgentId || (agents[0]?.id ?? ""));
    }
  }, [agents, selectedAgentId, activeAgentId]);

  React.useEffect(() => {
    setAgents((prev) => {
      const withMagi = ensureManagedMagiAgents(prev);
      return normalizeTutorialPrimaryAgentList(withMagi, loadBalancers);
    });
  }, [agents, loadBalancers]);

  React.useEffect(() => {
    if (mode === "one_to_one" || activeTab !== "chat") return;
    const setup = MAGI_UNIT_LAYOUT.map(({ unitId }) => {
      const matches = agents.filter((agent) => matchesManagedMagiUnit(agent, unitId));
      const primary = matches[0] ?? null;
      const candidate = primary ? resolvePrimaryCandidate(primary) : null;
      const issue =
        matches.length === 0
          ? "missing"
          : matches.length > 1
          ? "duplicate"
          : !primary?.loadBalancerId
          ? "load_balancer_missing"
          : !candidate
          ? "load_balancer_unavailable"
          : null;
      return { unitId, agent: primary, ready: !issue };
    });
    const firstBlocking = setup.find((entry) => !entry.ready);
    if (!firstBlocking) return;
    const focusAgentId = firstBlocking.agent?.id ?? "";
    if (focusAgentId) {
      setSelectedAgentId(focusAgentId);
    }
    window.alert(
      [
        `S.C. MAGI 需要三位固定 agent：${formatManagedMagiAgentName("Melchior")}、${formatManagedMagiAgentName("Balthasar")}、${formatManagedMagiAgentName("Casper")}。`,
        "系統已預先建立三位 MAGI agent。",
        "請先到 Agents 頁，分別替他們設定 load balancer 後再回來進行裁決。"
      ].join("\n")
    );
    setActiveTab("agents");
  }, [mode, activeTab, agents, loadBalancers, modelCredentials]);

  React.useEffect(() => {
    saveUiState({
      activeTab,
      mode,
      skillExecutionMode,
      skillVerifyMax,
      skillToolLoopMax,
      skillVerifierAgentId,
      activeAgentId,
      historyMessageLimit,
      userName,
      userAvatarUrl,
      userDescription
    });
  }, [activeTab, mode, skillExecutionMode, skillVerifyMax, skillToolLoopMax, skillVerifierAgentId, activeAgentId, historyMessageLimit, userName, userAvatarUrl, userDescription]);

  React.useEffect(() => {
    saveMcpServers(mcpServers);
  }, [mcpServers]);

  React.useEffect(() => {
    saveMcpPromptTemplates(mcpPromptTemplates);
  }, [mcpPromptTemplates]);

  React.useEffect(() => {
    const nextZh = promptTemplateRuntime.resolve("tool-decision", "zh").template;
    const nextEn = promptTemplateRuntime.resolve("tool-decision", "en").template;
    setMcpPromptTemplates((prev) => {
      if (prev.zh === nextZh && prev.en === nextEn) return prev;
      return { ...prev, zh: nextZh, en: nextEn };
    });
  }, [promptTemplateRuntime]);

  React.useEffect(() => {
    savePromptTemplateFiles(promptTemplateFiles);
  }, [promptTemplateFiles]);

  React.useEffect(() => {
    saveBuiltInTools(builtInTools);
  }, [builtInTools]);

  React.useEffect(() => {
    saveModelCredentials(modelCredentials);
  }, [modelCredentials]);

  React.useEffect(() => {
    saveLoadBalancers(loadBalancers);
  }, [loadBalancers]);

  React.useEffect(() => {
    if (!historyLoaded) return;
    let cancelled = false;
    (async () => {
      try {
        await saveChatHistory(history);
      } catch (e: any) {
        if (cancelled) return;
        logNow({ category: "chat", ok: false, message: "History persist failed", details: String(e?.message ?? e) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [history, historyLoaded]);

  React.useEffect(() => {
    logNow({ category: "ui", message: `Tab -> ${activeTab}` });
  }, [activeTab]);

  React.useEffect(() => {
    logNow({ category: "ui", message: `Mode -> ${mode}` });
  }, [mode]);

  React.useEffect(() => {
    const agentName = agents.find((a) => a.id === activeAgentId)?.name ?? activeAgentId;
    if (agentName) logNow({ category: "agents", message: `Active agent -> ${agentName}` });
  }, [activeAgentId, agents]);

  React.useEffect(() => {
    if (mcpCountRef.current !== mcpServers.length) {
      mcpCountRef.current = mcpServers.length;
      logNow({ category: "mcp", message: `MCP servers -> ${mcpServers.length}` });
    }
  }, [mcpServers.length]);

  React.useEffect(() => {
    if (!docsLoaded) return;
    if (docEditorId && !docs.some((d) => d.id === docEditorId)) {
      setDocEditorId(null);
    }
  }, [docs, docEditorId, docsLoaded]);

  React.useEffect(() => {
    if (!skillsLoaded) return;
    if (skillPanelSelectedId && !skills.some((skill) => skill.id === skillPanelSelectedId)) {
      setSkillPanelSelectedId(skills[0]?.id ?? null);
    }
  }, [skills, skillPanelSelectedId, skillsLoaded]);

  React.useEffect(() => {
    if (mcpPanelActiveId && !mcpServers.some((s) => s.id === mcpPanelActiveId)) {
      setMcpPanelActiveId(null);
    }
  }, [mcpPanelActiveId, mcpServers]);

  React.useEffect(() => {
    if (activeTab !== "chat" && isChatFullscreen) {
      setIsChatFullscreen(false);
    }
  }, [activeTab, isChatFullscreen]);

  React.useEffect(() => {
    if (!tutorialScenario || !currentTutorialStep) return;
    const stepKey = `${tutorialScenario.id}:${currentTutorialStep.id}`;
    if (tutorialStepKeyRef.current === stepKey) return;
    tutorialStepKeyRef.current = stepKey;
    applyTutorialStepEntry(currentTutorialStep, tutorialRuntimeState, {
      setActiveTab,
      setConfigModal: (modal) => setConfigModal(modal),
      setActiveAgentId,
      setSelectedAgentId,
      setSkillExecutionMode,
      setSkillVerifyMax: (value) => setSkillVerifyMax(clampSkillVerifyMax(value)),
      setSkillToolLoopMax: (value) => setSkillToolLoopMax(clampSkillToolLoopMax(value)),
      setAgentLoadBalancerRetryPolicy: (agentId, value) =>
        setAgentLoadBalancerRetryPolicy(agentId, {
          delaySecond:
            typeof value.delaySecond === "number" ? Math.max(0, Math.min(30, Math.round(value.delaySecond))) : undefined,
          maxRetries:
            typeof value.maxRetries === "number" ? Math.max(0, Math.min(20, Math.round(value.maxRetries))) : undefined,
          resumeMinute:
            typeof value.resumeMinute === "number" ? Math.max(0, Math.min(1440, Math.round(value.resumeMinute))) : undefined
        }),
      clearChat: () => {
        setHistory([]);
        setTutorialOpenedToolResultMessageIds([]);
      },
      ensureTutorialPrimaryLoadBalancer: () => {
        ensureTutorialPrimaryLoadBalancer();
      },
      ensureTutorialSecondaryLoadBalancer: () => {
        ensureTutorialSecondaryLoadBalancer();
      },
      seedTutorialLoadBalancerDraft: (kind) => queueTutorialLoadBalancerDraft(kind),
      ensureTutorialDoc: () => {
        void ensureTutorialDoc();
      },
      ensureTutorialTimeTool: () => {
        void ensureTutorialTimeTool();
      },
      ensureTutorialAgentBrowserMcpTools: () => {
        const tutorialServer = mcpServers.find((server) => server.name === TUTORIAL_MCP_NAME);
        if (!tutorialServer) return;
        void ensureMcpToolsLoadedForServers([tutorialServer]);
      },
      ensureTutorialSequentialSkill: () => {
        void ensureTutorialSequentialSkill();
      },
      ensureTutorialChatgptBrowserSkill: () => {
        void ensureTutorialChatgptBrowserSkill();
      },
      setComposerSeed: (value) =>
        setTutorialComposerSeed({
          value,
          token: Date.now()
        })
    });
  }, [tutorialScenario, currentTutorialStep, tutorialRuntimeState]);

  React.useEffect(() => {
    if (!tutorialScenario || !currentTutorialStep) return;
    if (currentTutorialStep.behavior === "create_single_load_balancer") {
      ensureTutorialPrimaryLoadBalancer();
      return;
    }
    if (currentTutorialStep.behavior === "create_multi_load_balancer") {
      ensureTutorialSecondaryLoadBalancer();
    }
  }, [tutorialScenario, currentTutorialStep?.behavior, modelCredentials, credentialTestResults, loadBalancers]);

  React.useEffect(() => {
    if (!tutorialActive || !currentTutorialEvaluation?.targetId) return;
    const target = document.querySelector<HTMLElement>(`[data-tutorial-id="${currentTutorialEvaluation.targetId}"]`);
    if (!target) return;

    target.classList.add("tutorial-highlight-target");
    target.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
    return () => {
      target.classList.remove("tutorial-highlight-target");
    };
  }, [tutorialActive, currentTutorialEvaluation?.targetId, activeTab, configModal, skillPanelSelectedId]);

  React.useEffect(() => {
    if (!docsLoaded) return;
    const docIds = new Set(docs.map((d) => d.id));
    setAgents((prev) => {
      let changed = false;
      const next = prev.map((a) => {
        const nextDocs = a.allowedDocIds ? a.allowedDocIds.filter((id) => docIds.has(id)) : undefined;
        if (nextDocs !== a.allowedDocIds) {
          changed = true;
          return { ...a, allowedDocIds: nextDocs };
        }
        return a;
      });
      return changed ? next : prev;
    });
  }, [docs, docsLoaded]);

  React.useEffect(() => {
    const mcpIds = new Set(mcpServers.map((s) => s.id));
    setAgents((prev) => {
      let changed = false;
      const next = prev.map((a) => {
        const nextMcps = a.allowedMcpServerIds ? a.allowedMcpServerIds.filter((id) => mcpIds.has(id)) : undefined;
        if (nextMcps !== a.allowedMcpServerIds) {
          changed = true;
          return { ...a, allowedMcpServerIds: nextMcps };
        }
        return a;
      });
      return changed ? next : prev;
    });
  }, [mcpServers]);

  React.useEffect(() => {
    const builtInIds = new Set(allBuiltInTools.map((tool) => tool.id));
    setAgents((prev) => {
      let changed = false;
      const next = prev.map((agent) => {
        let nextBuiltIns = agent.allowedBuiltInToolIds ? agent.allowedBuiltInToolIds.filter((id) => builtInIds.has(id)) : undefined;
        if (agent.allowUserProfileTool || agent.allowAgentDirectoryTool) {
          const merged = new Set(nextBuiltIns ?? builtInTools.map((tool) => tool.id));
          if (agent.allowUserProfileTool) merged.add(SYSTEM_USER_PROFILE_TOOL_ID);
          if (agent.allowAgentDirectoryTool) merged.add(SYSTEM_AGENT_DIRECTORY_TOOL_ID);
          nextBuiltIns = Array.from(merged);
        }
        if (
          nextBuiltIns !== agent.allowedBuiltInToolIds ||
          agent.allowUserProfileTool !== undefined ||
          agent.allowAgentDirectoryTool !== undefined
        ) {
          changed = true;
          return {
            ...agent,
            allowedBuiltInToolIds: nextBuiltIns,
            allowUserProfileTool: undefined,
            allowAgentDirectoryTool: undefined
          };
        }
        return agent;
      });
      return changed ? next : prev;
    });
  }, [allBuiltInTools, builtInTools]);

  React.useEffect(() => {
    if (!skillsLoaded) return;
    const skillIds = new Set(skills.map((skill) => skill.id));
    setAgents((prev) => {
      let changed = false;
      const next = prev.map((agent) => {
        const nextSkills = agent.allowedSkillIds ? agent.allowedSkillIds.filter((id) => skillIds.has(id)) : undefined;
        if (nextSkills !== agent.allowedSkillIds) {
          changed = true;
          return { ...agent, allowedSkillIds: nextSkills };
        }
        return agent;
      });
      return changed ? next : prev;
    });
  }, [skills, skillsLoaded]);

  React.useEffect(() => {
    const migrated = migrateAgentsToLoadBalancers({
      agents,
      credentials: modelCredentials,
      loadBalancers
    });
    if (migrated.changed) {
      setAgents(migrated.agents);
      setModelCredentials(migrated.credentials);
      setLoadBalancers(migrated.loadBalancers);
    }
  }, [agents, modelCredentials, loadBalancers]);

  const docsForAgent = useMemo(() => {
    if (!activeAgent) return [];
    if (!isCategoryEnabled(activeAgent.enableDocs)) return [];
    if (!activeAgent.allowedDocIds) return docs;
    const allowed = new Set(activeAgent.allowedDocIds);
    return docs.filter((d) => allowed.has(d.id));
  }, [activeAgent, docs]);

  const availableMcpServersForAgent = useMemo(() => {
    if (!activeAgent) return [];
    if (!isCategoryEnabled(activeAgent.enableMcp)) return [];
    if (!activeAgent.allowedMcpServerIds) return mcpServers;
    const allowed = new Set(activeAgent.allowedMcpServerIds);
    return mcpServers.filter((s) => allowed.has(s.id));
  }, [activeAgent, mcpServers]);

  const availableBuiltinToolsForAgent = useMemo(() => {
    if (!activeAgent) return [];
    if (!isCategoryEnabled(activeAgent.enableBuiltInTools)) return [];
    if (!activeAgent.allowedBuiltInToolIds) {
      return allBuiltInTools;
    }
    const allowed = new Set(activeAgent.allowedBuiltInToolIds);
    return allBuiltInTools.filter((tool) => allowed.has(tool.id));
  }, [activeAgent, allBuiltInTools]);

  const skillSessionSnapshot = useMemo(() => buildSkillSessionSnapshot({ agent: activeAgent, skills }), [activeAgent, skills]);
  const availableSkillsForAgent = useMemo(() => getAllowedSkillsFromSnapshot(skillSessionSnapshot, skills), [skillSessionSnapshot, skills]);
  const configuredSkillVerifierAgent = useMemo(
    () => (skillVerifierAgentId ? agents.find((agent) => agent.id === skillVerifierAgentId) ?? null : null),
    [agents, skillVerifierAgentId]
  );

  const credentialSlots = useMemo(() => modelCredentials.slice().sort((a, b) => a.label.localeCompare(b.label)), [modelCredentials]);
  const configuredCredentialCount = useMemo(
    () =>
      credentialSlots.filter(
        (slot) => slot.preset === "chrome_prompt" || slot.keys.some((key) => key.apiKey.trim())
      ).length,
    [credentialSlots]
  );
  const loadBalancerSlots = useMemo(() => loadBalancers.slice().sort((a, b) => a.name.localeCompare(b.name)), [loadBalancers]);
  const configuredLoadBalancerCount = useMemo(
    () => loadBalancerSlots.filter((entry) => entry.instances.length > 0).length,
    [loadBalancerSlots]
  );

  function resolveLoadBalancerPlanForAgent(agent: AgentConfig, now?: number) {
    return resolveLoadBalancerCandidates({
      agent,
      credentials: modelCredentials,
      loadBalancers,
      now
    });
  }

  function resolvePrimaryCandidate(agent: AgentConfig) {
    return resolveLoadBalancerPlanForAgent(agent)[0] ?? null;
  }

  function getRetryPolicyForAgent(agent: AgentConfig) {
    const primary = resolvePrimaryCandidate(agent);
    return {
      delaySec: Math.max(0, primary?.instance.delaySecond ?? DEFAULT_INSTANCE_DELAY_SECOND),
      max: Math.max(0, primary?.instance.maxRetries ?? DEFAULT_INSTANCE_MAX_RETRIES)
    };
  }

  function hydrateAgentCredentials(agent: AgentConfig) {
    const primary = resolvePrimaryCandidate(agent);
    return primary?.hydratedAgent ?? agent;
  }

  function resolveSkillVerifierAgent(active: AgentConfig) {
    return configuredSkillVerifierAgent ? hydrateAgentCredentials(configuredSkillVerifierAgent) : hydrateAgentCredentials(active);
  }

  const magiSetup = useMemo(() => {
    return MAGI_UNIT_LAYOUT.map(({ unitId, unitNumber }) => {
      const matches = agents.filter((agent) => matchesManagedMagiUnit(agent, unitId));
      const primary = matches[0] ?? null;
      const candidate = primary ? resolvePrimaryCandidate(primary) : null;
      let issue: string | null = null;
      if (matches.length === 0) issue = "missing";
      else if (matches.length > 1) issue = "duplicate";
      else if (!primary?.loadBalancerId) issue = "load_balancer_missing";
      else if (!candidate) issue = "load_balancer_unavailable";
      return {
        unitId,
        unitNumber,
        matches,
        agent: primary,
        candidate,
        ready: !issue,
        issue
      };
    });
  }, [agents, loadBalancers, modelCredentials]);

  const magiReadyCount = useMemo(() => magiSetup.filter((entry) => entry.ready).length, [magiSetup]);

  function buildMagiUnitSystem(unitId: MagiUnitId, agent: AgentConfig, question: string) {
    const bundle = getMagiSkillBundle(unitId);
    const prepared = loadSkillRuntime({
      skill: bundle.skill,
      skillDocs: bundle.docs,
      skillFiles: bundle.files,
      agentDocs: [],
      availableMcpServers: [],
      availableMcpTools: [],
      availableBuiltinTools: [],
      userInput: question,
      skillInput: {},
      systemPromptTemplate: promptTemplateRuntime.resolve("skill-runtime-system", mcpPromptTemplates.activeId).template
    });

    const profileLines = [
      `S.C. MAGI unit: ${unitId}`,
      `Saved agent profile name: ${agent.name}`,
      agent.description?.trim() ? `Saved agent description:\n${agent.description.trim()}` : "",
      "This is MAGI internal mode. Ignore global docs, MCP tools, built-in tools, and any non-MAGI skills.",
      "Stay in your assigned MAGI role and answer only according to the internal skill instructions."
    ]
      .filter(Boolean)
      .join("\n\n");

    return [profileLines, prepared.system].filter(Boolean).join("\n\n");
  }

  function buildMagiPreparedUnits(question: string): { ok: true; units: MagiPreparedUnit[] } | { ok: false; reason: string; state: MagiRenderState } {
    const baseUnits = magiSetup.map((entry) => ({
      unitId: entry.unitId,
      unitNumber: entry.unitNumber,
      agent: entry.agent ?? {
        id: `missing-${entry.unitId}`,
        name: formatManagedMagiAgentName(entry.unitId),
        type: "openai_compat"
      },
      system: ""
    }));
    const state = createMagiRenderState(mode === "magi_consensus" ? "magi_consensus" : "magi_vote", question, baseUnits);
    for (const setup of magiSetup) {
      const unit = state.units.find((entry) => entry.unitId === setup.unitId);
      if (!unit) continue;
      unit.agentName = setup.agent?.name ?? formatManagedMagiAgentName(setup.unitId);
      unit.avatarUrl = setup.agent?.avatarUrl;
      if (setup.issue === "missing") unit.error = `找不到命名為 ${formatManagedMagiAgentName(setup.unitId)} 的 agent。`;
      if (setup.issue === "duplicate") unit.error = `${setup.unitId} 命名重複，請只保留一個。`;
      if (setup.issue === "load_balancer_missing") unit.error = `${setup.unitId} 尚未設定 load balancer。`;
      if (setup.issue === "load_balancer_unavailable") unit.error = `${setup.unitId} 沒有可用的 load balancer instance。`;
      if (unit.error) {
        unit.status = "error";
        unit.verdict = "DEADLOCK";
      }
    }
    const blocking = state.units.filter((unit) => unit.error);
    if (blocking.length > 0) {
      state.status = "failed";
      state.finalVerdict = "DEADLOCK";
      state.finalSummary = `S.C. MAGI 啟動前檢查失敗：${blocking.map((unit) => `${unit.unitId}=${unit.error}`).join("；")}`;
      state.informationText = "SETUP ERROR";
      state.transcript = blocking.map((unit, index) => ({
        id: `magi-preflight-${unit.unitId}-${index}`,
        round: 0,
        speaker: unit.unitId,
        label: "SETUP ERROR",
        content: unit.error ?? "Unknown setup error.",
        kind: "error"
      }));
      return { ok: false, reason: state.finalSummary, state };
    }

    const units: MagiPreparedUnit[] = magiSetup.map((entry) => ({
      unitId: entry.unitId,
      unitNumber: entry.unitNumber,
      agent: entry.agent!,
      system: buildMagiUnitSystem(entry.unitId, entry.agent!, question)
    }));

    return { ok: true, units };
  }

  function setAgentLoadBalancerRetryPolicy(agentId: string, patch: { delaySecond?: number; maxRetries?: number; resumeMinute?: number }) {
    const agent = agents.find((entry) => entry.id === agentId) ?? null;
    if (!agent?.loadBalancerId) return;

    setLoadBalancers((prev) => {
      const loadBalancer = prev.find((entry) => entry.id === agent.loadBalancerId) ?? null;
      if (!loadBalancer) return prev;

      if (!tutorialLoadBalancerRetryRestoreRef.current) {
        tutorialLoadBalancerRetryRestoreRef.current = {};
      }
      if (!tutorialLoadBalancerRetryRestoreRef.current[loadBalancer.id]) {
        tutorialLoadBalancerRetryRestoreRef.current[loadBalancer.id] = loadBalancer.instances.map((instance) => ({
          instanceId: instance.id,
          maxRetries: instance.maxRetries,
          delaySecond: instance.delaySecond,
          resumeMinute: instance.resumeMinute
        }));
      }

      return setLoadBalancerRetryPolicy({
        loadBalancers: prev,
        loadBalancerId: loadBalancer.id,
        maxRetries: patch.maxRetries,
        delaySecond: patch.delaySecond,
        resumeMinute: patch.resumeMinute
      });
    });
  }

  function queueTutorialLoadBalancerDraft(kind: "single" | "multi") {
    const draft =
      kind === "single"
        ? {
            ...createLoadBalancer("教學用Load Balancer 1"),
            description: "教學用單一 instance Load Balancer",
            instances: [
              createLoadBalancerInstance({
                model: TUTORIAL_PRIMARY_MODEL,
                description: "Primary tutorial instance"
              })
            ]
          }
        : {
            ...createLoadBalancer("教學用Load Balancer 2"),
            description: "教學用多 instance Load Balancer",
            instances: [
              createLoadBalancerInstance({
                model: TUTORIAL_PRIMARY_MODEL,
                description: "Primary provider / model baseline"
              }),
              createLoadBalancerInstance({
                model: TUTORIAL_SECONDARY_MODEL,
                description: "Same key with alternate model"
              }),
              createLoadBalancerInstance({
                model: TUTORIAL_PRIMARY_MODEL,
                description: "Different key or provider with primary model"
              })
            ]
          };
    setConfigModal("load_balancers");
    setLoadBalancerDraftSeed({ token: Date.now(), draft });
  }

  function ensureTutorialPrimaryLoadBalancer() {
    const credential =
      modelCredentials.find((entry) => entry.preset === "groq" && entry.keys.some((key) => credentialTestResults[key.id]?.ok === true)) ??
      modelCredentials.find((entry) => entry.preset === "groq" && entry.keys.some((key) => key.apiKey.trim())) ??
      null;
    const key =
      credential?.keys.find((entry) => credentialTestResults[entry.id]?.ok === true) ??
      credential?.keys.find((entry) => entry.apiKey.trim()) ??
      null;

    if (!credential || !key) return;

    const existing = loadBalancers.find((entry) => entry.name.trim() === "教學用Load Balancer 1") ?? null;
    const existingInstance = existing?.instances[0] ?? null;
    const now = Date.now();
    const nextEntry: LoadBalancerConfig = {
      ...(existing ?? createLoadBalancer("教學用Load Balancer 1")),
      name: "教學用Load Balancer 1",
      description: "教學用單一 instance Load Balancer",
      instances: [
        {
          ...(existingInstance ?? createLoadBalancerInstance()),
          credentialId: credential.id,
          credentialKeyId: key.id,
          model: TUTORIAL_PRIMARY_MODEL,
          description: "Primary tutorial instance",
          failure: false,
          failureCount: 0,
          nextCheckTime: null,
          updatedAt: now
        }
      ],
      updatedAt: now
    };

    const alreadyMatches =
      !!existing &&
      existing.description === nextEntry.description &&
      existing.instances.length === 1 &&
      existing.instances[0]?.credentialId === nextEntry.instances[0]?.credentialId &&
      existing.instances[0]?.credentialKeyId === nextEntry.instances[0]?.credentialKeyId &&
      existing.instances[0]?.model === nextEntry.instances[0]?.model &&
      existing.instances[0]?.description === nextEntry.instances[0]?.description &&
      existing.instances[0]?.failure === false &&
      existing.instances[0]?.failureCount === 0 &&
      existing.instances[0]?.nextCheckTime === null;

    if (alreadyMatches) {
      setLoadBalancerPanelSelectedId(existing.id);
      return;
    }

    setLoadBalancers((prev) => {
      const hasExisting = prev.some((entry) => entry.id === nextEntry.id);
      return hasExisting ? prev.map((entry) => (entry.id === nextEntry.id ? nextEntry : entry)) : [nextEntry, ...prev];
    });
    setLoadBalancerPanelSelectedId(nextEntry.id);
    logNow({
      category: "load_balancer",
      ok: true,
      message: `Tutorial load balancer ensured: ${nextEntry.name}`,
      details: `${credential.label} / ${TUTORIAL_PRIMARY_MODEL}`
    });
  }

  function ensureTutorialSecondaryLoadBalancer() {
    const primaryLoadBalancer = loadBalancers.find((entry) => entry.name.trim() === "教學用Load Balancer 1") ?? null;
    const primaryInstance = primaryLoadBalancer?.instances[0] ?? null;
    const primaryCredential =
      (primaryInstance ? modelCredentials.find((entry) => entry.id === primaryInstance.credentialId) : null) ??
      modelCredentials.find((entry) => entry.preset === "groq" && entry.keys.some((key) => credentialTestResults[key.id]?.ok === true)) ??
      modelCredentials.find((entry) => entry.preset === "groq" && entry.keys.some((key) => key.apiKey.trim())) ??
      null;
    if (!primaryCredential) return;

    const primaryKey =
      primaryCredential.keys.find((entry) => entry.id === primaryInstance?.credentialKeyId && entry.apiKey.trim()) ??
      primaryCredential.keys.find((entry) => credentialTestResults[entry.id]?.ok === true) ??
      primaryCredential.keys.find((entry) => entry.apiKey.trim()) ??
      null;
    if (!primaryKey) return;

    const secondarySameCredentialKey =
      primaryCredential.keys.find((entry) => entry.id !== primaryKey.id && entry.apiKey.trim()) ?? null;
    const secondaryCredential =
      secondarySameCredentialKey
        ? primaryCredential
        : modelCredentials.find((entry) => entry.id !== primaryCredential.id && entry.preset !== "chrome_prompt" && entry.keys.some((key) => key.apiKey.trim())) ??
          null;
    const secondaryKey =
      secondarySameCredentialKey ??
      secondaryCredential?.keys.find((entry) => credentialTestResults[entry.id]?.ok === true) ??
      secondaryCredential?.keys.find((entry) => entry.apiKey.trim()) ??
      null;
    if (!secondaryCredential || !secondaryKey) return;

    const existing = loadBalancers.find((entry) => entry.name.trim() === "教學用Load Balancer 2") ?? null;
    const now = Date.now();
    const nextInstances = [
      createLoadBalancerInstance({
        id: existing?.instances[0]?.id,
        credentialId: primaryCredential.id,
        credentialKeyId: primaryKey.id,
        model: TUTORIAL_PRIMARY_MODEL,
        description: "Primary provider / model baseline",
        maxRetries: existing?.instances[0]?.maxRetries ?? DEFAULT_INSTANCE_MAX_RETRIES,
        delaySecond: existing?.instances[0]?.delaySecond ?? DEFAULT_INSTANCE_DELAY_SECOND,
        resumeMinute: existing?.instances[0]?.resumeMinute ?? DEFAULT_INSTANCE_RESUME_MINUTE,
        failure: false,
        failureCount: 0,
        nextCheckTime: null,
        createdAt: existing?.instances[0]?.createdAt
      }),
      createLoadBalancerInstance({
        id: existing?.instances[1]?.id,
        credentialId: primaryCredential.id,
        credentialKeyId: primaryKey.id,
        model: TUTORIAL_SECONDARY_MODEL,
        description: "Same key with alternate model",
        maxRetries: existing?.instances[1]?.maxRetries ?? DEFAULT_INSTANCE_MAX_RETRIES,
        delaySecond: existing?.instances[1]?.delaySecond ?? DEFAULT_INSTANCE_DELAY_SECOND,
        resumeMinute: existing?.instances[1]?.resumeMinute ?? DEFAULT_INSTANCE_RESUME_MINUTE,
        failure: false,
        failureCount: 0,
        nextCheckTime: null,
        createdAt: existing?.instances[1]?.createdAt
      }),
      createLoadBalancerInstance({
        id: existing?.instances[2]?.id,
        credentialId: secondaryCredential.id,
        credentialKeyId: secondaryKey.id,
        model: TUTORIAL_PRIMARY_MODEL,
        description:
          secondaryCredential.id === primaryCredential.id ? "Different key with primary model" : "Different provider with primary model",
        maxRetries: existing?.instances[2]?.maxRetries ?? DEFAULT_INSTANCE_MAX_RETRIES,
        delaySecond: existing?.instances[2]?.delaySecond ?? DEFAULT_INSTANCE_DELAY_SECOND,
        resumeMinute: existing?.instances[2]?.resumeMinute ?? DEFAULT_INSTANCE_RESUME_MINUTE,
        failure: false,
        failureCount: 0,
        nextCheckTime: null,
        createdAt: existing?.instances[2]?.createdAt
      })
    ];

    const nextEntry: LoadBalancerConfig = {
      ...(existing ?? createLoadBalancer("教學用Load Balancer 2")),
      name: "教學用Load Balancer 2",
      description: "教學用多 instance Load Balancer",
      instances: nextInstances,
      updatedAt: now
    };

    const alreadyMatches =
      !!existing &&
      existing.description === nextEntry.description &&
      existing.instances.length === nextEntry.instances.length &&
      existing.instances.every((instance, index) => {
        const nextInstance = nextEntry.instances[index];
        return (
          instance.credentialId === nextInstance.credentialId &&
          instance.credentialKeyId === nextInstance.credentialKeyId &&
          instance.model === nextInstance.model &&
          instance.description === nextInstance.description &&
          instance.failure === false &&
          instance.failureCount === 0 &&
          instance.nextCheckTime === null
        );
      });

    if (alreadyMatches) {
      setLoadBalancerPanelSelectedId(existing.id);
      return;
    }

    setLoadBalancers((prev) => {
      const hasExisting = prev.some((entry) => entry.id === nextEntry.id);
      return hasExisting ? prev.map((entry) => (entry.id === nextEntry.id ? nextEntry : entry)) : [nextEntry, ...prev];
    });
    setLoadBalancerPanelSelectedId(nextEntry.id);
    logNow({
      category: "load_balancer",
      ok: true,
      message: `Tutorial load balancer ensured: ${nextEntry.name}`,
      details: `${primaryCredential.label} / ${TUTORIAL_PRIMARY_MODEL}\n${primaryCredential.label} / ${TUTORIAL_SECONDARY_MODEL}\n${secondaryCredential.label} / ${TUTORIAL_PRIMARY_MODEL}`
    });
  }

  function classifyRetryableAgentFailure(text: string) {
    const normalized = text.trim();
    if (!normalized) return null;
    if (normalized.startsWith("Request failed: HTTP 400") || normalized.startsWith("Request failed: HTTP 422")) {
      return { retryable: false, markFailure: false };
    }
    if (normalized.startsWith("Request failed: HTTP ")) {
      const status = Number(normalized.slice("Request failed: HTTP ".length).split(/\D/, 1)[0] || 0);
      if (status === 400 || status === 422) return { retryable: false, markFailure: false };
      return { retryable: true, markFailure: true };
    }
    if (normalized.startsWith("Request failed:")) {
      return { retryable: true, markFailure: true };
    }
    if (normalized.startsWith("HTTP 400") || normalized.startsWith("HTTP 422")) {
      return { retryable: false, markFailure: false };
    }
    if (normalized.startsWith("HTTP ")) {
      return { retryable: true, markFailure: true };
    }
    if (normalized.includes("Chrome Prompt API not available")) {
      return { retryable: true, markFailure: true };
    }
    return null;
  }

  function formatLoadBalancerDateTime(ts?: number | null) {
    if (typeof ts !== "number" || !Number.isFinite(ts)) return "-";
    return new Date(ts).toLocaleString();
  }

  function formatCredentialKeyLabel(credential: ModelCredentialEntry, key?: ModelCredentialEntry["keys"][number]) {
    if (credential.preset === "chrome_prompt") return "not_required";
    if (!key) return "missing";
    const slot = credential.keys.findIndex((entry) => entry.id === key.id);
    const suffix = key.apiKey.trim() ? `…${key.apiKey.trim().slice(-4)}` : "empty";
    const keyIdShort = key.id.slice(0, 8);
    return `slot=${slot >= 0 ? slot + 1 : "?"}/${credential.keys.length || "?"}, suffix=${suffix}, id=${keyIdShort}`;
  }

  function describeResolvedLoadBalancerCandidate(candidate: ResolvedLoadBalancerInstance) {
    const instanceIndex = Math.max(
      0,
      candidate.loadBalancer.instances.findIndex((entry) => entry.id === candidate.instance.id)
    );
    const provider = describeCredentialPreset(candidate.credential.preset, candidate.credential.endpoint);
    return [
      `load_balancer=${candidate.loadBalancer.name}`,
      `instance=${instanceIndex + 1}/${candidate.loadBalancer.instances.length}`,
      `provider=${provider}`,
      `credential=${candidate.credential.label}`,
      `endpoint=${candidate.credential.endpoint || "-"}`,
      `model=${candidate.instance.model || "-"}`,
      `description=${candidate.instance.description.trim() || "-"}`,
      `key=${formatCredentialKeyLabel(candidate.credential, candidate.key)}`,
      `max_retries=${candidate.instance.maxRetries}`,
      `delay_second=${candidate.instance.delaySecond}`,
      `resume_minute=${candidate.instance.resumeMinute}`,
      `failure=${candidate.instance.failure}`,
      `failure_count=${candidate.instance.failureCount}`,
      `next_check_time=${formatLoadBalancerDateTime(candidate.instance.nextCheckTime)}`
    ].join("\n");
  }

  function describeLoadBalancerAvailability(agent: AgentConfig) {
    if (!agent.loadBalancerId) return "agent has no load balancer";
    const loadBalancer = loadBalancers.find((entry) => entry.id === agent.loadBalancerId) ?? null;
    if (!loadBalancer) return `load balancer not found: ${agent.loadBalancerId}`;
    if (!loadBalancer.instances.length) return `load_balancer=${loadBalancer.name}\ninstances=0`;
    const now = Date.now();
    return [
      `load_balancer=${loadBalancer.name}`,
      ...loadBalancer.instances.map((instance, index) => {
        const credential = modelCredentials.find((entry) => entry.id === instance.credentialId) ?? null;
        const key = credential?.keys.find((entry) => entry.id === instance.credentialKeyId) ?? credential?.keys[0];
        const provider = credential ? describeCredentialPreset(credential.preset, credential.endpoint) : "missing_credential";
        const coolingDown =
          instance.failure === true &&
          typeof instance.nextCheckTime === "number" &&
          Number.isFinite(instance.nextCheckTime) &&
          now < instance.nextCheckTime;
        return [
          `instance=${index + 1}/${loadBalancer.instances.length}`,
          `status=${coolingDown ? "cooldown_skip" : "eligible"}`,
          `provider=${provider}`,
          `credential=${credential?.label ?? "(missing)"}`,
          `endpoint=${credential?.endpoint ?? "-"}`,
          `model=${instance.model || "-"}`,
          `description=${instance.description.trim() || "-"}`,
          `key=${credential ? formatCredentialKeyLabel(credential, key) : "missing"}`,
          `failure=${instance.failure}`,
          `failure_count=${instance.failureCount}`,
          `next_check_time=${formatLoadBalancerDateTime(instance.nextCheckTime)}`
        ].join("\n");
      })
    ].join("\n\n");
  }

  async function runOneToOneWithLoadBalancer(args: {
    logicalAgent: AgentConfig;
    input: string;
    history: ChatMessage[];
    system?: string;
    onDelta: (text: string) => void;
    onLog?: (text: string) => void;
    requestLabel?: string;
    requestId?: string;
  }) {
    const requestLabel = args.requestLabel ?? "chat response";
    let candidates = resolveLoadBalancerPlanForAgent(args.logicalAgent);
    if (!candidates.length) {
      logNow({
        category: "load_balancer",
        agent: args.logicalAgent.name,
        ok: false,
        requestId: args.requestId,
        stage: requestLabel,
        message: `LB no available instance [${requestLabel}]`,
        details: describeLoadBalancerAvailability(args.logicalAgent)
      });
      const fallbackAgent = hydrateAgentCredentials(args.logicalAgent);
      return runOneToOne({
        adapter: pickAdapter(fallbackAgent),
        agent: fallbackAgent,
        input: args.input,
        history: args.history,
        system: args.system,
        onDelta: args.onDelta,
        retry: getRetryPolicyForAgent(args.logicalAgent),
        onLog: args.onLog
      });
    }

    let lastFailureText = "No available load balancer instance.";
    let lastFailureDetails = lastFailureText;
    let shouldReturnEmptyResponse = false;
    for (const [candidateIndex, candidate] of candidates.entries()) {
      logNow({
        category: "load_balancer",
        agent: args.logicalAgent.name,
        requestId: args.requestId,
        stage: requestLabel,
        message: `LB selected [${requestLabel}]`,
        details: describeResolvedLoadBalancerCandidate(candidate)
      });
      const retry = {
        delaySec: Math.max(0, candidate.instance.delaySecond),
        max: Math.max(0, candidate.instance.maxRetries)
      };
      const text = await runOneToOne({
        adapter: pickAdapter(candidate.hydratedAgent),
        agent: candidate.hydratedAgent,
        input: args.input,
        history: args.history,
        system: args.system,
        onDelta: args.onDelta,
        retry,
        onLog: args.onLog
      });
      const trimmedText = String(text ?? "").trim();
      if (!trimmedText) {
        shouldReturnEmptyResponse = true;
        lastFailureText = "";
        lastFailureDetails = "模型沒有回傳任何內容。";
        const nextCandidate = candidates[candidateIndex + 1] ?? null;
        logNow({
          category: "load_balancer",
          agent: args.logicalAgent.name,
          ok: false,
          outcome: "degraded",
          requestId: args.requestId,
          stage: requestLabel,
          message: `${nextCandidate ? "LB empty response failover" : "LB empty response exhausted"} [${requestLabel}]`,
          details: [
            describeResolvedLoadBalancerCandidate(candidate),
            "response_length=0",
            "marked_failure=false",
            nextCandidate
              ? `next_candidate:\n${describeResolvedLoadBalancerCandidate(nextCandidate)}`
              : "next_candidate: none"
          ].join("\n\n")
        });
        if (nextCandidate) {
          continue;
        }
        break;
      }
      const failure = classifyRetryableAgentFailure(text);
      if (failure?.retryable) {
        shouldReturnEmptyResponse = false;
        lastFailureText = text;
        lastFailureDetails = text;
        const nextCandidate = candidates[candidateIndex + 1] ?? null;
        const failureUpdateDetails = failure.markFailure
          ? `updated_failure_count=${candidate.instance.failureCount + 1}\nupdated_next_check_time=${formatLoadBalancerDateTime(
              Date.now() + getLoadBalancerResumeMs(candidate.instance)
            )}`
          : "";
        if (failure.markFailure) {
          setLoadBalancers((prev) =>
            applyInstanceFailure({
              loadBalancers: prev,
              loadBalancerId: candidate.loadBalancer.id,
              instanceId: candidate.instance.id
            })
          );
        }
        logNow({
          category: "load_balancer",
          agent: args.logicalAgent.name,
          ok: false,
          requestId: args.requestId,
          stage: requestLabel,
          message: `${nextCandidate ? "LB failover" : "LB exhausted"} [${requestLabel}]`,
          details: [
            describeResolvedLoadBalancerCandidate(candidate),
            `error=${text}`,
            `marked_failure=${failure.markFailure}`,
            failureUpdateDetails,
            nextCandidate
              ? `next_candidate:\n${describeResolvedLoadBalancerCandidate(nextCandidate)}`
              : "next_candidate: none"
          ]
            .filter(Boolean)
            .join("\n\n")
        });
        continue;
      }

      if (failure && !failure.retryable) {
        logNow({
          category: "load_balancer",
          agent: args.logicalAgent.name,
          ok: false,
          requestId: args.requestId,
          stage: requestLabel,
          message: `LB terminal error [${requestLabel}]`,
          details: [describeResolvedLoadBalancerCandidate(candidate), `error=${text}`].join("\n\n")
        });
        return text;
      }

      setLoadBalancers((prev) =>
        applyInstanceSuccess({
          loadBalancers: prev,
          loadBalancerId: candidate.loadBalancer.id,
          instanceId: candidate.instance.id
        })
      );
      shouldReturnEmptyResponse = false;
      const responseLength = String(text ?? "").length;
      logNow({
        category: "load_balancer",
        agent: args.logicalAgent.name,
        ok: responseLength > 0,
        outcome: responseLength > 0 ? "success" : "degraded",
        requestId: args.requestId,
        stage: requestLabel,
        message: responseLength > 0 ? `LB success [${requestLabel}]` : `LB empty response [${requestLabel}]`,
        details: [describeResolvedLoadBalancerCandidate(candidate), `response_length=${responseLength}`].join("\n\n")
      });
      return text;
    }

    logNow({
      category: "load_balancer",
      agent: args.logicalAgent.name,
      ok: false,
      requestId: args.requestId,
      stage: requestLabel,
      message: `LB final failure [${requestLabel}]`,
      details: lastFailureDetails
    });
    return shouldReturnEmptyResponse ? "" : lastFailureText;
  }

  async function detectWithLoadBalancer(agent: AgentConfig): Promise<DetectResult> {
    const candidates = resolveLoadBalancerPlanForAgent(agent);
    if (!candidates.length) {
      logNow({
        category: "load_balancer",
        agent: agent.name,
        ok: false,
        message: "LB no available instance [detect]",
        details: describeLoadBalancerAvailability(agent)
      });
      const fallbackAgent = hydrateAgentCredentials(agent);
      const adapter = pickAdapter(fallbackAgent);
      return adapter.detect ? await adapter.detect(fallbackAgent) : { ok: false, detectedType: "unknown" as const, notes: "No detect()" };
    }

    let lastResult: DetectResult = { ok: false, detectedType: "unknown", notes: "No available instance" };
    for (const [candidateIndex, candidate] of candidates.entries()) {
      logNow({
        category: "load_balancer",
        agent: agent.name,
        message: "LB selected [detect]",
        details: describeResolvedLoadBalancerCandidate(candidate)
      });
      const adapter = pickAdapter(candidate.hydratedAgent);
      const result = adapter.detect
        ? await adapter.detect(candidate.hydratedAgent)
        : { ok: false, detectedType: "unknown" as const, notes: "No detect()" };
      if (result.ok) {
        setLoadBalancers((prev) =>
          applyInstanceSuccess({
            loadBalancers: prev,
            loadBalancerId: candidate.loadBalancer.id,
            instanceId: candidate.instance.id
          })
        );
        logNow({
          category: "load_balancer",
          agent: agent.name,
          ok: true,
          message: "LB success [detect]",
          details: [describeResolvedLoadBalancerCandidate(candidate), `detect_result=${JSON.stringify(result, null, 2)}`].join("\n\n")
        });
        return result;
      }
      lastResult = result;
      const failure = classifyRetryableAgentFailure(result.notes ?? "");
      if (failure?.markFailure) {
        setLoadBalancers((prev) =>
          applyInstanceFailure({
            loadBalancers: prev,
            loadBalancerId: candidate.loadBalancer.id,
            instanceId: candidate.instance.id
          })
        );
      }
      logNow({
        category: "load_balancer",
        agent: agent.name,
        ok: false,
        message: `${failure?.retryable ? "LB failover" : "LB terminal error"} [detect]`,
        details: [
          describeResolvedLoadBalancerCandidate(candidate),
          `detect_result=${JSON.stringify(result, null, 2)}`,
          failure?.retryable
            ? `next_candidate=${
                candidates[candidateIndex + 1]
                  ? `\n${describeResolvedLoadBalancerCandidate(candidates[candidateIndex + 1])}`
                  : "none"
              }`
            : ""
        ]
          .filter(Boolean)
          .join("\n\n")
      });
      if (!failure?.retryable) {
        return result;
      }
    }
    logNow({
      category: "load_balancer",
      agent: agent.name,
      ok: false,
      message: "LB final failure [detect]",
      details: JSON.stringify(lastResult, null, 2)
    });
    return lastResult;
  }

  async function ensureMcpToolsLoadedForServers(
    servers: McpServerConfig[],
    options?: { onStatus?: (text: string) => void; requestId?: string }
  ) {
    const unknownServers = servers.filter((server) => !Object.prototype.hasOwnProperty.call(mcpToolsByServer, server.id));
    if (!unknownServers.length) {
      return servers
        .map((server) => ({ server, tools: mcpToolsByServer[server.id] ?? [] }))
        .filter((entry) => entry.tools.length > 0);
    }

    options?.onStatus?.("正在同步 MCP 工具清單中…");

    const loadedEntries = await Promise.all(
      unknownServers.map(async (server) => {
        const client = new McpSseClient(server);
        client.connect((text) => pushLog({ category: "mcp", agent: server.name, requestId: options?.requestId, stage: "mcp_connect", message: text }));
        try {
          const tools = await listTools(client);
          logNow({
            category: "mcp",
            agent: server.name,
            ok: true,
            requestId: options?.requestId,
            stage: "mcp_tools_load",
            message: `Auto-loaded MCP tools: ${tools.length}`,
            details: tools.map((tool) => tool.name).join("\n") || "(no tools)"
          });
          return { serverId: server.id, tools };
        } catch (error: any) {
          logNow({
            category: "mcp",
            agent: server.name,
            ok: false,
            requestId: options?.requestId,
            stage: "mcp_tools_load",
            message: "Auto-load MCP tools failed",
            details: String(error?.message ?? error)
          });
          return null;
        } finally {
          client.close();
        }
      })
    );

    const loadedMap = loadedEntries.reduce<Record<string, McpTool[]>>((acc, entry) => {
      if (!entry) return acc;
      acc[entry.serverId] = entry.tools;
      return acc;
    }, {});

    if (Object.keys(loadedMap).length > 0) {
      setMcpToolsByServer((prev) => ({ ...prev, ...loadedMap }));
    }

    return servers
      .map((server) => ({
        server,
        tools: loadedMap[server.id] ?? mcpToolsByServer[server.id] ?? []
      }))
      .filter((entry) => entry.tools.length > 0);
  }

  function addCredential(preset: "openai" | "groq" | "custom" | "chrome_prompt") {
    setModelCredentials((prev) => {
      if (preset === "openai" && prev.some((entry) => entry.preset === "openai")) return prev;
      if (preset === "groq" && prev.some((entry) => entry.preset === "groq")) return prev;
      if (preset === "chrome_prompt" && prev.some((entry) => entry.preset === "chrome_prompt")) return prev;
      const customCount = prev.filter((entry) => entry.preset === "custom").length;
      return [...prev, createCredentialEntry(preset, customCount + 1)];
    });
  }

  function updateCredential(id: string, patch: Partial<ModelCredentialEntry>) {
    setModelCredentials((prev) =>
      prev.map((entry) =>
        entry.id === id
          ? {
              ...entry,
              ...patch,
              updatedAt: Date.now()
            }
          : entry
      )
    );
    if (patch.endpoint !== undefined) {
      setCredentialTestResults((prev) => {
        if (!(id in prev)) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }
  }

  function removeCredential(id: string) {
    setModelCredentials((prev) => prev.filter((entry) => entry.id !== id));
    setVisibleCredentialIds((prev) => {
      const next = { ...prev };
      const credential = modelCredentials.find((entry) => entry.id === id);
      credential?.keys.forEach((key) => delete next[key.id]);
      return next;
    });
    setCredentialTestResults((prev) => {
      const next = { ...prev };
      const credential = modelCredentials.find((entry) => entry.id === id);
      credential?.keys.forEach((key) => delete next[key.id]);
      return next;
    });
    setTestingCredentialIds((prev) => {
      const next = { ...prev };
      const credential = modelCredentials.find((entry) => entry.id === id);
      credential?.keys.forEach((key) => delete next[key.id]);
      return next;
    });
  }

  function addCredentialKey(credentialId: string) {
    setModelCredentials((prev) =>
      prev.map((entry) =>
        entry.id === credentialId
          ? {
              ...entry,
              keys: [...entry.keys, createCredentialKeyEntry("")],
              updatedAt: Date.now()
            }
          : entry
      )
    );
  }

  function updateCredentialKey(credentialId: string, keyId: string, apiKey: string) {
    setModelCredentials((prev) =>
      prev.map((entry) =>
        entry.id === credentialId
          ? {
              ...entry,
              keys: entry.keys.map((key) =>
                key.id === keyId
                  ? {
                      ...key,
                      apiKey,
                      updatedAt: Date.now()
                    }
                  : key
              ),
              updatedAt: Date.now()
            }
          : entry
      )
    );
    setCredentialTestResults((prev) => {
      const next = { ...prev };
      delete next[keyId];
      return next;
    });
  }

  function removeCredentialKey(credentialId: string, keyId: string) {
    setModelCredentials((prev) =>
      prev.map((entry) =>
        entry.id === credentialId
          ? {
              ...entry,
              keys: entry.keys.filter((key) => key.id !== keyId),
              updatedAt: Date.now()
            }
          : entry
      )
    );
    setVisibleCredentialIds((prev) => {
      const next = { ...prev };
      delete next[keyId];
      return next;
    });
    setCredentialTestResults((prev) => {
      const next = { ...prev };
      delete next[keyId];
      return next;
    });
    setTestingCredentialIds((prev) => {
      const next = { ...prev };
      delete next[keyId];
      return next;
    });
  }

  async function runCredentialTest(slot: ModelCredentialEntry, keyId: string) {
    const key = slot.keys.find((entry) => entry.id === keyId);
    if (!key) return;
    setTestingCredentialIds((prev) => ({ ...prev, [key.id]: true }));
    setCredentialTestResults((prev) => ({ ...prev, [key.id]: undefined }));
    try {
      const result = await testCredentialConnection(slot, key.apiKey);
      setCredentialTestResults((prev) => ({ ...prev, [key.id]: result }));
      logNow({
        category: "credentials",
        agent: slot.label,
        ok: true,
        message: "Credential test passed",
        details: `${slot.endpoint}\nKey ${slot.keys.findIndex((entry) => entry.id === keyId) + 1}\n${result.message}`
      });
    } catch (e: any) {
      const message = String(e?.message ?? e);
      setCredentialTestResults((prev) => ({
        ...prev,
        [key.id]: { ok: false, message }
      }));
      logNow({
        category: "credentials",
        agent: slot.label,
        ok: false,
        message: "Credential test failed",
        details: `${slot.endpoint}\nKey ${slot.keys.findIndex((entry) => entry.id === keyId) + 1}\n${message}`
      });
    } finally {
      setTestingCredentialIds((prev) => ({ ...prev, [key.id]: false }));
    }
  }

  async function reloadSkillsFromStore(preferredId?: string | null) {
    const next = await listSkills();
    setSkills(next);
    const nextSelectedId = preferredId && next.some((skill) => skill.id === preferredId) ? preferredId : next[0]?.id ?? null;
    setSkillPanelSelectedId(nextSelectedId);
    if (nextSelectedId) {
      const [docs, files] = await Promise.all([listSkillDocs(nextSelectedId), listSkillFiles(nextSelectedId)]);
      setSkillPanelDocs(docs);
      setSkillPanelFiles(files);
    } else {
      setSkillPanelDocs([]);
      setSkillPanelFiles([]);
    }
  }

  function scenarioRequiresHistoryLimitOne(scenario: TutorialScenarioDefinition | null | undefined) {
    return !!scenario?.steps.some((step) => step.behavior === "set_history_limit_to_one");
  }

  function scenarioRequiresLoadBalancerRetryOverride(scenario: TutorialScenarioDefinition | null | undefined) {
    return !!scenario?.steps.some(
      (step) =>
        typeof step.automation?.loadBalancerDelaySecond === "number" ||
        typeof step.automation?.loadBalancerMaxRetries === "number"
    );
  }

  function restoreTutorialHistoryLimitIfNeeded() {
    if (tutorialHistoryLimitRestoreRef.current === null) return tutorialHistoryLimitRestoreRef.current;
    const original = tutorialHistoryLimitRestoreRef.current;
    setHistoryMessageLimit(original);
    tutorialHistoryLimitRestoreRef.current = null;
    return original;
  }

  function restoreTutorialLoadBalancerRetryIfNeeded() {
    if (!tutorialLoadBalancerRetryRestoreRef.current) return null;
    const restoreMap = tutorialLoadBalancerRetryRestoreRef.current;
    setLoadBalancers((prev) =>
      prev.map((loadBalancer) => {
        const restoreEntries = restoreMap[loadBalancer.id];
        if (!restoreEntries?.length) return loadBalancer;
        const byId = new Map(restoreEntries.map((entry) => [entry.instanceId, entry]));
        return {
          ...loadBalancer,
          instances: loadBalancer.instances.map((instance) => {
            const restore = byId.get(instance.id);
            return restore
              ? {
                  ...instance,
                  maxRetries: restore.maxRetries,
                  delaySecond: restore.delaySecond,
                  resumeMinute: restore.resumeMinute,
                  updatedAt: Date.now()
                }
              : instance;
          }),
          updatedAt: Date.now()
        };
      })
    );
    tutorialLoadBalancerRetryRestoreRef.current = null;
    return restoreMap;
  }

  async function removeTutorialDocIfPresent(reason: string) {
    const tutorialDocs = (await listDocs()).filter((doc) => doc.title === TUTORIAL_DOC_NAME);
    if (tutorialDocs.length === 0) return false;
    await Promise.all(tutorialDocs.map((doc) => deleteDoc(doc.id)));
    setDocs(await listDocs());
    logNow({ category: "tutorial", ok: true, message: `Tutorial doc removed: ${reason}` });
    return true;
  }

  async function startTutorial(scenarioId: string) {
    const scenario = getTutorialScenario(scenarioId);
    if (!scenario) {
      const issue = getTutorialCatalogError(scenarioId);
      const message = issue ? `無法進行案例教學：${issue}` : "無法進行案例教學，請稍後再試。";
      logNow({ category: "tutorial", ok: false, message: `Tutorial unavailable: ${scenarioId}`, details: issue ?? undefined });
      setTutorialUnavailableMessage(message);
      return;
    }
    const scenarioIndex = tutorialCatalog.findIndex((item) => item.id === scenarioId);

    const snapshot = await captureTutorialWorkspaceSnapshot(tutorialRuntimeState);
    tutorialSnapshotRef.current = snapshot;
    tutorialHistoryLimitRestoreRef.current = scenarioRequiresHistoryLimitOne(scenario) ? historyMessageLimit : null;
    tutorialLoadBalancerRetryRestoreRef.current = scenarioRequiresLoadBalancerRetryOverride(scenario) ? {} : null;
    tutorialStepKeyRef.current = "";
    setTutorialScenario(scenario);
    setTutorialScenarioIndex(scenarioIndex >= 0 ? scenarioIndex : 0);
    setTutorialStepIndex(0);
    setTutorialOpenedToolResultMessageIds([]);
    setShowTutorialExitPrompt(false);
    setConfigModal(null);
    setIsChatFullscreen(false);
    setAppEntryMode("workspace");
    logNow({ category: "tutorial", ok: true, message: `Tutorial started: ${scenario.title}` });
  }

  async function moveToNextTutorialScenario() {
    const restoredHistoryLimit = restoreTutorialHistoryLimitIfNeeded();
    restoreTutorialLoadBalancerRetryIfNeeded();
    if (tutorialScenarioIndex === null) {
      setShowTutorialExitPrompt(true);
      return;
    }
    const nextScenario = tutorialCatalog[tutorialScenarioIndex + 1] ?? null;
    if (!nextScenario) {
      setShowTutorialExitPrompt(true);
      return;
    }
    if (nextScenario.id !== "docs-persona-chat") {
      await removeTutorialDocIfPresent(`left case 2 before entering ${nextScenario.title}`);
    }
    tutorialStepKeyRef.current = "";
    tutorialHistoryLimitRestoreRef.current = scenarioRequiresHistoryLimitOne(nextScenario)
      ? restoredHistoryLimit ?? historyMessageLimit
      : null;
    tutorialLoadBalancerRetryRestoreRef.current = scenarioRequiresLoadBalancerRetryOverride(nextScenario) ? {} : null;
    setTutorialScenario(nextScenario);
    setTutorialScenarioIndex(tutorialScenarioIndex + 1);
    setTutorialStepIndex(0);
    setTutorialComposerSeed(null);
    setTutorialOpenedToolResultMessageIds([]);
    setConfigModal(null);
    setIsChatFullscreen(false);
    logNow({ category: "tutorial", ok: true, message: `Tutorial case switched: ${nextScenario.title}` });
  }

  async function finishTutorial(keepWorkspaceChanges: boolean) {
    restoreTutorialHistoryLimitIfNeeded();
    restoreTutorialLoadBalancerRetryIfNeeded();
    if (!keepWorkspaceChanges && tutorialSnapshotRef.current) {
      await restoreTutorialWorkspaceSnapshot(tutorialSnapshotRef.current);
      setBuiltInTools(tutorialSnapshotRef.current.builtInTools);
      await reloadSkillsFromStore(skillPanelSelectedId);
      const tutorialDocs = (await listDocs()).filter((doc) => doc.title === TUTORIAL_DOC_NAME);
      if (tutorialDocs.length) {
        await Promise.all(tutorialDocs.map((doc) => deleteDoc(doc.id)));
        setDocs(await listDocs());
      }
      setMcpServers((prev) => prev.filter((server) => server.name !== TUTORIAL_MCP_NAME));
      logNow({ category: "tutorial", ok: true, message: "Tutorial changes discarded for docs, MCP, tools, and skills" });
    } else if (tutorialScenario) {
      await removeTutorialDocIfPresent("tutorial finished");
      logNow({ category: "tutorial", ok: true, message: `Tutorial ended: ${tutorialScenario.title}` });
    }

    tutorialSnapshotRef.current = null;
    tutorialHistoryLimitRestoreRef.current = null;
    tutorialLoadBalancerRetryRestoreRef.current = null;
    tutorialStepKeyRef.current = "";
    setTutorialScenario(null);
    setTutorialScenarioIndex(null);
    setTutorialStepIndex(0);
    setTutorialComposerSeed(null);
    setTutorialOpenedToolResultMessageIds([]);
    setShowTutorialExitPrompt(false);
    setConfigModal(null);
  }

  function advanceTutorialStep() {
    if (!tutorialScenario || !currentTutorialStep || !currentTutorialEvaluation?.canContinue) return;
    if (tutorialStepIndex >= tutorialScenario.steps.length - 1) {
      void moveToNextTutorialScenario();
      return;
    }
    setTutorialStepIndex((current) => current + 1);
  }

  function skipTutorialScenario() {
    if (!tutorialScenario) return;
    logNow({ category: "tutorial", ok: true, message: `Tutorial case skipped: ${tutorialScenario.title}` });
    void moveToNextTutorialScenario();
  }

  async function onSaveAgent(a: AgentConfig) {
    try {
      const existing = agents.find((agent) => agent.id === a.id) ?? null;
      const normalizedAgent = isManagedMagiAgent(a)
        ? normalizeManagedMagiAgent(a, a.managedUnitId ?? "Melchior")
        : {
            ...a,
            tutorialRole: (
              a.tutorialRole === TUTORIAL_AGENT_ROLE ||
              existing?.tutorialRole === TUTORIAL_AGENT_ROLE ||
              (tutorialActive && usesTutorialLoadBalancer(a, loadBalancers))
                ? TUTORIAL_AGENT_ROLE
                : undefined
            ) as AgentConfig["tutorialRole"]
          };
      upsertAgent(normalizedAgent);
      const next = normalizeTutorialPrimaryAgentList(loadAgents(), loadBalancers);
      saveAgents(next);
      setAgents(next);
      setActiveAgentId(normalizedAgent.id);
      setSelectedAgentId(normalizedAgent.id);
      logNow({ category: "agents", agent: normalizedAgent.name, ok: true, message: "Agent saved", details: JSON.stringify(normalizedAgent, null, 2) });
    } catch (e: any) {
      logNow({ category: "agents", agent: a.name, ok: false, message: "Agent save failed", details: String(e?.message ?? e) });
    }
  }

  async function onDeleteAgent(id: string) {
    const target = agents.find((a) => a.id === id);
    try {
      deleteAgent(id);
      const next = loadAgents();
      setAgents(next);
      setActiveAgentId(next[0]?.id ?? "");
      setSelectedAgentId((current) => (current === id ? next[0]?.id ?? "" : current));
      logNow({ category: "agents", agent: target?.name, ok: true, message: "Agent deleted" });
    } catch (e: any) {
      logNow({ category: "agents", agent: target?.name, ok: false, message: "Agent delete failed", details: String(e?.message ?? e) });
    }
  }

  function append(m: ChatMessage) {
    setHistory((h) => [...h, m]);
  }

  function patchMessage(id: string, patch: Partial<ChatMessage>) {
    setHistory((h) => h.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  }

  async function runToolDecision(args: {
    agent: AgentConfig;
    adapter: ReturnType<typeof pickAdapter>;
    userInput: string;
    retry: { delaySec: number; max: number };
    toolEntries: ToolEntry[];
    promptTemplate: string;
    fallbackPromptTemplate: string;
    requestId?: string;
  }): Promise<ToolDecision | null> {
    const toolList = buildToolDecisionCatalog(args.toolEntries);

    const decisionPrompt = buildToolDecisionPrompt(
      args.promptTemplate,
      args.fallbackPromptTemplate,
      args.userInput,
      JSON.stringify(toolList, null, 2)
    );

    for (let attempt = 0; attempt <= args.retry.max; attempt++) {
      const raw = await runOneToOneWithLoadBalancer({
        logicalAgent: args.agent,
        input: decisionPrompt,
        history: [],
        requestId: args.requestId,
        requestLabel: "tool decision",
        onDelta: () => {},
        onLog: (t) => pushLog({ category: "retry", agent: args.agent.name, requestId: args.requestId, stage: "tool decision", message: t })
      });

      const terminalFailure = detectTerminalAgentFailure(raw);
      if (terminalFailure) {
        logNow({
          category: "mcp",
          agent: args.agent.name,
          ok: false,
          requestId: args.requestId,
          stage: "tool decision",
          message: "Tool decision failed after model retries",
          details: terminalFailure
        });
        return null;
      }

      const decision = normalizeToolDecision(extractJsonObject(raw));
      if (decision) {
        logNow({
          category: "mcp",
          agent: args.agent.name,
          ok: true,
          requestId: args.requestId,
          stage: "tool decision",
          message: `Tool decision: ${decision.type}`,
          details: raw
        });
        return decision;
      }

      logNow({
        category: "mcp",
        agent: args.agent.name,
        ok: false,
        requestId: args.requestId,
        stage: "tool decision",
        message: `Tool decision invalid schema (${attempt + 1}/${args.retry.max + 1})`,
        details: raw
      });

      if (attempt < args.retry.max) {
        await sleep(args.retry.delaySec * 1000);
      }
    }

    return null;
  }

  async function runSkillDecision(args: {
    agent: AgentConfig;
    adapter: ReturnType<typeof pickAdapter>;
    userInput: string;
    retry: { delaySec: number; max: number };
    skills: SkillConfig[];
    language: "zh" | "en";
    promptTemplate?: string;
    requestId?: string;
  }): Promise<SkillDecision | null> {
    const skillList = buildSkillDecisionCatalog(args.skills);
    const prompt = buildSkillDecisionPrompt(args.userInput, JSON.stringify(skillList, null, 2), args.language, args.promptTemplate);

    for (let attempt = 0; attempt <= args.retry.max; attempt++) {
      const raw = await runOneToOneWithLoadBalancer({
        logicalAgent: args.agent,
        input: prompt,
        history: [],
        requestId: args.requestId,
        requestLabel: "skill decision",
        onDelta: () => {},
        onLog: (t) => pushLog({ category: "retry", agent: args.agent.name, requestId: args.requestId, stage: "skill decision", message: t })
      });

      const terminalFailure = detectTerminalAgentFailure(raw);
      if (terminalFailure) {
        logNow({
          category: "skills",
          agent: args.agent.name,
          ok: false,
          requestId: args.requestId,
          stage: "skill decision",
          message: "Skill decision failed after model retries",
          details: terminalFailure
        });
        return null;
      }

      const decision = normalizeSkillDecision(extractJsonObject(raw));
      if (decision) {
        logNow({
          category: "skills",
          agent: args.agent.name,
          ok: true,
          requestId: args.requestId,
          stage: "skill decision",
          message: `Skill decision: ${decision.type}`,
          details: raw
        });
        return decision;
      }

      logNow({
        category: "skills",
        agent: args.agent.name,
        ok: false,
        requestId: args.requestId,
        stage: "skill decision",
        message: `Skill decision invalid schema (${attempt + 1}/${args.retry.max + 1})`,
        details: raw
      });

      if (attempt < args.retry.max) {
        await sleep(args.retry.delaySec * 1000);
      }
    }

    return null;
  }

  async function runSkillVerifyDecision(args: {
    answeringAgent: AgentConfig;
    verifierAgent: AgentConfig;
    adapter: ReturnType<typeof pickAdapter>;
    userInput: string;
    currentInput: string;
    answer: string;
    skill: SkillConfig;
    runtime: LoadedSkillRuntime;
    round: number;
    retry: { delaySec: number; max: number };
    promptTemplate?: string;
    requestId?: string;
  }) {
    const prompt = buildSkillVerifyPrompt({
      skill: args.skill,
      runtime: args.runtime,
      userInput: args.userInput,
      currentInput: args.currentInput,
      answer: args.answer,
      round: args.round,
      template: args.promptTemplate
    });

    for (let attempt = 0; attempt <= args.retry.max; attempt++) {
      const raw = await runOneToOneWithLoadBalancer({
        logicalAgent: args.verifierAgent,
        input: prompt,
        history: [],
        requestId: args.requestId,
        requestLabel: `skill verify round ${args.round}`,
        onDelta: () => {},
        onLog: (t) => pushLog({ category: "retry", agent: args.verifierAgent.name, requestId: args.requestId, stage: `skill verify round ${args.round}`, message: t })
      });

      const terminalFailure = detectTerminalAgentFailure(raw);
      if (terminalFailure) {
        logNow({
          category: "skills",
          agent: args.answeringAgent.name,
          ok: false,
          requestId: args.requestId,
          stage: `skill verify round ${args.round}`,
          message: `Skill verify round ${args.round} failed after model retries`,
          details: terminalFailure
        });
        return null;
      }

      const decision = normalizeSkillVerifyDecision(extractJsonObject(raw));
      if (decision) {
        logNow({
          category: "skills",
          agent: args.answeringAgent.name,
          ok: true,
          requestId: args.requestId,
          stage: `skill verify round ${args.round}`,
          message: `Skill verify round ${args.round}: ${decision.type}`,
          details: raw
        });
        return decision;
      }

      logNow({
        category: "skills",
        agent: args.answeringAgent.name,
        ok: false,
        requestId: args.requestId,
        stage: `skill verify round ${args.round}`,
        message: `Skill verify invalid schema (${attempt + 1}/${args.retry.max + 1})`,
        details: raw
      });

      if (attempt < args.retry.max) {
        await sleep(args.retry.delaySec * 1000);
      }
    }

    return null;
  }

  async function runSkillBootstrapPlan(args: {
    agent: AgentConfig;
    adapter: ReturnType<typeof pickAdapter>;
    retry: { delaySec: number; max: number };
    skill: SkillConfig;
    runtime: LoadedSkillRuntime;
    userInput: string;
    promptTemplate?: string;
    requestId?: string;
    onTrace?: (label: string, content: string) => void;
  }): Promise<SkillBootstrapPlan> {
    const prompt = buildBootstrapPlanPrompt({
      skill: args.skill,
      runtime: args.runtime,
      userInput: args.userInput,
      template: args.promptTemplate
    });

    for (let attempt = 0; attempt <= args.retry.max; attempt++) {
      const raw = await runOneToOneWithLoadBalancer({
        logicalAgent: args.agent,
        input: prompt,
        history: [],
        requestId: args.requestId,
        requestLabel: "skill bootstrap plan",
        onDelta: () => {},
        onLog: (t) => pushLog({ category: "retry", agent: args.agent.name, requestId: args.requestId, stage: "skill bootstrap plan", message: t })
      });

      const terminalFailure = detectTerminalAgentFailure(raw);
      if (terminalFailure) {
        logNow({
          category: "skills",
          agent: args.agent.name,
          ok: false,
          requestId: args.requestId,
          stage: "skill bootstrap plan",
          message: "Skill bootstrap plan failed after model retries",
          details: terminalFailure
        });
        args.onTrace?.("Bootstrap raw", raw);
        break;
      }

      const parsed = normalizeSkillBootstrapPlan(extractJsonObject(raw));
      if (parsed?.todo.length) {
        logNow({
          category: "skills",
          agent: args.agent.name,
          ok: true,
          requestId: args.requestId,
          stage: "skill bootstrap plan",
          message: "Skill bootstrap plan created",
          details: raw
        });
        args.onTrace?.("Bootstrap raw", raw);
        args.onTrace?.(
          "Bootstrap parsed",
          [
            parsed.taskSummary ? `Task summary: ${parsed.taskSummary}` : "",
            parsed.startUrl ? `Start URL: ${parsed.startUrl}` : "Start URL: (none)",
            parsed.notes?.length ? `Notes:\n- ${parsed.notes.join("\n- ")}` : "",
            `Todo:\n${bootstrapTodoList(parsed.todo)
              .map((item, index) => `${index + 1}. ${item.label}`)
              .join("\n")}`
          ]
            .filter(Boolean)
            .join("\n")
        );
        return parsed;
      }

      logNow({
        category: "skills",
        agent: args.agent.name,
        ok: false,
        requestId: args.requestId,
        stage: "skill bootstrap plan",
        message: `Skill bootstrap plan invalid schema (${attempt + 1}/${args.retry.max + 1})`,
        details: raw
      });
      args.onTrace?.("Bootstrap raw", raw);

      if (attempt < args.retry.max) {
        await sleep(args.retry.delaySec * 1000);
      }
    }

    return {
      todo: [
        "載入 skill 與必要資源",
        "觀察目前狀態",
        "執行下一個工具操作",
        "確認任務是否完成",
        "整理最終回覆"
      ],
      startUrl: extractFirstUrl(args.userInput)
    };
  }

  async function runSkillStepPlanner(args: {
    agent: AgentConfig;
    adapter: ReturnType<typeof pickAdapter>;
    retry: { delaySec: number; max: number };
    state: SkillRunState;
    skill: SkillConfig;
    runtime: LoadedSkillRuntime;
    userInput: string;
    currentContext: string;
    toolScopeSummary: string;
    mustObserve: boolean;
    mustAct: boolean;
    phaseHint?: string;
    promptTemplate?: string;
    requestId?: string;
    onTrace?: (label: string, content: string) => void;
  }): Promise<SkillStepDecision | null> {
    const prompt = buildPlannerStepPrompt({
      skill: args.skill,
      runtime: args.runtime,
      userInput: args.userInput,
      currentContext: args.currentContext,
      currentPhaseHint: args.phaseHint,
      toolScopeSummary: args.toolScopeSummary,
      todoSummary: summarizeTodo(args.state.todo),
      mustObserve: args.mustObserve,
      mustAct: args.mustAct,
      template: args.promptTemplate
    });

    for (let attempt = 0; attempt <= args.retry.max; attempt++) {
      const raw = await runOneToOneWithLoadBalancer({
        logicalAgent: args.agent,
        input: prompt,
        history: [],
        requestId: args.requestId,
        requestLabel: `skill planner step ${args.state.stepIndex + 1}`,
        onDelta: () => {},
        onLog: (t) => pushLog({ category: "retry", agent: args.agent.name, requestId: args.requestId, stage: `skill planner step ${args.state.stepIndex + 1}`, message: t })
      });

      const terminalFailure = detectTerminalAgentFailure(raw);
      if (terminalFailure) {
        logNow({
          category: "skills",
          agent: args.agent.name,
          ok: false,
          requestId: args.requestId,
          stage: `skill planner step ${args.state.stepIndex + 1}`,
          message: `Skill planner step ${args.state.stepIndex + 1} failed after model retries`,
          details: terminalFailure
        });
        args.onTrace?.(`Planner raw ${args.state.stepIndex + 1}`, [`Raw:\n${raw}`, "", "Normalized: invalid (terminal failure)"].join("\n"));
        return null;
      }

      const decision = normalizeSkillStepDecision(extractJsonObject(raw));
      if (decision) {
        logNow({
          category: "skills",
          agent: args.agent.name,
          ok: true,
          requestId: args.requestId,
          stage: `skill planner step ${args.state.stepIndex + 1}`,
          message: `Skill planner step: ${decision.type}`,
          details: raw
        });
        args.onTrace?.(
          `Planner raw ${args.state.stepIndex + 1}`,
          [`Raw:\n${raw}`, "", `Normalized: ${JSON.stringify(decision, null, 2)}`].join("\n")
        );
        return decision;
      }

      logNow({
        category: "skills",
        agent: args.agent.name,
        ok: false,
        requestId: args.requestId,
        stage: `skill planner step ${args.state.stepIndex + 1}`,
        message: `Skill planner step invalid schema (${attempt + 1}/${args.retry.max + 1})`,
        details: raw
      });
      args.onTrace?.(`Planner raw ${args.state.stepIndex + 1}`, [`Raw:\n${raw}`, "", "Normalized: invalid"].join("\n"));

      if (attempt < args.retry.max) {
        await sleep(args.retry.delaySec * 1000);
      }
    }

    return null;
  }

  async function runSkillCompletionGate(args: {
    agent: AgentConfig;
    adapter: ReturnType<typeof pickAdapter>;
    retry: { delaySec: number; max: number };
    state: SkillRunState;
    skill: SkillConfig;
    runtime: LoadedSkillRuntime;
    userInput: string;
    currentContext: string;
    toolScopeSummary: string;
    promptTemplate?: string;
    requestId?: string;
    onTrace?: (label: string, content: string) => void;
  }): Promise<SkillCompletionDecision | null> {
    const prompt = buildCompletionGatePrompt({
      skill: args.skill,
      runtime: args.runtime,
      userInput: args.userInput,
      currentContext: args.currentContext,
      todoSummary: summarizeTodo(args.state.todo),
      template: args.promptTemplate
    });

    for (let attempt = 0; attempt <= args.retry.max; attempt++) {
      const raw = await runOneToOneWithLoadBalancer({
        logicalAgent: args.agent,
        input: prompt,
        history: [],
        requestId: args.requestId,
        requestLabel: `skill completion gate ${args.state.stepIndex}`,
        onDelta: () => {},
        onLog: (t) => pushLog({ category: "retry", agent: args.agent.name, requestId: args.requestId, stage: `skill completion gate ${args.state.stepIndex}`, message: t })
      });

      const terminalFailure = detectTerminalAgentFailure(raw);
      if (terminalFailure) {
        logNow({
          category: "skills",
          agent: args.agent.name,
          ok: false,
          requestId: args.requestId,
          stage: `skill completion gate ${args.state.stepIndex}`,
          message: `Skill completion gate step ${args.state.stepIndex} failed after model retries`,
          details: terminalFailure
        });
        args.onTrace?.(`Completion raw ${args.state.stepIndex}`, [`Raw:\n${raw}`, "", "Normalized: invalid (terminal failure)"].join("\n"));
        return null;
      }

      const decision = normalizeSkillCompletionDecision(extractJsonObject(raw));
      if (decision) {
        logNow({
          category: "skills",
          agent: args.agent.name,
          ok: true,
          requestId: args.requestId,
          stage: `skill completion gate ${args.state.stepIndex}`,
          message: `Skill completion gate: ${decision.type}`,
          details: raw
        });
        args.onTrace?.(
          `Completion raw ${args.state.stepIndex}`,
          [`Raw:\n${raw}`, "", `Normalized: ${JSON.stringify(decision, null, 2)}`].join("\n")
        );
        return decision;
      }

      logNow({
        category: "skills",
        agent: args.agent.name,
        ok: false,
        requestId: args.requestId,
        stage: `skill completion gate ${args.state.stepIndex}`,
        message: `Skill completion gate invalid schema (${attempt + 1}/${args.retry.max + 1})`,
        details: raw
      });
      args.onTrace?.(`Completion raw ${args.state.stepIndex}`, [`Raw:\n${raw}`, "", "Normalized: invalid"].join("\n"));

      if (attempt < args.retry.max) {
        await sleep(args.retry.delaySec * 1000);
      }
    }

    return null;
  }

  async function resolveToolAugmentedInputDetailed(args: {
    input: string;
    agent: AgentConfig;
    adapter: ReturnType<typeof pickAdapter>;
    availableBuiltinTools: BuiltInToolConfig[];
    availableMcpServers: McpServerConfig[];
    availableMcpTools: Array<{ server: McpServerConfig; tools: McpTool[] }>;
    toolEntries: ToolEntry[];
    decisionContext?: string;
    onStatus?: (text: string) => void;
    promptDetail?: ToolPromptDetailMode;
    requestId?: string;
  }): Promise<ToolAugmentationResult> {
    if (args.toolEntries.length === 0) {
      if (args.availableBuiltinTools.length > 0) {
        logNow({ category: "tool", agent: args.agent.name, requestId: args.requestId, stage: "tool decision", message: "Tool decision skipped: no available tool entries" });
      } else if (args.availableMcpServers.length === 0) {
        return { input: args.input, status: "no_entries", detail: "沒有可用的工具或 MCP server。" };
      } else if (args.availableMcpTools.length === 0) {
        logNow({ category: "mcp", agent: args.agent.name, requestId: args.requestId, stage: "tool decision", message: "Tool decision skipped: no MCP tools loaded yet" });
      }
      return { input: args.input, status: "no_entries", detail: "目前沒有可用的工具項目。" };
    }

    args.onStatus?.("正在判斷是否需要呼叫工具中…");
    const decision = await runToolDecision({
      agent: args.agent,
      adapter: args.adapter,
      userInput: args.decisionContext ? `${args.input}\n\nCurrent loaded skill context (internal only):\n${args.decisionContext}` : args.input,
      retry: getRetryPolicyForAgent(args.agent),
      toolEntries: args.toolEntries,
      promptTemplate: promptTemplateRuntime.resolve("tool-decision", mcpPromptTemplates.activeId).template,
      fallbackPromptTemplate: getDefaultPromptTemplate(`tool-decision.${mcpPromptTemplates.activeId}`),
      requestId: args.requestId
    });

    if (!decision) {
      logNow({ category: "tool", agent: args.agent.name, ok: false, requestId: args.requestId, stage: "tool decision", message: "Tool decision failed after retries; continue without tools" });
      return { input: args.input, status: "decision_failed", detail: "工具判斷在重試後仍失敗，已略過。" };
    }

    const normalizedDecision = normalizeToolDecisionAgainstAvailableTools({
      decision,
      availableBuiltinTools: args.availableBuiltinTools,
      availableMcpServers: args.availableMcpServers,
      availableMcpTools: args.availableMcpTools
    });

    if (decision.type === "mcp_call" && normalizedDecision.type === "builtin_tool_call") {
      logNow({
        category: "tool",
        agent: args.agent.name,
        ok: true,
        requestId: args.requestId,
        stage: "tool decision",
        message: `Tool decision normalized from MCP to built-in: ${decision.tool}`,
        details: JSON.stringify({ original: decision, normalized: normalizedDecision }, null, 2)
      });
    }

    if (normalizedDecision.type === "no_tool") {
      logNow({ category: "tool", agent: args.agent.name, requestId: args.requestId, stage: "tool decision", message: "Tool decision resolved: no_tool" });
      return { input: args.input, status: "no_tool", detail: "模型判斷這一輪不需要工具。" };
    }

    return executeResolvedToolSelection({
      selection: normalizedDecision,
      input: args.input,
      agent: args.agent,
      availableBuiltinTools: args.availableBuiltinTools,
      availableMcpServers: args.availableMcpServers,
      availableMcpTools: args.availableMcpTools,
      onStatus: args.onStatus,
      promptDetail: args.promptDetail ?? "default",
      requestId: args.requestId
    });
  }

  async function executeResolvedToolSelection(args: {
    selection: BuiltInToolAction | McpAction;
    input: string;
    agent: AgentConfig;
    availableBuiltinTools: BuiltInToolConfig[];
    availableMcpServers: McpServerConfig[];
    availableMcpTools: Array<{ server: McpServerConfig; tools: McpTool[] }>;
    onStatus?: (text: string) => void;
    promptDetail: ToolPromptDetailMode;
    requestId?: string;
  }): Promise<ToolAugmentationResult> {
    const normalizedDecision = args.selection;

    if (normalizedDecision.type === "builtin_tool_call") {
      const actionSignature = buildToolActionSignature({
        kind: "builtin",
        toolName: normalizedDecision.tool,
        input: normalizedDecision.input
      });
      args.onStatus?.(`正在呼叫內建工具「${normalizedDecision.tool}」中…`);
      const targetTool = args.availableBuiltinTools.find((tool) => tool.name === normalizedDecision.tool) ?? null;
      if (!targetTool) {
        const toolSummaryForQuestion = `工具執行失敗：找不到名稱為 ${normalizedDecision.tool} 的 built-in tool。`;
        append(msg("tool", toolSummaryForQuestion, "builtin_tool", { displayName: "Built-in Tool" }));
        logNow({
          category: "tool",
          agent: args.agent.name,
          ok: false,
          requestId: args.requestId,
          stage: "tool execution",
          message: `Built-in tool not found: ${normalizedDecision.tool}`,
          details: JSON.stringify(normalizedDecision)
        });
        return {
          input: `${args.input}\n\n請將以下工具資訊一起納入回答：\n${toolSummaryForQuestion}`,
          ok: false,
          status: "tool_called",
          toolLabel: `Built-in ${normalizedDecision.tool}`,
          detail: toolSummaryForQuestion,
          actionSignature
        };
      }

      try {
        const allowed =
          !targetTool.requireConfirmation ||
          window.confirm(
            `允許 agent ${args.agent.name} 執行工具「${targetTool.displayLabel ?? targetTool.name}」嗎？\n\ninput:\n${stringifyAny(normalizedDecision.input ?? {})}`
          );

        if (!allowed) {
          const toolSummaryForQuestion = `工具執行已被使用者阻止：${normalizedDecision.tool}`;
          append(msg("tool", toolSummaryForQuestion, "builtin_tool", { displayName: "Built-in Tool" }));
          logNow({
            category: "tool",
            agent: args.agent.name,
            ok: false,
            requestId: args.requestId,
            stage: "tool execution",
            message: `Built-in tool blocked by user: ${normalizedDecision.tool}`,
            details: stringifyAny(normalizedDecision.input ?? {})
          });
          return {
            input: `${args.input}\n\n請將以下工具資訊一起納入回答：\n${toolSummaryForQuestion}`,
            ok: false,
            status: "tool_called",
            toolLabel: `Built-in ${normalizedDecision.tool}`,
            detail: toolSummaryForQuestion,
            actionSignature
          };
        }

        const allowedSystemHelpers: NonNullable<Parameters<typeof runBuiltInScriptTool>[2]>["system"] = {};
        if (args.availableBuiltinTools.some((tool) => tool.id === SYSTEM_USER_PROFILE_TOOL_ID)) {
          allowedSystemHelpers.get_user_profile = () => getUserProfileToolPayload(userProfile);
        }
        if (args.availableBuiltinTools.some((tool) => tool.id === SYSTEM_AGENT_DIRECTORY_TOOL_ID)) {
          allowedSystemHelpers.pick_best_agent_for_question = async (question: string) =>
            pickBestAgentNameForQuestion(question, loadSavedAgentsFromStorage(), args.agent.name);
        }
        if (args.availableBuiltinTools.some((tool) => tool.id === SYSTEM_REQUEST_CONFIRMATION_TOOL_ID)) {
          allowedSystemHelpers.request_user_confirmation = async (message: string) => {
            const confirmed = window.confirm(String(message ?? "").trim() || "是否繼續？");
            return { confirmed };
          };
        }

        const toolOutput = await runBuiltInScriptTool(targetTool, normalizedDecision.input ?? {}, {
          system: allowedSystemHelpers,
          ui: {
            dashboard: createToolDashboardHelpers()
          }
        });
        const toolIntent = classifyBuiltInToolIntent(targetTool);
        const toolOutputText = stringifyAny(toolOutput);
        const browserObservation = extractBrowserObservation({
          toolName: normalizedDecision.tool,
          output: toolOutput
        });
        const toolSummaryForQuestion = buildToolResultPromptBlock({
          kind: "builtin",
          toolName: normalizedDecision.tool,
          input: normalizedDecision.input ?? {},
          output: toolOutput
        }, args.promptDetail ?? "default");
        append(
          msg(
            "tool",
            `Built-in tool -> ${normalizedDecision.tool}\ninput:\n${stringifyAny(normalizedDecision.input ?? {})}\noutput:\n${toolOutputText}`,
            "builtin_tool",
            { displayName: "Built-in Tool" }
          )
        );
        logNow({
          category: "tool",
          agent: args.agent.name,
          ok: true,
          requestId: args.requestId,
          stage: "tool execution",
          message: `Built-in tool call OK: ${normalizedDecision.tool}`,
          details: toolOutputText
        });
        return {
          input: appendToolPromptSummary(args.input, toolSummaryForQuestion),
          ok: true,
          status: "tool_called",
          toolLabel: `Built-in ${normalizedDecision.tool}`,
          detail: toolSummaryForQuestion,
          actionSignature,
          toolIntent,
          observationSignature: toolIntent === "observe" ? buildObservationSignature(toolOutput) : undefined,
          decisionSummary: `builtin:${normalizedDecision.tool}\ninput:\n${stringifyAny(normalizedDecision.input ?? {})}`,
          toolOutput,
          browserObservation
        };
      } catch (e: any) {
        const briefError = String(e?.message ?? e);
        const toolSummaryForQuestion = `工具執行失敗：${normalizedDecision.tool} 執行失敗（${briefError}）。`;
        append(msg("tool", toolSummaryForQuestion, "builtin_tool", { displayName: "Built-in Tool" }));
        logNow({
          category: "tool",
          agent: args.agent.name,
          ok: false,
          requestId: args.requestId,
          stage: "tool execution",
          message: `Built-in tool call failed: ${normalizedDecision.tool}`,
          details: briefError
        });
        return {
          input: `${args.input}\n\n請將以下工具資訊一起納入回答：\n${toolSummaryForQuestion}`,
          ok: false,
          status: "tool_called",
          toolLabel: `Built-in ${normalizedDecision.tool}`,
          detail: toolSummaryForQuestion,
          actionSignature
        };
      }
    }

    const actionSignature = buildToolActionSignature({
      kind: "mcp",
      serverId: normalizedDecision.serverId,
      toolName: normalizedDecision.tool,
      input: normalizedDecision.input
    });
    const targetServer = args.availableMcpServers.find((server) => server.id === normalizedDecision.serverId) ?? null;
    const targetTool =
      args.availableMcpTools.find((entry) => entry.server.id === normalizedDecision.serverId)?.tools.find((tool) => tool.name === normalizedDecision.tool) ?? null;
    let toolSummaryForQuestion = "";
    args.onStatus?.(`正在呼叫 MCP 工具「${normalizedDecision.tool}」中…`);

    if (!targetServer) {
      toolSummaryForQuestion = `工具執行失敗：找不到 serverId=${normalizedDecision.serverId} 的可用 MCP server。`;
      logNow({
        category: "mcp",
        agent: args.agent.name,
        ok: false,
        requestId: args.requestId,
        stage: "tool execution",
        message: `Tool decision selected unavailable server: ${normalizedDecision.serverId}`,
        details: JSON.stringify(normalizedDecision)
      });
      append(msg("tool", toolSummaryForQuestion, "mcp", { displayName: "MCP Tool" }));
    } else if (!targetTool) {
      toolSummaryForQuestion = `工具執行失敗：${targetServer.name} 沒有 ${normalizedDecision.tool} 這個工具。`;
      logNow({
        category: "mcp",
        agent: args.agent.name,
        ok: false,
        requestId: args.requestId,
        stage: "tool execution",
        message: `Tool decision selected unavailable tool: ${normalizedDecision.tool}`,
        details: JSON.stringify(normalizedDecision)
      });
      append(msg("tool", toolSummaryForQuestion, "mcp", { displayName: "MCP Tool" }));
    } else {
      const client = new McpSseClient(targetServer);
      client.connect((t) => pushLog({ category: "mcp", agent: targetServer.name, requestId: args.requestId, stage: "tool execution", message: t }));
      try {
        const timeoutMs = getMcpToolTimeoutMs(targetServer, normalizedDecision.tool);
        const toolOutput = await callMcpToolWithTimeout(client, normalizedDecision.tool, normalizedDecision.input ?? {}, timeoutMs);
        const toolIntent = classifyMcpToolIntent(targetTool);
        const toolOutputText = stringifyAny(toolOutput);
        const browserObservation = extractBrowserObservation({
          toolName: normalizedDecision.tool,
          output: toolOutput
        });
        toolSummaryForQuestion = buildToolResultPromptBlock({
          kind: "mcp",
          serverName: targetServer.name,
          toolName: normalizedDecision.tool,
          input: normalizedDecision.input ?? {},
          output: toolOutput
        }, args.promptDetail ?? "default");
        logNow({
          category: "mcp",
          agent: targetServer.name,
          ok: true,
          requestId: args.requestId,
          stage: "tool execution",
          message: `MCP tool call OK: ${normalizedDecision.tool}`,
          details: toolOutputText
        });
        append(
          msg(
            "tool",
            `MCP ${targetServer.name} -> ${normalizedDecision.tool}\ninput:\n${stringifyAny(normalizedDecision.input ?? {})}\noutput:\n${toolOutputText}`,
            "mcp",
            { displayName: "MCP Tool" }
          )
        );
        return {
          input: appendToolPromptSummary(args.input, toolSummaryForQuestion),
          ok: true,
          status: "tool_called",
          toolLabel: `MCP ${targetServer?.name ?? normalizedDecision.serverId ?? "unknown"} -> ${normalizedDecision.tool}`,
          detail: toolSummaryForQuestion,
          actionSignature,
          toolIntent,
          observationSignature: toolIntent === "observe" ? buildObservationSignature(toolOutput) : undefined,
          decisionSummary: `mcp:${targetServer?.name ?? normalizedDecision.serverId ?? "unknown"}/${normalizedDecision.tool}\ninput:\n${stringifyAny(normalizedDecision.input ?? {})}`,
          toolOutput,
          browserObservation,
          serverId: targetServer.id
        };
      } catch (e: any) {
        const briefError = String(e?.message ?? e);
        toolSummaryForQuestion = `工具執行失敗：${normalizedDecision.tool} 呼叫失敗（${briefError}）。`;
        append(msg("tool", toolSummaryForQuestion, "mcp", { displayName: "MCP Tool" }));
        logNow({
          category: "mcp",
          agent: targetServer.name,
          ok: false,
          requestId: args.requestId,
          stage: "tool execution",
          message: `Tool call failed: ${normalizedDecision.tool}`,
          details: briefError
        });
      } finally {
        client.close();
      }
    }

    return toolSummaryForQuestion
      ? {
          input: appendToolPromptSummary(args.input, toolSummaryForQuestion),
          ok: false,
          status: "tool_called",
          toolLabel: `MCP ${targetServer?.name ?? normalizedDecision.serverId ?? "unknown"} -> ${normalizedDecision.tool}`,
          detail: toolSummaryForQuestion,
          actionSignature
        }
      : { input: args.input, ok: false, status: "no_tool", detail: "沒有產生可回填的工具摘要。" };
  }

  async function prepareSkillExecution(args: {
    skill: SkillConfig;
    skillInput: any;
    userInput: string;
    agent: AgentConfig;
    adapter: ReturnType<typeof pickAdapter>;
    availableBuiltinTools: BuiltInToolConfig[];
    availableMcpServers: McpServerConfig[];
    availableMcpTools: Array<{ server: McpServerConfig; tools: McpTool[] }>;
    deferToolDecision?: boolean;
    onStatus?: (text: string) => void;
    requestId?: string;
  }): Promise<PreparedSkillExecution> {
    args.onStatus?.(`正在載入 skill「${args.skill.name}」中…`);
    const loaded = loadSkillRuntime({
      skill: args.skill,
      skillDocs: args.skill.workflow.useSkillDocs !== false ? await listSkillDocs(args.skill.id) : [],
      skillFiles: await listSkillFiles(args.skill.id),
      agentDocs: docsForAgent,
      availableMcpServers: args.availableMcpServers,
      availableMcpTools: args.availableMcpTools,
      availableBuiltinTools: args.availableBuiltinTools,
      userInput: args.userInput,
      skillInput: args.skillInput,
      systemPromptTemplate: promptTemplateRuntime.resolve("skill-runtime-system", mcpPromptTemplates.activeId).template
    });

    const scopedMcpServers = loaded.runtime.allowMcp
      ? loaded.runtime.allowedMcpServerIds?.length
        ? args.availableMcpServers.filter((server) => loaded.runtime.allowedMcpServerIds?.includes(server.id))
        : args.availableMcpServers
      : [];

    const scopedMcpTools = loaded.runtime.allowMcp
      ? args.availableMcpTools.filter((entry) => scopedMcpServers.some((server) => server.id === entry.server.id))
      : [];

    const scopedBuiltInTools = loaded.runtime.allowBuiltInTools
      ? loaded.runtime.allowedBuiltInToolIds?.length
        ? args.availableBuiltinTools.filter((tool) => loaded.runtime.allowedBuiltInToolIds?.includes(tool.id))
        : args.availableBuiltinTools
      : [];

    const scopedToolEntries: ToolEntry[] = [
      ...scopedMcpTools.flatMap(({ server, tools }) => tools.map((tool) => ({ kind: "mcp" as const, server, tool }))),
      ...scopedBuiltInTools.map((tool) => ({ kind: "builtin" as const, tool }))
    ];

    const decisionContext = buildCompactSkillDecisionContext({
      instructions: loaded.runtime.instructions,
      references: loaded.runtime.loadedReferences,
      assets: loaded.runtime.loadedAssets
    });

    let toolAugmentation: ToolAugmentationResult | null = null;
    const finalInput = args.deferToolDecision
      ? loaded.finalInput
      : await (async () => {
          const result = await resolveToolAugmentedInputDetailed({
            input: loaded.finalInput,
            agent: args.agent,
            adapter: args.adapter,
            availableBuiltinTools: scopedBuiltInTools,
            availableMcpServers: scopedMcpServers,
            availableMcpTools: scopedMcpTools,
            toolEntries: scopedToolEntries,
            decisionContext,
            onStatus: args.onStatus,
            requestId: args.requestId
          });
          toolAugmentation = result.status === "tool_called" ? result : null;
          return result.input;
        })();

    return {
      baseInput: loaded.finalInput,
      finalInput,
      toolAugmentation,
      system: loaded.system,
      trace: loaded.trace,
      runtime: loaded.runtime,
      scopedBuiltInTools,
      scopedMcpServers,
      scopedMcpTools,
      decisionContext
    };
  }

  async function executeMultiTurnSkill(args: {
    initialTrace: ChatTraceEntry[];
    prepared: PreparedSkillExecution;
    skill: SkillConfig;
    agent: AgentConfig;
    adapter: ReturnType<typeof pickAdapter>;
    userInput: string;
    assistantMessageId: string;
    onStatus?: (text: string) => void;
    requestId?: string;
  }): Promise<{ finalInput: string; trace: ChatTraceEntry[]; todo: SkillTodoItem[]; phase: SkillPhase; finalAnswerOverride?: string }> {
    const verifierAgent = resolveSkillVerifierAgent(args.agent);
    const verifierAdapter = pickAdapter(verifierAgent);
    const scopedToolEntries: ToolEntry[] = [
      ...args.prepared.scopedMcpTools.flatMap(({ server, tools }) => tools.map((tool) => ({ kind: "mcp" as const, server, tool }))),
      ...args.prepared.scopedBuiltInTools.map((tool) => ({ kind: "builtin" as const, tool }))
    ];

    const updateAssistantProgress = (todo: SkillTodoItem[], phase: SkillPhase, trace?: ChatTraceEntry[]) => {
      const patch: Partial<ChatMessage> = {
        skillGoal: args.userInput,
        skillTodo: todo.length ? todo : undefined,
        skillPhase: phase,
        statusText: formatSkillPhaseStatus(phase),
        isStreaming: true,
        hideWhileStreaming: false
      };
      if (trace) {
        patch.skillTrace = trace.length ? trace : undefined;
      }
      patchMessage(args.assistantMessageId, patch);
    };

    let bootstrapPlanMeta: SkillBootstrapPlan | null = null;

    const resolveMcpServerId = (toolName: string, preferredServerId?: string | null) => {
      const matches = args.prepared.scopedMcpTools
        .flatMap((entry) => entry.tools.map((tool) => ({ server: entry.server, tool })))
        .filter((entry) => entry.tool.name === toolName);
      if (!matches.length) return null;
      if (preferredServerId) {
        const preferred = matches.find((entry) => entry.server.id === preferredServerId);
        if (preferred) return preferred.server.id;
      }
      return matches[0]?.server.id ?? null;
    };

    const chooseObservationSelection = (preferredServerId?: string | null): BuiltInToolAction | McpAction | null => {
      const observeScope = filterPreparedToolScopeByIntent(args.prepared, new Set<ToolIntent>(["observe"]));
      const ranked = observeScope.toolEntries
        .map((entry) => {
          const name = entry.kind === "mcp" ? entry.tool.name : entry.tool.name;
          const description = entry.kind === "mcp" ? entry.tool.description ?? "" : entry.tool.description ?? "";
          const haystack = `${name} ${description}`.toLowerCase();
          let score = 0;
          if (haystack.includes("snapshot")) score += 100;
          if (haystack.includes("get text") || haystack.includes("get_text") || haystack.includes("content") || haystack.includes("read")) score += 80;
          if (haystack.includes("url") || haystack.includes("status") || haystack.includes("state")) score += 60;
          if (haystack.includes("list") || haystack.includes("query") || haystack.includes("inspect")) score += 40;
          if (haystack.includes("screenshot")) score += 20;
          if (entry.kind === "mcp") score += 10;
          if (preferredServerId && entry.kind === "mcp" && entry.server.id === preferredServerId) score += 500;
          return { entry, score };
        })
        .sort((a, b) => b.score - a.score);

      const candidate = ranked[0]?.entry;
      if (!candidate) return null;

      if (candidate.kind === "builtin") {
        return {
          type: "builtin_tool_call",
          tool: candidate.tool.name,
          input: {}
        };
      }

      return {
        type: "mcp_call",
        serverId: candidate.server.id,
        tool: candidate.tool.name,
        input: {}
      };
    };

    const buildSelectionForDecision = (
      decision: Extract<SkillStepDecision, { type: "act" }>,
      preferredServerId?: string | null
    ): BuiltInToolAction | McpAction | null => {
      if (decision.toolKind === "builtin") {
        const tool = args.prepared.scopedBuiltInTools.find((item) => item.name === decision.toolName);
        return tool ? { type: "builtin_tool_call", tool: tool.name, input: decision.input ?? {} } : null;
      }
      const serverId = resolveMcpServerId(decision.toolName, preferredServerId);
      return serverId ? { type: "mcp_call", serverId, tool: decision.toolName, input: decision.input ?? {} } : null;
    };

    const convertToolDecisionToSkillStep = (
      selection: BuiltInToolAction | McpAction | { type: "no_tool" } | null,
      reason: string
    ): SkillStepDecision | null => {
      if (!selection || selection.type === "no_tool") return null;
      if (selection.type === "builtin_tool_call") {
        const requestConfirmationTool =
          args.prepared.scopedBuiltInTools.find((tool) => tool.id === SYSTEM_REQUEST_CONFIRMATION_TOOL_ID) ??
          SYSTEM_BUILT_IN_TOOLS.find((tool) => tool.id === SYSTEM_REQUEST_CONFIRMATION_TOOL_ID) ??
          null;
        if (requestConfirmationTool && selection.tool === requestConfirmationTool.name) {
          const message = String(selection.input?.message ?? reason).trim() || reason;
          return {
            type: "ask_user",
            reason,
            message
          };
        }
        return {
          type: "act",
          reason,
          toolKind: "builtin",
          toolName: selection.tool,
          input: selection.input ?? {}
        };
      }
      return {
        type: "act",
        reason,
        toolKind: "mcp",
        toolName: selection.tool,
        input: selection.input ?? {}
      };
    };

    async function runRuntimePass(initialInput: string, initialTrace: ChatTraceEntry[]) {
      return await runMultiTurnSkillRuntime({
        skill: args.skill,
        runtime: args.prepared.runtime,
        userInput: args.userInput,
        initialInput,
        initialTrace,
        toolLoopMax: skillToolLoopMax,
        callbacks: {
          onStatus: args.onStatus,
          onStateChange: (state) => updateAssistantProgress(state.todo, state.phase),
          buildToolScopeSummary: () => ({
            summary: formatToolScopeSummary(scopedToolEntries),
            toolCount: scopedToolEntries.length
          }),
          bootstrapPlan: async () => {
            const bootstrap = await runSkillBootstrapPlan({
              agent: args.agent,
              adapter: args.adapter,
              retry: getRetryPolicyForAgent(args.agent),
              skill: args.skill,
              runtime: args.prepared.runtime,
              userInput: args.userInput,
              promptTemplate: promptTemplateRuntime.resolve("skill-bootstrap-plan", mcpPromptTemplates.activeId).template,
              requestId: args.requestId,
              onTrace: (label, content) => {
                pushSkillTrace(trace, label, content);
                updateAssistantProgress(bootstrapPlanMeta?.todo?.length ? bootstrapTodoList(bootstrapPlanMeta.todo) : [], "bootstrap_plan", trace);
              }
            });
            bootstrapPlanMeta = bootstrap;
            return bootstrapTodoList(bootstrap.todo);
          },
          decideNextStep: async ({ state, currentContext, toolScopeSummary, mustObserve, mustAct, phaseHint }) => {
            pushSkillTrace(
              trace,
              `Runtime snapshot ${state.stepIndex + 1}`,
              [
                `phase=${state.phase}`,
                `mustObserve=${mustObserve}`,
                `mustAct=${mustAct}`,
                `manualGate=${state.manualGate}`,
                `completionStatus=${state.completionStatus}`,
                state.preferredMcpServerId ? `preferredMcpServerId=${state.preferredMcpServerId}` : "",
                state.latestReason ? `latestReason=${state.latestReason}` : "",
                state.recentActionSignatures.length ? `recentActionSignatures=${state.recentActionSignatures.join(" | ")}` : "",
                state.recentObservationSignatures.length ? `recentObservationSignatures=${state.recentObservationSignatures.join(" | ")}` : "",
                state.lastBrowserObservation ? `lastBrowserObservation:\n${formatBrowserObservationDigest(state.lastBrowserObservation)}` : "",
                bootstrapPlanMeta?.taskSummary ? `taskSummary=${bootstrapPlanMeta.taskSummary}` : "",
                bootstrapPlanMeta?.startUrl ? `startUrl=${bootstrapPlanMeta.startUrl}` : "",
                phaseHint ? `phaseHint=${phaseHint}` : "",
                `currentContext:\n${String(currentContext ?? "").slice(0, 2200)}`
              ]
                .filter(Boolean)
                .join("\n")
            );

            if (mustObserve) {
              return {
                type: "observe",
                reason: phaseHint?.trim() || "Runtime requires an observation step immediately after a state-changing action."
              };
            }

            const heuristicDecision = buildBrowserHeuristicDecision({
              state,
              userInput: args.userInput,
              resolveMcpServerId: (toolName) => resolveMcpServerId(toolName, state.preferredMcpServerId)
            });
            if (heuristicDecision) {
              pushSkillTrace(
                trace,
                `Heuristic step ${state.stepIndex + 1}`,
                [
                  `Decision: ${heuristicDecision.type}`,
                  `Reason: ${heuristicDecision.reason}`,
                  state.lastBrowserObservation ? `Observation:\n${formatBrowserObservationDigest(state.lastBrowserObservation)}` : ""
                ]
                  .filter(Boolean)
                  .join("\n")
              );
              return heuristicDecision;
            }

            const fastPathScope = mustAct
              ? filterPreparedToolScopeByIntent(args.prepared, new Set<ToolIntent>(["state_change", "control"]))
              : { toolEntries: scopedToolEntries, scopedBuiltInTools: args.prepared.scopedBuiltInTools, scopedMcpTools: args.prepared.scopedMcpTools };

            const shouldUseFastToolDecision =
              fastPathScope.toolEntries.length > 0 &&
              ((state.stepIndex === 0 && state.recentActionSignatures.length === 0 && state.recentObservationSignatures.length === 0) || mustAct);

            if (
              state.stepIndex === 0 &&
              !mustAct &&
              args.prepared.runtime.bootstrapAction &&
              fastPathScope.toolEntries.length > 0
            ) {
              const bootstrap = args.prepared.runtime.bootstrapAction;
              const toolExists =
                bootstrap.toolKind === "builtin"
                  ? fastPathScope.scopedBuiltInTools.some((tool) => tool.name === bootstrap.toolName)
                  : fastPathScope.scopedMcpTools.some((entry) => entry.tools.some((tool) => tool.name === bootstrap.toolName));
              if (toolExists) {
                return {
                  type: "act",
                  reason: bootstrap.reason ?? "Use the skill bootstrap action to begin the multi-turn workflow.",
                  toolKind: bootstrap.toolKind,
                  toolName: bootstrap.toolName,
                  input: bootstrap.input ?? {}
                };
              }
            }

            if (state.stepIndex === 0 && !mustAct && bootstrapPlanMeta?.startUrl && fastPathScope.toolEntries.length > 0) {
              const browserOpenServerId = resolveMcpServerId("browser_open", state.preferredMcpServerId);
              if (browserOpenServerId) {
                const normalizedStartUrl = normalizeBrowserWorkflowStartUrl(args.userInput, bootstrapPlanMeta.startUrl);
                return {
                  type: "act",
                  reason:
                    bootstrapPlanMeta.taskSummary?.trim() ||
                    "Use the bootstrap plan start URL to begin the browser workflow with the most direct stable page.",
                  toolKind: "mcp",
                  toolName: "browser_open",
                  input: {
                    url: normalizedStartUrl,
                    headed: resolvePreferredBrowserHeadedMode(args.userInput)
                  }
                };
              }
            }

            if (shouldUseFastToolDecision) {
              const fastReason =
                state.stepIndex === 0
                  ? "Initial multi-turn step should start with a concrete tool action when tools are available."
                  : "Repeated observation did not advance the workflow, so choose a concrete action or ask_user.";
              const fastPrompt = [
                stripPreviousToolPromptSummaries(currentContext),
                state.stepIndex === 0
                  ? "Internal runtime request: choose the first concrete tool step for this multi-turn workflow."
                  : "Internal runtime request: repeated observation did not advance the workflow. Choose one concrete action or ask_user. Do not choose observe."
              ]
                .filter(Boolean)
                .join("\n\n");

              const fastDecision = await runToolDecision({
                agent: args.agent,
                adapter: args.adapter,
                userInput: args.prepared.decisionContext ? `${fastPrompt}\n\nCurrent loaded skill context (internal only):\n${args.prepared.decisionContext}` : fastPrompt,
                retry: getRetryPolicyForAgent(args.agent),
                toolEntries: fastPathScope.toolEntries,
                promptTemplate: promptTemplateRuntime.resolve("tool-decision", mcpPromptTemplates.activeId).template,
                fallbackPromptTemplate: getDefaultPromptTemplate(`tool-decision.${mcpPromptTemplates.activeId}`)
              });

              if (fastDecision) {
                const normalizedFastDecision = normalizeToolDecisionAgainstAvailableTools({
                  decision: fastDecision,
                  availableBuiltinTools: fastPathScope.scopedBuiltInTools,
                  availableMcpServers: args.prepared.scopedMcpServers,
                  availableMcpTools: fastPathScope.scopedMcpTools
                });
                const stepDecision = convertToolDecisionToSkillStep(normalizedFastDecision, fastReason);
                if (stepDecision) {
                  return stepDecision;
                }
              }
            }

            return await runSkillStepPlanner({
              agent: args.agent,
              adapter: args.adapter,
              retry: getRetryPolicyForAgent(args.agent),
              state,
              skill: args.skill,
              runtime: args.prepared.runtime,
              userInput: args.userInput,
              currentContext,
              toolScopeSummary,
              mustObserve,
              mustAct,
              phaseHint,
              promptTemplate: promptTemplateRuntime.resolve("skill-planner-step", mcpPromptTemplates.activeId).template,
              requestId: args.requestId,
              onTrace: (label, content) => {
                pushSkillTrace(trace, label, content);
                updateAssistantProgress(state.todo, "plan_next_step", trace);
              }
            });
          },
          runObservation: async ({ state, currentContext }) => {
            const selection = chooseObservationSelection(state.preferredMcpServerId);
            if (!selection) {
              return {
                context: currentContext,
                detail: "目前沒有可用的 observation 工具。"
              };
            }
            const result = await executeResolvedToolSelection({
              selection,
              input: currentContext,
              agent: args.agent,
              availableBuiltinTools: args.prepared.scopedBuiltInTools,
              availableMcpServers: args.prepared.scopedMcpServers,
              availableMcpTools: args.prepared.scopedMcpTools,
              onStatus: args.onStatus,
              promptDetail: "actionable"
            });

            return {
              context: result.input,
              failed: result.ok === false,
              detail: result.browserObservation
                ? [result.detail, formatBrowserObservationDigest(result.browserObservation)].filter(Boolean).join("\n\n")
                : result.detail,
              observationSignature: result.observationSignature,
              actionSignature: result.actionSignature,
              browserObservation: result.browserObservation,
              preferredMcpServerId: result.serverId
            };
          },
          runAction: async ({ decision, state, currentContext }) => {
            const selection = buildSelectionForDecision(decision, state.preferredMcpServerId);
            if (!selection) {
              const detail = `找不到可用工具：${decision.toolKind}/${decision.toolName}`;
              return {
                context: appendToolPromptSummary(currentContext, detail),
                detail,
                toolLabel: `${decision.toolKind}:${decision.toolName}`
              };
            }

            const result = await executeResolvedToolSelection({
              selection,
              input: currentContext,
              agent: args.agent,
              availableBuiltinTools: args.prepared.scopedBuiltInTools,
              availableMcpServers: args.prepared.scopedMcpServers,
              availableMcpTools: args.prepared.scopedMcpTools,
              onStatus: args.onStatus,
              promptDetail: "actionable"
            });

            const enrichedBrowserObservation = enrichActionBrowserObservation({
              state,
              decision,
              browserObservation: result.browserObservation
            });

            return {
              context: result.input,
              failed: result.ok === false,
              detail: enrichedBrowserObservation
                ? [result.detail, formatBrowserObservationDigest(enrichedBrowserObservation)].filter(Boolean).join("\n\n")
                : result.detail,
              toolLabel: result.toolLabel,
              actionSignature: result.actionSignature,
              observationSignature: result.observationSignature,
              confirmed: typeof result.toolOutput?.confirmed === "boolean" ? result.toolOutput.confirmed : null,
              browserObservation: enrichedBrowserObservation,
              preferredMcpServerId: result.serverId
            };
          },
          runManualGate: async ({ decision, currentContext }) => {
            const requestTool =
              args.prepared.scopedBuiltInTools.find((tool) => tool.id === SYSTEM_REQUEST_CONFIRMATION_TOOL_ID) ??
              SYSTEM_BUILT_IN_TOOLS.find((tool) => tool.id === SYSTEM_REQUEST_CONFIRMATION_TOOL_ID) ??
              null;
            if (!requestTool) {
              return {
                context: currentContext,
                detail: decision.message,
                confirmed: false
              };
            }

            const manualResult = await executeResolvedToolSelection({
              selection: {
                type: "builtin_tool_call",
                tool: requestTool.name,
                input: { message: decision.message }
              },
              input: currentContext,
              agent: args.agent,
              availableBuiltinTools: args.prepared.scopedBuiltInTools.some((tool) => tool.id === SYSTEM_REQUEST_CONFIRMATION_TOOL_ID)
                ? args.prepared.scopedBuiltInTools
                : [...args.prepared.scopedBuiltInTools, requestTool],
              availableMcpServers: args.prepared.scopedMcpServers,
              availableMcpTools: args.prepared.scopedMcpTools,
              onStatus: args.onStatus,
              promptDetail: "actionable"
            });

            return {
              context: manualResult.input,
              failed: manualResult.ok === false,
              detail: manualResult.detail ?? decision.message,
              toolLabel: manualResult.toolLabel,
              actionSignature: manualResult.actionSignature,
              confirmed: typeof manualResult.toolOutput?.confirmed === "boolean" ? manualResult.toolOutput.confirmed : null,
              browserObservation: manualResult.browserObservation,
              preferredMcpServerId: manualResult.serverId
            };
          },
          checkCompletion: async ({ state, currentContext, toolScopeSummary }) =>
            {
              if (
                goalWantsRepoSummary(args.userInput) &&
                state.lastBrowserObservation?.pageKind === "repo_page" &&
                !hasGroundedRepoSummary(state.lastBrowserObservation)
              ) {
                pushSkillTrace(
                  trace,
                  `Heuristic completion ${state.stepIndex}`,
                  [
                    "Decision: incomplete",
                    "Reason: Reached repository page, but grounded repo summary fields are still insufficient.",
                    "Suggested focus: Read visible README or repo description before finishing.",
                    state.lastBrowserObservation ? `Observation:\n${formatBrowserObservationDigest(state.lastBrowserObservation)}` : ""
                  ]
                    .filter(Boolean)
                    .join("\n")
                );
                return {
                  type: "incomplete" as const,
                  reason: "已到達 repository 頁面，但還沒有足夠的 grounded 內容可直接整理摘要。",
                  suggestedFocus: "請優先讀取目前頁面可見的 README 或 repo 描述，再決定是否完成。"
                };
              }
              const heuristicCompletion = buildBrowserHeuristicCompletion({
                state,
                userInput: args.userInput
              });
              if (heuristicCompletion) {
                pushSkillTrace(
                  trace,
                  `Heuristic completion ${state.stepIndex}`,
                  [
                    `Decision: ${heuristicCompletion.type}`,
                    heuristicCompletion.reason ? `Reason: ${heuristicCompletion.reason}` : "",
                    state.lastBrowserObservation ? `Observation:\n${formatBrowserObservationDigest(state.lastBrowserObservation)}` : ""
                  ]
                    .filter(Boolean)
                    .join("\n")
                );
                return heuristicCompletion;
              }
              return await runSkillCompletionGate({
                agent: args.agent,
                adapter: args.adapter,
                retry: getRetryPolicyForAgent(args.agent),
                state,
                skill: args.skill,
                runtime: args.prepared.runtime,
                userInput: args.userInput,
                currentContext,
                toolScopeSummary,
                promptTemplate: promptTemplateRuntime.resolve("skill-completion-gate", mcpPromptTemplates.activeId).template,
                requestId: args.requestId,
                onTrace: (label, content) => {
                  pushSkillTrace(trace, label, content);
                  updateAssistantProgress(state.todo, "completion_gate", trace);
                }
              });
            }
        }
      });
    }

    let trace = [...args.initialTrace];
    pushSkillExecutionModeTrace(trace, {
      mode: "multi_turn",
      verifyMax: skillVerifyMax,
      toolLoopMax: skillToolLoopMax,
      verifierName: verifierAgent.name
    });
    updateAssistantProgress([], "skill_load", trace);

    args.onStatus?.("正在依 skill 規劃多步工具流程中…");
    let runtimeResult = await runRuntimePass(args.prepared.finalInput, trace);
    trace = runtimeResult.trace;
    updateAssistantProgress(runtimeResult.todo, runtimeResult.phase, trace);

    let currentInput = runtimeResult.finalInput;
    let currentTodo = runtimeResult.todo;
    let currentPhase = runtimeResult.phase;

    if (runtimeResult.finalAnswerOverride) {
      pushSkillTrace(trace, "Final answer", "已由 multi-turn runtime 直接產生 blocked/manual summary。");
      currentPhase = "final_answer";
      updateAssistantProgress(currentTodo, currentPhase, trace);
      return {
        finalInput: currentInput,
        trace,
        todo: currentTodo,
        phase: currentPhase,
        finalAnswerOverride: runtimeResult.finalAnswerOverride
      };
    }

    const groundedHeuristicAnswer = buildGroundedRepoSummaryAnswer(runtimeResult.lastBrowserObservation);
    if (groundedHeuristicAnswer && goalWantsRepoSummary(args.userInput)) {
      pushSkillTrace(trace, "Final answer", "已由 grounded browser observation 直接產生最終摘要，避免 LLM 脫離實際頁面內容。");
      currentPhase = "final_answer";
      updateAssistantProgress(currentTodo, currentPhase, trace);
      return {
        finalInput: currentInput,
        trace,
        todo: currentTodo,
        phase: currentPhase,
        finalAnswerOverride: groundedHeuristicAnswer
      };
    }

    args.onStatus?.("正在依 skill 產生初版回答中…");
    let currentAnswer = await runOneToOneWithLoadBalancer({
      logicalAgent: args.agent,
      input: currentInput,
      history: limitHistory(history),
      system: args.prepared.system,
      requestId: args.requestId,
      requestLabel: "skill final answer round 1",
      onDelta: () => {},
      onLog: (t) => pushLog({ category: "retry", agent: args.agent.name, requestId: args.requestId, stage: "skill final answer round 1", message: t })
    });

    const firstAnswerFailure = detectTerminalAgentFailure(currentAnswer);
    if (firstAnswerFailure) {
      pushSkillTrace(trace, "Final answer", `最終回答模型呼叫失敗，已直接回傳錯誤內容。\n${firstAnswerFailure}`);
      return {
        finalInput: currentInput,
        trace,
        todo: currentTodo,
        phase: "final_answer",
        finalAnswerOverride: buildAgentFailureContent(firstAnswerFailure, args.userInput)
      };
    }

    pushSkillTrace(trace, "Skill answer round 1", currentAnswer);
    currentPhase = "final_answer";
    updateAssistantProgress(currentTodo, currentPhase, trace);

    if (skillVerifyMax === 0) {
      pushSkillTrace(trace, "Verify/refine", "已設定 verify 次數為 0，略過 refine。");
      return { finalInput: currentInput, trace, todo: currentTodo, phase: currentPhase };
    }

    for (let round = 1; round <= skillVerifyMax; round++) {
      updateAssistantProgress(currentTodo, "verify_refine", trace);
      args.onStatus?.(`正在進行 skill verify 第 ${round} 輪…`);
      const verifyDecision = await runSkillVerifyDecision({
        answeringAgent: args.agent,
        verifierAgent,
        adapter: verifierAdapter,
        userInput: args.userInput,
        currentInput,
        answer: currentAnswer,
        skill: args.skill,
        runtime: args.prepared.runtime,
        round,
        retry: getRetryPolicyForAgent(verifierAgent),
        promptTemplate: promptTemplateRuntime.resolve("skill-verify", mcpPromptTemplates.activeId).template,
        requestId: args.requestId
      });

      if (!verifyDecision) {
        pushSkillTrace(trace, `Verify/refine`, `第 ${round} 輪 verifier 未回傳合法 JSON，停止 refine。`);
        break;
      }

      if (verifyDecision.type === "pass") {
        pushSkillTrace(
          trace,
          "Verify/refine",
          [`第 ${round} 輪結果：通過`, verifyDecision.reason ? `原因：${verifyDecision.reason}` : ""].filter(Boolean).join("\n")
        );
        currentPhase = "final_answer";
        updateAssistantProgress(currentTodo, currentPhase, trace);
        return { finalInput: currentInput, trace, todo: currentTodo, phase: currentPhase };
      }

      pushSkillTrace(
        trace,
        "Verify/refine",
        [
          `第 ${round} 輪結果：需要 refine`,
          `原因：${verifyDecision.reason}`,
          verifyDecision.revisionPrompt ? `Revision prompt:\n${verifyDecision.revisionPrompt}` : ""
        ]
          .filter(Boolean)
          .join("\n")
      );

      const refinedBaseInput = buildSkillRefinementInput({
        currentInput: args.prepared.baseInput,
        verifyDecision,
        round
      });

      args.onStatus?.(`正在依 verifier 建議進行第 ${round} 輪修正…`);
      runtimeResult = await runRuntimePass(refinedBaseInput, trace);
      trace = runtimeResult.trace;
      currentInput = runtimeResult.finalInput;
      currentTodo = runtimeResult.todo;
      currentPhase = runtimeResult.phase;
      updateAssistantProgress(currentTodo, currentPhase, trace);

      if (runtimeResult.finalAnswerOverride) {
        pushSkillTrace(trace, "Final answer", "refine 後由 multi-turn runtime 直接產生 blocked/manual summary。");
        currentPhase = "final_answer";
        updateAssistantProgress(currentTodo, currentPhase, trace);
        return {
          finalInput: currentInput,
          trace,
          todo: currentTodo,
          phase: currentPhase,
          finalAnswerOverride: runtimeResult.finalAnswerOverride
        };
      }

      const refinedGroundedAnswer = buildGroundedRepoSummaryAnswer(runtimeResult.lastBrowserObservation);
      if (refinedGroundedAnswer && goalWantsRepoSummary(args.userInput)) {
        pushSkillTrace(trace, "Final answer", "refine 後已由 grounded browser observation 直接產生最終摘要。");
        currentPhase = "final_answer";
        updateAssistantProgress(currentTodo, currentPhase, trace);
        return {
          finalInput: currentInput,
          trace,
          todo: currentTodo,
          phase: currentPhase,
          finalAnswerOverride: refinedGroundedAnswer
        };
      }

      args.onStatus?.(`正在產生第 ${round + 1} 輪回答中…`);
      currentAnswer = await runOneToOneWithLoadBalancer({
        logicalAgent: args.agent,
        input: currentInput,
        history: limitHistory(history),
        system: args.prepared.system,
        requestId: args.requestId,
        requestLabel: `skill final answer round ${round + 1}`,
        onDelta: () => {},
        onLog: (t) => pushLog({ category: "retry", agent: args.agent.name, requestId: args.requestId, stage: `skill final answer round ${round + 1}`, message: t })
      });

      const refinedAnswerFailure = detectTerminalAgentFailure(currentAnswer);
      if (refinedAnswerFailure) {
        pushSkillTrace(trace, "Final answer", `refine 後最終回答模型呼叫失敗，已直接回傳錯誤內容。\n${refinedAnswerFailure}`);
        return {
          finalInput: currentInput,
          trace,
          todo: currentTodo,
          phase: "final_answer",
          finalAnswerOverride: buildAgentFailureContent(refinedAnswerFailure, args.userInput)
        };
      }

      pushSkillTrace(trace, `Skill answer round ${round + 1}`, currentAnswer);
      currentPhase = "final_answer";
      updateAssistantProgress(currentTodo, currentPhase, trace);
    }

    pushSkillTrace(trace, "Verify/refine", `已達最大 verify 次數 ${skillVerifyMax}，回傳最後一次 refine 的結果。`);
    return { finalInput: currentInput, trace, todo: currentTodo, phase: currentPhase };
  }

  function readUserAvatar(file: File | undefined) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setUserAvatarUrl(reader.result);
      }
    };
    reader.readAsDataURL(file);
  }

  const userProfile = React.useMemo<UserProfile>(
    () => ({ name: userName.trim() || "You", avatarUrl: userAvatarUrl, description: userDescription.trim() }),
    [userName, userAvatarUrl, userDescription]
  );
  function limitHistory(messages: ChatMessage[]) {
    const limit = clampHistoryLimit(historyMessageLimit);
    return messages.filter((message) => message.role !== "tool").slice(-limit);
  }

  async function onSend(input: string) {
    if (mode === "one_to_one" && !activeAgent) {
      logNow({ category: "chat", ok: false, message: "Send skipped: no active agent", details: input });
      return;
    }

    const startedAt = Date.now();
    const requestId = createLogRequestId(mode === "one_to_one" ? "chat" : "magi");
    const logAgentLabel = mode === "one_to_one" ? activeAgent?.name ?? "Unknown agent" : "S.C. MAGI";
    logNow({
      category: "chat",
      agent: logAgentLabel,
      requestId,
      stage: "request_start",
      message: `Send (${mode})`,
      details: input
    });

    const docBlocks = mode === "one_to_one" ? docsForAgent.map((d) => `[DOC:${d.title}]\n${d.content}`).join("\n\n") : "";
    const userSystem = docBlocks ? `You may use these documents as context:\n\n${docBlocks}` : undefined;
    logNow({
      category: "chat",
      agent: logAgentLabel,
      requestId,
      stage: "context_prepare",
      message: "Context prepared",
      details: `docs=${mode === "one_to_one" ? docsForAgent.length : 0} history=${history.length}`
    });

    // User message
    const userMsg = msg("user", input, "user", { displayName: userProfile.name, avatarUrl: userProfile.avatarUrl });
    append(userMsg);
    const baseHistory = [...history, userMsg];
    const modelHistory = limitHistory(baseHistory);
    let streamingAssistantId: string | null = null;

    try {
      if (mode === "one_to_one") {
        const oneToOneAgent = activeAgent;
        if (!oneToOneAgent) {
          throw new Error("No active agent selected.");
        }
        logNow({ category: "chat", agent: oneToOneAgent.name, requestId, stage: "request_start", message: "normal talking started" });
        const assistantId = generateId();
        streamingAssistantId = assistantId;
        append({
          id: assistantId,
          role: "assistant",
          content: "",
          ts: Date.now(),
          name: oneToOneAgent.name,
          displayName: oneToOneAgent.name,
          avatarUrl: oneToOneAgent.avatarUrl,
          statusText: "準備回覆中…",
          isStreaming: true
        });
        const setAssistantStatus = (statusText: string, patch: Partial<ChatMessage> = {}) => {
          patchMessage(assistantId, { statusText, isStreaming: true, ...patch });
        };
        const finalizeAssistant = (patch: Partial<ChatMessage>) => {
          patchMessage(assistantId, {
            statusText: undefined,
            isStreaming: false,
            hideWhileStreaming: false,
            ...patch
          });
        };
        const resolvedActiveAgent = hydrateAgentCredentials(oneToOneAgent);
        const adapter = pickAdapter(resolvedActiveAgent);
        const resolvedMcpToolsForAgent = await ensureMcpToolsLoadedForServers(availableMcpServersForAgent, {
          onStatus: setAssistantStatus,
          requestId
        });
        const resolvedToolEntries: ToolEntry[] = [
          ...resolvedMcpToolsForAgent.flatMap(({ server, tools }) => tools.map((tool) => ({ kind: "mcp" as const, server, tool }))),
          ...availableBuiltinToolsForAgent.map((tool) => ({ kind: "builtin" as const, tool }))
        ];
        let finalInput = input;
        let finalSystem = userSystem;
        const skillTrace: ChatTraceEntry[] = [];
        let preparedSkillExecution: PreparedSkillExecution | null = null;
        let selectedSkillForExecution: SkillConfig | null = null;
        let latestToolAugmentation: ToolAugmentationResult | null = null;
        const resolveToolAugmentedInputForSend = async (toolArgs: {
          input: string;
          decisionContext?: string;
          onStatus?: (text: string) => void;
        }) => {
          const result = await resolveToolAugmentedInputDetailed({
            input: toolArgs.input,
            agent: resolvedActiveAgent,
            adapter,
            availableBuiltinTools: availableBuiltinToolsForAgent,
            availableMcpServers: availableMcpServersForAgent,
            availableMcpTools: resolvedMcpToolsForAgent,
            toolEntries: resolvedToolEntries,
            decisionContext: toolArgs.decisionContext,
            onStatus: toolArgs.onStatus,
            requestId
          });
          latestToolAugmentation = result.status === "tool_called" ? result : null;
          return result.input;
        };
        if (skillSessionSnapshot && activeAgent.enableSkills === true) {
          const allowedSkills = skillSessionSnapshot.availableSkills.filter((item) => item.allowed);
          const blockedSkills = skillSessionSnapshot.availableSkills.filter((item) => !item.allowed && item.reason);
          pushSkillTrace(
            skillTrace,
            "Skill snapshot",
            [
              `可用 skills：${allowedSkills.length} 個`,
              allowedSkills.length ? allowedSkills.map((item) => `- ${item.name}`).join("\n") : "沒有可用的 skill。",
              blockedSkills.length ? `不可用：\n${blockedSkills.map((item) => `- ${item.name}: ${item.reason}`).join("\n")}` : ""
            ]
              .filter(Boolean)
              .join("\n\n")
          );
        }

        if (availableSkillsForAgent.length > 0) {
          setAssistantStatus("正在分析是否需要使用 skill 中…");
          const skillDecision = await runSkillDecision({
            agent: resolvedActiveAgent,
            adapter,
            userInput: input,
            retry: getRetryPolicyForAgent(resolvedActiveAgent),
            skills: availableSkillsForAgent,
            language: mcpPromptTemplates.activeId,
            promptTemplate: promptTemplateRuntime.resolve("skill-decision", mcpPromptTemplates.activeId).template,
            requestId
          });

          if (!skillDecision) {
            pushSkillTrace(skillTrace, "Skill decision", `可用 skills：${availableSkillsForAgent.length} 個\n結果：skill decision 重試後仍失敗，改走一般 tool decision。`);
            logNow({ category: "skills", agent: oneToOneAgent.name, ok: false, requestId, stage: "skill decision", message: "Skill decision failed after retries; continue without skills" });
            finalInput = await resolveToolAugmentedInputForSend({
              input,
              onStatus: setAssistantStatus
            });
          } else if (skillDecision.type === "no_skill") {
            pushSkillTrace(skillTrace, "Skill decision", `可用 skills：${availableSkillsForAgent.length} 個\n結果：這一回合不使用 skill。`);
            logNow({ category: "skills", agent: oneToOneAgent.name, requestId, stage: "skill decision", message: "Skill decision resolved: no_skill" });
            finalInput = await resolveToolAugmentedInputForSend({
              input,
              onStatus: setAssistantStatus
            });
          } else {
            const selectedSkill = availableSkillsForAgent.find((skill) => skill.id === skillDecision.skillId) ?? null;
            if (!selectedSkill) {
              pushSkillTrace(
                skillTrace,
                "Skill decision",
                `模型選擇了不存在或不可用的 skill：${skillDecision.skillId}\n系統已回退到一般 tool decision。`
              );
              logNow({
                category: "skills",
                agent: oneToOneAgent.name,
                ok: false,
                requestId,
                stage: "skill decision",
                message: `Skill decision selected unavailable skill: ${skillDecision.skillId}`,
                details: JSON.stringify(skillDecision)
              });
              finalInput = await resolveToolAugmentedInputForSend({
                input,
                onStatus: setAssistantStatus
              });
            } else {
              setAssistantStatus(`正在載入 skill「${selectedSkill.name}」中…`);
              pushSkillTrace(
                skillTrace,
                "Skill decision",
                [`選中 skill：${selectedSkill.name} (${selectedSkill.id})`, `輸入：${stringifyAny(skillDecision.input ?? {})}`].join("\n")
              );
              const prepared = await prepareSkillExecution({
                skill: selectedSkill,
                skillInput: skillDecision.input,
                userInput: input,
                agent: resolvedActiveAgent,
                adapter,
                availableBuiltinTools: availableBuiltinToolsForAgent,
                availableMcpServers: availableMcpServersForAgent,
                availableMcpTools: resolvedMcpToolsForAgent,
                deferToolDecision: skillExecutionMode === "multi_turn",
                onStatus: setAssistantStatus,
                requestId
              });
              preparedSkillExecution = prepared;
              selectedSkillForExecution = selectedSkill;
              finalInput = prepared.finalInput;
              finalSystem = prepared.system;
              if (prepared.toolAugmentation?.status === "tool_called") {
                latestToolAugmentation = prepared.toolAugmentation;
              }
              skillTrace.push(...prepared.trace);
              logNow({
                category: "skills",
                agent: oneToOneAgent.name,
                ok: true,
                requestId,
                stage: "skill decision",
                message: `Skill selected: ${selectedSkill.name}`,
                details: JSON.stringify(skillDecision.input ?? {})
              });
            }
          }
        } else {
          if (activeAgent.enableSkills === true) {
            pushSkillTrace(skillTrace, "Skill decision", "沒有可用的 skill，已略過 skill decision。");
          }
          logNow({ category: "skills", agent: oneToOneAgent.name, requestId, stage: "skill decision", message: "Skill decision skipped: no available skills" });
          finalInput = await resolveToolAugmentedInputForSend({
            input,
            onStatus: setAssistantStatus
          });
        }

        if (selectedSkillForExecution && preparedSkillExecution) {
          if (skillExecutionMode === "multi_turn") {
            const executed = await executeMultiTurnSkill({
              initialTrace: skillTrace,
              prepared: preparedSkillExecution,
              skill: selectedSkillForExecution,
              agent: resolvedActiveAgent,
              adapter,
              userInput: input,
              assistantMessageId: assistantId,
              onStatus: setAssistantStatus,
              requestId
            });
            finalInput = executed.finalInput;
            finalSystem = preparedSkillExecution.system;
            patchMessage(assistantId, {
              skillTrace: executed.trace.length ? executed.trace : undefined,
              skillGoal: input,
              skillTodo: executed.todo.length ? executed.todo : undefined,
              skillPhase: executed.phase,
              statusText: "正在生成最終回覆中…",
              isStreaming: true,
              hideWhileStreaming: false
            });
            skillTrace.length = 0;
            skillTrace.push(...executed.trace);
            if (executed.finalAnswerOverride) {
              const runtimeOverrideFailed = executed.finalAnswerOverride.startsWith("【執行失敗】");
              finalizeAssistant({
                content: executed.finalAnswerOverride,
                skillTrace: executed.trace.length ? executed.trace : undefined,
                skillGoal: input,
                skillTodo: executed.todo.length ? executed.todo : undefined,
                skillPhase: executed.phase
              });
              logNow({
                category: "chat",
                agent: oneToOneAgent.name,
                ok: !runtimeOverrideFailed,
                requestId,
                stage: "final",
                outcome: runtimeOverrideFailed ? "failure" : "success",
                message: runtimeOverrideFailed ? "normal talking failed via multi-turn runtime override" : "normal talking completed via multi-turn runtime override",
                details: `elapsed_ms=${Date.now() - startedAt}\nresponse_len=${executed.finalAnswerOverride.length}\n\n${executed.finalAnswerOverride}`
              });
              return;
            }
          }

          if (skillExecutionMode !== "multi_turn") {
            pushSkillExecutionModeTrace(skillTrace, {
              mode: "single_turn",
              verifyMax: 0
            });
          }
        }

        patchMessage(assistantId, {
          skillTrace: skillTrace.length ? skillTrace : undefined,
          skillGoal: selectedSkillForExecution && skillExecutionMode === "multi_turn" ? input : undefined,
          statusText: "正在生成回覆中…",
          isStreaming: true
        });

        let sawDelta = false;
        let buffered = "";
        const onDelta = (t: string) => {
          buffered += t;
          const thinkState = getThinkStreamingState(buffered);
          patchMessage(assistantId, {
            content: buffered,
            hideWhileStreaming: thinkState.hideWhileStreaming,
            statusText: thinkState.statusText,
            isStreaming: true
          });
          if (!sawDelta && t) {
            sawDelta = true;
            logNow({ category: "chat", agent: oneToOneAgent.name, requestId, stage: "stream", message: "normal talking streaming started" });
          }
        };

        const full = await runOneToOneWithLoadBalancer({
          logicalAgent: oneToOneAgent,
          input: finalInput,
          history: limitHistory(history),
          system: finalSystem,
          requestId,
          requestLabel: "chat response",
          onDelta,
          onLog: (t) => pushLog({ category: "retry", agent: oneToOneAgent.name, requestId, stage: "chat response", message: t })
        });
        const terminalFailure = detectTerminalAgentFailure(full);
        if (terminalFailure) {
          const failureContent = buildAgentFailureContent(terminalFailure, input);
          finalizeAssistant({
            content: failureContent,
            skillTrace: skillTrace.length ? skillTrace : undefined,
            skillGoal: selectedSkillForExecution && skillExecutionMode === "multi_turn" ? input : undefined
          });
          logNow({
            category: "chat",
            agent: oneToOneAgent.name,
            ok: false,
            requestId,
            stage: "final",
            outcome: "failure",
            message: "normal talking failed",
            details: terminalFailure
          });
          return;
        }
        if (!String(full ?? "").trim()) {
          const latestToolResult = latestToolAugmentation as ToolAugmentationResult | null;
          const fallbackContent = buildEmptyResponseFallbackContent(input, latestToolResult, selectedSkillForExecution);
          const emptyResponseDetails = [`elapsed_ms=${Date.now() - startedAt}`];
          if (latestToolResult?.toolLabel) {
            emptyResponseDetails.push(`last_tool=${latestToolResult.toolLabel}`);
          }
          if (selectedSkillForExecution) {
            emptyResponseDetails.push(`selected_skill=${selectedSkillForExecution.name} (${selectedSkillForExecution.id})`);
          }
          if (latestToolResult?.toolOutput !== undefined) {
            emptyResponseDetails.push(`last_tool_output=\n${stringifyAny(latestToolResult.toolOutput)}`);
          }
          finalizeAssistant({
            content: fallbackContent,
            skillTrace: skillTrace.length ? skillTrace : undefined,
            skillGoal: selectedSkillForExecution && skillExecutionMode === "multi_turn" ? input : undefined
          });
          logNow({
            category: "chat",
            agent: oneToOneAgent.name,
            ok: false,
            requestId,
            stage: "final",
            outcome: "degraded",
            message: "normal talking returned empty response",
            details: emptyResponseDetails.join("\n\n")
          });
          return;
        }
        finalizeAssistant({
          content: full,
          skillTrace: skillTrace.length ? skillTrace : undefined,
          skillGoal: selectedSkillForExecution && skillExecutionMode === "multi_turn" ? input : undefined
        });
        logNow({
          category: "chat",
          agent: oneToOneAgent.name,
          ok: true,
          requestId,
          stage: "final",
          outcome: "success",
          message: "normal talking completed",
          details: `elapsed_ms=${Date.now() - startedAt}\nresponse_len=${full.length}\n\n${full}`
        });
        return;
      }
      const magiMode: MagiMode = mode === "magi_consensus" ? "magi_consensus" : "magi_vote";
      const assistantId = generateId();
      streamingAssistantId = assistantId;
      const initialMagiState = buildMagiPreparedUnits(input);
      append({
        id: assistantId,
        role: "assistant",
        content: "",
        ts: Date.now(),
        name: "S.C. MAGI",
        displayName: "S.C. MAGI",
        statusText: "正在初始化 S.C. MAGI…",
        isStreaming: true,
        magiState: initialMagiState.ok
          ? createMagiRenderState(magiMode, input, initialMagiState.units)
          : initialMagiState.state
      });

      const setMagiAssistantStatus = (statusText: string, magiState?: MagiRenderState) => {
        patchMessage(assistantId, {
          statusText,
          isStreaming: true,
          ...(magiState ? { magiState } : {})
        });
      };
      const finalizeMagiAssistant = (patch: Partial<ChatMessage>) => {
        patchMessage(assistantId, {
          statusText: undefined,
          isStreaming: false,
          hideWhileStreaming: false,
          ...patch
        });
      };

      if (!initialMagiState.ok) {
        const failureContent = buildAgentFailureContent(initialMagiState.reason, input);
        finalizeMagiAssistant({
          content: failureContent,
          magiState: initialMagiState.state
        });
        logNow({
          category: "magi",
          ok: false,
          requestId,
          stage: "preflight",
          outcome: "failure",
          message: "MAGI preflight failed",
          details: initialMagiState.reason
        });
        return;
      }

      setMagiAssistantStatus("S.C. MAGI 正在裁決中…");
      const result = await runMagi({
        mode: magiMode,
        question: input,
        units: initialMagiState.units,
        history: modelHistory,
        maxConsensusRounds: 3,
        invokeUnit: async ({ unit, prompt, requestLabel }) => {
          return await runOneToOneWithLoadBalancer({
            logicalAgent: unit.agent,
            input: prompt,
            history: [],
            system: unit.system,
            requestId,
            requestLabel,
            onDelta: () => {},
            onLog: (t) => pushLog({ category: "retry", agent: unit.agent.name, requestId, stage: requestLabel, message: t })
          });
        },
        onState: (magiState) => {
          const nextStatus =
            magiState.status === "failed"
              ? "S.C. MAGI 執行失敗"
              : magiState.status === "completed"
              ? "S.C. MAGI 決議完成"
              : `S.C. MAGI 第 ${magiState.round || 1} 輪審議中…`;
          setMagiAssistantStatus(nextStatus, magiState);
        },
        onLog: (entry) => {
          pushLog({
            category: "magi",
            agent: entry.unitId ?? "S.C. MAGI",
            ok: entry.ok,
            requestId,
            stage: entry.round ? `round_${entry.round}` : "magi",
            message: [
              entry.unitId ? `unit=${entry.unitId}` : "",
              entry.round ? `round=${entry.round}` : "",
              entry.message
            ]
              .filter(Boolean)
              .join(" "),
            details: entry.details
          });
        }
      });

      finalizeMagiAssistant({
        content: result.answer,
        magiState: result.state
      });
      logNow({
        category: "magi",
        ok: result.state.status !== "failed",
        requestId,
        stage: "final",
        outcome: result.state.status === "failed" ? "failure" : "success",
        message: "MAGI finished",
        details: `elapsed_ms=${Date.now() - startedAt}\nfinal_verdict=${result.state.finalVerdict ?? "DEADLOCK"}`
      });
    } catch (e: any) {
      const errorText = buildAgentFailureContent(String(e?.message ?? e), input);
      if (streamingAssistantId) {
        patchMessage(streamingAssistantId, {
          content: errorText,
          statusText: undefined,
          isStreaming: false,
          hideWhileStreaming: false
        });
      } else {
        append(msg("assistant", errorText, "system", { displayName: "System" }));
      }
      logNow({
        category: mode === "one_to_one" ? "chat" : "magi",
        agent: mode === "one_to_one" ? activeAgent?.name : "S.C. MAGI",
        ok: false,
        requestId,
        stage: "final",
        outcome: "failure",
        message: "Send failed",
        details: String(e?.message ?? e)
      });
    }
  }

  async function onCreateDoc() {
    const d: DocItem = { id: generateId(), title: "New Doc", content: "", updatedAt: Date.now() };
    try {
      await upsertDoc(d);
      setDocs(await listDocs());
      setDocEditorId(d.id);
      logNow({ category: "docs", ok: true, message: "Doc created", details: JSON.stringify(d, null, 2) });
      return d;
    } catch (e: any) {
      logNow({ category: "docs", ok: false, message: "Doc create failed", details: String(e?.message ?? e) });
      return null;
    }
  }

  async function ensureTutorialDoc() {
    const existing = docs.find((item) => item.title === TUTORIAL_DOC_NAME) ?? null;
    const nextDoc: DocItem = {
      id: existing?.id ?? generateId(),
      title: TUTORIAL_DOC_NAME,
      content: TUTORIAL_DOC_CONTENT,
      updatedAt: Date.now()
    };
    await upsertDoc(nextDoc);
    const nextDocs = await listDocs();
    setDocs(nextDocs);
    setDocEditorId(nextDoc.id);
    logNow({ category: "docs", ok: true, message: `Tutorial doc ensured: ${nextDoc.title}` });
  }

  async function ensureTutorialTimeTool() {
    const existing = builtInTools.find((tool) => tool.name === TUTORIAL_TIME_TOOL_NAME) ?? null;
    const nextTool: BuiltInToolConfig = {
      id: existing?.id ?? generateId(),
      name: TUTORIAL_TIME_TOOL_NAME,
      description: TUTORIAL_TIME_TOOL_DESCRIPTION,
      code: TUTORIAL_TIME_TOOL_CODE,
      inputSchema: TUTORIAL_TIME_TOOL_INPUT_SCHEMA,
      requireConfirmation: false,
      updatedAt: Date.now(),
      source: "custom"
    };
    const nextTools = existing
      ? builtInTools.map((tool) => (tool.id === existing.id ? nextTool : tool))
      : [nextTool, ...builtInTools];
    setBuiltInTools(nextTools);
    logNow({ category: "tool", ok: true, message: `Tutorial built-in tool ensured: ${nextTool.name}` });
  }

  async function onSaveDoc(d: DocItem) {
    try {
      await upsertDoc({ ...d, updatedAt: Date.now() });
      setDocs(await listDocs());
      logNow({ category: "docs", ok: true, message: "Doc saved", details: JSON.stringify(d, null, 2) });
    } catch (e: any) {
      logNow({ category: "docs", ok: false, message: "Doc save failed", details: String(e?.message ?? e) });
    }
  }

  async function onDeleteDoc(id: string) {
    try {
      await deleteDoc(id);
      setDocs(await listDocs());
      if (docEditorId === id) setDocEditorId(null);
      logNow({ category: "docs", ok: true, message: "Doc deleted", details: id });
    } catch (e: any) {
      logNow({ category: "docs", ok: false, message: "Doc delete failed", details: String(e?.message ?? e) });
    }
  }

  async function onImportSkill(file: File) {
    const skill = await importSkillZip(file);
    const next = await listSkills();
    setSkills(next);
    setSkillPanelSelectedId(skill.id);
    const [docs, files] = await Promise.all([listSkillDocs(skill.id), listSkillFiles(skill.id)]);
    setSkillPanelDocs(docs);
    setSkillPanelFiles(files);
    logNow({ category: "skills", ok: true, message: `Skill imported: ${skill.name}`, details: `${skill.id}\n${skill.sourcePackageName ?? ""}`.trim() });
  }

  async function onCreateEmptySkill(name: string) {
    const skill = await createEmptySkill(name);
    const next = await listSkills();
    setSkills(next);
    setSkillPanelSelectedId(skill.id);
    const [docs, files] = await Promise.all([listSkillDocs(skill.id), listSkillFiles(skill.id)]);
    setSkillPanelDocs(docs);
    setSkillPanelFiles(files);
    logNow({ category: "skills", ok: true, message: `Empty skill created: ${skill.name}`, details: skill.id });
  }

  async function onDeleteSkill(skillId: string) {
    const target = skills.find((skill) => skill.id === skillId);
    await deleteSkill(skillId);
    const next = await listSkills();
    setSkills(next);
    const nextSelectedId = skillPanelSelectedId === skillId ? next[0]?.id ?? null : skillPanelSelectedId;
    setSkillPanelSelectedId(nextSelectedId);
    if (nextSelectedId) {
      const [docs, files] = await Promise.all([listSkillDocs(nextSelectedId), listSkillFiles(nextSelectedId)]);
      setSkillPanelDocs(docs);
      setSkillPanelFiles(files);
    } else {
      setSkillPanelDocs([]);
      setSkillPanelFiles([]);
    }
    logNow({ category: "skills", ok: true, message: `Skill deleted: ${target?.name ?? skillId}` });
  }

  async function onUpdateSkillMarkdown(skillId: string, markdown: string) {
    const updated = await updateSkillMarkdown(skillId, markdown);
    const next = await listSkills();
    setSkills(next);
    setSkillPanelSelectedId(updated.id);
    const [docs, files] = await Promise.all([listSkillDocs(updated.id), listSkillFiles(updated.id)]);
    setSkillPanelDocs(docs);
    setSkillPanelFiles(files);
    logNow({ category: "skills", ok: true, message: `Skill updated: ${updated.name}`, details: updated.id });
  }

  async function onUpsertSkillTextFile(skillId: string, path: string, kind: "reference" | "asset", content: string) {
    const updated = await upsertSkillTextFile(skillId, { path, kind, content });
    const next = await listSkills();
    setSkills(next);
    setSkillPanelSelectedId(updated.id);
    const [docs, files] = await Promise.all([listSkillDocs(updated.id), listSkillFiles(updated.id)]);
    setSkillPanelDocs(docs);
    setSkillPanelFiles(files);
    logNow({ category: "skills", ok: true, message: `Skill file saved: ${path}`, details: `${updated.name}\n${kind}` });
  }

  async function onDeleteSkillTextFile(skillId: string, path: string) {
    const updated = await deleteSkillTextFile(skillId, path);
    const next = await listSkills();
    setSkills(next);
    setSkillPanelSelectedId(updated.id);
    const [docs, files] = await Promise.all([listSkillDocs(updated.id), listSkillFiles(updated.id)]);
    setSkillPanelDocs(docs);
    setSkillPanelFiles(files);
    logNow({ category: "skills", ok: true, message: `Skill file deleted: ${path}`, details: updated.name });
  }

  async function onResetAppData() {
    const confirmed = window.confirm("這會清空這個網站中 agent-go-round 儲存的所有資料，包含對話、Docs、Skills、Agents、Credentials、MCP 與 Built-in Tools。要繼續嗎？");
    if (!confirmed) return;
    await resetAgentGoRoundStorage();
    window.location.reload();
  }

  async function onExportSkill(skillId: string) {
    const target = skills.find((skill) => skill.id === skillId);
    const blob = await exportSkillZip(skillId);
    downloadFileBlob(`${target?.rootPath ?? skillId}.zip`, blob);
    logNow({ category: "skills", ok: true, message: `Skill exported: ${target?.name ?? skillId}`, details: target?.rootPath ?? skillId });
  }

  async function ensureTutorialSequentialSkill() {
    const all = await listSkills();
    let target =
      all.find((skill) => skill.rootPath === TUTORIAL_SEQUENTIAL_SKILL_ROOT) ??
      all.find((skill) => skill.name === TUTORIAL_SEQUENTIAL_SKILL_NAME) ??
      null;

    if (!target) {
      target = await createEmptySkill(TUTORIAL_SEQUENTIAL_SKILL_NAME);
    }

    target = await updateSkillMarkdown(target.id, TUTORIAL_SEQUENTIAL_SKILL_MARKDOWN);
    target = await upsertSkillTextFile(target.id, {
      path: TUTORIAL_SEQUENTIAL_ADVANCED_PATH,
      kind: "reference",
      content: TUTORIAL_SEQUENTIAL_ADVANCED_CONTENT
    });
    target = await upsertSkillTextFile(target.id, {
      path: TUTORIAL_SEQUENTIAL_EXAMPLES_PATH,
      kind: "reference",
      content: TUTORIAL_SEQUENTIAL_EXAMPLES_CONTENT
    });
    target = await upsertSkillTextFile(target.id, {
      path: TUTORIAL_SEQUENTIAL_ASSET_PATH,
      kind: "asset",
      content: TUTORIAL_SEQUENTIAL_ASSET_CONTENT
    });

    const next = await listSkills();
    setSkills(next);
    setSkillPanelSelectedId(target.id);
    const [docs, files] = await Promise.all([listSkillDocs(target.id), listSkillFiles(target.id)]);
    setSkillPanelDocs(docs);
    setSkillPanelFiles(files);
  }

  async function ensureTutorialChatgptBrowserSkill() {
    const all = await listSkills();
    let target =
      all.find((skill) => skill.rootPath === TUTORIAL_CHATGPT_BROWSER_SKILL_ROOT) ??
      all.find((skill) => skill.name === TUTORIAL_CHATGPT_BROWSER_SKILL_NAME) ??
      null;

    if (!target) {
      target = await createEmptySkill(TUTORIAL_CHATGPT_BROWSER_SKILL_NAME);
    }

    target = await updateSkillMarkdown(target.id, TUTORIAL_CHATGPT_BROWSER_SKILL_MARKDOWN);
    target = await upsertSkillTextFile(target.id, {
      path: TUTORIAL_CHATGPT_BROWSER_REFERENCE_PATH,
      kind: "reference",
      content: TUTORIAL_CHATGPT_BROWSER_REFERENCE_CONTENT
    });
    target = await upsertSkillTextFile(target.id, {
      path: TUTORIAL_CHATGPT_BROWSER_ASSET_PATH,
      kind: "asset",
      content: TUTORIAL_CHATGPT_BROWSER_ASSET_CONTENT
    });

    const next = await listSkills();
    setSkills(next);
    setSkillPanelSelectedId(target.id);
    const [docs, files] = await Promise.all([listSkillDocs(target.id), listSkillFiles(target.id)]);
    setSkillPanelDocs(docs);
    setSkillPanelFiles(files);
  }

  function onChangeMcpServers(next: McpServerConfig[]) {
    const prev = mcpServers;
    setMcpServers(next);
    setMcpToolsByServer((prev) => {
      const nextMap: Record<string, McpTool[]> = {};
      next.forEach((s) => {
        if (prev[s.id]) nextMap[s.id] = prev[s.id];
      });
      return nextMap;
    });
    const prevIds = new Set(prev.map((s) => s.id));
    const nextIds = new Set(next.map((s) => s.id));
    const added = next.filter((s) => !prevIds.has(s.id));
    const removed = prev.filter((s) => !nextIds.has(s.id));
    const urlChanged = next.filter((s) => {
      const prevItem = prev.find((p) => p.id === s.id);
      return prevItem && prevItem.sseUrl !== s.sseUrl;
    });
    if (added.length || removed.length || urlChanged.length) {
      logNow({
        category: "mcp",
        message: "MCP servers updated",
        details: [
          added.length ? `added: ${added.map((s) => s.name).join(", ")}` : "",
          removed.length ? `removed: ${removed.map((s) => s.name).join(", ")}` : "",
          urlChanged.length ? `url_changed: ${urlChanged.map((s) => s.name).join(", ")}` : ""
        ]
          .filter(Boolean)
          .join("\n")
      });
    }
  }

  function updatePromptTemplateFile(id: PromptTemplateFileState["id"], content: string) {
    const now = Date.now();
    setPromptTemplateFiles((prev) =>
      prev.map((entry) => (entry.id === id ? { ...entry, content, updatedAt: now } : entry))
    );
    setPromptTemplateTestStates((prev) => {
      if (!prev[id]) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

  function resetPromptTemplateFile(id: PromptTemplateFileState["id"]) {
    const next = resetPromptTemplateToDefault(id);
    if (!next) return;
    updatePromptTemplateFile(id, next);
  }

  function resolvePromptTemplateTestAgent() {
    const preferred = activeAgent ? hydrateAgentCredentials(activeAgent) : null;
    if (preferred && (preferred.loadBalancerId || preferred.type !== "chrome_prompt")) {
      return preferred;
    }
    const fallback = agents
      .map((agent) => hydrateAgentCredentials(agent))
      .find((agent) => !!agent.loadBalancerId || agent.type !== "chrome_prompt");
    return fallback ?? null;
  }

  async function runPromptTemplateApiTest(baseId: PromptTemplateBaseId, language: "zh" | "en") {
    const fileId = getPromptTemplateFileId(baseId, language);
    const templateState = promptTemplateRuntime.resolve(baseId, language);
    const agent = resolvePromptTemplateTestAgent();
    const spec = buildPromptTemplateApiTestSpec({
      baseId,
      language,
      template: templateState.template
    });

    if (!agent) {
      setPromptTemplateTestStates((prev) => ({
        ...prev,
        [fileId]: {
          status: "failure",
          summary: language === "en" ? "No provider-backed agent is available for template testing." : "目前沒有可用的 provider-backed agent 可執行模板測試。",
          expected: spec.expected,
          updatedAt: Date.now()
        }
      }));
      return;
    }

    const requestId = createLogRequestId("prompt-template");
    setPromptTemplateTestStates((prev) => ({
      ...prev,
      [fileId]: {
        status: "running",
        summary: language === "en" ? "Running API test..." : "正在執行 API 測試…",
        expected: spec.expected,
        requestId,
        agentName: agent.name,
        prompt: spec.prompt,
        system: spec.system,
        updatedAt: Date.now()
      }
    }));

    logNow({
      category: "prompt_templates",
      agent: agent.name,
      requestId,
      stage: baseId,
      message: `Prompt template API test started: ${baseId}.${language}`,
      details: [`expected=${spec.expected}`, spec.system ? `system:\n${spec.system}` : "", `prompt:\n${spec.prompt}`].filter(Boolean).join("\n\n")
    });

    try {
      const raw = await runOneToOneWithLoadBalancer({
        logicalAgent: agent,
        input: spec.prompt,
        history: [],
        system: spec.system,
        requestId,
        requestLabel: `prompt template test ${baseId}`,
        onDelta: () => {}
      });

      const terminalFailure = detectTerminalAgentFailure(raw);
      if (terminalFailure) {
        const summary = language === "en" ? `Model request failed: ${terminalFailure}` : `模型請求失敗：${terminalFailure}`;
        setPromptTemplateTestStates((prev) => ({
          ...prev,
          [fileId]: {
            status: "failure",
            summary,
            expected: spec.expected,
            requestId,
            agentName: agent.name,
            prompt: spec.prompt,
            system: spec.system,
            rawOutput: raw,
            updatedAt: Date.now()
          }
        }));
        logNow({
          category: "prompt_templates",
          agent: agent.name,
          ok: false,
          requestId,
          stage: baseId,
          message: `Prompt template API test failed: ${baseId}.${language}`,
          details: raw
        });
        return;
      }

      const validation = spec.validate(raw);
      setPromptTemplateTestStates((prev) => ({
        ...prev,
        [fileId]: {
          status: validation.pass ? "success" : "failure",
          summary: validation.summary,
          expected: spec.expected,
          requestId,
          agentName: agent.name,
          prompt: spec.prompt,
          system: spec.system,
          rawOutput: raw,
          parsedOutput: validation.parsed !== undefined ? stringifyAny(validation.parsed) : undefined,
          updatedAt: Date.now()
        }
      }));
      logNow({
        category: "prompt_templates",
        agent: agent.name,
        ok: validation.pass,
        requestId,
        stage: baseId,
        message: `Prompt template API test ${validation.pass ? "passed" : "failed"}: ${baseId}.${language}`,
        details: [
          `summary=${validation.summary}`,
          validation.parsed !== undefined ? `parsed=${stringifyAny(validation.parsed)}` : "",
          `raw=${raw}`
        ]
          .filter(Boolean)
          .join("\n\n")
      });
    } catch (error: any) {
      const message = String(error?.message ?? error ?? "Unknown error");
      setPromptTemplateTestStates((prev) => ({
        ...prev,
        [fileId]: {
          status: "failure",
          summary: language === "en" ? `API test crashed: ${message}` : `API 測試發生錯誤：${message}`,
          expected: spec.expected,
          requestId,
          agentName: agent.name,
          prompt: spec.prompt,
          system: spec.system,
          rawOutput: message,
          updatedAt: Date.now()
        }
      }));
      logNow({
        category: "prompt_templates",
        agent: agent.name,
        ok: false,
        requestId,
        stage: baseId,
        message: `Prompt template API test error: ${baseId}.${language}`,
        details: message
      });
    }
  }

  async function runAllPromptTemplateApiTests(language: "zh" | "en") {
    setPromptTemplateTestsRunning(true);
    try {
      for (const group of promptTemplateRuntime.groups) {
        const entry = group.entries[language];
        if (!entry || entry.parseError) {
          const fileId = getPromptTemplateFileId(group.baseId, language);
          setPromptTemplateTestStates((prev) => ({
            ...prev,
            [fileId]: {
              status: "failure",
              summary: language === "en" ? "Skipped: fix YAML before API testing." : "已略過：請先修正 YAML。",
              updatedAt: Date.now()
            }
          }));
          continue;
        }
        await runPromptTemplateApiTest(group.baseId, language);
      }
    } finally {
      setPromptTemplateTestsRunning(false);
    }
  }

  function exportRawHistory() {
    const payload: ExportPayload = {
      kind: "raw_history",
      exportedAt: Date.now(),
      history
    };
    downloadBlob(`agent-go-round-history-${Date.now()}.json`, JSON.stringify(payload, null, 2), "application/json;charset=utf-8");
    logNow({ category: "chat", ok: true, message: `Raw history exported (${history.length})` });
  }

  async function exportSummaryHistory() {
    if (!activeAgent) {
      logNow({ category: "chat", ok: false, message: "Summary export skipped: no active agent" });
      return;
    }
    if (history.length === 0) {
      logNow({ category: "chat", ok: false, message: "Summary export skipped: empty history" });
      return;
    }

    setIsSummaryExporting(true);
    const requestId = createLogRequestId("summary");
    try {
      const summary = await runOneToOneWithLoadBalancer({
        logicalAgent: activeAgent,
        input:
          "Please compress this conversation into a concise reusable summary for future continuation. Keep key facts, decisions, unresolved items, user preferences, and open tasks. Output plain text only.",
        history,
        system:
          "You are preparing a conversation carry-over note. Write in Traditional Chinese when possible. Do not include markdown code fences.",
        requestId,
        requestLabel: "summary export",
        onDelta: () => {},
        onLog: (t) => pushLog({ category: "retry", agent: activeAgent.name, requestId, stage: "summary export", message: t })
      });

      const payload: ExportPayload = {
        kind: "summary_history",
        exportedAt: Date.now(),
        summary,
        agent: { id: activeAgent.id, name: activeAgent.name, model: activeAgent.model }
      };
      downloadBlob(`agent-go-round-summary-${Date.now()}.json`, JSON.stringify(payload, null, 2), "application/json;charset=utf-8");
      logNow({ category: "chat", agent: activeAgent.name, ok: true, requestId, stage: "summary export", outcome: "success", message: "Summary history exported", details: summary });
    } catch (e: any) {
      logNow({ category: "chat", agent: activeAgent.name, ok: false, requestId, stage: "summary export", outcome: "failure", message: "Summary export failed", details: String(e?.message ?? e) });
    } finally {
      setIsSummaryExporting(false);
    }
  }

  async function importHistoryFile(file: File) {
    try {
      const text = await file.text();
      let imported: any = null;
      try {
        imported = JSON.parse(text);
      } catch {
        imported = null;
      }

      if (imported?.kind === "raw_history" && Array.isArray(imported.history)) {
        const nextHistory = imported.history.map(normalizeImportedMessage).filter(Boolean) as ChatMessage[];
        setHistory(nextHistory);
        logNow({ category: "chat", ok: true, message: `Raw history imported (${nextHistory.length})` });
        return;
      }

      const summaryText =
        imported?.kind === "summary_history" && typeof imported.summary === "string"
          ? imported.summary
          : text.trim();

      const summaryMessage = msg("user", summaryText, "summary_import", { displayName: "上次對話總結" });
      setHistory([summaryMessage]);
      logNow({ category: "chat", ok: true, message: "Summary history imported", details: summaryText });
    } catch (e: any) {
      logNow({ category: "chat", ok: false, message: "Import history failed", details: String(e?.message ?? e) });
    }
  }

  if (appEntryMode === "landing") {
    return (
      <>
        <LandingPage onStart={() => setAppEntryMode("workspace")} onStartTutorial={() => void startTutorial("first-agent-chat")} />
        {tutorialUnavailableMessage ? (
          <HelpModal title="案例教學目前無法使用" onClose={() => setTutorialUnavailableMessage(null)} width="min(560px, 92vw)">
            <div style={{ fontSize: 13, lineHeight: 1.8, opacity: 0.92 }}>{tutorialUnavailableMessage}</div>
          </HelpModal>
        ) : null}
      </>
    );
  }

  return (
    <div className={tutorialActive ? "tutorial-layout" : undefined}>
      {tutorialScenario && currentTutorialStep && currentTutorialEvaluation ? (
        <TutorialGuide
          scenario={tutorialScenario}
          currentStepIndex={tutorialStepIndex}
          evaluations={tutorialEvaluations}
          activeAgentName={activeAgent?.name ?? "尚未選擇"}
          lockedAgentLabel={tutorialActiveAgentHint}
          activeAgentWarning={tutorialActiveAgentWarning}
          onAdvance={advanceTutorialStep}
          onSkip={skipTutorialScenario}
          onExit={() => setShowTutorialExitPrompt(true)}
        />
      ) : null}

      {tutorialShowLandingPreview ? (
        <div className="tutorial-preview-shell tutorial-preview-shell-blur">
          <LandingPage onStart={() => {}} onStartTutorial={() => {}} />
        </div>
      ) : (
      <div className={`app-shell ${tutorialActive ? "app-shell-tutorial" : ""} ${tutorialPreviewLocked ? "tutorial-preview-shell-blur" : ""}`}>
      <div className="card topbar" data-tutorial-id="app-topbar">
        <div>
          <div className="app-title">AgentGoRound</div>
          <div className="app-subtitle">Browser-first agent playground</div>
        </div>
        <div className="tabs">
          {[
            { id: "chat", label: "Chat" },
            { id: "chat_config", label: "Chat Config" },
            { id: "agents", label: "Agents" },
            { id: "profile", label: "Profile" }
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id as ActiveTab)}
              className={`tab-btn ${activeTab === t.id ? "tab-btn-active" : ""}`}
              data-tutorial-id={`tab-${t.id}`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="content">
        {activeTab === "chat" && (
          <div className="content-grid">
            <div className="card panel chat-panel">
              <ChatPanel
                history={history}
                onSend={onSend}
                onClear={() => {
                  setHistory([]);
                  setTutorialOpenedToolResultMessageIds([]);
                  logNow({ category: "chat", message: "Chat cleared" });
                }}
                leaderName={null}
                userName={userProfile.name}
                modeLabel={mode === "one_to_one" ? "normal" : MAGI_MODE_LABELS[mode]}
                onExportRaw={exportRawHistory}
                onExportSummary={exportSummaryHistory}
                onImportHistory={importHistoryFile}
                isSummaryExporting={isSummaryExporting}
                onOpenFullscreen={() => setIsChatFullscreen(true)}
                composerSeed={tutorialComposerSeed}
                onDraftChange={setChatComposerDraft}
                onOpenToolResult={(assistantMessageId) =>
                  setTutorialOpenedToolResultMessageIds((current) =>
                    current.includes(assistantMessageId) ? current : [...current, assistantMessageId]
                  )
                }
              />
            </div>
          </div>
        )}

        {activeTab === "chat_config" && (
          <div className="cc-dashboard">
            <div className="cc-dashboard-header">
              <div className="cc-dashboard-title">Resource And Settings</div>
              <div className="cc-dashboard-subtitle">點選任一項目進行設定</div>
            </div>

            <div className="cc-dashboard-grid">
              <button
                className="cc-card"
                onClick={() => {
                  setSelectedAgentId(activeAgentId);
                  setActiveTab("agents");
                }}
                data-tutorial-id="chat-config-agent-card"
              >
                <span className="cc-card-label">Main Agent</span>
                <strong className="cc-card-value">{activeAgent?.name ?? "None"}</strong>
                <span className="cc-card-hint">
                  {mode === "one_to_one"
                    ? loadBalancerSlots.find((entry) => entry.id === activeAgent?.loadBalancerId)?.name ?? "No load balancer"
                    : `MAGI mode 固定使用 ${formatManagedMagiAgentName("Melchior")} / ${formatManagedMagiAgentName("Balthasar")} / ${formatManagedMagiAgentName("Casper")}`}
                </span>
              </button>
              <button className="cc-card" onClick={() => setConfigModal("credentials")} data-tutorial-id="chat-config-credentials-card">
                <span className="cc-card-label">Credentials</span>
                <strong className="cc-card-value">{configuredCredentialCount}/{credentialSlots.length}</strong>
                <span className="cc-card-hint">集中管理模型金鑰與後續憑證</span>
              </button>
              <button className="cc-card" onClick={() => setConfigModal("load_balancers")} data-tutorial-id="chat-config-load-balancer-card">
                <span className="cc-card-label">Load Balancer</span>
                <strong className="cc-card-value">{configuredLoadBalancerCount}/{loadBalancerSlots.length}</strong>
                <span className="cc-card-hint">Agent 透過 LB 選擇 provider / model / key</span>
              </button>
              <button className="cc-card" onClick={() => setConfigModal("mode")} data-tutorial-id="chat-config-mode-card">
                <span className="cc-card-label">Mode</span>
                <strong className="cc-card-value">{mode === "one_to_one" ? "normal" : MAGI_MODE_LABELS[mode]}</strong>
                <span className="cc-card-hint">{mode === "one_to_one" ? "1:1 對話" : "S.C. MAGI 裁決模式"}</span>
              </button>
              <button className="cc-card" onClick={() => setConfigModal("history")} data-tutorial-id="chat-config-history-card">
                <span className="cc-card-label">History</span>
                <strong className="cc-card-value">{historyMessageLimit} msgs</strong>
                <span className="cc-card-hint">只保留與對話歷史相關設定</span>
              </button>
              {mode !== "one_to_one" && (
                <button className="cc-card" onClick={() => setConfigModal("team")}>
                  <span className="cc-card-label">S.C. MAGI</span>
                  <strong className="cc-card-value">{magiReadyCount}/3 ready</strong>
                  <span className="cc-card-hint">
                    {formatManagedMagiAgentName("Melchior")} / {formatManagedMagiAgentName("Balthasar")} / {formatManagedMagiAgentName("Casper")}
                  </span>
                </button>
              )}
              <button className="cc-card" onClick={() => setConfigModal("docs")} data-tutorial-id="chat-config-docs-card">
                <span className="cc-card-label">Docs</span>
                <strong className="cc-card-value">{docs.length}</strong>
                <span className="cc-card-hint">IndexedDB 文件庫</span>
              </button>
              <button className="cc-card" onClick={() => setConfigModal("mcp")} data-tutorial-id="chat-config-mcp-card">
                <span className="cc-card-label">MCP (SSE)</span>
                <strong className="cc-card-value">{mcpServers.length}</strong>
                <span className="cc-card-hint">外部工具伺服器</span>
              </button>
              <button className="cc-card" onClick={() => setConfigModal("skills")} data-tutorial-id="chat-config-skills-card">
                <span className="cc-card-label">Skills</span>
                <strong className="cc-card-value">{skills.length}</strong>
                <span className="cc-card-hint">Workflow layer</span>
              </button>
              <button className="cc-card" onClick={() => setConfigModal("prompts")}>
                <span className="cc-card-label">Prompt Templates</span>
                <strong className="cc-card-value">{promptTemplateRuntime.groups.length}</strong>
                <span className="cc-card-hint">YAML prompt files</span>
              </button>
              <button className="cc-card" onClick={() => setConfigModal("tools")} data-tutorial-id="chat-config-tools-card">
                <span className="cc-card-label">Built-in Tools</span>
                <strong className="cc-card-value">{builtInTools.length}</strong>
                <span className="cc-card-hint">Browser JS tools</span>
              </button>
            </div>

            {/* ── Config modals ── */}
            {configModal === "mode" && (
              <HelpModal title="Mode" onClose={() => setConfigModal(null)} width="min(420px, 92vw)">
                <div style={{ display: "grid", gap: 8 }}>
                  {([
                    ["one_to_one", "Normal", "一般一對一對話模式，可自由搭配 skills、MCP、built-in tools 與 docs 使用"],
                    ["magi_vote", MAGI_MODE_LABELS.magi_vote, "三賢人同步表決，一輪完成裁決，適合快速取得多視角結論"],
                    ["magi_consensus", MAGI_MODE_LABELS.magi_consensus, "三賢人最多三輪反覆協商，若仍無法達成共識則輸出 deadlock"]
                  ] as const).map(([value, title, desc]) => (
                    <button
                      key={value}
                      onClick={() => { setMode(value); setConfigModal(null); }}
                      style={{
                        textAlign: "left",
                        padding: 14,
                        borderRadius: 12,
                        border: mode === value ? "1px solid var(--primary)" : "1px solid var(--border)",
                        background: mode === value ? "rgba(91,123,255,0.12)" : "var(--bg-2)",
                        color: "var(--text)",
                        cursor: "pointer"
                      }}
                    >
                      <div style={{ fontWeight: 700 }}>{title}</div>
                      <div style={{ fontSize: 12, opacity: 0.7 }}>{desc}</div>
                    </button>
                  ))}
                </div>
              </HelpModal>
            )}

            {configModal === "credentials" && (
              <HelpModal title="Credentials" onClose={() => setConfigModal(null)} width="min(680px, 96vw)">
                <div style={{ display: "grid", gap: 14 }} data-tutorial-id="credentials-modal">
                  <div style={{ fontSize: 12, opacity: 0.78, lineHeight: 1.7 }}>
                    這裡集中管理 provider / endpoint 與多把 API keys。Load Balancer 的 instance 會選擇其中一筆 credential，再綁定某一把 key 來執行。
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button type="button" onClick={() => addCredential("openai")} style={iconActionBtn}>
                      + OpenAI
                    </button>
                    <button type="button" onClick={() => addCredential("groq")} style={iconActionBtn} data-tutorial-id="credential-add-groq">
                      + Groq
                    </button>
                    <button type="button" onClick={() => addCredential("custom")} style={iconActionBtn}>
                      + Custom
                    </button>
                    <button type="button" onClick={() => addCredential("chrome_prompt")} style={iconActionBtn}>
                      + Chrome Prompt
                    </button>
                  </div>
                  {credentialSlots.length === 0 ? (
                    <div style={{ fontSize: 12, opacity: 0.7 }}>目前還沒有 credential。可先新增 OpenAI、Groq、Custom 或 Chrome Prompt。</div>
                  ) : (
                    credentialSlots.map((slot) => (
                      <div
                        key={slot.id}
                        className="card"
                        style={{ padding: 14, display: "grid", gap: 10 }}
                        data-tutorial-id={slot.preset === "groq" ? "credential-groq-card" : undefined}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                          <div>
                            <div style={{ fontWeight: 800 }}>{slot.label}</div>
                            <div style={{ fontSize: 12, opacity: 0.72 }}>{slot.endpoint || "尚未設定 endpoint"}</div>
                          </div>
                          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
                            <div style={{ fontSize: 12, opacity: 0.72 }}>
                              {slot.preset === "chrome_prompt"
                                ? "不需要 API key"
                                : `已設定 ${slot.keys.filter((key) => key.apiKey.trim()).length}/${slot.keys.length} keys`}
                            </div>
                            <button type="button" onClick={() => removeCredential(slot.id)} style={dangerMiniBtn}>
                              Remove
                            </button>
                          </div>
                        </div>

                        <div style={{ display: "grid", gap: 6 }}>
                          <label style={label}>Credential Name</label>
                          <input
                            value={slot.label}
                            onChange={(e) => updateCredential(slot.id, { label: e.target.value })}
                            style={{ width: "100%", marginTop: 0, boxSizing: "border-box", ...selectStyle }}
                            placeholder="Credential label"
                            data-tutorial-id={slot.preset === "groq" ? "credential-groq-label-input" : undefined}
                          />
                        </div>

                        <div style={{ display: "grid", gap: 6 }}>
                          <label style={label}>Endpoint</label>
                          <input
                            value={slot.endpoint}
                            onChange={(e) => updateCredential(slot.id, { endpoint: e.target.value })}
                            disabled={slot.preset === "openai" || slot.preset === "groq"}
                            style={{
                              width: "100%",
                              marginTop: 0,
                              boxSizing: "border-box",
                              opacity: slot.preset === "openai" || slot.preset === "groq" ? 0.72 : 1,
                              ...selectStyle
                            }}
                            placeholder="https://api.example.com/v1"
                            data-tutorial-id={slot.preset === "groq" ? "credential-groq-endpoint-input" : undefined}
                          />
                        </div>

                        {slot.preset !== "chrome_prompt" ? (
                          <div style={{ display: "grid", gap: 10 }}>
                            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                              <label style={label}>Model API Keys</label>
                              <button
                                type="button"
                                onClick={() => addCredentialKey(slot.id)}
                                style={{ ...iconActionBtn, marginLeft: "auto" }}
                                data-tutorial-id={slot.preset === "groq" ? "credential-groq-add-key" : undefined}
                              >
                                + Key
                              </button>
                            </div>
                            {slot.keys.map((key, keyIndex) => (
                              <div
                                key={key.id}
                                style={{
                                  display: "grid",
                                  gap: 8,
                                  padding: 12,
                                  borderRadius: 12,
                                  border: "1px solid var(--border)",
                                  background: "var(--bg-2)"
                                }}
                              >
                                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                                  <div style={{ fontSize: 12, fontWeight: 700 }}>Key {keyIndex + 1}</div>
                                  <button type="button" onClick={() => removeCredentialKey(slot.id, key.id)} style={dangerMiniBtn} disabled={slot.keys.length <= 1}>
                                    Remove
                                  </button>
                                </div>
                                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                  <input
                                    type={visibleCredentialIds[key.id] ? "text" : "password"}
                                    value={key.apiKey}
                                    onChange={(e) => updateCredentialKey(slot.id, key.id, e.target.value)}
                                    style={{ width: "100%", marginTop: 0, boxSizing: "border-box", ...selectStyle }}
                                    placeholder="Enter API key"
                                    data-tutorial-id={
                                      slot.preset === "groq"
                                        ? keyIndex === 0
                                          ? "credential-groq-api-key"
                                          : `credential-groq-api-key-${keyIndex + 1}`
                                        : undefined
                                    }
                                  />
                                  <button
                                    type="button"
                                    onClick={() => setVisibleCredentialIds((prev) => ({ ...prev, [key.id]: !prev[key.id] }))}
                                    style={iconBtn}
                                    title={visibleCredentialIds[key.id] ? "Hide API key" : "Show API key"}
                                    aria-label={visibleCredentialIds[key.id] ? "Hide API key" : "Show API key"}
                                  >
                                    <EyeIcon open={!!visibleCredentialIds[key.id]} />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void runCredentialTest(slot, key.id)}
                                    disabled={testingCredentialIds[key.id] || !slot.endpoint.trim()}
                                    data-tutorial-id={slot.preset === "groq" && keyIndex === 0 ? "credential-groq-test" : undefined}
                                    style={{
                                      ...iconActionBtn,
                                      whiteSpace: "nowrap",
                                      opacity: testingCredentialIds[key.id] || !slot.endpoint.trim() ? 0.64 : 1,
                                      cursor: testingCredentialIds[key.id] || !slot.endpoint.trim() ? "not-allowed" : "pointer"
                                    }}
                                  >
                                    {testingCredentialIds[key.id] ? "測試中..." : "測試 Provider 連線"}
                                  </button>
                                </div>
                                {credentialTestResults[key.id] ? (
                                  <div
                                    style={{
                                      fontSize: 12,
                                      lineHeight: 1.6,
                                      color: credentialTestResults[key.id]?.ok ? "var(--ok)" : "var(--danger)",
                                      opacity: 0.92
                                    }}
                                  >
                                    {credentialTestResults[key.id]?.message}
                                  </div>
                                ) : null}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div style={{ fontSize: 12, opacity: 0.72, lineHeight: 1.6 }}>
                            Chrome Prompt 是 pseudo provider，不需要 API key；可直接給 load balancer instance 使用。
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </HelpModal>
            )}

            {configModal === "load_balancers" && (
              <HelpModal title="Load Balancer" onClose={() => setConfigModal(null)} width="min(980px, 96vw)">
                <LoadBalancersPanel
                  loadBalancers={loadBalancerSlots}
                  credentials={credentialSlots}
                  selectedId={loadBalancerPanelSelectedId}
                  onSelect={setLoadBalancerPanelSelectedId}
                  onChange={setLoadBalancers}
                  onLoadModels={async ({ credential, credentialKeyId }) => {
                    const key = credential.keys.find((entry) => entry.id === credentialKeyId) ?? credential.keys[0];
                    return await fetchCredentialModels(credential, key?.apiKey ?? "");
                  }}
                  draftSeed={loadBalancerDraftSeed}
                  onDraftSeedConsumed={() => setLoadBalancerDraftSeed(null)}
                />
              </HelpModal>
            )}

            {configModal === "history" && (
              <HelpModal title="History" onClose={() => setConfigModal(null)} width="min(460px, 92vw)">
                <div style={{ display: "grid", gap: 14 }}>
                  <div>
                    <label style={label}>Messages sent to model</label>
                    <input
                      type="number"
                      min={1}
                      max={200}
                      value={historyMessageLimit}
                      onChange={(e) => setHistoryMessageLimit(clampHistoryLimit(Number(e.target.value)))}
                      style={{ width: "100%", marginTop: 6, boxSizing: "border-box", ...selectStyle }}
                      data-tutorial-id="history-limit-input"
                    />
                  </div>
                  <div style={{ fontSize: 12, opacity: 0.7, lineHeight: 1.6 }}>
                    Default history is 10. Only the latest N messages are sent to the model. Retry 與 failover 目前由 Load Balancer instance 維護。
                  </div>
                  <div
                    style={{
                      display: "grid",
                      gap: 8,
                      paddingTop: 8,
                      borderTop: "1px solid var(--border)"
                    }}
                  >
                    <div style={{ fontSize: 12, opacity: 0.72, lineHeight: 1.6 }}>
                      危險操作：清空這個網站中 agent-go-round 自己建立的 localStorage 與 IndexedDB 內容，不會清除其他網站的資料。
                    </div>
                    <button type="button" onClick={() => void onResetAppData()} style={{ ...dangerMiniBtn, justifySelf: "start", padding: "8px 12px" }} data-tutorial-id="history-reset-all-data">
                      清空所有本網站資料
                    </button>
                  </div>
                </div>
              </HelpModal>
            )}

            {configModal === "team" && (
              <HelpModal title="S.C. MAGI Setup" onClose={() => setConfigModal(null)} width="min(560px, 92vw)">
                <div style={{ display: "grid", gap: 12 }}>
                  <div style={{ fontSize: 13, opacity: 0.78, lineHeight: 1.7 }}>
                    MAGI 模式會忽略目前的 Main Agent，固定尋找三個已存 agent：
                    <strong> {formatManagedMagiAgentName("Melchior")}</strong>、<strong>{formatManagedMagiAgentName("Balthasar")}</strong>、<strong>{formatManagedMagiAgentName("Casper")}</strong>。
                    請先確保三者都已設定好 load balancer；執行時系統只會使用各自的 MAGI 專屬 skill 與受控資源。
                  </div>
                  <div style={{ display: "grid", gap: 10 }}>
                    {magiSetup.map((entry) => {
                      const statusLabel = entry.ready
                        ? "READY"
                        : entry.issue === "missing"
                        ? "MISSING"
                        : entry.issue === "duplicate"
                        ? "DUPLICATE"
                        : "UNAVAILABLE";
                      const statusColor = entry.ready ? "var(--ok)" : "var(--danger)";
                      return (
                        <div
                          key={entry.unitId}
                          style={{
                            display: "grid",
                            gap: 6,
                            padding: 14,
                            borderRadius: 16,
                            border: `1px solid ${entry.ready ? "rgba(116,226,167,0.22)" : "rgba(255,140,155,0.22)"}`,
                            background: entry.ready ? "rgba(116,226,167,0.06)" : "rgba(255,140,155,0.05)"
                          }}
                        >
                          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
                            <div style={{ fontWeight: 800 }}>{formatMagiUnitTitle(entry.unitId)}</div>
                            <div style={{ fontSize: 12, fontWeight: 800, color: statusColor }}>{statusLabel}</div>
                          </div>
                          <div style={{ fontSize: 12, opacity: 0.82, lineHeight: 1.6 }}>
                            {entry.agent ? `Agent：${entry.agent.name}` : "Agent：未找到"}
                            {entry.agent?.loadBalancerId ? `\nLoad Balancer：${loadBalancerSlots.find((item) => item.id === entry.agent?.loadBalancerId)?.name ?? entry.agent.loadBalancerId}` : ""}
                            {entry.candidate ? `\nModel：${entry.candidate.instance.model || "-"}` : ""}
                            {entry.issue === "duplicate" ? `\n找到 ${entry.matches.length} 個同名 agent，請只保留一個。` : ""}
                            {entry.issue === "missing" ? `\n請新增一個名稱精確為 ${entry.unitId} 的 agent。` : ""}
                            {entry.issue === "load_balancer_missing" ? "\n請先設定 load balancer。" : ""}
                            {entry.issue === "load_balancer_unavailable" ? "\n目前沒有可用的 load balancer instance。" : ""}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </HelpModal>
            )}

            {configModal === "docs" && (
              <HelpModal title="Docs" onClose={() => setConfigModal(null)} width="min(560px, 96vw)">
                <DocsPanel
                  docs={docs}
                  selectedId={docEditorId}
                  onSelect={(id) => {
                    setDocEditorId(id);
                    if (id) {
                      const doc = docs.find((d) => d.id === id);
                      logNow({ category: "docs", message: `Doc selected: ${doc?.title ?? id}` });
                    }
                  }}
                  onCreate={onCreateDoc}
                  onSave={onSaveDoc}
                  onDelete={onDeleteDoc}
                />
              </HelpModal>
            )}

            {configModal === "mcp" && (
              <HelpModal title="MCP (SSE)" onClose={() => setConfigModal(null)} width="min(560px, 96vw)">
                <McpPanel
                  servers={mcpServers}
                  activeId={mcpPanelActiveId}
                  toolsByServer={mcpToolsByServer}
                  onChangeServers={onChangeMcpServers}
                  onSelectActive={(id) => {
                    setMcpPanelActiveId(id);
                    if (id) {
                      const server = mcpServers.find((s) => s.id === id);
                      logNow({ category: "mcp", message: `Active MCP -> ${server?.name ?? id}` });
                    }
                  }}
                  onUpdateTools={(id, tools) => {
                    setMcpToolsByServer((prev) => ({ ...prev, [id]: tools }));
                    const server = mcpServers.find((s) => s.id === id);
                    logNow({ category: "mcp", message: `Tools updated: ${server?.name ?? id}`, details: tools.map((t) => t.name).join("\n") });
                  }}
                  pushLog={pushLog}
                />
              </HelpModal>
            )}

            {configModal === "prompts" && (
              <HelpModal title="Prompt Templates" onClose={() => setConfigModal(null)} width="min(1100px, 96vw)">
                <PromptTemplatesPanel
                  files={promptTemplateFiles}
                  groups={promptTemplateRuntime.groups}
                  activeDecisionLanguage={mcpPromptTemplates.activeId}
                  onChangeActiveDecisionLanguage={(language) =>
                    setMcpPromptTemplates((prev) => ({ ...prev, activeId: language }))
                  }
                  onChangeFileContent={updatePromptTemplateFile}
                  onResetFile={resetPromptTemplateFile}
                  testStates={promptTemplateTestStates}
                  testsRunning={promptTemplateTestsRunning}
                  onRunApiTest={runPromptTemplateApiTest}
                  onRunAllApiTests={runAllPromptTemplateApiTests}
                />
              </HelpModal>
            )}

            {configModal === "skills" && (
              <HelpModal title="Skills" onClose={() => setConfigModal(null)} width="min(900px, 96vw)">
                <SkillsPanel
                  skills={skills}
                  selectedId={skillPanelSelectedId}
                  selectedDocs={skillPanelDocs}
                  selectedFiles={skillPanelFiles}
                  agents={agents}
                  activeAgentId={activeAgentId}
                  executionMode={skillExecutionMode}
                  verifyMax={skillVerifyMax}
                  toolLoopMax={skillToolLoopMax}
                  verifierAgentId={skillVerifierAgentId}
                  builtInTools={allBuiltInTools}
                  mcpToolCatalog={globalMcpToolCatalog}
                  onChangeExecutionMode={setSkillExecutionMode}
                  onChangeVerifyMax={(value) => setSkillVerifyMax(clampSkillVerifyMax(value))}
                  onChangeToolLoopMax={(value) => setSkillToolLoopMax(clampSkillToolLoopMax(value))}
                  onChangeVerifierAgentId={setSkillVerifierAgentId}
                  onSelect={setSkillPanelSelectedId}
                  onImport={onImportSkill}
                  onCreateEmpty={onCreateEmptySkill}
                  onDelete={onDeleteSkill}
                  onExport={onExportSkill}
                  onUpdateSkillMarkdown={onUpdateSkillMarkdown}
                  onUpsertTextFile={onUpsertSkillTextFile}
                  onDeleteTextFile={onDeleteSkillTextFile}
                />
              </HelpModal>
            )}

            {configModal === "tools" && (
              <HelpModal title="Built-in Tools" onClose={() => setConfigModal(null)} width="min(820px, 96vw)">
                <BuiltInToolsPanel systemTools={systemBuiltInTools} tools={builtInTools} onChange={setBuiltInTools} />
              </HelpModal>
            )}
          </div>
        )}

        {activeTab === "agents" && (
          <div className="content-grid">
            <div className="card panel">
              <AgentsPanel
                agents={agents}
                activeAgentId={activeAgentId}
                selectedAgentId={selectedAgentId}
                onSelect={setSelectedAgentId}
                onSetMain={(id) => {
                  setActiveAgentId(id);
                  setSelectedAgentId(id);
                }}
                onSave={onSaveAgent}
                onDelete={onDeleteAgent}
                onDetect={async (a) => {
                  const r = await detectWithLoadBalancer(a);
                  pushLog({
                    category: "detect",
                    agent: a.name,
                    ok: r.ok,
                    message: `${r.detectedType ?? ""} ${r.notes ?? ""}`.trim() || "detect()",
                    details: r.notes ?? undefined
                  });
                  return r;
                }}
                docs={docs}
                mcpServers={mcpServers}
                builtInTools={allBuiltInTools}
                skills={skills}
                loadBalancers={loadBalancerSlots}
                lockToMcpOnly={tutorialScenario?.id === "agent-browser-mcp-chat" && currentTutorialStep?.behavior === "enable_tutorial_mcp_access"}
              />
            </div>
          </div>
        )}

        {activeTab === "profile" && (
          <div className="content-grid">
            <div className="card panel" style={{ width: "100%", boxSizing: "border-box" }}>
              <div style={{ fontWeight: 800, fontSize: 18, marginBottom: 6 }}>Your Profile</div>
              <div style={{ fontSize: 13, opacity: 0.75, marginBottom: 16 }}>
                Set the name, 自我描述, and 大頭照 shown for your side of the conversation. Agents with permission can also call the user info tool to read this profile.
              </div>

              <label style={label}>Character name</label>
              <input
                value={userName}
                onChange={(e) => setUserName(e.target.value)}
                style={{ width: "100%", marginBottom: 14, ...selectStyle }}
                data-tutorial-id="profile-name-input"
              />

              <label style={label}>自我描述</label>
              <textarea
                value={userDescription}
                onChange={(e) => setUserDescription(e.target.value)}
                rows={4}
                style={{ width: "100%", marginBottom: 14, ...selectStyle, resize: "vertical" }}
                placeholder="例如：你是團隊 PM，偏好繁體中文、重視可執行的結論。"
                data-tutorial-id="profile-description-input"
              />

              <label style={label}>大頭照</label>
              <div style={{ display: "flex", gap: 14, alignItems: "center", marginTop: 6, flexWrap: "wrap" }}>
                {userAvatarUrl ? (
                  <img
                    src={userAvatarUrl}
                    alt={userName || "User avatar"}
                    style={{ width: 72, height: 72, borderRadius: 20, objectFit: "cover", border: "1px solid var(--border)" }}
                  />
                ) : (
                  <div
                    style={{
                      width: 72,
                      height: 72,
                      borderRadius: 20,
                      border: "1px solid var(--border)",
                      display: "grid",
                      placeItems: "center",
                      background: "linear-gradient(135deg, #f472b6, #8b5cf6)",
                      color: "white",
                      fontWeight: 800,
                      fontSize: 24
                    }}
                  >
                    {(userName.trim() || "Y").slice(0, 2).toUpperCase()}
                  </div>
                )}
                <div style={{ display: "grid", gap: 8 }}>
                  <input type="file" accept="image/*" onChange={(e) => readUserAvatar(e.target.files?.[0])} />
                  {userAvatarUrl ? (
                    <button onClick={() => setUserAvatarUrl(undefined)} style={{ ...selectStyle, cursor: "pointer" }}>
                      移除你的大頭照
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {isChatFullscreen && (
        <HelpModal
          title="全頁模式"
          onClose={() => setIsChatFullscreen(false)}
          width="min(1180px, calc(100vw - 24px))"
          height="calc(100dvh - 24px)"
          hideTitle
          footer={null}
          padless
        >
          <div className="chat-fullscreen-host">
            <ChatPanel
              history={history}
              onSend={onSend}
              onClear={() => {
                setHistory([]);
                setTutorialOpenedToolResultMessageIds([]);
                logNow({ category: "chat", message: "Chat cleared" });
              }}
              leaderName={null}
              userName={userProfile.name}
              modeLabel={mode === "one_to_one" ? "normal" : MAGI_MODE_LABELS[mode]}
              onExportRaw={exportRawHistory}
              onExportSummary={exportSummaryHistory}
              onImportHistory={importHistoryFile}
              isSummaryExporting={isSummaryExporting}
              fullscreen
              onCloseFullscreen={() => setIsChatFullscreen(false)}
              onOpenToolResult={(assistantMessageId) =>
                setTutorialOpenedToolResultMessageIds((current) =>
                  current.includes(assistantMessageId) ? current : [...current, assistantMessageId]
                )
              }
            />
          </div>
        </HelpModal>
      )}

      <div className="log-shell card">
        <div className="log-header">
          <div className="log-title">Log</div>
          <div className="log-actions">
            <button
              className="log-toggle"
              onClick={async () => {
                if (!visibleLogText.trim()) return;
                await copyText(visibleLogText);
              }}
            >
              Copy Visible
            </button>
            <button className="log-toggle" onClick={() => setLog([])}>
              Clear
            </button>
            <button className="log-toggle" onClick={() => setLogCollapsed((c) => !c)}>
              {logCollapsed ? "Expand" : "Collapse"}
            </button>
          </div>
        </div>
        {!logCollapsed && (
          <div className="log-body" style={{ height: logHeight }}>
            <div
              className="log-resize-handle"
              onMouseDown={(e) => {
                logResizeRef.current = { startY: e.clientY, startHeight: logHeight };
                document.body.style.userSelect = "none";
              }}
            />
            {log.length === 0 && <div className="log-empty">No logs yet.</div>}
            {log.length > 0 && (
              <div className="log-table">
                <div className="log-row log-row-head">
                  <button className="log-sort" onClick={() => setLogSort((s) => ({ key: "category", dir: s.key === "category" && s.dir === "asc" ? "desc" : "asc" }))}>
                    Category{logSort.key === "category" ? (logSort.dir === "asc" ? " ^" : " v") : ""}
                  </button>
                  <button className="log-sort" onClick={() => setLogSort((s) => ({ key: "agent", dir: s.key === "agent" && s.dir === "asc" ? "desc" : "asc" }))}>
                    Agent{logSort.key === "agent" ? (logSort.dir === "asc" ? " ^" : " v") : ""}
                  </button>
                  <button className="log-sort" onClick={() => setLogSort((s) => ({ key: "outcome", dir: s.key === "outcome" && s.dir === "asc" ? "desc" : "asc" }))}>
                    Outcome{logSort.key === "outcome" ? (logSort.dir === "asc" ? " ^" : " v") : ""}
                  </button>
                  <button className="log-sort" onClick={() => setLogSort((s) => ({ key: "requestId", dir: s.key === "requestId" && s.dir === "asc" ? "desc" : "asc" }))}>
                    Req{logSort.key === "requestId" ? (logSort.dir === "asc" ? " ^" : " v") : ""}
                  </button>
                  <button className="log-sort" onClick={() => setLogSort((s) => ({ key: "ts", dir: s.key === "ts" && s.dir === "asc" ? "desc" : "asc" }))}>
                    Time{logSort.key === "ts" ? (logSort.dir === "asc" ? " ^" : " v") : ""}
                  </button>
                  <button className="log-sort" onClick={() => setLogSort((s) => ({ key: "message", dir: s.key === "message" && s.dir === "asc" ? "desc" : "asc" }))}>
                    Log{logSort.key === "message" ? (logSort.dir === "asc" ? " ^" : " v") : ""}
                  </button>
                </div>
                {sortedLogEntries.map((item) => {
                    const outcome = item.outcome ?? inferLogOutcome(item);
                    const outcomeLabel = formatLogOutcomeLabel(outcome);
                    const tsLabel = new Date(item.ts).toLocaleString();
                    const detailsText = formatLogEntryForClipboard(item);
                    return (
                      <details key={item.id} className="log-row log-entry">
                        <summary className="log-summary">
                          <div className="log-cell log-category">{item.category}</div>
                          <div className="log-cell log-agent">{item.agent ?? "-"}</div>
                          <div className={`log-cell log-outcome ${outcome}`}>{outcomeLabel}</div>
                          <div className="log-cell log-request-id">{item.requestId ?? "-"}</div>
                          <div className="log-cell log-time">{tsLabel}</div>
                          <div className="log-cell log-message">{item.message}</div>
                        </summary>
                        <div className="log-details">
                          <div className="log-details-head">
                            <div className="log-details-label">Log</div>
                            <button
                              type="button"
                              className="log-copy-btn"
                              onClick={async (event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                await copyText(detailsText);
                              }}
                            >
                              Copy
                            </button>
                          </div>
                          <pre className="log-details-body">{detailsText}</pre>
                        </div>
                      </details>
                    );
                  })}
              </div>
            )}
          </div>
        )}
      </div>

      </div>
      )}
      {showTutorialExitPrompt && tutorialScenario ? (
        <HelpModal
          title={tutorialScenario.exitTitle}
          onClose={() => setShowTutorialExitPrompt(false)}
          width="min(560px, 92vw)"
          footer={
            <div style={{ display: "grid", gap: 8 }}>
              <div className="tutorial-exit-tooltip" style={{ justifySelf: "end" }}>
                <button type="button" className="tutorial-exit-tooltip-trigger" aria-label="保留教學變更注意事項">
                  保留變更注意事項
                </button>
                <div className="tutorial-exit-tooltip-bubble">{tutorialKeepChangesHint}</div>
              </div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "flex-end" }}>
                <button type="button" onClick={() => setShowTutorialExitPrompt(false)} style={iconActionBtn}>
                  繼續教學
                </button>
                <button type="button" onClick={() => void finishTutorial(false)} style={dangerMiniBtn}>
                  不保留資源(doc、tool、mcp、skill)
                </button>
                <button type="button" onClick={() => void finishTutorial(true)} style={iconActionBtn}>
                  保留這次教學變更
                </button>
              </div>
            </div>
          }
        >
          <div style={{ display: "grid", gap: 10 }}>
            <div style={{ fontSize: 13, lineHeight: 1.7, opacity: 0.9 }}>{tutorialScenario.exitBody}</div>
            <div style={{ fontSize: 12, lineHeight: 1.7, opacity: 0.72 }}>
              目前案例：<strong>{tutorialScenario.title}</strong>
              <br />
              進度：{tutorialStepIndex + 1} / {tutorialScenario.steps.length}
              <br />
              目前步驟：{currentTutorialStep?.checklistLabel ?? "—"}
            </div>
          </div>
        </HelpModal>
      ) : null}
      {tutorialUnavailableMessage ? (
        <HelpModal title="案例教學目前無法使用" onClose={() => setTutorialUnavailableMessage(null)} width="min(560px, 92vw)">
          <div style={{ fontSize: 13, lineHeight: 1.8, opacity: 0.92 }}>{tutorialUnavailableMessage}</div>
        </HelpModal>
      ) : null}
    </div>
  );
}

const label: React.CSSProperties = { fontSize: 12, opacity: 0.8 };

const selectStyle: React.CSSProperties = {
  padding: "8px 10px",
  borderRadius: 12,
  border: "1px solid var(--border)",
  background: "var(--bg-2)",
  color: "var(--text)"
};

const iconBtn: React.CSSProperties = {
  width: 40,
  height: 40,
  borderRadius: 12,
  border: "1px solid var(--border)",
  background: "var(--bg-2)",
  color: "var(--text)",
  display: "grid",
  placeItems: "center",
  cursor: "pointer",
  flex: "0 0 auto"
};

const iconActionBtn: React.CSSProperties = {
  padding: "8px 12px",
  borderRadius: 12,
  border: "1px solid var(--border)",
  background: "var(--panel-2)",
  color: "var(--text)",
  cursor: "pointer"
};

const dangerMiniBtn: React.CSSProperties = {
  padding: "6px 10px",
  borderRadius: 10,
  border: "1px solid #4a2026",
  background: "#1d1014",
  color: "white",
  cursor: "pointer"
};
