import { AgentConfig, ChatMessage, DetectResult } from "../types";

export type RetryConfig = {
  delaySec: number;
  max: number;
};

export type ChatRequest = {
  agent: AgentConfig;
  input: string;
  history: ChatMessage[];
  system?: string;
  retry?: RetryConfig;
  onLog?: (t: string) => void;
};

export type ChatDelta = { type: "delta"; text: string };
export type ChatDone = { type: "done"; text: string };
export type ChatEvent = ChatDelta | ChatDone;

export interface AgentAdapter {
  detect?(agent: AgentConfig): Promise<DetectResult>;
  chat(req: ChatRequest): AsyncGenerator<ChatEvent, void, void>;
}
