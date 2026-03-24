import React from "react";
import { AgentConfig, BuiltInToolConfig, McpServerConfig, McpTool, SkillConfig, SkillDocItem, SkillExecutionMode, SkillFileItem } from "../types";
import HelpModal from "./HelpModal";

type EditableSkillFileDraft = {
  key: string;
  kind: "reference" | "asset";
  path: string;
  content: string;
  originalFullPath?: string;
};

function folderName(kind: "reference" | "asset") {
  return kind === "reference" ? "references" : "assets";
}

function toRelativePath(skill: SkillConfig, file: SkillFileItem & { kind: "reference" | "asset" }) {
  const prefix = `${skill.rootPath}/${folderName(file.kind)}/`;
  return file.path.startsWith(prefix) ? file.path.slice(prefix.length) : file.path;
}

function buildDrafts(skill: SkillConfig, files: SkillFileItem[]) {
  return files
    .filter((file): file is SkillFileItem & { kind: "reference" | "asset" } => file.kind === "reference" || file.kind === "asset")
    .map(
      (file) =>
        ({
          key: file.id,
          kind: file.kind,
          path: toRelativePath(skill, file),
          content: file.content,
          originalFullPath: file.path
        }) satisfies EditableSkillFileDraft
    );
}

export default function SkillsPanel(props: {
  skills: SkillConfig[];
  selectedId: string | null;
  selectedDocs: SkillDocItem[];
  selectedFiles: SkillFileItem[];
  agents: AgentConfig[];
  activeAgentId: string;
  executionMode: SkillExecutionMode;
  verifyMax: number;
  toolLoopMax: number;
  verifierAgentId: string;
  builtInTools: BuiltInToolConfig[];
  mcpToolCatalog: Array<{ server: McpServerConfig; tools: McpTool[] }>;
  onChangeExecutionMode: (mode: SkillExecutionMode) => void;
  onChangeVerifyMax: (value: number) => void;
  onChangeToolLoopMax: (value: number) => void;
  onChangeVerifierAgentId: (value: string) => void;
  onSelect: (id: string | null) => void;
  onImport: (file: File) => Promise<void>;
  onCreateEmpty: (name: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onExport: (id: string) => Promise<void>;
  onUpdateSkillMarkdown: (id: string, markdown: string) => Promise<void>;
  onUpsertTextFile: (skillId: string, path: string, kind: "reference" | "asset", content: string) => Promise<void>;
  onDeleteTextFile: (skillId: string, path: string) => Promise<void>;
}) {
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const [showHelp, setShowHelp] = React.useState(false);
  const [showToolHelp, setShowToolHelp] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [editingSkillId, setEditingSkillId] = React.useState<string | null>(null);
  const [skillMarkdownDraft, setSkillMarkdownDraft] = React.useState("");
  const [editableFiles, setEditableFiles] = React.useState<EditableSkillFileDraft[]>([]);

  const selectedSkill = props.skills.find((skill) => skill.id === props.selectedId) ?? props.skills[0] ?? null;
  const editingSkill = props.skills.find((skill) => skill.id === editingSkillId) ?? null;

  React.useEffect(() => {
    if (!selectedSkill && props.selectedId) {
      props.onSelect(null);
    }
    if (!props.selectedId && props.skills[0]) {
      props.onSelect(props.skills[0].id);
    }
  }, [props.selectedId, props.skills, props.onSelect, selectedSkill]);

  React.useEffect(() => {
    if (!editingSkill) return;
    setEditableFiles(buildDrafts(editingSkill, props.selectedFiles));
  }, [editingSkill, props.selectedFiles]);

  async function onPickFile(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      await props.onImport(file);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function onCreateEmptySkill() {
    const name = window.prompt("請輸入 skill 名稱", "New Skill");
    if (!name?.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await props.onCreateEmpty(name.trim());
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  async function onDeleteSkill(skillId: string) {
    setBusy(true);
    setError(null);
    try {
      await props.onDelete(skillId);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  async function onExportSkill(skillId: string) {
    setBusy(true);
    setError(null);
    try {
      await props.onExport(skillId);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  function openEdit(skill: SkillConfig) {
    setEditingSkillId(skill.id);
    setSkillMarkdownDraft(skill.skillMarkdown);
    setEditableFiles(buildDrafts(skill, props.selectedFiles));
  }

  function addEditableFile(kind: "reference" | "asset") {
    setEditableFiles((current) => [
      ...current,
      {
        key: `${kind}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
        kind,
        path: "",
        content: ""
      }
    ]);
  }

  function updateEditableFile(key: string, patch: Partial<EditableSkillFileDraft>) {
    setEditableFiles((current) => current.map((item) => (item.key === key ? { ...item, ...patch } : item)));
  }

  function removeEditableFile(key: string) {
    setEditableFiles((current) => current.filter((item) => item.key !== key));
  }

  async function onSaveSkill() {
    if (!editingSkill) return;
    const normalizedFiles = editableFiles.map((item) => ({
      ...item,
      path: item.path.trim().replace(/^\/+/, "")
    }));
    const invalidFile = normalizedFiles.find((item) => !item.path);
    if (invalidFile) {
      setError("references / assets 的檔名不能為空。");
      return;
    }

    const seen = new Set<string>();
    for (const item of normalizedFiles) {
      const fullPath = `${editingSkill.rootPath}/${folderName(item.kind)}/${item.path}`;
      if (seen.has(fullPath)) {
        setError(`檔案路徑重複：${fullPath}`);
        return;
      }
      seen.add(fullPath);
    }

    setBusy(true);
    setError(null);
    try {
      await props.onUpdateSkillMarkdown(editingSkill.id, skillMarkdownDraft);

      const nextFullPaths = new Set(normalizedFiles.map((item) => `${editingSkill.rootPath}/${folderName(item.kind)}/${item.path}`));
      const existingEditable = props.selectedFiles.filter((file) => file.kind === "reference" || file.kind === "asset");

      for (const file of existingEditable) {
        if (!nextFullPaths.has(file.path)) {
          await props.onDeleteTextFile(editingSkill.id, file.path);
        }
      }

      for (const item of normalizedFiles) {
        await props.onUpsertTextFile(editingSkill.id, `${folderName(item.kind)}/${item.path}`, item.kind, item.content);
      }

      setEditingSkillId(null);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  const editableReferences = editableFiles.filter((item) => item.kind === "reference");
  const editableAssets = editableFiles.filter((item) => item.kind === "asset");
  const otherStoredFiles = props.selectedFiles.filter((item) => item.kind === "script" || item.kind === "other");
  const verifierAgentName = props.verifierAgentId
    ? props.agents.find((agent) => agent.id === props.verifierAgentId)?.name ?? "已選擇 verifier"
    : props.agents.find((agent) => agent.id === props.activeAgentId)?.name ?? "目前對話 Agent";

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div style={{ display: "grid", gap: 8 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ fontWeight: 800, fontSize: 18 }}>Skills</div>
          <button type="button" onClick={() => setShowHelp(true)} title="Skills 使用說明" aria-label="Skills 使用說明" style={helpBtn}>
            ?
          </button>
        </div>
        <div style={{ fontSize: 12, opacity: 0.78, lineHeight: 1.7 }}>
          Skills 是比 tool 更高階的 workflow layer。這一版對齊 <code>skill-name/SKILL.md + scripts/ + references/ + assets/</code> 的結構，
          並透過 IndexedDB 抽象層管理匯入後的 skill 定義與檔案。
        </div>
      </div>

      <div className="card" style={{ padding: 14, display: "grid", gap: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
          <div>
            <div style={{ fontWeight: 800, marginBottom: 4 }}>Skill Runtime</div>
            <div style={{ fontSize: 12, opacity: 0.74, lineHeight: 1.7 }}>
              切換 skill 的單輪 / 多輪執行架構。單輪模式不做結果 refine，較輕量、延遲低，適合語氣修正、回答框架、輕量 docs 或 tool 輔助；
              多輪模式會先跑多步工具流程，再追加 verify / refine 回合，較適合需要檢查正確性、補充證據、瀏覽器操作或重新調用工具的情境，但會更慢、耗用更多 token。
            </div>
          </div>
          <button
            type="button"
            onClick={() => props.onChangeExecutionMode(props.executionMode === "multi_turn" ? "single_turn" : "multi_turn")}
            aria-pressed={props.executionMode === "multi_turn"}
            title={props.executionMode === "multi_turn" ? "切換為單輪 skill" : "切換為多輪 refine"}
            style={{
              ...runtimeToggleBtn,
              background: props.executionMode === "multi_turn" ? "rgba(91,123,255,0.14)" : "rgba(255,255,255,0.03)",
              borderColor: props.executionMode === "multi_turn" ? "rgba(91,123,255,0.38)" : "var(--border)"
            }}
          >
            <span style={runtimeToggleText}>
              {props.executionMode === "multi_turn" ? "多輪 refine" : "單輪 skill"}
            </span>
            <span
              style={{
                ...runtimeToggleTrack,
                background: props.executionMode === "multi_turn" ? "rgba(91,123,255,0.38)" : "rgba(255,255,255,0.12)"
              }}
            >
              <span
                style={{
                  ...runtimeToggleThumb,
                  transform: props.executionMode === "multi_turn" ? "translateX(19px)" : "translateX(0)"
                }}
              />
            </span>
          </button>
        </div>

        <div style={{ fontSize: 12, lineHeight: 1.7, opacity: 0.84 }}>
          {props.executionMode === "multi_turn"
            ? `目前使用多輪 skill。系統會先執行最多 ${props.toolLoopMax} 步工具流程，再由 verifier（目前：${verifierAgentName}）檢查回答是否符合 skill 指示、是否需要補強證據或追加工具使用，最多 refine ${props.verifyMax} 次。`
            : "目前使用單輪 skill。系統會載入 skill instructions / references，必要時搭配 docs、MCP、built-in tools，但不會在最終回答後自動驗證或重答。"}
        </div>

        {props.executionMode === "multi_turn" ? (
          <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
            <div>
              <label style={labelLike}>工具步數上限</label>
              <input
                type="number"
                min={0}
                max={12}
                value={props.toolLoopMax}
                onChange={(e) => props.onChangeToolLoopMax(Number(e.target.value))}
                style={inputLike}
              />
            </div>
            <div>
              <label style={labelLike}>Verify 次數</label>
              <input
                type="number"
                min={0}
                max={5}
                value={props.verifyMax}
                onChange={(e) => props.onChangeVerifyMax(Number(e.target.value))}
                style={inputLike}
              />
            </div>
            <div>
              <label style={labelLike}>Verifier Agent</label>
              <select value={props.verifierAgentId} onChange={(e) => props.onChangeVerifierAgentId(e.target.value)} style={inputLike as any}>
                <option value="">目前對話 Agent</option>
                {props.agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        ) : null}
      </div>

      {showHelp ? (
        <HelpModal title="Skills 使用說明" onClose={() => setShowHelp(false)} width="min(760px, 96vw)">
          <div style={helpText}>
            這一版 skill package 需要一個根資料夾，並至少包含 <code>SKILL.md</code>。匯入後會把 skill 定義、references、
            scripts 與 assets 透過同一個 IndexedDB abstraction layer 存起來。
          </div>
          <div style={{ ...helpText, marginTop: 8 }}>
            目錄格式：
            <pre style={codeBlock}>{`skill-name/
├── SKILL.md
├── scripts/
├── references/
└── assets/`}</pre>
          </div>
          <div style={{ ...helpText, marginTop: 8 }}>
            目前支援：
            <br />
            1. <code>SKILL.md</code> 作為主要 skill 定義與 instructions
            <br />
            2. <code>references/</code> 作為 skill 專屬文件
            <br />
            3. <code>scripts/</code> 與 <code>assets/</code> 會被存檔，但 script 不執行
            <br />
            4. 直接建立空白 skill，再手動補 references / text assets
          </div>
        </HelpModal>
      ) : null}

      {showToolHelp ? (
        <HelpModal title="呼叫tool方式" onClose={() => setShowToolHelp(false)} width="min(820px, 96vw)">
          <div style={helpText}>
            Skills 本身是 workflow layer，不是直接執行工具的地方。正確做法是在 <code>SKILL.md</code> 裡明確描述：
            什麼情況下應該使用 tool、為什麼要用、以及拿到 tool 結果後要怎麼納入最終回答。真正可用的範圍仍然會受到
            <strong> Agent Access Control </strong>與 <strong>Skill workflow</strong> 的交集限制。
          </div>
          <div style={{ ...helpText, marginTop: 10 }}>
            如果你想讓 skill 使用已經註冊好的 built-in tool，例如 <code>計算</code>，建議在 <code>SKILL.md</code> 中加入像下面這樣的說明：
          </div>
          <pre style={{ ...codeBlock, marginTop: 8 }}>{`## Tool Integration

When arithmetic or exact numeric calculation is required, use the built-in tool \`計算\` instead of relying only on mental math.

### Built-in Tool: 計算

Use \`計算\` when:
- The user asks for arithmetic results such as addition, subtraction, multiplication, division, percentages, or comparisons between numbers
- A reasoning chain includes intermediate numeric computation
- Exact numeric correctness matters more than fast conversational response

Do not use it when:
- The task is purely conceptual and does not require actual computation
- The user only asks for high-level reasoning without needing a numeric result

### Usage Rule

Before giving the final answer:
1. Identify the numbers or expression that must be calculated
2. Call the built-in tool \`計算\` with the required input
3. Use the returned result in the final answer
4. If the tool result conflicts with your rough intuition, trust the tool result

### Example

If the user asks:
- \`1+1=多少\`
- \`請幫我算 25 * 48\`
- \`100 的 15% 是多少\`

Then prefer using the built-in tool \`計算\` to obtain the exact result before replying.`}</pre>
          <div style={{ ...helpText, marginTop: 10 }}>
            重點不是只把工具名稱寫進去，而是要把「何時該用」、「什麼情境不要用」、「用完之後如何整合結果」講清楚。這樣 skill 觸發後，後續的 tool decision 才更容易正確選到工具。
          </div>
          <div style={{ ...helpText, marginTop: 8 }}>
            <strong>Built-in Tools</strong>
          </div>
          <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
            {props.builtInTools.length === 0 ? <div style={{ fontSize: 12, opacity: 0.7 }}>No built-in tools registered.</div> : null}
            {props.builtInTools.map((tool) => (
              <div key={tool.id} className="card" style={{ padding: 12, display: "grid", gap: 6, background: "rgba(255,255,255,0.02)" }}>
                <div style={{ fontWeight: 700 }}>{tool.displayLabel ?? tool.name}</div>
                <div style={{ fontSize: 12, opacity: 0.78 }}>{tool.description}</div>
                <div style={{ fontSize: 11, opacity: 0.7 }}>
                  {tool.source === "system" ? "system" : "custom"} tool
                  {tool.requireConfirmation ? " · 執行前需使用者確認" : ""}
                </div>
              </div>
            ))}
          </div>
          <div style={{ ...helpText, marginTop: 16 }}>
            <strong>MCP Tools</strong>
          </div>
          <div style={{ ...helpText, marginTop: 4 }}>
            只有先在 MCP 面板執行 <code>Connect & List Tools</code> 的 server，這裡才會顯示實際工具名稱。
          </div>
          <div style={{ display: "grid", gap: 10, marginTop: 8 }}>
            {props.mcpToolCatalog.length === 0 ? <div style={{ fontSize: 12, opacity: 0.7 }}>No MCP servers registered.</div> : null}
            {props.mcpToolCatalog.map(({ server, tools }) => (
              <div key={server.id} className="card" style={{ padding: 12, display: "grid", gap: 8, background: "rgba(255,255,255,0.02)" }}>
                <div style={{ fontWeight: 700 }}>{server.name}</div>
                <div style={{ fontSize: 11, opacity: 0.7 }}>{server.sseUrl}</div>
                {tools.length === 0 ? (
                  <div style={{ fontSize: 12, opacity: 0.72 }}>尚未載入 tools。請先執行 Connect & List Tools。</div>
                ) : (
                  <div style={{ display: "grid", gap: 6 }}>
                    {tools.map((tool) => (
                      <div key={`${server.id}:${tool.name}`} style={{ padding: 10, borderRadius: 12, border: "1px solid rgba(255,255,255,0.06)", background: "rgba(0,0,0,0.16)" }}>
                        <div style={{ fontWeight: 700, fontSize: 12 }}>{tool.name}</div>
                        <div style={{ fontSize: 12, opacity: 0.78, marginTop: 4 }}>{tool.description ?? "No description."}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </HelpModal>
      ) : null}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="button" onClick={() => fileInputRef.current?.click()} style={btnSmall} disabled={busy}>
          {busy ? "Importing..." : "Upload Skill Zip"}
        </button>
        <button type="button" onClick={() => void onCreateEmptySkill()} style={btnSmall} disabled={busy}>
          Create Empty Skill
        </button>
        <input ref={fileInputRef} type="file" accept=".zip,application/zip" style={{ display: "none" }} onChange={(e) => onPickFile(e.target.files?.[0])} />
      </div>

      {error ? <div style={errorText}>{error}</div> : null}

      <div style={{ display: "grid", gap: 8 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ fontWeight: 800 }}>已匯入 Skills</div>
          <button type="button" onClick={() => setShowToolHelp(true)} style={btnSmall}>
            呼叫tool方式
          </button>
        </div>
        {props.skills.length === 0 ? <div style={{ fontSize: 12, opacity: 0.7 }}>No skills yet. Upload a zip package to begin.</div> : null}
        {props.skills.map((skill) => {
          const active = skill.id === selectedSkill?.id;
          return (
            <div
              key={skill.id}
              style={{
                padding: 12,
                borderRadius: 14,
                border: active ? "1px solid var(--primary)" : "1px solid var(--border)",
                background: active ? "rgba(91, 123, 255, 0.12)" : "var(--bg-2)",
                color: "var(--text)"
              }}
            >
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <button
                  type="button"
                  onClick={() => props.onSelect(skill.id)}
                  style={{
                    flex: 1,
                    textAlign: "left",
                    background: "transparent",
                    border: "none",
                    color: "inherit",
                    padding: 0,
                    cursor: "pointer"
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <div style={{ fontWeight: 700 }}>{skill.name}</div>
                    <div style={{ fontSize: 11, opacity: 0.72 }}>{skill.version}</div>
                  </div>
                  <div style={{ fontSize: 12, opacity: 0.74, marginTop: 4 }}>{skill.description}</div>
                </button>
                {active ? (
                  <div style={{ display: "flex", gap: 8, marginLeft: "auto", flexWrap: "wrap" }}>
                    <button type="button" onClick={() => openEdit(skill)} style={btnSmall}>
                      Edit
                    </button>
                    <button type="button" onClick={() => void onExportSkill(skill.id)} style={btnSmall} disabled={busy}>
                      Export
                    </button>
                    <button type="button" onClick={() => void onDeleteSkill(skill.id)} style={btnDangerSmall} disabled={busy}>
                      Delete
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      {editingSkill ? (
        <HelpModal title={`Edit Skill: ${editingSkill.name}`} onClose={() => setEditingSkillId(null)} width="min(960px, calc(100vw - 48px))" footer={null}>
          <div style={{ display: "grid", gap: 12 }}>
            <div style={{ fontSize: 13, lineHeight: 1.7, opacity: 0.86 }}>{editingSkill.description}</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <span style={badgeStyle}>references {editingSkill.docCount}</span>
              <span style={badgeStyle}>files {editingSkill.fileCount}</span>
              <span style={badgeStyle}>scripts {editingSkill.scriptCount}</span>
              <span style={badgeStyle}>assets {editingSkill.assetCount}</span>
            </div>

            <div>
              <div style={sectionTitle}>SKILL.md</div>
              <textarea
                value={skillMarkdownDraft}
                onChange={(e) => setSkillMarkdownDraft(e.target.value)}
                rows={18}
                style={{ ...codeBlock, width: "100%", boxSizing: "border-box", resize: "vertical" }}
              />
            </div>

            <div style={{ display: "grid", gap: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <div style={sectionTitle}>References</div>
                <button type="button" onClick={() => addEditableFile("reference")} style={btnSmall}>
                  + Add Reference
                </button>
              </div>
              {editableReferences.length === 0 ? <div style={{ fontSize: 12, opacity: 0.7 }}>No references yet.</div> : null}
              {editableReferences.map((item) => (
                <div key={item.key} className="card" style={fileCardStyle}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <span style={pathPrefixStyle}>references/</span>
                    <input
                      value={item.path}
                      onChange={(e) => updateEditableFile(item.key, { path: e.target.value })}
                      placeholder="guide.md"
                      style={{ ...textInputStyle, flex: 1 }}
                    />
                    <button type="button" onClick={() => removeEditableFile(item.key)} style={btnDangerSmall}>
                      Remove
                    </button>
                  </div>
                  <textarea
                    value={item.content}
                    onChange={(e) => updateEditableFile(item.key, { content: e.target.value })}
                    rows={8}
                    style={{ ...codeBlock, width: "100%", boxSizing: "border-box", resize: "vertical" }}
                  />
                </div>
              ))}
            </div>

            <div style={{ display: "grid", gap: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <div style={sectionTitle}>Assets (text only)</div>
                <button type="button" onClick={() => addEditableFile("asset")} style={btnSmall}>
                  + Add Asset
                </button>
              </div>
              {editableAssets.length === 0 ? <div style={{ fontSize: 12, opacity: 0.7 }}>No text assets yet.</div> : null}
              {editableAssets.map((item) => (
                <div key={item.key} className="card" style={fileCardStyle}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <span style={pathPrefixStyle}>assets/</span>
                    <input
                      value={item.path}
                      onChange={(e) => updateEditableFile(item.key, { path: e.target.value })}
                      placeholder="template.txt"
                      style={{ ...textInputStyle, flex: 1 }}
                    />
                    <button type="button" onClick={() => removeEditableFile(item.key)} style={btnDangerSmall}>
                      Remove
                    </button>
                  </div>
                  <textarea
                    value={item.content}
                    onChange={(e) => updateEditableFile(item.key, { content: e.target.value })}
                    rows={8}
                    style={{ ...codeBlock, width: "100%", boxSizing: "border-box", resize: "vertical" }}
                  />
                </div>
              ))}
            </div>

            <div>
              <div style={sectionTitle}>Other Stored Files</div>
              {otherStoredFiles.length === 0 ? (
                <div style={{ fontSize: 12, opacity: 0.7 }}>No extra stored files.</div>
              ) : (
                <div style={{ display: "grid", gap: 8 }}>
                  {otherStoredFiles.map((item) => (
                    <div key={item.id} className="card" style={{ padding: 10, display: "grid", gap: 6, background: "rgba(255,255,255,0.02)" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                        <strong style={{ fontSize: 12 }}>{item.path}</strong>
                        <span style={{ fontSize: 11, opacity: 0.72 }}>{item.kind}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button type="button" onClick={() => setEditingSkillId(null)} style={btnSmall}>
                Close
              </button>
              <button type="button" onClick={() => void onSaveSkill()} style={btnPrimary} disabled={busy}>
                {busy ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </HelpModal>
      ) : null}
    </div>
  );
}

const btnSmall: React.CSSProperties = {
  borderRadius: 10,
  border: "1px solid var(--border)",
  background: "var(--bg-2)",
  color: "var(--text)",
  padding: "10px 14px",
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

const helpBtn: React.CSSProperties = {
  width: 34,
  height: 34,
  borderRadius: 999,
  border: "1px solid var(--border)",
  background: "var(--bg-2)",
  color: "var(--text)",
  cursor: "pointer",
  fontWeight: 800
};

const sectionTitle: React.CSSProperties = {
  fontWeight: 800,
  marginBottom: 8
};

const labelLike: React.CSSProperties = {
  display: "block",
  fontSize: 12,
  fontWeight: 700,
  opacity: 0.8,
  marginBottom: 6
};

const inputLike: React.CSSProperties = {
  width: "100%",
  borderRadius: 10,
  border: "1px solid var(--border)",
  background: "var(--bg-2)",
  color: "var(--text)",
  padding: "10px 12px",
  boxSizing: "border-box"
};

const runtimeToggleBtn: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 12,
  padding: "8px 12px",
  borderRadius: 999,
  border: "1px solid var(--border)",
  color: "var(--text)",
  cursor: "pointer",
  fontWeight: 700,
  flexShrink: 0
};

const runtimeToggleText: React.CSSProperties = {
  fontSize: 12,
  whiteSpace: "nowrap"
};

const runtimeToggleTrack: React.CSSProperties = {
  position: "relative",
  width: 42,
  height: 24,
  borderRadius: 999,
  transition: "background 160ms ease"
};

const runtimeToggleThumb: React.CSSProperties = {
  position: "absolute",
  top: 3,
  left: 3,
  width: 18,
  height: 18,
  borderRadius: 999,
  background: "linear-gradient(180deg, #ffffff, #d8e1ff)",
  boxShadow: "0 2px 10px rgba(0,0,0,0.28)",
  transition: "transform 160ms ease"
};

const badgeStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 800,
  borderRadius: 999,
  padding: "5px 10px",
  background: "rgba(91,123,255,0.12)",
  border: "1px solid rgba(91,123,255,0.2)"
};

const helpText: React.CSSProperties = {
  fontSize: 13,
  lineHeight: 1.7,
  opacity: 0.88
};

const codeBlock: React.CSSProperties = {
  margin: 0,
  padding: 12,
  borderRadius: 12,
  background: "rgba(0,0,0,0.24)",
  border: "1px solid rgba(255,255,255,0.08)",
  whiteSpace: "pre-wrap",
  fontFamily: "SFMono-Regular, Consolas, monospace",
  fontSize: 12,
  lineHeight: 1.65,
  color: "var(--text)"
};

const errorText: React.CSSProperties = {
  fontSize: 12,
  color: "#ff9aa9"
};

const fileCardStyle: React.CSSProperties = {
  padding: 12,
  display: "grid",
  gap: 8,
  background: "rgba(255,255,255,0.02)"
};

const pathPrefixStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 800,
  opacity: 0.74
};

const textInputStyle: React.CSSProperties = {
  borderRadius: 10,
  border: "1px solid var(--border)",
  background: "var(--bg-2)",
  color: "var(--text)",
  padding: "10px 12px",
  minWidth: 0
};
