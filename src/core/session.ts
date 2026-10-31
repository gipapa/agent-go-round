import { Agent, type AgentEvent, type AgentMessage, type AgentTool, type StreamFn } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, Model, TSchema } from "@earendil-works/pi-ai";
import { SessionPersistenceError, type SessionSnapshot, type SessionStore } from "./persistence";

export type RunStatus = "success" | "aborted" | "deadline" | "error" | "outcome_unknown" | "output_limit";

export const SESSION_EVENT_VERSION = 1 as const;

type SessionEventPayload =
  | { type: "run_started"; runId: string; input: string }
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

export interface SessionEventStore {
  append(event: SessionEvent): void;
  list(sessionId?: string): readonly SessionEvent[];
}

export class SessionEventStorageError extends Error {
  readonly code = "session_event_storage_error" as const;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "SessionEventStorageError";
  }
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

type SessionEventStorage = Pick<Storage, "getItem" | "setItem" | "removeItem"> & {
  readonly length?: number;
  key?: (index: number) => string | null;
};

/** A browser event sink used for recovery inspection; it never stores tool args/results. */
export class LocalStorageSessionEventStore implements SessionEventStore {
  constructor(private readonly storage: SessionEventStorage, private readonly keyPrefix = "agent-go-round.events.") {}

  append(event: SessionEvent): void {
    const events = this.read(event.sessionId);
    events.push(event);
    try {
      this.storage.setItem(this.key(event.sessionId), JSON.stringify(events));
    } catch (error) {
      throw new SessionEventStorageError("Unable to write session events", { cause: error });
    }
  }

  list(sessionId?: string): readonly SessionEvent[] {
    if (sessionId) return this.read(sessionId);
    const events: SessionEvent[] = [];
    if (this.storage.length === undefined || !this.storage.key) return events;
    for (let index = 0; index < this.storage.length; index += 1) {
      const key = this.storage.key(index);
      if (key?.startsWith(this.keyPrefix)) events.push(...this.read(decodeURIComponent(key.slice(this.keyPrefix.length))));
    }
    return events;
  }

  clear(sessionId: string): void {
    try {
      this.storage.removeItem(this.key(sessionId));
    } catch (error) {
      throw new SessionEventStorageError("Unable to remove session events", { cause: error });
    }
  }

  private key(sessionId: string): string {
    return `${this.keyPrefix}${encodeURIComponent(sessionId)}`;
  }

  private read(sessionIdOrEncoded: string): SessionEvent[] {
    const encoded = sessionIdOrEncoded.startsWith(this.keyPrefix) ? sessionIdOrEncoded.slice(this.keyPrefix.length) : encodeURIComponent(sessionIdOrEncoded);
    const key = `${this.keyPrefix}${encoded}`;
    let raw: string | null;
    try {
      raw = this.storage.getItem(key);
    } catch (error) {
      throw new SessionEventStorageError("Unable to read session events", { cause: error });
    }
    if (raw === null) return [];
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) throw new Error("Stored session events are not an array");
      return parsed as SessionEvent[];
    } catch (error) {
      throw new SessionEventStorageError("Stored session events are not valid JSON", { cause: error });
    }
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
  eventStore?: SessionEventStore;
  initialMessages?: readonly AgentMessage[];
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
  private activeRun?: { runId: string; toolCallCount: number; unknownOutcome: boolean; unknownToolCalls: Set<string>; deadlineExceeded: boolean; outputLimitExceeded: boolean; outputCharacters: number; deadlineTimer?: ReturnType<typeof setTimeout> };
  private readonly listeners = new Set<(event: SessionEvent) => void>();
  private toolsByName: ReadonlyMap<string, SessionTool>;
  private readonly approval?: ToolApproval;
  private readonly maxToolCalls?: number;
  private readonly deadlineMs?: number;
  private readonly maxOutputCharacters?: number;
  private readonly eventStore?: SessionEventStore;

  constructor(options: AgentSessionOptions) {
    this.sessionId = options.sessionId;
    if (options.maxToolCalls !== undefined && (!Number.isInteger(options.maxToolCalls) || options.maxToolCalls < 0)) {
      throw new Error("maxToolCalls must be a non-negative integer");
    }
    if (options.deadlineMs !== undefined && (!Number.isInteger(options.deadlineMs) || options.deadlineMs <= 0)) {
      throw new Error("deadlineMs must be a positive integer");
    }
    if (options.maxOutputCharacters !== undefined && (!Number.isInteger(options.maxOutputCharacters) || options.maxOutputCharacters < 0)) {
      throw new Error("maxOutputCharacters must be a non-negative integer");
    }
    const tools = this.prepareTools(options.tools ?? []);
    this.toolsByName = new Map(tools.map((tool) => [tool.name, tool]));
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
      maxRetryDelayMs: 5_000,
      beforeToolCall: (context, signal) => this.beforeToolCall(context, signal),
      afterToolCall: (context, signal) => this.afterToolCall(context, signal),
      shouldStopAfterTurn: () => this.activeRun?.unknownOutcome === true
    });
  }

  get isRunning(): boolean {
    return this.activeRun !== undefined;
  }

  recovery(): SessionRecovery {
    return inspectSessionRecovery(this.eventStore?.list(this.sessionId) ?? [], this.sessionId);
  }

  /** Replace the runtime tool allow-list while idle; transcript state is preserved. */
  setTools(tools: readonly SessionTool[]): void {
    if (this.isRunning) throw new SessionBusyError(this.sessionId);
    const prepared = this.prepareTools(tools);
    this.toolsByName = new Map(prepared.map((tool) => [tool.name, tool]));
    this.agent.state.tools = prepared;
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
    const run = { runId, toolCallCount: 0, unknownOutcome: false, unknownToolCalls: new Set<string>(), deadlineExceeded: false, outputLimitExceeded: false, outputCharacters: 0, deadlineTimer: undefined as ReturnType<typeof setTimeout> | undefined };
    this.activeRun = run;
    if (this.deadlineMs !== undefined) {
      run.deadlineTimer = setTimeout(() => {
        if (this.activeRun !== run) return;
        run.deadlineExceeded = true;
        this.agent.abort();
      }, this.deadlineMs);
    }
    this.emit({ type: "run_started", runId, input: cleanInput });

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
        finalAssistant = event.message;
      }
      if (event.type === "tool_execution_start") {
        this.emit({ type: "tool_started", runId, toolCallId: event.toolCallId, toolName: event.toolName });
      }
      if (event.type === "tool_execution_end") {
        this.emit({ type: "tool_finished", runId, toolCallId: event.toolCallId, toolName: event.toolName, isError: event.isError });
      }
    });

    try {
      await this.agent.prompt(cleanInput);
      const fullText = textFromAssistant(finalAssistant);
      const text = this.maxOutputCharacters === undefined ? fullText : fullText.slice(0, this.maxOutputCharacters);
      const status: RunStatus = this.activeRun?.unknownOutcome
        ? "outcome_unknown"
        : this.activeRun?.deadlineExceeded
        ? "deadline"
        : this.activeRun?.outputLimitExceeded
        ? "output_limit"
        : finalAssistant?.stopReason === "aborted" || this.agent.signal?.aborted
        ? "aborted"
        : finalAssistant?.stopReason === "error" || this.agent.state.errorMessage
          ? "error"
          : "success";
      const error = this.activeRun?.unknownOutcome
        ? "Tool outcome is unknown; no automatic retry was started"
        : this.activeRun?.deadlineExceeded
        ? "Run deadline exceeded"
        : this.activeRun?.outputLimitExceeded
        ? "Output character limit exceeded"
        : finalAssistant?.errorMessage ?? this.agent.state.errorMessage;
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
    this.agent.abort();
    return true;
  }

  snapshot(): SessionSnapshot {
    if (this.isRunning) throw new SessionPersistenceError("Cannot snapshot a running session");
    return {
      version: 1,
      sessionId: this.sessionId,
      model: this.agent.state.model,
      systemPrompt: this.agent.state.systemPrompt,
      messages: [...this.agent.state.messages],
      savedAt: Date.now()
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
      initialMessages: snapshot.messages
    });
  }

  private async beforeToolCall(context: { toolCall: { id: string; name: string }; args: unknown }, signal?: AbortSignal): Promise<{ block?: boolean; reason?: string } | undefined> {
    const run = this.activeRun;
    if (!run) return { block: true, reason: "No active session run" };
    const toolCallId = context.toolCall.id;
    const toolName = context.toolCall.name;
    const tool = this.toolsByName.get(toolName);
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
      if (names.has(tool.name)) throw new Error(`Duplicate tool name: ${tool.name}`);
      names.add(tool.name);
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
