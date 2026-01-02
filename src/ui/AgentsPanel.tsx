import React, { useState } from "react";
import { AgentConfig } from "../types";

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
}) {
  const [draft, setDraft] = useState<AgentConfig | null>(null);
  const active = props.agents.find((a) => a.id === props.activeAgentId);

  return (
    <div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
        <div style={{ fontWeight: 700 }}>Agents</div>
        <button onClick={() => setDraft(emptyAgent())} style={btnSmall}>
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
              padding: 10,
              borderRadius: 12,
              border: a.id === props.activeAgentId ? "1px solid #5b6bff" : "1px solid #222636",
              background: "#0f1118",
              color: "white"
            }}
          >
            <div style={{ fontWeight: 650 }}>{a.name}</div>
            <div style={{ fontSize: 12, opacity: 0.75 }}>
              {a.type}
              {a.model ? ` · ${a.model}` : ""}
            </div>
          </button>
        ))}
      </div>

      <div style={{ marginTop: 12 }}>
        <hr />
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <div style={{ fontWeight: 700 }}>Selected</div>
          {active && (
            <>
              <button onClick={() => setDraft(active)} style={btnSmall}>
                Edit
              </button>
              <button onClick={() => props.onDetect(active)} style={btnSmall}>
                Detect
              </button>
              <button onClick={() => props.onDelete(active.id)} style={btnDangerSmall}>
                Delete
              </button>
            </>
          )}
        </div>
      </div>

      {draft && (
        <Editor
          draft={draft}
          onCancel={() => setDraft(null)}
          onSave={(a) => {
            props.onSave(a);
            setDraft(null);
          }}
        />
      )}
    </div>
  );
}

function Editor(props: { draft: AgentConfig; onCancel: () => void; onSave: (a: AgentConfig) => void }) {
  const [a, setA] = useState<AgentConfig>({ ...props.draft });

  return (
    <div className="card" style={{ padding: 12, marginTop: 12 }}>
      <div style={{ fontWeight: 800, marginBottom: 8 }}>Edit Agent</div>

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
  marginLeft: "auto",
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
