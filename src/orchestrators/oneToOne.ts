import { AgentConfig, ChatMessage } from "../types";
import { AgentAdapter } from "../adapters/base";

export async function runOneToOne(args: {
  adapter: AgentAdapter;
  agent: AgentConfig;
  input: string;
  history: ChatMessage[];
  system?: string;
  onDelta: (t: string) => void;
}): Promise<string> {
  let full = "";
  for await (const ev of args.adapter.chat({
    agent: args.agent,
    input: args.input,
    history: args.history,
    system: args.system
  })) {
    if (ev.type === "delta") {
      full += ev.text;
      args.onDelta(ev.text);
    } else {
      full = ev.text;
    }
  }
  return full;
}
