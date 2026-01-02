import { AgentConfig, ChatMessage } from "../types";
import { AgentAdapter } from "../adapters/base";
import { runOneToOne } from "./oneToOne";

type Task = { assignee: string; prompt: string };

function safeParseTasks(text: string): Task[] | null {
  const m = text.match(/\[[\s\S]*\]/);
  if (!m) return null;
  try {
    const arr = JSON.parse(m[0]);
    if (!Array.isArray(arr)) return null;
    return arr
      .filter((x) => x?.assignee && x?.prompt)
      .map((x) => ({ assignee: String(x.assignee), prompt: String(x.prompt) }));
  } catch {
    return null;
  }
}

export async function runLeaderTeam(args: {
  leader: { agent: AgentConfig; adapter: AgentAdapter };
  workers: Array<{ agent: AgentConfig; adapter: AgentAdapter }>;
  input: string;
  history: ChatMessage[];
  system?: string;
  onLog: (t: string) => void;
  onDelta: (t: string) => void;
}): Promise<string> {
  const leaderSystem =
    (args.system ?? "") +
    "\n\n" +
    `You are the leader. Output a JSON array of tasks for workers.
Format: [{"assignee":"<workerName>","prompt":"<what to do>"}]
Keep it short (max 5 tasks).`;

  args.onLog("Leader: planning...");
  const planText = await runOneToOne({
    adapter: args.leader.adapter,
    agent: args.leader.agent,
    input: args.input,
    history: args.history,
    system: leaderSystem,
    onDelta: () => {}
  });

  const tasks = safeParseTasks(planText) ?? [];
  if (tasks.length === 0) args.onLog("Leader: no tasks parsed; fallback to leader direct answer.");

  const workerResults: Array<{ assignee: string; result: string }> = [];

  for (const task of tasks) {
    const w = args.workers.find((x) => x.agent.name === task.assignee);
    if (!w) {
      args.onLog(`Worker not found: ${task.assignee}`);
      continue;
    }
    args.onLog(`Worker ${task.assignee}: running...`);
    const result = await runOneToOne({
      adapter: w.adapter,
      agent: w.agent,
      input: task.prompt,
      history: [],
      system: "You are a specialist worker. Be concise and actionable.",
      onDelta: () => {}
    });
    workerResults.push({ assignee: task.assignee, result });
  }

  const synthInput =
    `User request:\n${args.input}\n\n` +
    `Worker results:\n` +
    workerResults.map((r) => `- ${r.assignee}:\n${r.result}\n`).join("\n");

  args.onLog("Leader: synthesizing final answer...");
  const final = await runOneToOne({
    adapter: args.leader.adapter,
    agent: args.leader.agent,
    input: synthInput,
    history: args.history,
    system: (args.system ?? "") + "\n\nYou are the leader. Produce the final answer.",
    onDelta: args.onDelta
  });

  return final;
}
