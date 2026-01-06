import React, { useMemo, useState } from "react";
import { AgentConfig, ChatMessage, OrchestratorMode, DocItem, McpServerConfig } from "../types";
import { loadAgents, upsertAgent, deleteAgent, saveAgents } from "../storage/agentStore";
import { listDocs, upsertDoc, deleteDoc } from "../storage/docStore";

import { OpenAICompatAdapter } from "../adapters/openaiCompat";
import { ChromePromptAdapter } from "../adapters/chromePrompt";
import { CustomAdapter } from "../adapters/custom";

import { runOneToOne } from "../orchestrators/oneToOne";
import { runLeaderTeam, LeaderTeamEvent } from "../orchestrators/leaderTeam";

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

export default function App() {
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

  const [activeAgentId, setActiveAgentId] = useState<string>(agents[0]?.id ?? "");
  const activeAgent = useMemo(() => agents.find((a) => a.id === activeAgentId) ?? null, [agents, activeAgentId]);

  const [mode, setMode] = useState<OrchestratorMode>("one_to_one");
  const [history, setHistory] = useState<ChatMessage[]>([]);

  // Leader+Team config
  const [leaderAgentId, setLeaderAgentId] = useState<string>(() => agents[0]?.id ?? "");
  const [memberAgentIds, setMemberAgentIds] = useState<string[]>(() => agents.slice(1).map((a) => a.id));

  const [docs, setDocs] = useState<DocItem[]>([]);
  const [docSelection, setDocSelection] = useState<string | null>(null);

  const [mcpServers, setMcpServers] = useState<McpServerConfig[]>([]);
  const [log, setLog] = useState<string[]>([]);
  const pushLog = (s: string) => setLog((x) => [s, ...x].slice(0, 200));

  React.useEffect(() => {
    (async () => setDocs(await listDocs()))();
  }, []);

  React.useEffect(() => {
    saveAgents(agents);

    if (!agents.some((a) => a.id === leaderAgentId)) {
      setLeaderAgentId(agents[0]?.id ?? "");
    }

    setMemberAgentIds((prev) => prev.filter((id) => agents.some((a) => a.id === id) && id !== leaderAgentId));
  }, [agents, leaderAgentId]);

  async function onSaveAgent(a: AgentConfig) {
    upsertAgent(a);
    const next = loadAgents();
    setAgents(next);
    setActiveAgentId(a.id);
    if (!leaderAgentId) setLeaderAgentId(a.id);
  }

  async function onDeleteAgent(id: string) {
    deleteAgent(id);
    const next = loadAgents();
    setAgents(next);
    setActiveAgentId(next[0]?.id ?? "");
  }

  function toggleMember(id: string) {
    if (id === leaderAgentId) return;
    setMemberAgentIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function append(m: ChatMessage) {
    setHistory((h) => [...h, m]);
  }

  async function onSend(input: string) {
    if (!activeAgent) return;

    const selectedDoc = docs.find((d) => d.id === docSelection) ?? null;
    const userSystem = selectedDoc
      ? `You may use this document as context:\n\n[DOC:${selectedDoc.title}]\n${selectedDoc.content}`
      : undefined;

    // User message
    append(msg("user", input, "user"));

    try {
      if (mode === "one_to_one") {
        // streaming into a reserved assistant message
        const assistantId = crypto.randomUUID();
        setHistory((h) => [...h, { id: assistantId, role: "assistant", content: "", ts: Date.now(), name: activeAgent.name }]);

        const onDelta = (t: string) => {
          setHistory((h) => h.map((m) => (m.id === assistantId ? { ...m, content: m.content + t } : m)));
        };

        const adapter = pickAdapter(activeAgent);
        await runOneToOne({
          adapter,
          agent: activeAgent,
          input,
          history,
          system: userSystem,
          onDelta
        });
        return;
      }

      // Leader + Team: user input is a GOAL
      const leaderAgent = agents.find((a) => a.id === leaderAgentId) ?? activeAgent;
      const memberAgents = agents.filter((a) => memberAgentIds.includes(a.id) && a.id !== leaderAgent.id);

      if (!leaderAgent) {
        append(msg("assistant", "No leader agent selected.", "system"));
        return;
      }
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
        userHistory: history,
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
    setDocSelection(d.id);
  }

  async function onSaveDoc(d: DocItem) {
    await upsertDoc({ ...d, updatedAt: Date.now() });
    setDocs(await listDocs());
  }

  async function onDeleteDoc(id: string) {
    await deleteDoc(id);
    setDocs(await listDocs());
    if (docSelection === id) setDocSelection(null);
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "320px 1fr 360px", height: "100vh", gap: 12, padding: 12 }}>
      <div className="card" style={{ padding: 12, overflow: "auto" }}>
        <div style={{ fontWeight: 900, fontSize: 18 }}>AgentGoRound</div>
        <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 10 }}>Browser-first agent playground</div>

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
        />

        <hr />
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <label style={{ opacity: 0.8 }}>Mode</label>
          <select value={mode} onChange={(e) => setMode(e.target.value as any)} style={{ width: "100%", ...selectStyle }}>
            <option value="one_to_one">1-to-1</option>
            <option value="leader_team">Leader + Team</option>
          </select>
        </div>

        {mode === "leader_team" && (
          <div style={{ marginTop: 10 }}>
            <div style={{ fontWeight: 800, marginBottom: 6 }}>Leader + Team Setup</div>

            <label style={label}>Leader agent</label>
            <select value={leaderAgentId} onChange={(e) => setLeaderAgentId(e.target.value)} style={{ width: "100%", ...selectStyle }}>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.type})
                </option>
              ))}
            </select>

            <div style={{ marginTop: 10 }}>
              <div style={{ ...label, marginBottom: 6 }}>Member agents</div>
              <div style={{ display: "grid", gap: 6 }}>
                {agents.filter((a) => a.id !== leaderAgentId).map((a) => {
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

        <div style={{ marginTop: 10, fontSize: 12, opacity: 0.75, lineHeight: 1.5 }}>
          Security note: This MVP stores API keys in the browser. For production, use a small server-side proxy to protect keys.
        </div>
      </div>

      <div className="card" style={{ padding: 12, display: "grid", gridTemplateRows: "1fr auto", gap: 10 }}>
        <ChatPanel history={history} onSend={onSend} />
      </div>

      <div style={{ display: "grid", gridTemplateRows: "1fr 1fr", gap: 12 }}>
        <div className="card" style={{ padding: 12, overflow: "auto" }}>
          <DocsPanel
            docs={docs}
            selectedId={docSelection}
            onSelect={setDocSelection}
            onCreate={onCreateDoc}
            onSave={onSaveDoc}
            onDelete={onDeleteDoc}
          />
        </div>

        <div className="card" style={{ padding: 12, overflow: "auto" }}>
          <McpPanel servers={mcpServers} onChangeServers={setMcpServers} log={log} pushLog={pushLog} />
        </div>
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
