import { useEffect, useMemo, useRef, useState } from "react";
import { ChatMessage } from "../types";

function initials(name: string) {
  return (name || "?")
    .trim()
    .slice(0, 2)
    .toUpperCase();
}

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function Avatar(props: { name: string; avatarUrl?: string; tone?: "user" | "assistant" | "system" }) {
  if (props.avatarUrl) {
    return <img className="chat-avatar" src={props.avatarUrl} alt={props.name} />;
  }

  return (
    <div className={`chat-avatar chat-avatar-fallback ${props.tone ?? "assistant"}`}>
      {initials(props.name)}
    </div>
  );
}

export default function ChatPanel(props: {
  history: ChatMessage[];
  onSend: (input: string) => Promise<void>;
  onClear: () => void;
  onExportRaw: () => void;
  onExportSummary: () => Promise<void>;
  onImportHistory: (file: File) => Promise<void>;
  leaderName?: string | null;
  userName: string;
  modeLabel: string;
  isSummaryExporting?: boolean;
}) {
  const [text, setText] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const threadRef = useRef<HTMLDivElement | null>(null);

  const send = async () => {
    const t = text.trim();
    if (!t) return;
    setText("");
    await props.onSend(t);
  };

  useEffect(() => {
    const node = threadRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [props.history, text]);

  const emptyLabel = useMemo(
    () => (props.leaderName ? `Send a goal to ${props.leaderName} and the team will coordinate here.` : "Just type to start the conversation."),
    [props.leaderName]
  );

  return (
    <div className="chat-shell">
      <div className="chat-header">
        <div>
          <div className="chat-title">Conversation</div>
          <div className="chat-subtitle">{props.modeLabel}</div>
        </div>
        <div className="chat-header-actions">
          <button onClick={props.onExportRaw} className="chat-clear-btn">
            匯出對話歷史(原始檔)
          </button>
          <button onClick={() => void props.onExportSummary()} className="chat-clear-btn" disabled={props.isSummaryExporting}>
            {props.isSummaryExporting ? "濃縮中..." : "匯出對話歷史(濃縮)"}
          </button>
          <button onClick={() => fileInputRef.current?.click()} className="chat-clear-btn">
            匯入對話歷史
          </button>
          <button onClick={props.onClear} className="chat-clear-btn">
            Clear chat
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,.txt"
            style={{ display: "none" }}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              await props.onImportHistory(file);
              e.target.value = "";
            }}
          />
        </div>
      </div>

      <div ref={threadRef} className="chat-thread">
        {props.history.length === 0 ? <div className="chat-empty">{emptyLabel}</div> : null}
        {props.history.map((m, index) => {
          const prev = props.history[index - 1];
          const next = props.history[index + 1];
          const isLeader = !!props.leaderName && m.role === "assistant" && m.name === props.leaderName;
          const isPhase = m.role === "system" && m.name === "phase";
          const tone = m.role === "user" ? "user" : m.role === "tool" || m.role === "system" ? "system" : "assistant";
          const displayName =
            m.displayName ?? (m.role === "user" ? props.userName : m.role === "tool" ? "Tool" : m.role === "system" ? "System" : m.name || "Agent");

          if (m.role === "tool" && next?.role === "assistant") {
            return null;
          }

          if (isPhase) {
            return (
              <div key={m.id} className="chat-phase-pill">
                {m.content}
              </div>
            );
          }

          return (
            <div key={m.id} className={`chat-row ${m.role === "user" ? "from-user" : "from-agent"}`}>
              {m.role !== "user" ? <Avatar name={displayName} avatarUrl={m.avatarUrl} tone={tone} /> : null}
              <div className={`chat-bubble-wrap ${m.role === "user" ? "from-user" : "from-agent"}`}>
                <div className="chat-meta">
                  <span className={`chat-name ${isLeader ? "leader" : ""}`}>{displayName}</span>
                  <span className="chat-role-tag">{m.role}</span>
                  <span className="chat-time">{formatTime(m.ts)}</span>
                </div>
                <div className={`chat-bubble ${m.role} ${isLeader ? "leader" : ""}`}>
                  <div className="chat-message-text">{m.content}</div>
                </div>
                {m.role === "assistant" && prev?.role === "tool" ? (
                  <details className="chat-tool-details">
                    <summary>查看 tool result</summary>
                    <pre className="chat-tool-pre">{prev.content}</pre>
                  </details>
                ) : null}
              </div>
              {m.role === "user" ? <Avatar name={displayName} avatarUrl={m.avatarUrl} tone="user" /> : null}
            </div>
          );
        })}
      </div>

      <div className="chat-composer">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={async (e) => {
            if (e.key === "Enter" && e.altKey) {
              e.preventDefault();
              await send();
            }
          }}
          rows={3}
          placeholder="Type message..."
          className="chat-input"
        />
        <button onClick={send} className="chat-send-btn">
          Send
        </button>
      </div>
    </div>
  );
}
