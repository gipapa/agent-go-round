import React, { useEffect, useState } from "react";
import { AgentConfig, BuiltInToolConfig, DetectResult, DocItem, LoadBalancerConfig, McpServerConfig, SkillConfig } from "../types";
import { generateId } from "../utils/id";
import HelpModal from "./HelpModal";

const emptyAgent = (): AgentConfig => ({
  id: generateId(),
  name: "New Agent",
  type: "openai_compat",
  loadBalancerId: "",
  enableDocs: false,
  enableMcp: false,
  enableBuiltInTools: false,
  enableSkills: false,
  allowUserProfileTool: false,
  allowAgentDirectoryTool: false,
  capabilities: { streaming: true }
});

export default function AgentsPanel(props: {
  agents: AgentConfig[];
  activeAgentId: string;
  selectedAgentId: string;
  onSelect: (id: string) => void;
  onSetMain: (id: string) => void;
  onSave: (a: AgentConfig) => void;
  onDelete: (id: string) => void;
  onDetect: (a: AgentConfig) => Promise<DetectResult>;
  docs: DocItem[];
  mcpServers: McpServerConfig[];
  builtInTools: BuiltInToolConfig[];
  skills: SkillConfig[];
  loadBalancers: LoadBalancerConfig[];
  lockToMcpOnly?: boolean;
}) {
  const [draft, setDraft] = useState<AgentConfig | null>(null);
  const [detectResult, setDetectResult] = useState<{ agentName: string; result: DetectResult } | null>(null);
  const [detectingAgentId, setDetectingAgentId] = useState<string | null>(null);

  useEffect(() => {
    if (props.selectedAgentId && props.agents.some((agent) => agent.id === props.selectedAgentId)) return;
    if (props.activeAgentId) {
      props.onSelect(props.activeAgentId);
      return;
    }
    const fallback = props.agents[0]?.id;
    if (fallback) props.onSelect(fallback);
  }, [props.selectedAgentId, props.activeAgentId, props.agents, props.onSelect]);

  return (
    <div>
      <div className="agents-toolbar" style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
        <div style={{ fontWeight: 800, fontSize: 18 }}>Agents</div>
        <button onClick={() => setDraft(emptyAgent())} style={{ ...btnSmall, marginLeft: "auto" }} data-tutorial-id="agents-add-button">
          + Add
        </button>
      </div>

      <div style={{ display: "grid", gap: 8 }}>
        {props.agents.map((agent) => {
          const isActive = agent.id === props.activeAgentId;
          const isSelected = agent.id === props.selectedAgentId;
          const isManagedMagiAgent = agent.managedBy === "magi" && !!agent.managedUnitId;
          const loadBalancer = props.loadBalancers.find((item) => item.id === agent.loadBalancerId) ?? null;
          return (
            <div
              key={agent.id}
              className="agents-row"
              style={{
                display: "flex",
                gap: 10,
                alignItems: "center",
                padding: 12,
                borderRadius: 14,
                border: isSelected ? "1px solid #5b6bff" : isActive ? "1px solid rgba(91,123,255,0.2)" : "1px solid #222636",
                background: isSelected ? "#13162a" : isActive ? "#111522" : "#0f1118",
                color: "white"
              }}
              data-tutorial-id={isActive ? "agents-active-row" : undefined}
            >
              <button
                type="button"
                onClick={() => props.onSelect(agent.id)}
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
                <AvatarPreview name={agent.name} avatarUrl={agent.avatarUrl} size={42} radius={14} />
                <div>
                  <div style={{ fontWeight: 700 }}>{agent.name}</div>
                  <div style={{ fontSize: 12, opacity: 0.7 }}>{loadBalancer?.name ?? "No load balancer"}</div>
                </div>
              </button>
              {isSelected ? (
                <div className="agents-actions" style={{ display: "flex", gap: 8, marginLeft: "auto" }}>
                  <button
                    type="button"
                    onClick={() => setDraft(agent)}
                    style={btnSmall}
                    data-tutorial-id={isActive ? "agents-edit-active-button" : undefined}
                  >
                    Edit
                  </button>
                  {!isManagedMagiAgent ? (
                    <>
                      <button
                        type="button"
                        onClick={async () => {
                          setDetectingAgentId(agent.id);
                          const result = await props.onDetect(agent);
                          setDetectResult({ agentName: agent.name, result });
                          setDetectingAgentId(null);
                        }}
                        style={btnSmall}
                        disabled={detectingAgentId === agent.id}
                      >
                        {detectingAgentId === agent.id ? "Detecting..." : "Detect"}
                      </button>
                      <button type="button" onClick={() => props.onDelete(agent.id)} style={btnDangerSmall}>
                        Delete
                      </button>
                      <button
                        type="button"
                        onClick={() => props.onSetMain(agent.id)}
                        style={{
                          ...btnSmall,
                          borderColor: isActive ? "#5b6bff" : "#2a395f",
                          background: isActive ? "rgba(91,123,255,0.18)" : "#141b2d",
                          color: isActive ? "#dfe6ff" : "white",
                          cursor: isActive ? "default" : "pointer"
                        }}
                        disabled={isActive}
                        data-tutorial-id={isActive ? "agents-main-active-button" : "agents-set-main-button"}
                      >
                        Main
                      </button>
                    </>
                  ) : null}
                </div>
              ) : isActive ? (
                <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
                  <button
                    type="button"
                    style={{
                      ...btnSmall,
                      borderColor: "#5b6bff",
                      background: "rgba(91,123,255,0.18)",
                      color: "#dfe6ff",
                      cursor: "default"
                    }}
                    disabled
                    data-tutorial-id="agents-main-active-button"
                  >
                    Main
                  </button>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      {detectResult ? (
        <HelpModal title={`Detect Result: ${detectResult.agentName}`} onClose={() => setDetectResult(null)}>
          <div style={helpText}>
            Result: <strong>{detectResult.result.ok ? "Detected successfully" : "Detect failed"}</strong>
          </div>
          <div style={{ ...helpText, marginTop: 8 }}>
            Type: <code>{detectResult.result.detectedType ?? "unknown"}</code>
          </div>
          {detectResult.result.notes ? <div style={{ ...helpText, marginTop: 8, whiteSpace: "pre-wrap" }}>{detectResult.result.notes}</div> : null}
        </HelpModal>
      ) : null}

      {draft ? (
        <HelpModal title={`Edit Agent: ${draft.name}`} onClose={() => setDraft(null)} width="min(860px, calc(100vw - 48px))" footer={null}>
          <Editor
            draft={draft}
            docs={props.docs}
            mcpServers={props.mcpServers}
            builtInTools={props.builtInTools}
            skills={props.skills}
            loadBalancers={props.loadBalancers}
            lockToMcpOnly={props.lockToMcpOnly}
            onCancel={() => setDraft(null)}
            onSave={(agent) => {
              props.onSave(agent);
              setDraft(null);
            }}
          />
        </HelpModal>
      ) : null}
    </div>
  );
}

function Editor(props: {
  draft: AgentConfig;
  docs: DocItem[];
  mcpServers: McpServerConfig[];
  builtInTools: BuiltInToolConfig[];
  skills: SkillConfig[];
  loadBalancers: LoadBalancerConfig[];
  lockToMcpOnly?: boolean;
  onCancel: () => void;
  onSave: (a: AgentConfig) => void;
}) {
  const [agent, setAgent] = useState<AgentConfig>({ ...props.draft });
  const [showUserInfoHelp, setShowUserInfoHelp] = useState(false);
  const systemBuiltInTools = props.builtInTools.filter((tool) => tool.source === "system");
  const customBuiltInTools = props.builtInTools.filter((tool) => tool.source !== "system");

  const allowAllDocs = agent.allowedDocIds === undefined;
  const allowAllMcps = agent.allowedMcpServerIds === undefined;
  const allowAllBuiltIns = agent.allowedBuiltInToolIds === undefined;
  const allowAllSkills = agent.allowedSkillIds === undefined;
  const isManagedMagiAgent = agent.managedBy === "magi" && !!agent.managedUnitId;
  const docsEnabled = agent.enableDocs !== false;
  const mcpEnabled = agent.enableMcp !== false;
  const builtInToolsEnabled = agent.enableBuiltInTools !== false;
  const skillsEnabled = agent.enableSkills === true;
  const accessLockedToMcpOnly = props.lockToMcpOnly === true;
  const accessLockedBySkills = skillsEnabled;

  function toggleDoc(id: string) {
    const allowed = new Set(agent.allowedDocIds ?? []);
    if (allowed.has(id)) allowed.delete(id);
    else allowed.add(id);
    setAgent({ ...agent, allowedDocIds: Array.from(allowed) });
  }

  function toggleMcp(id: string) {
    const allowed = new Set(agent.allowedMcpServerIds ?? []);
    if (allowed.has(id)) allowed.delete(id);
    else allowed.add(id);
    setAgent({ ...agent, allowedMcpServerIds: Array.from(allowed) });
  }

  function toggleBuiltInTool(id: string) {
    const allowed = new Set(agent.allowedBuiltInToolIds ?? []);
    if (allowed.has(id)) allowed.delete(id);
    else allowed.add(id);
    setAgent({ ...agent, allowedBuiltInToolIds: Array.from(allowed) });
  }

  function toggleSkill(id: string) {
    const allowed = new Set(agent.allowedSkillIds ?? []);
    if (allowed.has(id)) allowed.delete(id);
    else allowed.add(id);
    setAgent({ ...agent, allowedSkillIds: Array.from(allowed) });
  }

  function onAvatarPicked(file: File | undefined) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setAgent((prev) => ({ ...prev, avatarUrl: reader.result as string }));
      }
    };
    reader.readAsDataURL(file);
  }

  React.useEffect(() => {
    if (!skillsEnabled) return;
    setAgent((prev) => {
      if (
        prev.enableDocs !== true ||
        prev.enableMcp !== true ||
        prev.enableBuiltInTools !== true ||
        prev.allowedDocIds !== undefined ||
        prev.allowedMcpServerIds !== undefined ||
        prev.allowedBuiltInToolIds !== undefined
      ) {
        return {
          ...prev,
          enableDocs: true,
          enableMcp: true,
          enableBuiltInTools: true,
          allowedDocIds: undefined,
          allowedMcpServerIds: undefined,
          allowedBuiltInToolIds: undefined
        };
      }
      return prev;
    });
  }, [skillsEnabled]);

  React.useEffect(() => {
    if (!accessLockedToMcpOnly) return;
    setAgent((prev) => {
      const next: AgentConfig = {
        ...prev,
        enableDocs: false,
        enableBuiltInTools: false,
        enableSkills: false,
        allowedDocIds: [],
        allowedBuiltInToolIds: [],
        allowedSkillIds: []
      };
      const changed =
        prev.enableDocs !== false ||
        prev.enableBuiltInTools !== false ||
        prev.enableSkills !== false ||
        prev.allowedDocIds === undefined ||
        prev.allowedBuiltInToolIds === undefined ||
        prev.allowedSkillIds === undefined;
      return changed ? next : prev;
    });
  }, [accessLockedToMcpOnly]);

  return (
    <div style={{ marginTop: 4 }} data-tutorial-id="agent-edit-modal">
      <div className="card" style={{ padding: 14, display: "grid", gap: 10 }}>
        <div style={{ fontWeight: 700, marginBottom: 2 }}>Profile</div>

        {isManagedMagiAgent ? (
          <div style={{ ...helpText, marginBottom: 8 }}>
            這是由 S.C. MAGI 內建管理的 agent。除 <strong>Load Balancer</strong> 外，其餘欄位都已鎖定。
          </div>
        ) : null}

        <label style={label}>Name</label>
        <input value={agent.name} disabled={isManagedMagiAgent} onChange={(e) => setAgent({ ...agent, name: e.target.value })} style={inp} data-tutorial-id="agent-name-input" />

        <label style={label}>大頭照</label>
        <div className="agents-avatar-row" style={{ display: "flex", gap: 12, alignItems: "center", margin: "6px 0 14px" }}>
          <AvatarPreview name={agent.name} avatarUrl={agent.avatarUrl} />
          <div style={{ display: "grid", gap: 8 }}>
            <input type="file" accept="image/*" disabled={isManagedMagiAgent} onChange={(e) => onAvatarPicked(e.target.files?.[0])} />
            {agent.avatarUrl ? (
              <button type="button" onClick={() => setAgent({ ...agent, avatarUrl: undefined })} style={btnSmall} disabled={isManagedMagiAgent}>
                移除大頭照
              </button>
            ) : null}
          </div>
        </div>

        <label style={label}>Agent Description</label>
        <textarea
          value={agent.description ?? ""}
          disabled={isManagedMagiAgent}
          onChange={(e) => setAgent({ ...agent, description: e.target.value })}
          rows={4}
          style={{ ...inp, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}
        />

        <label style={label}>Load Balancer</label>
        <select
          value={agent.loadBalancerId ?? ""}
          onChange={(e) => setAgent({ ...agent, loadBalancerId: e.target.value })}
          style={inp as React.CSSProperties}
          data-tutorial-id="agent-load-balancer-select"
        >
          <option value="">Select load balancer</option>
          {props.loadBalancers.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
        <div style={{ fontSize: 12, opacity: 0.75, lineHeight: 1.6 }}>
          Agent 會透過這個 load balancer 決定 provider、key、model 與 failover/retry 行為。
        </div>
      </div>

      {!isManagedMagiAgent ? (
      <div style={{ marginTop: 12 }}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>Access Control</div>
        <div style={{ display: "grid", gap: 12 }}>
          <div className="card" style={{ padding: 14, display: "grid", gap: 10 }} data-tutorial-id="agent-access-skills-section">
            <label style={sectionToggleRow}>
              <input
                type="checkbox"
                checked={skillsEnabled}
                disabled={accessLockedToMcpOnly}
                onChange={(e) =>
                  setAgent({
                    ...agent,
                    enableSkills: e.target.checked,
                    allowedSkillIds: e.target.checked ? undefined : []
                  })
                }
                data-tutorial-id="agent-access-skills-toggle"
              />
              <div>
                <div style={sectionTitle}>Skills</div>
                <div style={sectionHint}>
                  {accessLockedToMcpOnly
                    ? "這個教學步驟只允許 MCP 權限，Skills 已暫時鎖定為關閉。"
                    : "勾選後會先做 skill decision；同時會強制開啟 Docs、MCP 與 Built-in Tools 的全部存取。"}
                </div>
              </div>
            </label>
            {skillsEnabled ? (
              <>
                <div style={{ display: "grid", gap: 6 }}>
                  <label style={checkRow}>
                    <input type="radio" name={`skills-mode-${agent.id}`} checked={allowAllSkills} disabled={accessLockedToMcpOnly} onChange={() => setAgent({ ...agent, allowedSkillIds: undefined })} data-tutorial-id="agent-access-skills-all" />
                    <span>All skills</span>
                  </label>
                  <label style={checkRow}>
                    <input type="radio" name={`skills-mode-${agent.id}`} checked={!allowAllSkills} disabled={accessLockedToMcpOnly} onChange={() => setAgent({ ...agent, allowedSkillIds: agent.allowedSkillIds ?? [] })} data-tutorial-id="agent-access-skills-custom" />
                    <span>Custom selection</span>
                  </label>
                </div>
                {!allowAllSkills ? (
                  <div style={{ display: "grid", gap: 6 }}>
                    {props.skills.length === 0 ? <div style={{ fontSize: 12, opacity: 0.7 }}>No skills yet.</div> : null}
                    {props.skills.map((skill) => (
                      <label key={skill.id} style={checkRow}>
                        <input type="checkbox" checked={agent.allowedSkillIds?.includes(skill.id) ?? false} disabled={accessLockedToMcpOnly} onChange={() => toggleSkill(skill.id)} />
                        <span>{skill.name}</span>
                      </label>
                    ))}
                  </div>
                ) : null}
              </>
            ) : null}
          </div>

          <div className="card" style={{ padding: 14, display: "grid", gap: 10 }} data-tutorial-id="agent-access-docs-section">
            <label style={sectionToggleRow}>
              <input
                type="checkbox"
                checked={docsEnabled}
                disabled={accessLockedBySkills || accessLockedToMcpOnly}
                onChange={(e) =>
                  setAgent({
                    ...agent,
                    enableDocs: e.target.checked,
                    allowedDocIds: e.target.checked ? undefined : agent.allowedDocIds
                  })
                }
                data-tutorial-id="agent-access-docs-toggle"
              />
              <div>
                <div style={sectionTitle}>Docs</div>
                <div style={sectionHint}>
                  {accessLockedToMcpOnly
                    ? "這個教學步驟只允許 MCP 權限，Docs 已暫時鎖定為關閉。"
                    : accessLockedBySkills
                    ? "Skills 已啟用：Docs 已強制允許全部，且暫時不可修改。"
                    : "勾選後預設可使用全部文件；若需要可改成只允許特定文件。"}
                </div>
              </div>
            </label>
            {docsEnabled ? (
              <>
                <div style={{ display: "grid", gap: 6 }}>
                  <label style={checkRow}>
                    <input type="radio" name={`docs-mode-${agent.id}`} checked={allowAllDocs} disabled={accessLockedBySkills || accessLockedToMcpOnly} onChange={() => setAgent({ ...agent, allowedDocIds: undefined })} data-tutorial-id="agent-access-docs-all" />
                    <span>All docs</span>
                  </label>
                  <label style={checkRow}>
                    <input type="radio" name={`docs-mode-${agent.id}`} checked={!allowAllDocs} disabled={accessLockedBySkills || accessLockedToMcpOnly} onChange={() => setAgent({ ...agent, allowedDocIds: agent.allowedDocIds ?? [] })} data-tutorial-id="agent-access-docs-custom" />
                    <span>Custom selection</span>
                  </label>
                </div>
                {!allowAllDocs ? (
                  <div style={{ display: "grid", gap: 6 }}>
                    {props.docs.length === 0 ? <div style={{ fontSize: 12, opacity: 0.7 }}>No docs yet.</div> : null}
                    {props.docs.map((doc) => (
                      <label key={doc.id} style={checkRow}>
                        <input type="checkbox" checked={agent.allowedDocIds?.includes(doc.id) ?? false} disabled={accessLockedBySkills || accessLockedToMcpOnly} onChange={() => toggleDoc(doc.id)} />
                        <span>{doc.title}</span>
                      </label>
                    ))}
                  </div>
                ) : null}
              </>
            ) : null}
          </div>

          <div className="card" style={{ padding: 14, display: "grid", gap: 10 }} data-tutorial-id="agent-access-mcp-section">
            <label style={sectionToggleRow}>
              <input
                type="checkbox"
                checked={mcpEnabled}
                disabled={accessLockedBySkills}
                onChange={(e) =>
                  setAgent({
                    ...agent,
                    enableMcp: e.target.checked,
                    allowedMcpServerIds: e.target.checked ? undefined : agent.allowedMcpServerIds
                  })
                }
                data-tutorial-id="agent-access-mcp-toggle"
              />
              <div>
                <div style={sectionTitle}>MCP Tools</div>
                <div style={sectionHint}>
                  {accessLockedToMcpOnly
                    ? "這個教學步驟請只開啟 MCP 權限，其他權限都會維持關閉。"
                    : accessLockedBySkills
                    ? "Skills 已啟用：MCP 已強制允許全部，且暫時不可修改。"
                    : "勾選後預設可使用全部 MCP servers；若需要可改成只允許特定 server。"}
                </div>
              </div>
            </label>
            {mcpEnabled ? (
              <>
                <div style={{ display: "grid", gap: 6 }}>
                  <label style={checkRow}>
                    <input type="radio" name={`mcp-mode-${agent.id}`} checked={allowAllMcps} disabled={accessLockedBySkills} onChange={() => setAgent({ ...agent, allowedMcpServerIds: undefined })} data-tutorial-id="agent-access-mcp-all" />
                    <span>All MCP servers</span>
                  </label>
                  <label style={checkRow}>
                    <input type="radio" name={`mcp-mode-${agent.id}`} checked={!allowAllMcps} disabled={accessLockedBySkills} onChange={() => setAgent({ ...agent, allowedMcpServerIds: agent.allowedMcpServerIds ?? [] })} data-tutorial-id="agent-access-mcp-custom" />
                    <span>Custom selection</span>
                  </label>
                </div>
                {!allowAllMcps ? (
                  <div style={{ display: "grid", gap: 6 }}>
                    {props.mcpServers.length === 0 ? <div style={{ fontSize: 12, opacity: 0.7 }}>No MCP servers yet.</div> : null}
                    {props.mcpServers.map((server) => (
                      <label key={server.id} style={checkRow}>
                        <input type="checkbox" checked={agent.allowedMcpServerIds?.includes(server.id) ?? false} disabled={accessLockedBySkills} onChange={() => toggleMcp(server.id)} />
                        <span>{server.name}</span>
                      </label>
                    ))}
                  </div>
                ) : null}
              </>
            ) : null}
          </div>

          <div className="card" style={{ padding: 14, display: "grid", gap: 10 }} data-tutorial-id="agent-access-builtins-section">
            <label style={sectionToggleRow}>
              <input
                type="checkbox"
                checked={builtInToolsEnabled}
                disabled={accessLockedBySkills || accessLockedToMcpOnly}
                onChange={(e) =>
                  setAgent({
                    ...agent,
                    enableBuiltInTools: e.target.checked,
                    allowedBuiltInToolIds: e.target.checked ? undefined : agent.allowedBuiltInToolIds
                  })
                }
                data-tutorial-id="agent-access-builtins-toggle"
              />
              <div>
                <div style={sectionTitle}>Built-in Tools</div>
                <div style={sectionHint}>
                  {accessLockedToMcpOnly
                    ? "這個教學步驟只允許 MCP 權限，Built-in Tools 已暫時鎖定為關閉。"
                    : accessLockedBySkills
                    ? "Skills 已啟用：Built-in Tools 已強制允許全部，且暫時不可修改。"
                    : "勾選後預設可使用全部 Built-in Tools；若需要可改成只允許特定工具。"}
                </div>
              </div>
            </label>
            {builtInToolsEnabled ? (
              <>
                <div style={{ display: "grid", gap: 6 }}>
                  <label style={checkRow}>
                    <input type="radio" name={`builtins-mode-${agent.id}`} checked={allowAllBuiltIns} disabled={accessLockedBySkills || accessLockedToMcpOnly} onChange={() => setAgent({ ...agent, allowedBuiltInToolIds: undefined })} data-tutorial-id="agent-access-builtins-all" />
                    <span>All built-in tools</span>
                  </label>
                  <label style={checkRow}>
                    <input type="radio" name={`builtins-mode-${agent.id}`} checked={!allowAllBuiltIns} disabled={accessLockedBySkills || accessLockedToMcpOnly} onChange={() => setAgent({ ...agent, allowedBuiltInToolIds: agent.allowedBuiltInToolIds ?? [] })} data-tutorial-id="agent-access-builtins-custom" />
                    <span>Custom selection</span>
                  </label>
                </div>
                {!allowAllBuiltIns ? (
                  <div style={{ display: "grid", gap: 6 }}>
                    {props.builtInTools.length === 0 ? <div style={{ fontSize: 12, opacity: 0.7 }}>No built-in tools yet.</div> : null}
                    {systemBuiltInTools.length > 0 ? (
                      <div style={{ display: "grid", gap: 6 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <div style={sectionTitle}>系統工具</div>
                          <button type="button" onClick={() => setShowUserInfoHelp(true)} style={miniInfoBtn}>
                            ?
                          </button>
                        </div>
                        {systemBuiltInTools.map((tool) => (
                          <label key={tool.id} style={checkRow}>
                            <input
                              type="checkbox"
                              checked={agent.allowedBuiltInToolIds?.includes(tool.id) ?? false}
                              disabled={accessLockedBySkills || accessLockedToMcpOnly}
                              onChange={() => toggleBuiltInTool(tool.id)}
                            />
                            <span>{tool.displayLabel ?? tool.name}</span>
                          </label>
                        ))}
                      </div>
                    ) : null}
                    {customBuiltInTools.length > 0 ? (
                      <div style={{ display: "grid", gap: 6 }}>
                        <div style={sectionTitle}>自訂工具</div>
                        {customBuiltInTools.map((tool) => (
                          <label key={tool.id} style={checkRow}>
                            <input
                              type="checkbox"
                              checked={agent.allowedBuiltInToolIds?.includes(tool.id) ?? false}
                              disabled={accessLockedBySkills || accessLockedToMcpOnly}
                              onChange={() => toggleBuiltInTool(tool.id)}
                            />
                            <span>{tool.displayLabel ?? tool.name}</span>
                          </label>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </>
            ) : null}
          </div>
        </div>
      </div>
      ) : null}

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 14 }}>
        <button onClick={props.onCancel} style={btnSmall}>
          Close
        </button>
        <button onClick={() => props.onSave({ ...agent, name: agent.name.trim() || "New Agent" })} style={btnPrimary} data-tutorial-id="agent-save-button">
          Save
        </button>
      </div>

      {showUserInfoHelp ? (
        <HelpModal title="系統工具說明" onClose={() => setShowUserInfoHelp(false)}>
          <div style={helpText}>
            `get_user_profile` 會讀取 `Profile` 頁中的名稱、自我描述與大頭照資訊。
          </div>
          <div style={{ ...helpText, marginTop: 8 }}>
            `pick_best_saved_agent_for_question` 會根據你目前已儲存的 agents 名稱與描述，幫模型推測最適合接這個問題的 agent。
          </div>
        </HelpModal>
      ) : null}
    </div>
  );
}

function AvatarPreview(props: { name: string; avatarUrl?: string; size?: number; radius?: number }) {
  const initials = (props.name || "?")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "?";
  const size = props.size ?? 56;
  const radius = props.radius ?? 18;
  return props.avatarUrl ? (
    <img src={props.avatarUrl} alt={props.name || "Agent avatar"} style={{ width: size, height: size, borderRadius: radius, objectFit: "cover", border: "1px solid var(--border)" }} />
  ) : (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        display: "grid",
        placeItems: "center",
        fontWeight: 800,
        background: "linear-gradient(135deg, rgba(91,123,255,0.32), rgba(33,197,255,0.16))",
        border: "1px solid rgba(91,123,255,0.35)"
      }}
    >
      {initials}
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
  color: "var(--text)",
  boxSizing: "border-box"
};

const btnSmall: React.CSSProperties = {
  padding: "10px 14px",
  borderRadius: 10,
  border: "1px solid var(--border)",
  background: "var(--bg-2)",
  color: "var(--text)",
  fontWeight: 700,
  cursor: "pointer"
};

const btnDangerSmall: React.CSSProperties = {
  ...btnSmall,
  border: "1px solid rgba(255, 107, 129, 0.4)",
  color: "#ff9aa9"
};

const btnPrimary: React.CSSProperties = {
  ...btnSmall,
  border: "1px solid rgba(91,123,255,0.45)",
  background: "rgba(91,123,255,0.14)"
};

const sectionToggleRow: React.CSSProperties = {
  display: "flex",
  gap: 10,
  alignItems: "flex-start"
};

const sectionTitle: React.CSSProperties = {
  fontWeight: 700
};

const sectionHint: React.CSSProperties = {
  fontSize: 12,
  opacity: 0.7,
  lineHeight: 1.6
};

const checkRow: React.CSSProperties = {
  display: "flex",
  gap: 8,
  alignItems: "center"
};

const miniInfoBtn: React.CSSProperties = {
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
