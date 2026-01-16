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
import McpPanel from "../ui/McpPanel";

function pickAdapter(a: AgentConfig) {
  if (a.type === "chrome_prompt") return ChromePromptAdapter;
  if (a.type === "custom") return CustomAdapter;
  return OpenAICompatAdapter;
}

function msg(role: ChatMessage["role"], content: string, name?: string): ChatMessage {
  return { id: crypto.randomUUID(), role, content, name, ts: Date.now() };
}

type McpAction = { type: "mcp_call"; tool: string; input?: any; serverId?: string };

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

function stringifyAny(v: any): string {
  if (v === null || v === undefined) return String(v);
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

type ActiveTab = "chat" | "resources" | "agents";
type LogSortKey = "category" | "agent" | "ok" | "ts" | "message";

export default function App() {
  const initialUi = loadUiState();
  const [agents, setAgents] = useState<AgentConfig[]>(() => {
    const existing = loadAgents();
    if (existing.length) return existing;

    const seed: AgentConfig[] = [
      {
        id: crypto.randomUUID(),
        name: "Local Chrome LLM",
        type: "chrome_prompt",
        capabilities: { streaming: true }
      },
      {
        id: crypto.randomUUID(),
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

  const [activeTab, setActiveTab] = useState<ActiveTab>(() => initialUi.activeTab ?? "chat");
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
      id: crypto.randomUUID(),
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
      retryMax
    });
  }, [activeTab, mode, activeAgentId, memberAgentIds, reactMax, retryDelaySec, retryMax]);

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

  const activeMcpServer = useMemo(() => {
    if (!activeAgent) return null;
    if (!activeAgent.allowedMcpServerIds) return mcpServers[0] ?? null;
    const allowed = new Set(activeAgent.allowedMcpServerIds);
    return mcpServers.find((s) => allowed.has(s.id)) ?? null;
  }, [activeAgent, mcpServers]);

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
    const userMsg = msg("user", input, "user");
    append(userMsg);
    const baseHistory = [...history, userMsg];

    try {
      if (mode === "one_to_one") {
        logNow({ category: "chat", agent: activeAgent.name, message: "normal talking started" });
        // streaming into a reserved assistant message
        const assistantId = crypto.randomUUID();
        setHistory((h) => [...h, { id: assistantId, role: "assistant", content: "", ts: Date.now(), name: activeAgent.name }]);

        let sawDelta = false;
        const onDelta = (t: string) => {
          setHistory((h) => h.map((m) => (m.id === assistantId ? { ...m, content: m.content + t } : m)));
          if (!sawDelta && t) {
            sawDelta = true;
            logNow({ category: "chat", agent: activeAgent.name, message: "normal talking streaming started" });
          }
        };

        const adapter = pickAdapter(activeAgent);
        const full = await runOneToOne({
          adapter,
          agent: activeAgent,
          input,
          history: baseHistory,
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
        const action = normalizeMcpAction(extractJsonObject(full));
        if (!action) {
          logNow({ category: "mcp", agent: activeAgent.name, message: "No MCP action detected" });
          return;
        }
        logNow({ category: "mcp", agent: activeAgent.name, message: `MCP action detected: ${action.tool}` });

        const targetServer =
          (action.serverId && activeMcpServer && activeMcpServer.id === action.serverId ? activeMcpServer : activeMcpServer) ?? null;

        if (!targetServer) {
          append(msg("tool", "MCP call skipped: no active MCP server selected.", "mcp"));
          logNow({ category: "mcp", agent: activeAgent.name, ok: false, message: "MCP call skipped: no active server" });
          return;
        }

        setHistory((h) => h.map((m) => (m.id === assistantId ? { ...m, content: `Calling MCP tool: ${action.tool}` } : m)));

        let toolOutput: any;
        try {
          const client = new McpSseClient(targetServer);
          client.connect((t) => pushLog({ category: "mcp", agent: targetServer.name, message: t }));
          toolOutput = await callTool(client, action.tool, action.input ?? {});
          logNow({
            category: "mcp",
            agent: targetServer.name,
            ok: true,
            message: `MCP tool call OK: ${action.tool}`,
            details: stringifyAny(toolOutput)
          });
        } catch (e: any) {
          append(msg("tool", `MCP error for ${action.tool}: ${e?.message ?? String(e)}`, "mcp"));
          pushLog({ category: "mcp", agent: targetServer.name, ok: false, message: `Tool call failed: ${action.tool}`, details: String(e?.message ?? e) });
          return;
        }

        const toolMsg = msg(
          "tool",
          `MCP ${targetServer.name} -> ${action.tool}\ninput:\n${stringifyAny(action.input ?? {})}\noutput:\n${stringifyAny(toolOutput)}`,
          "mcp"
        );
        append(toolMsg);

        const followupId = crypto.randomUUID();
        setHistory((h) => [...h, { id: followupId, role: "assistant", content: "", ts: Date.now(), name: activeAgent.name }]);
        const onDeltaFollowup = (t: string) => {
          setHistory((h) => h.map((m) => (m.id === followupId ? { ...m, content: m.content + t } : m)));
        };

        await runOneToOne({
          adapter,
          agent: activeAgent,
          input: "Tool result received. Provide the final answer to the user.",
          history: [...baseHistory, msg("assistant", full, activeAgent.name), toolMsg],
          system: userSystem,
          onDelta: onDeltaFollowup,
          retry: { delaySec: retryDelaySec, max: retryMax },
          onLog: (t) => pushLog({ category: "retry", agent: activeAgent.name, message: t })
        });
        logNow({
          category: "chat",
          agent: activeAgent.name,
          ok: true,
          message: "normal talking followup completed",
          details: `elapsed_ms=${Date.now() - startedAt}`
        });
        return;
      }

      // goal-driven talking: user input is a GOAL
      const leaderAgent = activeAgent;
      const memberAgents = agents.filter((a) => memberAgentIds.includes(a.id) && a.id !== leaderAgent.id);

      if (memberAgents.length === 0) {
        append(msg("assistant", "No member agents selected. Please select at least one member.", "system"));
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
      append(msg("assistant", `Goal received. I'll coordinate the team to achieve it.`, leaderAgent.name));

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
              leaderAgent.name
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
              leaderAgent.name
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
          append(msg("assistant", `@${ev.memberName} — ${ev.message}`, leaderAgent.name));
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
          append(msg("assistant", ev.reply, ev.memberName));
          logNow({ category: "leader_team", agent: ev.memberName, message: "Member replied", details: ev.reply });
          return;
        }
        if (ev.type === "leader_verify") {
          emitLeaderPhase("verification");
          append(
            msg(
              "assistant",
              `Verification ${ev.ok ? "OK" : "FAIL"}${ev.notes ? `:\n${ev.notes}` : ""}`,
              leaderAgent.name
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
          append(msg("assistant", `REACT -> @${ev.memberName}\n${ev.message}`, leaderAgent.name));
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
          append(msg("assistant", `Leader produced an invalid action. Raw output:\n\n${ev.text}`, leaderAgent.name));
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
          append(msg("assistant", ev.answer, leaderAgent.name));
          logNow({ category: "leader_team", agent: leaderAgent.name, ok: true, message: "Leader finished", details: ev.answer });
          return;
        }
        // leader_decision_raw is mostly internal; keep it in log only to avoid clutter
      };

      await runLeaderTeam({
        leader: { agent: leaderAgent, adapter: pickAdapter(leaderAgent) },
        members: memberAgents.map((m) => ({ agent: m, adapter: pickAdapter(m) })),
        goal: input,
        userHistory: baseHistory,
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
      append(msg("assistant", `[ERROR]\n${e?.message ?? String(e)}`, "system"));
      logNow({ category: "chat", agent: activeAgent?.name, ok: false, message: "Send failed", details: String(e?.message ?? e) });
    }
  }

  async function onCreateDoc() {
    const d: DocItem = { id: crypto.randomUUID(), title: "New Doc", content: "", updatedAt: Date.now() };
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
            { id: "resources", label: "Resources" },
            { id: "agents", label: "Agents" }
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
          <div className="content-grid chat-grid">
            <div className="card panel chat-panel">
              <ChatPanel
                history={history}
                onSend={onSend}
                onClear={() => {
                  setHistory([]);
                  logNow({ category: "chat", message: "Chat cleared" });
                }}
                leaderName={mode === "leader_team" ? activeAgent?.name : null}
              />
            </div>

            <div className="card panel side-panel">
              <div style={{ fontWeight: 800, marginBottom: 8 }}>Chat Settings</div>

              <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 4 }}>Active Agent</div>
              <select
                value={activeAgentId}
                onChange={(e) => setActiveAgentId(e.target.value)}
                style={{ width: "100%", marginBottom: 12, ...selectStyle }}
              >
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({a.type}{a.model ? ` · ${a.model}` : ""})
                  </option>
                ))}
              </select>

              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <label style={{ opacity: 0.8 }}>Mode</label>
                <select value={mode} onChange={(e) => setMode(e.target.value as any)} style={{ width: "100%", ...selectStyle }}>
                  <option value="one_to_one">normal talking</option>
                  <option value="leader_team">goal-driven talking</option>
                </select>
              </div>

              <div style={{ marginTop: 10 }}>
                <div style={{ fontWeight: 800, marginBottom: 6 }}>Retry</div>
                <div style={{ display: "grid", gap: 8 }}>
                  <label style={label}>Delay (sec)</label>
                  <input
                    type="number"
                    min={0}
                    max={10}
                    value={retryDelaySec}
                    onChange={(e) => {
                      const next = Number(e.target.value);
                      setRetryDelaySec(Number.isFinite(next) ? Math.max(0, Math.min(10, next)) : 0);
                    }}
                    style={{ width: "100%", ...selectStyle }}
                  />
                  <label style={label}>Max retries</label>
                  <input
                    type="number"
                    min={0}
                    max={10}
                    value={retryMax}
                    onChange={(e) => {
                      const next = Number(e.target.value);
                      setRetryMax(Number.isFinite(next) ? Math.max(0, Math.min(10, next)) : 0);
                    }}
                    style={{ width: "100%", ...selectStyle }}
                  />
                  {mode === "leader_team" && (
                    <>
                      <label style={label}>REACT max</label>
                      <input
                        type="number"
                        min={0}
                        max={5}
                        value={reactMax}
                        onChange={(e) => {
                          const next = Number(e.target.value);
                          setReactMax(Number.isFinite(next) ? Math.max(0, Math.min(5, next)) : 0);
                        }}
                        style={{ width: "100%", ...selectStyle }}
                      />
                      <div style={{ fontSize: 12, opacity: 0.7 }}>Limits REACT loops to avoid endless retries.</div>
                    </>
                  )}
                </div>
              </div>

              {mode === "leader_team" && (
                <div style={{ marginTop: 10 }}>
                  <div style={{ fontWeight: 800, marginBottom: 6 }}>goal-driven talking setup</div>
                  <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 8 }}>Leader is the active agent.</div>

                  <div style={{ marginTop: 10 }}>
                    <div style={{ ...label, marginBottom: 6 }}>Member agents</div>
                    <div style={{ display: "grid", gap: 6 }}>
                      {agents.filter((a) => a.id !== activeAgentId).map((a) => {
                        const checked = memberAgentIds.includes(a.id);
                        return (
                          <label key={a.id} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
                            <input type="checkbox" checked={checked} onChange={() => toggleMember(a.id)} />
                            <span>
                              {a.name} <span style={{ opacity: 0.7 }}>({a.type}{a.model ? ` · ${a.model}` : ""})</span>
                            </span>
                          </label>
                        );
                      })}
                    </div>

                    <div style={{ marginTop: 8, fontSize: 12, opacity: 0.75, lineHeight: 1.5 }}>
                      In chat, send a <b>goal</b>. The leader will ask members one-by-one and you will see the conversation here.
                    </div>
                  </div>
                </div>
              )}

              <div style={{ marginTop: 12, fontSize: 12, opacity: 0.75, lineHeight: 1.5 }}>
                Security note: This MVP stores API keys in the browser. For production, use a small server-side proxy to protect keys.
              </div>
            </div>
          </div>
        )}

        {activeTab === "resources" && (
          <div className="content-grid resources-grid">
            <div className="card panel">
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
            </div>

            <div className="card panel">
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
            </div>
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
                  const r = adapter.detect ? await adapter.detect(a) : { ok: false, detectedType: "unknown", notes: "No detect()" };
                  pushLog({
                    category: "detect",
                    agent: a.name,
                    ok: r.ok,
                    message: `${r.detectedType ?? ""} ${r.notes ?? ""}`.trim() || "detect()",
                    details: r.notes ?? undefined
                  });
                }}
                docs={docs}
                mcpServers={mcpServers}
              />
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
  borderRadius: 10,
  border: "1px solid #222636",
  background: "#0f1118",
  color: "white"
};
