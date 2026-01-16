import React, { useMemo, useState } from "react";
import { LogEntry, McpServerConfig, McpTool } from "../types";
import { McpSseClient } from "../mcp/sseClient";
import { listTools, callTool } from "../mcp/toolRegistry";

export default function McpPanel(props: {
  servers: McpServerConfig[];
  activeId: string | null;
  toolsByServer: Record<string, McpTool[]>;
  onChangeServers: (s: McpServerConfig[]) => void;
  onSelectActive: (id: string | null) => void;
  onUpdateTools: (id: string, tools: McpTool[]) => void;
  pushLog: (entry: Omit<LogEntry, "id" | "ts"> & { ts?: number }) => void;
}) {
  const [draftUrl, setDraftUrl] = useState("");
  const active = useMemo(() => props.servers.find((s) => s.id === props.activeId) ?? null, [props.servers, props.activeId]);
  const [collapsed, setCollapsed] = useState(false);

  const tools = useMemo(() => (active ? props.toolsByServer[active.id] ?? [] : []), [props.toolsByServer, active]);
  const [toolName, setToolName] = useState("");
  const [toolInput, setToolInput] = useState("{}");
  const [toolOutput, setToolOutput] = useState("");

  function deriveRpcUrl(sseUrl: string) {
    try {
      const url = new URL(sseUrl);
      url.pathname = url.pathname.replace(/\/sse$/, "/rpc");
      return url.toString();
    } catch {
      return sseUrl.replace(/\/sse$/, "/rpc");
    }
  }

  function resolveToolName(input: string) {
    const trimmed = input.trim();
    if (!trimmed) return trimmed;
    return trimmed;
  }

  function updateServerName(id: string, name: string) {
    const next = props.servers.map((s) => (s.id === id ? { ...s, name } : s));
    props.onChangeServers(next);
  }

  function addServer() {
    const url = draftUrl.trim();
    if (!url) return;
    const s: McpServerConfig = { id: crypto.randomUUID(), name: `MCP ${props.servers.length + 1}`, sseUrl: url };
    props.onChangeServers([s, ...props.servers]);
    props.onSelectActive(s.id);
    setDraftUrl("");
  }

  function removeServer(id: string) {
    props.onChangeServers(props.servers.filter((s) => s.id !== id));
    if (props.activeId === id) props.onSelectActive(null);
  }

  async function connectAndList() {
    if (!active) return;
    const client = new McpSseClient(active);
    client.connect((t) => props.pushLog({ category: "mcp", agent: active.name, message: t }));
    try {
      const ts = await listTools(client);
      props.onUpdateTools(active.id, ts);
      const rpcUrl = deriveRpcUrl(active.sseUrl);
      props.pushLog({
        category: "mcp",
        agent: active.name,
        ok: true,
        message: "MCP endpoints",
        details: `SSE: ${active.sseUrl}\nRPC: ${rpcUrl}`
      });
      props.pushLog({
        category: "mcp",
        agent: active.name,
        ok: true,
        message: `tools/list -> ${ts.length} tools`,
        details: ts.map((t) => t.name).join("\n") || "(no tools)"
      });
    } catch (e: any) {
      props.pushLog({
        category: "mcp",
        agent: active.name,
        ok: false,
        message: "tools/list error",
        details: String(e?.message ?? e)
      });
    }
  }

  async function doCallTool() {
    if (!active) return;
    const client = new McpSseClient(active);
    client.connect((t) => props.pushLog({ category: "mcp", agent: active.name, message: t }));
    try {
      const input = JSON.parse(toolInput || "{}");
      const resolved = resolveToolName(toolName);
      const res = await callTool(client, resolved, input);
      setToolOutput(JSON.stringify(res, null, 2));
      props.pushLog({ category: "mcp", agent: active.name, ok: true, message: `tools/call ${resolved} OK` });
    } catch (e: any) {
      setToolOutput(String(e?.message ?? e));
      props.pushLog({
        category: "mcp",
        agent: active.name,
        ok: false,
        message: "tools/call error",
        details: String(e?.message ?? e)
      });
    }
  }

  return (
    <div>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <div style={{ fontWeight: 800 }}>MCP (SSE)</div>
        <button onClick={() => setCollapsed((c) => !c)} style={{ ...btnSmall, marginLeft: "auto" }}>
          {collapsed ? "Expand" : "Collapse"}
        </button>
      </div>

      {!collapsed && (
        <>
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <input
              value={draftUrl}
              onChange={(e) => setDraftUrl(e.target.value)}
              placeholder="SSE URL (e.g. https://your-mcp/sse) — RPC will be derived automatically"
              style={inp}
            />
            <button onClick={addServer} style={btn}>
              Add
            </button>
          </div>

          <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
            {props.servers.map((s) => (
              <div
                key={s.id}
                className="card"
                style={{
                  padding: 10,
                  border: s.id === props.activeId ? "1px solid #5b6bff" : "1px solid #222636",
                  background: "#0f1118"
                }}
              >
                <div style={{ display: "grid", gap: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <div onClick={() => props.onSelectActive(s.id)} style={{ cursor: "pointer", flex: 1 }}>
                      <div style={{ fontWeight: 650 }}>{s.name}</div>
                      <div style={{ fontSize: 12, opacity: 0.75 }}>{s.sseUrl}</div>
                    </div>
                    <button onClick={() => removeServer(s.id)} style={btnSmall}>
                      Remove
                    </button>
                  </div>
                  <input
                    value={s.name}
                    onChange={(e) => updateServerName(s.id, e.target.value)}
                    placeholder="MCP name"
                    style={inp}
                  />
                </div>
              </div>
            ))}
          </div>

          {active && (
            <>
              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <button onClick={connectAndList} style={btnPrimary}>
                  Connect & List Tools
                </button>
              </div>

              {tools.length > 0 && (
                <div style={{ marginTop: 10, fontSize: 12, opacity: 0.9 }}>
                  <div style={{ fontWeight: 700, marginBottom: 6 }}>Tools</div>
                  <div style={{ display: "grid", gap: 6 }}>
                    {tools.map((t) => (
                      <div key={t.name} className="card" style={{ padding: 8 }}>
                        <div style={{ fontWeight: 650 }}>{t.name}</div>
                        <div style={{ opacity: 0.7 }}>{t.description ?? ""}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <hr style={{ margin: "12px 0" }} />

              <div style={{ fontWeight: 700, marginBottom: 6 }}>Call Tool</div>
              <select value={toolName} onChange={(e) => setToolName(e.target.value)} style={{ ...inp, marginBottom: 8 }}>
                <option value="">Choose a tool</option>
                {tools.map((t) => {
                  return (
                    <option key={t.name} value={t.name}>
                      {t.name}
                    </option>
                  );
                })}
              </select>
              <input value={toolName} onChange={(e) => setToolName(e.target.value)} placeholder="tool name" style={inp} />
              <textarea value={toolInput} onChange={(e) => setToolInput(e.target.value)} rows={5} style={inp} />
              <button onClick={doCallTool} style={btnPrimary}>
                Call
              </button>

              {toolOutput && (
                <pre style={{ whiteSpace: "pre-wrap", background: "#0f1118", border: "1px solid #222636", padding: 10, borderRadius: 12, marginTop: 10 }}>
                  {toolOutput}
                </pre>
              )}

              <div style={{ marginTop: 10, fontSize: 12, opacity: 0.7 }}>
                Note: EventSource cannot set custom headers. If your MCP server needs auth, prefer querystring token or same-site cookies. RPC is derived by replacing `/sse` with `/rpc`.
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

const inp: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  borderRadius: 10,
  border: "1px solid #222636",
  background: "#0f1118",
  color: "white"
};

const btn: React.CSSProperties = {
  width: 90,
  borderRadius: 10,
  border: "1px solid #2a2f45",
  background: "#151827",
  color: "white"
};

const btnPrimary: React.CSSProperties = {
  width: "100%",
  marginTop: 8,
  padding: "8px 10px",
  borderRadius: 10,
  border: "1px solid #4456ff",
  background: "#1a2255",
  color: "white",
  fontWeight: 700
};

const btnSmall: React.CSSProperties = {
  padding: "6px 10px",
  borderRadius: 10,
  border: "1px solid #2a2f45",
  background: "#151827",
  color: "white"
};
