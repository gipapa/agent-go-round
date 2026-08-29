import { AgentConfig, ChatMessage, DetectResult } from "../types";

export type RetryConfig = {
  delaySec: number;
  max: number;
};

export const MAX_RETRY_DELAY_SEC = 30;
export const MAX_RETRY_ATTEMPTS = 20;

export function normalizeRetryConfig(retry?: RetryConfig): RetryConfig | undefined {
  if (!retry) return undefined;
  return {
    delaySec: Number.isFinite(retry.delaySec) ? Math.min(MAX_RETRY_DELAY_SEC, Math.max(0, retry.delaySec)) : 0,
    max: Number.isFinite(retry.max) ? Math.min(MAX_RETRY_ATTEMPTS, Math.max(0, Math.floor(retry.max))) : 0
  };
}

export type ChatRequest = {
  agent: AgentConfig;
  input: string;
  history: ChatMessage[];
  system?: string;
  retry?: RetryConfig;
  onLog?: (t: string) => void;
  signal?: AbortSignal;
  timeoutMs?: number;
  maxModelResponseChars?: number;
};

export type ChatDelta = { type: "delta"; text: string };
export type ChatDone = { type: "done"; text: string };
export type ChatErrorKind = "network" | "http" | "rate_limit" | "auth" | "empty" | "provider" | "response_limit";
export type ChatError = { type: "error"; kind: ChatErrorKind; retryable: boolean; message: string };
export type ChatAborted = { type: "aborted"; message: string };
export type ChatEvent = ChatDelta | ChatDone | ChatError | ChatAborted;

export type NativeToolDefinition = {
  type: "function";
  function: { name: string; description?: string; parameters: unknown };
};

export type NativeChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string; tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }> }
  | { role: "tool"; tool_call_id: string; content: string };

export type NativeChatRequest = {
  agent: AgentConfig;
  messages: NativeChatMessage[];
  tools: NativeToolDefinition[];
  toolChoice?: "auto" | "required";
  retry?: RetryConfig;
  onLog?: (t: string) => void;
  signal?: AbortSignal;
  timeoutMs?: number;
  maxModelResponseChars?: number;
};

export type NativeChatEvent =
  | { type: "text_delta"; text: string }
  | { type: "tool_call_delta"; call: { index: number; id?: string; name?: string; arguments?: string } }
  | { type: "done"; finishReason?: string }
  | ChatError
  | ChatAborted;

export class AgentTransportError extends Error {
  readonly kind: ChatErrorKind;
  readonly retryable: boolean;

  constructor(kind: ChatErrorKind, message: string, retryable: boolean) {
    super(message);
    this.name = "AgentTransportError";
    this.kind = kind;
    this.retryable = retryable;
  }
}

export interface AgentAdapter {
  detect?(agent: AgentConfig): Promise<DetectResult>;
  chat(req: ChatRequest): AsyncGenerator<ChatEvent, void, void>;
  nativeChat?(req: NativeChatRequest): AsyncGenerator<NativeChatEvent, void, void>;
}
