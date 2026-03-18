import React, { useMemo, useState } from "react";
import {
  AgentConfig,
  BuiltInToolConfig,
  ChatTraceEntry,
  ChatMessage,
  LoadedSkillRuntime,
  OrchestratorMode,
  SkillExecutionMode,
  DocItem,
  McpServerConfig,
  McpTool,
  LogEntry,
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
  getDefaultMcpPromptTemplates,
  loadMcpPromptTemplates,
  loadMcpServers,
  loadUiState,
  saveModelCredentials,
  saveMcpPromptTemplates,
  saveMcpServers,
  saveUiState
} from "../storage/settingsStore";

import { OpenAICompatAdapter } from "../adapters/openaiCompat";
import { ChromePromptAdapter } from "../adapters/chromePrompt";
import { CustomAdapter } from "../adapters/custom";

import { runOneToOne } from "../orchestrators/oneToOne";
// Deprecated legacy orchestrator. Multi-turn skill refine uses its own executor and does not reuse leaderTeam.
import { runLeaderTeam, LeaderTeamEvent } from "../orchestrators/leaderTeam";
import { McpSseClient } from "../mcp/sseClient";
import { callTool } from "../mcp/toolRegistry";

import AgentsPanel from "../ui/AgentsPanel";
import BuiltInToolsPanel from "../ui/BuiltInToolsPanel";
import ChatPanel from "../ui/ChatPanel";
import DocsPanel from "../ui/DocsPanel";
import HelpModal from "../ui/HelpModal";
import McpPanel from "../ui/McpPanel";
import SkillsPanel from "../ui/SkillsPanel";
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
  clampSkillVerifyMax,
  normalizeSkillVerifyDecision,
  pushSkillExecutionModeTrace
} from "../runtime/skillExecutor";
import { generateId } from "../utils/id";
import { runBuiltInScriptTool } from "../utils/runBuiltInScriptTool";
import { pickBestAgentNameForQuestion, loadSavedAgentsFromStorage } from "../utils/agentDirectoryTool";
import { SYSTEM_AGENT_DIRECTORY_TOOL_ID, SYSTEM_BUILT_IN_TOOLS, SYSTEM_USER_PROFILE_TOOL_ID } from "../utils/systemBuiltInTools";

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
type PreparedSkillExecution = {
  baseInput: string;
  finalInput: string;
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
type LogSortKey = "category" | "agent" | "ok" | "ts" | "message";
type UserProfile = { name: string; avatarUrl?: string; description?: string };
const PROMPT_JSON_PLACEHOLDERS = {
  noToolJson: '{"type":"no_tool"}',
  userProfileJson: '{"type":"builtin_tool_call","tool":"get_user_profile","input":{}}',
  builtinToolJson: '{"type":"builtin_tool_call","tool":"your_tool_name","input":{}}',
  mcpCallJson: '{"type":"mcp_call","serverId":"...","tool":"...","input":{}}'
} as const;

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

function normalizeImportedMessage(input: any): ChatMessage | null {
  if (!input || typeof input !== "object") return null;
  if (typeof input.role !== "string" || typeof input.content !== "string") return null;
  if (!["system", "user", "assistant", "tool"].includes(input.role)) return null;
  const skillTrace = Array.isArray(input.skillTrace)
    ? input.skillTrace
        .filter((entry: any) => entry && typeof entry.label === "string" && typeof entry.content === "string")
        .map((entry: any) => ({ label: entry.label, content: entry.content } satisfies ChatTraceEntry))
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

function normalizeCredentialUrl(url?: string) {
  return (url ?? "").trim().replace(/\/$/, "");
}

function describeCredentialEndpoint(url: string) {
  if (!url) return { label: "Unconfigured Endpoint", hint: "請先設定 endpoint 或 URL" };
  if (url === "https://api.openai.com/v1") return { label: "OpenAI", hint: url };
  if (url === "https://api.groq.com/openai/v1") return { label: "Groq", hint: url };
  try {
    const parsed = new URL(url);
    return { label: parsed.hostname, hint: url };
  } catch {
    return { label: url, hint: url };
  }
}

function createCredentialEntry(preset: "openai" | "groq" | "custom", indexHint = 1): ModelCredentialEntry {
  const now = Date.now();
  if (preset === "openai") {
    return {
      id: generateId(),
      preset,
      label: "OpenAI",
      endpoint: "https://api.openai.com/v1",
      apiKey: "",
      createdAt: now,
      updatedAt: now
    };
  }
  if (preset === "groq") {
    return {
      id: generateId(),
      preset,
      label: "Groq",
      endpoint: "https://api.groq.com/openai/v1",
      apiKey: "",
      createdAt: now,
      updatedAt: now
    };
  }
  return {
    id: generateId(),
    preset,
    label: `Custom ${indexHint}`,
    endpoint: "",
    apiKey: "",
    createdAt: now,
    updatedAt: now
  };
}

function getModelCredentialSlot(agent: AgentConfig): { id: string; label: string; hint: string } | null {
  if (agent.type === "openai_compat") {
    const endpoint = normalizeCredentialUrl(agent.endpoint || "https://api.openai.com/v1");
    const meta = describeCredentialEndpoint(endpoint);
    return { id: `openai_compat:${endpoint}`, label: meta.label, hint: meta.hint };
  }
  if (agent.type === "custom") {
    const targetUrl = normalizeCredentialUrl(agent.custom?.url);
    const meta = describeCredentialEndpoint(targetUrl);
    return {
      id: `custom:${targetUrl || "unconfigured"}`,
      label: meta.label,
      hint: targetUrl || "Custom adapter URL 尚未設定"
    };
  }
  return null;
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

export default function App() {
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
  const activeAgent = useMemo(() => agents.find((a) => a.id === activeAgentId) ?? null, [agents, activeAgentId]);

  const [mode, setMode] = useState<OrchestratorMode>(() =>
    initialUi.mode === "leader_team" || initialUi.mode === "one_to_one" ? initialUi.mode : "one_to_one"
  );
  const [skillExecutionMode, setSkillExecutionMode] = useState<SkillExecutionMode>(() =>
    initialUi.skillExecutionMode === "multi_turn" ? "multi_turn" : "single_turn"
  );
  const [skillVerifyMax, setSkillVerifyMax] = useState<number>(() => clampSkillVerifyMax(initialUi.skillVerifyMax ?? 1));
  const [skillVerifierAgentId, setSkillVerifierAgentId] = useState<string>(() => initialUi.skillVerifierAgentId ?? "");
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [isChatFullscreen, setIsChatFullscreen] = useState(false);

  // Leader+Team config (leader = active agent)
  const [memberAgentIds, setMemberAgentIds] = useState<string[]>(() => initialUi.memberAgentIds ?? agents.slice(1).map((a) => a.id));
  const [reactMax, setReactMax] = useState<number>(() => (typeof initialUi.reactMax === "number" ? initialUi.reactMax : 2));
  const [retryDelaySec, setRetryDelaySec] = useState<number>(() => (typeof initialUi.retryDelaySec === "number" ? initialUi.retryDelaySec : 2));
  const [retryMax, setRetryMax] = useState<number>(() => (typeof initialUi.retryMax === "number" ? initialUi.retryMax : 3));
  const [historyMessageLimit, setHistoryMessageLimit] = useState<number>(() => clampHistoryLimit(initialUi.historyMessageLimit ?? 10));
  const [userName, setUserName] = useState<string>(() => initialUi.userName ?? "You");
  const [userAvatarUrl, setUserAvatarUrl] = useState<string | undefined>(() => initialUi.userAvatarUrl);
  const [userDescription, setUserDescription] = useState<string>(() => initialUi.userDescription ?? "");
  const [isSummaryExporting, setIsSummaryExporting] = useState(false);

  type ConfigModalKey = "agent" | "credentials" | "mode" | "history" | "docs" | "mcp" | "skills" | "tools" | "team" | null;
  const [configModal, setConfigModal] = useState<ConfigModalKey>(null);

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
  const systemBuiltInTools = useMemo(() => SYSTEM_BUILT_IN_TOOLS, []);
  const allBuiltInTools = useMemo(
    () => [...systemBuiltInTools, ...builtInTools.map((tool) => ({ ...tool, source: "custom" as const, readonly: false }))],
    [builtInTools, systemBuiltInTools]
  );

  const [mcpServers, setMcpServers] = useState<McpServerConfig[]>(() => loadMcpServers());
  const [mcpPromptTemplates, setMcpPromptTemplates] = useState<McpPromptTemplates>(() => loadMcpPromptTemplates());
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
      details: entry.details
    };
    setLog((x) => [normalized, ...x].slice(0, 200));
  };
  const logResizeRef = React.useRef<{ startY: number; startHeight: number } | null>(null);
  const logNow = (entry: Omit<LogEntry, "id" | "ts"> & { ts?: number }) => pushLog(entry);
  const mcpCountRef = React.useRef(mcpServers.length);

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

    setMemberAgentIds((prev) => prev.filter((id) => agents.some((a) => a.id === id) && id !== activeAgentId));
  }, [agents, activeAgentId]);

  React.useEffect(() => {
    saveUiState({
      activeTab,
      mode,
      skillExecutionMode,
      skillVerifyMax,
      skillVerifierAgentId,
      activeAgentId,
      memberAgentIds,
      reactMax,
      retryDelaySec,
      retryMax,
      historyMessageLimit,
      userName,
      userAvatarUrl,
      userDescription
    });
  }, [activeTab, mode, skillExecutionMode, skillVerifyMax, skillVerifierAgentId, activeAgentId, memberAgentIds, reactMax, retryDelaySec, retryMax, historyMessageLimit, userName, userAvatarUrl, userDescription]);

  React.useEffect(() => {
    saveMcpServers(mcpServers);
  }, [mcpServers]);

  React.useEffect(() => {
    saveMcpPromptTemplates(mcpPromptTemplates);
  }, [mcpPromptTemplates]);

  React.useEffect(() => {
    saveBuiltInTools(builtInTools);
  }, [builtInTools]);

  React.useEffect(() => {
    saveModelCredentials(modelCredentials);
  }, [modelCredentials]);

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
    setModelCredentials((prev) => {
      let changed = false;
      const next = [...prev];
      agents.forEach((agent) => {
        const slot = getModelCredentialSlot(agent);
        const legacy = agent.apiKey?.trim();
        if (slot && legacy && !next.some((entry) => normalizeCredentialUrl(entry.endpoint) === normalizeCredentialUrl(slot.hint))) {
          next.push({
            id: generateId(),
            preset:
              slot.hint === "https://api.openai.com/v1"
                ? "openai"
                : slot.hint === "https://api.groq.com/openai/v1"
                ? "groq"
                : "custom",
            label: slot.label,
            endpoint: slot.hint,
            apiKey: legacy,
            createdAt: Date.now(),
            updatedAt: Date.now()
          });
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [agents]);

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

  const availableMcpToolsForAgent = useMemo(() => {
    return availableMcpServersForAgent
      .map((server) => ({
        server,
        tools: mcpToolsByServer[server.id] ?? []
      }))
      .filter((entry) => entry.tools.length > 0);
  }, [availableMcpServersForAgent, mcpToolsByServer]);

  const availableBuiltinToolsForAgent = useMemo(() => {
    if (!activeAgent) return [];
    if (!isCategoryEnabled(activeAgent.enableBuiltInTools)) return [];
    if (!activeAgent.allowedBuiltInToolIds) {
      return allBuiltInTools.filter((tool) => tool.source !== "system");
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

  const availableToolsForAgent = useMemo<ToolEntry[]>(
    () => [
      ...availableMcpToolsForAgent.flatMap(({ server, tools }) => tools.map((tool) => ({ kind: "mcp" as const, server, tool }))),
      ...availableBuiltinToolsForAgent.map((tool) => ({ kind: "builtin" as const, tool }))
    ],
    [availableMcpToolsForAgent, availableBuiltinToolsForAgent]
  );

  const credentialSlots = useMemo(() => modelCredentials.slice().sort((a, b) => a.label.localeCompare(b.label)), [modelCredentials]);
  const configuredCredentialCount = useMemo(
    () => credentialSlots.filter((slot) => !!slot.apiKey.trim()).length,
    [credentialSlots]
  );

  function resolveApiKeyForAgent(agent: AgentConfig) {
    const slot = getModelCredentialSlot(agent);
    const shared = slot
      ? modelCredentials.find((entry) => normalizeCredentialUrl(entry.endpoint) === normalizeCredentialUrl(slot.hint))?.apiKey.trim() ?? ""
      : "";
    return shared || agent.apiKey?.trim() || undefined;
  }

  function hydrateAgentCredentials(agent: AgentConfig) {
    const apiKey = resolveApiKeyForAgent(agent);
    return apiKey && apiKey !== agent.apiKey ? { ...agent, apiKey } : agent;
  }

  function resolveSkillVerifierAgent(active: AgentConfig) {
    return hydrateAgentCredentials(configuredSkillVerifierAgent ?? active);
  }

  function addCredential(preset: "openai" | "groq" | "custom") {
    setModelCredentials((prev) => {
      if (preset === "openai" && prev.some((entry) => entry.preset === "openai")) return prev;
      if (preset === "groq" && prev.some((entry) => entry.preset === "groq")) return prev;
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
  }

  function removeCredential(id: string) {
    setModelCredentials((prev) => prev.filter((entry) => entry.id !== id));
    setVisibleCredentialIds((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

  async function onSaveAgent(a: AgentConfig) {
    try {
      upsertAgent(a);
      const next = loadAgents();
      setAgents(next);
      setActiveAgentId(a.id);
      logNow({ category: "agents", agent: a.name, ok: true, message: "Agent saved", details: JSON.stringify(a, null, 2) });
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
      logNow({ category: "agents", agent: target?.name, ok: true, message: "Agent deleted" });
    } catch (e: any) {
      logNow({ category: "agents", agent: target?.name, ok: false, message: "Agent delete failed", details: String(e?.message ?? e) });
    }
  }

  function toggleMember(id: string) {
    if (id === activeAgentId) return;
    setMemberAgentIds((prev) => {
      const exists = prev.includes(id);
      const next = exists ? prev.filter((x) => x !== id) : [...prev, id];
      const agentName = agents.find((a) => a.id === id)?.name ?? id;
      logNow({ category: "leader_team", message: `${exists ? "Member removed" : "Member added"}: ${agentName}` });
      return next;
    });
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
  }): Promise<ToolDecision | null> {
    const toolList = args.toolEntries.map((entry) =>
      entry.kind === "mcp"
        ? {
            kind: "mcp",
            serverId: entry.server.id,
            serverName: entry.server.name,
            name: entry.tool.name,
            description: entry.tool.description ?? "",
            inputSchema: entry.tool.inputSchema ?? {}
          }
        : {
            kind: "builtin",
            name: entry.tool.name,
            description: entry.tool.description,
            inputSchema: entry.tool.inputSchema ?? {}
        }
    );

    const decisionPrompt = buildToolDecisionPrompt(
      args.promptTemplate,
      args.fallbackPromptTemplate,
      args.userInput,
      JSON.stringify(toolList, null, 2)
    );

    for (let attempt = 0; attempt <= args.retry.max; attempt++) {
      const raw = await runOneToOne({
        adapter: args.adapter,
        agent: args.agent,
        input: decisionPrompt,
        history: [],
        onDelta: () => {},
        retry: args.retry,
        onLog: (t) => pushLog({ category: "retry", agent: args.agent.name, message: t })
      });

      const decision = normalizeToolDecision(extractJsonObject(raw));
      if (decision) {
        logNow({
          category: "mcp",
          agent: args.agent.name,
          ok: true,
          message: `Tool decision: ${decision.type}`,
          details: raw
        });
        return decision;
      }

      logNow({
        category: "mcp",
        agent: args.agent.name,
        ok: false,
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
  }): Promise<SkillDecision | null> {
    const skillList = buildSkillDecisionCatalog(args.skills);
    const prompt = buildSkillDecisionPrompt(args.userInput, JSON.stringify(skillList, null, 2), args.language);

    for (let attempt = 0; attempt <= args.retry.max; attempt++) {
      const raw = await runOneToOne({
        adapter: args.adapter,
        agent: args.agent,
        input: prompt,
        history: [],
        onDelta: () => {},
        retry: args.retry,
        onLog: (t) => pushLog({ category: "retry", agent: args.agent.name, message: t })
      });

      const decision = normalizeSkillDecision(extractJsonObject(raw));
      if (decision) {
        logNow({
          category: "skills",
          agent: args.agent.name,
          ok: true,
          message: `Skill decision: ${decision.type}`,
          details: raw
        });
        return decision;
      }

      logNow({
        category: "skills",
        agent: args.agent.name,
        ok: false,
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
  }) {
    const prompt = buildSkillVerifyPrompt({
      skill: args.skill,
      runtime: args.runtime,
      userInput: args.userInput,
      currentInput: args.currentInput,
      answer: args.answer,
      round: args.round
    });

    for (let attempt = 0; attempt <= args.retry.max; attempt++) {
      const raw = await runOneToOne({
        adapter: args.adapter,
        agent: args.verifierAgent,
        input: prompt,
        history: [],
        onDelta: () => {},
        retry: args.retry,
        onLog: (t) => pushLog({ category: "retry", agent: args.verifierAgent.name, message: t })
      });

      const decision = normalizeSkillVerifyDecision(extractJsonObject(raw));
      if (decision) {
        logNow({
          category: "skills",
          agent: args.answeringAgent.name,
          ok: true,
          message: `Skill verify round ${args.round}: ${decision.type}`,
          details: raw
        });
        return decision;
      }

      logNow({
        category: "skills",
        agent: args.answeringAgent.name,
        ok: false,
        message: `Skill verify invalid schema (${attempt + 1}/${args.retry.max + 1})`,
        details: raw
      });

      if (attempt < args.retry.max) {
        await sleep(args.retry.delaySec * 1000);
      }
    }

    return null;
  }

  async function resolveToolAugmentedInput(args: {
    input: string;
    agent: AgentConfig;
    adapter: ReturnType<typeof pickAdapter>;
    availableBuiltinTools: BuiltInToolConfig[];
    availableMcpServers: McpServerConfig[];
    availableMcpTools: Array<{ server: McpServerConfig; tools: McpTool[] }>;
    toolEntries: ToolEntry[];
    decisionContext?: string;
    onStatus?: (text: string) => void;
  }): Promise<string> {
    if (args.toolEntries.length === 0) {
      if (args.availableBuiltinTools.length > 0) {
        logNow({ category: "tool", agent: args.agent.name, message: "Tool decision skipped: no available tool entries" });
      } else if (args.availableMcpServers.length === 0) {
        return args.input;
      } else if (args.availableMcpTools.length === 0) {
        logNow({ category: "mcp", agent: args.agent.name, message: "Tool decision skipped: no MCP tools loaded yet" });
      }
      return args.input;
    }

    args.onStatus?.("正在判斷是否需要呼叫工具中…");
    const decision = await runToolDecision({
      agent: args.agent,
      adapter: args.adapter,
      userInput: args.decisionContext ? `${args.input}\n\nCurrent loaded skill context (internal only):\n${args.decisionContext}` : args.input,
      retry: { delaySec: retryDelaySec, max: retryMax },
      toolEntries: args.toolEntries,
      promptTemplate: mcpPromptTemplates[mcpPromptTemplates.activeId],
      fallbackPromptTemplate: getDefaultMcpPromptTemplates()[mcpPromptTemplates.activeId]
    });

    if (!decision) {
      logNow({ category: "tool", agent: args.agent.name, ok: false, message: "Tool decision failed after retries; continue without tools" });
      return args.input;
    }

    if (decision.type === "no_tool") {
      logNow({ category: "tool", agent: args.agent.name, message: "Tool decision resolved: no_tool" });
      return args.input;
    }

    if (decision.type === "builtin_tool_call") {
      args.onStatus?.(`正在呼叫內建工具「${decision.tool}」中…`);
      const targetTool = args.availableBuiltinTools.find((tool) => tool.name === decision.tool) ?? null;
      if (!targetTool) {
        const toolSummaryForQuestion = `工具執行失敗：找不到名稱為 ${decision.tool} 的 built-in tool。`;
        append(msg("tool", toolSummaryForQuestion, "builtin_tool", { displayName: "Built-in Tool" }));
        logNow({
          category: "tool",
          agent: args.agent.name,
          ok: false,
          message: `Built-in tool not found: ${decision.tool}`,
          details: JSON.stringify(decision)
        });
        return `${args.input}\n\n請將以下工具資訊一起納入回答：\n${toolSummaryForQuestion}`;
      }

      try {
        const allowed =
          !targetTool.requireConfirmation ||
          window.confirm(
            `允許 agent ${args.agent.name} 執行工具「${targetTool.displayLabel ?? targetTool.name}」嗎？\n\ninput:\n${stringifyAny(decision.input ?? {})}`
          );

        if (!allowed) {
          const toolSummaryForQuestion = `工具執行已被使用者阻止：${decision.tool}`;
          append(msg("tool", toolSummaryForQuestion, "builtin_tool", { displayName: "Built-in Tool" }));
          logNow({
            category: "tool",
            agent: args.agent.name,
            ok: false,
            message: `Built-in tool blocked by user: ${decision.tool}`,
            details: stringifyAny(decision.input ?? {})
          });
          return `${args.input}\n\n請將以下工具資訊一起納入回答：\n${toolSummaryForQuestion}`;
        }

        const allowedSystemHelpers: NonNullable<Parameters<typeof runBuiltInScriptTool>[2]>["system"] = {};
        if (args.availableBuiltinTools.some((tool) => tool.id === SYSTEM_USER_PROFILE_TOOL_ID)) {
          allowedSystemHelpers.get_user_profile = () => getUserProfileToolPayload(userProfile);
        }
        if (args.availableBuiltinTools.some((tool) => tool.id === SYSTEM_AGENT_DIRECTORY_TOOL_ID)) {
          allowedSystemHelpers.pick_best_agent_for_question = async (question: string) =>
            pickBestAgentNameForQuestion(question, loadSavedAgentsFromStorage(), args.agent.name);
        }

        const toolOutput = await runBuiltInScriptTool(targetTool, decision.input ?? {}, {
          system: allowedSystemHelpers
        });
        const toolOutputText = stringifyAny(toolOutput);
        const toolSummaryForQuestion = `工具執行結果：tool=${decision.tool}, result=${toolOutputText}`;
        append(
          msg(
            "tool",
            `Built-in tool -> ${decision.tool}\ninput:\n${stringifyAny(decision.input ?? {})}\noutput:\n${toolOutputText}`,
            "builtin_tool",
            { displayName: "Built-in Tool" }
          )
        );
        logNow({
          category: "tool",
          agent: args.agent.name,
          ok: true,
          message: `Built-in tool call OK: ${decision.tool}`,
          details: toolOutputText
        });
        return `${args.input}\n\n請將以下工具資訊一起納入回答：\n${toolSummaryForQuestion}`;
      } catch (e: any) {
        const briefError = String(e?.message ?? e);
        const toolSummaryForQuestion = `工具執行失敗：${decision.tool} 執行失敗（${briefError}）。`;
        append(msg("tool", toolSummaryForQuestion, "builtin_tool", { displayName: "Built-in Tool" }));
        logNow({
          category: "tool",
          agent: args.agent.name,
          ok: false,
          message: `Built-in tool call failed: ${decision.tool}`,
          details: briefError
        });
        return `${args.input}\n\n請將以下工具資訊一起納入回答：\n${toolSummaryForQuestion}`;
      }
    }

    const targetServer = args.availableMcpServers.find((server) => server.id === decision.serverId) ?? null;
    const targetTool = args.availableMcpTools.find((entry) => entry.server.id === decision.serverId)?.tools.find((tool) => tool.name === decision.tool) ?? null;
    let toolSummaryForQuestion = "";
    args.onStatus?.(`正在呼叫 MCP 工具「${decision.tool}」中…`);

    if (!targetServer) {
      toolSummaryForQuestion = `工具執行失敗：找不到 serverId=${decision.serverId} 的可用 MCP server。`;
      logNow({
        category: "mcp",
        agent: args.agent.name,
        ok: false,
        message: `Tool decision selected unavailable server: ${decision.serverId}`,
        details: JSON.stringify(decision)
      });
      append(msg("tool", toolSummaryForQuestion, "mcp", { displayName: "MCP Tool" }));
    } else if (!targetTool) {
      toolSummaryForQuestion = `工具執行失敗：${targetServer.name} 沒有 ${decision.tool} 這個工具。`;
      logNow({
        category: "mcp",
        agent: args.agent.name,
        ok: false,
        message: `Tool decision selected unavailable tool: ${decision.tool}`,
        details: JSON.stringify(decision)
      });
      append(msg("tool", toolSummaryForQuestion, "mcp", { displayName: "MCP Tool" }));
    } else {
      try {
        const client = new McpSseClient(targetServer);
        client.connect((t) => pushLog({ category: "mcp", agent: targetServer.name, message: t }));
        const toolOutput = await callTool(client, decision.tool, decision.input ?? {});
        const toolOutputText = stringifyAny(toolOutput);
        toolSummaryForQuestion = `工具執行結果：server=${targetServer.name}, tool=${decision.tool}, result=${toolOutputText}`;
        logNow({
          category: "mcp",
          agent: targetServer.name,
          ok: true,
          message: `MCP tool call OK: ${decision.tool}`,
          details: toolOutputText
        });
        append(
          msg(
            "tool",
            `MCP ${targetServer.name} -> ${decision.tool}\ninput:\n${stringifyAny(decision.input ?? {})}\noutput:\n${toolOutputText}`,
            "mcp",
            { displayName: "MCP Tool" }
          )
        );
      } catch (e: any) {
        const briefError = String(e?.message ?? e);
        toolSummaryForQuestion = `工具執行失敗：${decision.tool} 呼叫失敗（${briefError}）。`;
        append(msg("tool", toolSummaryForQuestion, "mcp", { displayName: "MCP Tool" }));
        logNow({
          category: "mcp",
          agent: targetServer.name,
          ok: false,
          message: `Tool call failed: ${decision.tool}`,
          details: briefError
        });
      }
    }

    return toolSummaryForQuestion ? `${args.input}\n\n請將以下工具資訊一起納入回答：\n${toolSummaryForQuestion}` : args.input;
  }

  async function prepareSkillExecution(args: {
    skill: SkillConfig;
    skillInput: any;
    userInput: string;
    agent: AgentConfig;
    adapter: ReturnType<typeof pickAdapter>;
    onStatus?: (text: string) => void;
  }): Promise<PreparedSkillExecution> {
    args.onStatus?.(`正在載入 skill「${args.skill.name}」中…`);
    const loaded = loadSkillRuntime({
      skill: args.skill,
      skillDocs: args.skill.workflow.useSkillDocs !== false ? await listSkillDocs(args.skill.id) : [],
      agentDocs: docsForAgent,
      availableMcpServers: availableMcpServersForAgent,
      availableMcpTools: availableMcpToolsForAgent,
      availableBuiltinTools: availableBuiltinToolsForAgent,
      userInput: args.userInput,
      skillInput: args.skillInput
    });

    const scopedMcpServers = loaded.runtime.allowMcp
      ? loaded.runtime.allowedMcpServerIds?.length
        ? availableMcpServersForAgent.filter((server) => loaded.runtime.allowedMcpServerIds?.includes(server.id))
        : availableMcpServersForAgent
      : [];

    const scopedMcpTools = loaded.runtime.allowMcp
      ? availableMcpToolsForAgent.filter((entry) => scopedMcpServers.some((server) => server.id === entry.server.id))
      : [];

    const scopedBuiltInTools = loaded.runtime.allowBuiltInTools
      ? loaded.runtime.allowedBuiltInToolIds?.length
        ? availableBuiltinToolsForAgent.filter((tool) => loaded.runtime.allowedBuiltInToolIds?.includes(tool.id))
        : availableBuiltinToolsForAgent
      : [];

    const scopedToolEntries: ToolEntry[] = [
      ...scopedMcpTools.flatMap(({ server, tools }) => tools.map((tool) => ({ kind: "mcp" as const, server, tool }))),
      ...scopedBuiltInTools.map((tool) => ({ kind: "builtin" as const, tool }))
    ];

    const decisionContext = [
      loaded.runtime.instructions ? `Skill workflow:\n${loaded.runtime.instructions}` : "",
      loaded.runtime.loadedReferences.length
        ? `Loaded references:\n${loaded.runtime.loadedReferences.map((doc) => `- ${doc.path}`).join("\n")}`
        : ""
    ]
      .filter(Boolean)
      .join("\n\n");

    const finalInput = await resolveToolAugmentedInput({
      input: loaded.finalInput,
      agent: args.agent,
      adapter: args.adapter,
      availableBuiltinTools: scopedBuiltInTools,
      availableMcpServers: scopedMcpServers,
      availableMcpTools: scopedMcpTools,
      toolEntries: scopedToolEntries,
      decisionContext,
      onStatus: args.onStatus
    });

    return {
      baseInput: loaded.finalInput,
      finalInput,
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
    onStatus?: (text: string) => void;
  }): Promise<{ finalInput: string; trace: ChatTraceEntry[] }> {
    const trace = [...args.initialTrace];
    const verifierAgent = resolveSkillVerifierAgent(args.agent);
    const verifierAdapter = pickAdapter(verifierAgent);
    const scopedToolEntries: ToolEntry[] = [
      ...args.prepared.scopedMcpTools.flatMap(({ server, tools }) => tools.map((tool) => ({ kind: "mcp" as const, server, tool }))),
      ...args.prepared.scopedBuiltInTools.map((tool) => ({ kind: "builtin" as const, tool }))
    ];

    pushSkillExecutionModeTrace(trace, {
      mode: "multi_turn",
      verifyMax: skillVerifyMax,
      verifierName: verifierAgent.name
    });

    args.onStatus?.("正在依 skill 產生初版回答中…");
    let currentInput = args.prepared.finalInput;
    let currentAnswer = await runOneToOne({
      adapter: args.adapter,
      agent: args.agent,
      input: currentInput,
      history: limitHistory(history),
      system: args.prepared.system,
      onDelta: () => {},
      retry: { delaySec: retryDelaySec, max: retryMax },
      onLog: (t) => pushLog({ category: "retry", agent: args.agent.name, message: t })
    });

    pushSkillTrace(trace, "Skill answer round 1", currentAnswer);

    if (skillVerifyMax === 0) {
      pushSkillTrace(trace, "Skill verify", "已設定 verify 次數為 0，略過 refine。");
      return { finalInput: currentInput, trace };
    }

    for (let round = 1; round <= skillVerifyMax; round++) {
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
        retry: { delaySec: retryDelaySec, max: retryMax }
      });

      if (!verifyDecision) {
        pushSkillTrace(trace, `Skill verify round ${round}`, "Verifier 在重試後仍未回傳合法 JSON，停止 refine。");
        break;
      }

      if (verifyDecision.type === "pass") {
        pushSkillTrace(
          trace,
          `Skill verify round ${round}`,
          [`結果：通過`, verifyDecision.reason ? `原因：${verifyDecision.reason}` : ""].filter(Boolean).join("\n")
        );
        return { finalInput: currentInput, trace };
      }

      pushSkillTrace(
        trace,
        `Skill verify round ${round}`,
        [`結果：需要 refine`, `原因：${verifyDecision.reason}`, verifyDecision.revisionPrompt ? `Revision prompt:\n${verifyDecision.revisionPrompt}` : ""]
          .filter(Boolean)
          .join("\n")
      );

      const refinedBaseInput = buildSkillRefinementInput({
        currentInput: args.prepared.baseInput,
        verifyDecision,
        round
      });

      args.onStatus?.(`正在依 verifier 建議進行第 ${round} 輪修正…`);
      currentInput = await resolveToolAugmentedInput({
        input: refinedBaseInput,
        agent: args.agent,
        adapter: args.adapter,
        availableBuiltinTools: args.prepared.scopedBuiltInTools,
        availableMcpServers: args.prepared.scopedMcpServers,
        availableMcpTools: args.prepared.scopedMcpTools,
        toolEntries: scopedToolEntries,
        decisionContext: args.prepared.decisionContext,
        onStatus: args.onStatus
      });

      pushSkillTrace(trace, `Skill refine round ${round}`, currentInput);

      args.onStatus?.(`正在產生第 ${round + 1} 輪回答中…`);
      currentAnswer = await runOneToOne({
        adapter: args.adapter,
        agent: args.agent,
        input: currentInput,
        history: limitHistory(history),
        system: args.prepared.system,
        onDelta: () => {},
        retry: { delaySec: retryDelaySec, max: retryMax },
        onLog: (t) => pushLog({ category: "retry", agent: args.agent.name, message: t })
      });

      pushSkillTrace(trace, `Skill answer round ${round + 1}`, currentAnswer);
    }

    pushSkillTrace(trace, "Skill verify", `已達最大 verify 次數 ${skillVerifyMax}，回傳最後一次 refine 的結果。`);
    return { finalInput: currentInput, trace };
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
  const agentDirectory = React.useMemo(() => {
    const map = new Map<string, { displayName: string; avatarUrl?: string }>();
    agents.forEach((agent) => {
      map.set(agent.name, { displayName: agent.name, avatarUrl: agent.avatarUrl });
    });
    return map;
  }, [agents]);

  function limitHistory(messages: ChatMessage[]) {
    const limit = clampHistoryLimit(historyMessageLimit);
    return messages.slice(-limit);
  }

  const leaderPhaseRef = React.useRef<"planning" | "verification" | "summary" | "act" | "assign" | "react" | null>(null);
  const leaderLastEventRef = React.useRef<"member_reply" | "leader_action" | null>(null);

  function emitLeaderPhase(phase: "planning" | "verification" | "summary" | "act" | "assign" | "react") {
    if (leaderPhaseRef.current === phase) return;
    leaderPhaseRef.current = phase;
    const label =
      phase === "planning"
        ? "PLANNING"
        : phase === "assign"
        ? "ASSIGN"
        : phase === "react"
        ? "REACT"
        : phase === "act"
        ? "ACT"
        : phase === "verification"
        ? "VERIFICATION"
        : "SUMMARY";
    append(msg("system", label, "phase"));
  }

  async function onSend(input: string) {
    if (!activeAgent) {
      logNow({ category: "chat", ok: false, message: "Send skipped: no active agent", details: input });
      return;
    }

    const startedAt = Date.now();
    logNow({
      category: "chat",
      agent: activeAgent.name,
      message: `Send (${mode})`,
      details: input
    });

    const docBlocks = docsForAgent.map((d) => `[DOC:${d.title}]\n${d.content}`).join("\n\n");
    const userSystem = docBlocks ? `You may use these documents as context:\n\n${docBlocks}` : undefined;
    logNow({
      category: "chat",
      agent: activeAgent.name,
      message: "Context prepared",
      details: `docs=${docsForAgent.length} history=${history.length}`
    });

    // User message
    const userMsg = msg("user", input, "user", { displayName: userProfile.name, avatarUrl: userProfile.avatarUrl });
    append(userMsg);
    const baseHistory = [...history, userMsg];
    const modelHistory = limitHistory(baseHistory);

    try {
      if (mode === "one_to_one") {
        logNow({ category: "chat", agent: activeAgent.name, message: "normal talking started" });
        const assistantId = generateId();
        append({
          id: assistantId,
          role: "assistant",
          content: "",
          ts: Date.now(),
          name: activeAgent.name,
          displayName: activeAgent.name,
          avatarUrl: activeAgent.avatarUrl,
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
        const resolvedActiveAgent = hydrateAgentCredentials(activeAgent);
        const adapter = pickAdapter(resolvedActiveAgent);
        let finalInput = input;
        let finalSystem = userSystem;
        const skillTrace: ChatTraceEntry[] = [];
        let preparedSkillExecution: PreparedSkillExecution | null = null;
        let selectedSkillForExecution: SkillConfig | null = null;
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
            retry: { delaySec: retryDelaySec, max: retryMax },
            skills: availableSkillsForAgent,
            language: mcpPromptTemplates.activeId
          });

          if (!skillDecision) {
            pushSkillTrace(skillTrace, "Skill decision", `可用 skills：${availableSkillsForAgent.length} 個\n結果：skill decision 重試後仍失敗，改走一般 tool decision。`);
            logNow({ category: "skills", agent: activeAgent.name, ok: false, message: "Skill decision failed after retries; continue without skills" });
            finalInput = await resolveToolAugmentedInput({
              input,
              agent: resolvedActiveAgent,
              adapter,
              availableBuiltinTools: availableBuiltinToolsForAgent,
              availableMcpServers: availableMcpServersForAgent,
              availableMcpTools: availableMcpToolsForAgent,
              toolEntries: availableToolsForAgent,
              onStatus: setAssistantStatus
            });
          } else if (skillDecision.type === "no_skill") {
            pushSkillTrace(skillTrace, "Skill decision", `可用 skills：${availableSkillsForAgent.length} 個\n結果：這一回合不使用 skill。`);
            logNow({ category: "skills", agent: activeAgent.name, message: "Skill decision resolved: no_skill" });
            finalInput = await resolveToolAugmentedInput({
              input,
              agent: resolvedActiveAgent,
              adapter,
              availableBuiltinTools: availableBuiltinToolsForAgent,
              availableMcpServers: availableMcpServersForAgent,
              availableMcpTools: availableMcpToolsForAgent,
              toolEntries: availableToolsForAgent,
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
                agent: activeAgent.name,
                ok: false,
                message: `Skill decision selected unavailable skill: ${skillDecision.skillId}`,
                details: JSON.stringify(skillDecision)
              });
              finalInput = await resolveToolAugmentedInput({
                input,
                agent: resolvedActiveAgent,
                adapter,
                availableBuiltinTools: availableBuiltinToolsForAgent,
                availableMcpServers: availableMcpServersForAgent,
                availableMcpTools: availableMcpToolsForAgent,
                toolEntries: availableToolsForAgent,
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
                onStatus: setAssistantStatus
              });
              preparedSkillExecution = prepared;
              selectedSkillForExecution = selectedSkill;
              finalInput = prepared.finalInput;
              finalSystem = prepared.system;
              skillTrace.push(...prepared.trace);
              logNow({
                category: "skills",
                agent: activeAgent.name,
                ok: true,
                message: `Skill selected: ${selectedSkill.name}`,
                details: JSON.stringify(skillDecision.input ?? {})
              });
            }
          }
        } else {
          if (activeAgent.enableSkills === true) {
            pushSkillTrace(skillTrace, "Skill decision", "沒有可用的 skill，已略過 skill decision。");
          }
          logNow({ category: "skills", agent: activeAgent.name, message: "Skill decision skipped: no available skills" });
          finalInput = await resolveToolAugmentedInput({
            input,
            agent: resolvedActiveAgent,
            adapter,
            availableBuiltinTools: availableBuiltinToolsForAgent,
            availableMcpServers: availableMcpServersForAgent,
            availableMcpTools: availableMcpToolsForAgent,
            toolEntries: availableToolsForAgent,
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
              onStatus: setAssistantStatus
            });
            finalInput = executed.finalInput;
            finalSystem = preparedSkillExecution.system;
            patchMessage(assistantId, {
              skillTrace: executed.trace.length ? executed.trace : undefined,
              statusText: "正在生成最終回覆中…",
              isStreaming: true,
              hideWhileStreaming: false
            });
            skillTrace.length = 0;
            skillTrace.push(...executed.trace);
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
            logNow({ category: "chat", agent: activeAgent.name, message: "normal talking streaming started" });
          }
        };

        const full = await runOneToOne({
          adapter,
          agent: resolvedActiveAgent,
          input: finalInput,
          history: limitHistory(history),
          system: finalSystem,
          onDelta,
          retry: { delaySec: retryDelaySec, max: retryMax },
          onLog: (t) => pushLog({ category: "retry", agent: activeAgent.name, message: t })
        });
        finalizeAssistant({
          content: full,
          skillTrace: skillTrace.length ? skillTrace : undefined
        });
        logNow({
          category: "chat",
          agent: activeAgent.name,
          ok: true,
          message: "normal talking completed",
          details: `elapsed_ms=${Date.now() - startedAt}\nresponse_len=${full.length}\n\n${full}`
        });
        return;
      }

      // Deprecated legacy goal-driven talking: user input is a GOAL
      const leaderAgent = hydrateAgentCredentials(activeAgent);
      const memberAgents = agents
        .filter((a) => memberAgentIds.includes(a.id) && a.id !== leaderAgent.id)
        .map((agent) => hydrateAgentCredentials(agent));

      if (memberAgents.length === 0) {
        append(msg("assistant", "No member agents selected. Please select at least one member.", "system", { displayName: "System" }));
        return;
      }

      leaderPhaseRef.current = null;
      leaderLastEventRef.current = null;
      pushLog({
        category: "leader_team",
        agent: leaderAgent.name,
        ok: true,
        message: `Started. Members=${memberAgents.map((m) => m.name).join(", ")}`
      });

      emitLeaderPhase("planning");
      // Show a visible kickoff message from the leader
      append(msg("assistant", `Goal received. I'll coordinate the team to achieve it.`, leaderAgent.name, { displayName: leaderAgent.name, avatarUrl: leaderAgent.avatarUrl }));

      const onEvent = (ev: LeaderTeamEvent) => {
        if (ev.type === "leader_plan") {
          emitLeaderPhase("planning");
          const memberNameById = new Map(memberAgents.map((m) => [m.id, m.name]));
          const planLines = ev.assignments.map((a, i) => {
            const name = memberNameById.get(a.memberId) ?? a.memberId;
            return `${i + 1}. @${name}: ${a.message} (plan id: ${a.memberId})`;
          });
          append(
            msg(
              "assistant",
              `Plan:\n${planLines.join("\n")}${ev.notes ? `\n\nNotes:\n${ev.notes}` : ""}`,
              leaderAgent.name,
              { displayName: leaderAgent.name, avatarUrl: leaderAgent.avatarUrl }
            )
          );
          logNow({
            category: "leader_team",
            agent: leaderAgent.name,
            message: "Planning completed",
            details: ev.notes ?? planLines.join("\n")
          });
          return;
        }
        if (ev.type === "leader_retry") {
          emitLeaderPhase("planning");
          append(
            msg(
              "assistant",
              `RETRY (${ev.attempt}/${ev.max}): invalid action, resending`,
              leaderAgent.name,
              { displayName: leaderAgent.name, avatarUrl: leaderAgent.avatarUrl }
            )
          );
          logNow({
            category: "leader_team",
            agent: leaderAgent.name,
            ok: false,
            message: `Leader retry ${ev.attempt}/${ev.max}`,
            details: ev.raw
          });
          return;
        }
        if (ev.type === "leader_ask_member") {
          emitLeaderPhase("assign");
          leaderLastEventRef.current = "leader_action";
          append(msg("assistant", `@${ev.memberName} — ${ev.message}`, leaderAgent.name, { displayName: leaderAgent.name, avatarUrl: leaderAgent.avatarUrl }));
          logNow({
            category: "leader_team",
            agent: leaderAgent.name,
            message: `Leader asked ${ev.memberName}`,
            details: ev.message
          });
          return;
        }
        if (ev.type === "member_reply") {
          emitLeaderPhase("act");
          leaderLastEventRef.current = "member_reply";
          // Show the member's answer
          append(msg("assistant", ev.reply, ev.memberName, agentDirectory.get(ev.memberName)));
          logNow({ category: "leader_team", agent: ev.memberName, message: "Member replied", details: ev.reply });
          return;
        }
        if (ev.type === "leader_verify") {
          emitLeaderPhase("verification");
          append(
            msg(
              "assistant",
              `Verification ${ev.ok ? "OK" : "FAIL"}${ev.notes ? `:\n${ev.notes}` : ""}`,
              leaderAgent.name,
              { displayName: leaderAgent.name, avatarUrl: leaderAgent.avatarUrl }
            )
          );
          logNow({
            category: "leader_team",
            agent: leaderAgent.name,
            ok: ev.ok,
            message: "Verification",
            details: ev.notes ?? ev.raw
          });
          return;
        }
        if (ev.type === "leader_react") {
          emitLeaderPhase("react");
          append(msg("assistant", `REACT -> @${ev.memberName}\n${ev.message}`, leaderAgent.name, { displayName: leaderAgent.name, avatarUrl: leaderAgent.avatarUrl }));
          logNow({
            category: "leader_team",
            agent: leaderAgent.name,
            ok: false,
            message: `REACT -> ${ev.memberName}`,
            details: `${ev.reason ?? ""}\n${ev.message}`.trim()
          });
          return;
        }
        if (ev.type === "leader_invalid_json") {
          append(msg("assistant", `Leader produced an invalid action. Raw output:\n\n${ev.text}`, leaderAgent.name, { displayName: leaderAgent.name, avatarUrl: leaderAgent.avatarUrl }));
          logNow({
            category: "leader_team",
            agent: leaderAgent.name,
            ok: false,
            message: `Leader invalid JSON: ${ev.text}`,
            details: ev.text
          });
          return;
        }
        if (ev.type === "leader_finish") {
          emitLeaderPhase("summary");
          append(msg("assistant", ev.answer, leaderAgent.name, { displayName: leaderAgent.name, avatarUrl: leaderAgent.avatarUrl }));
          logNow({ category: "leader_team", agent: leaderAgent.name, ok: true, message: "Leader finished", details: ev.answer });
          return;
        }
        // leader_decision_raw is mostly internal; keep it in log only to avoid clutter
      };

      await runLeaderTeam({
        leader: { agent: leaderAgent, adapter: pickAdapter(leaderAgent) },
        members: memberAgents.map((m) => ({ agent: m, adapter: pickAdapter(m) })),
        goal: input,
        userHistory: modelHistory,
        userSystem,
        maxRounds: 8,
        reactMax,
        retry: { delaySec: retryDelaySec, max: retryMax },
        onLog: (t) =>
          pushLog({
            category: t.startsWith("[retry]") ? "retry" : "leader_team",
            agent: leaderAgent.name,
            message: t
          }),
        onDelta: () => {},
        onEvent
      });
      logNow({
        category: "leader_team",
        agent: leaderAgent.name,
        ok: true,
        message: "Leader+Team finished",
        details: `elapsed_ms=${Date.now() - startedAt}`
      });
    } catch (e: any) {
      append(msg("assistant", `[ERROR]\n${e?.message ?? String(e)}`, "system", { displayName: "System" }));
      logNow({ category: "chat", agent: activeAgent?.name, ok: false, message: "Send failed", details: String(e?.message ?? e) });
    }
  }

  async function onCreateDoc() {
    const d: DocItem = { id: generateId(), title: "New Doc", content: "", updatedAt: Date.now() };
    try {
      await upsertDoc(d);
      setDocs(await listDocs());
      setDocEditorId(d.id);
      logNow({ category: "docs", ok: true, message: "Doc created", details: JSON.stringify(d, null, 2) });
    } catch (e: any) {
      logNow({ category: "docs", ok: false, message: "Doc create failed", details: String(e?.message ?? e) });
    }
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

  async function onExportSkill(skillId: string) {
    const target = skills.find((skill) => skill.id === skillId);
    const blob = await exportSkillZip(skillId);
    downloadFileBlob(`${target?.rootPath ?? skillId}.zip`, blob);
    logNow({ category: "skills", ok: true, message: `Skill exported: ${target?.name ?? skillId}`, details: target?.rootPath ?? skillId });
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
    try {
      const resolvedActiveAgent = hydrateAgentCredentials(activeAgent);
      const adapter = pickAdapter(resolvedActiveAgent);
      const summary = await runOneToOne({
        adapter,
        agent: resolvedActiveAgent,
        input:
          "Please compress this conversation into a concise reusable summary for future continuation. Keep key facts, decisions, unresolved items, user preferences, and open tasks. Output plain text only.",
        history,
        system:
          "You are preparing a conversation carry-over note. Write in Traditional Chinese when possible. Do not include markdown code fences.",
        retry: { delaySec: retryDelaySec, max: retryMax },
        onDelta: () => {},
        onLog: (t) => pushLog({ category: "retry", agent: activeAgent.name, message: t })
      });

      const payload: ExportPayload = {
        kind: "summary_history",
        exportedAt: Date.now(),
        summary,
        agent: { id: activeAgent.id, name: activeAgent.name, model: activeAgent.model }
      };
      downloadBlob(`agent-go-round-summary-${Date.now()}.json`, JSON.stringify(payload, null, 2), "application/json;charset=utf-8");
      logNow({ category: "chat", agent: activeAgent.name, ok: true, message: "Summary history exported", details: summary });
    } catch (e: any) {
      logNow({ category: "chat", agent: activeAgent.name, ok: false, message: "Summary export failed", details: String(e?.message ?? e) });
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

  return (
    <div className="app-shell">
      <div className="card topbar">
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
                  logNow({ category: "chat", message: "Chat cleared" });
                }}
                leaderName={mode === "leader_team" ? activeAgent?.name : null}
                userName={userProfile.name}
                modeLabel={mode === "leader_team" ? "goal-driven talking (deprecated)" : "normal"}
                onExportRaw={exportRawHistory}
                onExportSummary={exportSummaryHistory}
                onImportHistory={importHistoryFile}
                isSummaryExporting={isSummaryExporting}
                onOpenFullscreen={() => setIsChatFullscreen(true)}
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
              <button className="cc-card" onClick={() => setConfigModal("agent")}>
                <span className="cc-card-label">Agent</span>
                <strong className="cc-card-value">{activeAgent?.name ?? "None"}</strong>
                <span className="cc-card-hint">{activeAgent?.type ?? ""}{activeAgent?.model ? ` · ${activeAgent.model}` : ""}</span>
              </button>
              <button className="cc-card" onClick={() => setConfigModal("credentials")}>
                <span className="cc-card-label">Credentials</span>
                <strong className="cc-card-value">{configuredCredentialCount}/{credentialSlots.length}</strong>
                <span className="cc-card-hint">集中管理模型金鑰與後續憑證</span>
              </button>
              <button className="cc-card" onClick={() => setConfigModal("mode")}>
                <span className="cc-card-label">Mode</span>
                <strong className="cc-card-value">{mode === "leader_team" ? "goal-driven (deprecated)" : "normal"}</strong>
                <span className="cc-card-hint">{mode === "leader_team" ? "Legacy Leader → Members" : "1:1 對話"}</span>
              </button>
              <button className="cc-card" onClick={() => setConfigModal("history")}>
                <span className="cc-card-label">History & Retry</span>
                <strong className="cc-card-value">{historyMessageLimit} msgs</strong>
                <span className="cc-card-hint">retry {retryMax}× / delay {retryDelaySec}s</span>
              </button>
              {mode === "leader_team" && (
                <button className="cc-card" onClick={() => setConfigModal("team")}>
                  <span className="cc-card-label">Team</span>
                  <strong className="cc-card-value">{memberAgentIds.length} members</strong>
                  <span className="cc-card-hint">Leader: {activeAgent?.name ?? "—"}</span>
                </button>
              )}
              <button className="cc-card" onClick={() => setConfigModal("docs")}>
                <span className="cc-card-label">Docs</span>
                <strong className="cc-card-value">{docs.length}</strong>
                <span className="cc-card-hint">IndexedDB 文件庫</span>
              </button>
              <button className="cc-card" onClick={() => setConfigModal("mcp")}>
                <span className="cc-card-label">MCP (SSE)</span>
                <strong className="cc-card-value">{mcpServers.length}</strong>
                <span className="cc-card-hint">外部工具伺服器</span>
              </button>
              <button className="cc-card" onClick={() => setConfigModal("skills")}>
                <span className="cc-card-label">Skills</span>
                <strong className="cc-card-value">{skills.length}</strong>
                <span className="cc-card-hint">Workflow layer</span>
              </button>
              <button className="cc-card" onClick={() => setConfigModal("tools")}>
                <span className="cc-card-label">Built-in Tools</span>
                <strong className="cc-card-value">{builtInTools.length}</strong>
                <span className="cc-card-hint">Browser JS tools</span>
              </button>
            </div>

            {/* ── Config modals ── */}
            {configModal === "agent" && (
              <HelpModal title="Active Agent" onClose={() => setConfigModal(null)} width="min(480px, 92vw)">
                <div style={{ display: "grid", gap: 8 }}>
                  {agents.map((a) => (
                    <button
                      key={a.id}
                      onClick={() => { setActiveAgentId(a.id); setConfigModal(null); }}
                      style={{
                        textAlign: "left",
                        padding: 14,
                        borderRadius: 12,
                        border: a.id === activeAgentId ? "1px solid var(--primary)" : "1px solid var(--border)",
                        background: a.id === activeAgentId ? "rgba(91,123,255,0.12)" : "var(--bg-2)",
                        color: "var(--text)",
                        cursor: "pointer"
                      }}
                    >
                      <div style={{ fontWeight: 700 }}>{a.name}</div>
                      <div style={{ fontSize: 12, opacity: 0.7 }}>{a.type}{a.model ? ` · ${a.model}` : ""}</div>
                    </button>
                  ))}
                </div>
              </HelpModal>
            )}

            {configModal === "mode" && (
              <HelpModal title="Mode" onClose={() => setConfigModal(null)} width="min(420px, 92vw)">
                <div style={{ display: "grid", gap: 8 }}>
                  {([["one_to_one", "Normal", "一般一對一對話模式，可自由搭配skills、mcp and built-in tools、docs使用"], ["leader_team", "Goal-driven Talking (Deprecated)", "舊版 Leader 規劃任務、派給 member 協作模式，後續將逐步淘汰"]] as const).map(([value, title, desc]) => (
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
                <div style={{ display: "grid", gap: 14 }}>
                  <div style={{ fontSize: 12, opacity: 0.78, lineHeight: 1.7 }}>
                    這裡集中管理和模型或外部服務有關的 credentials。這一版先放共用的 Model API Key，會依 provider / endpoint 自動套用給所有相同服務的 agent。
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button type="button" onClick={() => addCredential("openai")} style={iconActionBtn}>
                      + OpenAI
                    </button>
                    <button type="button" onClick={() => addCredential("groq")} style={iconActionBtn}>
                      + Groq
                    </button>
                    <button type="button" onClick={() => addCredential("custom")} style={iconActionBtn}>
                      + Custom
                    </button>
                  </div>
                  {credentialSlots.length === 0 ? (
                    <div style={{ fontSize: 12, opacity: 0.7 }}>目前還沒有 credential。可先新增 OpenAI、Groq 或 Custom。</div>
                  ) : (
                    credentialSlots.map((slot) => (
                      <div key={slot.id} className="card" style={{ padding: 14, display: "grid", gap: 10 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                          <div>
                            <div style={{ fontWeight: 800 }}>{slot.label}</div>
                            <div style={{ fontSize: 12, opacity: 0.72 }}>{slot.endpoint || "尚未設定 endpoint"}</div>
                          </div>
                          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
                            <div style={{ fontSize: 12, opacity: 0.72 }}>{slot.apiKey.trim() ? "已設定 API key" : "尚未設定 API key"}</div>
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
                          />
                        </div>

                        <div style={{ display: "grid", gap: 6 }}>
                          <label style={label}>Model API Key</label>
                          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                            <input
                              type={visibleCredentialIds[slot.id] ? "text" : "password"}
                              value={slot.apiKey}
                              onChange={(e) => {
                                updateCredential(slot.id, { apiKey: e.target.value });
                              }}
                              style={{ width: "100%", marginTop: 0, boxSizing: "border-box", ...selectStyle }}
                              placeholder="Enter API key"
                            />
                            <button
                              type="button"
                              onClick={() => setVisibleCredentialIds((prev) => ({ ...prev, [slot.id]: !prev[slot.id] }))}
                              style={iconBtn}
                              title={visibleCredentialIds[slot.id] ? "Hide API key" : "Show API key"}
                              aria-label={visibleCredentialIds[slot.id] ? "Hide API key" : "Show API key"}
                            >
                              <EyeIcon open={!!visibleCredentialIds[slot.id]} />
                            </button>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </HelpModal>
            )}

            {configModal === "history" && (
              <HelpModal title="History & Retry" onClose={() => setConfigModal(null)} width="min(460px, 92vw)">
                <div style={{ display: "grid", gap: 14 }}>
                  <div>
                    <label style={label}>Messages sent to model</label>
                    <input type="number" min={1} max={200} value={historyMessageLimit} onChange={(e) => setHistoryMessageLimit(clampHistoryLimit(Number(e.target.value)))} style={{ width: "100%", marginTop: 6, boxSizing: "border-box", ...selectStyle }} />
                  </div>
                  <div>
                    <label style={label}>Delay (sec)</label>
                    <input type="number" min={0} max={10} value={retryDelaySec} onChange={(e) => { const n = Number(e.target.value); setRetryDelaySec(Number.isFinite(n) ? Math.max(0, Math.min(10, n)) : 0); }} style={{ width: "100%", marginTop: 6, boxSizing: "border-box", ...selectStyle }} />
                  </div>
                  <div>
                    <label style={label}>Max retries</label>
                    <input type="number" min={0} max={10} value={retryMax} onChange={(e) => { const n = Number(e.target.value); setRetryMax(Number.isFinite(n) ? Math.max(0, Math.min(10, n)) : 0); }} style={{ width: "100%", marginTop: 6, boxSizing: "border-box", ...selectStyle }} />
                  </div>
                  {mode === "leader_team" && (
                    <div>
                      <label style={label}>REACT max</label>
                      <input type="number" min={0} max={5} value={reactMax} onChange={(e) => { const n = Number(e.target.value); setReactMax(Number.isFinite(n) ? Math.max(0, Math.min(5, n)) : 0); }} style={{ width: "100%", marginTop: 6, boxSizing: "border-box", ...selectStyle }} />
                    </div>
                  )}
                  <div style={{ fontSize: 12, opacity: 0.7, lineHeight: 1.6 }}>
                    Default history is 10. Only the latest N messages are sent to the model.
                  </div>
                </div>
              </HelpModal>
            )}

            {configModal === "team" && (
              <HelpModal title="Leader Team Setup" onClose={() => setConfigModal(null)} width="min(480px, 92vw)">
                <div style={{ fontSize: 13, opacity: 0.7, marginBottom: 12, lineHeight: 1.6 }}>
                  Leader: <strong>{activeAgent?.name ?? "None"}</strong>. Pick member agents below.
                </div>
                <div style={{ display: "grid", gap: 8 }}>
                  {agents.filter((a) => a.id !== activeAgentId).map((a) => {
                    const checked = memberAgentIds.includes(a.id);
                    return (
                      <label
                        key={a.id}
                        style={{
                          display: "flex",
                          gap: 10,
                          alignItems: "center",
                          padding: 14,
                          borderRadius: 12,
                          border: checked ? "1px solid rgba(91,123,255,0.45)" : "1px solid var(--border)",
                          background: checked ? "rgba(91,123,255,0.08)" : "var(--bg-2)",
                          cursor: "pointer"
                        }}
                      >
                        <input type="checkbox" checked={checked} onChange={() => toggleMember(a.id)} />
                        <div>
                          <div style={{ fontWeight: 700, fontSize: 13 }}>{a.name}</div>
                          <div style={{ fontSize: 11, opacity: 0.7 }}>{a.type}{a.model ? ` · ${a.model}` : ""}</div>
                        </div>
                      </label>
                    );
                  })}
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
                  promptTemplates={mcpPromptTemplates}
                  onChangePromptTemplates={setMcpPromptTemplates}
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
                  verifierAgentId={skillVerifierAgentId}
                  builtInTools={allBuiltInTools}
                  mcpToolCatalog={globalMcpToolCatalog}
                  onChangeExecutionMode={setSkillExecutionMode}
                  onChangeVerifyMax={(value) => setSkillVerifyMax(clampSkillVerifyMax(value))}
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
                onSelect={(id) => setActiveAgentId(id)}
                onSave={onSaveAgent}
                onDelete={onDeleteAgent}
                onDetect={async (a) => {
                  const resolvedAgent = hydrateAgentCredentials(a);
                  const adapter = pickAdapter(resolvedAgent);
                  const r = adapter.detect ? await adapter.detect(resolvedAgent) : { ok: false, detectedType: "unknown" as const, notes: "No detect()" };
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
                credentialProviders={credentialSlots}
                resolveApiKey={resolveApiKeyForAgent}
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
              />

              <label style={label}>自我描述</label>
              <textarea
                value={userDescription}
                onChange={(e) => setUserDescription(e.target.value)}
                rows={4}
                style={{ width: "100%", marginBottom: 14, ...selectStyle, resize: "vertical" }}
                placeholder="例如：你是團隊 PM，偏好繁體中文、重視可執行的結論。"
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
                logNow({ category: "chat", message: "Chat cleared" });
              }}
              leaderName={mode === "leader_team" ? activeAgent?.name : null}
              userName={userProfile.name}
              modeLabel={mode === "leader_team" ? "goal-driven talking (deprecated)" : "normal"}
              onExportRaw={exportRawHistory}
              onExportSummary={exportSummaryHistory}
              onImportHistory={importHistoryFile}
              isSummaryExporting={isSummaryExporting}
              fullscreen
              onCloseFullscreen={() => setIsChatFullscreen(false)}
            />
          </div>
        </HelpModal>
      )}

      <div className="log-shell card">
        <div className="log-header">
          <div className="log-title">Log</div>
          <button className="log-toggle" onClick={() => setLogCollapsed((c) => !c)}>
            {logCollapsed ? "Expand" : "Collapse"}
          </button>
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
                  <button className="log-sort" onClick={() => setLogSort((s) => ({ key: "ok", dir: s.key === "ok" && s.dir === "asc" ? "desc" : "asc" }))}>
                    OK{logSort.key === "ok" ? (logSort.dir === "asc" ? " ^" : " v") : ""}
                  </button>
                  <button className="log-sort" onClick={() => setLogSort((s) => ({ key: "ts", dir: s.key === "ts" && s.dir === "asc" ? "desc" : "asc" }))}>
                    Time{logSort.key === "ts" ? (logSort.dir === "asc" ? " ^" : " v") : ""}
                  </button>
                  <button className="log-sort" onClick={() => setLogSort((s) => ({ key: "message", dir: s.key === "message" && s.dir === "asc" ? "desc" : "asc" }))}>
                    Log{logSort.key === "message" ? (logSort.dir === "asc" ? " ^" : " v") : ""}
                  </button>
                </div>
                {log
                  .map((item, index) => ({ item, index }))
                  .sort((a, b) => {
                    const key = logSort.key;
                    let cmp = 0;
                    if (key === "ts") cmp = a.item.ts - b.item.ts;
                    if (key === "ok") {
                      const av = a.item.ok === true ? 1 : a.item.ok === false ? 0 : -1;
                      const bv = b.item.ok === true ? 1 : b.item.ok === false ? 0 : -1;
                      cmp = av - bv;
                    }
                    if (key === "category") cmp = (a.item.category || "").toLowerCase().localeCompare((b.item.category || "").toLowerCase());
                    if (key === "agent") cmp = (a.item.agent || "").toLowerCase().localeCompare((b.item.agent || "").toLowerCase());
                    if (key === "message") cmp = (a.item.message || "").toLowerCase().localeCompare((b.item.message || "").toLowerCase());
                    if (cmp === 0) cmp = a.index - b.index;
                    return logSort.dir === "asc" ? cmp : -cmp;
                  })
                  .map(({ item }) => {
                    const okLabel = item.ok === true ? "OK" : item.ok === false ? "FAIL" : "-";
                    const tsLabel = new Date(item.ts).toLocaleString();
                    const detailsText = item.details ? `${item.message}\n\n${item.details}` : item.message;
                    return (
                      <details key={item.id} className="log-row log-entry">
                        <summary className="log-summary">
                          <div className="log-cell log-category">{item.category}</div>
                          <div className="log-cell log-agent">{item.agent ?? "-"}</div>
                          <div className={`log-cell log-ok ${item.ok === true ? "ok" : item.ok === false ? "fail" : ""}`}>{okLabel}</div>
                          <div className="log-cell log-time">{tsLabel}</div>
                          <div className="log-cell log-message">{item.message}</div>
                        </summary>
                        <div className="log-details">
                          <div className="log-details-label">Log</div>
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
