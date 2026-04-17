import React from "react";
import type { AgentConfig, LoadBalancerConfig, RadioSettings } from "../types";
import { DEFAULT_RADIO_SETTINGS, RADIO_STT_LANGUAGE_OPTIONS, RADIO_TTS_VOICE_OPTIONS } from "../radio/runtime";

export type RadioProbeState = {
  running: boolean;
  ok?: boolean;
  message?: string;
};

type RadioConfigPanelProps = {
  settings: RadioSettings;
  setSettings: React.Dispatch<React.SetStateAction<RadioSettings>>;
  loadBalancerOptions: LoadBalancerConfig[];
  refineAgentOptions: AgentConfig[];
  sttProbeState: RadioProbeState;
  ttsProbeState: RadioProbeState;
  onTestStt: () => void;
  onTestTts: () => void;
  onTestTone: () => void;
};

const labelStyle: React.CSSProperties = { fontSize: 12, opacity: 0.8 };

const selectStyle: React.CSSProperties = {
  padding: "8px 10px",
  borderRadius: 12,
  border: "1px solid var(--border)",
  background: "var(--bg-2)",
  color: "var(--text)"
};

export default function RadioConfigPanel(props: RadioConfigPanelProps) {
  const {
    settings,
    setSettings,
    loadBalancerOptions,
    refineAgentOptions,
    sttProbeState,
    ttsProbeState,
    onTestStt,
    onTestTts,
    onTestTone
  } = props;

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div style={{ fontSize: 12, opacity: 0.78, lineHeight: 1.7 }}>
        Radio mode 會用 STT load balancer 將麥克風語音切成 chunk 逐步轉成文字，再在送出前先整理語句；當人類說完並停頓一小段時間，系統就會自動切換到 Agent。Agent 回覆仍走原本 one-to-one 流程，最後再交給 TTS load balancer 念出來。各自的 credential / key failover 由對應的 load balancer 處理。
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
            {RADIO_STT_LANGUAGE_OPTIONS.map((entry) => (
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
        <label style={labelStyle}>Chunk Seconds</label>
        <input
          type="number"
          min={2}
          max={300}
          value={settings.chunkSeconds}
          onChange={(e) =>
            setSettings((prev) => ({
              ...prev,
              chunkSeconds: Math.max(2, Math.min(300, Number(e.target.value) || DEFAULT_RADIO_SETTINGS.chunkSeconds))
            }))
          }
          style={{ width: "100%", marginTop: 0, boxSizing: "border-box", ...selectStyle }}
        />
      </div>

      <div style={{ display: "grid", gap: 10 }}>
        <label style={labelStyle}>Refine Agent</label>
        <select
          value={settings.refineAgentId ?? ""}
          onChange={(e) => setSettings((prev) => ({ ...prev, refineAgentId: e.target.value }))}
          style={{ width: "100%", marginTop: 0, boxSizing: "border-box", ...selectStyle }}
        >
          <option value="">Use Main Agent</option>
          {refineAgentOptions.map((agent) => (
            <option key={agent.id} value={agent.id}>
              {agent.name}
            </option>
          ))}
        </select>
        <div style={{ fontSize: 12, opacity: 0.72, lineHeight: 1.5 }}>
          refine 只負責把 STT 草稿整理成正式句子。若主 Agent 容易直接回答問題，可以換成另一個比較守規矩的 Agent 處理這一步。
        </div>
      </div>

      <div style={{ display: "grid", gap: 10 }}>
        <label style={labelStyle}>Refine Prompt</label>
        <textarea
          rows={8}
          value={settings.refinePrompt}
          onChange={(e) => setSettings((prev) => ({ ...prev, refinePrompt: e.target.value }))}
          style={{ width: "100%", marginTop: 0, boxSizing: "border-box", ...selectStyle, resize: "vertical" }}
        />
        <div style={{ fontSize: 12, opacity: 0.72, lineHeight: 1.5 }}>
          這段 system prompt 只應該整理逐字稿，不應該直接回答使用者。預設 prompt 已經強調「只回 cleaned transcript」。
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
            {RADIO_TTS_VOICE_OPTIONS.map((voice) => (
              <option key={voice} value={voice}>
                {voice}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-start" }}>
        <button type="button" className="chat-clear-btn" onClick={onTestTone}>
          測試提示音
        </button>
      </div>

      <div style={{ fontSize: 12, opacity: 0.72, lineHeight: 1.6 }}>
        v1 預設採 60 秒左右切 chunk，並用靜音偵測來切換人類與 Agent。正式 chat history 會保留 refine 後的句子。若 TTS 對原文沒有回傳音訊，系統會自動退回英文朗讀版本。
      </div>
    </div>
  );
}
