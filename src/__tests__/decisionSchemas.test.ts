import { describe, expect, it } from "vitest";
import {
  normalizeLeaderAction,
  normalizeLeaderPlan,
  normalizeLeaderVerify,
  normalizeSkillBootstrapPlan,
  normalizeSkillDecision,
  normalizeToolDecision
} from "../schemas/decisions";
import { normalizeSkillCompletionDecision, normalizeSkillStepDecision } from "../runtime/skillPlanner";
import { normalizeSkillVerifyDecision } from "../runtime/skillExecutor";

describe("decision schemas", () => {
  it("normalizes tool decisions and legacy user profile calls", () => {
    expect(normalizeToolDecision({ type: "NO_TOOL" })).toEqual({ type: "no_tool" });
    expect(normalizeToolDecision({ type: "user_profile_call", tool: "get_user_profile" })).toEqual({
      type: "builtin_tool_call",
      tool: "get_user_profile",
      input: {}
    });
    expect(normalizeToolDecision({ action: "mcp_call", serverId: "s1", tool: "echo", input: { text: "hi" } })).toEqual({
      type: "mcp_call",
      serverId: "s1",
      tool: "echo",
      input: { text: "hi" }
    });
  });

  it("normalizes skill decisions and bootstrap plans", () => {
    expect(normalizeSkillDecision({ type: "skill_call", skillId: "  browser  ", input: { url: "https://example.com" } })).toEqual({
      type: "skill_call",
      skillId: "browser",
      input: { url: "https://example.com" }
    });
    expect(normalizeSkillBootstrapPlan({ todo: [" open ", "", " summarize "], notes: [" n1 ", ""] })).toEqual({
      todo: ["open", "summarize"],
      notes: ["n1"]
    });
  });

  it("normalizes multi-turn skill decisions", () => {
    expect(normalizeSkillStepDecision({ type: "act", reason: " use tool ", toolKind: "mcp", toolName: " echo ", todoIds: [" t1 "] })).toEqual({
      type: "act",
      reason: "use tool",
      toolKind: "mcp",
      toolName: "echo",
      todoIds: ["t1"]
    });
    expect(normalizeSkillCompletionDecision({ type: "incomplete", reason: " missing summary ", suggestedFocus: " repo " })).toEqual({
      type: "incomplete",
      reason: "missing summary",
      suggestedFocus: "repo"
    });
    expect(normalizeSkillVerifyDecision({ type: "refine", reason: " too short ", revisionPrompt: " add detail " })).toEqual({
      type: "refine",
      reason: "too short",
      revisionPrompt: "add detail"
    });
  });

  it("normalizes leader-team decisions", () => {
    expect(normalizeLeaderAction({ action: "finish", answer: "done" })).toEqual({ type: "finish", answer: "done" });
    expect(normalizeLeaderVerify({ ok: false, reason: "needs work", react: { memberId: "m1", message: "retry" } })).toEqual({
      ok: false,
      reason: "needs work",
      react: { memberId: "m1", message: "retry" }
    });
    expect(normalizeLeaderPlan({ assignments: [{ memberId: "m1", message: "first" }] })).toEqual({
      assignments: [{ memberId: "m1", message: "first" }]
    });
  });
});
