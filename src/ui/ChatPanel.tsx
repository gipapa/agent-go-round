import { useEffect, useMemo, useRef, useState } from "react";
import { ChatMessage } from "../types";

type MessageSegment =
  | { type: "text"; content: string }
  | { type: "code"; content: string; language?: string };

function collectAdjacentToolMessages(messages: ChatMessage[], index: number) {
  const items: ChatMessage[] = [];

  for (let i = index - 1; i >= 0; i--) {
    const current = messages[i];
    if (current.role === "tool") {
      items.unshift(current);
      continue;
    }
    break;
  }

  for (let i = index + 1; i < messages.length; i++) {
    const current = messages[i];
    if (current.role === "tool") {
      items.push(current);
      continue;
    }
    break;
  }

  return items;
}

function initials(name: string) {
  return (name || "?")
    .trim()
    .slice(0, 2)
    .toUpperCase();
}

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function splitThinkContent(content: string) {
  const thoughts: string[] = [];
  const visible = content
    .replace(/<think>([\s\S]*?)<\/think>/gi, (_, body: string) => {
      const trimmed = body.trim();
      if (trimmed) thoughts.push(trimmed);
      return "";
    })
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return {
    visibleContent: visible,
    thoughts
  };
}

function parseMessageSegments(content: string): MessageSegment[] {
  const segments: MessageSegment[] = [];
  const pattern = /```([^\n\r`]*)\r?\n?([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(content)) !== null) {
    if (match.index > lastIndex) {
      const text = content.slice(lastIndex, match.index);
      if (text) segments.push({ type: "text", content: text });
    }

    segments.push({
      type: "code",
      language: match[1]?.trim() || undefined,
      content: match[2]?.replace(/\n$/, "") ?? ""
    });
    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < content.length) {
    const text = content.slice(lastIndex);
    if (text) segments.push({ type: "text", content: text });
  }

  return segments.length ? segments : [{ type: "text", content }];
}

async function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "true");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  document.execCommand("copy");
  area.remove();
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

function SkillTraceBlock(props: { label: string; content: string }) {
  const [expanded, setExpanded] = useState(false);
  const lineCount = useMemo(() => props.content.split(/\r?\n/).length, [props.content]);
  const collapsible = lineCount > 5;

  return (
    <div className="chat-trace-item">
      <div className="chat-trace-label">{props.label}</div>
      <pre className={`chat-tool-pre chat-trace-pre ${collapsible && !expanded ? "chat-trace-pre-clamped" : ""}`}>{props.content}</pre>
      {collapsible ? (
        <button type="button" className="chat-trace-toggle" onClick={() => setExpanded((current) => !current)}>
          {expanded ? "收合" : "展開全文"}
        </button>
      ) : null}
    </div>
  );
}

function formatSkillPhaseLabel(phase?: ChatMessage["skillPhase"]) {
  switch (phase) {
    case "skill_load":
      return "載入 skill";
    case "bootstrap_plan":
      return "建立 todo";
    case "observe":
      return "觀察";
    case "plan_next_step":
      return "規劃下一步";
    case "act":
      return "執行操作";
    case "sync_state":
      return "同步狀態";
    case "completion_gate":
      return "完成檢查";
    case "manual_gate":
      return "等待使用者";
    case "verify_refine":
      return "驗證與修正";
    case "final_answer":
      return "整理最終回覆";
    default:
      return "進行中";
  }
}

function formatTodoStatus(status: NonNullable<ChatMessage["skillTodo"]>[number]["status"]) {
  switch (status) {
    case "completed":
      return "已完成";
    case "in_progress":
      return "進行中";
    case "blocked":
      return "阻塞";
    default:
      return "待處理";
  }
}

function SkillTodoPanel(props: {
  goal?: string;
  phase?: ChatMessage["skillPhase"];
  todo: NonNullable<ChatMessage["skillTodo"]>;
}) {
  const activeItem = props.todo.find((item) => item.status === "in_progress");
  const blockedItems = props.todo.filter((item) => item.status === "blocked");

  return (
    <div className="chat-skill-todo">
      <div className="chat-skill-todo-header">
        <div className="chat-skill-todo-title">Multi-turn Todo</div>
        <div className="chat-skill-todo-phase">{formatSkillPhaseLabel(props.phase)}</div>
      </div>
      {props.goal ? (
        <div className="chat-skill-todo-goal">
          <span className="chat-skill-todo-goal-label">目標</span>
          <div className="chat-skill-todo-goal-text">{props.goal}</div>
        </div>
      ) : null}
      {activeItem ? (
        <div className="chat-skill-todo-focus">
          <span className="chat-skill-todo-goal-label">目前進行中</span>
          <div className="chat-skill-todo-focus-text">{activeItem.label}</div>
        </div>
      ) : null}
      {blockedItems.length ? (
        <div className="chat-skill-todo-focus blocked">
          <span className="chat-skill-todo-goal-label">目前阻塞</span>
          <div className="chat-skill-todo-focus-text">
            {blockedItems.map((item) => [item.label, item.reason].filter(Boolean).join("：")).join(" / ")}
          </div>
        </div>
      ) : null}
      <div className="chat-skill-todo-list">
        {props.todo.map((item) => (
          <div key={item.id} className={`chat-skill-todo-item ${item.status}`}>
            <div className="chat-skill-todo-item-main">
              <span className={`chat-skill-todo-badge ${item.status}`}>{formatTodoStatus(item.status)}</span>
              <span className="chat-skill-todo-item-label">{item.label}</span>
            </div>
            {item.reason ? <div className="chat-skill-todo-item-reason">{item.reason}</div> : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function CodeBlockCard(props: { content: string; language?: string }) {
  const [collapsed, setCollapsed] = useState(false);
  const [copied, setCopied] = useState(false);
  const lineCount = useMemo(() => props.content.split(/\r?\n/).length, [props.content]);

  return (
    <div className="chat-code-card">
      <div className="chat-code-header">
        <div className="chat-code-meta">
          <span className="chat-code-dot amber" />
          <span className="chat-code-dot cyan" />
          <span className="chat-code-label">{props.language || "CODE"}</span>
          <span className="chat-code-lines">{lineCount} lines</span>
        </div>
        <div className="chat-code-actions">
          <button
            type="button"
            className="chat-code-action"
            onClick={async () => {
              await copyText(props.content);
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1200);
            }}
          >
            {copied ? "已複製" : "複製"}
          </button>
          <button type="button" className="chat-code-action" onClick={() => setCollapsed((current) => !current)}>
            {collapsed ? "展開區塊" : "收起區塊"}
          </button>
        </div>
      </div>
      {!collapsed ? <pre className="chat-code-pre">{props.content}</pre> : <div className="chat-code-collapsed">程式碼區塊已收起</div>}
    </div>
  );
}

function MessageContent(props: { content: string }) {
  const segments = useMemo(() => parseMessageSegments(props.content), [props.content]);

  return (
    <div className="chat-rich-text">
      {segments.map((segment, index) =>
        segment.type === "code" ? (
          <CodeBlockCard key={`code-${index}`} content={segment.content} language={segment.language} />
        ) : (
          <div key={`text-${index}`} className="chat-message-text">
            {segment.content}
          </div>
        )
      )}
    </div>
  );
}

type ChatPanelProps = {
  history: ChatMessage[];
  onSend: (input: string) => Promise<void>;
  onDraftChange?: (value: string) => void;
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
  composerSeed?: { value: string; token: number } | null;
  onOpenToolResult?: (assistantMessageId: string) => void;
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
    props.onDraftChange?.("");
    await props.onSend(t);
    inputRef.current?.focus();
  };

  useEffect(() => {
    props.onDraftChange?.(text);
  }, [props.onDraftChange, text]);

  useEffect(() => {
    if (!props.composerSeed) return;
    setText(props.composerSeed.value);
    props.onDraftChange?.(props.composerSeed.value);
  }, [props.composerSeed]);

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
    <div className={`chat-shell ${props.fullscreen ? "chat-shell-fullscreen" : ""}`} data-tutorial-id="chat-shell">
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
          const isLeader = !!props.leaderName && m.role === "assistant" && m.name === props.leaderName;
          const isPhase = m.role === "system" && m.name === "phase";
          const { visibleContent, thoughts } = m.role === "assistant" ? splitThinkContent(m.content) : { visibleContent: m.content, thoughts: [] };
          const toolMessages = m.role === "assistant" ? collectAdjacentToolMessages(props.history, index) : [];
          const shouldHideStreamingContent = m.role === "assistant" && m.isStreaming && m.hideWhileStreaming;
          const renderedContent = shouldHideStreamingContent ? "" : visibleContent;
          const hasVisibleContent = renderedContent.trim().length > 0;
          const tone = m.role === "user" ? "user" : m.role === "tool" || m.role === "system" ? "system" : "assistant";
          const displayName =
            m.displayName ?? (m.role === "user" ? props.userName : m.role === "tool" ? "Tool" : m.role === "system" ? "System" : m.name || "Agent");

          if (m.role === "tool") {
            const prevNonTool = props.history.slice(0, index).reverse().find((item) => item.role !== "tool");
            const nextNonTool = props.history.slice(index + 1).find((item) => item.role !== "tool");
            if (prevNonTool?.role === "assistant" || nextNonTool?.role === "assistant") {
              return null;
            }
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
                {m.role === "assistant" && m.statusText ? (
                  <div className={`chat-status-pill ${m.isStreaming ? "live" : ""}`}>{m.statusText}</div>
                ) : null}
                <div className={`chat-bubble ${m.role} ${isLeader ? "leader" : ""}`}>
                  {hasVisibleContent ? <MessageContent content={renderedContent} /> : <div className="chat-status-placeholder">...</div>}
                </div>
                {m.role === "assistant" && thoughts.length > 0 ? (
                  <details className="chat-tool-details">
                    <summary>查看思考過程</summary>
                    <pre className="chat-tool-pre">{thoughts.join("\n\n")}</pre>
                  </details>
                ) : null}
                {m.role === "assistant" && m.skillTodo && m.skillTodo.length > 0 ? (
                  <SkillTodoPanel goal={m.skillGoal} phase={m.skillPhase} todo={m.skillTodo} />
                ) : null}
                {m.role === "assistant" && m.skillTrace && m.skillTrace.length > 0 ? (
                  <details className="chat-tool-details">
                    <summary>查看 skill 流程紀錄</summary>
                    <div className="chat-trace-actions">
                      <button
                        type="button"
                        className="chat-trace-copy-btn"
                        onClick={async () => {
                          const trace = m.skillTrace ?? [];
                          await copyText(
                            trace
                              .map((entry) => `## ${entry.label}\n${entry.content}`)
                              .join("\n\n")
                          );
                        }}
                      >
                        複製 skill debug
                      </button>
                    </div>
                    <div className="chat-trace-list">
                      {m.skillTrace.map((entry, traceIndex) => (
                        <SkillTraceBlock key={`${m.id}-skill-trace-${traceIndex}`} label={entry.label} content={entry.content} />
                      ))}
                    </div>
                  </details>
                ) : null}
                {m.role === "assistant" && toolMessages.length > 0 ? (
                  <details
                    className="chat-tool-details"
                    onToggle={(event) => {
                      if ((event.currentTarget as HTMLDetailsElement).open) {
                        props.onOpenToolResult?.(m.id);
                      }
                    }}
                  >
                    <summary>查看 tool result</summary>
                    <pre className="chat-tool-pre">{toolMessages.map((item) => item.content).join("\n\n---\n\n")}</pre>
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
          data-tutorial-id="chat-input"
        />
        <button onClick={send} className="chat-send-btn" data-tutorial-id="chat-send">
          Send
        </button>
      </div>
    </div>
  );
}

function ExportRawIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 12V5m0 0 2.5 2.5M8 5 5.5 7.5M3 3.5v-1h10v1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ExportSummaryIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 8.1V3.2m0 0 2 2M8 3.2 6 5.2M4.25 2.1h7.5" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="2.2" y="10.2" width="11.6" height="3.2" rx="1.6" fill="currentColor" fillOpacity="0.14" stroke="currentColor" strokeWidth="0.8" />
      <text x="8" y="12.55" textAnchor="middle" fontSize="3.55" fontWeight="700" fill="currentColor" fontFamily="Arial, sans-serif" letterSpacing="0.6">
        ZIP
      </text>
    </svg>
  );
}

function ImportIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 2v7m0 0 2.5-2.5M8 9 5.5 6.5M3 11.5v1h10v-1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ClearIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M5.5 2.5h5m-7 2h9l-.6 8.2a1 1 0 0 1-1 .8H5a1 1 0 0 1-1-.8L3.5 4.5Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6.5 6.5v4.25M9.5 6.5v4.25" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

function FullscreenIcon() {
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

function ExitFullscreenIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M4.5 4.5 11.5 11.5M11.5 4.5l-7 7"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
