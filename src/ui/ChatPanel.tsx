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

function HeaderIconButton(props: {
  title: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      className="chat-clear-btn chat-icon-btn"
      title={props.title}
      aria-label={props.title}
      disabled={props.disabled}
    >
      {props.children}
    </button>
  );
}

type ChatPanelProps = {
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
  fullscreen?: boolean;
  onOpenFullscreen?: () => void;
  onCloseFullscreen?: () => void;
};

export default function ChatPanel(props: ChatPanelProps) {
  const [text, setText] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const threadEndRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const send = async () => {
    const t = text.trim();
    if (!t) return;
    setText("");
    await props.onSend(t);
    inputRef.current?.focus();
  };

  useEffect(() => {
    const node = threadEndRef.current;
    if (!node) return;
    const raf = window.requestAnimationFrame(() => {
      node.scrollIntoView({ block: "end" });
    });
    return () => window.cancelAnimationFrame(raf);
  }, [props.history, text, props.fullscreen]);

  useEffect(() => {
    if (!props.fullscreen) return;
    const raf = window.requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(raf);
  }, [props.fullscreen]);

  const emptyLabel = useMemo(
    () => (props.leaderName ? `Send a goal to ${props.leaderName} and the team will coordinate here.` : "Just type to start the conversation."),
    [props.leaderName]
  );

  return (
    <div className={`chat-shell ${props.fullscreen ? "chat-shell-fullscreen" : ""}`}>
      <div className={`chat-header ${props.fullscreen ? "chat-header-fullscreen" : ""}`}>
        <div>
          <div className="chat-title">Conversation</div>
          <div className="chat-subtitle">{props.fullscreen ? `${props.modeLabel} · 全頁模式` : props.modeLabel}</div>
        </div>
        <div className="chat-header-actions">
          {props.fullscreen ? (
            <HeaderIconButton title="離開全頁模式" onClick={() => props.onCloseFullscreen?.()}>
              <ExitFullscreenIcon />
            </HeaderIconButton>
          ) : (
            <>
              <HeaderIconButton title="匯出對話歷史(原始檔)" onClick={props.onExportRaw}>
                <ExportRawIcon />
              </HeaderIconButton>
              <HeaderIconButton
                title={props.isSummaryExporting ? "匯出對話歷史(濃縮) - 濃縮中..." : "匯出對話歷史(濃縮)"}
                onClick={() => void props.onExportSummary()}
                disabled={props.isSummaryExporting}
              >
                <ExportSummaryIcon />
              </HeaderIconButton>
              <HeaderIconButton title="匯入對話歷史" onClick={() => fileInputRef.current?.click()}>
                <ImportIcon />
              </HeaderIconButton>
              <HeaderIconButton title="Clear chat" onClick={props.onClear}>
                <ClearIcon />
              </HeaderIconButton>
              <HeaderIconButton title="全頁模式" onClick={() => props.onOpenFullscreen?.()}>
                <FullscreenIcon />
              </HeaderIconButton>
            </>
          )}
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

      <div className={`chat-thread ${props.fullscreen ? "chat-thread-fullscreen" : ""}`}>
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
        <div ref={threadEndRef} className="chat-thread-end" aria-hidden="true" />
      </div>

      <div className={`chat-composer ${props.fullscreen ? "chat-composer-fullscreen" : ""}`}>
        <textarea
          ref={inputRef}
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

function ExportRawIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 2v7m0 0 2.5-2.5M8 9 5.5 6.5M3 11.5v1h10v-1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ExportSummaryIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M4 3.5h8M4 6.5h8M4 9.5h5M10.5 11.5l1.25 1.25L14 10.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ImportIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 12V5m0 0 2.5 2.5M8 5 5.5 7.5M3 3.5v-1h10v1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ClearIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M4.5 4.5 11.5 11.5M11.5 4.5l-7 7M5.5 2.5h5m-7 2h9l-.6 8.2a1 1 0 0 1-1 .8H5a1 1 0 0 1-1-.8L3.5 4.5Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function FullscreenIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M5.5 2.5H2.5v3M10.5 2.5h3v3M13.5 10.5v3h-3M2.5 10.5v3h3M2.5 5.5l4-4M13.5 5.5l-4-4M2.5 10.5l4 4M13.5 10.5l-4 4"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ExitFullscreenIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M6.25 2.5h-3.75v3.75M9.75 2.5h3.75v3.75M13.5 9.75v3.75H9.75M2.5 9.75v3.75h3.75M6.5 6.5 2.5 2.5M9.5 6.5l4-4M6.5 9.5l-4 4M9.5 9.5l4 4"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
