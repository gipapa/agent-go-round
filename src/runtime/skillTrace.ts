import { ChatTraceEntry, SkillPhase, SkillTodoItem } from "../types";
import { pushSkillTrace } from "./skillRuntime";
import { summarizeTodo } from "./skillTodo";

export function pushSkillPhaseTrace(trace: ChatTraceEntry[], phase: SkillPhase, content: string) {
  const labelMap: Record<SkillPhase, string> = {
    skill_load: "Skill load",
    bootstrap_plan: "Bootstrap plan",
    observe: "Observation",
    plan_next_step: "Planner step",
    act: "Action",
    sync_state: "State sync",
    completion_gate: "Completion gate",
    manual_gate: "Manual gate",
    final_answer: "Final answer",
    verify_refine: "Verify/refine"
  };
  pushSkillTrace(trace, labelMap[phase], content);
}

export function pushSkillTodoTrace(trace: ChatTraceEntry[], label: string, todo: SkillTodoItem[]) {
  pushSkillTrace(trace, label, summarizeTodo(todo));
}
