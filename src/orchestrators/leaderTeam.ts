import { AgentConfig, ChatMessage } from "../types";
import { AgentAdapter } from "../adapters/base";
import { runOneToOne } from "./oneToOne";

type Action =
  | { type: "ask_member"; memberId: string; message: string }
  | { type: "finish"; answer: string };

type RunState = {
  round: number;
  goal: string;
  steps: Array<
    | { kind: "leader_action"; text: string }
    | { kind: "member_reply"; memberId: string; memberName: string; prompt: string; reply: string }
  >;
};

export type LeaderTeamEvent =
  | { type: "leader_decision_raw"; text: string }
  | { type: "leader_ask_member"; memberId: string; memberName: string; message: string }
  | { type: "member_reply"; memberId: string; memberName: string; prompt: string; reply: string }
  | { type: "leader_finish"; answer: string }
  | { type: "leader_invalid_json"; text: string };

function extractJsonObject(text: string): any | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]);
  } catch {
    return null;
  }
}

function normalizeAction(obj: any): Action | null {
  if (!obj || typeof obj !== "object") return null;

  if (obj.type === "finish" && typeof obj.answer === "string") {
    return { type: "finish", answer: obj.answer };
  }

  if (obj.type === "ask_member" && typeof obj.memberId === "string" && typeof obj.message === "string") {
    return { type: "ask_member", memberId: obj.memberId, message: obj.message };
  }

  return null;
}

function buildLeaderPrompt(args: {
  goal: string;
  state: RunState;
  leaderName: string;
  members: Array<{ id: string; name: string }>;
}) {
  const membersList = args.members.map((m) => `- ${m.id}: ${m.name}`).join("\n");

  const steps = args.state.steps
    .map((s, i) => {
      if (s.kind === "leader_action") return `#${i + 1} LEADER_ACTION:\n${s.text}`;
      return `#${i + 1} MEMBER_REPLY (${s.memberName}, id=${s.memberId})\nPROMPT:\n${s.prompt}\nREPLY:\n${s.reply}`;
    })
    .join("\n\n");

  return (
    `You are the LEADER agent ("${args.leaderName}"). Your job is to drive a multi-agent session to achieve the user's GOAL.\n\n` +
    `GOAL:\n${args.goal}\n\n` +
    `AVAILABLE MEMBERS (choose by memberId):\n${membersList}\n\n` +
    `CURRENT ROUND: ${args.state.round}\n\n` +
    `SESSION LOG (so far):\n${steps || "(empty)"}\n\n` +
    `INSTRUCTIONS:\n` +
    `- Decide the NEXT best action.\n` +
    `- Ask exactly ONE member at a time (when needed).\n` +
    `- If you have enough information, finish and provide the final answer.\n` +
    `- Keep control of the flow: track progress, decide who to ask next, and when to stop.\n\n` +
    `OUTPUT FORMAT (MUST be valid JSON object, no markdown):\n` +
    `{\n` +
    `  "type": "ask_member",\n` +
    `  "memberId": "<one of the ids above>",\n` +
    `  "message": "<what you want that member to do next>"\n` +
    `}\n` +
    `OR\n` +
    `{\n` +
    `  "type": "finish",\n` +
    `  "answer": "<final answer to the user>"\n` +
    `}`
  );
}

function buildMemberSystem(goal: string, leaderName: string) {
  return (
    `You are a MEMBER agent in a leader-driven team.\n` +
    `Leader: ${leaderName}\n\n` +
    `GOAL:\n${goal}\n\n` +
    `INSTRUCTIONS:\n` +
    `- Follow the leader's request precisely.\n` +
    `- Be concise but complete.\n` +
    `- Provide actionable output.\n`
  );
}

export async function runLeaderTeam(args: {
  leader: { agent: AgentConfig; adapter: AgentAdapter };
  members: Array<{ agent: AgentConfig; adapter: AgentAdapter }>;
  goal: string;

  userHistory: ChatMessage[];
  userSystem?: string;

  maxRounds?: number;

  onLog: (t: string) => void;
  onDelta: (t: string) => void;

  onEvent?: (ev: LeaderTeamEvent) => void;
}): Promise<string> {
  const maxRounds = args.maxRounds ?? 8;

  const state: RunState = {
    round: 1,
    goal: args.goal,
    steps: []
  };

  const memberIndex = new Map(args.members.map((m) => [m.agent.id, m]));
  const membersMeta = args.members.map((m) => ({ id: m.agent.id, name: m.agent.name }));

  while (state.round <= maxRounds) {
    args.onLog(`Leader round ${state.round}: deciding next action...`);

    const leaderPrompt = buildLeaderPrompt({
      goal: args.goal,
      state,
      leaderName: args.leader.agent.name,
      members: membersMeta
    });

    const leaderText = await runOneToOne({
      adapter: args.leader.adapter,
      agent: args.leader.agent,
      input: leaderPrompt,
      history: args.userHistory,
      system: args.userSystem,
      onDelta: () => {}
    });

    args.onEvent?.({ type: "leader_decision_raw", text: leaderText });
    state.steps.push({ kind: "leader_action", text: leaderText });

    const actObj = extractJsonObject(leaderText);
    const action = normalizeAction(actObj);

    if (!action) {
      args.onLog("Leader output was not a valid JSON action. Finishing with leader raw text.");
      args.onEvent?.({ type: "leader_invalid_json", text: leaderText });
      args.onDelta(leaderText);
      return leaderText;
    }

    if (action.type === "finish") {
      args.onLog("Leader: finish.");
      args.onEvent?.({ type: "leader_finish", answer: action.answer });
      args.onDelta(action.answer);
      return action.answer;
    }

    const member = memberIndex.get(action.memberId);
    if (!member) {
      args.onLog(`Leader asked unknown memberId: ${action.memberId}. Finishing with leader raw text.`);
      args.onEvent?.({ type: "leader_invalid_json", text: leaderText });
      args.onDelta(leaderText);
      return leaderText;
    }

    args.onEvent?.({
      type: "leader_ask_member",
      memberId: member.agent.id,
      memberName: member.agent.name,
      message: action.message
    });

    args.onLog(`Leader -> Member(${member.agent.name}): ${action.message}`);

    const reply = await runOneToOne({
      adapter: member.adapter,
      agent: member.agent,
      input: action.message,
      history: [],
      system: buildMemberSystem(args.goal, args.leader.agent.name),
      onDelta: () => {}
    });

    args.onEvent?.({
      type: "member_reply",
      memberId: member.agent.id,
      memberName: member.agent.name,
      prompt: action.message,
      reply
    });

    state.steps.push({
      kind: "member_reply",
      memberId: member.agent.id,
      memberName: member.agent.name,
      prompt: action.message,
      reply
    });

    state.round += 1;
  }

  args.onLog(`Max rounds reached (${maxRounds}). Requesting leader to finalize...`);

  const finalPrompt =
    `We reached max rounds. Provide the best final answer now.\n\n` +
    buildLeaderPrompt({
      goal: args.goal,
      state,
      leaderName: args.leader.agent.name,
      members: membersMeta
    });

  const finalText = await runOneToOne({
    adapter: args.leader.adapter,
    agent: args.leader.agent,
    input: finalPrompt,
    history: args.userHistory,
    system: args.userSystem,
    onDelta: () => {}
  });

  const finalObj = extractJsonObject(finalText);
  const finalAction = normalizeAction(finalObj);
  const answer = finalAction?.type === "finish" ? finalAction.answer : finalText;

  args.onEvent?.({ type: "leader_finish", answer });
  args.onDelta(answer);
  return answer;
}
