import React, { useState } from "react";
import { AgentConfig, DocItem, McpServerConfig } from "../types";

const emptyAgent = (): AgentConfig => ({
  id: crypto.randomUUID(),
  name: "New Agent",
  type: "openai_compat",
  endpoint: "https://api.openai.com/v1",
  model: "gpt-4o-mini",
  capabilities: { streaming: true }
});

export default function AgentsPanel(props: {
  agents: AgentConfig[];
  activeAgentId: string;
  onSelect: (id: string) => void;
  onSave: (a: AgentConfig) => void;
  onDelete: (id: string) => void;
  onDetect: (a: AgentConfig) => void;
  docs: DocItem[];
  mcpServers: McpServerConfig[];
}) {
  const [draft, setDraft] = useState<AgentConfig | null>(null);
  const active = props.agents.find((a) => a.id === props.activeAgentId) ?? null;

  return (
    <div className="agents-shell">
      <div className="agents-list">
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
          <div style={{ fontWeight: 800 }}>Agents</div>
        <button onClick={() => setDraft(emptyAgent())} style={{ ...btnSmall, marginLeft: "auto" }}>
          + Add
        </button>
        </div>

        <div style={{ display: "grid", gap: 8 }}>
          {props.agents.map((a) => (
            <button
              key={a.id}
              onClick={() => props.onSelect(a.id)}
              style={{
                textAlign: "left",
                padding: 12,
                borderRadius: 14,
                border: a.id === props.activeAgentId ? "1px solid #5b6bff" : "1px solid #222636",
                background: a.id === props.activeAgentId ? "#13162a" : "#0f1118",
                color: "white"
              }}
            >
              <div style={{ fontWeight: 700 }}>{a.name}</div>
              <div style={{ fontSize: 12, opacity: 0.7 }}>
                {a.type}
                {a.model ? ` · ${a.model}` : ""}
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="agents-detail">
        {!active ? (
          <div style={{ opacity: 0.7 }}>Select an agent to edit its settings.</div>
        ) : (
          <>
            <div className="agent-header">
              <div>
                <div style={{ fontWeight: 800, fontSize: 16 }}>{active.name}</div>
                <div style={{ fontSize: 12, opacity: 0.7 }}>
                  {active.type}
                  {active.model ? ` · ${active.model}` : ""}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => setDraft(active)} style={btnSmall}>
                  Edit
                </button>
                <button onClick={() => props.onDetect(active)} style={btnSmall}>
                  Detect
                </button>
                <button onClick={() => props.onDelete(active.id)} style={btnDangerSmall}>
                  Delete
                </button>
              </div>
            </div>

            {!draft && (
              <div style={{ fontSize: 13, opacity: 0.8 }}>
                Use Edit to change endpoints, models, and access rules for this agent.
              </div>
            )}
          </>
        )}

        {draft && (
          <Editor
            draft={draft}
            docs={props.docs}
            mcpServers={props.mcpServers}
            onCancel={() => setDraft(null)}
            onSave={(a) => {
              props.onSave(a);
              setDraft(null);
            }}
          />
        )}
      </div>
    </div>
  );
}

function Editor(props: {
  draft: AgentConfig;
  docs: DocItem[];
  mcpServers: McpServerConfig[];
  onCancel: () => void;
  onSave: (a: AgentConfig) => void;
}) {
  const [a, setA] = useState<AgentConfig>({ ...props.draft });

  const allowAllDocs = a.allowedDocIds === undefined;
  const allowAllMcps = a.allowedMcpServerIds === undefined;

  function toggleDoc(id: string) {
    const allowed = new Set(a.allowedDocIds ?? []);
    if (allowed.has(id)) allowed.delete(id);
    else allowed.add(id);
    setA({ ...a, allowedDocIds: Array.from(allowed) });
  }

  function toggleMcp(id: string) {
    const allowed = new Set(a.allowedMcpServerIds ?? []);
    if (allowed.has(id)) allowed.delete(id);
    else allowed.add(id);
    setA({ ...a, allowedMcpServerIds: Array.from(allowed) });
  }

  return (
    <div className="card" style={{ padding: 14, marginTop: 12 }}>
      <div style={{ fontWeight: 800, marginBottom: 10 }}>Edit Agent</div>

      <label style={label}>Name</label>
      <input value={a.name} onChange={(e) => setA({ ...a, name: e.target.value })} style={inp} />

      <label style={label}>Type</label>
      <select value={a.type} onChange={(e) => setA({ ...a, type: e.target.value as any })} style={inp as any}>
        <option value="openai_compat">openai_compat</option>
        <option value="chrome_prompt">chrome_prompt</option>
        <option value="custom">custom</option>
      </select>

      {a.type === "openai_compat" && (
        <>
          <label style={label}>Endpoint</label>
          <input value={a.endpoint ?? ""} onChange={(e) => setA({ ...a, endpoint: e.target.value })} style={inp} />
          <label style={label}>Model</label>
          <input value={a.model ?? ""} onChange={(e) => setA({ ...a, model: e.target.value })} style={inp} />
          <label style={label}>API Key</label>
          <input value={a.apiKey ?? ""} onChange={(e) => setA({ ...a, apiKey: e.target.value })} style={inp} />
          <div style={{ fontSize: 12, opacity: 0.75, lineHeight: 1.5 }}>
            Note: storing API keys in the browser is risky (users can inspect & reuse it). For production, use a server-side
            proxy.
          </div>
        </>
      )}

      {a.type === "custom" && (
        <>
          <label style={label}>URL</label>
          <input
            value={a.custom?.url ?? ""}
            onChange={(e) =>
              setA({
                ...a,
                custom: {
                  ...(a.custom ?? { method: "POST", url: "", bodyTemplate: "{}", responseJsonPath: "$.text" }),
                  url: e.target.value
                }
              })
            }
            style={inp}
          />

          <label style={label}>Body Template (JSON)</label>
          <textarea
            value={
              a.custom?.bodyTemplate ??
              `{"input":"{{input}}","history":"{{history}}","model":"{{model}}"}`
            }
            onChange={(e) =>
              setA({
                ...a,
                custom: {
                  ...(a.custom ?? { method: "POST", url: "", bodyTemplate: "", responseJsonPath: "$.text" }),
                  bodyTemplate: e.target.value
                }
              })
            }
            rows={6}
            style={{ ...inp, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}
          />

          <label style={label}>Response Path (e.g. $.choices[0].message.content)</label>
          <input
            value={a.custom?.responseJsonPath ?? "$.text"}
            onChange={(e) =>
              setA({
                ...a,
                custom: {
                  ...(a.custom ?? { method: "POST", url: "", bodyTemplate: "{}", responseJsonPath: "$.text" }),
                  responseJsonPath: e.target.value
                }
              })
            }
            style={inp}
          />
        </>
      )}

      {a.type === "chrome_prompt" && (
        <div style={{ fontSize: 12, opacity: 0.75, lineHeight: 1.5 }}>
          Uses Chrome built-in AI (Prompt API). It only works in supported Chrome builds/profiles with the feature enabled.
        </div>
      )}

      <div style={{ marginTop: 12 }}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>Access Control</div>

        <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 6 }}>Docs</div>
        <label style={checkRow}>
          <input
            type="checkbox"
            checked={allowAllDocs}
            onChange={(e) => setA({ ...a, allowedDocIds: e.target.checked ? undefined : [] })}
          />
          <span>Allow all docs</span>
        </label>
        {!allowAllDocs && (
          <div style={{ display: "grid", gap: 6, marginTop: 6 }}>
            {props.docs.length === 0 && <div style={{ fontSize: 12, opacity: 0.7 }}>No docs yet.</div>}
            {props.docs.map((d) => (
              <label key={d.id} style={checkRow}>
                <input type="checkbox" checked={a.allowedDocIds?.includes(d.id) ?? false} onChange={() => toggleDoc(d.id)} />
                <span>{d.title}</span>
              </label>
            ))}
          </div>
        )}

        <div style={{ fontSize: 12, opacity: 0.7, marginTop: 12, marginBottom: 6 }}>MCP Servers</div>
        <label style={checkRow}>
          <input
            type="checkbox"
            checked={allowAllMcps}
            onChange={(e) => setA({ ...a, allowedMcpServerIds: e.target.checked ? undefined : [] })}
          />
          <span>Allow all MCP servers</span>
        </label>
        {!allowAllMcps && (
          <div style={{ display: "grid", gap: 6, marginTop: 6 }}>
            {props.mcpServers.length === 0 && <div style={{ fontSize: 12, opacity: 0.7 }}>No MCP servers yet.</div>}
            {props.mcpServers.map((s) => (
              <label key={s.id} style={checkRow}>
                <input
                  type="checkbox"
                  checked={a.allowedMcpServerIds?.includes(s.id) ?? false}
                  onChange={() => toggleMcp(s.id)}
                />
                <span>{s.name}</span>
              </label>
            ))}
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button onClick={props.onCancel} style={btn}>
          Cancel
        </button>
        <button onClick={() => props.onSave(a)} style={btnPrimary}>
          Save
        </button>
      </div>
    </div>
  );
}

const label: React.CSSProperties = { fontSize: 12, opacity: 0.8 };

const inp: React.CSSProperties = {
  width: "100%",
  margin: "6px 0 10px",
  padding: "8px 10px",
  borderRadius: 10,
  border: "1px solid #222636",
  background: "#0f1118",
  color: "white"
};

const btnSmall: React.CSSProperties = {
  padding: "6px 10px",
  borderRadius: 10,
  border: "1px solid #2a2f45",
  background: "#151827",
  color: "white"
};

const btnDangerSmall: React.CSSProperties = {
  ...btnSmall,
  border: "1px solid #3a1f24",
  background: "#1a0f12"
};

const btn: React.CSSProperties = {
  padding: "8px 10px",
  borderRadius: 10,
  border: "1px solid #222636",
  background: "#0f1118",
  color: "white",
  width: "100%"
};

const btnPrimary: React.CSSProperties = {
  ...btn,
  background: "#1a2255",
  border: "1px solid #4456ff"
};

const checkRow: React.CSSProperties = {
  display: "flex",
  gap: 8,
  alignItems: "center",
  fontSize: 12
};
