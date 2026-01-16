import { useState } from "react";
import { ChatMessage } from "../types";

export default function ChatPanel(props: {
  history: ChatMessage[];
  onSend: (input: string) => Promise<void>;
  onClear: () => void;
  leaderName?: string | null;
}) {
  const [text, setText] = useState("");

  const send = async () => {
    const t = text.trim();
    if (!t) return;
    setText("");
    await props.onSend(t);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", gap: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontWeight: 700, fontSize: 14 }}>Conversation</div>
        <button
          onClick={props.onClear}
          style={{
            borderRadius: 12,
            border: "1px solid var(--border)",
            background: "var(--panel-2)",
            color: "var(--text)",
            padding: "7px 11px",
            fontSize: 12
          }}
        >
          Clear chat
        </button>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: 6 }}>
        {props.history.map((m) => {
          const isLeader = !!props.leaderName && m.role === "assistant" && m.name === props.leaderName;
          const isPhase = m.role === "system" && m.name === "phase";
          if (isPhase) {
            return (
              <div
                key={m.id}
                style={{
                  margin: "14px 0",
                  padding: "6px 10px",
                  borderRadius: 12,
                  border: "1px solid var(--primary)",
                  background: "rgba(91, 123, 255, 0.12)",
                  fontWeight: 800,
                  letterSpacing: "0.04em",
                  textTransform: "uppercase"
                }}
              >
                {m.content}
              </div>
            );
          }
          return (
            <div key={m.id} style={{ marginBottom: 10 }}>
              <div style={{ fontSize: isLeader ? 14 : 12, fontWeight: isLeader ? 800 : 400, opacity: isLeader ? 1 : 0.7 }}>
                {m.role}
                {m.name ? ` · ${isLeader ? `[planner] ${m.name}` : m.name}` : ""}
              </div>
              <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.5, fontSize: isLeader ? 14 : 13 }}>{m.content}</div>
            </div>
          );
        })}
      </div>

      <div style={{ display: "flex", gap: 10 }}>
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
          style={{
            flex: 1,
            padding: "10px 12px",
            borderRadius: 12,
            border: "1px solid var(--border)",
            background: "var(--bg-2)",
            color: "var(--text)"
          }}
        />
        <button
          onClick={send}
          style={{
            width: 120,
            borderRadius: 12,
            border: "1px solid var(--primary)",
            background: "var(--primary)",
            color: "#0b0e14",
            fontWeight: 700
          }}
        >
          Send
        </button>
      </div>
    </div>
  );
}
