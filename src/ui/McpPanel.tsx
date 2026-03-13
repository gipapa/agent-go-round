import React, { useMemo, useState } from "react";
import { LogEntry, McpServerConfig, McpTool } from "../types";
import { McpSseClient } from "../mcp/sseClient";
import { listTools, callTool } from "../mcp/toolRegistry";
import { generateId } from "../utils/id";
import { McpPromptTemplateKey, McpPromptTemplates, getDefaultMcpPromptTemplates } from "../storage/settingsStore";
import HelpModal from "./HelpModal";

export default function McpPanel(props: {
  servers: McpServerConfig[];
  activeId: string | null;
  toolsByServer: Record<string, McpTool[]>;
  promptTemplates: McpPromptTemplates;
  onChangePromptTemplates: (next: McpPromptTemplates) => void;
  onChangeServers: (s: McpServerConfig[]) => void;
  onSelectActive: (id: string | null) => void;
  onUpdateTools: (id: string, tools: McpTool[]) => void;
  pushLog: (entry: Omit<LogEntry, "id" | "ts"> & { ts?: number }) => void;
}) {
  const [draftUrl, setDraftUrl] = useState("");
  const active = useMemo(() => props.servers.find((s) => s.id === props.activeId) ?? null, [props.servers, props.activeId]);
  const [showHelp, setShowHelp] = useState(false);
  const [showPromptConfig, setShowPromptConfig] = useState(false);
  const [templateEditorId, setTemplateEditorId] = useState<McpPromptTemplateKey>(props.promptTemplates.activeId);
  const defaultTemplates = useMemo(() => getDefaultMcpPromptTemplates(), []);

  const tools = useMemo(() => (active ? props.toolsByServer[active.id] ?? [] : []), [props.toolsByServer, active]);
  const [toolName, setToolName] = useState("");
  const [toolInput, setToolInput] = useState("{}");
  const [toolOutput, setToolOutput] = useState("");

  React.useEffect(() => {
    setTemplateEditorId(props.promptTemplates.activeId);
  }, [props.promptTemplates.activeId]);

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
    const s: McpServerConfig = { id: generateId(), name: `MCP ${props.servers.length + 1}`, sseUrl: url };
    props.onChangeServers([s, ...props.servers]);
    props.onSelectActive(s.id);
    setDraftUrl("");
  }

  function removeServer(id: string) {
    props.onChangeServers(props.servers.filter((s) => s.id !== id));
    if (props.activeId === id) props.onSelectActive(null);
  }

  function updateTemplate(id: McpPromptTemplateKey, value: string) {
    props.onChangePromptTemplates({ ...props.promptTemplates, [id]: value });
  }

  function setActiveTemplate(id: McpPromptTemplateKey) {
    props.onChangePromptTemplates({ ...props.promptTemplates, activeId: id });
  }

  function resetTemplate(id: McpPromptTemplateKey) {
    updateTemplate(id, defaultTemplates[id]);
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
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
        <button
          type="button"
          onClick={() => setShowHelp(true)}
          title="MCP 使用說明"
          aria-label="MCP 使用說明"
          style={helpBtn}
        >
          ?
        </button>
      </div>

      {showHelp && (
        <HelpModal title="MCP 使用說明與測試方式" onClose={() => setShowHelp(false)}>
          <div style={helpText}>
            MCP 工具是從 `Active MCP servers` 這個區塊連進來的。系統會先連到 `/mcp/sse`，再把路徑中的 `/sse`
            自動換成 `/rpc` 作為工具呼叫端點。
          </div>
          <div style={{ ...helpText, marginTop: 8 }}>
            `Tool Decision Prompt` 用來控制每次自動判斷是否要使用 MCP 工具時，前面那段 preflight prompt 的內容。
            你可以同時保存中文模板與英文模板，再指定目前要使用哪一份。
          </div>
          <div style={{ ...helpText, marginTop: 8 }}>
            模板 placeholders：
            <br />
            <code>{'{{userInput}}'}</code>, <code>{'{{toolListJson}}'}</code>, <code>{'{{noToolJson}}'}</code>,{" "}
            <code>{'{{userProfileJson}}'}</code>, <code>{'{{builtinToolJson}}'}</code>, <code>{'{{mcpCallJson}}'}</code>
            <br />
            這些 placeholders 會插入最後要給模型看的 JSON 範例，所以請保留原樣。JSON schema 與 key 會維持英文。
          </div>
          <div style={{ ...helpText, marginTop: 8 }}>
            補充：
            <br />
            1. 如果有 MCP server，但還沒先按 `Connect & List Tools` 取得工具清單，`normal talking` 會略過自動工具判斷
            <br />
            2. 如果瀏覽器跑在 Windows、MCP server 跑在 WSL，請優先使用 WSL IP，不要直接用 `127.0.0.1`
            <br />
            3. 例如：`http://172.xx.xx.xx:3333/mcp/sse`
            <br />
          </div>
          <div style={{ ...helpText, marginTop: 8 }}>
            測試方式：
            <br />
            1. 啟動本地測試 server，例如 `mcp-test/server.js`
            <br />
            2. 加入一個 SSE URL，例如 `http://127.0.0.1:3333/mcp/sse`，或對應的 WSL / 區網 IP
            <br />
            3. 按下 `Connect & List Tools`
            <br />
            4. 選擇 `time`，再按 `Call` 驗證工具是否真的能執行
          </div>
        </HelpModal>
      )}

      <div className="card" style={{ padding: 12, marginTop: 12, display: "grid", gap: 8 }}>
        <div style={{ fontWeight: 800 }}>Tool Decision Prompt</div>
        <button type="button" onClick={() => setShowPromptConfig(true)} style={btnPrimary}>
          {props.promptTemplates.activeId === "zh" ? "中文模板" : "English Template"}
        </button>
      </div>

      {showPromptConfig && (
        <HelpModal title="Tool Decision Prompt 設定" onClose={() => setShowPromptConfig(false)} width="min(760px, 96vw)">
          <div style={{ display: "grid", gap: 12 }}>
            <div style={{ fontSize: 12, opacity: 0.8, lineHeight: 1.7 }}>
              這裡設定的是「自動判斷要不要使用 MCP 工具」之前，送給模型的模板內容。透過 placeholders 插入的 JSON 範例會維持英文。
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {([
                ["zh", "中文模板"],
                ["en", "English Template"]
              ] as const).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setTemplateEditorId(id)}
                  style={{
                    ...btnSmall,
                    border: templateEditorId === id ? "1px solid var(--primary)" : btnSmall.border,
                    background: templateEditorId === id ? "rgba(91, 123, 255, 0.14)" : btnSmall.background
                  }}
                >
                  {label}
                </button>
              ))}
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={() => setActiveTemplate(templateEditorId)}
                style={props.promptTemplates.activeId === templateEditorId ? btnActiveSmall : btnPrimarySmall}
              >
                {props.promptTemplates.activeId === templateEditorId ? "目前啟用中" : "設為啟用模板"}
              </button>
              <button type="button" onClick={() => resetTemplate(templateEditorId)} style={btnSmall}>
                重設目前模板
              </button>
            </div>

            <textarea
              value={props.promptTemplates[templateEditorId]}
              onChange={(e) => updateTemplate(templateEditorId, e.target.value)}
              rows={14}
              style={{ ...inp, minHeight: 240, fontFamily: 'Consolas, "SFMono-Regular", monospace', lineHeight: 1.55 }}
            />

            <div style={{ fontSize: 12, opacity: 0.8, lineHeight: 1.7 }}>
              Placeholders：
              <br />
              <code>{'{{userInput}}'}</code>, <code>{'{{toolListJson}}'}</code>, <code>{'{{noToolJson}}'}</code>,{" "}
              <code>{'{{userProfileJson}}'}</code>, <code>{'{{builtinToolJson}}'}</code>, <code>{'{{mcpCallJson}}'}</code>
              <br />
              請盡量保留這些 placeholders。就算模板周圍文字改成中文，插入進去的 JSON schema 與 key 也會維持英文。
            </div>
          </div>
        </HelpModal>
      )}

      <div style={{ fontWeight: 800, marginTop: 14 }}>Active MCP servers</div>

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
    </div>
  );
}

const inp: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  borderRadius: 12,
  border: "1px solid var(--border)",
  background: "var(--bg-2)",
  color: "var(--text)"
};

const btn: React.CSSProperties = {
  width: 90,
  borderRadius: 12,
  border: "1px solid var(--border)",
  background: "var(--panel-2)",
  color: "var(--text)"
};

const btnPrimary: React.CSSProperties = {
  width: "100%",
  marginTop: 8,
  padding: "8px 10px",
  borderRadius: 12,
  border: "1px solid var(--primary)",
  background: "var(--primary)",
  color: "#0b0e14",
  fontWeight: 700
};

const btnPrimarySmall: React.CSSProperties = {
  padding: "8px 12px",
  borderRadius: 12,
  border: "1px solid var(--primary)",
  background: "var(--primary)",
  color: "#0b0e14",
  fontWeight: 700
};

const btnActiveSmall: React.CSSProperties = {
  ...btnPrimarySmall,
  opacity: 0.82
};

const btnSmall: React.CSSProperties = {
  padding: "7px 11px",
  borderRadius: 12,
  border: "1px solid var(--border)",
  background: "var(--panel-2)",
  color: "var(--text)"
};

const helpBtn: React.CSSProperties = {
  width: 28,
  height: 28,
  borderRadius: 999,
  border: "1px solid var(--border)",
  background: "rgba(91, 123, 255, 0.12)",
  color: "var(--text)",
  fontWeight: 800,
  lineHeight: 1,
  padding: 0
};

const helpText: React.CSSProperties = {
  fontSize: 12,
  lineHeight: 1.6,
  opacity: 0.82
};
