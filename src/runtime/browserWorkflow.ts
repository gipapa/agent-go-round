import type { BrowserObservationDigest, SkillRunState, SkillStepDecision } from "../types";

function goalWantsFirstRankedTarget(text: string) {
  const normalized = String(text ?? "").toLowerCase();
  return /(第一名|第一個|首個|top|first)/i.test(normalized) && /(repo|repository|專案|trend|trending|熱門|排行)/i.test(normalized);
}

export function goalWantsRepoSummary(text: string) {
  return /(內容|摘要|summary|介紹|readme|repo|repository|專案)/i.test(String(text ?? ""));
}

function normalizeRepoLabel(value: string) {
  return String(value ?? "").replace(/\s*\/\s*/g, "/").replace(/\.git$/i, "").trim();
}

function getMeaningfulContentHints(observation?: BrowserObservationDigest | null) {
  if (!observation) return [];
  return observation.contentHints
    .map((hint) => String(hint ?? "").trim())
    .filter(Boolean)
    .filter((hint) => !/^(homepage|platform|solutions|resources|open source|enterprise)$/i.test(hint))
    .filter((hint) => !/^(sign in|sign up|登入|註冊)$/i.test(hint))
    .filter((hint) => !/^(issues \d+|pull requests \d+|fork \d+|actions|projects|security|insights)$/i.test(hint))
    .filter((hint) => !/^permalink:/i.test(hint));
}

export function hasGroundedRepoSummary(observation?: BrowserObservationDigest | null) {
  if (!observation || observation.pageKind !== "repo_page") return false;
  return !!observation.repoName || getMeaningfulContentHints(observation).length > 0;
}

export function buildGroundedRepoSummaryAnswer(observation?: BrowserObservationDigest | null) {
  if (!hasGroundedRepoSummary(observation)) return null;
  const repoName = observation?.repoName ? normalizeRepoLabel(observation.repoName) : "目前頁面上的目標 repository";
  const hints = getMeaningfulContentHints(observation).slice(0, 6);

  return [
    "【目前狀態】",
    `已成功進入目標 repository 頁面：${repoName}。`,
    "",
    "【頁面內容摘要】",
    `專案名稱：${repoName}`,
    hints.length ? `可見重點：\n- ${hints.join("\n- ")}` : "這一輪已確認進入 repo 頁面，但沒有擷取到足夠的 README 文字重點。",
    "",
    "【說明】",
    "以上摘要直接根據目前頁面可見內容整理，避免引用未觀察到的 README 細節。"
  ].join("\n");
}

export function normalizeBrowserWorkflowStartUrl(userInput: string, startUrl: string) {
  const raw = String(startUrl ?? "").trim();
  if (!raw) return raw;
  try {
    const url = new URL(raw);
    const isGitHubTrending = /(^|\.)github\.com$/i.test(url.hostname) && url.pathname === "/trending";
    if (isGitHubTrending && goalWantsFirstRankedTarget(userInput)) {
      url.searchParams.delete("language");
      url.searchParams.delete("spoken_language_code");
      url.searchParams.delete("spokenLanguage");
      url.searchParams.delete("dateRange");
      url.searchParams.set("since", "daily");
    }
    return url.toString();
  } catch {
    return raw;
  }
}

export function buildBrowserHeuristicDecision(args: {
  state: SkillRunState;
  userInput: string;
  resolveMcpServerId: (toolName: string) => string | null;
}) {
  const observation = args.state.lastBrowserObservation;
  if (!observation) return null;

  if (
    goalWantsFirstRankedTarget(args.userInput) &&
    observation.pageKind === "ranked_list" &&
    observation.sourceTool !== "browser_click" &&
    observation.rankedTargets.length
  ) {
    const browserClickServerId = args.resolveMcpServerId("browser_click");
    if (browserClickServerId) {
      const topTarget = observation.rankedTargets[0];
      return {
        type: "act" as const,
        reason: `Structured browser observation identified the top ranked target ${topTarget.label}; click it directly to advance the workflow.`,
        toolKind: "mcp" as const,
        toolName: "browser_click",
        input: { selector: topTarget.ref }
      };
    }
  }

  if (goalWantsRepoSummary(args.userInput) && hasGroundedRepoSummary(observation)) {
    return {
      type: "finish" as const,
      reason:
        observation.repoName && getMeaningfulContentHints(observation).length
          ? `Structured browser observation confirms the workflow is already on repo page ${observation.repoName} with grounded content hints collected.`
          : "Structured browser observation confirms the workflow reached the target repository page."
    };
  }

  return null;
}

export function buildBrowserHeuristicCompletion(args: { state: SkillRunState; userInput: string }) {
  const observation = args.state.lastBrowserObservation;
  if (!observation) return null;
  if (observation.blockedReason) {
    return {
      type: "complete" as const,
      reason: observation.blockedReason,
      todoIds: args.state.todo.map((item) => item.id)
    };
  }
  if (goalWantsRepoSummary(args.userInput) && hasGroundedRepoSummary(observation)) {
    return {
      type: "complete" as const,
      reason:
        observation.repoName && getMeaningfulContentHints(observation).length
          ? `Reached repository page ${observation.repoName} and collected grounded page content hints for final summarization.`
          : "Reached the requested repository page and observed its main content."
    };
  }
  return null;
}

export function enrichActionBrowserObservation(args: {
  state: SkillRunState;
  decision: Extract<SkillStepDecision, { type: "act" }>;
  browserObservation?: BrowserObservationDigest | null;
}) {
  const observation = args.browserObservation ? { ...args.browserObservation } : null;
  if (!observation) return observation;

  const decisionInput =
    args.decision.input && typeof args.decision.input === "object" ? (args.decision.input as Record<string, unknown>) : {};
  if (args.decision.toolName === "browser_click" && typeof decisionInput.selector === "string") {
    const selector = decisionInput.selector.trim();
    const clickedTarget = args.state.lastBrowserObservation?.rankedTargets.find((target) => target.ref === selector) ?? null;
    if (clickedTarget && !observation.repoName) {
      observation.repoName = normalizeRepoLabel(clickedTarget.label);
    }
    if (/^done$/i.test(String(observation.title ?? "").trim())) {
      observation.title = undefined;
    }
    if (observation.pageKind === "ranked_list" && !observation.rankedTargets.length && !observation.url) {
      observation.pageKind = "unknown";
      observation.contentHints = [];
    }
  }

  return observation;
}
