import React, { useMemo, useState } from "react";
import { McpServerConfig, McpTool } from "../types";
import { McpSseClient } from "../mcp/sseClient";
import { listTools, callTool } from "../mcp/toolRegistry";

export default function McpPanel(props: {
  servers: McpServerConfig[];
  activeId: string | null;
  toolsByServer: Record<string, McpTool[]>;
  onChangeServers: (s: McpServerConfig[]) => void;
  onSelectActive: (id: string) => void;
  onUpdateTools: (id: string, tools: McpTool[]) => void;
  log: string[];
  pushLog: (t: string) => void;
}) {
  const [draftUrl, setDraftUrl] = useState("");
  const active = useMemo(() => props.servers.find((s) => s.id === props.activeId) ?? null, [props.servers, props.activeId]);
  const [collapsed, setCollapsed] = useState(false);

  const tools = useMemo(() => (active ? props.toolsByServer[active.id] ?? [] : []), [props.toolsByServer, active]);
  const [toolName, setToolName] = useState("");
  const [toolInput, setToolInput] = useState("{}");
  const [toolOutput, setToolOutput] = useState("");

  function addServer() {
    const url = draftUrl.trim();
    if (!url) return;
    const s: McpServerConfig = { id: crypto.randomUUID(), name: `MCP ${props.servers.length + 1}`, sseUrl: url };
    props.onChangeServers([s, ...props.servers]);
    props.onSelectActive(s.id);
    setDraftUrl("");
  }

  async function connectAndList() {
    if (!active) return;
    const client = new McpSseClient(active);
    client.connect(props.pushLog);
    try {
      const ts = await listTools(client);
      props.onUpdateTools(active.id, ts);
      props.pushLog(`tools/list -> ${ts.length} tools`);
    } catch (e: any) {
      props.pushLog(`tools/list error: ${e?.message ?? String(e)}`);
    }
  }

  async function doCallTool() {
    if (!active) return;
    const client = new McpSseClient(active);
    client.connect(props.pushLog);
    try {
      const input = JSON.parse(toolInput || "{}");
      const res = await callTool(client, toolName, input);
      setToolOutput(JSON.stringify(res, null, 2));
      props.pushLog(`tools/call ${toolName} OK`);
    } catch (e: any) {
      setToolOutput(String(e?.message ?? e));
      props.pushLog(`tools/call error: ${e?.message ?? String(e)}`);
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
            <input value={draftUrl} onChange={(e) => setDraftUrl(e.target.value)} placeholder="SSE URL (e.g. https://your-mcp/sse)" style={inp} />
            <button onClick={addServer} style={btn}>
              Add
            </button>
          </div>

          <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
            {props.servers.map((s) => (
              <button
                key={s.id}
                onClick={() => props.onSelectActive(s.id)}
                style={{
                  textAlign: "left",
                  padding: 10,
                  borderRadius: 12,
                  border: s.id === props.activeId ? "1px solid #5b6bff" : "1px solid #222636",
                  background: "#0f1118",
                  color: "white"
                }}
              >
                <div style={{ fontWeight: 650 }}>{s.name}</div>
                <div style={{ fontSize: 12, opacity: 0.75 }}>{s.sseUrl}</div>
              </button>
            ))}
          </div>

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

          <hr style={{ margin: "12px 0" }} />
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Log</div>
          <div style={{ fontSize: 12, opacity: 0.8, lineHeight: 1.5 }}>
            {props.log.map((l, i) => (
              <div key={i}>{l}</div>
            ))}
          </div>

          <div style={{ marginTop: 10, fontSize: 12, opacity: 0.7 }}>
            Note: EventSource cannot set custom headers. If your MCP server needs auth, prefer querystring token or same-site cookies.
          </div>
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
