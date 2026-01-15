import { AgentConfig, ChatMessage } from "../types";
import { AgentAdapter } from "../adapters/base";
import { runOneToOne } from "./oneToOne";
import { RetryConfig } from "../adapters/base";

type Action =
  | { type: "ask_member"; memberId: string; message: string }
  | { type: "finish"; answer: string };

type VerifyDecision = {
  ok: boolean;
  reason?: string;
  react?: { memberId: string; message: string };
};

type PlanDecision = {
  assignments: Array<{ memberId: string; message: string }>;
  notes?: string;
};

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
  | { type: "leader_plan"; assignments: Array<{ memberId: string; message: string }>; notes?: string; raw: string }
  | { type: "leader_retry"; reason: string; attempt: number; max: number; raw: string }
  | { type: "leader_ask_member"; memberId: string; memberName: string; message: string }
  | { type: "member_reply"; memberId: string; memberName: string; prompt: string; reply: string }
  | { type: "leader_verify"; ok: boolean; notes?: string; raw: string }
  | { type: "leader_react"; memberId: string; memberName: string; message: string; reason?: string }
  | { type: "leader_finish"; answer: string }
  | { type: "leader_invalid_json"; text: string };

function sanitizeJsonText(text: string): string {
  return text
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, '"')
    .replace(/,\s*([}\]])/g, "$1");
}

function extractJsonObject(text: string): any | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]);
  } catch {
    try {
      return JSON.parse(sanitizeJsonText(m[0]));
    } catch {
      return null;
    }
  }
}

function normalizeAction(obj: any): Action | null {
  if (!obj || typeof obj !== "object") return null;

  const type =
    typeof obj.type === "string"
      ? obj.type.toLowerCase().trim()
      : typeof obj.action === "string"
      ? obj.action.toLowerCase().trim()
      : "";

  if (type === "finish" && typeof obj.answer === "string") {
    return { type: "finish", answer: obj.answer };
  }

  if (type === "ask_member" && typeof obj.memberId === "string" && typeof obj.message === "string") {
    return { type: "ask_member", memberId: obj.memberId, message: obj.message };
  }

  return null;
}

function normalizeVerify(obj: any): VerifyDecision | null {
  if (!obj || typeof obj !== "object") return null;
  const ok = typeof obj.ok === "boolean" ? obj.ok : null;
  if (ok === null) return null;
  const reason = typeof obj.reason === "string" ? obj.reason : undefined;
  if (!obj.react) return { ok, reason };
  if (typeof obj.react === "object" && typeof obj.react.memberId === "string" && typeof obj.react.message === "string") {
    return { ok, reason, react: { memberId: obj.react.memberId, message: obj.react.message } };
  }
  return { ok, reason };
}

function normalizePlan(obj: any): PlanDecision | null {
  if (!obj || typeof obj !== "object") return null;
  if (!Array.isArray(obj.assignments)) return null;
  const assignments = obj.assignments.filter(
    (a: any) => a && typeof a.memberId === "string" && typeof a.message === "string"
  );
  if (assignments.length === 0) return null;
  const notes = typeof obj.notes === "string" ? obj.notes : undefined;
  return { assignments, notes };
}

function buildLeaderPrompt(args: {
  goal: string;
  state: RunState;
  leaderName: string;
  members: Array<{ id: string; name: string; description?: string }>;
  plan: Array<{ memberId: string; message: string }>;
  nextMemberId?: string;
  reactCount: number;
  reactMax: number;
}) {
  const membersList = args.members
    .map((m) => `- ${m.id}: ${m.name}${m.description ? ` — ${m.description}` : ""}`)
    .join("\n");

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
    `PLANNED ORDER: ${
      args.plan.length ? args.plan.map((a, i) => `${i + 1}. ${a.memberId}: ${a.message}`).join(" | ") : "(none)"
    }\n\n` +
    `NEXT MEMBER: ${args.nextMemberId ?? "(none)"}\n\n` +
    `REACT COUNT: ${args.reactCount}/${args.reactMax}\n\n` +
    `SESSION LOG (so far):\n${steps || "(empty)"}\n\n` +
    `INSTRUCTIONS:\n` +
    `- Decide the NEXT best action.\n` +
    `- Ask exactly ONE member at a time (when needed).\n` +
    `- Use NEXT MEMBER for ask_member.\n` +
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

function buildPlanPrompt(args: {
  goal: string;
  leaderName: string;
  members: Array<{ id: string; name: string; description?: string }>;
}) {
  const membersList = args.members
    .map((m) => `- ${m.id}: ${m.name}${m.description ? ` — ${m.description}` : ""}`)
    .join("\n");
  return (
    `You are the LEADER agent ("${args.leaderName}"). Plan which members should execute tasks.\n\n` +
    `GOAL:\n${args.goal}\n\n` +
    `AVAILABLE MEMBERS (choose by memberId):\n${membersList}\n\n` +
    `OUTPUT FORMAT (MUST be valid JSON object, no markdown):\n` +
    `{\n` +
    `  "assignments": [\n` +
    `    { "memberId": "<memberId>", "message": "<task to assign>" }\n` +
    `  ],\n` +
    `  "notes": "<optional short rationale>"\n` +
    `}`
  );
}

function buildVerifyPrompt(args: {
  goal: string;
  leaderName: string;
  members: Array<{ id: string; name: string; description?: string }>;
  lastPrompt: string;
  lastReply: string;
  reactCount: number;
  reactMax: number;
}) {
  const membersList = args.members
    .map((m) => `- ${m.id}: ${m.name}${m.description ? ` — ${m.description}` : ""}`)
    .join("\n");
  return (
    `You are the LEADER agent ("${args.leaderName}"). Verify whether the member reply satisfies the assigned sub-task.\n\n` +
    `SUB-TASK (assigned prompt):\n${args.lastPrompt}\n\n` +
    `LAST MEMBER REPLY:\n${args.lastReply}\n\n` +
    `AVAILABLE MEMBERS (choose by memberId if you REACT):\n${membersList}\n\n` +
    `REACT COUNT: ${args.reactCount}/${args.reactMax}\n\n` +
    `OUTPUT FORMAT (MUST be valid JSON object, no markdown):\n` +
    `{\n` +
    `  "ok": true,\n` +
    `  "reason": "<short note>"\n` +
    `}\n` +
    `OR\n` +
    `{\n` +
    `  "ok": false,\n` +
    `  "reason": "<why this is insufficient>",\n` +
    `  "react": {\n` +
    `    "memberId": "<one of the ids above>",\n` +
    `    "message": "<new task to assign for REACT>"\n` +
    `  }\n` +
    `}`
  );
}

function buildFinalVerifyPrompt(args: { goal: string; leaderName: string; stepsSummary: string }) {
  return (
    `You are the LEADER agent ("${args.leaderName}"). Verify whether the overall goal is satisfied.\n\n` +
    `GOAL:\n${args.goal}\n\n` +
    `SESSION SUMMARY:\n${args.stepsSummary || "(empty)"}\n\n` +
    `OUTPUT FORMAT (MUST be valid JSON object, no markdown):\n` +
    `{\n` +
    `  "ok": true,\n` +
    `  "reason": "<short note>"\n` +
    `}\n` +
    `OR\n` +
    `{\n` +
    `  "ok": false,\n` +
    `  "reason": "<why the overall goal is not met>"\n` +
    `}`
  );
}

export async function runLeaderTeam(args: {
  leader: { agent: AgentConfig; adapter: AgentAdapter };
  members: Array<{ agent: AgentConfig; adapter: AgentAdapter }>;
  goal: string;

  userHistory: ChatMessage[];
  userSystem?: string;

  maxRounds?: number;
  reactMax?: number;
  retry?: RetryConfig;

  onLog: (t: string) => void;
  onDelta: (t: string) => void;

  onEvent?: (ev: LeaderTeamEvent) => void;
}): Promise<string> {
  const maxRounds = args.maxRounds ?? 8;
  const reactMax = args.reactMax ?? 2;
  let reactCount = 0;
  let planIndex = 0;
  let invalidActionRetries = 0;
  const retryDelaySec = Math.max(0, args.retry?.delaySec ?? 0);
  const retryMax = Math.max(0, args.retry?.max ?? 0);
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  const state: RunState = {
    round: 1,
    goal: args.goal,
    steps: []
  };

  const memberIndex = new Map(args.members.map((m) => [m.agent.id, m]));
  const membersMeta = args.members.map((m) => ({
    id: m.agent.id,
    name: m.agent.name,
    description: m.agent.description
  }));

  let plannedAssignments = membersMeta.map((m) => ({ memberId: m.id, message: "" }));
  const planText = await runOneToOne({
    adapter: args.leader.adapter,
    agent: args.leader.agent,
    input: buildPlanPrompt({
      goal: args.goal,
      leaderName: args.leader.agent.name,
      members: membersMeta
    }),
    history: args.userHistory,
    system: args.userSystem,
    onDelta: () => {},
    retry: args.retry,
    onLog: args.onLog
  });
  const planObj = extractJsonObject(planText);
  const plan = normalizePlan(planObj);
  if (plan) {
    const allowed = new Set(membersMeta.map((m) => m.id));
    const seen = new Set<string>();
    plannedAssignments = plan.assignments
      .filter((a) => allowed.has(a.memberId) && !seen.has(a.memberId) && (seen.add(a.memberId), true))
      .map((a) => ({ memberId: a.memberId, message: a.message }));
  }
  if (plannedAssignments.length === 0) plannedAssignments = membersMeta.map((m) => ({ memberId: m.id, message: "" }));
  args.onEvent?.({
    type: "leader_plan",
    assignments: plannedAssignments,
    notes: plan?.notes,
    raw: planText
  });

  while (state.round <= maxRounds) {
    args.onLog(`Leader round ${state.round}: deciding next action...`);
    const nextAssignment = plannedAssignments[planIndex] ?? plannedAssignments[plannedAssignments.length - 1];
    const nextMemberId = nextAssignment?.memberId;

    const leaderPrompt = buildLeaderPrompt({
      goal: args.goal,
      state,
      leaderName: args.leader.agent.name,
      members: membersMeta,
      plan: plannedAssignments,
      nextMemberId,
      reactCount,
      reactMax
    });

    const leaderText = await runOneToOne({
      adapter: args.leader.adapter,
      agent: args.leader.agent,
      input: leaderPrompt,
      history: args.userHistory,
      system: args.userSystem,
      onDelta: () => {},
      retry: args.retry,
      onLog: args.onLog
    });

    args.onEvent?.({ type: "leader_decision_raw", text: leaderText });
    state.steps.push({ kind: "leader_action", text: leaderText });

    const actObj = extractJsonObject(leaderText);
    const action = normalizeAction(actObj);

    if (!action) {
      if (invalidActionRetries < retryMax) {
        invalidActionRetries += 1;
        args.onLog(`Leader output invalid JSON. Retrying (${invalidActionRetries}/${retryMax})...`);
        args.onEvent?.({
          type: "leader_retry",
          reason: "invalid_json",
          attempt: invalidActionRetries,
          max: retryMax,
          raw: leaderText
        });
        if (retryDelaySec > 0) await sleep(retryDelaySec * 1000);
        continue;
      }
      args.onLog("Leader output was not a valid JSON action. Finishing with leader raw text.");
      args.onEvent?.({ type: "leader_invalid_json", text: leaderText });
      args.onDelta(leaderText);
      return leaderText;
    }

    if (action.type === "finish") {
      const stepsSummary = state.steps
        .map((s, i) => {
          if (s.kind === "leader_action") return `#${i + 1} LEADER_ACTION:\n${s.text}`;
          return `#${i + 1} MEMBER_REPLY (${s.memberName}, id=${s.memberId})\nPROMPT:\n${s.prompt}\nREPLY:\n${s.reply}`;
        })
        .join("\n\n");
      const verifyText = await runOneToOne({
        adapter: args.leader.adapter,
        agent: args.leader.agent,
        input: buildFinalVerifyPrompt({
          goal: args.goal,
          leaderName: args.leader.agent.name,
          stepsSummary
        }),
        history: args.userHistory,
        system: args.userSystem,
        onDelta: () => {},
        retry: args.retry,
        onLog: args.onLog
      });
      const verifyObj = extractJsonObject(verifyText);
      const verify = normalizeVerify(verifyObj);
      if (verify) {
        args.onEvent?.({ type: "leader_verify", ok: verify.ok, notes: verify.reason, raw: verifyText });
      } else {
        args.onEvent?.({ type: "leader_verify", ok: false, notes: "Invalid final verification JSON", raw: verifyText });
      }
      args.onLog("Leader: finish.");
      args.onEvent?.({ type: "leader_finish", answer: action.answer });
      args.onDelta(action.answer);
      return action.answer;
    }

    const resolvedMemberId = nextMemberId ?? action.memberId;
    const member = memberIndex.get(resolvedMemberId);
    if (!member) {
      args.onLog(`Leader asked unknown memberId: ${resolvedMemberId}. Finishing with leader raw text.`);
      args.onEvent?.({ type: "leader_invalid_json", text: leaderText });
      args.onDelta(leaderText);
      return leaderText;
    }

    const message = nextAssignment?.message?.trim() || action.message;
    args.onEvent?.({
      type: "leader_ask_member",
      memberId: member.agent.id,
      memberName: member.agent.name,
      message
    });

    args.onLog(`Leader -> Member(${member.agent.name}): ${message}`);

    const reply = await runOneToOne({
      adapter: member.adapter,
      agent: member.agent,
      input: message,
      history: [],
      system: buildMemberSystem(args.goal, args.leader.agent.name),
      onDelta: () => {},
      retry: args.retry,
      onLog: args.onLog
    });

    args.onEvent?.({
      type: "member_reply",
      memberId: member.agent.id,
      memberName: member.agent.name,
      prompt: message,
      reply
    });

    state.steps.push({
      kind: "member_reply",
      memberId: member.agent.id,
      memberName: member.agent.name,
      prompt: action.message,
      reply
    });

    let verifyPrompt = message;
    let verifyReply = reply;
    let verificationLoop = true;

    while (verificationLoop) {
      const verifyText = await runOneToOne({
        adapter: args.leader.adapter,
        agent: args.leader.agent,
        input: buildVerifyPrompt({
          goal: args.goal,
          leaderName: args.leader.agent.name,
          members: membersMeta,
          lastPrompt: verifyPrompt,
          lastReply: verifyReply,
          reactCount,
          reactMax
        }),
        history: args.userHistory,
        system: args.userSystem,
        onDelta: () => {},
        retry: args.retry,
        onLog: args.onLog
      });

      const verifyObj = extractJsonObject(verifyText);
      const verify = normalizeVerify(verifyObj);
      if (!verify) {
        args.onLog("Leader verification output invalid. Continuing.");
        args.onEvent?.({ type: "leader_verify", ok: false, notes: "Invalid verification JSON", raw: verifyText });
        break;
      }

      args.onEvent?.({ type: "leader_verify", ok: verify.ok, notes: verify.reason, raw: verifyText });

      if (verify.ok) {
        verificationLoop = false;
        break;
      }

      if (!verify.react) {
        args.onLog("Leader verification failed without REACT action. Continuing.");
        break;
      }

      if (reactCount >= reactMax) {
        args.onLog(`REACT limit reached (${reactMax}). Continuing.`);
        break;
      }

      const reactMember = memberIndex.get(verify.react.memberId);
      if (!reactMember) {
        args.onLog(`Leader REACT asked unknown memberId: ${verify.react.memberId}. Continuing.`);
        break;
      }

      reactCount += 1;
      args.onEvent?.({
        type: "leader_react",
        memberId: reactMember.agent.id,
        memberName: reactMember.agent.name,
        message: verify.react.message,
        reason: verify.reason
      });

      args.onLog(`Leader REACT -> Member(${reactMember.agent.name}): ${verify.react.message}`);

      const reactReply = await runOneToOne({
        adapter: reactMember.adapter,
        agent: reactMember.agent,
        input: verify.react.message,
        history: [],
        system: buildMemberSystem(args.goal, args.leader.agent.name),
        onDelta: () => {},
        retry: args.retry,
        onLog: args.onLog
      });

      state.steps.push({
        kind: "leader_action",
        text: `VERIFY: ${verify.reason ?? ""}\nREACT -> ${reactMember.agent.name} (${reactMember.agent.id}): ${verify.react.message}`
      });

      args.onEvent?.({
        type: "member_reply",
        memberId: reactMember.agent.id,
        memberName: reactMember.agent.name,
        prompt: verify.react.message,
        reply: reactReply
      });

      state.steps.push({
        kind: "member_reply",
        memberId: reactMember.agent.id,
        memberName: reactMember.agent.name,
        prompt: verify.react.message,
        reply: reactReply
      });

      verifyPrompt = verify.react.message;
      verifyReply = reactReply;
    }

    planIndex += 1;
    state.round += 1;
  }

  args.onLog(`Max rounds reached (${maxRounds}). Requesting leader to finalize...`);

  const finalPrompt =
    `We reached max rounds. Provide the best final answer now.\n\n` +
    buildLeaderPrompt({
      goal: args.goal,
      state,
      leaderName: args.leader.agent.name,
      members: membersMeta,
      plan: plannedAssignments,
      nextMemberId: plannedAssignments[planIndex]?.memberId,
      reactCount,
      reactMax
    });

  const finalText = await runOneToOne({
    adapter: args.leader.adapter,
    agent: args.leader.agent,
    input: finalPrompt,
    history: args.userHistory,
    system: args.userSystem,
    onDelta: () => {},
    retry: args.retry,
    onLog: args.onLog
  });

  const finalObj = extractJsonObject(finalText);
  const finalAction = normalizeAction(finalObj);
  const answer = finalAction?.type === "finish" ? finalAction.answer : finalText;

  args.onEvent?.({ type: "leader_finish", answer });
  args.onDelta(answer);
  return answer;
}
