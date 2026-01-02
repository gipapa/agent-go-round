import { AgentConfig, ChatMessage, DetectResult } from "../types";

export type ChatRequest = {
  agent: AgentConfig;
  input: string;
  history: ChatMessage[];
  system?: string;
};

export type ChatDelta = { type: "delta"; text: string };
export type ChatDone = { type: "done"; text: string };
export type ChatEvent = ChatDelta | ChatDone;

export interface AgentAdapter {
  detect?(agent: AgentConfig): Promise<DetectResult>;
  chat(req: ChatRequest): AsyncGenerator<ChatEvent, void, void>;
}
