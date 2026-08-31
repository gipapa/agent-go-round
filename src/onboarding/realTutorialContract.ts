import { normalizeCredentialUrl } from "../utils/credential";
import { TUTORIAL_PRIMARY_MODEL } from "./runtime";
import type { TutorialScenarioDefinition, TutorialStepBehaviorId } from "./types";

export type RealTutorialConfig = {
  provider: string;
  apiKeys: string[];
  endpoint: string;
  model: string;
};

export const LOCALHOST_GROQ_ENDPOINT = "https://api.groq.com/openai/v1";

/**
 * Keep this list in sync with performStepAction in the real browser runner.
 * The catalog check runs before starting a browser or provider process so a
 * newly added tutorial behavior fails as a clear contract error.
 */
export const REAL_TUTORIAL_RUNNER_BEHAVIORS = [
  "manual_info",
  "setup_groq_credential",
  "create_single_load_balancer",
  "create_groq_agent",
  "first_chat_joke",
  "create_multi_load_balancer",
  "switch_tutorial_agent_to_multi_load_balancer",
  "create_text_protocol_load_balancer",
  "switch_tutorial_agent_to_text_protocol_load_balancer",
  "create_tutorial_doc",
  "enable_tutorial_doc_access",
  "first_chat_doc_persona",
  "create_tutorial_time_tool",
  "set_history_limit_to_one",
  "set_history_limit_for_multiturn",
  "fill_tutorial_user_profile",
  "enable_tutorial_builtin_tool_access",
  "first_chat_time_tool",
  "first_chat_user_profile_tool",
  "ensure_tutorial_sequential_skill",
  "enable_tutorial_skill_access",
  "first_chat_skill_tone",
  "first_chat_skill_user_profile",
  "first_chat_skill_references",
  "first_chat_skill_asset_template",
  "first_chat_skill_chatgpt_open",
  "register_tutorial_agent_browser_mcp",
  "enable_tutorial_mcp_access",
  "first_chat_mcp_browser_open",
  "first_chat_mcp_browser_snapshot",
  "ensure_tutorial_chatgpt_browser_skill",
  "enable_tutorial_chatgpt_browser_skill_access",
  "first_chat_skill_chatgpt_ask",
  "create_tutorial_harness_stability_tool",
  "ensure_tutorial_harness_stability_skill",
  "enable_tutorial_harness_stability_skill_access",
  "first_chat_skill_harness_stability",
  "ensure_tutorial_grilling_invest_skill",
  "enable_tutorial_grilling_invest_skill_access",
  "first_chat_skill_grilling_invest"
] as const satisfies readonly TutorialStepBehaviorId[];

const supportedBehaviors = new Set<TutorialStepBehaviorId>(REAL_TUTORIAL_RUNNER_BEHAVIORS);

export function parseRealTutorialSessionCount(value: string | undefined) {
  if (!value?.trim()) return 1;
  const count = Number(value);
  if (!Number.isInteger(count) || count < 1 || count > 100) {
    throw new Error("REAL_TUTORIAL_SESSIONS 必須是 1 到 100 之間的整數。");
  }
  return count;
}

export function assertRealTutorialGate(args: { enabled: boolean; only: string; sessions: number }) {
  const gateMinimums: Record<string, number> = {
    "chatgpt-browser-skill": 10,
    "harness-stability-skill": 10,
    "grilling-invest-skill": 10,
    "text-protocol-conformance": 3
  };
  const minimum = gateMinimums[args.only];
  if (args.enabled && (minimum === undefined || args.sessions < minimum)) {
    const supported = Object.keys(gateMinimums).join("、");
    const requirement = minimum === undefined ? "指定支援的案例" : `至少為 ${minimum}`;
    throw new Error(`REAL_TUTORIAL_GATE 需要 REAL_TUTORIAL_ONLY=${supported}，且 ${args.only || "指定案例"} 的 REAL_TUTORIAL_SESSIONS ${requirement}。`);
  }
}

export function assertRealTutorialScenariosSupported(scenarios: readonly TutorialScenarioDefinition[]) {
  for (const scenario of scenarios) {
    for (const step of scenario.steps) {
      if (!supportedBehaviors.has(step.behavior)) {
        throw new Error(`real tutorial runner 尚未支援 ${scenario.id}/${step.id} 的行為：${step.behavior}`);
      }
    }
  }
}

export function normalizeRealTutorialConfig(input: unknown): RealTutorialConfig {
  const record = input && typeof input === "object" && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {};
  const provider = String(record.provider ?? "").trim();
  const apiKeys = Array.isArray(record.apiKey)
    ? record.apiKey.map((entry) => String(entry ?? "").trim()).filter(Boolean)
    : typeof record.apiKey === "string" && record.apiKey.trim()
    ? [record.apiKey.trim()]
    : [];
  const endpoint = normalizeCredentialUrl(typeof record.endpoint === "string" ? record.endpoint : "");
  const model = String(record.model ?? "").trim();

  if (!provider || apiKeys.length === 0 || !endpoint || !model) {
    throw new Error(".tutorial-test.local.json 缺少必要欄位：provider / apiKey / endpoint / model");
  }
  if (endpoint !== LOCALHOST_GROQ_ENDPOINT) {
    throw new Error(`目前教學案例 1 走的是 Groq 路線，.tutorial-test.local.json 的 endpoint 必須是 ${LOCALHOST_GROQ_ENDPOINT}`);
  }
  if (provider !== "groq") {
    throw new Error('目前教學案例 1 需要 provider 設定為 "groq"。');
  }
  if (model !== TUTORIAL_PRIMARY_MODEL) {
    throw new Error(`目前教學案例固定使用模型 ${TUTORIAL_PRIMARY_MODEL}；請更新 .tutorial-test.local.json 的 model。`);
  }

  return { provider, apiKeys, endpoint, model };
}
