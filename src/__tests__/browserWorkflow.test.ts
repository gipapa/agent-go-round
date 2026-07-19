import { describe, expect, it } from "vitest";
import {
  buildBrowserHeuristicCompletion,
  buildBrowserHeuristicDecision,
  buildGroundedRepoSummaryAnswer,
  enrichActionBrowserObservation,
  normalizeBrowserWorkflowStartUrl
} from "../runtime/browserWorkflow";
import type { BrowserObservationDigest, SkillRunState } from "../types";

function observation(overrides: Partial<BrowserObservationDigest> = {}): BrowserObservationDigest {
  return {
    sourceTool: "browser_snapshot",
    pageKind: "unknown",
    rankedTargets: [],
    inputTargets: [],
    actionTargets: [],
    contentHints: [],
    ...overrides
  };
}

function state(lastBrowserObservation: BrowserObservationDigest): SkillRunState {
  return {
    skillId: "browser-workflow",
    goal: "test",
    phase: "sync_state",
    stepIndex: 1,
    todo: [
      { id: "todo-1", label: "Open page", status: "in_progress", source: "planner", updatedAt: 0 },
      { id: "todo-2", label: "Summarize", status: "pending", source: "planner", updatedAt: 0 }
    ],
    recentObservationSignatures: [],
    recentActionSignatures: [],
    manualGate: "none",
    completionStatus: "unknown",
    lastBrowserObservation
  };
}

describe("browser workflow heuristics", () => {
  it("clicks the first ranked repository from a grounded list observation", () => {
    const current = state(
      observation({
        pageKind: "ranked_list",
        rankedTargets: [{ ref: "@repo-1", role: "link", label: "owner / project", kind: "repo_link", score: 200 }]
      })
    );

    expect(
      buildBrowserHeuristicDecision({
        state: current,
        userInput: "打開 GitHub Trending 第一名 repo 並整理摘要",
        resolveMcpServerId: () => "browser-server"
      })
    ).toMatchObject({ type: "act", toolKind: "mcp", toolName: "browser_click", input: { selector: "@repo-1" } });
  });

  it("finishes and builds an answer only from grounded repo content", () => {
    const repoObservation = observation({
      pageKind: "repo_page",
      repoName: "owner / project.git",
      contentHints: ["A useful search toolkit", "Sign in", "API usage examples"]
    });
    const current = state(repoObservation);

    expect(
      buildBrowserHeuristicDecision({
        state: current,
        userInput: "整理 repository README 摘要",
        resolveMcpServerId: () => null
      })
    ).toMatchObject({ type: "finish" });
    expect(buildGroundedRepoSummaryAnswer(repoObservation)).toContain("owner/project");
    expect(buildGroundedRepoSummaryAnswer(repoObservation)).not.toContain("Sign in");
  });

  it("treats a grounded blocked reason as terminal and completes all todo items", () => {
    const current = state(observation({ blockedReason: "頁面停在安全驗證或 bot challenge。" }));
    expect(buildBrowserHeuristicCompletion({ state: current, userInput: "開啟頁面" })).toEqual({
      type: "complete",
      reason: "頁面停在安全驗證或 bot challenge。",
      todoIds: ["todo-1", "todo-2"]
    });
  });

  it("preserves the clicked repo identity when the click result is transient", () => {
    const current = state(
      observation({
        pageKind: "ranked_list",
        rankedTargets: [{ ref: "@repo-1", role: "link", label: "owner / project", kind: "repo_link", score: 200 }]
      })
    );
    const result = enrichActionBrowserObservation({
      state: current,
      decision: { type: "act", reason: "click", toolKind: "mcp", toolName: "browser_click", input: { selector: "@repo-1" } },
      browserObservation: observation({ sourceTool: "browser_click", pageKind: "ranked_list", title: "Done" })
    });

    expect(result).toMatchObject({ sourceTool: "browser_click", pageKind: "unknown", repoName: "owner/project", contentHints: [] });
    expect(result?.title).toBeUndefined();
  });

  it("normalizes first-ranked GitHub Trending goals to the daily unfiltered list", () => {
    expect(
      normalizeBrowserWorkflowStartUrl(
        "請開啟 GitHub Trending 第一名 repository",
        "https://github.com/trending?language=typescript&spoken_language_code=en&since=weekly"
      )
    ).toBe("https://github.com/trending?since=daily");
    expect(normalizeBrowserWorkflowStartUrl("open docs", "not a url")).toBe("not a url");
  });
});
