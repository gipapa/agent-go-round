import React from "react";
import type { useCredentialController } from "../credentials/useCredentialController";
import HelpModal from "./HelpModal";

type CredentialsPanelProps = {
  controller: ReturnType<typeof useCredentialController>;
  onClose: () => void;
};

export default function CredentialsPanel({ controller, onClose }: CredentialsPanelProps) {
  const {
    credentialSlots,
    visibleCredentialIds,
    credentialTestResults,
    testingCredentialIds,
    addCredential,
    updateCredential,
    removeCredential,
    addCredentialKey,
    updateCredentialKey,
    removeCredentialKey,
    toggleCredentialVisibility,
    runCredentialTest
  } = controller;

  return (
    <HelpModal title="Credentials" onClose={onClose} width="min(680px, 96vw)">
      <div style={{ display: "grid", gap: 14 }} data-tutorial-id="credentials-modal">
        <div style={{ fontSize: 12, opacity: 0.78, lineHeight: 1.7 }}>
          這裡集中管理 provider / endpoint 與多把 API keys。Load Balancer 的 instance 會選擇其中一筆 credential，再綁定某一把 key 來執行。
        </div>
        <div style={securityNoticeStyle}>
          安全提醒：目前 API keys 仍會存於本機瀏覽器 storage 的獨立 credential key。請避免在公用電腦或不信任的瀏覽器擴充環境使用；匯入第三方 built-in tool 前也請先檢查程式碼。
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" onClick={() => addCredential("openai")} style={iconActionBtn}>+ OpenAI</button>
          <button type="button" onClick={() => addCredential("groq")} style={iconActionBtn} data-tutorial-id="credential-add-groq">+ Groq</button>
          <button type="button" onClick={() => addCredential("gemini")} style={iconActionBtn}>+ Gemini</button>
          <button type="button" onClick={() => addCredential("custom")} style={iconActionBtn}>+ Custom</button>
          <button type="button" onClick={() => addCredential("chrome_prompt")} style={iconActionBtn}>+ Chrome Prompt</button>
        </div>
        {credentialSlots.length === 0 ? (
          <div style={{ fontSize: 12, opacity: 0.7 }}>目前還沒有 credential。可先新增 OpenAI、Groq、Custom 或 Chrome Prompt。</div>
        ) : credentialSlots.map((slot) => (
          <div
            key={slot.id}
            className="card"
            style={{ padding: 14, display: "grid", gap: 10 }}
            data-tutorial-id={slot.preset === "groq" ? "credential-groq-card" : undefined}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              <div>
                <div style={{ fontWeight: 800 }}>{slot.label}</div>
                <div style={{ fontSize: 12, opacity: 0.72 }}>{slot.endpoint || "尚未設定 endpoint"}</div>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
                <div style={{ fontSize: 12, opacity: 0.72 }}>
                  {slot.preset === "chrome_prompt"
                    ? "不需要 API key"
                    : `已設定 ${slot.keys.filter((key) => key.apiKey.trim()).length}/${slot.keys.length} keys`}
                </div>
                <button type="button" onClick={() => removeCredential(slot.id)} style={dangerMiniBtn}>Remove</button>
              </div>
            </div>

            <div style={{ display: "grid", gap: 6 }}>
              <label style={label}>Credential Name</label>
              <input
                value={slot.label}
                onChange={(event) => updateCredential(slot.id, { label: event.target.value })}
                style={inputStyle}
                placeholder="Credential label"
                data-tutorial-id={slot.preset === "groq" ? "credential-groq-label-input" : undefined}
              />
            </div>

            <div style={{ display: "grid", gap: 6 }}>
              <label style={label}>Endpoint</label>
              <input
                value={slot.endpoint}
                onChange={(event) => updateCredential(slot.id, { endpoint: event.target.value })}
                disabled={isFixedEndpoint(slot.preset)}
                style={{ ...inputStyle, opacity: isFixedEndpoint(slot.preset) ? 0.72 : 1 }}
                placeholder="https://api.example.com/v1"
                data-tutorial-id={slot.preset === "groq" ? "credential-groq-endpoint-input" : undefined}
              />
            </div>

            {slot.preset !== "chrome_prompt" ? (
              <div style={{ display: "grid", gap: 10 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <label style={label}>Model API Keys</label>
                  <button
                    type="button"
                    onClick={() => addCredentialKey(slot.id)}
                    style={{ ...iconActionBtn, marginLeft: "auto" }}
                    data-tutorial-id={slot.preset === "groq" ? "credential-groq-add-key" : undefined}
                  >
                    + Key
                  </button>
                </div>
                {slot.keys.map((key, keyIndex) => (
                  <div key={key.id} style={keyCardStyle}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                      <div style={{ fontSize: 12, fontWeight: 700 }}>Key {keyIndex + 1}</div>
                      <button
                        type="button"
                        onClick={() => removeCredentialKey(slot.id, key.id)}
                        style={dangerMiniBtn}
                        disabled={slot.keys.length <= 1}
                      >
                        Remove
                      </button>
                    </div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <input
                        type={visibleCredentialIds[key.id] ? "text" : "password"}
                        value={key.apiKey}
                        onChange={(event) => updateCredentialKey(slot.id, key.id, event.target.value)}
                        style={inputStyle}
                        placeholder="Enter API key"
                        data-tutorial-id={slot.preset === "groq"
                          ? keyIndex === 0 ? "credential-groq-api-key" : `credential-groq-api-key-${keyIndex + 1}`
                          : undefined}
                      />
                      <button
                        type="button"
                        onClick={() => toggleCredentialVisibility(key.id)}
                        style={iconBtn}
                        title={visibleCredentialIds[key.id] ? "Hide API key" : "Show API key"}
                        aria-label={visibleCredentialIds[key.id] ? "Hide API key" : "Show API key"}
                      >
                        <EyeIcon open={!!visibleCredentialIds[key.id]} />
                      </button>
                      <button
                        type="button"
                        onClick={() => void runCredentialTest(slot, key.id)}
                        disabled={testingCredentialIds[key.id] || !slot.endpoint.trim()}
                        data-tutorial-id={slot.preset === "groq" && keyIndex === 0 ? "credential-groq-test" : undefined}
                        style={{
                          ...iconActionBtn,
                          whiteSpace: "nowrap",
                          opacity: testingCredentialIds[key.id] || !slot.endpoint.trim() ? 0.64 : 1,
                          cursor: testingCredentialIds[key.id] || !slot.endpoint.trim() ? "not-allowed" : "pointer"
                        }}
                      >
                        {testingCredentialIds[key.id] ? "測試中..." : "測試 Provider 連線"}
                      </button>
                    </div>
                    {credentialTestResults[key.id] ? (
                      <div style={{
                        fontSize: 12,
                        lineHeight: 1.6,
                        color: credentialTestResults[key.id]?.ok ? "var(--ok)" : "var(--danger)",
                        opacity: 0.92
                      }}>
                        {credentialTestResults[key.id]?.message}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ fontSize: 12, opacity: 0.72, lineHeight: 1.6 }}>
                Chrome Prompt 是 pseudo provider，不需要 API key；可直接給 load balancer instance 使用。
              </div>
            )}
          </div>
        ))}
      </div>
    </HelpModal>
  );
}

function isFixedEndpoint(preset: string) {
  return preset === "openai" || preset === "groq" || preset === "gemini";
}

function EyeIcon({ open }: { open: boolean }) {
  return open ? (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2 8s2.2-3.5 6-3.5S14 8 14 8s-2.2 3.5-6 3.5S2 8 2 8Z" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8 9.7a1.7 1.7 0 1 0 0-3.4 1.7 1.7 0 0 0 0 3.4Z" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  ) : (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2 8s2.2-3.5 6-3.5S14 8 14 8s-2.2 3.5-6 3.5S2 8 2 8Z" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="m3 13 10-10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

const label: React.CSSProperties = { fontSize: 12, opacity: 0.8 };
const inputStyle: React.CSSProperties = {
  width: "100%",
  marginTop: 0,
  boxSizing: "border-box",
  padding: "8px 10px",
  borderRadius: 12,
  border: "1px solid var(--border)",
  background: "var(--bg-2)",
  color: "var(--text)"
};
const iconBtn: React.CSSProperties = {
  width: 40,
  height: 40,
  borderRadius: 12,
  border: "1px solid var(--border)",
  background: "var(--bg-2)",
  color: "var(--text)",
  display: "grid",
  placeItems: "center",
  cursor: "pointer",
  flex: "0 0 auto"
};
const iconActionBtn: React.CSSProperties = {
  padding: "8px 12px",
  borderRadius: 12,
  border: "1px solid var(--border)",
  background: "var(--panel-2)",
  color: "var(--text)",
  cursor: "pointer"
};
const dangerMiniBtn: React.CSSProperties = {
  padding: "6px 10px",
  borderRadius: 10,
  border: "1px solid #4a2026",
  background: "#1d1014",
  color: "white",
  cursor: "pointer"
};
const securityNoticeStyle: React.CSSProperties = {
  padding: 12,
  borderRadius: 8,
  border: "1px solid rgba(245, 158, 11, 0.42)",
  background: "rgba(245, 158, 11, 0.10)",
  color: "var(--text)",
  fontSize: 12,
  lineHeight: 1.7
};
const keyCardStyle: React.CSSProperties = {
  display: "grid",
  gap: 8,
  padding: 12,
  borderRadius: 12,
  border: "1px solid var(--border)",
  background: "var(--bg-2)"
};
