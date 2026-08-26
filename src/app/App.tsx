import React, { useMemo, useState } from "react";
import {
  AgentConfig,
  BuiltInToolConfig,
  ChatMessage,
  DetectResult,
  MagiMode,
  MagiRenderState,
  MagiUnitId,
  OrchestratorMode,
  VoiceSettings,
  DocItem,
  McpServerConfig,
  McpTool,
  LoadBalancerConfig
} from "../types";
import { loadAgents, upsertAgent, deleteAgent, saveAgents } from "../storage/agentStore";
import { loadBuiltInTools, saveBuiltInTools } from "../storage/builtInToolStore";
import { listDocs, upsertDoc, deleteDoc } from "../storage/docStore";
import {
  createEmptySkill,
  listSkillDocs,
  listSkillFiles,
  listSkills,
  updateSkillMarkdown,
  upsertSkillTextFile
} from "../storage/skillStore";
import {
  loadLoadBalancers,
  loadMcpServers,
  loadUiState,
  saveLoadBalancers,
  saveMcpServers,
  saveUiState
} from "../storage/settingsStore";

import { OpenAICompatAdapter } from "../adapters/openaiCompat";
import { ChromePromptAdapter } from "../adapters/chromePrompt";
import { CustomAdapter } from "../adapters/custom";

import { runOneToOne } from "../orchestrators/oneToOne";
import { createInitialState as createMagiRenderState, MAGI_UNIT_LAYOUT, MagiPreparedUnit, runMagi } from "../orchestrators/magi";
import { McpClientManager } from "../mcp/clientManager";
import { McpToolCatalog } from "../mcp/toolCatalog";
import { retainMcpToolCatalog } from "../runtime/mcpCatalogState";

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
import VoiceConfigPanel from "../ui/VoiceConfigPanel";
import LogPanel from "../ui/LogPanel";
import CredentialsPanel from "../ui/CredentialsPanel";
import { createToolDashboardHelpers } from "../utils/toolDashboard";
import { getTutorialCatalogError, getTutorialScenario, tutorialCatalog } from "../onboarding/catalog";
import {
  normalizeTutorialPrimaryAgentList,
  usesTutorialLoadBalancer
} from "../onboarding/agentManagement";
import {
  applyTutorialStepEntry,
  TUTORIAL_DOC_CONTENT,
  TUTORIAL_AGENT_ROLE,
  captureTutorialWorkspaceSnapshot,
  restoreTutorialWorkspaceSnapshot,
  TUTORIAL_DOC_NAME,
  TUTORIAL_TIME_TOOL_CODE,
  TUTORIAL_TIME_TOOL_DESCRIPTION,
  TUTORIAL_TIME_TOOL_INPUT_SCHEMA,
  TUTORIAL_TIME_TOOL_NAME,
  isTutorialTimeTool,
  TUTORIAL_MCP_NAME,
  TUTORIAL_PRIMARY_MODEL,
  TUTORIAL_SECONDARY_MODEL,
  resolveTutorialExecutionDeadlineMs
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
import { TutorialScenarioDefinition, TutorialWorkspaceSnapshot } from "../onboarding/types";
import { useTutorialSession } from "../onboarding/useTutorialSession";
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
import { runHarnessChatTurn } from "../chat/harnessChatTurn";
import { runLoadBalancedTask, runLoadBalancedTextTask } from "../runtime/loadBalancerRunner";
import { msg } from "../runtime/chatMessages";
import { useAppLog } from "./useAppLog";
import { useChatHistoryController } from "../chat/useChatHistoryController";
import { useDocsController } from "../resources/useDocsController";
import { useSkillsController } from "../resources/useSkillsController";
import { useAgentHarnessController, type AgentHarnessTaskContext } from "../chat/useAgentHarnessController";
import { createLogRequestId } from "../runtime/logging";
import { getTextCapabilityRevision, normalizeToolCallingCapability, probeTextCapability } from "../runtime/harness/capability";
import { fetchCredentialModels } from "../credentials/runtime";
import { useCredentialController } from "../credentials/useCredentialController";
import { generateId } from "../utils/id";
import {
  SYSTEM_AGENT_DIRECTORY_TOOL_ID,
  SYSTEM_BUILT_IN_TOOLS,
  SYSTEM_USER_PROFILE_TOOL_ID
} from "../utils/systemBuiltInTools";

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
import { buildAgentFailureContent, classifyRetryableAgentFailure } from "../utils/agentFailure";
import {
  describeLoadBalancerAvailability,
  describeResolvedLoadBalancerCandidate
} from "../utils/loadBalancerDiagnostics";
import { errorMessage } from "../utils/errors";
import type { HarnessEvent } from "../runtime/harness/types";

const TUTORIAL_CONTEXT_BUDGET = {
  maxSingleToolResultChars: 4_000
} as const;

function withAbortSignal<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(signal.reason instanceof Error ? signal.reason : new Error("Execution aborted."));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason instanceof Error ? signal.reason : new Error("Execution aborted."));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      }
    );
  });
}

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

type OneToOneTurnResult = {
  requestId: string;
  status: "success" | "degraded" | "failure";
  displayContent: string;
  spokenContent?: string;
};

type ActiveTab = "chat" | "chat_config" | "agents" | "profile";
type UserProfile = { name: string; avatarUrl?: string; description?: string };
type AppEntryMode = "landing" | "workspace";
type PendingToolConfirmation = {
  message: string;
  settle: (allowed: boolean) => void;
};
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

function isCategoryEnabled(flag: boolean | undefined) {
  return flag !== false;
}

function sameMcpCatalogConfig(left: McpServerConfig, right: McpServerConfig) {
  return (
    left.id === right.id &&
    left.sseUrl === right.sseUrl &&
    left.transport === right.transport &&
    left.authToken === right.authToken &&
    left.useLocalProxy === right.useLocalProxy &&
    JSON.stringify(left.customHeaders ?? {}) === JSON.stringify(right.customHeaders ?? {}) &&
    JSON.stringify(left.toolPolicies ?? {}) === JSON.stringify(right.toolPolicies ?? {})
  );
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
  const [historyMessageLimit, setHistoryMessageLimit] = useState<number>(() => clampHistoryLimit(initialUi.historyMessageLimit ?? 10));
  const [userName, setUserName] = useState<string>(() => initialUi.userName ?? "You");
  const [userAvatarUrl, setUserAvatarUrl] = useState<string | undefined>(() => initialUi.userAvatarUrl);
  const [userDescription, setUserDescription] = useState<string>(() => initialUi.userDescription ?? "");
  const [voiceSettings, setVoiceSettings] = useState<VoiceSettings>(() => normalizeVoiceSettings(initialUi.voiceSettings ?? initialUi.radioSettings));
  type ConfigModalKey = "agent" | "credentials" | "mode" | "history" | "docs" | "mcp" | "skills" | "tools" | "team" | "load_balancers" | "voice" | null;
  const [configModal, setConfigModal] = useState<ConfigModalKey>(null);
  const [loadBalancerDraftSeed, setLoadBalancerDraftSeed] = useState<{ token: number; draft: LoadBalancerConfig } | null>(null);

  const [builtInTools, setBuiltInTools] = useState<BuiltInToolConfig[]>(() => loadBuiltInTools());
  const toolDashboard = useMemo(() => createToolDashboardHelpers(), []);
  const [explicitSkillId, setExplicitSkillId] = useState<string | null>(null);
  const [loadBalancers, setLoadBalancers] = useState<LoadBalancerConfig[]>(() => loadLoadBalancers());
  const [loadBalancerPanelSelectedId, setLoadBalancerPanelSelectedId] = useState<string | null>(null);
  const systemBuiltInTools = useMemo(() => SYSTEM_BUILT_IN_TOOLS, []);
  const allBuiltInTools = useMemo(
    () => [...systemBuiltInTools, ...builtInTools.map((tool) => ({
      ...tool,
      source: "custom" as const,
      // The tutorial clock only presents local page state. Keep ordinary
      // persisted custom tools conservative, even if their stored metadata
      // claims to be read-only.
      readonly: isTutorialTimeTool(tool)
    }))],
    [builtInTools, systemBuiltInTools]
  );

  const [mcpServers, setMcpServers] = useState<McpServerConfig[]>(() => loadMcpServers());
  const [mcpPanelActiveId, setMcpPanelActiveId] = useState<string | null>(null);
  const [mcpToolsByServer, setMcpToolsByServer] = useState<Record<string, McpTool[]>>({});
  const mcpServersRef = React.useRef(mcpServers);
  const mcpToolsByServerRef = React.useRef(mcpToolsByServer);
  mcpServersRef.current = mcpServers;
  mcpToolsByServerRef.current = mcpToolsByServer;
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
  const {
    docs,
    docsLoaded,
    docEditorId,
    setDocEditorId,
    reloadDocs,
    createDoc: onCreateDoc,
    saveDoc: onSaveDoc,
    removeDoc: onDeleteDoc
  } = useDocsController({ pushLog });
  const {
    skills,
    skillsLoaded,
    skillPanelSelectedId,
    setSkillPanelSelectedId,
    skillPanelDocs,
    skillPanelFiles,
    reloadSkillsFromStore,
    importSkill: onImportSkill,
    createEmpty: onCreateEmptySkill,
    removeSkill: onDeleteSkill,
    updateMarkdown: onUpdateSkillMarkdown,
    upsertTextFile: onUpsertSkillTextFile,
    removeTextFile: onDeleteSkillTextFile,
    exportSkill: onExportSkill
  } = useSkillsController({ pushLog });
  const harnessController = useAgentHarnessController();
  const [pendingToolConfirmation, setPendingToolConfirmation] = useState<PendingToolConfirmation | null>(null);
  const pendingToolConfirmationRef = React.useRef<PendingToolConfirmation | null>(null);

  function requestToolConfirmation(message: string, signal: AbortSignal): Promise<boolean> {
    if (signal.aborted) return Promise.resolve(false);
    return new Promise<boolean>((resolve) => {
      let settled = false;
      let pending!: PendingToolConfirmation;
      const onAbort = () => settle(false);
      const settle = (allowed: boolean) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", onAbort);
        if (pendingToolConfirmationRef.current === pending) {
          pendingToolConfirmationRef.current = null;
          setPendingToolConfirmation(null);
        }
        resolve(allowed);
      };
      pending = { message: message.slice(0, 8_000), settle };
      pendingToolConfirmationRef.current = pending;
      setPendingToolConfirmation(pending);
      signal.addEventListener("abort", onAbort, { once: true });
      if (signal.aborted) settle(false);
    });
  }
  const chatHistoryController = useChatHistoryController({
    activeTab,
    historyMessageLimit,
    pushLog,
    summarizeHistory: activeAgent
      ? async ({ history: summaryHistory, requestId }) => {
          const summary = await runOneToOneWithLoadBalancer({
            logicalAgent: activeAgent,
            input:
              "Please compress this conversation into a concise reusable summary for future continuation. Keep key facts, decisions, unresolved items, user preferences, and open tasks. Output plain text only.",
            history: summaryHistory,
            system:
              "You are preparing a conversation carry-over note. Write in Traditional Chinese when possible. Do not include markdown code fences.",
            requestId,
            requestLabel: "summary export",
            onDelta: () => {},
            onLog: (text) => pushLog({ category: "retry", agent: activeAgent.name, requestId, stage: "summary export", message: text })
          });
          return {
            summary,
            agent: { id: activeAgent.id, name: activeAgent.name, model: activeAgent.model }
          };
        }
      : undefined
  });
  const {
    history,
    setHistory,
    chatComposerDraft,
    setChatComposerDraft,
    isChatFullscreen,
    setIsChatFullscreen,
    isSummaryExporting,
    append,
    patchMessage,
    clearHistory,
    limitHistory,
    exportRawHistory,
    exportSummaryHistory,
    importHistoryFile
  } = chatHistoryController;
  const credentialController = useCredentialController({ pushLog });
  const {
    modelCredentials,
    setModelCredentials,
    credentialSlots,
    configuredCredentialCount,
    credentialTestResults
  } = credentialController;
  const tutorialRuntimeBase = useMemo(
    () => ({
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
      }
    }),
    [
      activeAgentId,
      agents,
      builtInTools,
      chatComposerDraft,
      credentialTestResults,
      docs,
      history,
      historyMessageLimit,
      loadBalancers,
      mcpServers,
      mcpToolsByServer,
      modelCredentials,
      skills,
      userAvatarUrl,
      userDescription,
      userName
    ]
  );
  const {
    tutorialScenario,
    setTutorialScenario,
    tutorialScenarioIndex,
    setTutorialScenarioIndex,
    tutorialStepIndex,
    setTutorialStepIndex,
    showTutorialExitPrompt,
    setShowTutorialExitPrompt,
    tutorialUnavailableMessage,
    setTutorialUnavailableMessage,
    tutorialComposerSeed,
    setTutorialComposerSeed,
    setTutorialOpenedToolResultMessageIds,
    tutorialRuntimeState,
    tutorialEvaluations,
    currentTutorialStep,
    currentTutorialEvaluation,
    tutorialActiveAgentHint,
    tutorialActiveAgentWarning,
    tutorialActive,
    tutorialPreviewLocked,
    tutorialShowLandingPreview,
    markToolResultOpened,
    resetTutorialSession
  } = useTutorialSession({ runtimeBase: tutorialRuntimeBase, agents, loadBalancers });
  const logNow = pushLog;
  const userProfile = React.useMemo<UserProfile>(
    () => ({ name: userName.trim() || "You", avatarUrl: userAvatarUrl, description: userDescription.trim() }),
    [userName, userAvatarUrl, userDescription]
  );
  const tutorialExecutionDeadlineMs = resolveTutorialExecutionDeadlineMs(currentTutorialStep, executionDeadlineMs);
  const mcpCountRef = React.useRef(mcpServers.length);
  const tutorialSnapshotRef = React.useRef<TutorialWorkspaceSnapshot | null>(null);
  const tutorialStepKeyRef = React.useRef("");
  const tutorialHistoryLimitRestoreRef = React.useRef<number | null>(null);
  const tutorialLoadBalancerRetryRestoreRef = React.useRef<Record<string, Array<{ instanceId: string; maxRetries: number; delaySecond: number; resumeMinute: number }>> | null>(null);
  const activeChatAbortRef = React.useRef<AbortController | null>(null);
  const tutorialRestoringRef = React.useRef(false);
  const tutorialKeepChangesHint = "即使選擇保留這次教學變更，系統仍會刪除「教學用DOC」，避免之後的問答持續被案例 2 的人格設定影響。";

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
      activeAgentId,
      executionDeadlineMs,
      historyMessageLimit,
      userName,
      userAvatarUrl,
      userDescription,
      voiceSettings
    });
  }, [activeTab, mode, activeAgentId, executionDeadlineMs, historyMessageLimit, userName, userAvatarUrl, userDescription, voiceSettings]);

  React.useEffect(() => {
    saveMcpServers(mcpServers);
  }, [mcpServers]);

  React.useEffect(() => {
    return () => {
      mcpClientManager.closeAll();
    };
  }, [mcpClientManager]);

  React.useEffect(() => {
    const abortActiveRun = () => {
      const controller = activeChatAbortRef.current;
      if (controller && !controller.signal.aborted) controller.abort(new Error("Page lifecycle ended the active chat run."));
    };
    globalThis.addEventListener?.("pagehide", abortActiveRun);
    return () => {
      globalThis.removeEventListener?.("pagehide", abortActiveRun);
      abortActiveRun();
    };
  }, []);

  React.useEffect(() => {
    saveBuiltInTools(builtInTools);
  }, [builtInTools]);

  React.useEffect(() => {
    saveLoadBalancers(loadBalancers);
  }, [loadBalancers]);

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
    if (mcpPanelActiveId && !mcpServers.some((s) => s.id === mcpPanelActiveId)) {
      setMcpPanelActiveId(null);
    }
  }, [mcpPanelActiveId, mcpServers]);

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
      setAgentLoadBalancerRetryPolicy: (agentId, value) =>
        setAgentLoadBalancerRetryPolicy(agentId, {
          delaySecond:
            typeof value.delaySecond === "number" ? Math.max(0, Math.min(30, Math.round(value.delaySecond))) : undefined,
          maxRetries:
            typeof value.maxRetries === "number" ? Math.max(0, Math.min(20, Math.round(value.maxRetries))) : undefined,
            resumeMinute:
              typeof value.resumeMinute === "number" ? Math.max(0, Math.min(1440, Math.round(value.resumeMinute))) : undefined
        }),
      setExplicitSkillId,
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

  const availableSkillsForAgent = useMemo(() => {
    if (!activeAgent?.enableSkills) return [];
    if (!activeAgent.allowedSkillIds) return skills;
    const allowed = new Set(activeAgent.allowedSkillIds);
    return skills.filter((skill) => allowed.has(skill.id));
  }, [activeAgent, skills]);

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
    const skillContext = [
      `Skill: ${bundle.skill.name}`,
      bundle.skill.skillMarkdown,
      ...bundle.docs.map((doc) => `[UNTRUSTED_SKILL_REFERENCE:${doc.path}]\n${doc.content}`),
      ...bundle.files
        .filter((file) => typeof file.content === "string")
        .map((file) => `[UNTRUSTED_SKILL_ASSET:${file.path}]\n${file.content}`),
      `Question:\n${question}`
    ]
      .filter(Boolean)
      .join("\n\n");

    const profileLines = [
      `S.C. MAGI unit: ${unitId}`,
      `Saved agent profile name: ${agent.name}`,
      agent.description?.trim() ? `Saved agent description:\n${agent.description.trim()}` : "",
      "This is MAGI internal mode. Ignore global docs, MCP tools, built-in tools, and any non-MAGI skills.",
      "Stay in your assigned MAGI role and answer only according to the internal skill instructions."
    ]
      .filter(Boolean)
      .join("\n\n");

    return [profileLines, skillContext].filter(Boolean).join("\n\n");
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
            description: "教學用 key failover Load Balancer",
            instances: [
              createLoadBalancerInstance({
                model: TUTORIAL_PRIMARY_MODEL,
                description: "Primary tutorial instance",
                toolCallingCapability: "native",
                contextBudget: TUTORIAL_CONTEXT_BUDGET
              })
            ]
          }
        : {
            ...createLoadBalancer("教學用Load Balancer 2"),
            description: "教學用多 instance Load Balancer",
            instances: [
              createLoadBalancerInstance({
                model: TUTORIAL_PRIMARY_MODEL,
                description: "Primary provider / model baseline",
                toolCallingCapability: "native",
                contextBudget: TUTORIAL_CONTEXT_BUDGET
              }),
              createLoadBalancerInstance({
                model: TUTORIAL_SECONDARY_MODEL,
                description: "Alternate key with secondary model",
                toolCallingCapability: "native",
                contextBudget: TUTORIAL_CONTEXT_BUDGET
              }),
              createLoadBalancerInstance({
                model: TUTORIAL_PRIMARY_MODEL,
                description: "Primary key retry position",
                toolCallingCapability: "native",
                contextBudget: TUTORIAL_CONTEXT_BUDGET
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
    const now = Date.now();
    const tutorialKeys = [
      key,
      ...credential.keys.filter((entry) => entry.id !== key.id && entry.apiKey.trim())
    ].slice(0, 2);
    const nextInstances = tutorialKeys.map((tutorialKey, index) => ({
      ...(existing?.instances[index] ?? createLoadBalancerInstance()),
      credentialId: credential.id,
      credentialKeyId: tutorialKey.id,
      model: TUTORIAL_PRIMARY_MODEL,
      description: index === 0 ? "Primary tutorial instance" : "Alternate key for failover",
      failure: false,
      failureCount: 0,
      nextCheckTime: null,
      toolCallingCapability: "native" as const,
      contextBudget: TUTORIAL_CONTEXT_BUDGET,
      updatedAt: now
    }));
    const nextEntry: LoadBalancerConfig = {
      ...(existing ?? createLoadBalancer("教學用Load Balancer 1")),
      name: "教學用Load Balancer 1",
      description: "教學用 key failover Load Balancer",
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
          instance.toolCallingCapability === nextInstance.toolCallingCapability &&
          JSON.stringify(instance.contextBudget) === JSON.stringify(TUTORIAL_CONTEXT_BUDGET) &&
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
        toolCallingCapability: "native",
        contextBudget: TUTORIAL_CONTEXT_BUDGET,
        createdAt: existing?.instances[0]?.createdAt
      }),
      createLoadBalancerInstance({
        id: existing?.instances[1]?.id,
        credentialId: secondaryCredential.id,
        credentialKeyId: secondaryKey.id,
        model: TUTORIAL_SECONDARY_MODEL,
        description: "Alternate key with secondary model",
        maxRetries: existing?.instances[1]?.maxRetries ?? DEFAULT_INSTANCE_MAX_RETRIES,
        delaySecond: existing?.instances[1]?.delaySecond ?? DEFAULT_INSTANCE_DELAY_SECOND,
        resumeMinute: existing?.instances[1]?.resumeMinute ?? DEFAULT_INSTANCE_RESUME_MINUTE,
        failure: false,
        failureCount: 0,
        nextCheckTime: null,
        toolCallingCapability: "native",
        contextBudget: TUTORIAL_CONTEXT_BUDGET,
        createdAt: existing?.instances[1]?.createdAt
      }),
      createLoadBalancerInstance({
        id: existing?.instances[2]?.id,
        credentialId: primaryCredential.id,
        credentialKeyId: primaryKey.id,
        model: TUTORIAL_PRIMARY_MODEL,
        description: "Primary key retry position",
        maxRetries: existing?.instances[2]?.maxRetries ?? DEFAULT_INSTANCE_MAX_RETRIES,
        delaySecond: existing?.instances[2]?.delaySecond ?? DEFAULT_INSTANCE_DELAY_SECOND,
        resumeMinute: existing?.instances[2]?.resumeMinute ?? DEFAULT_INSTANCE_RESUME_MINUTE,
        failure: false,
        failureCount: 0,
        nextCheckTime: null,
        toolCallingCapability: "native",
        contextBudget: TUTORIAL_CONTEXT_BUDGET,
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
          instance.toolCallingCapability === nextInstance.toolCallingCapability &&
          JSON.stringify(instance.contextBudget) === JSON.stringify(TUTORIAL_CONTEXT_BUDGET) &&
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
    options?: { onStatus?: (text: string) => void; requestId?: string; signal?: AbortSignal }
  ) {
    if (options?.signal?.aborted) return [];
    const cachedCatalog = mcpToolsByServerRef.current;
    const unknownServers = servers.filter((server) => !Object.prototype.hasOwnProperty.call(cachedCatalog, server.id));
    if (!unknownServers.length) {
      return servers
        .map((server) => ({ server, tools: cachedCatalog[server.id] ?? [] }))
        .filter((entry) => entry.tools.length > 0);
    }

    if (!options?.signal?.aborted) options?.onStatus?.("正在同步 MCP 工具清單中…");

    const loadedEntries = await Promise.all(
      unknownServers.map(async (server) => {
        try {
          const tools = await withAbortSignal(
            mcpToolCatalogCache.load(
              server,
              mcpClientManager,
              (text) => pushLog({ category: "mcp", agent: server.name, requestId: options?.requestId, stage: "mcp_connect", message: text })
            ),
            options?.signal
          );
          if (options?.signal?.aborted) return null;
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
          if (options?.signal?.aborted) return null;
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

    if (options?.signal?.aborted) return [];
    const currentServers = mcpServersRef.current;
    const validLoadedMap = Object.fromEntries(
      Object.entries(loadedMap).filter(([serverId]) => {
        const requested = servers.find((server) => server.id === serverId);
        const current = currentServers.find((server) => server.id === serverId);
        return !!requested && !!current && sameMcpCatalogConfig(requested, current);
      })
    );
    const mergedCatalog = {
      ...retainMcpToolCatalog(mcpToolsByServerRef.current, currentServers),
      ...validLoadedMap
    };
    mcpToolsByServerRef.current = mergedCatalog;
    if (Object.keys(validLoadedMap).length > 0) {
      setMcpToolsByServer(() => mergedCatalog);
    }

    return servers
      .map((server) => ({
        server,
        tools: validLoadedMap[server.id] ?? mergedCatalog[server.id] ?? []
      }))
      .filter((entry) => entry.tools.length > 0);
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
    await reloadDocs();
    logNow({ category: "tutorial", ok: true, message: `Tutorial doc removed: ${reason}` });
    return true;
  }

  function abortActiveRuns(reason: string) {
    harnessController.abort(reason);
    const controller = activeChatAbortRef.current;
    if (controller && !controller.signal.aborted) controller.abort(new Error(reason));
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

    tutorialRestoringRef.current = true;
    abortActiveRuns("Tutorial transition started.");
    try {
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
    } finally {
      tutorialRestoringRef.current = false;
    }
  }

  async function moveToNextTutorialScenario() {
    tutorialRestoringRef.current = true;
    abortActiveRuns("Tutorial case transition started.");
    try {
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
    } finally {
      tutorialRestoringRef.current = false;
    }
  }

  async function finishTutorial(keepWorkspaceChanges: boolean) {
    tutorialRestoringRef.current = true;
    abortActiveRuns("Tutorial workspace restore started.");
    try {
      restoreTutorialHistoryLimitIfNeeded();
      restoreTutorialLoadBalancerRetryIfNeeded();
      if (!keepWorkspaceChanges && tutorialSnapshotRef.current) {
        await restoreTutorialWorkspaceSnapshot(tutorialSnapshotRef.current);
        setBuiltInTools(tutorialSnapshotRef.current.builtInTools);
        await reloadSkillsFromStore(skillPanelSelectedId);
        const tutorialDocs = (await listDocs()).filter((doc) => doc.title === TUTORIAL_DOC_NAME);
        if (tutorialDocs.length) {
          await Promise.all(tutorialDocs.map((doc) => deleteDoc(doc.id)));
          await reloadDocs();
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
      resetTutorialSession();
      setConfigModal(null);
    } finally {
      tutorialRestoringRef.current = false;
    }
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
      logNow({
        category: "agents",
        agent: normalizedAgent.name,
        ok: true,
        message: "Agent saved",
        details: `type=${normalizedAgent.type}\nload_balancer=${normalizedAgent.loadBalancerId ?? "none"}\nmodel=${normalizedAgent.model ?? "-"}`
      });
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

  function stopActiveChatExecution() {
    if (harnessController.active) {
      abortActiveRuns("使用者中斷目前執行。");
      logNow({ category: "chat", ok: false, outcome: "degraded", message: "Active chat execution aborted by user" });
      return;
    }
    const controller = activeChatAbortRef.current;
    if (!controller || controller.signal.aborted) return;
    controller.abort(new Error("使用者中斷目前執行。"));
    logNow({ category: "chat", ok: false, outcome: "degraded", message: "Active chat execution aborted by user" });
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

  async function sendOneToOneTurn(args: {
    displayInput: string;
    modelInput?: string;
    requestId?: string;
    startedAt?: number;
    extraSystem?: string;
    modeForLog?: "one_to_one";
    statusText?: {
      preparing?: string;
      responding?: string;
    };
    deadline?: ExecutionDeadline;
    signal?: AbortSignal;
    generation?: number;
    runId?: string;
    isCurrent?: () => boolean;
    emit?: (event: HarnessEvent) => void;
  }): Promise<OneToOneTurnResult> {
    const oneToOneAgent = activeAgent;
    if (!oneToOneAgent) {
      throw new Error("No active agent selected.");
    }

    const requestId = args.requestId ?? createLogRequestId("chat");
    const input = args.displayInput;
    const modelInput = args.modelInput ?? args.displayInput;
    const preflightSignal = combineSignals(args.signal, args.deadline?.signal);
    const skillIdForTurn = explicitSkillId;
    setExplicitSkillId(null);
    const resolvedActiveAgent = hydrateAgentCredentials(oneToOneAgent);
    const adapter = pickAdapter(resolvedActiveAgent);
    const assistantId = generateId();
    const resolvedCandidates = resolveLoadBalancerPlanForAgent(oneToOneAgent);
    const candidateCapabilities = new Map(resolvedCandidates.map((candidate) => {
      const capability = normalizeToolCallingCapability(
        candidate.instance.toolCallingCapability ?? candidate.hydratedAgent.capabilities?.toolCallingCapability
      );
      return [candidate.instance.id, capability] as const;
    }));
    let candidates = resolvedCandidates.filter((candidate) => {
      const capability = candidateCapabilities.get(candidate.instance.id);
      const candidateAdapter = pickAdapter(candidate.hydratedAgent);
      return capability !== "none" && !(capability === "native" && !candidateAdapter.nativeChat);
    });
    const mainCapability = normalizeToolCallingCapability(
      oneToOneAgent.capabilities?.toolCallingCapability ?? (oneToOneAgent.loadBalancerId ? "none" : adapter.nativeChat ? "native" : "text_protocol")
    );

    logNow({
      category: "chat",
      agent: oneToOneAgent.name,
      requestId,
      stage: "request_start",
      message: `Send (${args.modeForLog ?? "one_to_one"})`,
      details: `input_chars=${modelInput.length}`
    });
    logNow({
      category: "chat",
      agent: oneToOneAgent.name,
      requestId,
      stage: "context_prepare",
      message: "Pi loop context prepared",
      details: `docs=${docsForAgent.length} history=${history.length}`
    });

    append(msg("user", input, "user", { displayName: userProfile.name, avatarUrl: userProfile.avatarUrl }));
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

    const finishPreflightStop = (): OneToOneTurnResult => {
      const deadlineExpired = args.deadline ? Date.now() >= args.deadline.expiresAt : false;
      const terminalReason = deadlineExpired ? "deadline" : "aborted";
      const content = deadlineExpired
        ? "【執行失敗】\nPi loop harness 在模型請求開始前超過執行期限。"
        : "【執行中斷】\n上一輪執行在模型請求開始前被中止。";
      if (args.isCurrent?.() !== false) {
        patchMessage(assistantId, {
          content,
          statusText: undefined,
          isStreaming: false,
          hideWhileStreaming: false,
          harnessRun: {
            runId: args.runId ?? `${oneToOneAgent.id}:${requestId}`,
            generation: args.generation ?? 0,
            stepCount: 0,
            toolCallCount: 0,
            durationMs: Math.max(0, Date.now() - (args.startedAt ?? Date.now())),
            terminalReason,
            activity: [{ type: "run_end", message: terminalReason }]
          }
        });
      }
      return { requestId, status: deadlineExpired ? "failure" : "degraded", displayContent: content };
    };

    const verifiedCandidates = [] as typeof candidates;
    for (const candidate of candidates) {
      if (preflightSignal.aborted || args.isCurrent?.() === false) return finishPreflightStop();
      const capability = candidateCapabilities.get(candidate.instance.id);
      if (capability !== "text_protocol") {
        verifiedCandidates.push(candidate);
        continue;
      }
      patchMessage(assistantId, { statusText: "正在驗證文字 action protocol…", isStreaming: true });
      const probe = await probeTextCapability({
        candidateId: candidate.instance.id,
        agent: candidate.hydratedAgent,
        adapter: pickAdapter(candidate.hydratedAgent),
        retry: {
          delaySec: Math.max(0, candidate.instance.delaySecond),
          max: Math.max(0, candidate.instance.maxRetries)
        },
        maxModelResponseChars: candidate.instance.contextBudget?.maxModelResponseChars,
        revision: getTextCapabilityRevision(candidate.hydratedAgent, `${candidate.instance.credentialId}:${candidate.instance.credentialKeyId ?? "default"}:${candidate.instance.model}`),
        signal: preflightSignal
      });
      if (probe.ok) {
        verifiedCandidates.push(candidate);
      } else {
        logNow({
          category: "chat",
          agent: oneToOneAgent.name,
          requestId,
          stage: "capability_probe",
          ok: false,
          message: `Candidate ${candidate.instance.id} is not text-protocol compatible`,
          details: probe.diagnostic
        });
      }
    }
    candidates = verifiedCandidates;
    let directTextCapability: boolean | undefined;
    if (!oneToOneAgent.loadBalancerId && mainCapability === "text_protocol") {
      patchMessage(assistantId, { statusText: "正在驗證文字 action protocol…", isStreaming: true });
      const probe = await probeTextCapability({
        candidateId: resolvedActiveAgent.id,
        agent: resolvedActiveAgent,
        adapter,
        revision: getTextCapabilityRevision(resolvedActiveAgent),
        signal: preflightSignal
      });
      directTextCapability = probe.ok;
      if (!probe.ok) {
        logNow({
          category: "chat",
          agent: oneToOneAgent.name,
          requestId,
          stage: "capability_probe",
          ok: false,
          message: "Active agent is not text-protocol compatible",
          details: probe.diagnostic
        });
      }
    }
    if (preflightSignal.aborted || args.isCurrent?.() === false) return finishPreflightStop();
    const candidateById = new Map(candidates.map((candidate) => [candidate.instance.id, candidate]));
    const transportCandidates = oneToOneAgent.loadBalancerId
      ? candidates.map((candidate) => ({
          id: candidate.instance.id,
          agent: candidate.hydratedAgent,
          adapter: pickAdapter(candidate.hydratedAgent),
          capability: candidateCapabilities.get(candidate.instance.id),
          retry: {
            delaySec: Math.max(0, candidate.instance.delaySecond),
            max: Math.max(0, candidate.instance.maxRetries)
          },
          contextBudget: candidate.instance.contextBudget
        }))
      : directTextCapability === false || mainCapability === "none"
        ? []
        : [{ id: resolvedActiveAgent.id, agent: resolvedActiveAgent, adapter, capability: mainCapability }];

    const resolvedMcpToolsForAgent = await ensureMcpToolsLoadedForServers(availableMcpServersForAgent, {
      onStatus: (statusText) => patchMessage(assistantId, { statusText, isStreaming: true }),
      requestId,
      signal: preflightSignal
    });
    const result = await runHarnessChatTurn({
      requestId,
      runId: args.runId ?? `${oneToOneAgent.id}:${requestId}`,
      generation: args.generation ?? 0,
      assistantMessageId: assistantId,
      userInput: modelInput,
      history: limitHistory(history),
      system: args.extraSystem,
      agent: resolvedActiveAgent,
      adapter,
      transportCandidates,
      docs: docsForAgent,
      skills: [],
      explicitSkillId: skillIdForTurn ?? undefined,
      builtInTools: availableBuiltinToolsForAgent,
      mcpServers: availableMcpServersForAgent,
      mcpTools: resolvedMcpToolsForAgent,
      mcpClientManager,
      deadline: args.deadline,
      signal: args.signal,
      isCurrent: args.isCurrent ?? (() => args.signal?.aborted !== true),
      emit: args.emit,
      confirm: requestToolConfirmation,
      getUserProfilePayload: () => getUserProfileToolPayload(userProfile),
      ui: { dashboard: toolDashboard },
      onTransportCandidateSuccess: (candidateId) => {
        const candidate = candidateById.get(candidateId);
        if (!candidate) return;
        setLoadBalancers((prev) =>
          applyInstanceSuccess({
            loadBalancers: prev,
            loadBalancerId: candidate.loadBalancer.id,
            instanceId: candidate.instance.id
          })
        );
      },
      onTransportCandidateFailure: (candidateId) => {
        const candidate = candidateById.get(candidateId);
        if (!candidate) return;
        setLoadBalancers((prev) =>
          applyInstanceFailure({
            loadBalancers: prev,
            loadBalancerId: candidate.loadBalancer.id,
            instanceId: candidate.instance.id
          })
        );
      },
      loadSkillPackages: async () =>
        oneToOneAgent.enableSkills === true
          ? await withAbortSignal(Promise.all(
              availableSkillsForAgent.map(async (skill) => ({
                skill,
                docs: skill.workflow.useSkillDocs === false ? [] : await listSkillDocs(skill.id),
                files: await listSkillFiles(skill.id)
              }))
            ), preflightSignal)
          : [],
      patchMessage: (id, patch) => patchMessage(id, patch)
    });
    logNow({
      category: "chat",
      agent: oneToOneAgent.name,
      requestId,
      ok: result.status === "success",
      outcome: result.status,
      stage: "final",
      message: `Pi loop harness ${result.status}`,
      details: `response_len=${result.displayContent.length}`
    });
    return result;
  }

  async function onSend(input: string) {
    if (tutorialRestoringRef.current) {
      logNow({ category: "tutorial", ok: false, message: "Send skipped: tutorial restore in progress", details: `input_chars=${input.length}` });
      append(msg("assistant", "Tutorial 正在恢復工作區，請稍候再送出。", "system", { displayName: "System" }));
      return;
    }
    if (harnessController.active || (activeChatAbortRef.current && !activeChatAbortRef.current.signal.aborted)) {
      logNow({ category: "chat", ok: false, message: "Send skipped: another chat execution is running", details: `input_chars=${input.length}` });
      return;
    }
    if (mode === "one_to_one") {
      if (!activeAgent) {
        logNow({ category: "chat", ok: false, message: "Send skipped: no active agent", details: `input_chars=${input.length}` });
        return;
      }
      try {
        const result = await harnessController.startTask(async (context: AgentHarnessTaskContext) => {
          const deadline = createDeadline({
            totalMs: tutorialExecutionDeadlineMs,
            externalSignal: context.signal,
            label: "chat execution"
          });
          try {
            return await sendOneToOneTurn({
              displayInput: input,
              modelInput: input,
              startedAt: Date.now(),
              modeForLog: "one_to_one",
              runId: context.runId,
              deadline,
              signal: context.signal,
              generation: context.generation,
              isCurrent: context.isCurrent,
              emit: context.emit
            });
          } finally {
            deadline.dispose();
          }
        });
        if (result === null) return;
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

  async function ensureTutorialDoc() {
    const existing = docs.find((item) => item.title === TUTORIAL_DOC_NAME) ?? null;
    const nextDoc: DocItem = {
      id: existing?.id ?? generateId(),
      title: TUTORIAL_DOC_NAME,
      content: TUTORIAL_DOC_CONTENT,
      updatedAt: Date.now()
    };
    await upsertDoc(nextDoc);
    await reloadDocs(nextDoc.id);
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
      readonly: true,
      updatedAt: Date.now(),
      source: "custom"
    };
    const nextTools = existing
      ? builtInTools.map((tool) => (tool.id === existing.id ? nextTool : tool))
      : [nextTool, ...builtInTools];
    setBuiltInTools(nextTools);
    logNow({ category: "tool", ok: true, message: `Tutorial built-in tool ensured: ${nextTool.name}` });
  }

  async function onResetAppData() {
    const confirmed = window.confirm("這會清空這個網站中 agent-go-round 儲存的所有資料，包含對話、Docs、Skills、Agents、Credentials、MCP 與 Built-in Tools。要繼續嗎？");
    if (!confirmed) return;
    await resetAgentGoRoundStorage();
    window.location.reload();
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

    await reloadSkillsFromStore(target.id);
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

    await reloadSkillsFromStore(target.id);
  }

  function onChangeMcpServers(next: McpServerConfig[]) {
    const prev = mcpServers;
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
        prevItem.useLocalProxy !== s.useLocalProxy ||
        JSON.stringify(prevItem.toolPolicies ?? {}) !== JSON.stringify(s.toolPolicies ?? {})
      );
    });
    const invalidatedServerIds = new Set([...removed, ...urlChanged].map((server) => server.id));
    mcpServersRef.current = next;
    setMcpServers(next);
    const retainedCatalog = retainMcpToolCatalog(mcpToolsByServerRef.current, next, invalidatedServerIds);
    mcpToolsByServerRef.current = retainedCatalog;
    setMcpToolsByServer(() => retainedCatalog);
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
                    clearHistory();
                    setTutorialOpenedToolResultMessageIds([]);
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
                  onOpenToolResult={markToolResultOpened}
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
                      // onChangeMcpServers and onUpdateTools are called back-to-back
                      // when a newly added server is saved. Use the ref because the
                      // render closure can still contain the previous server list.
                      const server = mcpServersRef.current.find((entry) => entry.id === id);
                      if (!server) return;
                      mcpToolCatalogCache.set(server, tools);
                      const nextCatalog = { ...mcpToolsByServerRef.current, [id]: tools };
                      mcpToolsByServerRef.current = nextCatalog;
                      setMcpToolsByServer(() => nextCatalog);
                      logNow({ category: "mcp", message: `Tools updated: ${server?.name ?? id}`, details: tools.map((t) => t.name).join("\n") });
                    }}
                    clientManager={mcpClientManager}
                    pushLog={pushLog}
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
                    explicitSkillId={explicitSkillId}
                    onActivateForNextTurn={(id) => {
                      if (!activeAgent?.enableSkills || !availableSkillsForAgent.some((skill) => skill.id === id)) {
                        logNow({ category: "skills", ok: false, outcome: "failure", message: "Skill explicit activation rejected: agent access is disabled or the skill is not allowed.", details: id });
                        return;
                      }
                      setExplicitSkillId(id);
                      logNow({ category: "skills", ok: true, message: `Skill explicitly activated for next turn: ${id}` });
                    }}
                    builtInTools={allBuiltInTools}
                    mcpToolCatalog={globalMcpToolCatalog}
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
                  clearHistory();
                  setTutorialOpenedToolResultMessageIds([]);
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
                onOpenToolResult={markToolResultOpened}
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
      {pendingToolConfirmation ? (
        <HelpModal
          title="確認工具操作"
          onClose={() => pendingToolConfirmation.settle(false)}
          width="min(560px, 92vw)"
          footer={
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button type="button" onClick={() => pendingToolConfirmation.settle(false)} style={iconActionBtn}>
                拒絕
              </button>
              <button type="button" onClick={() => pendingToolConfirmation.settle(true)} style={dangerMiniBtn}>
                允許執行
              </button>
            </div>
          }
        >
          <div style={{ whiteSpace: "pre-wrap", overflow: "auto", maxHeight: "min(55vh, 520px)", lineHeight: 1.6 }}>
            {pendingToolConfirmation.message}
          </div>
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
