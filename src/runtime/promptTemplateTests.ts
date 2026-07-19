import { getDefaultPromptTemplate, type PromptTemplateBaseId } from "../promptTemplates/store";
import {
  normalizeSkillBootstrapPlan,
  normalizeSkillDecision,
  normalizeToolDecision
} from "../schemas/decisions";
import type { LoadedSkillRuntime, SkillConfig } from "../types";
import { extractJsonObject } from "../utils/safeJson";
import { SYSTEM_BUILT_IN_TOOLS, SYSTEM_USER_PROFILE_TOOL_ID } from "../utils/systemBuiltInTools";
import { buildToolDecisionPrompt } from "./toolDecisionPrompt";
import { buildSkillDecisionPrompt } from "./skillRuntime";
import { buildSkillVerifyPrompt, normalizeSkillVerifyDecision } from "./skillExecutor";
import {
  buildBootstrapPlanPrompt,
  buildCompletionGatePrompt,
  buildPlannerStepPrompt,
  normalizeSkillCompletionDecision,
  normalizeSkillStepDecision
} from "./skillPlanner";

export type PromptTemplateApiTestState = {
  status: "idle" | "running" | "success" | "failure";
  summary?: string;
  expected?: string;
  requestId?: string;
  agentName?: string;
  prompt?: string;
  system?: string;
  rawOutput?: string;
  parsedOutput?: string;
  updatedAt?: number;
};

type PromptTemplateApiTestValidation = {
  pass: boolean;
  summary: string;
  parsed?: unknown;
};

export type PromptTemplateApiTestSpec = {
  title: string;
  description: string;
  expected: string;
  prompt: string;
  system?: string;
  validate: (raw: string) => PromptTemplateApiTestValidation;
};

function buildPromptTemplateTestSkill(args: { id: string; name: string; description: string; instructions: string }): {
  skill: SkillConfig;
  runtime: LoadedSkillRuntime;
} {
  const skill: SkillConfig = {
    id: args.id,
    name: args.name,
    version: "1.0.0",
    description: args.description,
    decisionHint: args.description,
    workflow: { instructions: args.instructions },
    skillMarkdown: `# ${args.name}`,
    rootPath: `/prompt-template-tests/${args.id}`,
    fileCount: 1,
    docCount: 0,
    scriptCount: 0,
    assetCount: 0,
    updatedAt: 0
  };
  const runtime: LoadedSkillRuntime = {
    skillId: skill.id,
    name: skill.name,
    description: skill.description,
    instructions: args.instructions,
    referencedPaths: [],
    loadedReferences: [],
    assetPaths: [],
    loadedAssets: [],
    allowMcp: false,
    allowBuiltInTools: false
  };
  return { skill, runtime };
}

function renderPromptTemplate(template: string, replacements: Record<string, string>) {
  let prompt = template;
  Object.entries(replacements).forEach(([placeholder, value]) => {
    prompt = prompt.split(placeholder).join(value);
  });
  return prompt;
}

export function buildPromptTemplateApiTestSpec(args: {
  baseId: PromptTemplateBaseId;
  language: "zh" | "en";
  template: string;
}): PromptTemplateApiTestSpec {
  const isEn = args.language === "en";
  const sequential = buildPromptTemplateTestSkill({
    id: "sequential-thinking-test",
    name: "sequential-thinking",
    description: isEn ? "Calm, structured, step-by-step explanations." : "冷靜、有條理、逐步說明。",
    instructions: isEn
      ? "Give calm, structured answers. Break the answer into small stable steps."
      : "請冷靜、有條理地回答，並拆成穩定的小步驟。"
  });
  const browserWorkflow = buildPromptTemplateTestSkill({
    id: "browser-workflow-multiturn-test",
    name: "browser-workflow-multiturn",
    description: isEn ? "Open pages, click targets, and summarize results." : "打開頁面、點擊目標並整理結果。",
    instructions: isEn
      ? "Use the browser session step by step and summarize what you observed."
      : "逐步使用瀏覽器 session，並整理觀察結果。"
  });

  switch (args.baseId) {
    case "tool-decision": {
      const expectedToolName =
        SYSTEM_BUILT_IN_TOOLS.find((tool) => tool.id === SYSTEM_USER_PROFILE_TOOL_ID)?.name ?? "get_user_profile";
      const userInput = isEn ? "Read my personal profile before answering." : "在回答前先讀取我的個人資訊。";
      const toolListJson = JSON.stringify(
        [
          { kind: "builtin", tool: expectedToolName, summary: isEn ? "Read the current user's profile." : "讀取目前使用者個人資訊。" },
          { kind: "builtin", tool: "clock_dashboard_demo", summary: isEn ? "Open a live clock dashboard in the page." : "在頁面中打開即時時鐘 dashboard。" },
          { kind: "mcp", server: "Browser", tool: "browser_open", summary: isEn ? "Open a URL in a browser session." : "在瀏覽器 session 中打開網址。" }
        ],
        null,
        2
      );
      return {
        title: isEn ? "Tool decision chooses get_user_profile" : "Tool decision 會選 get_user_profile",
        description: isEn
          ? "Uses a fake tool catalog and expects a builtin tool decision for the current user profile."
          : "使用假的工具清單，預期會回傳讀取使用者個人資訊的 builtin tool decision。",
        expected: isEn
          ? 'Expected JSON: {"type":"builtin_tool_call","tool":"get_user_profile","input":{}}'
          : '預期 JSON：{"type":"builtin_tool_call","tool":"get_user_profile","input":{}}',
        prompt: buildToolDecisionPrompt(
          args.template,
          getDefaultPromptTemplate(`tool-decision.${args.language}`),
          userInput,
          toolListJson
        ),
        validate: (raw) => {
          const parsed = normalizeToolDecision(extractJsonObject(raw));
          if (!parsed) return { pass: false, summary: isEn ? "Output is not valid tool-decision JSON." : "輸出不是有效的 tool-decision JSON。" };
          if (parsed.type !== "builtin_tool_call" || parsed.tool !== expectedToolName) {
            return {
              pass: false,
              summary: isEn ? `Expected ${expectedToolName}, got ${JSON.stringify(parsed)}.` : `預期 ${expectedToolName}，實際得到 ${JSON.stringify(parsed)}。`,
              parsed
            };
          }
          return { pass: true, summary: isEn ? `Parsed a valid ${expectedToolName} tool decision.` : `已解析成正確的 ${expectedToolName} tool decision。`, parsed };
        }
      };
    }
    case "skill-decision": {
      const userInput = isEn
        ? "I am anxious. Please explain calmly and step by step why 1+1=2."
        : "我有點慌，請冷靜又有條理地逐步解釋為什麼 1+1=2。";
      const skillListJson = JSON.stringify(
        [
          { id: sequential.skill.id, name: sequential.skill.name, summary: sequential.skill.description },
          { id: browserWorkflow.skill.id, name: browserWorkflow.skill.name, summary: browserWorkflow.skill.description }
        ],
        null,
        2
      );
      return {
        title: isEn ? "Skill decision chooses sequential-thinking" : "Skill decision 會選 sequential-thinking",
        description: isEn
          ? "Uses a fake skill catalog and expects a skill_call for calm structured reasoning."
          : "使用假的 skill 清單，預期會對冷靜有條理的需求選擇 sequential-thinking。",
        expected: isEn
          ? `Expected JSON: {"type":"skill_call","skillId":"${sequential.skill.id}","input":{}}`
          : `預期 JSON：{"type":"skill_call","skillId":"${sequential.skill.id}","input":{}}`,
        prompt: buildSkillDecisionPrompt(userInput, skillListJson, args.language, args.template),
        validate: (raw) => {
          const parsed = normalizeSkillDecision(extractJsonObject(raw));
          if (!parsed) return { pass: false, summary: isEn ? "Output is not valid skill-decision JSON." : "輸出不是有效的 skill-decision JSON。" };
          if (parsed.type !== "skill_call" || parsed.skillId !== sequential.skill.id) {
            return { pass: false, summary: isEn ? `Expected ${sequential.skill.id}, got ${JSON.stringify(parsed)}.` : `預期 ${sequential.skill.id}，實際得到 ${JSON.stringify(parsed)}。`, parsed };
          }
          return { pass: true, summary: isEn ? "Parsed a valid sequential-thinking skill decision." : "已解析成正確的 sequential-thinking skill decision。", parsed };
        }
      };
    }
    case "skill-runtime-system": {
      const system = renderPromptTemplate(args.template, {
        "{{skillName}}": sequential.skill.name,
        "{{skillId}}": sequential.skill.id
      });
      return {
        title: isEn ? "Skill runtime system prompt preserves direct answers" : "Skill runtime system prompt 不會妨礙直接回答",
        description: isEn
          ? "Applies the selected system prompt and checks that the model can still follow a strict direct instruction."
          : "套用目前的 system prompt，確認模型仍然能遵守明確的直接指令。",
        expected: isEn ? "Expected text containing: READY_ONLY" : "預期文字包含：READY_ONLY",
        system,
        prompt: isEn ? "Reply with exactly READY_ONLY. No markdown." : "請只回覆 READY_ONLY，不要加 markdown。",
        validate: (raw) => {
          if (!String(raw ?? "").trim()) return { pass: false, summary: isEn ? "Model returned empty output." : "模型回傳空內容。" };
          const pass = String(raw).includes("READY_ONLY");
          return {
            pass,
            summary: pass
              ? isEn ? "Model followed the direct instruction under the current runtime system prompt." : "模型在目前 runtime system prompt 下仍能遵守直接指令。"
              : isEn ? "Output did not contain READY_ONLY." : "輸出未包含 READY_ONLY。",
            parsed: raw.trim()
          };
        }
      };
    }
    case "skill-verify": {
      const prompt = buildSkillVerifyPrompt({
        skill: sequential.skill,
        runtime: sequential.runtime,
        userInput: isEn ? "Please explain calmly and step by step why 1+1=2." : "請冷靜又有條理地逐步解釋為什麼 1+1=2。",
        currentInput: isEn ? "Give a calm, structured, step-by-step answer." : "請給出冷靜、有條理、逐步的回答。",
        answer: isEn
          ? "1. One unit plus one more unit makes two units. 2. Counting the combined units gives 2."
          : "1. 一個單位再加上一個單位，總數會變成兩個單位。2. 把它們一起計數，就會得到 2。",
        round: 1,
        template: args.template
      });
      return {
        title: isEn ? "Skill verify returns pass for a good answer" : "Skill verify 對良好答案回傳 pass",
        description: isEn ? "Uses a clearly acceptable structured answer and expects a pass decision." : "提供一個明顯可接受的結構化回答，預期回傳 pass。",
        expected: isEn ? 'Expected JSON: {"type":"pass","reason":"..."}' : '預期 JSON：{"type":"pass","reason":"..."}',
        prompt,
        validate: (raw) => {
          const parsed = normalizeSkillVerifyDecision(extractJsonObject(raw));
          if (!parsed) return { pass: false, summary: isEn ? "Output is not valid skill-verify JSON." : "輸出不是有效的 skill-verify JSON。" };
          if (parsed.type !== "pass") return { pass: false, summary: isEn ? `Expected pass, got ${JSON.stringify(parsed)}.` : `預期 pass，實際得到 ${JSON.stringify(parsed)}。`, parsed };
          return { pass: true, summary: isEn ? "Parsed a valid pass decision." : "已解析成正確的 pass decision。", parsed };
        }
      };
    }
    case "skill-bootstrap-plan": {
      const prompt = buildBootstrapPlanPrompt({
        skill: browserWorkflow.skill,
        runtime: browserWorkflow.runtime,
        userInput: isEn
          ? "Open https://github.com/trending?since=daily, click the first repository, then summarize the README."
          : "打開 https://github.com/trending?since=daily，點進第一名的 repository，然後整理 README 摘要。",
        template: args.template
      });
      return {
        title: isEn ? "Bootstrap plan returns todo + startUrl" : "Bootstrap plan 會回傳 todo 與 startUrl",
        description: isEn ? "Checks that the bootstrap prompt returns a valid task summary and non-empty todo list." : "確認 bootstrap prompt 會回傳有效的 task summary 與非空 todo 清單。",
        expected: isEn
          ? "Expected JSON with taskSummary, todo[3+], and startUrl close to https://github.com/trending?since=daily"
          : "預期 JSON 具有 taskSummary、至少 3 個 todo，且 startUrl 接近 https://github.com/trending?since=daily",
        prompt,
        validate: (raw) => {
          const parsed = normalizeSkillBootstrapPlan(extractJsonObject(raw));
          if (!parsed) return { pass: false, summary: isEn ? "Output is not valid bootstrap-plan JSON." : "輸出不是有效的 bootstrap-plan JSON。" };
          const pass = parsed.todo.length >= 3 && !!parsed.taskSummary && String(parsed.startUrl ?? "").includes("github.com/trending");
          return {
            pass,
            summary: pass
              ? isEn ? "Parsed a valid bootstrap plan with todo and direct startUrl." : "已解析成有效的 bootstrap plan，包含 todo 與直接 startUrl。"
              : isEn ? `Bootstrap plan parsed but missing required fields: ${JSON.stringify(parsed)}` : `已解析 bootstrap plan，但缺少必要欄位：${JSON.stringify(parsed)}`,
            parsed
          };
        }
      };
    }
    case "skill-planner-step": {
      const prompt = buildPlannerStepPrompt({
        skill: browserWorkflow.skill,
        runtime: browserWorkflow.runtime,
        userInput: isEn ? "Open GitHub Trending, click the first repo, and summarize it." : "打開 GitHub Trending，點進第一名 repo，然後整理摘要。",
        currentContext: isEn
          ? "The previous action changed state. The page is already open. A fresh observation is required before clicking anything."
          : "上一個動作已改變狀態，頁面已打開。在點擊任何目標前，必須先重新 observe。",
        currentPhaseHint: isEn ? "The previous action changed state; observe next." : "上一個動作已改變狀態，下一步請先 observe。",
        toolScopeSummary: "MCP:Browser/browser_snapshot [observe]\nMCP:Browser/browser_click [state_change]",
        todoSummary: isEn
          ? "1. [in_progress] Open GitHub Trending\n2. [pending] Click the first repository"
          : "1. [in_progress] 打開 GitHub Trending\n2. [pending] 點擊第一個 repository",
        mustObserve: true,
        mustAct: false,
        template: args.template
      });
      return {
        title: isEn ? "Planner step chooses observe after state change" : "Planner step 會在狀態改變後選 observe",
        description: isEn ? "Checks the mustObserve path and expects an observe decision." : "驗證 mustObserve 路徑，預期回傳 observe。",
        expected: isEn ? 'Expected JSON: {"type":"observe","reason":"..."}' : '預期 JSON：{"type":"observe","reason":"..."}',
        prompt,
        validate: (raw) => {
          const parsed = normalizeSkillStepDecision(extractJsonObject(raw));
          if (!parsed) return { pass: false, summary: isEn ? "Output is not valid planner-step JSON." : "輸出不是有效的 planner-step JSON。" };
          if (parsed.type !== "observe") return { pass: false, summary: isEn ? `Expected observe, got ${JSON.stringify(parsed)}.` : `預期 observe，實際得到 ${JSON.stringify(parsed)}。`, parsed };
          return { pass: true, summary: isEn ? "Parsed a valid observe decision." : "已解析成正確的 observe decision。", parsed };
        }
      };
    }
    case "skill-completion-gate": {
      const prompt = buildCompletionGatePrompt({
        skill: browserWorkflow.skill,
        runtime: browserWorkflow.runtime,
        userInput: isEn ? "Open GitHub Trending, click the first repo, and summarize it." : "打開 GitHub Trending，點進第一名 repo，然後整理摘要。",
        todoSummary: isEn
          ? "1. [completed] Open GitHub Trending\n2. [completed] Click the first repo\n3. [completed] Summarize the README"
          : "1. [completed] 打開 GitHub Trending\n2. [completed] 點擊第一名 repo\n3. [completed] 整理 README 摘要",
        currentContext: isEn
          ? "Reached repository page mvanhorn/last30days-skill and collected grounded page content hints for final summarization."
          : "已到達 repository 頁面 mvanhorn/last30days-skill，並擷取足夠的 grounded page content hints，可直接整理最終摘要。",
        template: args.template
      });
      return {
        title: isEn ? "Completion gate recognizes a finished workflow" : "Completion gate 能辨識已完成的 workflow",
        description: isEn ? "Checks a clearly finished browser workflow and expects complete." : "驗證明顯已完成的 browser workflow，預期回傳 complete。",
        expected: isEn ? 'Expected JSON: {"type":"complete","reason":"..."}' : '預期 JSON：{"type":"complete","reason":"..."}',
        prompt,
        validate: (raw) => {
          const parsed = normalizeSkillCompletionDecision(extractJsonObject(raw));
          if (!parsed) return { pass: false, summary: isEn ? "Output is not valid completion-gate JSON." : "輸出不是有效的 completion-gate JSON。" };
          if (parsed.type !== "complete") return { pass: false, summary: isEn ? `Expected complete, got ${JSON.stringify(parsed)}.` : `預期 complete，實際得到 ${JSON.stringify(parsed)}。`, parsed };
          return { pass: true, summary: isEn ? "Parsed a valid complete decision." : "已解析成正確的 complete decision。", parsed };
        }
      };
    }
    default:
      return {
        title: isEn ? "Prompt template test" : "Prompt template 測試",
        description: isEn ? "No test definition is available." : "沒有可用的測試定義。",
        expected: isEn ? "No expected output defined." : "未定義預期輸出。",
        prompt: "",
        validate: () => ({ pass: false, summary: isEn ? "No validator defined." : "未定義驗證器。" })
      };
  }
}
