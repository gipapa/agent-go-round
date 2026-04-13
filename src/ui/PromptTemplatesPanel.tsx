import React from "react";
import { McpPromptTemplateKey } from "../storage/settingsStore";
import { PromptTemplateBaseId, PromptTemplateFileState, PromptTemplateGroup, getPromptTemplateFileId } from "../promptTemplates/store";
import HelpModal from "./HelpModal";

export default function PromptTemplatesPanel(props: {
  files: PromptTemplateFileState[];
  groups: PromptTemplateGroup[];
  activeDecisionLanguage: McpPromptTemplateKey;
  onChangeActiveDecisionLanguage: (language: McpPromptTemplateKey) => void;
  onChangeFileContent: (id: ReturnType<typeof getPromptTemplateFileId>, content: string) => void;
  onResetFile: (id: ReturnType<typeof getPromptTemplateFileId>) => void;
}) {
  const [selectedBaseId, setSelectedBaseId] = React.useState<PromptTemplateBaseId>(props.groups[0]?.baseId ?? "tool-decision");
  const [showHelp, setShowHelp] = React.useState(false);

  React.useEffect(() => {
    if (!props.groups.some((entry) => entry.baseId === selectedBaseId)) {
      setSelectedBaseId(props.groups[0]?.baseId ?? "tool-decision");
    }
  }, [props.groups, selectedBaseId]);

  const selectedGroup = props.groups.find((entry) => entry.baseId === selectedBaseId) ?? props.groups[0] ?? null;
  const selected = selectedGroup?.entries[props.activeDecisionLanguage] ?? null;
  const selectedFileId = selected ? getPromptTemplateFileId(selected.baseId, props.activeDecisionLanguage) : null;
  const selectedState = props.files.find((entry) => entry.id === selectedFileId) ?? null;

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ fontWeight: 800 }}>Prompt Templates</div>
        <button type="button" onClick={() => setShowHelp(true)} title="Prompt Templates 使用說明" aria-label="Prompt Templates 使用說明" style={helpBtn}>
          ?
        </button>
      </div>

      {showHelp ? (
        <HelpModal title="Prompt Templates 使用說明" onClose={() => setShowHelp(false)} width="min(760px, 96vw)">
          <div style={helpText}>
            這裡管理的是系統內建 prompt template 檔案。它們以 YAML 形式保存，目的不是讓使用者新增任意流程，而是讓你更容易直接調整：
            tool decision、skill decision，以及 multi-turn skill runtime 的關鍵提示詞。
          </div>
          <div style={{ ...helpText, marginTop: 8 }}>
            每份檔案都需要保留 <code>template</code> 欄位；你可以自由調整文字，但建議保留畫面上列出的 placeholders。
            如果 YAML 格式有誤，runtime 會自動退回內建預設模板。
          </div>
        </HelpModal>
      ) : null}

      <div className="card" style={{ padding: 14, display: "grid", gap: 12 }}>
        <div style={{ fontSize: 12, opacity: 0.8, lineHeight: 1.7 }}>
          這些 template 會直接影響 tool decision、skill decision、skill verify 與 multi-turn planner 的行為。編輯後會立即保存到本機。
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: 12, opacity: 0.78 }}>Template language</span>
          {([
            ["zh", "中文"],
            ["en", "English"]
          ] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => props.onChangeActiveDecisionLanguage(id)}
              style={{
                ...btnSmall,
                border: props.activeDecisionLanguage === id ? "1px solid var(--primary)" : btnSmall.border,
                background: props.activeDecisionLanguage === id ? "rgba(91,123,255,0.14)" : btnSmall.background
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(260px, 320px) minmax(0, 1fr)", gap: 14, alignItems: "start" }}>
        <div style={{ display: "grid", gap: 8 }}>
          {props.groups.map((group) => {
            const localized = group.entries[props.activeDecisionLanguage] ?? group.entries.zh ?? group.entries.en ?? null;
            if (!localized) return null;
            return (
              <button
                key={group.baseId}
                type="button"
                onClick={() => setSelectedBaseId(group.baseId)}
                style={{
                  textAlign: "left",
                  padding: 12,
                  borderRadius: 14,
                  border: selectedGroup?.baseId === group.baseId ? "1px solid var(--primary)" : "1px solid var(--border)",
                  background: selectedGroup?.baseId === group.baseId ? "rgba(91,123,255,0.12)" : "var(--bg-2)",
                  color: "var(--text)",
                  display: "grid",
                  gap: 6
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                  <strong style={{ fontSize: 13 }}>{localized.title}</strong>
                  {localized.parseError ? (
                    <span style={{ fontSize: 11, fontWeight: 800, color: "var(--danger)" }}>YAML ERROR</span>
                  ) : (
                    <span style={{ fontSize: 11, fontWeight: 800, color: "var(--ok)" }}>OK</span>
                  )}
                </div>
                <div style={{ fontSize: 11, opacity: 0.7 }}>{localized.path}</div>
                <div style={{ fontSize: 12, opacity: 0.82, lineHeight: 1.6 }}>{localized.description}</div>
              </button>
            );
          })}
        </div>

        {selected && selectedState ? (
          <div className="card" style={{ padding: 14, display: "grid", gap: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start", flexWrap: "wrap" }}>
              <div style={{ display: "grid", gap: 4 }}>
                <div style={{ fontWeight: 800 }}>{selected.title}</div>
                <div style={{ fontSize: 12, opacity: 0.7 }}>{selected.path}</div>
              </div>
              <button type="button" onClick={() => props.onResetFile(selectedFileId!)} style={btnSmall}>
                重設為預設
              </button>
            </div>

            {selected.parseError ? (
              <div style={{ fontSize: 12, color: "var(--danger)", lineHeight: 1.7 }}>
                目前 YAML 解析失敗，runtime 已退回預設模板：
                <br />
                {selected.parseError}
              </div>
            ) : null}

            <div style={{ fontSize: 12, opacity: 0.82, lineHeight: 1.7 }}>
              Placeholders：
              <br />
              {selected.placeholders.length ? selected.placeholders.map((token) => <code key={token} style={{ marginRight: 6 }}>{token}</code>) : "（無）"}
            </div>

            <textarea
              value={selectedState.content}
              onChange={(event) => props.onChangeFileContent(selectedFileId!, event.target.value)}
              rows={22}
              style={{ ...inp, minHeight: 360, fontFamily: 'Consolas, "SFMono-Regular", monospace', lineHeight: 1.55 }}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}

const helpBtn: React.CSSProperties = {
  width: 28,
  height: 28,
  borderRadius: 999,
  border: "1px solid var(--border)",
  background: "var(--bg-2)",
  color: "var(--text)",
  fontWeight: 800,
  cursor: "pointer"
};

const helpText: React.CSSProperties = {
  fontSize: 12,
  lineHeight: 1.7,
  opacity: 0.86
};

const btnSmall: React.CSSProperties = {
  borderRadius: 10,
  border: "1px solid var(--border)",
  background: "var(--bg-2)",
  color: "var(--text)",
  padding: "8px 12px",
  fontWeight: 700,
  cursor: "pointer"
};

const inp: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  borderRadius: 12,
  border: "1px solid var(--border)",
  background: "var(--bg-2)",
  color: "var(--text)",
  padding: 10
};
