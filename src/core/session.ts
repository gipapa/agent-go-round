import { Agent, type AgentEvent, type StreamFn } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, Model } from "@earendil-works/pi-ai";

export type RunStatus = "success" | "aborted" | "error";

export type SessionEvent =
  | { type: "run_started"; runId: string; sessionId: string; input: string }
  | { type: "text_delta"; runId: string; delta: string }
  | { type: "run_finished"; runId: string; status: RunStatus; text: string; error?: string };

export type RunResult = {
  runId: string;
  status: RunStatus;
  text: string;
  error?: string;
};

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
  private activeRun?: { runId: string };
  private readonly listeners = new Set<(event: SessionEvent) => void>();

  constructor(options: AgentSessionOptions) {
    this.sessionId = options.sessionId;
    this.agent = new Agent({
      initialState: {
        model: options.model,
        systemPrompt: options.systemPrompt ?? "",
        thinkingLevel: "off",
        messages: []
      },
      sessionId: options.sessionId,
      streamFn: options.streamFn,
      toolExecution: "sequential",
      maxRetryDelayMs: 5_000
    });
  }

  get isRunning(): boolean {
    return this.activeRun !== undefined;
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
    this.activeRun = { runId };
    this.emit({ type: "run_started", runId, sessionId: this.sessionId, input: cleanInput });

    let finalAssistant: AssistantMessage | undefined;
    const detach = this.agent.subscribe((event: AgentEvent) => {
      if (event.type === "message_update" && event.message.role === "assistant" && event.assistantMessageEvent.type === "text_delta") {
        this.emit({ type: "text_delta", runId, delta: event.assistantMessageEvent.delta });
      }
      if (event.type === "message_end" && event.message.role === "assistant") {
        finalAssistant = event.message;
      }
    });

    try {
      await this.agent.prompt(cleanInput);
      const text = textFromAssistant(finalAssistant);
      const status: RunStatus = finalAssistant?.stopReason === "aborted" || this.agent.signal?.aborted
        ? "aborted"
        : finalAssistant?.stopReason === "error" || this.agent.state.errorMessage
          ? "error"
          : "success";
      const error = finalAssistant?.errorMessage ?? this.agent.state.errorMessage;
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
      const result: RunResult = { runId, status: "error", text: textFromAssistant(finalAssistant), error: message };
      this.emit({ type: "run_finished", ...result });
      return result;
    } finally {
      detach();
      this.activeRun = undefined;
    }
  }

  stop(): boolean {
    if (!this.activeRun) return false;
    this.agent.abort();
    return true;
  }

  private emit(event: SessionEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}
