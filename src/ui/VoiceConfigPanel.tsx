import React from "react";
import type { LoadBalancerConfig, VoiceSettings } from "../types";
import { VOICE_STT_LANGUAGE_OPTIONS, VOICE_TTS_VOICE_OPTIONS } from "../voice/runtime";

export type VoiceProbeState = {
  running: boolean;
  ok?: boolean;
  message?: string;
};

type VoiceConfigPanelProps = {
  settings: VoiceSettings;
  setSettings: React.Dispatch<React.SetStateAction<VoiceSettings>>;
  loadBalancerOptions: LoadBalancerConfig[];
  sttProbeState: VoiceProbeState;
  ttsProbeState: VoiceProbeState;
  onTestStt: () => void;
  onTestTts: () => void;
};

const labelStyle: React.CSSProperties = { fontSize: 12, opacity: 0.8 };

const selectStyle: React.CSSProperties = {
  padding: "8px 10px",
  borderRadius: 12,
  border: "1px solid var(--border)",
  background: "var(--bg-2)",
  color: "var(--text)"
};

export default function VoiceConfigPanel(props: VoiceConfigPanelProps) {
  const {
    settings,
    setSettings,
    loadBalancerOptions,
    sttProbeState,
    ttsProbeState,
    onTestStt,
    onTestTts
  } = props;

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div style={{ fontSize: 12, opacity: 0.78, lineHeight: 1.7 }}>
        Voice 會在一般對話中提供兩個輔助工具：STT 可把麥克風錄音轉寫並追加到輸入框，TTS 可手動朗讀使用者與助理訊息。各自的 credential / key failover 由對應的 load balancer 處理。
      </div>

      <div style={{ display: "grid", gap: 10 }}>
        <label style={labelStyle}>STT Load Balancer</label>
        <select
          value={settings.sttLoadBalancerId ?? ""}
          onChange={(e) => setSettings((prev) => ({ ...prev, sttLoadBalancerId: e.target.value }))}
          style={{ width: "100%", marginTop: 0, boxSizing: "border-box", ...selectStyle }}
        >
          <option value="">Select STT load balancer</option>
          {loadBalancerOptions.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name}
            </option>
          ))}
        </select>
        <div style={{ display: "flex", justifyContent: "flex-start" }}>
          <button
            type="button"
            className="chat-clear-btn"
            onClick={onTestStt}
            disabled={sttProbeState.running || !settings.sttLoadBalancerId}
          >
            {sttProbeState.running ? "測試中..." : "測試 STT"}
          </button>
        </div>
        {sttProbeState.message ? (
          <div style={{ fontSize: 12, lineHeight: 1.6, color: sttProbeState.ok ? "var(--ok)" : "var(--danger)" }}>
            {sttProbeState.message}
          </div>
        ) : null}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div style={{ display: "grid", gap: 10 }}>
          <label style={labelStyle}>STT Language</label>
          <select
            value={settings.sttLanguage ?? ""}
            onChange={(e) => setSettings((prev) => ({ ...prev, sttLanguage: e.target.value }))}
            style={{ width: "100%", marginTop: 0, boxSizing: "border-box", ...selectStyle }}
          >
            {VOICE_STT_LANGUAGE_OPTIONS.map((entry) => (
              <option key={entry.value || "auto"} value={entry.value}>
                {entry.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div style={{ display: "grid", gap: 10 }}>
        <label style={labelStyle}>STT Temperature</label>
        <input
          type="number"
          min={0}
          max={1}
          step={0.1}
          value={settings.sttTemperature}
          onChange={(e) =>
            setSettings((prev) => ({
              ...prev,
              sttTemperature: Math.max(0, Math.min(1, Number(e.target.value) || 0))
            }))
          }
          style={{ width: "100%", marginTop: 0, boxSizing: "border-box", ...selectStyle }}
        />
        <div style={{ fontSize: 12, opacity: 0.72, lineHeight: 1.5 }}>
          預設 `0` 比較保守，通常比較適合穩定轉寫短句與控制噪音。
        </div>
      </div>

      <div style={{ display: "grid", gap: 10 }}>
        <label style={labelStyle}>Whisper Prompt</label>
        <textarea
          rows={1}
          value={settings.sttPrompt}
          onChange={(e) => setSettings((prev) => ({ ...prev, sttPrompt: e.target.value }))}
          style={{ width: "100%", marginTop: 0, boxSizing: "border-box", ...selectStyle, resize: "vertical" }}
        />
        <div style={{ fontSize: 12, opacity: 0.72, lineHeight: 1.5 }}>
          這段文字會直接送到 transcription API 作為 prompt。建議保持簡短，只用來提醒模型忠實轉寫，不要在這裡要求它回答問題。
        </div>
      </div>

      <div style={{ display: "grid", gap: 10 }}>
        <label style={labelStyle}>TTS Load Balancer</label>
        <select
          value={settings.ttsLoadBalancerId ?? ""}
          onChange={(e) => setSettings((prev) => ({ ...prev, ttsLoadBalancerId: e.target.value }))}
          style={{ width: "100%", marginTop: 0, boxSizing: "border-box", ...selectStyle }}
        >
          <option value="">Select TTS load balancer</option>
          {loadBalancerOptions.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name}
            </option>
          ))}
        </select>
        <div style={{ display: "flex", justifyContent: "flex-start" }}>
          <button
            type="button"
            className="chat-clear-btn"
            onClick={onTestTts}
            disabled={ttsProbeState.running || !settings.ttsLoadBalancerId}
          >
            {ttsProbeState.running ? "測試中..." : "測試 TTS"}
          </button>
        </div>
        {ttsProbeState.message ? (
          <div style={{ fontSize: 12, lineHeight: 1.6, color: ttsProbeState.ok ? "var(--ok)" : "var(--danger)" }}>
            {ttsProbeState.message}
          </div>
        ) : null}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div style={{ display: "grid", gap: 10 }}>
          <label style={labelStyle}>Voice</label>
          <select
            value={settings.ttsVoice}
            onChange={(e) => setSettings((prev) => ({ ...prev, ttsVoice: e.target.value }))}
            style={{ width: "100%", marginTop: 0, boxSizing: "border-box", ...selectStyle }}
          >
            {VOICE_TTS_VOICE_OPTIONS.map((voice) => (
              <option key={voice} value={voice}>
                {voice}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div style={{ fontSize: 12, opacity: 0.72, lineHeight: 1.6 }}>
        STT 不會自動送出訊息，只會把轉寫結果追加到輸入框；TTS 預設只在你手動按播放時朗讀。
      </div>
    </div>
  );
}
