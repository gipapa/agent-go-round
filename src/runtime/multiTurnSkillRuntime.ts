import {
  BrowserObservationDigest,
  ChatTraceEntry,
  LoadedSkillRuntime,
  SkillCompletionDecision,
  SkillConfig,
  SkillRunState,
  SkillStepDecision,
  SkillTodoItem
} from "../types";
import { applyCompletionDecisionToState, applyObservationToState, applyActionToState, applyManualGateToState, applyPlannerDecisionToState, createSkillRunState, resumeManualGate } from "./skillState";
import { pushSkillPhaseTrace, pushSkillTodoTrace } from "./skillTrace";
import { formatBrowserObservationDigest } from "./browserObservation";

function compactTraceText(text: string, max = 1200) {
  const normalized = String(text ?? "").replace(/\r/g, "").trim();
  if (!normalized) return "(empty)";
  return normalized.length <= max ? normalized : `${normalized.slice(0, Math.max(0, max - 1))}…`;
}

function decisionSatisfiesConstraints(decision: SkillStepDecision, mustObserve: boolean, mustAct: boolean) {
  if (mustObserve) {
    return decision.type === "observe" || decision.type === "ask_user";
  }
  if (mustAct) {
    return decision.type === "act" || decision.type === "ask_user";
  }
  return true;
}

export type MultiTurnToolScopeSummary = {
  summary: string;
  toolCount: number;
};

export type MultiTurnObservationResult = {
  context: string;
  detail?: string;
  observationSignature?: string;
  actionSignature?: string;
  browserObservation?: BrowserObservationDigest | null;
  preferredMcpServerId?: string;
};

export type MultiTurnActionResult = {
  context: string;
  detail?: string;
  toolLabel?: string;
  actionSignature?: string;
  observationSignature?: string;
  confirmed?: boolean | null;
  browserObservation?: BrowserObservationDigest | null;
  preferredMcpServerId?: string;
};

export type MultiTurnSkillCallbacks = {
  onStatus?: (text: string) => void;
  onStateChange?: (state: SkillRunState) => void;
  buildToolScopeSummary: (state: SkillRunState) => MultiTurnToolScopeSummary;
  bootstrapPlan: (args: { skill: SkillConfig; runtime: LoadedSkillRuntime; userInput: string }) => Promise<SkillTodoItem[]>;
  decideNextStep: (args: {
    state: SkillRunState;
    skill: SkillConfig;
    runtime: LoadedSkillRuntime;
    userInput: string;
    currentContext: string;
    toolScopeSummary: string;
    mustObserve: boolean;
    mustAct: boolean;
    phaseHint?: string;
  }) => Promise<SkillStepDecision | null>;
  runObservation: (args: { state: SkillRunState; currentContext: string }) => Promise<MultiTurnObservationResult | null>;
  runAction: (args: { decision: Extract<SkillStepDecision, { type: "act" }>; state: SkillRunState; currentContext: string }) => Promise<MultiTurnActionResult | null>;
  runManualGate: (args: { decision: Extract<SkillStepDecision, { type: "ask_user" }>; state: SkillRunState; currentContext: string }) => Promise<MultiTurnActionResult | null>;
  checkCompletion: (args: {
    state: SkillRunState;
    skill: SkillConfig;
    runtime: LoadedSkillRuntime;
    userInput: string;
    currentContext: string;
    toolScopeSummary: string;
  }) => Promise<SkillCompletionDecision | null>;
};

export type MultiTurnSkillRuntimeResult = {
  finalInput: string;
  trace: ChatTraceEntry[];
  todo: SkillTodoItem[];
  phase: SkillRunState["phase"];
  finalAnswerOverride?: string;
};

function detectTerminalBlockedContext(text: string, browserObservation?: BrowserObservationDigest | null) {
  if (browserObservation?.blockedReason) {
    return {
      reason: browserObservation.blockedReason
    };
  }
  const normalized = String(text ?? "").toLowerCase();
  if (!normalized.trim()) return null;

  const patterns = [
    "目前無法使用",
    "無法使用 ai 模式",
    "目前不可用",
    "功能不可用",
    "unusual traffic",
    "not a robot",
    "recaptcha",
    "security challenge",
    "our systems have detected unusual traffic",
    "checks to see if it's really you",
    "驗證您是真人",
    "安全驗證",
    "我不是機器人",
    "your device or account currently can't use",
    "your device or account cannot use",
    "currently can't use",
    "currently cannot use",
    "currently unavailable",
    "feature is unavailable",
    "is unavailable for the current",
    "not available for your account",
    "not available in your region"
  ];

  const matched = patterns.find((pattern) => normalized.includes(pattern));
  if (!matched) return null;

  return {
    reason: "目前觀察結果已明確顯示此功能在當前裝置、帳戶或地區不可用，屬於已確認的 blocked 狀態，可直接整理結果回覆。"
  };
}

function buildTerminalBlockedAnswer(goal: string, currentContext: string) {
  const normalized = String(currentContext ?? "");
  const looksLikeBotGate =
    /unusual traffic|recaptcha|security challenge|我不是機器人|安全驗證|驗證您是真人/i.test(normalized);
  const looksLikeUnavailable =
    /目前無法使用|不可用|cannot use|can't use|currently unavailable|not available/i.test(normalized);

  const status = looksLikeBotGate
    ? "目前流程已停在網站的安全驗證 / bot challenge。"
    : looksLikeUnavailable
      ? "目前流程已確認該功能在這個裝置、帳戶或地區不可用。"
      : "目前流程已停在一個已確認的 blocked 狀態。";

  const reason = looksLikeBotGate
    ? "系統已經成功打開入口並觀察頁面，但網站要求額外人工驗證，因此這一輪不再自動重試。"
    : looksLikeUnavailable
      ? "系統已經成功打開入口並觀察頁面，頁面本身已明確表示目前無法繼續使用這項功能。"
      : "系統已成功打開入口並觀察頁面，但目前沒有可自動恢復的下一步。";

  return [
    "【目前狀態】",
    status,
    "",
    "【執行步驟】",
    `1. 已依請求開始處理：${goal}`,
    "2. 已打開目標網站入口並完成頁面觀察。",
    "3. 已確認目前屬於 blocked/manual 狀態，因此停止自動重試。",
    "",
    "【取得的回應】",
    reason
  ].join("\n");
}

export async function runMultiTurnSkillRuntime(args: {
  skill: SkillConfig;
  runtime: LoadedSkillRuntime;
  userInput: string;
  initialInput: string;
  initialTrace: ChatTraceEntry[];
  toolLoopMax: number;
  callbacks: MultiTurnSkillCallbacks;
}): Promise<MultiTurnSkillRuntimeResult> {
  const trace = [...args.initialTrace];
  let currentContext = args.initialInput;

  args.callbacks.onStatus?.("正在建立 multi-turn skill todo…");
  const todo = await args.callbacks.bootstrapPlan({
    skill: args.skill,
    runtime: args.runtime,
    userInput: args.userInput
  });

  let state = createSkillRunState({
    skillId: args.skill.id,
    goal: args.userInput,
    todo
  });
  args.callbacks.onStateChange?.(state);

  pushSkillPhaseTrace(trace, "bootstrap_plan", todo.length ? "已建立多輪 skill todo 清單。" : "未產生 todo，將直接以空清單繼續。");
  pushSkillTodoTrace(trace, "Skill todo", state.todo);

  let mustObserve = false;
  let mustAct = false;
  let phaseHint = "";

  for (let round = 1; round <= args.toolLoopMax; round++) {
    const toolScope = args.callbacks.buildToolScopeSummary(state);
    args.callbacks.onStatus?.(`正在規劃 multi-turn 第 ${round} 步…`);
    let decision = await args.callbacks.decideNextStep({
      state,
      skill: args.skill,
      runtime: args.runtime,
      userInput: args.userInput,
      currentContext,
      toolScopeSummary: toolScope.summary,
      mustObserve,
      mustAct,
      phaseHint
    });

    if (decision && !decisionSatisfiesConstraints(decision, mustObserve, mustAct)) {
      const constraintHint = mustObserve
        ? "上一個工具動作剛改變狀態，現在必須先 observe 或 ask_user，不能直接 act 或 finish。"
        : "最近連續 observation 沒有推進流程，現在必須 act 或 ask_user，不能再 observe 或 finish。";

      pushSkillPhaseTrace(
        trace,
        "plan_next_step",
        [
          `Step ${round}`,
          "Planner decision violated runtime constraint.",
          `Original decision: ${decision.type}`,
          `Constraint:\n${constraintHint}`
        ].join("\n")
      );

      decision = await args.callbacks.decideNextStep({
        state,
        skill: args.skill,
        runtime: args.runtime,
        userInput: args.userInput,
        currentContext,
        toolScopeSummary: toolScope.summary,
        mustObserve,
        mustAct,
        phaseHint: [phaseHint, constraintHint, "請立即改成符合限制的下一步。"].filter(Boolean).join("\n")
      });
    }

    if (decision && !decisionSatisfiesConstraints(decision, mustObserve, mustAct)) {
      decision = mustObserve
        ? { type: "observe", reason: "Runtime enforced an observation step because the previous action changed state." }
        : {
            type: "ask_user",
            reason: "Runtime could not obtain a valid action after repeated observation with no progress.",
            message: "自動流程暫時卡住了，因為系統連續觀察後仍無法規劃出下一個有效操作。是否同意先由我停在這裡，讓你檢查目前頁面狀態後再繼續？"
          };

      pushSkillPhaseTrace(
        trace,
        "plan_next_step",
        [
          `Step ${round}`,
          "Planner repair still violated runtime constraint.",
          `Fallback decision: ${decision.type}`
        ].join("\n")
      );
    }

    pushSkillPhaseTrace(
      trace,
      "plan_next_step",
      [
        `Step ${round}`,
        `mustObserve=${mustObserve}`,
        `mustAct=${mustAct}`,
        phaseHint ? `Hint:\n${phaseHint}` : "",
        decision ? `Decision: ${decision.type}\nReason: ${decision.reason}` : "Decision: invalid"
      ]
        .filter(Boolean)
        .join("\n")
    );

    if (!decision) {
      pushSkillPhaseTrace(
        trace,
        "sync_state",
        [`Step ${round}`, "Planner returned no valid decision. The runtime will leave the tool loop here."].join("\n")
      );
      break;
    }

    state = applyPlannerDecisionToState(state, decision);
    args.callbacks.onStateChange?.(state);
    pushSkillTodoTrace(trace, `Skill todo update ${round}`, state.todo);

    if (decision.type === "observe") {
      args.callbacks.onStatus?.(`正在觀察頁面，第 ${round} 步…`);
      const observation = await args.callbacks.runObservation({ state, currentContext });
      pushSkillPhaseTrace(
        trace,
        "observe",
        [
          `Step ${round}`,
          observation?.detail ?? "觀察未取得額外資訊"
        ].join("\n")
      );
      currentContext = observation?.context ?? currentContext;
      const last = state.recentObservationSignatures.at(-1) ?? null;
      state = applyObservationToState(
        state,
        observation?.observationSignature,
        observation?.browserObservation ?? undefined,
        observation?.preferredMcpServerId
      );
      args.callbacks.onStateChange?.(state);
      pushSkillPhaseTrace(
        trace,
        "sync_state",
        [
          `Step ${round}`,
          observation?.observationSignature ? `observationSignature=${observation.observationSignature}` : "observationSignature=(none)",
          observation?.actionSignature ? `actionSignature=${observation.actionSignature}` : "",
          observation?.browserObservation ? `browserObservation:\n${formatBrowserObservationDigest(observation.browserObservation)}` : "",
          observation?.preferredMcpServerId ? `preferredMcpServerId=${observation.preferredMcpServerId}` : "",
          `currentContext:\n${compactTraceText(currentContext)}`
        ]
          .filter(Boolean)
          .join("\n")
      );
      const terminalBlock = detectTerminalBlockedContext(currentContext, observation?.browserObservation);
      if (terminalBlock) {
        const allTodoIds = state.todo.map((item) => item.id);
        pushSkillPhaseTrace(
          trace,
          "completion_gate",
          [`Step ${round}`, "Decision: complete", `Reason: ${terminalBlock.reason}`].join("\n")
        );
        state = applyCompletionDecisionToState(state, {
          type: "complete",
          reason: terminalBlock.reason,
          todoIds: allTodoIds
        });
        args.callbacks.onStateChange?.(state);
        pushSkillTodoTrace(trace, `Skill todo completion ${round}`, state.todo);
        return {
          finalInput: currentContext,
          trace,
          todo: state.todo,
          phase: state.phase,
          finalAnswerOverride: buildTerminalBlockedAnswer(args.userInput, currentContext)
        };
      }
      mustObserve = false;
      mustAct = !!observation?.observationSignature && !!last && observation.observationSignature === last;
      phaseHint = mustAct ? "最近兩次 observation 相同，下一步請改用 action 或 ask_user。" : "";
      continue;
    }

    if (decision.type === "act") {
      args.callbacks.onStatus?.(`正在執行工具「${decision.toolName}」…`);
      const action = await args.callbacks.runAction({ decision, state, currentContext });
      pushSkillPhaseTrace(
        trace,
        "act",
        [
          `Step ${round}`,
          action?.toolLabel ? `Tool: ${action.toolLabel}` : `Tool: ${decision.toolName}`,
          action?.detail ?? "工具已執行"
        ].join("\n")
      );
      currentContext = action?.context ?? currentContext;
      state = applyActionToState(state, action?.actionSignature, action?.browserObservation ?? undefined, action?.preferredMcpServerId);
      args.callbacks.onStateChange?.(state);
      pushSkillPhaseTrace(
        trace,
        "sync_state",
        [
          `Step ${round}`,
          action?.actionSignature ? `actionSignature=${action.actionSignature}` : "actionSignature=(none)",
          action?.observationSignature ? `observationSignature=${action.observationSignature}` : "",
          action?.browserObservation ? `browserObservation:\n${formatBrowserObservationDigest(action.browserObservation)}` : "",
          action?.preferredMcpServerId ? `preferredMcpServerId=${action.preferredMcpServerId}` : "",
          `currentContext:\n${compactTraceText(currentContext)}`
        ]
          .filter(Boolean)
          .join("\n")
      );
      mustObserve = true;
      mustAct = false;
      phaseHint = "上一個動作已改變狀態，下一步請先 observe。";
      continue;
    }

    if (decision.type === "ask_user") {
      args.callbacks.onStatus?.("正在等待使用者確認…");
      state = applyManualGateToState(state, "awaiting_user_confirmation", decision.reason);
      args.callbacks.onStateChange?.(state);
      const manual = await args.callbacks.runManualGate({ decision, state, currentContext });
      pushSkillPhaseTrace(
        trace,
        "manual_gate",
        [
          `Step ${round}`,
          manual?.detail ?? decision.message,
          manual?.confirmed === true ? "使用者已同意，流程將繼續。" : manual?.confirmed === false ? "使用者拒絕，流程停止。" : ""
        ]
          .filter(Boolean)
          .join("\n")
      );
      currentContext = manual?.context ?? currentContext;
      if (manual?.confirmed === true) {
        state = resumeManualGate(state, decision.reason);
        args.callbacks.onStateChange?.(state);
        pushSkillPhaseTrace(
          trace,
          "sync_state",
          [
            `Step ${round}`,
            "Manual gate resume approved.",
            `currentContext:\n${compactTraceText(currentContext)}`
          ].join("\n")
        );
        mustObserve = true;
        mustAct = false;
        phaseHint = "manual gate 已通過，請先 observe 目前狀態，再決定下一步。";
        continue;
      }
      state = applyManualGateToState(state, "awaiting_manual_browser_step", decision.reason);
      args.callbacks.onStateChange?.(state);
      return {
        finalInput: currentContext,
        trace,
        todo: state.todo,
        phase: state.phase
      };
    }

    const completion = await args.callbacks.checkCompletion({
      state,
      skill: args.skill,
      runtime: args.runtime,
      userInput: args.userInput,
      currentContext,
      toolScopeSummary: toolScope.summary
    });

    pushSkillPhaseTrace(
      trace,
      "completion_gate",
      [
        `Step ${round}`,
        completion ? `Decision: ${completion.type}` : "Decision: invalid",
        completion?.reason ? `Reason: ${completion.reason}` : "",
        completion?.type === "incomplete" && completion.suggestedFocus ? `Suggested focus:\n${completion.suggestedFocus}` : ""
      ]
        .filter(Boolean)
        .join("\n")
    );

    if (!completion) {
      pushSkillPhaseTrace(
        trace,
        "sync_state",
        [`Step ${round}`, "Completion gate returned no valid decision; the runtime will continue only if a later refine pass is triggered."].join("\n")
      );
      break;
    }

    state = applyCompletionDecisionToState(state, completion);
    args.callbacks.onStateChange?.(state);
    pushSkillTodoTrace(trace, `Skill todo completion ${round}`, state.todo);

    if (completion.type === "complete") {
      return {
        finalInput: currentContext,
        trace,
        todo: state.todo,
        phase: state.phase
      };
    }

    mustObserve = false;
    mustAct = false;
    phaseHint = [completion.reason, completion.suggestedFocus ? `接下來請優先：${completion.suggestedFocus}` : ""].filter(Boolean).join("\n");
  }

  return {
    finalInput: currentContext,
    trace,
    todo: state.todo,
    phase: state.phase
  };
}
