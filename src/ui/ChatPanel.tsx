import { useState } from "react";
import { ChatMessage } from "../types";

export default function ChatPanel(props: { history: ChatMessage[]; onSend: (input: string) => Promise<void>; onClear: () => void }) {
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
          style={{ borderRadius: 10, border: "1px solid #2a2f45", background: "#151827", color: "white", padding: "6px 10px", fontSize: 12 }}
        >
          Clear chat
        </button>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: 6 }}>
        {props.history.map((m) => (
          <div key={m.id} style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 12, opacity: 0.7 }}>
              {m.role}
              {m.name ? ` · ${m.name}` : ""}
            </div>
            <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{m.content}</div>
          </div>
        ))}
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
            border: "1px solid #222636",
            background: "#0f1118",
            color: "white"
          }}
        />
        <button
          onClick={send}
          style={{
            width: 120,
            borderRadius: 12,
            border: "1px solid #4456ff",
            background: "#1a2255",
            color: "white",
            fontWeight: 700
          }}
        >
          Send
        </button>
      </div>
    </div>
  );
}
