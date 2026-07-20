import type {
  AgentConfig,
  LoadedSkillRuntime,
  SkillCompletionDecision,
  SkillConfig,
  SkillRunState,
  SkillStepDecision
} from "../types";
import {
  normalizeSkillBootstrapPlan,
  normalizeSkillDecision,
  type SkillBootstrapPlan,
  type SkillDecision,
  type ToolDecision
} from "../schemas/decisions";
import type { ExecutionDeadline } from "../utils/deadline";
import { extractJsonObject } from "../utils/safeJson";
import { extractFirstUrl, parseToolDecision, type ToolEntry } from "./toolDecision";
import { buildToolDecisionCatalog, buildToolDecisionPrompt } from "./toolDecisionPrompt";
import { buildSkillDecisionCatalog, buildSkillDecisionPrompt } from "./skillRuntime";
import { buildSkillVerifyPrompt, normalizeSkillVerifyDecision } from "./skillExecutor";
import {
  buildBootstrapPlanPrompt,
  buildCompletionGatePrompt,
  buildPlannerStepPrompt,
  normalizeSkillCompletionDecision,
  normalizeSkillStepDecision
} from "./skillPlanner";
import { bootstrapTodoList, summarizeTodo } from "./skillTodo";
import type { PendingLogEntry } from "./logging";
import { runStructuredDecision } from "./structuredDecision";

type RetryPolicy = { delaySec: number; max: number };
type TraceWriter = (label: string, content: string) => void;

export type InvokeDecisionArgs = {
  agent: AgentConfig;
  input: string;
  requestId?: string;
  requestLabel: string;
  deadline?: ExecutionDeadline;
  onLog: (text: string) => void;
};

type DecisionRunnerDependencies = {
  invoke: (args: InvokeDecisionArgs) => Promise<string>;
  pushLog: (entry: PendingLogEntry) => void;
};

export type ToolDecisionArgs = {
  agent: AgentConfig;
  userInput: string;
  retry: RetryPolicy;
  toolEntries: ToolEntry[];
  promptTemplate: string;
  fallbackPromptTemplate: string;
  requestId?: string;
  deadline?: ExecutionDeadline;
};

export type SkillDecisionArgs = {
  agent: AgentConfig;
  userInput: string;
  retry: RetryPolicy;
  skills: SkillConfig[];
  language: "zh" | "en";
  promptTemplate?: string;
  requestId?: string;
  deadline?: ExecutionDeadline;
};

export type SkillVerifyDecisionArgs = {
  answeringAgent: AgentConfig;
  verifierAgent: AgentConfig;
  userInput: string;
  currentInput: string;
  answer: string;
  skill: SkillConfig;
  runtime: LoadedSkillRuntime;
  round: number;
  retry: RetryPolicy;
  promptTemplate?: string;
  requestId?: string;
  deadline?: ExecutionDeadline;
};

export type SkillBootstrapPlanArgs = {
  agent: AgentConfig;
  retry: RetryPolicy;
  skill: SkillConfig;
  runtime: LoadedSkillRuntime;
  userInput: string;
  promptTemplate?: string;
  requestId?: string;
  deadline?: ExecutionDeadline;
  onTrace?: TraceWriter;
};

export type SkillStepPlannerArgs = {
  agent: AgentConfig;
  retry: RetryPolicy;
  state: SkillRunState;
  skill: SkillConfig;
  runtime: LoadedSkillRuntime;
  userInput: string;
  currentContext: string;
  toolScopeSummary: string;
  mustObserve: boolean;
  mustAct: boolean;
  phaseHint?: string;
  promptTemplate?: string;
  requestId?: string;
  deadline?: ExecutionDeadline;
  onTrace?: TraceWriter;
};

export type SkillCompletionGateArgs = {
  agent: AgentConfig;
  retry: RetryPolicy;
  state: SkillRunState;
  skill: SkillConfig;
  runtime: LoadedSkillRuntime;
  userInput: string;
  currentContext: string;
  toolScopeSummary: string;
  promptTemplate?: string;
  requestId?: string;
  deadline?: ExecutionDeadline;
  onTrace?: TraceWriter;
};

export function createDecisionRunners(dependencies: DecisionRunnerDependencies) {
  const invoke = (args: Omit<InvokeDecisionArgs, "onLog">, stage: string) =>
    dependencies.invoke({
      ...args,
      onLog: (text) => dependencies.pushLog({
        category: "retry",
        agent: args.agent.name,
        requestId: args.requestId,
        stage,
        message: text
      })
    });

  async function runToolDecision(args: ToolDecisionArgs): Promise<ToolDecision | null> {
    const toolList = buildToolDecisionCatalog(args.toolEntries);
    const prompt = buildToolDecisionPrompt(
      args.promptTemplate,
      args.fallbackPromptTemplate,
      args.userInput,
      JSON.stringify(toolList, null, 2)
    );

    return await runStructuredDecision({
      retry: args.retry,
      invoke: () => invoke({
        agent: args.agent,
        input: prompt,
        requestId: args.requestId,
        requestLabel: "tool decision",
        deadline: args.deadline
      }, "tool decision"),
      parse: parseToolDecision,
      onTerminal: (_raw, failure) => dependencies.pushLog({
        category: "mcp", agent: args.agent.name, ok: false, requestId: args.requestId, stage: "tool decision",
        message: "Tool decision failed after model retries", details: failure
      }),
      onSuccess: (decision, raw) => dependencies.pushLog({
        category: "mcp", agent: args.agent.name, ok: true, requestId: args.requestId, stage: "tool decision",
        message: `Tool decision: ${decision.type}`, details: raw
      }),
      onInvalid: (raw, attempt, total) => dependencies.pushLog({
        category: "mcp", agent: args.agent.name, ok: false, requestId: args.requestId, stage: "tool decision",
        message: `Tool decision invalid schema (${attempt + 1}/${total})`, details: raw
      })
    });
  }

  async function runSkillDecision(args: SkillDecisionArgs): Promise<SkillDecision | null> {
    const skillList = buildSkillDecisionCatalog(args.skills);
    const prompt = buildSkillDecisionPrompt(args.userInput, JSON.stringify(skillList, null, 2), args.language, args.promptTemplate);

    return await runStructuredDecision({
      retry: args.retry,
      invoke: () => invoke({
        agent: args.agent,
        input: prompt,
        requestId: args.requestId,
        requestLabel: "skill decision",
        deadline: args.deadline
      }, "skill decision"),
      parse: (raw) => normalizeSkillDecision(extractJsonObject(raw)),
      onTerminal: (_raw, failure) => dependencies.pushLog({
        category: "skills", agent: args.agent.name, ok: false, requestId: args.requestId, stage: "skill decision",
        message: "Skill decision failed after model retries", details: failure
      }),
      onSuccess: (decision, raw) => dependencies.pushLog({
        category: "skills", agent: args.agent.name, ok: true, requestId: args.requestId, stage: "skill decision",
        message: `Skill decision: ${decision.type}`, details: raw
      }),
      onInvalid: (raw, attempt, total) => dependencies.pushLog({
        category: "skills", agent: args.agent.name, ok: false, requestId: args.requestId, stage: "skill decision",
        message: `Skill decision invalid schema (${attempt + 1}/${total})`, details: raw
      })
    });
  }

  async function runSkillVerifyDecision(args: SkillVerifyDecisionArgs) {
    const stage = `skill verify round ${args.round}`;
    const prompt = buildSkillVerifyPrompt({
      skill: args.skill,
      runtime: args.runtime,
      userInput: args.userInput,
      currentInput: args.currentInput,
      answer: args.answer,
      round: args.round,
      template: args.promptTemplate
    });

    return await runStructuredDecision({
      retry: args.retry,
      invoke: () => invoke({
        agent: args.verifierAgent,
        input: prompt,
        requestId: args.requestId,
        requestLabel: stage,
        deadline: args.deadline
      }, stage),
      parse: (raw) => normalizeSkillVerifyDecision(extractJsonObject(raw)),
      onTerminal: (_raw, failure) => dependencies.pushLog({
        category: "skills", agent: args.answeringAgent.name, ok: false, requestId: args.requestId, stage,
        message: `Skill verify round ${args.round} failed after model retries`, details: failure
      }),
      onSuccess: (decision, raw) => dependencies.pushLog({
        category: "skills", agent: args.answeringAgent.name, ok: true, requestId: args.requestId, stage,
        message: `Skill verify round ${args.round}: ${decision.type}`, details: raw
      }),
      onInvalid: (raw, attempt, total) => dependencies.pushLog({
        category: "skills", agent: args.answeringAgent.name, ok: false, requestId: args.requestId, stage,
        message: `Skill verify invalid schema (${attempt + 1}/${total})`, details: raw
      })
    });
  }

  async function runSkillBootstrapPlan(args: SkillBootstrapPlanArgs): Promise<SkillBootstrapPlan> {
    const prompt = buildBootstrapPlanPrompt({
      skill: args.skill,
      runtime: args.runtime,
      userInput: args.userInput,
      template: args.promptTemplate
    });
    const parsed = await runStructuredDecision({
      retry: args.retry,
      invoke: () => invoke({
        agent: args.agent,
        input: prompt,
        requestId: args.requestId,
        requestLabel: "skill bootstrap plan",
        deadline: args.deadline
      }, "skill bootstrap plan"),
      parse: (raw) => {
        const decision = normalizeSkillBootstrapPlan(extractJsonObject(raw));
        return decision?.todo.length ? decision : null;
      },
      onTerminal: (raw, failure) => {
        dependencies.pushLog({
          category: "skills", agent: args.agent.name, ok: false, requestId: args.requestId, stage: "skill bootstrap plan",
          message: "Skill bootstrap plan failed after model retries", details: failure
        });
        args.onTrace?.("Bootstrap raw", raw);
      },
      onSuccess: (decision, raw) => {
        dependencies.pushLog({
          category: "skills", agent: args.agent.name, ok: true, requestId: args.requestId, stage: "skill bootstrap plan",
          message: "Skill bootstrap plan created", details: raw
        });
        args.onTrace?.("Bootstrap raw", raw);
        args.onTrace?.("Bootstrap parsed", [
          decision.taskSummary ? `Task summary: ${decision.taskSummary}` : "",
          decision.startUrl ? `Start URL: ${decision.startUrl}` : "Start URL: (none)",
          decision.notes?.length ? `Notes:\n- ${decision.notes.join("\n- ")}` : "",
          `Todo:\n${bootstrapTodoList(decision.todo).map((item, index) => `${index + 1}. ${item.label}`).join("\n")}`
        ].filter(Boolean).join("\n"));
      },
      onInvalid: (raw, attempt, total) => {
        dependencies.pushLog({
          category: "skills", agent: args.agent.name, ok: false, requestId: args.requestId, stage: "skill bootstrap plan",
          message: `Skill bootstrap plan invalid schema (${attempt + 1}/${total})`, details: raw
        });
        args.onTrace?.("Bootstrap raw", raw);
      }
    });

    return parsed ?? {
      todo: [
        "載入 skill 與必要資源",
        "觀察目前狀態",
        "執行下一個工具操作",
        "確認任務是否完成",
        "整理最終回覆"
      ],
      startUrl: extractFirstUrl(args.userInput)
    };
  }

  async function runSkillStepPlanner(args: SkillStepPlannerArgs): Promise<SkillStepDecision | null> {
    const step = args.state.stepIndex + 1;
    const stage = `skill planner step ${step}`;
    const traceLabel = `Planner raw ${step}`;
    const prompt = buildPlannerStepPrompt({
      skill: args.skill,
      runtime: args.runtime,
      userInput: args.userInput,
      currentContext: args.currentContext,
      currentPhaseHint: args.phaseHint,
      toolScopeSummary: args.toolScopeSummary,
      todoSummary: summarizeTodo(args.state.todo),
      mustObserve: args.mustObserve,
      mustAct: args.mustAct,
      template: args.promptTemplate
    });

    return await runStructuredDecision({
      retry: args.retry,
      invoke: () => invoke({
        agent: args.agent,
        input: prompt,
        requestId: args.requestId,
        requestLabel: stage,
        deadline: args.deadline
      }, stage),
      parse: (raw) => normalizeSkillStepDecision(extractJsonObject(raw)),
      onTerminal: (raw, failure) => {
        dependencies.pushLog({
          category: "skills", agent: args.agent.name, ok: false, requestId: args.requestId, stage,
          message: `Skill planner step ${step} failed after model retries`, details: failure
        });
        args.onTrace?.(traceLabel, [`Raw:\n${raw}`, "", "Normalized: invalid (terminal failure)"].join("\n"));
      },
      onSuccess: (decision, raw) => {
        dependencies.pushLog({
          category: "skills", agent: args.agent.name, ok: true, requestId: args.requestId, stage,
          message: `Skill planner step: ${decision.type}`, details: raw
        });
        args.onTrace?.(traceLabel, [`Raw:\n${raw}`, "", `Normalized: ${JSON.stringify(decision, null, 2)}`].join("\n"));
      },
      onInvalid: (raw, attempt, total) => {
        dependencies.pushLog({
          category: "skills", agent: args.agent.name, ok: false, requestId: args.requestId, stage,
          message: `Skill planner step invalid schema (${attempt + 1}/${total})`, details: raw
        });
        args.onTrace?.(traceLabel, [`Raw:\n${raw}`, "", "Normalized: invalid"].join("\n"));
      }
    });
  }

  async function runSkillCompletionGate(args: SkillCompletionGateArgs): Promise<SkillCompletionDecision | null> {
    const step = args.state.stepIndex;
    const stage = `skill completion gate ${step}`;
    const traceLabel = `Completion raw ${step}`;
    const prompt = buildCompletionGatePrompt({
      skill: args.skill,
      runtime: args.runtime,
      userInput: args.userInput,
      currentContext: args.currentContext,
      todoSummary: summarizeTodo(args.state.todo),
      template: args.promptTemplate
    });

    return await runStructuredDecision({
      retry: args.retry,
      invoke: () => invoke({
        agent: args.agent,
        input: prompt,
        requestId: args.requestId,
        requestLabel: stage,
        deadline: args.deadline
      }, stage),
      parse: (raw) => normalizeSkillCompletionDecision(extractJsonObject(raw)),
      onTerminal: (raw, failure) => {
        dependencies.pushLog({
          category: "skills", agent: args.agent.name, ok: false, requestId: args.requestId, stage,
          message: `Skill completion gate step ${step} failed after model retries`, details: failure
        });
        args.onTrace?.(traceLabel, [`Raw:\n${raw}`, "", "Normalized: invalid (terminal failure)"].join("\n"));
      },
      onSuccess: (decision, raw) => {
        dependencies.pushLog({
          category: "skills", agent: args.agent.name, ok: true, requestId: args.requestId, stage,
          message: `Skill completion gate: ${decision.type}`, details: raw
        });
        args.onTrace?.(traceLabel, [`Raw:\n${raw}`, "", `Normalized: ${JSON.stringify(decision, null, 2)}`].join("\n"));
      },
      onInvalid: (raw, attempt, total) => {
        dependencies.pushLog({
          category: "skills", agent: args.agent.name, ok: false, requestId: args.requestId, stage,
          message: `Skill completion gate invalid schema (${attempt + 1}/${total})`, details: raw
        });
        args.onTrace?.(traceLabel, [`Raw:\n${raw}`, "", "Normalized: invalid"].join("\n"));
      }
    });
  }

  return {
    runToolDecision,
    runSkillDecision,
    runSkillVerifyDecision,
    runSkillBootstrapPlan,
    runSkillStepPlanner,
    runSkillCompletionGate
  };
}
