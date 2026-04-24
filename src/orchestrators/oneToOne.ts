import { AgentConfig, ChatMessage } from "../types";
import { AgentAdapter, RetryConfig } from "../adapters/base";
import type { ExecutionDeadline } from "../utils/deadline";
import { combineSignals } from "../utils/deadline";

export async function runOneToOne(args: {
  adapter: AgentAdapter;
  agent: AgentConfig;
  input: string;
  history: ChatMessage[];
  system?: string;
  onDelta: (t: string) => void;
  retry?: RetryConfig;
  onLog?: (t: string) => void;
  signal?: AbortSignal;
  timeoutMs?: number;
  deadline?: ExecutionDeadline;
}): Promise<string> {
  args.deadline?.throwIfExpired("one-to-one response");
  const signal = args.deadline ? combineSignals(args.signal, args.deadline.signal) : args.signal;
  const timeoutMs = args.timeoutMs ?? (args.deadline ? Math.max(1, args.deadline.remainingMs()) : undefined);
  let full = "";
  for await (const ev of args.adapter.chat({
    agent: args.agent,
    input: args.input,
    history: args.history,
    system: args.system,
    retry: args.retry,
    onLog: args.onLog,
    signal,
    timeoutMs
  })) {
    args.deadline?.throwIfExpired("one-to-one response");
    if (ev.type === "delta") {
      full += ev.text;
      args.onDelta(ev.text);
    } else {
      full = ev.text;
    }
  }
  return full;
}
