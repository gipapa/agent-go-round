import { useMemo, useState } from "react";
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
  leaderName?: string | null;
  userName: string;
}) {
  const [text, setText] = useState("");

  const send = async () => {
    const t = text.trim();
    if (!t) return;
    setText("");
    await props.onSend(t);
  };

  const emptyLabel = useMemo(
    () => (props.leaderName ? `Send a goal to ${props.leaderName} and the team will coordinate here.` : "Start the conversation."),
    [props.leaderName]
  );

  return (
    <div className="chat-shell">
      <div className="chat-header">
        <div>
          <div className="chat-title">Conversation</div>
          <div className="chat-subtitle">Multi-agent timeline with visible speaker identity.</div>
        </div>
        <button onClick={props.onClear} className="chat-clear-btn">
          Clear chat
        </button>
      </div>

      <div className="chat-thread">
        {props.history.length === 0 ? <div className="chat-empty">{emptyLabel}</div> : null}
        {props.history.map((m) => {
          const isLeader = !!props.leaderName && m.role === "assistant" && m.name === props.leaderName;
          const isPhase = m.role === "system" && m.name === "phase";
          const tone = m.role === "user" ? "user" : m.role === "tool" || m.role === "system" ? "system" : "assistant";
          const displayName =
            m.displayName ?? (m.role === "user" ? props.userName : m.role === "tool" ? "Tool" : m.role === "system" ? "System" : m.name || "Agent");

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
