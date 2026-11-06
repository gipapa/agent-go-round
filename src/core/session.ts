import { Agent, type AgentEvent, type AgentMessage, type AgentTool, type StreamFn } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, Model, TSchema } from "@earendil-works/pi-ai";
import { SessionPersistenceError, type InputTokenBudget, type SessionSnapshot, type SessionStore } from "./persistence";
import type { FileAccess, FileAccessRecorder } from "./fs";

export type RunStatus = "success" | "aborted" | "deadline" | "error" | "outcome_unknown" | "output_limit";

export const DEFAULT_AUTO_COMPACT_PERCENT = 40 as const;

export const SESSION_EVENT_VERSION = 1 as const;
export type FileReadRange = { startLine: number; endLine: number; totalLines: number };
export type ContextSource = { kind: "agents" | "skill"; path: string; revision: number };

type SessionEventPayload =
  | { type: "context_loaded"; runId: string; source: ContextSource; toolCallId?: string }
  | { type: "file_access"; runId: string; toolCallId: string; method: string; path: string; revision?: number; readRange?: FileReadRange }
  | { type: "tool_result_ready"; runId: string; toolCallId: string }
  | { type: "run_started"; runId: string; input: string }
  | { type: "compaction_started"; runId: string; reason: "context" | "input_limit" }
  | { type: "compaction_finished"; runId: string; reason: "context" | "input_limit"; removedTurns: number }
  | { type: "request_retry"; runId: string; reason: "input_limit"; attempt: number }
  | { type: "text_delta"; runId: string; delta: string }
  | { type: "run_finished"; runId: string; status: RunStatus; text: string; error?: string }
  | { type: "tool_started"; runId: string; toolCallId: string; toolName: string }
  | { type: "tool_approval_requested"; runId: string; toolCallId: string; toolName: string }
  | { type: "tool_approval_resolved"; runId: string; toolCallId: string; toolName: string; approved: boolean; reason?: string }
  | { type: "tool_blocked"; runId: string; toolCallId: string; toolName: string; reason: string }
  | { type: "tool_outcome_unknown"; runId: string; toolCallId: string; toolName: string; reason: string }
  | { type: "tool_finished"; runId: string; toolCallId: string; toolName: string; isError: boolean };

export type SessionEvent = SessionEventPayload & {
  version: typeof SESSION_EVENT_VERSION;
  sessionId: string;
};

export type ContextUsage = {
  usedTokens: number;
  contextWindow: number;
  percent: number;
  autoCompactPercent: number;
  inputTokenLimit?: number;
  compactTargetTokens: number;
};

function estimateTextTokens(text: string): number { return Math.ceil(text.length / 4); }
function estimateValueTokens(value: unknown): number {
  if (value === undefined || value === null) return 0;
  if (Array.isArray(value) && value.length === 0) return 0;
  try { return estimateTextTokens(JSON.stringify(value) ?? ""); }
  catch { return estimateTextTokens(String(value)); }
}
function estimateContentTokens(content: unknown): number {
  if (typeof content === "string") return estimateTextTokens(content);
  if (!Array.isArray(content)) return estimateValueTokens(content);
  return content.reduce((total, block) => {
    if (block && typeof block === "object" && "type" in block && block.type === "text" && typeof block.text === "string") return total + estimateTextTokens(block.text);
    if (block && typeof block === "object" && "type" in block && block.type === "thinking" && typeof block.thinking === "string") return total + estimateTextTokens(block.thinking);
    return total + estimateValueTokens(block);
  }, 0);
}
function estimateMessageTokens(message: AgentMessage): number {
  return "content" in message ? estimateContentTokens(message.content) : estimateValueTokens(message);
}
function estimateContextTokens(systemPrompt: string, messages: readonly AgentMessage[], tools: readonly SessionTool[]): number {
  return estimateTextTokens(systemPrompt) + estimateValueTokens(tools) + messages.reduce((total, message) => total + estimateMessageTokens(message), 0);
}

type CompactResult = { messages: AgentMessage[]; removed: number };
function compactMessages(systemPrompt: string, messages: readonly AgentMessage[], tools: readonly SessionTool[], targetTokens: number): CompactResult {
  const groups: AgentMessage[][] = [];
  let current: AgentMessage[] = [];
  for (const message of messages) {
    if (message.role === "user" && current.length) { groups.push(current); current = []; }
    current.push(message);
  }
  if (current.length) groups.push(current);
  if (groups.length < 2 || estimateContextTokens(systemPrompt, messages, tools) <= targetTokens) return { messages: [...messages], removed: 0 };

  const fixedTokens = estimateTextTokens(systemPrompt) + estimateValueTokens(tools);
  const messageBudget = Math.max(1, targetTokens - fixedTokens);
  const kept: AgentMessage[][] = [];
  let keptTokens = 0;
  for (let index = groups.length - 1; index >= 0; index--) {
    const group = groups[index];
    const groupTokens = group.reduce((total, message) => total + estimateMessageTokens(message), 0);
    if (kept.length > 0 && keptTokens + groupTokens > messageBudget) break;
    kept.unshift(group);
    keptTokens += groupTokens;
  }
  const removed = groups.length - kept.length;
  if (!removed) return { messages: [...messages], removed: 0 };
  const summary: AgentMessage = {
    role: "user",
    content: `[Auto compacted ${removed} old turn${removed === 1 ? "" : "s"}; files are current.]`,
    timestamp: Date.now()
  };
  return { messages: [summary, ...kept.flat()], removed };
}

export interface SessionEventStore {
  append(event: SessionEvent): void;
  list(sessionId?: string): readonly SessionEvent[];
}

export class MemorySessionEventStore implements SessionEventStore {
  private readonly events: SessionEvent[] = [];

  append(event: SessionEvent): void {
    this.events.push(event);
  }

  list(sessionId?: string): readonly SessionEvent[] {
    return this.events.filter((event) => sessionId === undefined || event.sessionId === sessionId);
  }

  clear(): void {
    this.events.length = 0;
  }
}

export type UnfinishedRun = {
  runId: string;
  status: "interrupted" | "outcome_unknown";
  pendingToolCallIds: string[];
};

export type SessionRecovery = {
  sessionId: string;
  unfinishedRuns: UnfinishedRun[];
};

/** Reconstructs recovery metadata only; it never calls a model or re-executes a tool. */
export function inspectSessionRecovery(events: readonly SessionEvent[], sessionId = events[0]?.sessionId ?? ""): SessionRecovery {
  const runs = new Map<string, { finished: boolean; outcomeUnknown: boolean; pendingToolCallIds: Set<string> }>();
  for (const event of events) {
    const run = runs.get(event.runId) ?? { finished: false, outcomeUnknown: false, pendingToolCallIds: new Set<string>() };
    if (event.type === "tool_started") run.pendingToolCallIds.add(event.toolCallId);
    if (event.type === "tool_finished") run.pendingToolCallIds.delete(event.toolCallId);
    if (event.type === "tool_outcome_unknown") run.outcomeUnknown = true;
    if (event.type === "run_finished") run.finished = true;
    runs.set(event.runId, run);
  }
  return {
    sessionId,
    unfinishedRuns: [...runs.entries()]
      .filter(([, run]) => !run.finished)
      .map(([runId, run]) => ({ runId, status: run.outcomeUnknown ? "outcome_unknown" : "interrupted", pendingToolCallIds: [...run.pendingToolCallIds] }))
  };
}

export type RunResult = {
  runId: string;
  status: RunStatus;
  text: string;
  error?: string;
};

/** Throw when a side-effecting tool was sent but its final outcome cannot be confirmed. */
export class ToolOutcomeUnknownError extends Error {
  readonly code = "outcome_unknown" as const;

  constructor(message = "Tool outcome is unknown") {
    super(message);
    this.name = "ToolOutcomeUnknownError";
  }
}

export type SessionTool<TParameters extends TSchema = TSchema, TDetails = any> = AgentTool<TParameters, TDetails> & {
  /** Mutation-like tools can require an explicit host approval before execution. */
  requiresApproval?: boolean;
};

export type ToolApprovalRequest = {
  sessionId: string;
  runId: string;
  toolCallId: string;
  toolName: string;
  args: unknown;
  signal: AbortSignal;
};

export type ToolApproval = (request: ToolApprovalRequest) => boolean | Promise<boolean>;

export class SessionBusyError extends Error {
  readonly code = "session_busy" as const;

  constructor(sessionId: string) {
    super(`Session ${sessionId} is already running`);
    this.name = "SessionBusyError";
  }
}

export type AgentSessionOptions = {
  sessionId: string;
  model: Model<any>;
  streamFn: StreamFn;
  systemPrompt?: string;
  tools?: readonly SessionTool[];
  approval?: ToolApproval;
  maxToolCalls?: number;
  /** Maximum wall-clock duration for one prompt, including approval waits. */
  deadlineMs?: number;
  /** Maximum number of assistant text characters emitted by one prompt. */
  maxOutputCharacters?: number;
  autoCompactPercent?: number;
  inputTokenBudget?: InputTokenBudget;
  eventStore?: SessionEventStore;
  initialMessages?: readonly AgentMessage[];
  activeSkill?: string;
};

function makeId(prefix: string): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return uuid ? `${prefix}-${uuid}` : `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function textFromAssistant(message: AssistantMessage | undefined): string {
  return message?.content
    .filter((block): block is Extract<typeof block, { type: "text" }> => block.type === "text")
    .map((block) => block.text)
    .join("") ?? "";
}

/**
 * Product-owned run boundary around Pi's single Agent loop.
 *
 * The boundary owns run identity, busy rejection, abort and public events;
 * Pi owns transcript ordering and the model loop itself.
 */
export class AgentSession {
  readonly sessionId: string;
  readonly agent: Agent;
  activeSkill?: string;
  private activeRun?: { runId: string; toolCallCount: number; unknownOutcome: boolean; unknownToolCalls: Set<string>; stopRequested: boolean; deadlineExceeded: boolean; outputLimitExceeded: boolean; outputCharacters: number; deadlineTimer?: ReturnType<typeof setTimeout> };
  private readonly listeners = new Set<(event: SessionEvent) => void>();
  private toolsByName: ReadonlyMap<string, SessionTool>;
  private readonly approval?: ToolApproval;
  private readonly maxToolCalls?: number;
  private readonly deadlineMs?: number;
  private readonly maxOutputCharacters?: number;
  private autoCompactPercent: number;
  private readonly eventStore?: SessionEventStore;
  private contextSources: ContextSource[] = [];
  private inputTokenBudget?: InputTokenBudget;
  private budgetModelKey: string;
  private lastRequestTokens = 0;

  constructor(options: AgentSessionOptions) {
    this.sessionId = options.sessionId;
    this.activeSkill = options.activeSkill;
    this.inputTokenBudget = options.inputTokenBudget;
    this.budgetModelKey = this.modelKey(options.model);
    if (options.maxToolCalls !== undefined && (!Number.isInteger(options.maxToolCalls) || options.maxToolCalls < 0)) {
      throw new Error("maxToolCalls must be a non-negative integer");
    }
    if (options.deadlineMs !== undefined && (!Number.isInteger(options.deadlineMs) || options.deadlineMs <= 0)) {
      throw new Error("deadlineMs must be a positive integer");
    }
    if (options.maxOutputCharacters !== undefined && (!Number.isInteger(options.maxOutputCharacters) || options.maxOutputCharacters < 0)) {
      throw new Error("maxOutputCharacters must be a non-negative integer");
    }
    this.autoCompactPercent = options.autoCompactPercent ?? DEFAULT_AUTO_COMPACT_PERCENT;
    if (!Number.isInteger(this.autoCompactPercent) || this.autoCompactPercent < 1 || this.autoCompactPercent > 99) throw new Error("autoCompactPercent must be an integer between 1 and 99");
    const tools = this.prepareTools(options.tools ?? []);
    this.toolsByName = new Map(tools.map((tool) => [tool.name.toLowerCase(), tool]));
    this.approval = options.approval;
    this.maxToolCalls = options.maxToolCalls;
    this.deadlineMs = options.deadlineMs;
    this.maxOutputCharacters = options.maxOutputCharacters;
    this.eventStore = options.eventStore;
    this.agent = new Agent({
      initialState: {
        model: options.model,
        systemPrompt: options.systemPrompt ?? "",
        thinkingLevel: "off",
        messages: [...(options.initialMessages ?? [])],
        tools
      },
      sessionId: options.sessionId,
      streamFn: options.streamFn,
      toolExecution: "sequential",
      maxRetryDelayMs: 60_000,
      beforeToolCall: (context, signal) => this.beforeToolCall(context, signal),
      afterToolCall: (context, signal) => this.afterToolCall(context, signal),
      shouldStopAfterTurn: () => this.activeRun?.unknownOutcome === true,
      transformContext: async (messages) => this.compactContext(messages)
    });
  }

  get isRunning(): boolean {
    return this.activeRun !== undefined;
  }

  getAutoCompactPercent(): number { return this.autoCompactPercent; }

  setAutoCompactPercent(percent: number): void {
    if (!Number.isInteger(percent) || percent < 1 || percent > 99) throw new Error("autoCompactPercent must be an integer between 1 and 99");
    this.autoCompactPercent = percent;
  }

  contextUsage(): ContextUsage {
    const modelWindow = this.agent.state.model.contextWindow;
    const contextWindow = Number.isSafeInteger(modelWindow) && modelWindow > 0 ? modelWindow : 128_000;
    const budget = this.currentInputTokenBudget();
    const scale = budget?.estimateScale ?? 1;
    const usedTokens = Math.ceil(estimateContextTokens(this.agent.state.systemPrompt, this.agent.state.messages, this.agent.state.tools as SessionTool[]) * scale);
    return { usedTokens, contextWindow, percent: Math.round((usedTokens / contextWindow) * 100), autoCompactPercent: this.autoCompactPercent,
      compactTargetTokens: Math.floor(this.compactTargetTokens() * scale), ...(budget ? { inputTokenLimit: budget.limit } : {}) };
  }

  recovery(): SessionRecovery {
    return inspectSessionRecovery(this.eventStore?.list(this.sessionId) ?? [], this.sessionId);
  }

  /** Replace the runtime tool allow-list while idle; transcript state is preserved. */
  setTools(tools: readonly SessionTool[]): void {
    if (this.isRunning) throw new SessionBusyError(this.sessionId);
    const prepared = this.prepareTools(tools);
    this.toolsByName = new Map(prepared.map((tool) => [tool.name.toLowerCase(), tool]));
    this.agent.state.tools = prepared;
  }

  setSystemPrompt(prompt: string, sources: readonly ContextSource[] = []): void {
    if (this.isRunning) throw new SessionBusyError(this.sessionId);
    this.agent.state.systemPrompt = prompt;
    this.contextSources = sources.map((source) => ({ ...source }));
  }

  addContextMessage(text: string): void {
    if (this.isRunning) throw new SessionBusyError(this.sessionId);
    this.agent.state.messages = [...this.agent.state.messages, { role: "user", content: text, timestamp: Date.now() }];
  }

  recordContextSource(source: ContextSource, toolCallId?: string): void {
    if (this.activeRun) this.emit({ type: "context_loaded", runId: this.activeRun.runId, source, ...(toolCallId ? { toolCallId } : {}) });
  }

  recordFileAccess(toolCallId: string, method: string, path: string, revision?: number, readRange?: FileReadRange): void {
    if (this.activeRun) this.emit({ type: "file_access", runId: this.activeRun.runId, toolCallId, method, path, ...(revision !== undefined ? { revision } : {}), ...(readRange ? { readRange } : {}) });
  }

  /** Capture ownership NOW. Dispatched IndexedDB writes can commit after Stop
   * or after another run starts; their audit events still belong to this run.
   * Byte reads never imply that a model received complete file contents.
   */
  bindFileAccessRecorder(toolCallId: string): FileAccessRecorder {
    const runId = this.activeRun?.runId;
    return (access: FileAccess) => {
      if (runId) this.emit({ type: "file_access", runId, toolCallId, ...access });
    };
  }

  subscribe(listener: (event: SessionEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async prompt(input: string): Promise<RunResult> {
    const cleanInput = input.trim();
    if (!cleanInput) throw new Error("訊息不可為空");
    if (this.activeRun) throw new SessionBusyError(this.sessionId);

    const runId = makeId("run");
    const run = { runId, toolCallCount: 0, unknownOutcome: false, unknownToolCalls: new Set<string>(), stopRequested: false, deadlineExceeded: false, outputLimitExceeded: false, outputCharacters: 0, deadlineTimer: undefined as ReturnType<typeof setTimeout> | undefined };
    this.activeRun = run;
    if (this.deadlineMs !== undefined) {
      run.deadlineTimer = setTimeout(() => {
        if (this.activeRun !== run) return;
        run.deadlineExceeded = true;
        this.agent.abort();
      }, this.deadlineMs);
    }
    this.emit({ type: "run_started", runId, input: cleanInput });
    for (const source of this.contextSources) this.recordContextSource(source);

    let finalAssistant: AssistantMessage | undefined;
    const detach = this.agent.subscribe((event: AgentEvent) => {
      if (event.type === "message_update" && event.message.role === "assistant" && event.assistantMessageEvent.type === "text_delta") {
        const delta = event.assistantMessageEvent.delta;
        const remaining = this.maxOutputCharacters === undefined ? undefined : this.maxOutputCharacters - run.outputCharacters;
        if (remaining !== undefined && remaining <= 0) {
          run.outputLimitExceeded = true;
          this.agent.abort();
          return;
        }
        const emitted = remaining === undefined ? delta : delta.slice(0, remaining);
        run.outputCharacters += emitted.length;
        this.emit({ type: "text_delta", runId, delta: emitted });
        if (remaining !== undefined && delta.length > remaining) {
          run.outputLimitExceeded = true;
          this.agent.abort();
        }
      }
      if (event.type === "message_end" && event.message.role === "assistant") {
        // Pi resolves tools by exact name after message_end. Canonicalize only
        // tool identifiers here so schemas, approvals and arguments stay intact.
        for (const block of event.message.content) {
          if (block.type === "toolCall") {
            const tool = this.toolsByName.get(block.name.toLowerCase());
            if (tool) block.name = tool.name;
          }
        }
        finalAssistant = event.message;
      }
      if (event.type === "message_end" && event.message.role === "toolResult") {
        this.emit({ type: "tool_result_ready", runId, toolCallId: event.message.toolCallId });
      }
      if (event.type === "tool_execution_start") {
        this.emit({ type: "tool_started", runId, toolCallId: event.toolCallId, toolName: event.toolName });
      }
      if (event.type === "tool_execution_end") {
        this.emit({ type: "tool_finished", runId, toolCallId: event.toolCallId, toolName: event.toolName, isError: event.isError });
      }
      if (event.type === "turn_end") this.compactState();
    });

    try {
      this.compactBeforePrompt(cleanInput);
      if (!run.stopRequested && !run.deadlineExceeded) await this.agent.prompt(cleanInput);
      // Continue only the rejected model request. Completed tools remain in the
      // latest turn, so recovering an input-limit error cannot replay them.
      for (let retry = 0; finalAssistant && retry <= 1; retry++) {
        if (run.unknownOutcome || run.stopRequested || run.deadlineExceeded || run.outputLimitExceeded || !this.recoverInputLimit(finalAssistant, retry < 1)) break;
        this.emit({ type: "request_retry", runId, reason: "input_limit", attempt: retry + 1 });
        if (run.stopRequested || run.deadlineExceeded) break;
        finalAssistant = undefined;
        await this.agent.continue();
      }
      const fullText = textFromAssistant(finalAssistant);
      const emptyFinal = finalAssistant?.stopReason === "stop" && !fullText.trim();
      const text = this.maxOutputCharacters === undefined ? fullText : fullText.slice(0, this.maxOutputCharacters);
      const status: RunStatus = this.activeRun?.unknownOutcome
        ? "outcome_unknown"
        : this.activeRun?.deadlineExceeded
        ? "deadline"
        : this.activeRun?.outputLimitExceeded || finalAssistant?.stopReason === "length"
        ? "output_limit"
        : run.stopRequested || finalAssistant?.stopReason === "aborted" || this.agent.signal?.aborted
        ? "aborted"
        : finalAssistant?.stopReason === "error" || this.agent.state.errorMessage || emptyFinal
          ? "error"
          : "success";
      const error = this.activeRun?.unknownOutcome
        ? "Tool outcome is unknown; no automatic retry was started"
        : this.activeRun?.deadlineExceeded
        ? "Run deadline exceeded"
        : this.activeRun?.outputLimitExceeded
        ? "Output character limit exceeded"
        : finalAssistant?.stopReason === "length"
        ? "Model response reached its output token limit"
        : finalAssistant?.errorMessage ?? this.agent.state.errorMessage ?? (emptyFinal ? "Model returned an empty final response" : undefined);
      const result: RunResult = {
        runId,
        status,
        text,
        ...(error ? { error } : {})
      };
      this.emit({ type: "run_finished", ...result });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const deadlineExceeded = this.activeRun?.deadlineExceeded === true;
      const outputLimitExceeded = this.activeRun?.outputLimitExceeded === true;
      const unknownOutcome = this.activeRun?.unknownOutcome === true;
      const fullText = textFromAssistant(finalAssistant);
      const result: RunResult = {
        runId,
        status: unknownOutcome ? "outcome_unknown" : deadlineExceeded ? "deadline" : outputLimitExceeded ? "output_limit" : "error",
        text: this.maxOutputCharacters === undefined ? fullText : fullText.slice(0, this.maxOutputCharacters),
        error: unknownOutcome ? "Tool outcome is unknown; no automatic retry was started" : deadlineExceeded ? "Run deadline exceeded" : outputLimitExceeded ? "Output character limit exceeded" : message
      };
      this.emit({ type: "run_finished", ...result });
      return result;
    } finally {
      if (run.deadlineTimer !== undefined) clearTimeout(run.deadlineTimer);
      detach();
      this.activeRun = undefined;
    }
  }

  stop(): boolean {
    if (!this.activeRun) return false;
    this.activeRun.stopRequested = true;
    this.agent.abort();
    return true;
  }

  snapshot(): SessionSnapshot {
    if (this.isRunning) throw new SessionPersistenceError("Cannot snapshot a running session");
    const budget = this.currentInputTokenBudget();
    return {
      version: 1,
      sessionId: this.sessionId,
      model: this.agent.state.model,
      systemPrompt: this.agent.state.systemPrompt,
      messages: [...this.agent.state.messages],
      savedAt: Date.now(),
      ...(this.activeSkill ? { activeSkill: this.activeSkill } : {}),
      autoCompactPercent: this.autoCompactPercent,
      ...(budget ? { inputTokenBudget: { ...budget } } : {})
    };
  }

  async save(store: SessionStore): Promise<void> {
    await store.save(this.snapshot());
  }

  static fromSnapshot(
    snapshot: SessionSnapshot,
    options: Omit<AgentSessionOptions, "sessionId" | "model" | "systemPrompt" | "initialMessages">
  ): AgentSession {
    return new AgentSession({
      ...options,
      sessionId: snapshot.sessionId,
      model: snapshot.model,
      systemPrompt: snapshot.systemPrompt,
      initialMessages: snapshot.messages,
      activeSkill: snapshot.activeSkill,
      autoCompactPercent: snapshot.autoCompactPercent,
      inputTokenBudget: snapshot.inputTokenBudget
    });
  }

  private compactTargetTokens(): number {
    const modelWindow = this.agent.state.model.contextWindow;
    const contextWindow = Number.isSafeInteger(modelWindow) && modelWindow > 0 ? modelWindow : 128_000;
    const budget = this.currentInputTokenBudget();
    return Math.max(1, Math.floor(Math.min(contextWindow * this.autoCompactPercent / 100,
      budget ? budget.limit * 0.9 : Infinity) / (budget?.estimateScale ?? 1)));
  }

  private compactContext(messages: AgentMessage[]): AgentMessage[] {
    const compacted = this.compactWithProgress(messages).messages;
    this.lastRequestTokens = estimateContextTokens(this.agent.state.systemPrompt, compacted, this.agent.state.tools as SessionTool[]);
    return compacted;
  }

  private modelKey(model: Model<any>): string { return JSON.stringify([model.provider, model.baseUrl, model.id]); }

  private currentInputTokenBudget(): InputTokenBudget | undefined {
    return this.modelKey(this.agent.state.model) === this.budgetModelKey ? this.inputTokenBudget : undefined;
  }

  private compactWithProgress(messages: readonly AgentMessage[], reason: "context" | "input_limit" = "context"): CompactResult {
    const target = this.compactTargetTokens();
    const run = this.activeRun;
    const report = run && messages.filter(message => message.role === "user").length > 1
      && estimateContextTokens(this.agent.state.systemPrompt, messages, this.agent.state.tools as SessionTool[]) > target;
    if (report) this.emit({ type: "compaction_started", runId: run.runId, reason });
    const result = compactMessages(this.agent.state.systemPrompt, messages, this.agent.state.tools as SessionTool[], target);
    if (report) this.emit({ type: "compaction_finished", runId: run.runId, reason, removedTurns: result.removed });
    return result;
  }

  private recoverInputLimit(failure: AssistantMessage, allowRetry: boolean): boolean {
    const error = failure.errorMessage ?? "";
    // ITPM is an input budget. Do not treat ordinary 429s or combined TPM /
    // output limits as an input cap; those require different retry policies.
    const match = error.match(/\b413\b[\s\S]*Request too large[\s\S]*input tokens per minute\s*\(ITPM\):\s*Limit\s+([\d,]+),\s*Requested\s+([\d,]+)/i);
    if (failure.stopReason !== "error" || !match || this.lastRequestTokens <= 0) return false;
    const limit = Number(match[1].replaceAll(",", ""));
    const requested = Number(match[2].replaceAll(",", ""));
    if (!Number.isSafeInteger(limit) || limit <= 0 || !Number.isSafeInteger(requested) || requested <= limit) return false;
    const previous = this.currentInputTokenBudget();
    this.budgetModelKey = this.modelKey(this.agent.state.model);
    this.inputTokenBudget = { limit, estimateScale: Math.max(previous?.estimateScale ?? 1, requested / this.lastRequestTokens) };
    const messages = this.agent.state.messages;
    const withoutFailure = messages.at(-1) === failure ? messages.slice(0, -1) : [];
    const result = this.compactWithProgress(withoutFailure, "input_limit");
    const reducedTokens = estimateContextTokens(this.agent.state.systemPrompt, result.messages, this.agent.state.tools as SessionTool[]);
    const hasOutput = failure.content.some(block => block.type !== "text" || block.text.length > 0);
    if (result.removed) this.agent.state.messages = [...result.messages, failure];
    if (allowRetry && !hasOutput && result.removed && reducedTokens < this.lastRequestTokens && reducedTokens * this.inputTokenBudget.estimateScale < limit) {
      this.agent.state.messages = result.messages;
      return true;
    }
    failure.errorMessage = `${error}\n輸入超過服務端 ITPM 上限 ${limit.toLocaleString()} tokens（與模型 context window 不同）。${allowRetry ? "目前訊息、工具結果或固定提示仍過大，無法再靠壓縮舊回合縮小請求" : "壓縮後重試仍超限"}；請縮小輸入／工具輸出，或改用輸入額度較高的模型。`;
    return false;
  }

  private compactState(): void {
    const result = this.compactWithProgress(this.agent.state.messages);
    if (result.removed) this.agent.state.messages = result.messages;
  }

  private compactBeforePrompt(input: string): void {
    const prompt: AgentMessage = { role: "user", content: input, timestamp: Date.now() };
    const result = this.compactWithProgress([...this.agent.state.messages, prompt]);
    if (result.removed && result.messages.at(-1) === prompt) this.agent.state.messages = result.messages.slice(0, -1);
  }

  private async beforeToolCall(context: { toolCall: { id: string; name: string }; args: unknown }, signal?: AbortSignal): Promise<{ block?: boolean; reason?: string } | undefined> {
    const run = this.activeRun;
    if (!run) return { block: true, reason: "No active session run" };
    const toolCallId = context.toolCall.id;
    const toolName = context.toolCall.name;
    const tool = this.toolsByName.get(toolName.toLowerCase());
    const toolSignal = signal ?? new AbortController().signal;

    if (toolSignal.aborted) {
      const reason = "Tool execution aborted";
      this.emit({ type: "tool_blocked", runId: run.runId, toolCallId, toolName, reason });
      return { block: true, reason };
    }
    if (this.maxToolCalls !== undefined && run.toolCallCount >= this.maxToolCalls) {
      const reason = `Tool call limit reached (${this.maxToolCalls})`;
      this.emit({ type: "tool_blocked", runId: run.runId, toolCallId, toolName, reason });
      return { block: true, reason };
    }

    if (tool?.requiresApproval) {
      this.emit({ type: "tool_approval_requested", runId: run.runId, toolCallId, toolName });
      let approved = false;
      let reason: string | undefined;
      if (this.approval) {
        try {
          approved = await this.approval({
            sessionId: this.sessionId,
            runId: run.runId,
            toolCallId,
            toolName,
            args: context.args,
            signal: toolSignal
          });
          if (!approved) reason = "Tool approval denied";
        } catch (error) {
          reason = error instanceof Error ? error.message : String(error);
        }
      } else {
        reason = "Tool approval is required";
      }
      this.emit({ type: "tool_approval_resolved", runId: run.runId, toolCallId, toolName, approved, ...(reason ? { reason } : {}) });
      if (toolSignal.aborted) {
        const abortedReason = "Tool execution aborted";
        this.emit({ type: "tool_blocked", runId: run.runId, toolCallId, toolName, reason: abortedReason });
        return { block: true, reason: abortedReason };
      }
      if (!approved) {
        const blockedReason = reason ?? "Tool approval denied";
        this.emit({ type: "tool_blocked", runId: run.runId, toolCallId, toolName, reason: blockedReason });
        return { block: true, reason: blockedReason };
      }
    }

    run.toolCallCount += 1;
    return undefined;
  }

  private async afterToolCall(context: { toolCall: { id: string; name: string } }, _signal?: AbortSignal): Promise<{ content?: [{ type: "text"; text: string }]; details?: unknown; isError?: boolean; terminate?: boolean } | undefined> {
    const run = this.activeRun;
    if (!run || !run.unknownToolCalls.has(context.toolCall.id)) return undefined;
    return {
      content: [{ type: "text", text: "Tool outcome is unknown; do not automatically retry this side effect." }],
      details: { outcome: "unknown" },
      isError: true,
      terminate: true
    };
  }

  private prepareTools(tools: readonly SessionTool[]): SessionTool[] {
    const prepared = tools.map((tool) => this.wrapTool(tool));
    const names = new Set<string>();
    for (const tool of prepared) {
      if (names.has(tool.name.toLowerCase())) throw new Error(`Duplicate tool name: ${tool.name}`);
      names.add(tool.name.toLowerCase());
    }
    return prepared;
  }

  private wrapTool(tool: SessionTool): SessionTool {
    return {
      ...tool,
      execute: async (toolCallId, params, signal, onUpdate) => {
        try {
          return await tool.execute(toolCallId, params, signal, onUpdate);
        } catch (error) {
          if (error instanceof ToolOutcomeUnknownError || (error instanceof Error && "code" in error && error.code === "outcome_unknown")) {
            const run = this.activeRun;
            const reason = error instanceof Error ? error.message : String(error);
            if (run) {
              run.unknownOutcome = true;
              run.unknownToolCalls.add(toolCallId);
              this.emit({ type: "tool_outcome_unknown", runId: run.runId, toolCallId, toolName: tool.name, reason });
            }
          }
          throw error;
        }
      }
    };
  }

  private emit(event: SessionEventPayload): void {
    const versionedEvent: SessionEvent = {
      version: SESSION_EVENT_VERSION,
      sessionId: this.sessionId,
      ...event
    } as SessionEvent;
    this.eventStore?.append(versionedEvent);
    for (const listener of this.listeners) listener(versionedEvent);
  }
}
