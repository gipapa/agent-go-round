import React, { useMemo, useState } from "react";
import { AgentConfig, ChatMessage, OrchestratorMode, DocItem, McpServerConfig } from "../types";
import { loadAgents, upsertAgent, deleteAgent, saveAgents } from "../storage/agentStore";
import { listDocs, upsertDoc, deleteDoc } from "../storage/docStore";

import { OpenAICompatAdapter } from "../adapters/openaiCompat";
import { ChromePromptAdapter } from "../adapters/chromePrompt";
import { CustomAdapter } from "../adapters/custom";

import { runOneToOne } from "../orchestrators/oneToOne";
import { runLeaderTeam } from "../orchestrators/leaderTeam";

import AgentsPanel from "../ui/AgentsPanel";
import ChatPanel from "../ui/ChatPanel";
import DocsPanel from "../ui/DocsPanel";
import McpPanel from "../ui/McpPanel";

function pickAdapter(a: AgentConfig) {
  if (a.type === "chrome_prompt") return ChromePromptAdapter;
  if (a.type === "custom") return CustomAdapter;
  return OpenAICompatAdapter; // openai_compat default
}

function nowMsg(role: ChatMessage["role"], content: string, name?: string): ChatMessage {
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

  const [docs, setDocs] = useState<DocItem[]>([]);
  const [docSelection, setDocSelection] = useState<string | null>(null);

  const [mcpServers, setMcpServers] = useState<McpServerConfig[]>([]);
  const [log, setLog] = useState<string[]>([]);
  const pushLog = (s: string) => setLog((x) => [s, ...x].slice(0, 120));

  React.useEffect(() => {
    (async () => setDocs(await listDocs()))();
  }, []);

  React.useEffect(() => {
    saveAgents(agents);
  }, [agents]);

  async function onSaveAgent(a: AgentConfig) {
    upsertAgent(a);
    setAgents(loadAgents());
    setActiveAgentId(a.id);
  }

  async function onDeleteAgent(id: string) {
    deleteAgent(id);
    const next = loadAgents();
    setAgents(next);
    setActiveAgentId(next[0]?.id ?? "");
  }

  async function onSend(input: string) {
    if (!activeAgent) return;

    // Inject selected doc into system context (MVP).
    const selectedDoc = docs.find((d) => d.id === docSelection) ?? null;
    const system = selectedDoc
      ? `You may use this document as context:\n\n[DOC:${selectedDoc.title}]\n${selectedDoc.content}`
      : undefined;

    const userMsg = nowMsg("user", input, "user");
    setHistory((h) => [...h, userMsg]);

    const assistantMsgId = crypto.randomUUID();
    setHistory((h) => [...h, { id: assistantMsgId, role: "assistant", content: "", ts: Date.now() }]);

    const onDelta = (t: string) => {
      setHistory((h) => h.map((m) => (m.id === assistantMsgId ? { ...m, content: m.content + t } : m)));
    };

    try {
      if (mode === "one_to_one") {
        const adapter = pickAdapter(activeAgent);
        await runOneToOne({
          adapter,
          agent: activeAgent,
          input,
          history,
          system,
          onDelta
        });
      } else {
        const leader = { agent: activeAgent, adapter: pickAdapter(activeAgent) };
        const workers = agents
          .filter((a) => a.id !== activeAgent.id)
          .map((a) => ({ agent: a, adapter: pickAdapter(a) }));

        await runLeaderTeam({
          leader,
          workers,
          input,
          history,
          system,
          onLog: pushLog,
          onDelta
        });
      }
    } catch (e: any) {
      onDelta(`\n\n[ERROR]\n${e?.message ?? String(e)}`);
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

const selectStyle: React.CSSProperties = {
  padding: "8px 10px",
  borderRadius: 10,
  border: "1px solid #222636",
  background: "#0f1118",
  color: "white"
};
