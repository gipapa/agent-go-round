import React, { useMemo, useState } from "react";
import { AgentConfig, ChatMessage, OrchestratorMode, DocItem, McpServerConfig, McpTool } from "../types";
import { loadAgents, upsertAgent, deleteAgent, saveAgents } from "../storage/agentStore";
import { listDocs, upsertDoc, deleteDoc } from "../storage/docStore";
import { loadMcpServers, loadUiState, saveMcpServers, saveUiState } from "../storage/settingsStore";

import { OpenAICompatAdapter } from "../adapters/openaiCompat";
import { ChromePromptAdapter } from "../adapters/chromePrompt";
import { CustomAdapter } from "../adapters/custom";

import { runOneToOne } from "../orchestrators/oneToOne";
import { runLeaderTeam, LeaderTeamEvent } from "../orchestrators/leaderTeam";
import { runGoalDrivenTalk } from "../orchestrators/goalDrivenTalk";
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

  const [mode, setMode] = useState<OrchestratorMode>(() => initialUi.mode ?? "one_to_one");
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [goalPlan, setGoalPlan] = useState<Array<{ id: string; task: string; done: boolean }>>([]);

  // Leader+Team config (leader = active agent)
  const [memberAgentIds, setMemberAgentIds] = useState<string[]>(() => initialUi.memberAgentIds ?? agents.slice(1).map((a) => a.id));

  const [docs, setDocs] = useState<DocItem[]>([]);
  const [docsLoaded, setDocsLoaded] = useState(false);
  const [docEditorId, setDocEditorId] = useState<string | null>(null);

  const [mcpServers, setMcpServers] = useState<McpServerConfig[]>(() => loadMcpServers());
  const [mcpPanelActiveId, setMcpPanelActiveId] = useState<string | null>(null);
  const [mcpToolsByServer, setMcpToolsByServer] = useState<Record<string, McpTool[]>>({});
  const [log, setLog] = useState<string[]>([]);
  const [logCollapsed, setLogCollapsed] = useState(true);
  const [logHeight, setLogHeight] = useState(160);
  const pushLog = (s: string) => setLog((x) => [s, ...x].slice(0, 200));
  const logResizeRef = React.useRef<{ startY: number; startHeight: number } | null>(null);

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
      setDocs(await listDocs());
      setDocsLoaded(true);
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
      memberAgentIds
    });
  }, [activeTab, mode, activeAgentId, memberAgentIds]);

  React.useEffect(() => {
    saveMcpServers(mcpServers);
  }, [mcpServers]);

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
    upsertAgent(a);
    const next = loadAgents();
    setAgents(next);
    setActiveAgentId(a.id);
  }

  async function onDeleteAgent(id: string) {
    deleteAgent(id);
    const next = loadAgents();
    setAgents(next);
    setActiveAgentId(next[0]?.id ?? "");
  }

  function toggleMember(id: string) {
    if (id === activeAgentId) return;
    setMemberAgentIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function append(m: ChatMessage) {
    setHistory((h) => [...h, m]);
  }

  async function onSend(input: string) {
    if (!activeAgent) return;

    const docBlocks = docsForAgent.map((d) => `[DOC:${d.title}]\n${d.content}`).join("\n\n");
    const userSystem = docBlocks ? `You may use these documents as context:\n\n${docBlocks}` : undefined;
    const selectedDocForLookup: DocItem | null = docBlocks
      ? { id: "allowed_docs", title: "Allowed Docs", content: docBlocks, updatedAt: Date.now() }
      : null;

    // User message
    const userMsg = msg("user", input, "user");
    append(userMsg);
    const baseHistory = [...history, userMsg];

    try {
      if (mode === "goal_driven_talk") {
        setGoalPlan([]);
        const adapter = pickAdapter(activeAgent);
        const activeMcp = activeMcpServer;
        const activeMcpTools = activeMcp?.id ? mcpToolsByServer[activeMcp.id] ?? [] : [];

        await runGoalDrivenTalk({
          adapter,
          agent: activeAgent,
          goal: input,
          history: baseHistory,
          system: userSystem,
          selectedDoc: selectedDocForLookup,
          activeMcpServer: activeMcp,
          activeMcpTools,
          onEvent: (ev) => {
            if ("message" in ev && ev.message) {
              append(ev.message);
            }
            if (ev.type === "plan") {
              setGoalPlan(ev.items.map((task) => ({ id: crypto.randomUUID(), task, done: false })));
            }
            if (ev.type === "review" && ev.ok) {
              setGoalPlan((prev) => prev.map((t) => (t.task === ev.task ? { ...t, done: true } : t)));
            }
          },
          onLog: pushLog
        });
        return;
      }

      if (mode === "one_to_one") {
        // streaming into a reserved assistant message
        const assistantId = crypto.randomUUID();
        setHistory((h) => [...h, { id: assistantId, role: "assistant", content: "", ts: Date.now(), name: activeAgent.name }]);

        const onDelta = (t: string) => {
          setHistory((h) => h.map((m) => (m.id === assistantId ? { ...m, content: m.content + t } : m)));
        };

        const adapter = pickAdapter(activeAgent);
        const full = await runOneToOne({
          adapter,
          agent: activeAgent,
          input,
          history: baseHistory,
          system: userSystem,
          onDelta
        });
        const action = normalizeMcpAction(extractJsonObject(full));
        if (!action) return;

        const targetServer =
          (action.serverId && activeMcpServer && activeMcpServer.id === action.serverId ? activeMcpServer : activeMcpServer) ?? null;

        if (!targetServer) {
          append(msg("tool", "MCP call skipped: no active MCP server selected.", "mcp"));
          return;
        }

        setHistory((h) => h.map((m) => (m.id === assistantId ? { ...m, content: `Calling MCP tool: ${action.tool}` } : m)));

        let toolOutput: any;
        try {
          const client = new McpSseClient(targetServer);
          client.connect(pushLog);
          toolOutput = await callTool(client, action.tool, action.input ?? {});
        } catch (e: any) {
          append(msg("tool", `MCP error for ${action.tool}: ${e?.message ?? String(e)}`, "mcp"));
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
          onDelta: onDeltaFollowup
        });
        return;
      }

      // Leader + Team: user input is a GOAL
      const leaderAgent = activeAgent;
      const memberAgents = agents.filter((a) => memberAgentIds.includes(a.id) && a.id !== leaderAgent.id);

      if (memberAgents.length === 0) {
        append(msg("assistant", "No member agents selected. Please select at least one member.", "system"));
        return;
      }

      pushLog(`Leader+Team started. Leader="${leaderAgent.name}", Members=${memberAgents.map((m) => m.name).join(", ")}`);

      // Show a visible kickoff message from the leader
      append(msg("assistant", `Goal received. I'll coordinate the team to achieve it.`, leaderAgent.name));

      const onEvent = (ev: LeaderTeamEvent) => {
        if (ev.type === "leader_ask_member") {
          append(msg("assistant", `@${ev.memberName} — ${ev.message}`, leaderAgent.name));
          return;
        }
        if (ev.type === "member_reply") {
          // Show the member's answer
          append(msg("assistant", ev.reply, ev.memberName));
          return;
        }
        if (ev.type === "leader_invalid_json") {
          append(msg("assistant", `Leader produced an invalid action. Raw output:\n\n${ev.text}`, leaderAgent.name));
          return;
        }
        if (ev.type === "leader_finish") {
          append(msg("assistant", ev.answer, leaderAgent.name));
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
        onLog: pushLog,
        onDelta: () => {},
        onEvent
      });
    } catch (e: any) {
      append(msg("assistant", `[ERROR]\n${e?.message ?? String(e)}`, "system"));
    }
  }

  async function onCreateDoc() {
    const d: DocItem = { id: crypto.randomUUID(), title: "New Doc", content: "", updatedAt: Date.now() };
    await upsertDoc(d);
    setDocs(await listDocs());
    setDocEditorId(d.id);
  }

  async function onSaveDoc(d: DocItem) {
    await upsertDoc({ ...d, updatedAt: Date.now() });
    setDocs(await listDocs());
  }

  async function onDeleteDoc(id: string) {
    await deleteDoc(id);
    setDocs(await listDocs());
    if (docEditorId === id) setDocEditorId(null);
  }

  function onChangeMcpServers(next: McpServerConfig[]) {
    setMcpServers(next);
    setMcpToolsByServer((prev) => {
      const nextMap: Record<string, McpTool[]> = {};
      next.forEach((s) => {
        if (prev[s.id]) nextMap[s.id] = prev[s.id];
      });
      return nextMap;
    });
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
                  setGoalPlan([]);
                }}
              />
            </div>

            <div className="card panel side-panel">
              <div style={{ fontWeight: 800, marginBottom: 8 }}>Chat Settings</div>

              <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 4 }}>Active Agent</div>
              <select value={activeAgentId} onChange={(e) => setActiveAgentId(e.target.value)} style={{ width: "100%", marginBottom: 12, ...selectStyle }}>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({a.type}{a.model ? ` · ${a.model}` : ""})
                  </option>
                ))}
              </select>

              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <label style={{ opacity: 0.8 }}>Mode</label>
                <select value={mode} onChange={(e) => setMode(e.target.value as any)} style={{ width: "100%", ...selectStyle }}>
                  <option value="one_to_one">1-to-1</option>
                  <option value="leader_team">Leader + Team</option>
                  <option value="goal_driven_talk">Goal-driven Talk</option>
                </select>
              </div>

              {mode === "leader_team" && (
                <div style={{ marginTop: 10 }}>
                  <div style={{ fontWeight: 800, marginBottom: 6 }}>Leader + Team Setup</div>
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

              {mode === "goal_driven_talk" && (
                <div style={{ marginTop: 10, fontSize: 12, opacity: 0.8, lineHeight: 1.5 }}>
                  <div style={{ fontWeight: 800, marginBottom: 6 }}>Goal-driven Talk</div>
                  <div>
                    Send a goal; the active agent will iterate think / act / review, pulling from its allowed Docs and MCP tools. All steps are
                    streamed into the chat window.
                  </div>
                  <div style={{ marginTop: 10, fontWeight: 700 }}>Subtasks</div>
                  {goalPlan.length === 0 ? (
                    <div style={{ opacity: 0.7, marginTop: 4 }}>No plan yet.</div>
                  ) : (
                    <div style={{ display: "grid", gap: 6, marginTop: 6 }}>
                      {goalPlan.map((t) => (
                        <div key={t.id} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                          <input type="checkbox" checked={t.done} readOnly />
                          <span style={{ textDecoration: t.done ? "line-through" : "none", opacity: t.done ? 0.7 : 1 }}>{t.task}</span>
                        </div>
                      ))}
                    </div>
                  )}
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
                onSelect={setDocEditorId}
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
                onSelectActive={setMcpPanelActiveId}
                onUpdateTools={(id, tools) => setMcpToolsByServer((prev) => ({ ...prev, [id]: tools }))}
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
                onSelect={setActiveAgentId}
                onSave={onSaveAgent}
                onDelete={onDeleteAgent}
                onDetect={async (a) => {
                  const adapter = pickAdapter(a);
                  const r = adapter.detect ? await adapter.detect(a) : { ok: false, detectedType: "unknown", notes: "No detect()" };
                  pushLog(`Detect[${a.name}]: ${r.ok ? "OK" : "FAIL"} ${r.detectedType ?? ""} ${r.notes ?? ""}`);
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
            {log.map((l, i) => (
              <div key={i} className="log-line">
                {l}
              </div>
            ))}
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
