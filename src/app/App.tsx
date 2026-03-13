import React, { useMemo, useState } from "react";
import { AgentConfig, ChatMessage, OrchestratorMode, DocItem, McpServerConfig, McpTool, LogEntry } from "../types";
import { loadAgents, upsertAgent, deleteAgent, saveAgents } from "../storage/agentStore";
import { listDocs, upsertDoc, deleteDoc } from "../storage/docStore";
import { loadMcpServers, loadUiState, saveMcpServers, saveUiState } from "../storage/settingsStore";

import { OpenAICompatAdapter } from "../adapters/openaiCompat";
import { ChromePromptAdapter } from "../adapters/chromePrompt";
import { CustomAdapter } from "../adapters/custom";

import { runOneToOne } from "../orchestrators/oneToOne";
import { runLeaderTeam, LeaderTeamEvent } from "../orchestrators/leaderTeam";
import { McpSseClient } from "../mcp/sseClient";
import { callTool } from "../mcp/toolRegistry";

import AgentsPanel from "../ui/AgentsPanel";
import ChatPanel from "../ui/ChatPanel";
import DocsPanel from "../ui/DocsPanel";
import HelpModal from "../ui/HelpModal";
import McpPanel from "../ui/McpPanel";
import { generateId } from "../utils/id";

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
type UserProfileAction = { type: "user_profile_call"; tool: "get_user_profile" };
type ToolDecision = { type: "no_tool" } | McpAction | UserProfileAction;
type ToolEntry =
  | {
      kind: "mcp";
      server: McpServerConfig;
      tool: McpTool;
    }
  | {
      kind: "builtin";
      tool: {
        name: "get_user_profile";
        description: string;
      };
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
    return { type: "user_profile_call", tool: "get_user_profile" };
  }
  const action = normalizeMcpAction(obj);
  if (!action?.serverId) return null;
  return action;
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

type ActiveTab = "chat" | "chat_config" | "agents" | "profile";
type LogSortKey = "category" | "agent" | "ok" | "ts" | "message";
type UserProfile = { name: string; avatarUrl?: string; description?: string };

function formatUserProfileToolOutput(profile: UserProfile) {
  return stringifyAny({
    name: profile.name,
    description: profile.description?.trim() || "",
    hasAvatar: !!profile.avatarUrl
  });
}

function clampHistoryLimit(value: number) {
  if (!Number.isFinite(value)) return 10;
  return Math.max(1, Math.min(200, Math.round(value)));
}

function normalizeImportedMessage(input: any): ChatMessage | null {
  if (!input || typeof input !== "object") return null;
  if (typeof input.role !== "string" || typeof input.content !== "string") return null;
  if (!["system", "user", "assistant", "tool"].includes(input.role)) return null;
  return {
    id: typeof input.id === "string" ? input.id : generateId(),
    role: input.role,
    content: input.content,
    name: typeof input.name === "string" ? input.name : undefined,
    displayName: typeof input.displayName === "string" ? input.displayName : undefined,
    avatarUrl: typeof input.avatarUrl === "string" ? input.avatarUrl : undefined,
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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  const [history, setHistory] = useState<ChatMessage[]>([]);

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

  type ConfigModalKey = "agent" | "mode" | "history" | "docs" | "mcp" | "skills" | "tools" | "team" | null;
  const [configModal, setConfigModal] = useState<ConfigModalKey>(null);

  const [docs, setDocs] = useState<DocItem[]>([]);
  const [docsLoaded, setDocsLoaded] = useState(false);
  const [docEditorId, setDocEditorId] = useState<string | null>(null);

  const [mcpServers, setMcpServers] = useState<McpServerConfig[]>(() => loadMcpServers());
  const [mcpPanelActiveId, setMcpPanelActiveId] = useState<string | null>(null);
  const [mcpToolsByServer, setMcpToolsByServer] = useState<Record<string, McpTool[]>>({});
  const [log, setLog] = useState<LogEntry[]>([]);
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
  }, [activeTab, mode, activeAgentId, memberAgentIds, reactMax, retryDelaySec, retryMax, historyMessageLimit, userName, userAvatarUrl, userDescription]);

  React.useEffect(() => {
    saveMcpServers(mcpServers);
  }, [mcpServers]);

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
    if (mcpPanelActiveId && !mcpServers.some((s) => s.id === mcpPanelActiveId)) {
      setMcpPanelActiveId(null);
    }
  }, [mcpPanelActiveId, mcpServers]);

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

  const docsForAgent = useMemo(() => {
    if (!activeAgent) return [];
    if (!activeAgent.allowedDocIds) return docs;
    const allowed = new Set(activeAgent.allowedDocIds);
    return docs.filter((d) => allowed.has(d.id));
  }, [activeAgent, docs]);

  const availableMcpServersForAgent = useMemo(() => {
    if (!activeAgent) return [];
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

  const availableBuiltinToolsForAgent = useMemo(
    () =>
      activeAgent?.allowUserProfileTool
        ? [
            {
              name: "get_user_profile" as const,
              description: "Get the current user's name, self-description, and whether an avatar is configured."
            }
          ]
        : [],
    [activeAgent]
  );

  const availableToolsForAgent = useMemo<ToolEntry[]>(
    () => [
      ...availableMcpToolsForAgent.flatMap(({ server, tools }) => tools.map((tool) => ({ kind: "mcp" as const, server, tool }))),
      ...availableBuiltinToolsForAgent.map((tool) => ({ kind: "builtin" as const, tool }))
    ],
    [availableMcpToolsForAgent, availableBuiltinToolsForAgent]
  );

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

  async function runToolDecision(args: {
    agent: AgentConfig;
    adapter: ReturnType<typeof pickAdapter>;
    userInput: string;
    retry: { delaySec: number; max: number };
    toolEntries: ToolEntry[];
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
            description: entry.tool.description
          }
    );

    const decisionPrompt = [
      "請只回傳 JSON，不要加任何其他文字。",
      "",
      "請判斷這次是否需要使用工具。",
      "",
      `使用者提問如下:\n${args.userInput}`,
      "",
      `工具清單如下:\n${JSON.stringify(toolList, null, 2)}`,
      "",
      '如果不需要工具，回傳：{"type":"no_tool"}',
      '如果需要使用使用者資訊工具，回傳：{"type":"user_profile_call","tool":"get_user_profile"}',
      '如果需要工具，回傳：{"type":"mcp_call","serverId":"...","tool":"...","input":{}}'
    ].join("\n");

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
        const adapter = pickAdapter(activeAgent);
        let finalInput = input;

        if (availableToolsForAgent.length === 0) {
          if (activeAgent.allowUserProfileTool) {
            logNow({ category: "tool", agent: activeAgent.name, message: "Tool decision skipped: no available tool entries" });
          } else if (availableMcpServersForAgent.length === 0) {
            logNow({ category: "mcp", agent: activeAgent.name, message: "Tool decision skipped: no MCP server available" });
          } else if (availableMcpToolsForAgent.length === 0) {
            logNow({ category: "mcp", agent: activeAgent.name, message: "Tool decision skipped: no MCP tools loaded yet" });
          }
        } else {
          const decision = await runToolDecision({
            agent: activeAgent,
            adapter,
            userInput: input,
            retry: { delaySec: retryDelaySec, max: retryMax },
            toolEntries: availableToolsForAgent
          });

          if (!decision) {
            logNow({ category: "tool", agent: activeAgent.name, ok: false, message: "Tool decision failed after retries; continue without tools" });
          } else if (decision.type === "no_tool") {
            logNow({ category: "tool", agent: activeAgent.name, message: "Tool decision resolved: no_tool" });
          } else if (decision.type === "user_profile_call") {
            const toolOutputText = formatUserProfileToolOutput(userProfile);
            const toolSummaryForQuestion = `工具執行結果：tool=${decision.tool}, result=${toolOutputText}`;
            append(
              msg("tool", `Built-in tool -> ${decision.tool}\noutput:\n${toolOutputText}`, "user_profile_tool", {
                displayName: "User Info Tool"
              })
            );
            logNow({
              category: "tool",
              agent: activeAgent.name,
              ok: true,
              message: `Built-in tool call OK: ${decision.tool}`,
              details: toolOutputText
            });
            finalInput = `${input}\n\n請將以下工具資訊一起納入回答：\n${toolSummaryForQuestion}`;
          } else {
            const targetServer = availableMcpServersForAgent.find((server) => server.id === decision.serverId) ?? null;
            const targetTool = availableMcpToolsForAgent.find((entry) => entry.server.id === decision.serverId)?.tools.find((tool) => tool.name === decision.tool) ?? null;
            let toolSummaryForQuestion = "";

            if (!targetServer) {
              toolSummaryForQuestion = `工具執行失敗：找不到 serverId=${decision.serverId} 的可用 MCP server。`;
              logNow({
                category: "mcp",
                agent: activeAgent.name,
                ok: false,
                message: `Tool decision selected unavailable server: ${decision.serverId}`,
                details: JSON.stringify(decision)
              });
              append(msg("tool", toolSummaryForQuestion, "mcp", { displayName: "MCP Tool" }));
            } else if (!targetTool) {
              toolSummaryForQuestion = `工具執行失敗：${targetServer.name} 沒有 ${decision.tool} 這個工具。`;
              logNow({
                category: "mcp",
                agent: activeAgent.name,
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

            if (toolSummaryForQuestion) {
              finalInput = `${input}\n\n請將以下工具資訊一起納入回答：\n${toolSummaryForQuestion}`;
            }
          }
        }

        const assistantId = generateId();
        setHistory((h) => [
          ...h,
          { id: assistantId, role: "assistant", content: "", ts: Date.now(), name: activeAgent.name, displayName: activeAgent.name, avatarUrl: activeAgent.avatarUrl }
        ]);

        let sawDelta = false;
        const onDelta = (t: string) => {
          setHistory((h) => h.map((m) => (m.id === assistantId ? { ...m, content: m.content + t } : m)));
          if (!sawDelta && t) {
            sawDelta = true;
            logNow({ category: "chat", agent: activeAgent.name, message: "normal talking streaming started" });
          }
        };

        const full = await runOneToOne({
          adapter,
          agent: activeAgent,
          input: finalInput,
          history: limitHistory(history),
          system: userSystem,
          onDelta,
          retry: { delaySec: retryDelaySec, max: retryMax },
          onLog: (t) => pushLog({ category: "retry", agent: activeAgent.name, message: t })
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

      // goal-driven talking: user input is a GOAL
      const leaderAgent = activeAgent;
      const memberAgents = agents.filter((a) => memberAgentIds.includes(a.id) && a.id !== leaderAgent.id);

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
      const adapter = pickAdapter(activeAgent);
      const summary = await runOneToOne({
        adapter,
        agent: activeAgent,
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
                modeLabel={mode === "leader_team" ? "goal-driven talking" : "normal talking"}
                onExportRaw={exportRawHistory}
                onExportSummary={exportSummaryHistory}
                onImportHistory={importHistoryFile}
                isSummaryExporting={isSummaryExporting}
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
              <button className="cc-card" onClick={() => setConfigModal("mode")}>
                <span className="cc-card-label">Mode</span>
                <strong className="cc-card-value">{mode === "leader_team" ? "goal-driven" : "normal"}</strong>
                <span className="cc-card-hint">{mode === "leader_team" ? "Leader → Members" : "1:1 對話"}</span>
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
              <button className="cc-card cc-card-disabled" onClick={() => setConfigModal("skills")}>
                <span className="cc-card-label">Skills</span>
                <strong className="cc-card-value">Reserved</strong>
                <span className="cc-card-hint">Coming Soon</span>
              </button>
              <button className="cc-card cc-card-disabled" onClick={() => setConfigModal("tools")}>
                <span className="cc-card-label">Built-in Tools</span>
                <strong className="cc-card-value">Reserved</strong>
                <span className="cc-card-hint">Coming Soon</span>
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
                  {([["one_to_one", "Normal Talking", "一般一對一對話模式"], ["leader_team", "Goal-driven Talking", "Leader 規劃任務，派給 member 協作"]] as const).map(([value, title, desc]) => (
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
              <HelpModal title="Skills" onClose={() => setConfigModal(null)}>
                <div className="chat-config-skill-placeholder">
                  <div className="chat-config-skill-badge">Coming Soon</div>
                  <div>未來這裡會放 skill 啟用、權限、來源與載入策略設定。</div>
                </div>
              </HelpModal>
            )}

            {configModal === "tools" && (
              <HelpModal title="Built-in Tools" onClose={() => setConfigModal(null)}>
                <div className="chat-config-skill-placeholder">
                  <div className="chat-config-skill-badge">Coming Soon</div>
                  <div>之後這裡會統一管理 built-in tool 的啟用、權限與使用說明。</div>
                </div>
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
                  const adapter = pickAdapter(a);
                  const r = adapter.detect ? await adapter.detect(a) : { ok: false, detectedType: "unknown" as const, notes: "No detect()" };
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
