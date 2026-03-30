import { describe, expect, it } from "vitest";
import { applyActionToState, applyCompletionDecisionToState, createSkillRunState } from "../runtime/skillState";
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

describe("applyActionToState", () => {
  it("preserves grounded browser observation fields when action output only returns a transient success marker", () => {
    const initial = createSkillRunState({
      skillId: "skill-1",
      goal: "repo summary",
      todo: bootstrapTodoList(["open", "click", "summarize"])
    });

    const withObservation = {
      ...initial,
      lastBrowserObservation: {
        sourceTool: "browser_snapshot",
        pageKind: "ranked_list" as const,
        repoName: "mvanhorn/last30days-skill",
        rankedTargets: [{ ref: "@e43", role: "link", label: "mvanhorn / last30days-skill", kind: "repo_link", score: 100 }],
        inputTargets: [],
        actionTargets: [],
        contentHints: ["last30days workflow automation toolkit"]
      }
    };

    const next = applyActionToState(withObservation, "mcp:browser_click", {
      sourceTool: "browser_click",
      pageKind: "unknown",
      title: "Done",
      rankedTargets: [],
      inputTargets: [],
      actionTargets: [],
      contentHints: []
    });

    expect(next.lastBrowserObservation?.pageKind).toBe("ranked_list");
    expect(next.lastBrowserObservation?.repoName).toBe("mvanhorn/last30days-skill");
    expect(next.lastBrowserObservation?.contentHints).toContain("last30days workflow automation toolkit");
  });
});
