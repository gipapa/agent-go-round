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
  const active = useMemo(() => props.servers.find((s) => s.id === props.activeId) ?? props.servers[0] ?? null, [props.servers, props.activeId]);
  const [showHelp, setShowHelp] = useState(false);
  const [showPromptConfig, setShowPromptConfig] = useState(false);
  const [templateEditorId, setTemplateEditorId] = useState<McpPromptTemplateKey>(props.promptTemplates.activeId);
  const [editingServerId, setEditingServerId] = useState<string | null>(null);
  const [serverDraft, setServerDraft] = useState<McpServerConfig | null>(null);
  const [draftTools, setDraftTools] = useState<McpTool[]>([]);
  const [draftValidated, setDraftValidated] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [toolName, setToolName] = useState("");
  const [toolInput, setToolInput] = useState("{}");
  const [toolOutput, setToolOutput] = useState("");
  const [isConnecting, setIsConnecting] = useState(false);
  const [isCallingTool, setIsCallingTool] = useState(false);
  const defaultTemplates = useMemo(() => getDefaultMcpPromptTemplates(), []);

  React.useEffect(() => {
    setTemplateEditorId(props.promptTemplates.activeId);
  }, [props.promptTemplates.activeId]);

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

  function updateTemplate(id: McpPromptTemplateKey, value: string) {
    props.onChangePromptTemplates({ ...props.promptTemplates, [id]: value });
  }

  function setActiveTemplate(id: McpPromptTemplateKey) {
    props.onChangePromptTemplates({ ...props.promptTemplates, activeId: id });
  }

  function resetTemplate(id: McpPromptTemplateKey) {
    updateTemplate(id, defaultTemplates[id]);
  }

  function openEditor(server?: McpServerConfig) {
    if (server) {
      setEditingServerId(server.id);
      setServerDraft({ ...server });
      setDraftTools(props.toolsByServer[server.id] ?? []);
      setDraftValidated(Object.prototype.hasOwnProperty.call(props.toolsByServer, server.id));
    } else {
      const next: McpServerConfig = {
        id: generateId(),
        name: `MCP ${props.servers.length + 1}`,
        sseUrl: "",
        toolTimeoutSecond: 30,
        heartbeatSecond: 30
      };
      setEditingServerId(next.id);
      setServerDraft(next);
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

  function updateDraft(patch: Partial<McpServerConfig>) {
    setServerDraft((current) => {
      if (!current) return current;
      const next = { ...current, ...patch };
      if (patch.sseUrl !== undefined && patch.sseUrl !== current.sseUrl) {
        setDraftValidated(false);
        setDraftTools([]);
        setToolName("");
        setToolOutput("");
      }
      return next;
    });
  }

  async function connectAndListDraft() {
    if (!serverDraft?.sseUrl.trim()) {
      setDraftError("請先輸入 SSE URL。");
      return;
    }
    setIsConnecting(true);
    setDraftError(null);
    const client = new McpSseClient(serverDraft);
    client.connect((text) => props.pushLog({ category: "mcp", agent: serverDraft.name, message: text }));
    try {
      const tools = await listTools(client);
      setDraftTools(tools);
      setDraftValidated(true);
      const rpcUrl = deriveRpcUrl(serverDraft.sseUrl);
      props.pushLog({
        category: "mcp",
        agent: serverDraft.name,
        ok: true,
        message: "MCP endpoints",
        details: `SSE: ${serverDraft.sseUrl}\nRPC: ${rpcUrl}`
      });
      props.pushLog({
        category: "mcp",
        agent: serverDraft.name,
        ok: true,
        message: `tools/list -> ${tools.length} tools`,
        details: tools.map((tool) => tool.name).join("\n") || "(no tools)"
      });
    } catch (error: any) {
      setDraftValidated(false);
      setDraftTools([]);
      setDraftError(String(error?.message ?? error));
      props.pushLog({
        category: "mcp",
        agent: serverDraft.name,
        ok: false,
        message: "tools/list error",
        details: String(error?.message ?? error)
      });
    } finally {
      setIsConnecting(false);
    }
  }

  async function doCallTool() {
    if (!serverDraft) return;
    setIsCallingTool(true);
    setDraftError(null);
    const client = new McpSseClient(serverDraft);
    client.connect((text) => props.pushLog({ category: "mcp", agent: serverDraft.name, message: text }));
    try {
      const input = JSON.parse(toolInput || "{}");
      const resolved = resolveToolName(toolName);
      const res = await callTool(client, resolved, input);
      setToolOutput(JSON.stringify(res, null, 2));
      props.pushLog({ category: "mcp", agent: serverDraft.name, ok: true, message: `tools/call ${resolved} OK` });
    } catch (error: any) {
      setToolOutput(String(error?.message ?? error));
      props.pushLog({
        category: "mcp",
        agent: serverDraft.name,
        ok: false,
        message: "tools/call error",
        details: String(error?.message ?? error)
      });
    } finally {
      setIsCallingTool(false);
    }
  }

  function saveDraft() {
    if (!serverDraft) return;
    if (!serverDraft.sseUrl.trim()) {
      setDraftError("請先輸入 SSE URL。");
      return;
    }
    if (!draftValidated) {
      setDraftError("請先完成 Connect & List Tools，再儲存。");
      return;
    }
    const nextServer: McpServerConfig = {
      ...serverDraft,
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
          </div>
          <div style={{ ...helpText, marginTop: 8 }}>
            測試方式：
            <br />
            1. 新增一個 MCP 項目
            <br />
            2. 在 Edit 視窗中填入 SSE URL
            <br />
            3. 按下 `Connect & List Tools`
            <br />
            4. 若成功，才會出現下方 `Call Tool` 區塊
          </div>
        </HelpModal>
      ) : null}

      <div className="card" style={{ padding: 12, display: "grid", gap: 8 }}>
        <div style={{ fontWeight: 800 }}>Tool Decision Prompt</div>
        <button type="button" onClick={() => setShowPromptConfig(true)} style={btnPrimary}>
          {props.promptTemplates.activeId === "zh" ? "中文模板" : "English Template"}
        </button>
      </div>

      {showPromptConfig ? (
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
      ) : null}

      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ fontWeight: 800 }}>Active MCP servers</div>
        <button type="button" onClick={() => openEditor()} style={btnSmall} data-tutorial-id="mcp-add-button">
          + Add
        </button>
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
                  <div style={{ fontSize: 12, opacity: 0.74, marginTop: 4 }}>{server.sseUrl || "尚未設定 SSE URL"}</div>
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

            <div>
              <label style={label}>SSE URL</label>
              <input
                value={serverDraft.sseUrl}
                onChange={(e) => updateDraft({ sseUrl: e.target.value })}
                placeholder="https://your-mcp-server/mcp/sse"
                style={inp}
                data-tutorial-id="mcp-sse-url-input"
              />
            </div>

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
              {serverDraft.sseUrl.trim() ? (
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
              Note: EventSource cannot set custom headers. If your MCP server needs auth, prefer querystring token or same-site cookies. RPC is derived by replacing `/sse` with `/rpc`.
            </div>
            <div style={{ fontSize: 12, opacity: 0.7 }}>
              `toolTimeoutSecond` 會中止卡住的 RPC；`heartbeatSecond` 代表閒置超過多久後，下一次工具呼叫前先做一次 `tools/list` 存活檢查。設為 `0` 可停用 heartbeat。
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
