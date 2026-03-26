import { describe, expect, it } from "vitest";
import { applyCompletionDecisionToState, createSkillRunState } from "../runtime/skillState";
import { bootstrapTodoList } from "../runtime/skillTodo";

describe("applyCompletionDecisionToState", () => {
  it("marks all remaining todo as completed when completion has no explicit todoIds", () => {
    const initial = createSkillRunState({
      skillId: "skill-1",
      goal: "demo goal",
      todo: bootstrapTodoList(["step 1", "step 2", "step 3"])
    });

    const inProgress = {
      ...initial,
      todo: initial.todo.map((item, index) => ({
        ...item,
        status: index === 2 ? "pending" : "in_progress" as const
      }))
    };

    const next = applyCompletionDecisionToState(inProgress, {
      type: "complete",
      reason: "workflow finished"
    });

    expect(next.phase).toBe("final_answer");
    expect(next.completionStatus).toBe("complete");
    expect(next.todo.every((item) => item.status === "completed")).toBe(true);
  });

  it("keeps incomplete decisions in progress instead of blocking todo", () => {
    const initial = createSkillRunState({
      skillId: "skill-1",
      goal: "demo goal",
      todo: bootstrapTodoList(["step 1", "step 2"])
    });

    const next = applyCompletionDecisionToState(initial, {
      type: "incomplete",
      reason: "need one more observation",
      todoIds: [initial.todo[1].id]
    });

    expect(next.phase).toBe("plan_next_step");
    expect(next.completionStatus).toBe("incomplete");
    expect(next.todo[1].status).toBe("in_progress");
    expect(next.todo[1].reason).toContain("need one more observation");
  });
});
