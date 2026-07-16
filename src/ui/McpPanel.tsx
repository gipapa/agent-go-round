import React, { useMemo, useState } from "react";
import { LogEntry, McpServerConfig, McpTool } from "../types";
import { type McpClientManager } from "../mcp/clientManager";
import { createMcpClient } from "../mcp/client";
import { listTools, callTool, type McpRequester } from "../mcp/toolRegistry";
import { generateId } from "../utils/id";
import { errorMessage } from "../utils/errors";
import HelpModal from "./HelpModal";
import { redactMcpUrl } from "../mcp/url";

export default function McpPanel(props: {
  servers: McpServerConfig[];
  activeId: string | null;
  toolsByServer: Record<string, McpTool[]>;
  onChangeServers: (s: McpServerConfig[]) => void;
  onSelectActive: (id: string | null) => void;
  onUpdateTools: (id: string, tools: McpTool[]) => void;
  clientManager?: McpClientManager;
  pushLog: (entry: Omit<LogEntry, "id" | "ts"> & { ts?: number }) => void;
}) {
  const active = useMemo(() => props.servers.find((s) => s.id === props.activeId) ?? props.servers[0] ?? null, [props.servers, props.activeId]);
  const [showHelp, setShowHelp] = useState(false);
  const [editingServerId, setEditingServerId] = useState<string | null>(null);
  const [serverDraft, setServerDraft] = useState<McpServerConfig | null>(null);
  const [customHeadersDraft, setCustomHeadersDraft] = useState("{}");
  const [draftTools, setDraftTools] = useState<McpTool[]>([]);
  const [draftValidated, setDraftValidated] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [toolName, setToolName] = useState("");
  const [toolInput, setToolInput] = useState("{}");
  const [toolOutput, setToolOutput] = useState("");
  const [isConnecting, setIsConnecting] = useState(false);
  const [isCallingTool, setIsCallingTool] = useState(false);

  React.useEffect(() => {
    if (props.activeId && props.servers.some((server) => server.id === props.activeId)) return;
    props.onSelectActive(props.servers[0]?.id ?? null);
  }, [props.activeId, props.onSelectActive, props.servers]);

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
    return input.trim();
  }

  function hasSameConnectionSettings(saved: McpServerConfig, draft: McpServerConfig) {
    return (
      (saved.transport ?? "sse") === (draft.transport ?? "sse") &&
      saved.sseUrl === draft.sseUrl &&
      saved.authToken === draft.authToken &&
      JSON.stringify(saved.customHeaders ?? {}) === JSON.stringify(draft.customHeaders ?? {}) &&
      saved.useLocalProxy === draft.useLocalProxy &&
      saved.toolTimeoutSecond === draft.toolTimeoutSecond &&
      saved.heartbeatSecond === draft.heartbeatSecond
    );
  }

  async function runWithDraftClient<T>(task: (client: McpRequester) => Promise<T>) {
    const draft = getValidatedDraft();
    const savedServer = props.servers.find((server) => server.id === draft.id) ?? null;
    if (props.clientManager && savedServer && hasSameConnectionSettings(savedServer, draft)) {
      return await props.clientManager.run(
        savedServer,
        task,
        (text) => props.pushLog({ category: "mcp", agent: draft.name, message: text })
      );
    }

    const client = createMcpClient(draft);
    client.connect((text) => props.pushLog({ category: "mcp", agent: draft.name, message: text }));
    try {
      return await task(client);
    } finally {
      client.close();
    }
  }

  function openEditor(server?: McpServerConfig) {
    if (server) {
      setEditingServerId(server.id);
      setServerDraft({ ...server });
      setCustomHeadersDraft(JSON.stringify(server.customHeaders ?? {}, null, 2));
      setDraftTools(props.toolsByServer[server.id] ?? []);
      setDraftValidated(Object.prototype.hasOwnProperty.call(props.toolsByServer, server.id));
    } else {
      const next: McpServerConfig = {
        id: generateId(),
        name: `MCP ${props.servers.length + 1}`,
        sseUrl: "",
        transport: "sse",
        toolTimeoutSecond: 30,
        heartbeatSecond: 30
      };
      setEditingServerId(next.id);
      setServerDraft(next);
      setCustomHeadersDraft("{}");
      setDraftTools([]);
      setDraftValidated(false);
    }
    setDraftError(null);
    setToolName("");
    setToolInput("{}");
    setToolOutput("");
  }

  function closeEditor() {
    setEditingServerId(null);
    setServerDraft(null);
    setCustomHeadersDraft("{}");
    setDraftTools([]);
    setDraftValidated(false);
    setDraftError(null);
    setToolName("");
    setToolInput("{}");
    setToolOutput("");
    setIsConnecting(false);
    setIsCallingTool(false);
  }

  function removeServer(id: string) {
    props.onChangeServers(props.servers.filter((server) => server.id !== id));
    if (props.activeId === id) {
      props.onSelectActive(props.servers.find((server) => server.id !== id)?.id ?? null);
    }
  }

  function clearAllServers() {
    if (!props.servers.length) return;
    const confirmed = window.confirm("確定要清除所有已存的 MCP servers 嗎？這會一併移除目前已載入的 tools 清單。");
    if (!confirmed) return;
    closeEditor();
    props.onChangeServers([]);
    props.onSelectActive(null);
    props.pushLog({
      category: "mcp",
      ok: true,
      message: "All MCP servers cleared"
    });
  }

  function updateDraft(patch: Partial<McpServerConfig>) {
    setServerDraft((current) => {
      if (!current) return current;
      const next = { ...current, ...patch };
      if (
        (patch.sseUrl !== undefined && patch.sseUrl !== current.sseUrl) ||
        (patch.transport !== undefined && patch.transport !== current.transport) ||
        (patch.authToken !== undefined && patch.authToken !== current.authToken) ||
        (patch.useLocalProxy !== undefined && patch.useLocalProxy !== current.useLocalProxy)
      ) {
        setDraftValidated(false);
        setDraftTools([]);
        setToolName("");
        setToolOutput("");
      }
      return next;
    });
  }

  function parseCustomHeaders() {
    const parsed = JSON.parse(customHeadersDraft || "{}") as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Custom headers 必須是 JSON object。");
    }
    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(parsed)) {
      if (typeof value !== "string") throw new Error(`Header ${name} 的值必須是字串。`);
      if (name.trim() && value.trim()) headers[name.trim()] = value.trim();
    }
    return headers;
  }

  function getValidatedDraft() {
    if (!serverDraft) throw new Error("Missing MCP server draft.");
    return { ...serverDraft, customHeaders: parseCustomHeaders() };
  }

  function applyTavilyPreset() {
    setServerDraft((current) => current ? {
      ...current,
      name: current.name.startsWith("MCP ") ? "Tavily" : current.name,
      transport: "streamable_http",
      sseUrl: "https://mcp.tavily.com/mcp/",
      useLocalProxy: true,
      heartbeatSecond: 0
    } : current);
    setDraftValidated(false);
    setDraftTools([]);
    setDraftError(null);
  }

  async function connectAndListDraft() {
    if (!serverDraft?.sseUrl.trim()) {
      setDraftError("請先輸入 MCP endpoint URL。");
      return;
    }
    setIsConnecting(true);
    setDraftError(null);
    let client: ReturnType<typeof createMcpClient> | null = null;
    try {
      const validatedDraft = getValidatedDraft();
      client = createMcpClient(validatedDraft);
      client.connect((text) => props.pushLog({ category: "mcp", agent: validatedDraft.name, message: text }));
      const tools = await listTools(client);
      setDraftTools(tools);
      setDraftValidated(true);
      props.pushLog({
        category: "mcp",
        agent: serverDraft.name,
        ok: true,
        message: "MCP endpoint",
        details: `${validatedDraft.transport === "streamable_http" ? "Streamable HTTP" : "SSE"}: ${redactMcpUrl(validatedDraft.sseUrl)}`
      });
      props.pushLog({
        category: "mcp",
        agent: serverDraft.name,
        ok: true,
        message: `tools/list -> ${tools.length} tools`,
        details: tools.map((tool) => tool.name).join("\n") || "(no tools)"
      });
    } catch (error) {
      const message = errorMessage(error);
      setDraftValidated(false);
      setDraftTools([]);
      setDraftError(message);
      props.pushLog({
        category: "mcp",
        agent: serverDraft.name,
        ok: false,
        message: "tools/list error",
        details: message
      });
    } finally {
      client?.close();
      setIsConnecting(false);
    }
  }

  async function doCallTool() {
    if (!serverDraft) return;
    setIsCallingTool(true);
    setDraftError(null);
    try {
      const input = JSON.parse(toolInput || "{}") as unknown;
      const resolved = resolveToolName(toolName);
      const res = await runWithDraftClient((client) => callTool(client, resolved, input));
      setToolOutput(JSON.stringify(res, null, 2));
      props.pushLog({ category: "mcp", agent: serverDraft.name, ok: true, message: `tools/call ${resolved} OK` });
    } catch (error) {
      const message = errorMessage(error);
      setToolOutput(message);
      props.pushLog({
        category: "mcp",
        agent: serverDraft.name,
        ok: false,
        message: "tools/call error",
        details: message
      });
    } finally {
      setIsCallingTool(false);
    }
  }

  function saveDraft() {
    if (!serverDraft) return;
    if (!serverDraft.sseUrl.trim()) {
      setDraftError("請先輸入 MCP endpoint URL。");
      return;
    }
    if (!draftValidated) {
      setDraftError("請先完成 Connect & List Tools，再儲存。");
      return;
    }
    let validatedDraft: McpServerConfig;
    try {
      validatedDraft = getValidatedDraft();
    } catch (error) {
      setDraftError(errorMessage(error));
      return;
    }
    const nextServer: McpServerConfig = {
      ...validatedDraft,
      name: serverDraft.name.trim() || `MCP ${props.servers.length + 1}`,
      sseUrl: serverDraft.sseUrl.trim(),
      toolTimeoutSecond: Math.max(1, Math.round(serverDraft.toolTimeoutSecond ?? 30)),
      heartbeatSecond: Math.max(0, Math.round(serverDraft.heartbeatSecond ?? 30))
    };
    const exists = props.servers.some((server) => server.id === nextServer.id);
    const nextServers = exists
      ? props.servers.map((server) => (server.id === nextServer.id ? nextServer : server))
      : [nextServer, ...props.servers];
    props.onChangeServers(nextServers);
    props.onUpdateTools(nextServer.id, draftTools);
    props.onSelectActive(nextServer.id);
    closeEditor();
  }

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ fontWeight: 800 }}>MCP</div>
        <button type="button" onClick={() => setShowHelp(true)} title="MCP 使用說明" aria-label="MCP 使用說明" style={helpBtn}>
          ?
        </button>
      </div>

      {showHelp ? (
        <HelpModal title="MCP 使用說明與測試方式" onClose={() => setShowHelp(false)}>
          <div style={helpText}>
            MCP 工具從 `Active MCP servers` 連入。Remote MCP 請選 Streamable HTTP；舊式本機 server 可繼續使用 SSE，系統會把 `/sse` 換成 `/rpc`。
          </div>
          <div style={{ ...helpText, marginTop: 8 }}>
            Tool / skill 相關的 prompt templates 已移到 Chat Config 裡的 `Prompt Templates` 面板集中管理，不再放在 MCP 視窗內單獨設定。
          </div>
          <div style={{ ...helpText, marginTop: 8 }}>
            補充：
            <br />
            1. 如果有 MCP server，但還沒先按 `Connect & List Tools` 取得工具清單，`normal talking` 會略過自動工具判斷
            <br />
            2. 如果瀏覽器跑在 Windows、MCP server 跑在 WSL，請優先使用 WSL IP，不要直接用 `127.0.0.1`
            <br />
            3. 例如：`http://172.xx.xx.xx:3333/mcp/sse`
          </div>
          <div style={{ ...helpText, marginTop: 8 }}>
            測試方式：
            <br />
            1. 新增一個 MCP 項目
            <br />
            2. 選 transport 並填入 MCP endpoint URL
            <br />
            3. 按下 `Connect & List Tools`
            <br />
            4. 若成功，才會出現下方 `Call Tool` 區塊
          </div>
        </HelpModal>
      ) : null}

      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ fontWeight: 800 }}>Active MCP servers</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" onClick={clearAllServers} style={btnDangerSmall} disabled={props.servers.length === 0}>
            Clear All
          </button>
          <button type="button" onClick={() => openEditor()} style={btnSmall} data-tutorial-id="mcp-add-button">
            + Add
          </button>
        </div>
      </div>

      <div style={{ display: "grid", gap: 8 }}>
        {props.servers.length === 0 ? <div style={{ fontSize: 12, opacity: 0.7 }}>No MCP servers yet.</div> : null}
        {props.servers.map((server) => {
          const rowTools = props.toolsByServer[server.id] ?? [];
          const activeRow = server.id === active?.id;
          return (
            <div
              key={server.id}
              style={{
                padding: 12,
                borderRadius: 14,
                border: activeRow ? "1px solid var(--primary)" : "1px solid var(--border)",
                background: activeRow ? "rgba(91, 123, 255, 0.12)" : "var(--bg-2)",
                color: "var(--text)"
              }}
            >
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <button type="button" onClick={() => props.onSelectActive(server.id)} style={rowButtonStyle}>
                  <div style={{ fontWeight: 700 }}>{server.name}</div>
                  <div style={{ fontSize: 12, opacity: 0.74, marginTop: 4 }}>
                    {server.transport === "streamable_http" ? "HTTP" : "SSE"} · {server.sseUrl ? redactMcpUrl(server.sseUrl) : "尚未設定 endpoint"}
                  </div>
                  <div style={{ fontSize: 11, opacity: 0.64, marginTop: 4 }}>
                    {Object.prototype.hasOwnProperty.call(props.toolsByServer, server.id) ? `已載入 ${rowTools.length} 個 tools` : "尚未連線驗證"}
                  </div>
                </button>
                {activeRow ? (
                  <div style={{ display: "flex", gap: 8, marginLeft: "auto", flexWrap: "wrap" }}>
                    <button type="button" onClick={() => openEditor(server)} style={btnSmall}>
                      Edit
                    </button>
                    <button type="button" onClick={() => removeServer(server.id)} style={btnDangerSmall}>
                      Delete
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      {editingServerId && serverDraft ? (
        <HelpModal
          title={`Edit MCP: ${serverDraft.name}`}
          onClose={closeEditor}
          width="min(820px, calc(100vw - 48px))"
          footer={null}
        >
          <div style={{ display: "grid", gap: 12 }} data-tutorial-id="mcp-editor-modal">
            <div>
              <label style={label}>MCP Name</label>
              <input value={serverDraft.name} onChange={(e) => updateDraft({ name: e.target.value })} style={inp} placeholder="MCP name" data-tutorial-id="mcp-name-input" />
            </div>

            <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
              <div style={{ fontWeight: 700 }}>Connection</div>
              <button type="button" onClick={applyTavilyPreset} style={btnSmall}>Use Tavily preset</button>
            </div>

            <div>
              <label style={label}>Transport</label>
              <select
                value={serverDraft.transport ?? "sse"}
                onChange={(e) => updateDraft({ transport: e.target.value as McpServerConfig["transport"] })}
                style={inp}
              >
                <option value="streamable_http">Streamable HTTP (remote MCP)</option>
                <option value="sse">Legacy SSE</option>
              </select>
            </div>

            <div>
              <label style={label}>MCP endpoint URL</label>
              <input
                value={serverDraft.sseUrl}
                onChange={(e) => updateDraft({ sseUrl: e.target.value })}
                placeholder={serverDraft.transport === "streamable_http" ? "https://remote-mcp.example.com/mcp" : "https://your-mcp-server/mcp/sse"}
                style={inp}
                data-tutorial-id="mcp-sse-url-input"
              />
            </div>

            {serverDraft.transport === "streamable_http" ? (
              <>
                <div>
                  <label style={label}>Bearer token</label>
                  <input
                    type="password"
                    value={serverDraft.authToken ?? ""}
                    onChange={(e) => updateDraft({ authToken: e.target.value })}
                    placeholder="API token (optional)"
                    autoComplete="off"
                    style={inp}
                  />
                </div>
                <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12 }}>
                  <input
                    type="checkbox"
                    checked={serverDraft.useLocalProxy ?? false}
                    onChange={(e) => updateDraft({ useLocalProxy: e.target.checked })}
                  />
                  Use local Vite relay (required by Tavily because its endpoint does not allow browser CORS)
                </label>
                <div>
                  <label style={label}>Custom headers (JSON)</label>
                  <textarea
                    value={customHeadersDraft}
                    onChange={(e) => {
                      setCustomHeadersDraft(e.target.value);
                      setDraftValidated(false);
                    }}
                    rows={4}
                    style={inp}
                    spellCheck={false}
                  />
                </div>
              </>
            ) : null}

            <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
              <div>
                <label style={label}>toolTimeoutSecond</label>
                <input
                  type="number"
                  min={1}
                  max={600}
                  value={serverDraft.toolTimeoutSecond ?? 30}
                  onChange={(e) => updateDraft({ toolTimeoutSecond: Math.max(1, Number(e.target.value) || 30) })}
                  style={inp}
                />
              </div>
              <div>
                <label style={label}>heartbeatSecond</label>
                <input
                  type="number"
                  min={0}
                  max={600}
                  value={serverDraft.heartbeatSecond ?? 30}
                  onChange={(e) => updateDraft({ heartbeatSecond: Math.max(0, Number(e.target.value) || 0) })}
                  style={inp}
                />
              </div>
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="button" onClick={() => void connectAndListDraft()} style={btnPrimarySmall} disabled={isConnecting || !serverDraft.sseUrl.trim()} data-tutorial-id="mcp-connect-list-tools">
                {isConnecting ? "Connecting..." : "Connect & List Tools"}
              </button>
              {serverDraft.transport !== "streamable_http" && serverDraft.sseUrl.trim() ? (
                <div style={{ fontSize: 12, opacity: 0.72, alignSelf: "center" }}>RPC: {deriveRpcUrl(serverDraft.sseUrl.trim())}</div>
              ) : null}
            </div>

            {draftError ? <div style={errorText}>{draftError}</div> : null}

            {draftValidated ? (
              <>
                <div style={{ display: "grid", gap: 8 }}>
                  <div style={{ fontWeight: 700 }}>Tools</div>
                  {draftTools.length === 0 ? (
                    <div style={{ fontSize: 12, opacity: 0.72 }}>此 MCP server 已連線，但目前沒有列出任何 tools。</div>
                  ) : (
                    <div style={{ display: "grid", gap: 6 }}>
                      {draftTools.map((tool) => (
                        <div key={tool.name} className="card" style={{ padding: 10 }}>
                          <div style={{ fontWeight: 650 }}>{tool.name}</div>
                          <div style={{ fontSize: 12, opacity: 0.72 }}>{tool.description ?? ""}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div style={{ display: "grid", gap: 8 }}>
                  <div style={{ fontWeight: 700 }}>Call Tool</div>
                  <select value={toolName} onChange={(e) => setToolName(e.target.value)} style={inp}>
                    <option value="">Choose a tool</option>
                    {draftTools.map((tool) => (
                      <option key={tool.name} value={tool.name}>
                        {tool.name}
                      </option>
                    ))}
                  </select>
                  <input value={toolName} onChange={(e) => setToolName(e.target.value)} placeholder="tool name" style={inp} />
                  <textarea value={toolInput} onChange={(e) => setToolInput(e.target.value)} rows={5} style={inp} />
                  <button onClick={() => void doCallTool()} style={btnPrimary} disabled={isCallingTool || !toolName.trim()}>
                    {isCallingTool ? "Calling..." : "Call"}
                  </button>

                  {toolOutput ? (
                    <pre style={outputBlock}>
                      {toolOutput}
                    </pre>
                  ) : null}
                </div>
              </>
            ) : null}

            <div style={{ marginTop: 10, fontSize: 12, opacity: 0.7 }}>
              Security: token 與 custom headers 會保存在這個瀏覽器的 localStorage，請勿在共用裝置使用。Local relay 只在 `npm run dev` 可用，靜態部署需自行提供同源 MCP gateway。
            </div>
            <div style={{ fontSize: 12, opacity: 0.7 }}>
              `toolTimeoutSecond` 會中止卡住的 request；舊式 SSE 的 `heartbeatSecond` 代表閒置超過多久後，下一次工具呼叫前先做一次 `tools/list` 存活檢查。設為 `0` 可停用 heartbeat。
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 14 }}>
            <button type="button" onClick={closeEditor} style={btnSmall}>
              Close
            </button>
            <button type="button" onClick={saveDraft} style={btnPrimarySmall} disabled={!serverDraft.sseUrl.trim() || !draftValidated} data-tutorial-id="mcp-save-button">
              Save
            </button>
          </div>
        </HelpModal>
      ) : null}
    </div>
  );
}

const rowButtonStyle: React.CSSProperties = {
  flex: 1,
  textAlign: "left",
  background: "transparent",
  border: "none",
  color: "inherit",
  padding: 0,
  cursor: "pointer"
};

const label: React.CSSProperties = {
  fontSize: 12,
  opacity: 0.8
};

const inp: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  borderRadius: 12,
  border: "1px solid var(--border)",
  background: "var(--bg-2)",
  color: "var(--text)",
  boxSizing: "border-box"
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

const btnSmall: React.CSSProperties = {
  padding: "7px 11px",
  borderRadius: 12,
  border: "1px solid var(--border)",
  background: "var(--panel-2)",
  color: "var(--text)"
};

const btnDangerSmall: React.CSSProperties = {
  ...btnSmall,
  border: "1px solid rgba(255, 107, 129, 0.4)",
  color: "#ff9aa9"
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

const outputBlock: React.CSSProperties = {
  whiteSpace: "pre-wrap",
  background: "#0f1118",
  border: "1px solid #222636",
  padding: 10,
  borderRadius: 12,
  marginTop: 6
};

const errorText: React.CSSProperties = {
  fontSize: 12,
  color: "#ff9aa9",
  lineHeight: 1.6
};
