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
  testStates: Record<string, {
    status: "idle" | "running" | "success" | "failure";
    summary?: string;
    expected?: string;
    requestId?: string;
    agentName?: string;
    prompt?: string;
    system?: string;
    rawOutput?: string;
    parsedOutput?: string;
    updatedAt?: number;
  }>;
  testsRunning: boolean;
  onRunApiTest: (baseId: PromptTemplateBaseId, language: McpPromptTemplateKey) => Promise<void>;
  onRunAllApiTests: (language: McpPromptTemplateKey) => Promise<void>;
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
  const selectedTestState = selectedFileId ? props.testStates[selectedFileId] ?? null : null;

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
          <div style={{ ...helpText, marginTop: 8 }}>
            除了 YAML 格式檢查以外，面板也支援直接用目前 agent / load balancer 執行真實 API 測試。
            這些測試會使用內建的假資料 catalog，不會真的執行工具或 skill，只驗證 prompt 是否能穩定得到可解析輸出。
          </div>
        </HelpModal>
      ) : null}

      <div className="card" style={{ padding: 14, display: "grid", gap: 12 }}>
        <div style={{ fontSize: 12, opacity: 0.8, lineHeight: 1.7 }}>
          這些 template 會直接影響 tool decision、skill decision、skill verify 與 multi-turn planner 的行為。編輯後會立即保存到本機。
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", justifyContent: "space-between" }}>
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
          <button type="button" onClick={() => props.onRunAllApiTests(props.activeDecisionLanguage)} style={btnSmall} disabled={props.testsRunning}>
            {props.testsRunning ? "測試中…" : "測試目前語言全部模板"}
          </button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(260px, 320px) minmax(0, 1fr)", gap: 14, alignItems: "start" }}>
        <div style={{ display: "grid", gap: 8 }}>
          {props.groups.map((group) => {
            const localized = group.entries[props.activeDecisionLanguage] ?? group.entries.zh ?? group.entries.en ?? null;
            const localizedFileId = localized ? getPromptTemplateFileId(group.baseId, props.activeDecisionLanguage) : null;
            const testState = localizedFileId ? props.testStates[localizedFileId] ?? null : null;
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
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                    {localized.parseError ? (
                      <span style={{ fontSize: 11, fontWeight: 800, color: "var(--danger)" }}>YAML ERROR</span>
                    ) : (
                      <span style={{ fontSize: 11, fontWeight: 800, color: "var(--ok)" }}>YAML OK</span>
                    )}
                    {testState?.status === "success" ? <span style={{ fontSize: 11, fontWeight: 800, color: "var(--ok)" }}>API PASS</span> : null}
                    {testState?.status === "failure" ? <span style={{ fontSize: 11, fontWeight: 800, color: "var(--danger)" }}>API FAIL</span> : null}
                    {testState?.status === "running" ? <span style={{ fontSize: 11, fontWeight: 800, color: "var(--primary)" }}>API RUN</span> : null}
                  </div>
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
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                <button
                  type="button"
                  onClick={() => props.onRunApiTest(selected.baseId, props.activeDecisionLanguage)}
                  style={btnSmall}
                  disabled={!!selected.parseError || selectedTestState?.status === "running" || props.testsRunning}
                >
                  {selectedTestState?.status === "running" ? "測試中…" : "執行 API 測試"}
                </button>
                <button type="button" onClick={() => props.onResetFile(selectedFileId!)} style={btnSmall}>
                  重設為預設
                </button>
              </div>
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

            <div className="card" style={{ padding: 12, display: "grid", gap: 8, background: "var(--bg-2)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <strong style={{ fontSize: 13 }}>API 測試</strong>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 800,
                    color:
                      selectedTestState?.status === "success"
                        ? "var(--ok)"
                        : selectedTestState?.status === "failure"
                          ? "var(--danger)"
                          : selectedTestState?.status === "running"
                            ? "var(--primary)"
                            : "var(--text)",
                    opacity: selectedTestState?.status ? 1 : 0.7
                  }}
                >
                  {selectedTestState?.status === "success"
                    ? "PASS"
                    : selectedTestState?.status === "failure"
                      ? "FAIL"
                      : selectedTestState?.status === "running"
                        ? "RUNNING"
                        : "NOT RUN"}
                </span>
              </div>

              <div style={{ fontSize: 12, lineHeight: 1.7, opacity: 0.85 }}>
                {selectedTestState?.summary ?? "尚未執行 API 測試。"}
              </div>

              {selectedTestState?.expected ? (
                <div style={{ fontSize: 12, lineHeight: 1.7, opacity: 0.82 }}>
                  <strong>Expected</strong>
                  <br />
                  {selectedTestState.expected}
                </div>
              ) : null}

              {(selectedTestState?.agentName || selectedTestState?.requestId || selectedTestState?.updatedAt) ? (
                <div style={{ fontSize: 11, lineHeight: 1.7, opacity: 0.72 }}>
                  {selectedTestState.agentName ? `Agent: ${selectedTestState.agentName}` : ""}
                  {selectedTestState.agentName && (selectedTestState.requestId || selectedTestState.updatedAt) ? " | " : ""}
                  {selectedTestState.requestId ? `Request: ${selectedTestState.requestId}` : ""}
                  {(selectedTestState.agentName || selectedTestState.requestId) && selectedTestState.updatedAt ? " | " : ""}
                  {selectedTestState.updatedAt ? `Updated: ${new Date(selectedTestState.updatedAt).toLocaleString()}` : ""}
                </div>
              ) : null}

              {selectedTestState?.system ? (
                <div style={{ display: "grid", gap: 6 }}>
                  <div style={{ fontSize: 12, fontWeight: 700 }}>System prompt</div>
                  <textarea readOnly value={selectedTestState.system} rows={5} style={{ ...inp, minHeight: 96, fontFamily: 'Consolas, "SFMono-Regular", monospace', lineHeight: 1.55 }} />
                </div>
              ) : null}

              {selectedTestState?.prompt ? (
                <div style={{ display: "grid", gap: 6 }}>
                  <div style={{ fontSize: 12, fontWeight: 700 }}>Rendered prompt</div>
                  <textarea readOnly value={selectedTestState.prompt} rows={8} style={{ ...inp, minHeight: 132, fontFamily: 'Consolas, "SFMono-Regular", monospace', lineHeight: 1.55 }} />
                </div>
              ) : null}

              {selectedTestState?.rawOutput !== undefined ? (
                <div style={{ display: "grid", gap: 6 }}>
                  <div style={{ fontSize: 12, fontWeight: 700 }}>Raw output</div>
                  <textarea readOnly value={selectedTestState.rawOutput} rows={6} style={{ ...inp, minHeight: 112, fontFamily: 'Consolas, "SFMono-Regular", monospace', lineHeight: 1.55 }} />
                </div>
              ) : null}

              {selectedTestState?.parsedOutput ? (
                <div style={{ display: "grid", gap: 6 }}>
                  <div style={{ fontSize: 12, fontWeight: 700 }}>Parsed output</div>
                  <textarea readOnly value={selectedTestState.parsedOutput} rows={5} style={{ ...inp, minHeight: 96, fontFamily: 'Consolas, "SFMono-Regular", monospace', lineHeight: 1.55 }} />
                </div>
              ) : null}
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
