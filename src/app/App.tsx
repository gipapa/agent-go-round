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
  VoiceSettings,
  SkillExecutionMode,
  SkillStepDecision,
  SkillCompletionDecision,
  SkillPhase,
  SkillRunState,
  SkillTodoItem,
  DocItem,
  McpServerConfig,
  McpTool,
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
  McpPromptTemplates,
  loadLoadBalancers,
  loadMcpPromptTemplates,
  loadMcpServers,
  loadUiState,
  saveLoadBalancers,
  saveMcpPromptTemplates,
  saveMcpServers,
  saveUiState
} from "../storage/settingsStore";

import { OpenAICompatAdapter } from "../adapters/openaiCompat";
import { ChromePromptAdapter } from "../adapters/chromePrompt";
import { CustomAdapter } from "../adapters/custom";

import { runOneToOne } from "../orchestrators/oneToOne";
import { createInitialState as createMagiRenderState, MAGI_UNIT_LAYOUT, MagiPreparedUnit, runMagi } from "../orchestrators/magi";
import { McpClientManager } from "../mcp/clientManager";
import { formatMcpServerResolutionFailure, resolveMcpServerId } from "../mcp/serverResolver";
import { McpToolCatalog } from "../mcp/toolCatalog";
import { createToolDashboardHelpers } from "../utils/toolDashboard";

import AgentsPanel from "../ui/AgentsPanel";
import BuiltInToolsPanel from "../ui/BuiltInToolsPanel";
import ChatPanel from "../ui/ChatPanel";
import DocsPanel from "../ui/DocsPanel";
import ErrorBoundary from "../ui/ErrorBoundary";
import HelpModal from "../ui/HelpModal";
import LandingPage from "../ui/LandingPage";
import McpPanel from "../ui/McpPanel";
import SkillsPanel from "../ui/SkillsPanel";
import TutorialGuide from "../ui/TutorialGuide";
import LoadBalancersPanel from "../ui/LoadBalancersPanel";
import PromptTemplatesPanel from "../ui/PromptTemplatesPanel";
import VoiceConfigPanel from "../ui/VoiceConfigPanel";
import LogPanel from "../ui/LogPanel";
import CredentialsPanel from "../ui/CredentialsPanel";
import { getTutorialCatalogError, getTutorialScenario, tutorialCatalog } from "../onboarding/catalog";
import {
  findTutorialAgentBaseInList,
  findTutorialAgentInList,
  normalizeTutorialPrimaryAgentList,
  usesTutorialLoadBalancer
} from "../onboarding/agentManagement";
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
  TUTORIAL_PRIMARY_MODEL,
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
  ensureManagedMagiAgents,
  formatManagedMagiAgentName,
  formatMagiUnitTitle,
  isManagedMagiAgent,
  MAGI_MODE_LABELS,
  matchesManagedMagiUnit,
  normalizeManagedMagiAgent
} from "../magi/managedAgents";
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
import {
  buildBrowserHeuristicCompletion,
  buildBrowserHeuristicDecision,
  buildGroundedRepoSummaryAnswer,
  enrichActionBrowserObservation,
  goalWantsRepoSummary,
  hasGroundedRepoSummary,
  normalizeBrowserWorkflowStartUrl
} from "../runtime/browserWorkflow";
import { bootstrapTodoList, summarizeTodo } from "../runtime/skillTodo";
import {
  extractFirstUrl,
  inferExplicitToolDecision,
  normalizeToolDecisionAgainstAvailableTools,
  parseToolDecision,
  resolvePreferredBrowserHeadedMode,
  type ToolEntry
} from "../runtime/toolDecision";
import {
  buildObservationSignature,
  buildToolActionSignature,
  callMcpToolWithTimeout,
  classifyBuiltInToolIntent,
  classifyMcpToolIntent,
  getMcpToolTimeoutMs,
  type ToolIntent
} from "../runtime/toolExecution";
import { runLoadBalancedTask, runLoadBalancedTextTask } from "../runtime/loadBalancerRunner";
import { buildToolDecisionCatalog, buildToolDecisionPrompt } from "../runtime/toolDecisionPrompt";
import {
  buildPromptTemplateApiTestSpec,
  type PromptTemplateApiTestState
} from "../runtime/promptTemplateTests";
import {
  appendToolPromptSummary,
  asRecord,
  confirmedFromToolOutput,
  getThinkStreamingState,
  mergeSystemText,
  msg,
  normalizeImportedMessage,
  stringifyAny,
  stripPreviousToolPromptSummaries
} from "../runtime/chatMessages";
import { useAppLog } from "./useAppLog";
import { createLogRequestId } from "../runtime/logging";
import { fetchCredentialModels } from "../credentials/runtime";
import { useCredentialController } from "../credentials/useCredentialController";
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
import { resetAgentGoRoundStorage } from "../utils/resetAppStorage";
import type { ExecutionDeadline } from "../utils/deadline";
import { combineSignals, createDeadline } from "../utils/deadline";
import {
  normalizeVoiceSettings
} from "../voice/runtime";
import { useVoiceController } from "../voice/useVoiceController";
import {
  applyInstanceFailure,
  applyInstanceSuccess,
  createLoadBalancer,
  createLoadBalancerInstance,
  DEFAULT_INSTANCE_DELAY_SECOND,
  DEFAULT_INSTANCE_MAX_RETRIES,
  DEFAULT_INSTANCE_RESUME_MINUTE,
  migrateAgentsToLoadBalancers,
  resolveLoadBalancerCandidates,
  ResolvedLoadBalancerInstance,
  setLoadBalancerRetryPolicy
} from "../utils/loadBalancer";
import { buildAgentFailureContent, classifyRetryableAgentFailure, detectTerminalAgentFailure } from "../utils/agentFailure";
import {
  describeLoadBalancerAvailability,
  describeResolvedLoadBalancerCandidate
} from "../utils/loadBalancerDiagnostics";
import { extractJsonObject } from "../utils/safeJson";
import { errorMessage } from "../utils/errors";
import {
  normalizeSkillBootstrapPlan,
  normalizeSkillDecision,
  type BuiltInToolAction,
  type McpAction,
  type SkillBootstrapPlan,
  type SkillDecision,
  type ToolDecision
} from "../schemas/decisions";

const DEFAULT_EXECUTION_DEADLINE_MS = 5 * 60 * 1000;
const DEFAULT_MAGI_ROUND_TIMEOUT_MS = 60 * 1000;
const DEFAULT_MAGI_UNIT_TIMEOUT_MS = 30 * 1000;

function normalizeExecutionDeadlineMs(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_EXECUTION_DEADLINE_MS;
  return Math.max(10_000, Math.min(30 * 60 * 1000, Math.round(numeric)));
}

function pickAdapter(a: AgentConfig) {
  if (a.type === "chrome_prompt") return ChromePromptAdapter;
  if (a.type === "custom") return CustomAdapter;
  return OpenAICompatAdapter;
}

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

type AssistantResponseFormatResult = {
  displayContent: string;
  spokenContent?: string;
};

type OneToOneTurnResult = {
  requestId: string;
  status: "success" | "degraded" | "failure";
  displayContent: string;
  spokenContent?: string;
};

type ExportPayload =
  | { kind: "raw_history"; exportedAt: number; history: ChatMessage[] }
  | { kind: "summary_history"; exportedAt: number; summary: string; agent?: { id?: string; name?: string; model?: string } };

type ActiveTab = "chat" | "chat_config" | "agents" | "profile";
type UserProfile = { name: string; avatarUrl?: string; description?: string };
type AppEntryMode = "landing" | "workspace";
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
  toolOutput?: unknown;
  browserObservation?: BrowserObservationDigest | null;
  serverId?: string;
};

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

function isCategoryEnabled(flag: boolean | undefined) {
  return flag !== false;
}

export default function App() {
  const [appEntryMode, setAppEntryMode] = useState<AppEntryMode>("landing");
  const initialUi = loadUiState();
  const executionDeadlineMs = normalizeExecutionDeadlineMs(initialUi.executionDeadlineMs);
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
  const [voiceSettings, setVoiceSettings] = useState<VoiceSettings>(() => normalizeVoiceSettings(initialUi.voiceSettings ?? initialUi.radioSettings));
  const [isSummaryExporting, setIsSummaryExporting] = useState(false);

  type ConfigModalKey = "agent" | "credentials" | "mode" | "history" | "docs" | "mcp" | "skills" | "tools" | "team" | "load_balancers" | "prompts" | "voice" | null;
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
  const mcpClientManager = useMemo(() => new McpClientManager(), []);
  const mcpToolCatalogCache = useMemo(() => new McpToolCatalog(), []);
  const globalMcpToolCatalog = useMemo(
    () =>
      mcpServers.map((server) => ({
        server,
        tools: mcpToolsByServer[server.id] ?? []
      })),
    [mcpServers, mcpToolsByServer]
  );
  const { entries: log, pushLog, clearLog } = useAppLog();
  const credentialController = useCredentialController({ pushLog });
  const {
    modelCredentials,
    setModelCredentials,
    credentialSlots,
    configuredCredentialCount,
    credentialTestResults
  } = credentialController;
  const promptTemplateRuntime = useMemo(() => buildPromptTemplateRuntime(promptTemplateFiles), [promptTemplateFiles]);
  const [tutorialScenario, setTutorialScenario] = useState<TutorialScenarioDefinition | null>(null);
  const [tutorialScenarioIndex, setTutorialScenarioIndex] = useState<number | null>(null);
  const [tutorialStepIndex, setTutorialStepIndex] = useState(0);
  const [showTutorialExitPrompt, setShowTutorialExitPrompt] = useState(false);
  const [tutorialUnavailableMessage, setTutorialUnavailableMessage] = useState<string | null>(null);
  const [tutorialComposerSeed, setTutorialComposerSeed] = useState<{ value: string; token: number } | null>(null);
  const [tutorialOpenedToolResultMessageIds, setTutorialOpenedToolResultMessageIds] = useState<string[]>([]);
  const logNow = pushLog;
  const mcpCountRef = React.useRef(mcpServers.length);
  const tutorialSnapshotRef = React.useRef<TutorialWorkspaceSnapshot | null>(null);
  const tutorialStepKeyRef = React.useRef("");
  const tutorialHistoryLimitRestoreRef = React.useRef<number | null>(null);
  const tutorialLoadBalancerRetryRestoreRef = React.useRef<Record<string, Array<{ instanceId: string; maxRetries: number; delaySecond: number; resumeMinute: number }>> | null>(null);
  const activeChatAbortRef = React.useRef<AbortController | null>(null);
  const skillExecutionLocksRef = React.useRef<Map<string, AbortController>>(new Map());
  const tutorialRestoringRef = React.useRef(false);
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
    (async () => {
      try {
        const list = await listDocs();
        setDocs(list);
        setDocsLoaded(true);
        logNow({ category: "docs", ok: true, message: `Docs loaded: ${list.length}` });
      } catch (e) {
        logNow({ category: "docs", ok: false, message: "Docs load failed", details: errorMessage(e) });
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
      } catch (e) {
        logNow({ category: "skills", ok: false, message: "Skills load failed", details: errorMessage(e) });
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
      } catch (e) {
        if (!cancelled) {
          setSkillPanelDocs([]);
          setSkillPanelFiles([]);
          logNow({ category: "skills", ok: false, message: "Skill docs load failed", details: errorMessage(e) });
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
      } catch (e) {
        if (cancelled) return;
        logNow({ category: "chat", ok: false, message: "History restore failed", details: errorMessage(e) });
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
    if ((mode !== "magi_vote" && mode !== "magi_consensus") || activeTab !== "chat") return;
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
      executionDeadlineMs,
      historyMessageLimit,
      userName,
      userAvatarUrl,
      userDescription,
      voiceSettings
    });
  }, [activeTab, mode, skillExecutionMode, skillVerifyMax, skillToolLoopMax, skillVerifierAgentId, activeAgentId, executionDeadlineMs, historyMessageLimit, userName, userAvatarUrl, userDescription, voiceSettings]);

  React.useEffect(() => {
    saveMcpServers(mcpServers);
  }, [mcpServers]);

  React.useEffect(() => {
    return () => {
      mcpClientManager.closeAll();
    };
  }, [mcpClientManager]);

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
    saveLoadBalancers(loadBalancers);
  }, [loadBalancers]);

  React.useEffect(() => {
    if (!historyLoaded) return;
    let cancelled = false;
    (async () => {
      try {
        await saveChatHistory(history);
      } catch (e) {
        if (cancelled) return;
        logNow({ category: "chat", ok: false, message: "History persist failed", details: errorMessage(e) });
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

  const loadBalancerSlots = useMemo(() => loadBalancers.slice().sort((a, b) => a.name.localeCompare(b.name)), [loadBalancers]);
  const configuredLoadBalancerCount = useMemo(
    () => loadBalancerSlots.filter((entry) => entry.instances.length > 0).length,
    [loadBalancerSlots]
  );
  const voiceSttLoadBalancer = useMemo(
    () => loadBalancerSlots.find((entry) => entry.id === voiceSettings.sttLoadBalancerId) ?? null,
    [loadBalancerSlots, voiceSettings.sttLoadBalancerId]
  );
  const voiceTtsLoadBalancer = useMemo(
    () => loadBalancerSlots.find((entry) => entry.id === voiceSettings.ttsLoadBalancerId) ?? null,
    [loadBalancerSlots, voiceSettings.ttsLoadBalancerId]
  );
  const {
    dictationStatus: voiceDictationStatus,
    playbackMessageId: voicePlaybackMessageId,
    error: voiceError,
    probeState: voiceProbeState,
    toggleDictation: toggleVoiceDictation,
    playMessage: playMessageTts,
    testStt: testVoiceSttLoadBalancer,
    testTts: testVoiceTtsLoadBalancer
  } = useVoiceController({
    settings: voiceSettings,
    sttLoadBalancerId: voiceSttLoadBalancer?.id,
    ttsLoadBalancerId: voiceTtsLoadBalancer?.id,
    activeAgentName: activeAgent?.name,
    runTask: runVoiceTaskWithLoadBalancer,
    pushLog,
    onTranscript: (transcript) => {
      const current = chatComposerDraft.trimEnd();
      const next = current ? `${current} ${transcript}` : transcript;
      setChatComposerDraft(next);
      setTutorialComposerSeed({ value: next, token: Date.now() });
    }
  });

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

  React.useEffect(() => {
    setVoiceSettings((prev) => {
      let changed = false;
      const next = { ...prev };
      if (next.sttLoadBalancerId && !loadBalancerSlots.some((entry) => entry.id === next.sttLoadBalancerId)) {
        next.sttLoadBalancerId = loadBalancerSlots[0]?.id ?? "";
        changed = true;
      }
      if (next.ttsLoadBalancerId && !loadBalancerSlots.some((entry) => entry.id === next.ttsLoadBalancerId)) {
        next.ttsLoadBalancerId = loadBalancerSlots[0]?.id ?? "";
        changed = true;
      }
      if (!next.sttLoadBalancerId && loadBalancerSlots.length === 1) {
        next.sttLoadBalancerId = loadBalancerSlots[0].id;
        changed = true;
      }
      if (!next.ttsLoadBalancerId && loadBalancerSlots.length === 1) {
        next.ttsLoadBalancerId = loadBalancerSlots[0].id;
        changed = true;
      }
      return changed ? normalizeVoiceSettings(next) : prev;
    });
  }, [loadBalancerSlots]);

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

  async function runVoiceTaskWithLoadBalancer<T>(args: {
    loadBalancerId?: string;
    requestId?: string;
    stage: string;
    voiceModel: string;
    execute: (candidate: ResolvedLoadBalancerInstance) => Promise<T>;
    describeSuccess?: (result: T) => string;
  }) {
    const agentName = activeAgent?.name ?? "Voice";
    const logicalAgent: AgentConfig = {
      id: `voice-${args.stage}`,
      name: agentName,
      type: "openai_compat",
      loadBalancerId: args.loadBalancerId
    };
    const candidates = resolveLoadBalancerPlanForAgent(logicalAgent);
    const candidateDetails = (candidate: ResolvedLoadBalancerInstance) =>
      [describeResolvedLoadBalancerCandidate(candidate), `voice_model=${args.voiceModel}`].join("\n\n");
    return await runLoadBalancedTask({
      agentName,
      requestId: args.requestId,
      stage: args.stage,
      candidates,
      noCandidateDetails: describeLoadBalancerAvailability({ agent: logicalAgent, loadBalancers, credentials: modelCredentials }),
      noCandidateError: `No available load balancer instance for ${args.stage}.`,
      unknownFailureError: "Unknown voice load balancer failure.",
      pushLog: logNow,
      execute: args.execute,
      selectionDetails: candidateDetails,
      errorDetails: candidateDetails,
      successDetails: (candidate, result) => [candidateDetails(candidate), args.describeSuccess?.(result) ?? ""].filter(Boolean).join("\n\n"),
      markSuccess: (candidate) => setLoadBalancers((prev) => applyInstanceSuccess({
        loadBalancers: prev,
        loadBalancerId: candidate.loadBalancer.id,
        instanceId: candidate.instance.id
      })),
      markFailure: (candidate) => setLoadBalancers((prev) => applyInstanceFailure({
        loadBalancers: prev,
        loadBalancerId: candidate.loadBalancer.id,
        instanceId: candidate.instance.id
      }))
    });
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
    signal?: AbortSignal;
    timeoutMs?: number;
    deadline?: ExecutionDeadline;
  }) {
    args.deadline?.throwIfExpired(args.requestLabel ?? "chat response");
    const requestSignal = args.deadline ? combineSignals(args.signal, args.deadline.signal) : args.signal;
    const requestTimeoutMs = args.timeoutMs ?? (args.deadline ? Math.max(1, args.deadline.remainingMs()) : undefined);
    const requestLabel = args.requestLabel ?? "chat response";
    const candidates = resolveLoadBalancerPlanForAgent(args.logicalAgent);
    const executeForAgent = (agent: AgentConfig, retry: { delaySec: number; max: number }) => runOneToOne({
      adapter: pickAdapter(agent),
      agent,
      input: args.input,
      history: args.history,
      system: args.system,
      onDelta: args.onDelta,
      retry,
      onLog: args.onLog,
      signal: requestSignal,
      timeoutMs: requestTimeoutMs,
      deadline: args.deadline
    });
    return await runLoadBalancedTextTask({
      agentName: args.logicalAgent.name,
      requestId: args.requestId,
      stage: requestLabel,
      candidates,
      noCandidateDetails: describeLoadBalancerAvailability({ agent: args.logicalAgent, loadBalancers, credentials: modelCredentials }),
      pushLog: logNow,
      deadline: args.deadline,
      fallback: () => {
        const fallbackAgent = hydrateAgentCredentials(args.logicalAgent);
        return executeForAgent(fallbackAgent, getRetryPolicyForAgent(args.logicalAgent));
      },
      execute: (candidate) => executeForAgent(candidate.hydratedAgent, {
        delaySec: Math.max(0, candidate.instance.delaySecond),
        max: Math.max(0, candidate.instance.maxRetries)
      }),
      markSuccess: (candidate) => setLoadBalancers((prev) => applyInstanceSuccess({
        loadBalancers: prev,
        loadBalancerId: candidate.loadBalancer.id,
        instanceId: candidate.instance.id
      })),
      markFailure: (candidate) => setLoadBalancers((prev) => applyInstanceFailure({
        loadBalancers: prev,
        loadBalancerId: candidate.loadBalancer.id,
        instanceId: candidate.instance.id
      }))
    });
  }

  async function detectWithLoadBalancer(agent: AgentConfig): Promise<DetectResult> {
    const candidates = resolveLoadBalancerPlanForAgent(agent);
    if (!candidates.length) {
      logNow({
        category: "load_balancer",
        agent: agent.name,
        ok: false,
        message: "LB no available instance [detect]",
        details: describeLoadBalancerAvailability({
          agent,
          loadBalancers,
          credentials: modelCredentials
        })
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
        try {
          const tools = await mcpToolCatalogCache.load(
            server,
            mcpClientManager,
            (text) => pushLog({ category: "mcp", agent: server.name, requestId: options?.requestId, stage: "mcp_connect", message: text })
          );
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
        } catch (error) {
          logNow({
            category: "mcp",
            agent: server.name,
            ok: false,
            requestId: options?.requestId,
            stage: "mcp_tools_load",
            message: "Auto-load MCP tools failed",
            details: errorMessage(error)
          });
          return null;
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
    } catch (e) {
      logNow({ category: "agents", agent: a.name, ok: false, message: "Agent save failed", details: errorMessage(e) });
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
    } catch (e) {
      logNow({ category: "agents", agent: target?.name, ok: false, message: "Agent delete failed", details: errorMessage(e) });
    }
  }

  function append(m: ChatMessage) {
    setHistory((h) => [...h, m]);
  }

  function patchMessage(id: string, patch: Partial<ChatMessage>) {
    setHistory((h) => h.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  }

  function stopActiveChatExecution() {
    const controller = activeChatAbortRef.current;
    if (!controller || controller.signal.aborted) return;
    controller.abort(new Error("使用者中斷目前執行。"));
    logNow({ category: "chat", ok: false, outcome: "degraded", message: "Active chat execution aborted by user" });
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
    deadline?: ExecutionDeadline;
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
        deadline: args.deadline,
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

      const decision = parseToolDecision(raw);
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
    deadline?: ExecutionDeadline;
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
        deadline: args.deadline,
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
    deadline?: ExecutionDeadline;
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
        deadline: args.deadline,
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
    deadline?: ExecutionDeadline;
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
        deadline: args.deadline,
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
    deadline?: ExecutionDeadline;
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
        deadline: args.deadline,
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
    deadline?: ExecutionDeadline;
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
        deadline: args.deadline,
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
    deadline?: ExecutionDeadline;
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

    const explicitDecision = inferExplicitToolDecision({
      input: args.input,
      availableBuiltinTools: args.availableBuiltinTools,
      availableMcpTools: args.availableMcpTools
    });
    if (explicitDecision) {
      logNow({
        category: explicitDecision.type === "mcp_call" ? "mcp" : "tool",
        agent: args.agent.name,
        requestId: args.requestId,
        stage: "tool decision",
        outcome: "success",
        message: `Tool decision bypassed by explicit request: ${explicitDecision.tool}`,
        details: JSON.stringify(explicitDecision, null, 2)
      });
      return executeResolvedToolSelection({
        selection: explicitDecision,
        input: args.input,
        agent: args.agent,
        availableBuiltinTools: args.availableBuiltinTools,
        availableMcpServers: args.availableMcpServers,
        availableMcpTools: args.availableMcpTools,
        onStatus: args.onStatus,
        promptDetail: args.promptDetail ?? "default",
        requestId: args.requestId,
        deadline: args.deadline
      });
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
      requestId: args.requestId,
      deadline: args.deadline
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
      requestId: args.requestId,
      deadline: args.deadline
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
    deadline?: ExecutionDeadline;
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

        const toolOutput = await runBuiltInScriptTool(
          targetTool,
          normalizedDecision.input ?? {},
          {
            system: allowedSystemHelpers,
            ui: {
              dashboard: createToolDashboardHelpers()
            }
          },
          {
            signal: args.deadline?.signal
          }
        );
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
      } catch (e) {
        const briefError = errorMessage(e);
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

    const serverResolution = resolveMcpServerId({
      requestedServerId: normalizedDecision.serverId,
      toolName: normalizedDecision.tool,
      availableMcpTools: args.availableMcpTools
    });
    const resolvedMcpServerId = serverResolution.ok ? serverResolution.serverId : normalizedDecision.serverId;
    const actionSignature = buildToolActionSignature({
      kind: "mcp",
      serverId: resolvedMcpServerId,
      toolName: normalizedDecision.tool,
      input: normalizedDecision.input
    });
    const targetServer = args.availableMcpServers.find((server) => server.id === resolvedMcpServerId) ?? null;
    const targetTool =
      args.availableMcpTools.find((entry) => entry.server.id === resolvedMcpServerId)?.tools.find((tool) => tool.name === normalizedDecision.tool) ?? null;
    let toolSummaryForQuestion = "";
    args.onStatus?.(`正在呼叫 MCP 工具「${normalizedDecision.tool}」中…`);

    if (!serverResolution.ok) {
      const resolutionDetail = formatMcpServerResolutionFailure(serverResolution);
      toolSummaryForQuestion = `工具執行失敗：無法解析 MCP server（tool=${normalizedDecision.tool}, serverId=${normalizedDecision.serverId ?? "(none)"}, ${resolutionDetail}）。`;
      logNow({
        category: "mcp",
        agent: args.agent.name,
        ok: false,
        requestId: args.requestId,
        stage: "mcp_routing_fallback",
        message: `MCP server resolution failed: ${normalizedDecision.tool}`,
        details: JSON.stringify({ decision: normalizedDecision, resolution: serverResolution }, null, 2)
      });
      append(msg("tool", toolSummaryForQuestion, "mcp", { displayName: "MCP Tool" }));
      return {
        input: appendToolPromptSummary(args.input, toolSummaryForQuestion),
        ok: false,
        status: "tool_called",
        toolLabel: `MCP ${normalizedDecision.serverId ?? "unknown"} -> ${normalizedDecision.tool}`,
        detail: toolSummaryForQuestion,
        actionSignature
      };
    }

    const requestedServerId = String(normalizedDecision.serverId ?? "").trim();
    if (requestedServerId && requestedServerId !== serverResolution.serverId) {
      logNow({
        category: "mcp",
        agent: args.agent.name,
        ok: true,
        requestId: args.requestId,
        stage: "mcp_routing_fallback",
        message: `MCP serverId corrected: ${requestedServerId} -> ${serverResolution.serverId}`,
        details: JSON.stringify({ decision: normalizedDecision, resolution: serverResolution }, null, 2)
      });
    }

    if (!targetServer) {
      toolSummaryForQuestion = `工具執行失敗：找不到 serverId=${resolvedMcpServerId} 的可用 MCP server。`;
      logNow({
        category: "mcp",
        agent: args.agent.name,
        ok: false,
        requestId: args.requestId,
        stage: "tool execution",
        message: `Tool decision selected unavailable server: ${resolvedMcpServerId}`,
        details: JSON.stringify(normalizedDecision)
      });
      append(msg("tool", toolSummaryForQuestion, "mcp", { displayName: "MCP Tool" }));
      return {
        input: appendToolPromptSummary(args.input, toolSummaryForQuestion),
        ok: false,
        status: "tool_called",
        toolLabel: `MCP ${resolvedMcpServerId ?? "unknown"} -> ${normalizedDecision.tool}`,
        detail: toolSummaryForQuestion,
        actionSignature
      };
    }

    if (!targetTool) {
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
      return {
        input: appendToolPromptSummary(args.input, toolSummaryForQuestion),
        ok: false,
        status: "tool_called",
        toolLabel: `MCP ${targetServer.name} -> ${normalizedDecision.tool}`,
        detail: toolSummaryForQuestion,
        actionSignature
      };
    }

    try {
      const timeoutMs = getMcpToolTimeoutMs(targetServer, normalizedDecision.tool);
      const toolOutput = await mcpClientManager.run(
        targetServer,
        (client) => callMcpToolWithTimeout(client, normalizedDecision.tool, normalizedDecision.input ?? {}, timeoutMs),
        (t) => pushLog({ category: "mcp", agent: targetServer.name, requestId: args.requestId, stage: "tool execution", message: t })
      );
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
        toolLabel: `MCP ${targetServer.name} -> ${normalizedDecision.tool}`,
        detail: toolSummaryForQuestion,
        actionSignature,
        toolIntent,
        observationSignature: toolIntent === "observe" ? buildObservationSignature(toolOutput) : undefined,
        decisionSummary: `mcp:${targetServer.name}/${normalizedDecision.tool}\ninput:\n${stringifyAny(normalizedDecision.input ?? {})}`,
        toolOutput,
        browserObservation,
        serverId: targetServer.id
      };
    } catch (e) {
      const briefError = errorMessage(e);
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
    }

    return toolSummaryForQuestion
      ? {
          input: appendToolPromptSummary(args.input, toolSummaryForQuestion),
          ok: false,
          status: "tool_called",
          toolLabel: `MCP ${targetServer.name} -> ${normalizedDecision.tool}`,
          detail: toolSummaryForQuestion,
          actionSignature
        }
      : { input: args.input, ok: false, status: "no_tool", detail: "沒有產生可回填的工具摘要。" };
  }

  async function prepareSkillExecution(args: {
    skill: SkillConfig;
    skillInput: unknown;
    userInput: string;
    agent: AgentConfig;
    adapter: ReturnType<typeof pickAdapter>;
    availableBuiltinTools: BuiltInToolConfig[];
    availableMcpServers: McpServerConfig[];
    availableMcpTools: Array<{ server: McpServerConfig; tools: McpTool[] }>;
    deferToolDecision?: boolean;
    onStatus?: (text: string) => void;
    requestId?: string;
    deadline?: ExecutionDeadline;
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
            requestId: args.requestId,
            deadline: args.deadline
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
    deadline?: ExecutionDeadline;
  }): Promise<{ finalInput: string; trace: ChatTraceEntry[]; todo: SkillTodoItem[]; phase: SkillPhase; finalAnswerOverride?: string }> {
    if (skillExecutionLocksRef.current.has(args.skill.id)) {
      throw new Error(`Skill「${args.skill.name}」正在執行中，請等待目前執行完成或先停止。`);
    }
    const lockController = new AbortController();
    skillExecutionLocksRef.current.set(args.skill.id, lockController);
    const skillDeadline = args.deadline
      ? createDeadline({
          totalMs: Math.max(1, args.deadline.remainingMs()),
          externalSignal: combineSignals(args.deadline.signal, lockController.signal),
          label: `skill ${args.skill.name}`
        })
      : undefined;
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

    const resolveScopedMcpServerId = (toolName: string, preferredServerId?: string | null) => {
      const resolution = resolveMcpServerId({
        requestedServerId: preferredServerId,
        toolName,
        availableMcpTools: args.prepared.scopedMcpTools
      });
      return resolution.ok ? resolution.serverId : null;
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
      const serverId = resolveScopedMcpServerId(decision.toolName, preferredServerId);
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
          const input = selection.input && typeof selection.input === "object" ? (selection.input as Record<string, unknown>) : {};
          const message = String(input.message ?? reason).trim() || reason;
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

    let trace = [...args.initialTrace];

    async function runRuntimePass(initialInput: string, initialTrace: ChatTraceEntry[]) {
      return await runMultiTurnSkillRuntime({
        skill: args.skill,
        runtime: args.prepared.runtime,
        userInput: args.userInput,
        initialInput,
        initialTrace,
        toolLoopMax: skillToolLoopMax,
        deadline: skillDeadline ?? args.deadline,
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
              deadline: skillDeadline ?? args.deadline,
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
              resolveMcpServerId: (toolName) => resolveScopedMcpServerId(toolName, state.preferredMcpServerId)
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
              const browserOpenServerId = resolveScopedMcpServerId("browser_open", state.preferredMcpServerId);
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
                fallbackPromptTemplate: getDefaultPromptTemplate(`tool-decision.${mcpPromptTemplates.activeId}`),
                requestId: args.requestId,
                deadline: skillDeadline ?? args.deadline
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
              deadline: skillDeadline ?? args.deadline,
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
              promptDetail: "actionable",
              deadline: skillDeadline ?? args.deadline
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
              promptDetail: "actionable",
              deadline: skillDeadline ?? args.deadline
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
              confirmed: confirmedFromToolOutput(result.toolOutput),
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
              promptDetail: "actionable",
              deadline: skillDeadline ?? args.deadline
            });

            return {
              context: manualResult.input,
              failed: manualResult.ok === false,
              detail: manualResult.detail ?? decision.message,
              toolLabel: manualResult.toolLabel,
              actionSignature: manualResult.actionSignature,
              confirmed: confirmedFromToolOutput(manualResult.toolOutput),
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
                deadline: skillDeadline ?? args.deadline,
                onTrace: (label, content) => {
                  pushSkillTrace(trace, label, content);
                  updateAssistantProgress(state.todo, "completion_gate", trace);
                }
              });
            }
        }
      });
    }

    try {
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
    const completeRemainingTodo = (todo: SkillTodoItem[], reason: string) =>
      todo.map((item) =>
        item.status === "completed" || item.status === "blocked"
          ? item
          : {
              ...item,
              status: "completed" as const,
              reason: item.reason ?? reason,
              updatedAt: Date.now()
            }
      );

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
      currentTodo = completeRemainingTodo(currentTodo, "Grounded browser observation produced the final answer.");
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
      deadline: skillDeadline ?? args.deadline,
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
        requestId: args.requestId,
        deadline: skillDeadline ?? args.deadline
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
        currentTodo = completeRemainingTodo(currentTodo, "Grounded browser observation produced the final answer.");
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
        deadline: skillDeadline ?? args.deadline,
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
    } finally {
      skillDeadline?.dispose();
      const currentLock = skillExecutionLocksRef.current.get(args.skill.id);
      if (currentLock === lockController) {
        skillExecutionLocksRef.current.delete(args.skill.id);
      }
    }
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

  async function sendOneToOneTurn(args: {
    displayInput: string;
    modelInput?: string;
    requestId?: string;
    startedAt?: number;
    extraSystem?: string;
    modeForLog?: "one_to_one";
    responseFormatter?: (raw: string) => AssistantResponseFormatResult;
    statusText?: {
      preparing?: string;
      responding?: string;
    };
    deadline?: ExecutionDeadline;
  }): Promise<OneToOneTurnResult> {
    const oneToOneAgent = activeAgent;
    if (!oneToOneAgent) {
      throw new Error("No active agent selected.");
    }

    const startedAt = args.startedAt ?? Date.now();
    const requestId = args.requestId ?? createLogRequestId("chat");
    const input = args.displayInput;
    const modelInput = args.modelInput ?? args.displayInput;
    const logMode = args.modeForLog ?? "one_to_one";
    const docBlocks = docsForAgent.map((d) => `[DOC:${d.title}]\n${d.content}`).join("\n\n");
    const userSystem = docBlocks ? `You may use these documents as context:\n\n${docBlocks}` : undefined;
    const baseSystem = mergeSystemText(userSystem, args.extraSystem);

    logNow({
      category: "chat",
      agent: oneToOneAgent.name,
      requestId,
      stage: "request_start",
      message: `Send (${logMode})`,
      details: modelInput
    });
    logNow({
      category: "chat",
      agent: oneToOneAgent.name,
      requestId,
      stage: "context_prepare",
      message: "Context prepared",
      details: `docs=${docsForAgent.length} history=${history.length}`
    });

    const userMsg = msg("user", input, "user", { displayName: userProfile.name, avatarUrl: userProfile.avatarUrl });
    append(userMsg);
    const assistantId = generateId();
    append({
      id: assistantId,
      role: "assistant",
      content: "",
      ts: Date.now(),
      name: oneToOneAgent.name,
      displayName: oneToOneAgent.name,
      avatarUrl: oneToOneAgent.avatarUrl,
      statusText: args.statusText?.preparing ?? "準備回覆中…",
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

    logNow({ category: "chat", agent: oneToOneAgent.name, requestId, stage: "request_start", message: "normal talking started" });

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
    let finalInput = modelInput;
    let finalSystem = baseSystem;
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
        requestId,
        deadline: args.deadline
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
        userInput: modelInput,
        retry: getRetryPolicyForAgent(resolvedActiveAgent),
        skills: availableSkillsForAgent,
        language: mcpPromptTemplates.activeId,
        promptTemplate: promptTemplateRuntime.resolve("skill-decision", mcpPromptTemplates.activeId).template,
        requestId,
        deadline: args.deadline
      });

      if (!skillDecision) {
        pushSkillTrace(skillTrace, "Skill decision", `可用 skills：${availableSkillsForAgent.length} 個\n結果：skill decision 重試後仍失敗，改走一般 tool decision。`);
        logNow({ category: "skills", agent: oneToOneAgent.name, ok: false, requestId, stage: "skill decision", message: "Skill decision failed after retries; continue without skills" });
        finalInput = await resolveToolAugmentedInputForSend({
          input: modelInput,
          onStatus: setAssistantStatus
        });
      } else if (skillDecision.type === "no_skill") {
        pushSkillTrace(skillTrace, "Skill decision", `可用 skills：${availableSkillsForAgent.length} 個\n結果：這一回合不使用 skill。`);
        logNow({ category: "skills", agent: oneToOneAgent.name, requestId, stage: "skill decision", message: "Skill decision resolved: no_skill" });
        finalInput = await resolveToolAugmentedInputForSend({
          input: modelInput,
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
            input: modelInput,
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
            userInput: modelInput,
            agent: resolvedActiveAgent,
            adapter,
            availableBuiltinTools: availableBuiltinToolsForAgent,
            availableMcpServers: availableMcpServersForAgent,
            availableMcpTools: resolvedMcpToolsForAgent,
            deferToolDecision: skillExecutionMode === "multi_turn",
            onStatus: setAssistantStatus,
            requestId,
            deadline: args.deadline
          });
          preparedSkillExecution = prepared;
          selectedSkillForExecution = selectedSkill;
          finalInput = prepared.finalInput;
          finalSystem = mergeSystemText(prepared.system, args.extraSystem);
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
        input: modelInput,
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
          userInput: modelInput,
          assistantMessageId: assistantId,
          onStatus: setAssistantStatus,
          requestId,
          deadline: args.deadline
        });
        finalInput = executed.finalInput;
        finalSystem = mergeSystemText(preparedSkillExecution.system, args.extraSystem);
        patchMessage(assistantId, {
          skillTrace: executed.trace.length ? executed.trace : undefined,
          skillGoal: modelInput,
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
            skillGoal: modelInput,
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
          return {
            requestId,
            status: runtimeOverrideFailed ? "failure" : "success",
            displayContent: executed.finalAnswerOverride
          };
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
      skillGoal: selectedSkillForExecution && skillExecutionMode === "multi_turn" ? modelInput : undefined,
      statusText: args.statusText?.responding ?? "正在生成回覆中…",
      isStreaming: true
    });

    let sawDelta = false;
    let buffered = "";
    const onDelta = (text: string) => {
      buffered += text;
      const thinkState = getThinkStreamingState(buffered);
      patchMessage(assistantId, {
        content: buffered,
        hideWhileStreaming: thinkState.hideWhileStreaming,
        statusText: thinkState.statusText ?? (sawDelta ? args.statusText?.responding : undefined),
        isStreaming: true
      });
      if (!sawDelta && text) {
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
      deadline: args.deadline,
      onDelta,
      onLog: (text) => pushLog({ category: "retry", agent: oneToOneAgent.name, requestId, stage: "chat response", message: text })
    });
    const terminalFailure = detectTerminalAgentFailure(full);
    if (terminalFailure) {
      const failureContent = buildAgentFailureContent(terminalFailure, modelInput);
      finalizeAssistant({
        content: failureContent,
        skillTrace: skillTrace.length ? skillTrace : undefined,
        skillGoal: selectedSkillForExecution && skillExecutionMode === "multi_turn" ? modelInput : undefined
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
      return {
        requestId,
        status: "failure",
        displayContent: failureContent
      };
    }
    if (!String(full ?? "").trim()) {
      const latestToolResult = latestToolAugmentation as ToolAugmentationResult | null;
      const fallbackContent = buildEmptyResponseFallbackContent(modelInput, latestToolResult, selectedSkillForExecution);
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
        skillGoal: selectedSkillForExecution && skillExecutionMode === "multi_turn" ? modelInput : undefined
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
      return {
        requestId,
        status: fallbackContent.startsWith("【執行失敗】") ? "failure" : "degraded",
        displayContent: fallbackContent
      };
    }

    const formatted = args.responseFormatter ? args.responseFormatter(full) : { displayContent: full };
    finalizeAssistant({
      content: formatted.displayContent,
      skillTrace: skillTrace.length ? skillTrace : undefined,
      skillGoal: selectedSkillForExecution && skillExecutionMode === "multi_turn" ? modelInput : undefined
    });
    logNow({
      category: "chat",
      agent: oneToOneAgent.name,
      ok: true,
      requestId,
      stage: "final",
      outcome: "success",
      message: "normal talking completed",
      details: `elapsed_ms=${Date.now() - startedAt}\nresponse_len=${formatted.displayContent.length}\n\n${formatted.displayContent}`
    });
    return {
      requestId,
      status: "success",
      displayContent: formatted.displayContent,
      spokenContent: formatted.spokenContent
    };
  }

  async function onSend(input: string) {
    if (tutorialRestoringRef.current) {
      logNow({ category: "tutorial", ok: false, message: "Send skipped: tutorial restore in progress", details: input });
      append(msg("assistant", "Tutorial 正在恢復工作區，請稍候再送出。", "system", { displayName: "System" }));
      return;
    }
    if (activeChatAbortRef.current && !activeChatAbortRef.current.signal.aborted) {
      logNow({ category: "chat", ok: false, message: "Send skipped: another chat execution is running", details: input });
      return;
    }
    if (mode === "one_to_one") {
      if (!activeAgent) {
        logNow({ category: "chat", ok: false, message: "Send skipped: no active agent", details: input });
        return;
      }
      const controller = new AbortController();
      activeChatAbortRef.current = controller;
      const deadline = createDeadline({
        totalMs: executionDeadlineMs,
        externalSignal: controller.signal,
        label: "chat execution"
      });
      try {
        await sendOneToOneTurn({
          displayInput: input,
          modelInput: input,
          startedAt: Date.now(),
          modeForLog: "one_to_one",
          deadline
        });
      } catch (e) {
        const message = errorMessage(e);
        const errorText = buildAgentFailureContent(message, input);
        append(msg("assistant", errorText, "system", { displayName: "System" }));
        logNow({
          category: "chat",
          agent: activeAgent?.name,
          ok: false,
          stage: "final",
          outcome: "failure",
          message: "Send failed",
          details: message
        });
      } finally {
        deadline.dispose();
        if (activeChatAbortRef.current === controller) {
          activeChatAbortRef.current = null;
        }
      }
      return;
    }

    const startedAt = Date.now();
    const requestId = createLogRequestId("magi");
    const controller = new AbortController();
    activeChatAbortRef.current = controller;
    const deadline = createDeadline({
      totalMs: executionDeadlineMs,
      externalSignal: controller.signal,
      label: "MAGI execution"
    });
    const userMsg = msg("user", input, "user", { displayName: userProfile.name, avatarUrl: userProfile.avatarUrl });
    append(userMsg);
    const modelHistory = limitHistory([...history, userMsg]);
    let streamingAssistantId: string | null = null;

    try {
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
        deadline,
        roundTimeoutMs: DEFAULT_MAGI_ROUND_TIMEOUT_MS,
        unitTimeoutMs: DEFAULT_MAGI_UNIT_TIMEOUT_MS,
        invokeUnit: async ({ unit, prompt, requestLabel, signal, timeoutMs }) => {
          return await runOneToOneWithLoadBalancer({
            logicalAgent: unit.agent,
            input: prompt,
            history: [],
            system: unit.system,
            requestId,
            requestLabel,
            signal,
            timeoutMs,
            deadline,
            onDelta: () => {},
            onLog: (text) => pushLog({ category: "retry", agent: unit.agent.name, requestId, stage: requestLabel, message: text })
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
            message: [entry.unitId ? `unit=${entry.unitId}` : "", entry.round ? `round=${entry.round}` : "", entry.message]
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
    } catch (e) {
      const message = errorMessage(e);
      const errorText = buildAgentFailureContent(message, input);
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
        category: "magi",
        agent: "S.C. MAGI",
        ok: false,
        requestId,
        stage: "final",
        outcome: "failure",
        message: "Send failed",
        details: message
      });
    } finally {
      deadline.dispose();
      if (activeChatAbortRef.current === controller) {
        activeChatAbortRef.current = null;
      }
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
    } catch (e) {
      logNow({ category: "docs", ok: false, message: "Doc create failed", details: errorMessage(e) });
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
    } catch (e) {
      logNow({ category: "docs", ok: false, message: "Doc save failed", details: errorMessage(e) });
    }
  }

  async function onDeleteDoc(id: string) {
    try {
      await deleteDoc(id);
      setDocs(await listDocs());
      if (docEditorId === id) setDocEditorId(null);
      logNow({ category: "docs", ok: true, message: "Doc deleted", details: id });
    } catch (e) {
      logNow({ category: "docs", ok: false, message: "Doc delete failed", details: errorMessage(e) });
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
      return prevItem && (
        prevItem.sseUrl !== s.sseUrl ||
        prevItem.transport !== s.transport ||
        prevItem.authToken !== s.authToken ||
        JSON.stringify(prevItem.customHeaders ?? {}) !== JSON.stringify(s.customHeaders ?? {}) ||
        prevItem.useLocalProxy !== s.useLocalProxy
      );
    });
    [...removed, ...urlChanged].forEach((server) => {
      mcpClientManager.invalidate(server.id);
      mcpToolCatalogCache.invalidate(server.id);
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
    } catch (error) {
      const message = errorMessage(error);
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
    } catch (e) {
      logNow({ category: "chat", agent: activeAgent.name, ok: false, requestId, stage: "summary export", outcome: "failure", message: "Summary export failed", details: errorMessage(e) });
    } finally {
      setIsSummaryExporting(false);
    }
  }

  async function importHistoryFile(file: File) {
    try {
      const text = await file.text();
      let imported: unknown = null;
      try {
        imported = JSON.parse(text);
      } catch {
        imported = null;
      }

      const importedRecord = asRecord(imported);
      if (importedRecord?.kind === "raw_history" && Array.isArray(importedRecord.history)) {
        const nextHistory = importedRecord.history.map(normalizeImportedMessage).filter(Boolean) as ChatMessage[];
        setHistory(nextHistory);
        logNow({ category: "chat", ok: true, message: `Raw history imported (${nextHistory.length})` });
        return;
      }

      const summaryText =
        importedRecord?.kind === "summary_history" && typeof importedRecord.summary === "string"
          ? importedRecord.summary
          : text.trim();

      const summaryMessage = msg("user", summaryText, "summary_import", { displayName: "上次對話總結" });
      setHistory([summaryMessage]);
      logNow({ category: "chat", ok: true, message: "Summary history imported", details: summaryText });
    } catch (e) {
      logNow({ category: "chat", ok: false, message: "Import history failed", details: errorMessage(e) });
    }
  }

  function logRenderError(scope: string, error: Error, info: React.ErrorInfo) {
    logNow({
      category: "render_error",
      level: "error",
      ok: false,
      stage: scope,
      message: `Render failed: ${scope}`,
      details: [String(error.stack ?? error.message ?? error), info.componentStack].filter(Boolean).join("\n\n")
    });
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
              <ErrorBoundary onError={(error, info) => logRenderError("ChatPanel", error, info)}>
                <ChatPanel
                  history={history}
                  onSend={onSend}
                  onStop={stopActiveChatExecution}
                  onClear={() => {
                    setHistory([]);
                    setTutorialOpenedToolResultMessageIds([]);
                    logNow({ category: "chat", message: "Chat cleared" });
                  }}
                  leaderName={null}
                  userName={userProfile.name}
                  mode={mode}
                  modeLabel={mode === "one_to_one" ? "normal" : MAGI_MODE_LABELS[mode]}
                  onExportRaw={exportRawHistory}
                  onExportSummary={exportSummaryHistory}
                  onImportHistory={importHistoryFile}
                  isSummaryExporting={isSummaryExporting}
                  onOpenFullscreen={() => setIsChatFullscreen(true)}
                  composerSeed={tutorialComposerSeed}
                  onDraftChange={setChatComposerDraft}
                  voiceDictationStatus={voiceDictationStatus}
                  voicePlaybackMessageId={voicePlaybackMessageId}
                  voiceError={voiceError}
                  onToggleVoiceDictation={() => void toggleVoiceDictation()}
                  onPlayMessageTts={(messageId, text) => void playMessageTts(messageId, text)}
                  onOpenToolResult={(assistantMessageId) =>
                    setTutorialOpenedToolResultMessageIds((current) =>
                      current.includes(assistantMessageId) ? current : [...current, assistantMessageId]
                    )
                  }
                />
              </ErrorBoundary>
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
              {(mode === "magi_vote" || mode === "magi_consensus") && (
                <button className="cc-card" onClick={() => setConfigModal("team")}>
                  <span className="cc-card-label">S.C. MAGI</span>
                  <strong className="cc-card-value">{magiReadyCount}/3 ready</strong>
                  <span className="cc-card-hint">
                    {formatManagedMagiAgentName("Melchior")} / {formatManagedMagiAgentName("Balthasar")} / {formatManagedMagiAgentName("Casper")}
                  </span>
                </button>
              )}
              <button className="cc-card" onClick={() => setConfigModal("voice")}>
                <span className="cc-card-label">Voice</span>
                <strong className="cc-card-value">{voiceSttLoadBalancer?.name ?? "No STT"} / {voiceTtsLoadBalancer?.name ?? "No TTS"}</strong>
                <span className="cc-card-hint">STT typing + TTS playback</span>
              </button>
              <button className="cc-card" onClick={() => setConfigModal("docs")} data-tutorial-id="chat-config-docs-card">
                <span className="cc-card-label">Docs</span>
                <strong className="cc-card-value">{docs.length}</strong>
                <span className="cc-card-hint">IndexedDB 文件庫</span>
              </button>
              <button className="cc-card" onClick={() => setConfigModal("mcp")} data-tutorial-id="chat-config-mcp-card">
                <span className="cc-card-label">MCP</span>
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
              <CredentialsPanel controller={credentialController} onClose={() => setConfigModal(null)} />
            )}

            {configModal === "load_balancers" && (
              <HelpModal title="Load Balancer" onClose={() => setConfigModal(null)} width="min(980px, 96vw)">
                <ErrorBoundary onError={(error, info) => logRenderError("LoadBalancersPanel", error, info)}>
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
                </ErrorBoundary>
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

            {configModal === "voice" && (
              <HelpModal title="Voice" onClose={() => setConfigModal(null)} width="min(620px, 96vw)">
                <ErrorBoundary onError={(error, info) => logRenderError("VoiceConfigPanel", error, info)}>
                  <VoiceConfigPanel
                    settings={voiceSettings}
                    setSettings={setVoiceSettings}
                    loadBalancerOptions={loadBalancerSlots}
                    sttProbeState={voiceProbeState.stt}
                    ttsProbeState={voiceProbeState.tts}
                    onTestStt={() => void testVoiceSttLoadBalancer()}
                    onTestTts={() => void testVoiceTtsLoadBalancer()}
                  />
                </ErrorBoundary>
              </HelpModal>
            )}

            {configModal === "docs" && (
              <HelpModal title="Docs" onClose={() => setConfigModal(null)} width="min(560px, 96vw)">
                <ErrorBoundary onError={(error, info) => logRenderError("DocsPanel", error, info)}>
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
                </ErrorBoundary>
              </HelpModal>
            )}

            {configModal === "mcp" && (
              <HelpModal title="MCP" onClose={() => setConfigModal(null)} width="min(560px, 96vw)">
                <ErrorBoundary onError={(error, info) => logRenderError("McpPanel", error, info)}>
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
                      mcpToolCatalogCache.set(id, tools);
                      setMcpToolsByServer((prev) => ({ ...prev, [id]: tools }));
                      const server = mcpServers.find((s) => s.id === id);
                      logNow({ category: "mcp", message: `Tools updated: ${server?.name ?? id}`, details: tools.map((t) => t.name).join("\n") });
                    }}
                    clientManager={mcpClientManager}
                    pushLog={pushLog}
                  />
                </ErrorBoundary>
              </HelpModal>
            )}

            {configModal === "prompts" && (
              <HelpModal title="Prompt Templates" onClose={() => setConfigModal(null)} width="min(1100px, 96vw)">
                <ErrorBoundary onError={(error, info) => logRenderError("PromptTemplatesPanel", error, info)}>
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
                </ErrorBoundary>
              </HelpModal>
            )}

            {configModal === "skills" && (
              <HelpModal title="Skills" onClose={() => setConfigModal(null)} width="min(900px, 96vw)">
                <ErrorBoundary onError={(error, info) => logRenderError("SkillsPanel", error, info)}>
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
                </ErrorBoundary>
              </HelpModal>
            )}

            {configModal === "tools" && (
              <HelpModal title="Built-in Tools" onClose={() => setConfigModal(null)} width="min(820px, 96vw)">
                <ErrorBoundary onError={(error, info) => logRenderError("BuiltInToolsPanel", error, info)}>
                  <BuiltInToolsPanel systemTools={systemBuiltInTools} tools={builtInTools} onChange={setBuiltInTools} />
                </ErrorBoundary>
              </HelpModal>
            )}
          </div>
        )}

        {activeTab === "agents" && (
          <div className="content-grid">
            <div className="card panel">
              <ErrorBoundary onError={(error, info) => logRenderError("AgentsPanel", error, info)}>
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
              </ErrorBoundary>
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
            <ErrorBoundary onError={(error, info) => logRenderError("ChatPanel fullscreen", error, info)}>
              <ChatPanel
                history={history}
                onSend={onSend}
                onStop={stopActiveChatExecution}
                onClear={() => {
                  setHistory([]);
                  setTutorialOpenedToolResultMessageIds([]);
                  logNow({ category: "chat", message: "Chat cleared" });
                }}
                leaderName={null}
                userName={userProfile.name}
                mode={mode}
                modeLabel={mode === "one_to_one" ? "normal" : MAGI_MODE_LABELS[mode]}
                onExportRaw={exportRawHistory}
                onExportSummary={exportSummaryHistory}
                onImportHistory={importHistoryFile}
                isSummaryExporting={isSummaryExporting}
                fullscreen
                onCloseFullscreen={() => setIsChatFullscreen(false)}
                voiceDictationStatus={voiceDictationStatus}
                voicePlaybackMessageId={voicePlaybackMessageId}
                voiceError={voiceError}
                onToggleVoiceDictation={() => void toggleVoiceDictation()}
                onPlayMessageTts={(messageId, text) => void playMessageTts(messageId, text)}
                onOpenToolResult={(assistantMessageId) =>
                  setTutorialOpenedToolResultMessageIds((current) =>
                    current.includes(assistantMessageId) ? current : [...current, assistantMessageId]
                  )
                }
              />
            </ErrorBoundary>
          </div>
        </HelpModal>
      )}

      <LogPanel entries={log} onClear={clearLog} />

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
