import React, { useState } from "react";
import { AgentConfig, BuiltInToolConfig, DetectResult, DocItem, McpServerConfig } from "../types";
import { generateId } from "../utils/id";
import HelpModal from "./HelpModal";

const ENDPOINT_PRESETS = [
  { label: "OpenAI", value: "https://api.openai.com/v1" },
  { label: "Groq", value: "https://api.groq.com/openai/v1" },
  { label: "Custom", value: "__custom__" }
];

const emptyAgent = (): AgentConfig => ({
  id: generateId(),
  name: "New Agent",
  type: "openai_compat",
  endpoint: "https://api.openai.com/v1",
  model: "gpt-4o-mini",
  capabilities: { streaming: true }
});

type RemoteModelOption = {
  id: string;
  created?: number;
  ownedBy?: string;
  contextWindow?: number;
  active?: boolean;
};

async function fetchOpenAICompatModels(agent: AgentConfig): Promise<RemoteModelOption[]> {
  const endpoint = (agent.endpoint ?? "").trim().replace(/\/$/, "");
  if (!endpoint) throw new Error("Please enter an endpoint first.");

  const res = await fetch(`${endpoint}/models`, {
    headers: {
      ...(agent.apiKey ? { Authorization: `Bearer ${agent.apiKey}` } : {}),
      ...(agent.headers ?? {})
    }
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text ? `HTTP ${res.status}: ${text}` : `HTTP ${res.status}`);
  }

  const json = await res.json();
  const data = Array.isArray(json?.data) ? json.data : [];

  return data
    .filter((item: any) => typeof item?.id === "string" && item.active !== false)
    .map(
      (item: any): RemoteModelOption => ({
        id: item.id,
        created: typeof item.created === "number" ? item.created : undefined,
        ownedBy: typeof item.owned_by === "string" ? item.owned_by : undefined,
        contextWindow: typeof item.context_window === "number" ? item.context_window : undefined,
        active: typeof item.active === "boolean" ? item.active : undefined
      })
    )
    .sort((a: RemoteModelOption, b: RemoteModelOption) => a.id.localeCompare(b.id));
}

function formatModelCreated(ts?: number) {
  if (!ts) return "—";
  try {
    return new Date(ts * 1000).toLocaleDateString();
  } catch {
    return "—";
  }
}

function formatModelOption(option: RemoteModelOption) {
  return `${option.id} · ${formatModelCreated(option.created)} · ${option.ownedBy ?? "—"} · ctx ${option.contextWindow ?? "—"}`;
}

export default function AgentsPanel(props: {
  agents: AgentConfig[];
  activeAgentId: string;
  onSelect: (id: string) => void;
  onSave: (a: AgentConfig) => void;
  onDelete: (id: string) => void;
  onDetect: (a: AgentConfig) => Promise<DetectResult>;
  docs: DocItem[];
  mcpServers: McpServerConfig[];
  builtInTools: BuiltInToolConfig[];
}) {
  const [draft, setDraft] = useState<AgentConfig | null>(null);
  const [detectResult, setDetectResult] = useState<{ agentName: string; result: DetectResult } | null>(null);
  const [detectingAgentId, setDetectingAgentId] = useState<string | null>(null);

  return (
    <div>
        <div className="agents-toolbar" style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
          <div style={{ fontWeight: 800 }}>Agents</div>
        <button onClick={() => setDraft(emptyAgent())} style={{ ...btnSmall, marginLeft: "auto" }}>
          + Add
        </button>
        </div>

        <div style={{ display: "grid", gap: 8 }}>
          {props.agents.map((a) => {
            const isActive = a.id === props.activeAgentId;
            return (
              <div
                key={a.id}
                className="agents-row"
                style={{
                  display: "flex",
                  gap: 10,
                  alignItems: "center",
                  padding: 12,
                  borderRadius: 14,
                  border: isActive ? "1px solid #5b6bff" : "1px solid #222636",
                  background: isActive ? "#13162a" : "#0f1118",
                  color: "white"
                }}
              >
                <button
                  type="button"
                  onClick={() => props.onSelect(a.id)}
                  className="agents-select"
                  style={{
                    display: "flex",
                    gap: 10,
                    alignItems: "center",
                    textAlign: "left",
                    background: "transparent",
                    border: "none",
                    color: "inherit",
                    padding: 0,
                    flex: 1,
                    cursor: "pointer"
                  }}
                >
              <AvatarPreview name={a.name} avatarUrl={a.avatarUrl} size={42} radius={14} />
              <div>
                <div style={{ fontWeight: 700 }}>{a.name}</div>
                <div style={{ fontSize: 12, opacity: 0.7 }}>
                  {a.type}
                  {a.model ? ` · ${a.model}` : ""}
                </div>
              </div>
                </button>
                {isActive ? (
                  <div className="agents-actions" style={{ display: "flex", gap: 8, marginLeft: "auto" }}>
                    <button type="button" onClick={() => setDraft(a)} style={btnSmall}>
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        setDetectingAgentId(a.id);
                        const result = await props.onDetect(a);
                        setDetectResult({ agentName: a.name, result });
                        setDetectingAgentId(null);
                      }}
                      style={btnSmall}
                      disabled={detectingAgentId === a.id}
                    >
                      {detectingAgentId === a.id ? "Detecting..." : "Detect"}
                    </button>
                    <button type="button" onClick={() => props.onDelete(a.id)} style={btnDangerSmall}>
                      Delete
                    </button>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>

      {detectResult && (
        <HelpModal title={`Detect Result: ${detectResult.agentName}`} onClose={() => setDetectResult(null)}>
          <div style={helpText}>
            Result: <strong>{detectResult.result.ok ? "Detected successfully" : "Detect failed"}</strong>
          </div>
          <div style={{ ...helpText, marginTop: 8 }}>
            Type: <code>{detectResult.result.detectedType ?? "unknown"}</code>
          </div>
          {detectResult.result.notes ? (
            <div style={{ ...helpText, marginTop: 8, whiteSpace: "pre-wrap" }}>{detectResult.result.notes}</div>
          ) : null}
        </HelpModal>
      )}

      {draft && (
        <HelpModal title={`Edit Agent: ${draft.name}`} onClose={() => setDraft(null)} width="min(860px, calc(100vw - 48px))">
          <Editor
            draft={draft}
            docs={props.docs}
            mcpServers={props.mcpServers}
            builtInTools={props.builtInTools}
            onCancel={() => setDraft(null)}
            onSave={(a) => {
              props.onSave(a);
              setDraft(null);
            }}
          />
        </HelpModal>
      )}
    </div>
  );
}

function Editor(props: {
  draft: AgentConfig;
  docs: DocItem[];
  mcpServers: McpServerConfig[];
  builtInTools: BuiltInToolConfig[];
  onCancel: () => void;
  onSave: (a: AgentConfig) => void;
}) {
  const [a, setA] = useState<AgentConfig>({ ...props.draft });
  const [showUserInfoHelp, setShowUserInfoHelp] = useState(false);
  const [remoteModels, setRemoteModels] = useState<RemoteModelOption[]>([]);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [modelLoadError, setModelLoadError] = useState<string | null>(null);
  const [useCustomModel, setUseCustomModel] = useState<boolean>(() => !(props.draft.model ?? "").trim());

  const allowAllDocs = a.allowedDocIds === undefined;
  const allowAllMcps = a.allowedMcpServerIds === undefined;
  const allowAllBuiltIns = a.allowedBuiltInToolIds === undefined;

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

  function toggleBuiltInTool(id: string) {
    const allowed = new Set(a.allowedBuiltInToolIds ?? []);
    if (allowed.has(id)) allowed.delete(id);
    else allowed.add(id);
    setA({ ...a, allowedBuiltInToolIds: Array.from(allowed) });
  }

  function onAvatarPicked(file: File | undefined) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setA((prev) => ({ ...prev, avatarUrl: reader.result as string }));
      }
    };
    reader.readAsDataURL(file);
  }

  const endpointPreset =
    a.endpoint === "https://api.openai.com/v1" || a.endpoint === "https://api.groq.com/openai/v1" ? a.endpoint : "__custom__";
  const hasListedModel = !!a.model && remoteModels.some((model) => model.id === a.model);

  React.useEffect(() => {
    if (!a.model?.trim()) {
      setUseCustomModel(true);
      return;
    }
    if (!hasListedModel) {
      setUseCustomModel(true);
    }
  }, [a.model, hasListedModel]);

  React.useEffect(() => {
    setRemoteModels([]);
    setModelLoadError(null);
  }, [a.endpoint, a.apiKey]);

  async function loadModels() {
    setIsLoadingModels(true);
    setModelLoadError(null);
    try {
      const models = await fetchOpenAICompatModels(a);
      setRemoteModels(models);
      if (a.model && models.some((model) => model.id === a.model)) {
        setUseCustomModel(false);
      }
      if (models.length === 0) {
        setModelLoadError("No active models returned.");
      }
    } catch (e: any) {
      setRemoteModels([]);
      setModelLoadError(String(e?.message ?? e));
    } finally {
      setIsLoadingModels(false);
    }
  }

  return (
    <div style={{ marginTop: 4 }}>

      <label style={label}>Name</label>
      <input value={a.name} onChange={(e) => setA({ ...a, name: e.target.value })} style={inp} />

      <label style={label}>大頭照</label>
      <div className="agents-avatar-row" style={{ display: "flex", gap: 12, alignItems: "center", margin: "6px 0 14px" }}>
        <AvatarPreview name={a.name} avatarUrl={a.avatarUrl} />
        <div style={{ display: "grid", gap: 8 }}>
          <input type="file" accept="image/*" onChange={(e) => onAvatarPicked(e.target.files?.[0])} />
          {a.avatarUrl ? (
            <button type="button" onClick={() => setA({ ...a, avatarUrl: undefined })} style={btnSmall}>
              移除大頭照
            </button>
          ) : null}
        </div>
      </div>

      <label style={label}>Agent Description</label>
      <textarea
        value={a.description ?? ""}
        onChange={(e) => setA({ ...a, description: e.target.value })}
        rows={4}
        style={{ ...inp, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}
      />

      <label style={label}>Type</label>
      <select value={a.type} onChange={(e) => setA({ ...a, type: e.target.value as any })} style={inp as any}>
        <option value="openai_compat">openai_compat</option>
        <option value="chrome_prompt">chrome_prompt</option>
        <option value="custom">custom</option>
      </select>

      {a.type === "openai_compat" && (
        <>
          <label style={label}>API Endpoint Preset</label>
          <select
            value={endpointPreset}
            onChange={(e) =>
              setA({
                ...a,
                endpoint: e.target.value === "__custom__" ? a.endpoint ?? "" : e.target.value
              })
            }
            style={inp as any}
          >
            {ENDPOINT_PRESETS.map((preset) => (
              <option key={preset.value} value={preset.value}>
                {preset.label}
              </option>
            ))}
          </select>
          <label style={label}>Endpoint</label>
          <input value={a.endpoint ?? ""} onChange={(e) => setA({ ...a, endpoint: e.target.value })} style={inp} />
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
            <label style={label}>Model</label>
            <button type="button" onClick={() => void loadModels()} style={btnSmall} disabled={isLoadingModels}>
              {isLoadingModels ? "Loading..." : "Load Models"}
            </button>
          </div>
          <select
            value={useCustomModel ? "__custom__" : a.model ?? ""}
            onChange={(e) => {
              const value = e.target.value;
              if (value === "__custom__") {
                setUseCustomModel(true);
                return;
              }
              setUseCustomModel(false);
              setA({ ...a, model: value });
            }}
            style={inp as any}
          >
            <option value="__custom__">Custom model input</option>
            {remoteModels.map((model) => (
              <option key={model.id} value={model.id}>
                {formatModelOption(model)}
              </option>
            ))}
          </select>
          {useCustomModel && <input value={a.model ?? ""} onChange={(e) => setA({ ...a, model: e.target.value })} style={inp} placeholder="Enter model id" />}
          {!useCustomModel && a.model ? (
            <div style={{ fontSize: 12, opacity: 0.78, lineHeight: 1.6, marginTop: -4, marginBottom: 10 }}>
              {formatModelOption(remoteModels.find((model) => model.id === a.model) ?? { id: a.model })}
            </div>
          ) : null}
          {modelLoadError ? (
            <div style={{ fontSize: 12, opacity: 0.8, color: "#ffb3b3", lineHeight: 1.5, marginTop: -4, marginBottom: 10 }}>
              {modelLoadError}
            </div>
          ) : null}
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
        <div style={{ display: "grid", gap: 6 }}>
          <label style={checkRow}>
            <input
              type="radio"
              name={`mcp-mode-${a.id}`}
              checked={allowAllMcps}
              onChange={() => setA({ ...a, allowedMcpServerIds: undefined })}
            />
            <span>All MCP servers</span>
          </label>
          <label style={checkRow}>
            <input
              type="radio"
              name={`mcp-mode-${a.id}`}
              checked={!allowAllMcps}
              onChange={() => setA({ ...a, allowedMcpServerIds: a.allowedMcpServerIds ?? [] })}
            />
            <span>Custom selection</span>
          </label>
        </div>
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

        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12, marginBottom: 6 }}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>Built-in Tools</div>
          <button
            type="button"
            onClick={() => setShowUserInfoHelp(true)}
            title="使用者資訊工具說明"
            aria-label="使用者資訊工具說明"
            style={helpBtn}
          >
            ?
          </button>
        </div>
        <label style={checkRow}>
          <input
            type="checkbox"
            checked={!!a.allowUserProfileTool}
            onChange={(e) => setA({ ...a, allowUserProfileTool: e.target.checked })}
          />
          <span>Allow user info tool</span>
        </label>

        <div style={{ fontSize: 12, opacity: 0.7, marginTop: 12, marginBottom: 6 }}>Custom JS Tools</div>
        <div style={{ display: "grid", gap: 6 }}>
          <label style={checkRow}>
            <input
              type="radio"
              name={`builtin-mode-${a.id}`}
              checked={allowAllBuiltIns}
              onChange={() => setA({ ...a, allowedBuiltInToolIds: undefined })}
            />
            <span>All custom JS tools</span>
          </label>
          <label style={checkRow}>
            <input
              type="radio"
              name={`builtin-mode-${a.id}`}
              checked={!allowAllBuiltIns}
              onChange={() => setA({ ...a, allowedBuiltInToolIds: a.allowedBuiltInToolIds ?? [] })}
            />
            <span>Custom selection</span>
          </label>
        </div>
        {!allowAllBuiltIns && (
          <div style={{ display: "grid", gap: 6, marginTop: 6 }}>
            {props.builtInTools.length === 0 && <div style={{ fontSize: 12, opacity: 0.7 }}>No custom JS tools yet.</div>}
            {props.builtInTools.map((tool) => (
              <label key={tool.id} style={checkRow}>
                <input
                  type="checkbox"
                  checked={a.allowedBuiltInToolIds?.includes(tool.id) ?? false}
                  onChange={() => toggleBuiltInTool(tool.id)}
                />
                <span>{tool.name}</span>
              </label>
            ))}
          </div>
        )}

        {showUserInfoHelp && (
          <HelpModal title="使用者資訊工具說明與測試方式" onClose={() => setShowUserInfoHelp(false)}>
            <div style={helpText}>
              這個 built-in tool 會讓 agent 讀取目前使用者在 <strong>Profile</strong> 頁填寫的資訊。
              目前會回傳使用者名稱、自我描述，以及是否有設定大頭照。
            </div>
            <div style={{ ...helpText, marginTop: 8 }}>
              使用方式：
              <br />
              1. 到 <strong>Profile</strong> 填入名稱、自我描述，必要時也可設定大頭照
              <br />
              2. 在 <strong>Agents</strong> 頁面替目標 agent 勾選 <strong>Allow user info tool</strong>
              <br />
              3. 回到 <strong>Chat</strong>，詢問像是 <code>我是誰？</code>、<code>你知道我的偏好嗎？</code> 這類問題
              <br />
              4. 如果 agent 決定呼叫這個工具，最後回覆就能根據你已儲存的個人資料回答，並附上可展開的 tool result 區塊
            </div>
          </HelpModal>
        )}
      </div>

      <div className="agents-editor-actions" style={{ display: "flex", gap: 8, marginTop: 10 }}>
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

function AvatarPreview(props: { name: string; avatarUrl?: string; size?: number; radius?: number }) {
  const size = props.size ?? 60;
  const radius = props.radius ?? 18;
  if (props.avatarUrl) {
    return (
      <img
        src={props.avatarUrl}
        alt={props.name}
        style={{ width: size, height: size, borderRadius: radius, objectFit: "cover", border: "1px solid #2b3348" }}
      />
    );
  }

  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        border: "1px solid #2b3348",
        display: "grid",
        placeItems: "center",
        background: "linear-gradient(135deg, rgba(91, 123, 255, 0.22), rgba(77, 208, 225, 0.15))",
        fontWeight: 800,
        fontSize: Math.max(14, Math.round(size * 0.4))
      }}
    >
      {(props.name || "?").trim().charAt(0).toUpperCase()}
    </div>
  );
}

const label: React.CSSProperties = { fontSize: 12, opacity: 0.8 };

const inp: React.CSSProperties = {
  width: "100%",
  margin: "6px 0 10px",
  padding: "8px 10px",
  borderRadius: 12,
  border: "1px solid var(--border)",
  background: "var(--bg-2)",
  color: "var(--text)"
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
  border: "1px solid #4a2026",
  background: "#1d1014"
};

const helpBtn: React.CSSProperties = {
  width: 24,
  height: 24,
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

const btn: React.CSSProperties = {
  padding: "8px 10px",
  borderRadius: 12,
  border: "1px solid var(--border)",
  background: "var(--bg-2)",
  color: "var(--text)",
  width: "100%"
};

const btnPrimary: React.CSSProperties = {
  ...btn,
  background: "var(--primary)",
  border: "1px solid var(--primary)",
  color: "#0b0e14"
};

const checkRow: React.CSSProperties = {
  display: "flex",
  gap: 8,
  alignItems: "center",
  fontSize: 12
};
