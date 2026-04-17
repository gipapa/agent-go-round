import { useEffect, useMemo, useRef, useState } from "react";
import { ChatMessage, MagiRenderState, MagiUnitId, MagiVerdict, OrchestratorMode, RadioSessionState } from "../types";

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
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    // Fall through to textarea fallback below.
  }

  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "true");
  area.style.position = "fixed";
  area.style.opacity = "0";
  area.style.pointerEvents = "none";
  document.body.appendChild(area);
  area.focus();
  area.select();
  area.setSelectionRange(0, area.value.length);
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

function formatMagiVerdict(verdict?: MagiVerdict) {
  switch (verdict) {
    case "APPROVE":
      return "承認 (APPROVE)";
    case "REJECT":
      return "否決 (REJECT)";
    case "ABSTAIN":
      return "棄權 (ABSTAIN)";
    case "DEADLOCK":
      return "膠着 (DEADLOCK)";
    default:
      return "討論中";
  }
}

function magiVerdictTone(verdict?: MagiVerdict) {
  switch (verdict) {
    case "APPROVE":
      return "approve";
    case "REJECT":
      return "reject";
    case "ABSTAIN":
      return "abstain";
    case "DEADLOCK":
      return "deadlock";
    default:
      return "pending";
  }
}

function formatMagiDecisionMeta(verdict?: MagiVerdict) {
  switch (verdict) {
    case "APPROVE":
      return "Majority voted yes";
    case "REJECT":
      return "Majority voted no";
    case "ABSTAIN":
      return "At least two units abstained";
    case "DEADLOCK":
      return "One unit approved, one rejected, one abstained, or the system encountered an error";
    default:
      return "Waiting for all three systems";
  }
}

function formatMagiUnitStatus(status: NonNullable<MagiRenderState["units"]>[number]["status"]) {
  switch (status) {
    case "thinking":
      return "THINKING";
    case "voted":
      return "VOTED";
    case "revised":
      return "REVISED";
    case "error":
      return "ERROR";
    default:
      return "PENDING";
  }
}

function magiUnitClass(unitId: MagiUnitId) {
  switch (unitId) {
    case "Balthasar":
      return "top";
    case "Casper":
      return "left";
    case "Melchior":
      return "right";
  }
}

function MagiPanel(props: { state: MagiRenderState }) {
  const [showBoard, setShowBoard] = useState(true);
  const balthasar = props.state.units.find((unit) => unit.unitId === "Balthasar");
  const casper = props.state.units.find((unit) => unit.unitId === "Casper");
  const melchior = props.state.units.find((unit) => unit.unitId === "Melchior");

  const renderUnit = (unit: typeof balthasar) =>
    unit ? (
      <div className={`magi-unit-card ${unit.status} ${magiVerdictTone(unit.verdict)}`}>
        <div className="magi-unit-name">
          {unit.unitId} · {unit.unitNumber}
        </div>
        <div className={`magi-unit-status ${unit.status}`}>{formatMagiUnitStatus(unit.status)}</div>
        <div className="magi-unit-verdict">{unit.verdict ? formatMagiVerdict(unit.verdict) : "思考中"}</div>
        <div className="magi-unit-confidence">{unit.confidence !== undefined ? `${unit.confidence}%` : "—"}</div>
        <div className="magi-unit-summary">{unit.error ?? unit.summary ?? unit.rationale ?? "正在分析提訴…"}</div>
      </div>
    ) : null;

  return (
    <div className={`magi-panel ${props.state.status}`}>
      <div className="magi-panel-header">
        <div className="magi-panel-header-title">S.C. MAGI VISUAL BOARD</div>
        <button type="button" className="magi-panel-close" onClick={() => setShowBoard((current) => !current)}>
          {showBoard ? "關閉視覺板" : "顯示視覺板"}
        </button>
      </div>

      {showBoard ? (
        <div className="magi-grid">
          <div className="magi-side magi-side-left">
            <div className="magi-side-title">提訴</div>
            <div className="magi-side-code">CODE:{props.state.code}</div>
            <div className="magi-side-meta">FILE:{props.state.file}</div>
            <div className="magi-side-meta">EXT:{props.state.ext}</div>
            <div className="magi-side-meta">EX_MODE:{props.state.exMode}</div>
            <div className="magi-side-meta">PRIORITY:{props.state.priority}</div>
          </div>

          <div className={`magi-unit ${magiUnitClass("Balthasar")} ${balthasar?.status ?? "pending"}`}>{renderUnit(balthasar)}</div>

          <div className={`magi-unit ${magiUnitClass("Casper")} ${casper?.status ?? "pending"}`}>{renderUnit(casper)}</div>

          <div className={`magi-unit ${magiUnitClass("Melchior")} ${melchior?.status ?? "pending"}`}>{renderUnit(melchior)}</div>

          <div className="magi-center-core">
            <div className="magi-center-title">MAGI</div>
            <div className={`magi-center-verdict ${magiVerdictTone(props.state.finalVerdict)}`}>
              {formatMagiVerdict(props.state.finalVerdict)}
            </div>
            <div className="magi-center-mode">{props.state.mode === "magi_vote" ? "三賢人同時表決" : "三賢人共識協商"}</div>
            <div className="magi-center-question">{props.state.question}</div>
          </div>

          <div className="magi-side magi-side-right">
            <div className="magi-side-title">決議</div>
            <div className={`magi-decision-box ${magiVerdictTone(props.state.finalVerdict)}`}>
              <div className="magi-decision-main">{formatMagiVerdict(props.state.finalVerdict)}</div>
              <div className="magi-decision-subtext">{formatMagiDecisionMeta(props.state.finalVerdict)}</div>
            </div>
            <div className="magi-info-box">
              <div className="magi-info-label">情報</div>
              <div className="magi-info-text">{props.state.informationText ?? "SYSTEM BOOT"}</div>
              <div className="magi-info-round">ROUND {props.state.round}</div>
            </div>
          </div>
        </div>
      ) : null}

      {props.state.finalSummary ? (
        <div className="magi-summary-box">
          <div className="magi-summary-label">決議摘要</div>
          <div className="magi-summary-text">{props.state.finalSummary}</div>
        </div>
      ) : null}

      <div className="magi-transcript">
        <div className="magi-transcript-header">
          <div className="magi-transcript-title">對話紀錄</div>
          <div className="magi-transcript-status">{props.state.status === "running" ? "執行中" : props.state.status === "failed" ? "失敗" : "完成"}</div>
        </div>
        <div className="magi-transcript-list">
          {props.state.transcript.length === 0 ? (
            <div className="magi-transcript-empty">等待三賢人開始審議…</div>
          ) : (
            props.state.transcript.map((entry) => (
              <div key={entry.id} className={`magi-transcript-entry ${entry.kind}`}>
                <div className="magi-transcript-meta">
                  <span>{entry.speaker}</span>
                  <span>R{entry.round}</span>
                  <span>{entry.label}</span>
                </div>
                <div className="magi-transcript-content">{entry.content}</div>
              </div>
            ))
          )}
        </div>
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
  mode: OrchestratorMode;
  modeLabel: string;
  isSummaryExporting?: boolean;
  fullscreen?: boolean;
  onOpenFullscreen?: () => void;
  onCloseFullscreen?: () => void;
  composerSeed?: { value: string; token: number } | null;
  onOpenToolResult?: (assistantMessageId: string) => void;
  radioState?: RadioSessionState;
  onStartRadioSession?: () => void;
  onStopRadioSession?: () => void;
  onForceRadioTurn?: () => void;
};

function isRadioSessionActive(status?: RadioSessionState["status"]) {
  return !!status && status !== "idle" && status !== "error";
}

function canForceRadioTurn(state?: RadioSessionState) {
  if (!state) return false;
  if (state.turn === "human") {
    return state.status === "human_listening" || state.status === "human_transcribing" || state.status === "paused";
  }
  return state.status === "agent_speaking";
}

export default function ChatPanel(props: ChatPanelProps) {
  const [text, setText] = useState("");
  const [radioOverlayOpen, setRadioOverlayOpen] = useState(true);
  const [radioRefineModalOpen, setRadioRefineModalOpen] = useState(false);
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
      if (typeof node.scrollIntoView === "function") {
        node.scrollIntoView({ block: "end" });
      }
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

  useEffect(() => {
    if (props.mode === "radio") {
      setRadioOverlayOpen(true);
    }
  }, [props.mode]);

  const emptyLabel = useMemo(
    () =>
      props.mode === "one_to_one"
        ? props.leaderName
          ? `Send a goal to ${props.leaderName} and the team will coordinate here.`
          : "Just type to start the conversation."
        : props.mode === "radio"
        ? "啟動對講機模式後，系統會持續累積語音草稿；說完停一下，系統就會自動送出。"
        : "輸入提訴內容後，S.C. MAGI 會開始裁決。",
    [props.leaderName, props.mode]
  );

  const radioSessionActive = isRadioSessionActive(props.radioState?.status);
  const radioForceEnabled = canForceRadioTurn(props.radioState);
  const refinedPreview = props.radioState?.draftTranscriptRefinedPreview ?? "";
  const refinedPreviewNeedsModal = useMemo(() => {
    const normalized = refinedPreview.trim();
    if (!normalized) return false;
    const lineCount = normalized.split(/\r?\n/).length;
    return normalized.length > 180 || lineCount > 5;
  }, [refinedPreview]);

  return (
    <div className={`chat-shell ${props.fullscreen ? "chat-shell-fullscreen" : ""} ${props.mode === "radio" ? "radio-mode-shell" : ""}`} data-tutorial-id="chat-shell">
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

      <div className={`chat-thread ${props.fullscreen ? "chat-thread-fullscreen" : ""} ${props.mode === "radio" ? "chat-thread-radio" : ""}`}>
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
                {m.role === "assistant" && m.magiState ? <MagiPanel state={m.magiState} /> : null}
                {hasVisibleContent && !m.magiState ? (
                  <div className={`chat-bubble ${m.role} ${isLeader ? "leader" : ""}`}>
                    <MessageContent content={renderedContent} />
                  </div>
                ) : null}
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

      {props.mode === "radio" ? (
        <>
          {radioOverlayOpen ? (
            <div className={`radio-overlay ${props.fullscreen ? "radio-overlay-fullscreen" : ""}`}>
              <button
                type="button"
                className="radio-overlay-close"
                onClick={() => setRadioOverlayOpen(false)}
                aria-label="Hide radio panel"
                title="Hide radio panel"
              >
                ×
              </button>
              <div className="radio-overlay-device">
                <div className="radio-device-svg-wrap">
                  <svg className="radio-device-svg" viewBox="0 0 320 520" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                    <rect x="70" y="70" width="180" height="360" rx="28" fill="#1F2937" />
                    <rect x="82" y="82" width="156" height="336" rx="22" fill="#111827" />
                    <rect x="205" y="25" width="18" height="60" rx="8" fill="#0F172A" />
                    <rect x="190" y="40" width="20" height="18" rx="6" fill="#374151" />
                    <circle cx="112" cy="82" r="14" fill="#374151" />
                    <circle cx="150" cy="82" r="14" fill="#4B5563" />
                    <rect x="105" y="115" width="110" height="90" rx="12" fill="#1F2937" stroke="#4B5563" strokeWidth="2" />
                    <line x1="118" y1="132" x2="202" y2="132" stroke="#6B7280" strokeWidth="4" strokeLinecap="round" />
                    <line x1="118" y1="147" x2="202" y2="147" stroke="#6B7280" strokeWidth="4" strokeLinecap="round" />
                    <line x1="118" y1="162" x2="202" y2="162" stroke="#6B7280" strokeWidth="4" strokeLinecap="round" />
                    <line x1="118" y1="177" x2="202" y2="177" stroke="#6B7280" strokeWidth="4" strokeLinecap="round" />
                    <rect x="105" y="225" width="110" height="54" rx="10" fill="#0EA5E9" />
                    <rect x="113" y="233" width="94" height="38" rx="6" fill="#BAE6FD" />
                    <rect x="52" y="170" width="22" height="95" rx="10" fill="#F59E0B" />
                    <rect x="248" y="165" width="14" height="42" rx="7" fill="#374151" />
                    <rect x="248" y="218" width="14" height="42" rx="7" fill="#374151" />
                    <circle cx="122" cy="318" r="14" fill="#374151" />
                    <circle cx="160" cy="318" r="14" fill="#374151" />
                    <circle cx="198" cy="318" r="14" fill="#374151" />
                    <rect x="125" y="348" width="70" height="70" rx="16" fill="#1F2937" stroke="#4B5563" strokeWidth="2" />
                    <rect x="151" y="358" width="18" height="50" rx="8" fill="#6B7280" />
                    <rect x="135" y="374" width="50" height="18" rx="8" fill="#6B7280" />
                    <circle
                      cx="210"
                      cy="318"
                      r="5"
                      fill={props.radioState?.status === "error" ? "#FB7185" : radioSessionActive ? "#22C55E" : "#94A3B8"}
                    />
                    <path d="M95 95C102 88 112 84 122 84H138" stroke="#374151" strokeWidth="6" strokeLinecap="round" opacity="0.7" />
                  </svg>
                  <div
                    className={`radio-device-screen-indicator ${
                      props.radioState?.status === "error"
                        ? "error"
                        : props.radioState?.turn === "agent"
                        ? "agent"
                        : radioSessionActive
                        ? "human"
                        : "idle"
                    }`}
                  />
                </div>
                <div className="radio-status-row radio-status-row-centered">
                  <div className="radio-status-pill">輪到：{props.radioState?.turn === "agent" ? "Agent" : "Human"}</div>
                  <div className="radio-status-pill">狀態：{formatRadioStatusLabel(props.radioState?.status)}</div>
                </div>
              </div>
              <div className="radio-overlay-meta">
                {props.radioState?.draftTranscriptRaw.trim() ? (
                  <div className="radio-draft-card">
                    <div className="radio-draft-label">Live Transcript Draft</div>
                    <div className="radio-draft-text">{props.radioState.draftTranscriptRaw}</div>
                    {props.radioState.draftTranscriptRefinedPreview ? (
                      <>
                        <div className="radio-draft-label refined">Refined Preview</div>
                        <div className="radio-draft-text refined radio-draft-text-fixed">{props.radioState.draftTranscriptRefinedPreview}</div>
                        {refinedPreviewNeedsModal ? (
                          <button type="button" className="radio-preview-expand-btn" onClick={() => setRadioRefineModalOpen(true)}>
                            查看全文
                          </button>
                        ) : null}
                      </>
                    ) : null}
                  </div>
                ) : null}
                {props.radioState?.lastError ? <div className="radio-error-banner">{props.radioState.lastError}</div> : null}
                {props.radioState?.lastNotice ? <div className="radio-notice-banner">{props.radioState.lastNotice}</div> : null}
                <div className="radio-actions">
                  <button
                    type="button"
                    onClick={radioSessionActive ? props.onStopRadioSession : props.onStartRadioSession}
                    className={`chat-send-btn radio-toggle-btn ${radioSessionActive ? "active" : ""}`}
                    data-radio-action={radioSessionActive ? "stop" : "start"}
                  >
                    {radioSessionActive ? "Stop Session" : "Start Session"}
                  </button>
                  <button
                    type="button"
                    onClick={props.onForceRadioTurn}
                    className="chat-clear-btn radio-force-btn"
                    data-radio-action="force"
                    disabled={!radioForceEnabled}
                    title={radioForceEnabled ? "Force turn switch" : "目前這個階段無法強制切換"}
                  >
                    強制換回合
                  </button>
                </div>
                {!props.radioState?.draftTranscriptRaw.trim() ? <div className="radio-draft-empty">尚未收到語音草稿。</div> : null}
              </div>
            </div>
          ) : (
            <button type="button" className="radio-overlay-reopen" onClick={() => setRadioOverlayOpen(true)} aria-label="Open radio panel">
              <span className="radio-overlay-reopen-icon">RADIO</span>
            </button>
          )}
          {radioRefineModalOpen && refinedPreview.trim() ? (
            <div className="radio-preview-modal-backdrop" onClick={() => setRadioRefineModalOpen(false)}>
              <div className="radio-preview-modal" onClick={(event) => event.stopPropagation()}>
                <div className="radio-preview-modal-header">
                  <div className="radio-preview-modal-title">Refined Preview</div>
                  <button
                    type="button"
                    className="radio-preview-modal-close"
                    onClick={() => setRadioRefineModalOpen(false)}
                    aria-label="Close refined preview"
                  >
                    ×
                  </button>
                </div>
                <div className="radio-preview-modal-body">{refinedPreview}</div>
              </div>
            </div>
          ) : null}
        </>
      ) : (
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
      )}
    </div>
  );
}

function formatRadioStatusLabel(status?: RadioSessionState["status"]) {
  switch (status) {
    case "requesting_permission":
      return "請求權限中";
    case "human_listening":
      return "人類發話中";
    case "human_transcribing":
      return "轉寫中";
    case "refining_user_turn":
      return "整理語句中";
    case "sending_to_agent":
      return "送往 Agent";
    case "agent_thinking":
      return "Agent 思考中";
    case "agent_synthesizing":
      return "語音合成中";
    case "agent_speaking":
      return "Agent 播音中";
    case "paused":
      return "已暫停";
    case "error":
      return "錯誤";
    case "idle":
    default:
      return "尚未開始";
  }
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
