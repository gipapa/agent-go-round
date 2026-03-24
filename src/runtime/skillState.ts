import { SkillCompletionDecision, SkillPhase, SkillRunState, SkillStepDecision, SkillTodoItem } from "../types";
import { applyTodoStatus, markFirstPendingTodoInProgress } from "./skillTodo";

export function createSkillRunState(args: {
  skillId: string;
  goal: string;
  todo: SkillTodoItem[];
}): SkillRunState {
  return {
    skillId: args.skillId,
    goal: args.goal,
    phase: "skill_load",
    stepIndex: 0,
    todo: args.todo,
    recentObservationSignatures: [],
    recentActionSignatures: [],
    manualGate: "none",
    completionStatus: "unknown"
  };
}

export function nextPhaseAfterDecision(decision: SkillStepDecision): SkillPhase {
  if (decision.type === "observe") return "observe";
  if (decision.type === "act") return "act";
  if (decision.type === "ask_user") return "manual_gate";
  return "completion_gate";
}

export function applyPlannerDecisionToState(state: SkillRunState, decision: SkillStepDecision): SkillRunState {
  let todo = state.todo;
  if (decision.todoIds?.length) {
    todo = applyTodoStatus(todo, decision.todoIds, decision.type === "finish" ? "completed" : "in_progress", decision.reason);
  } else if (decision.type !== "finish") {
    todo = markFirstPendingTodoInProgress(todo, decision.reason);
  }

  return {
    ...state,
    phase: nextPhaseAfterDecision(decision),
    stepIndex: state.stepIndex + 1,
    todo,
    latestReason: decision.reason
  };
}

export function applyObservationToState(state: SkillRunState, observationSignature?: string): SkillRunState {
  const recentObservationSignatures = observationSignature
    ? [...state.recentObservationSignatures, observationSignature].slice(-3)
    : state.recentObservationSignatures;
  return {
    ...state,
    phase: "sync_state",
    recentObservationSignatures
  };
}

export function applyActionToState(state: SkillRunState, actionSignature?: string): SkillRunState {
  const recentActionSignatures = actionSignature ? [...state.recentActionSignatures, actionSignature].slice(-3) : state.recentActionSignatures;
  return {
    ...state,
    phase: "sync_state",
    recentActionSignatures
  };
}

export function applyManualGateToState(state: SkillRunState, kind: SkillRunState["manualGate"], reason: string): SkillRunState {
  return {
    ...state,
    phase: "manual_gate",
    manualGate: kind,
    latestReason: reason
  };
}

export function resumeManualGate(state: SkillRunState, reason: string): SkillRunState {
  return {
    ...state,
    phase: "observe",
    manualGate: "resumable",
    latestReason: reason
  };
}

export function applyCompletionDecisionToState(state: SkillRunState, decision: SkillCompletionDecision): SkillRunState {
  let todo = state.todo;
  if (decision.todoIds?.length) {
    todo = applyTodoStatus(todo, decision.todoIds, decision.type === "complete" ? "completed" : "blocked", decision.reason);
  }
  return {
    ...state,
    phase: decision.type === "complete" ? "final_answer" : "plan_next_step",
    todo,
    completionStatus: decision.type,
    latestReason: decision.reason
  };
}
