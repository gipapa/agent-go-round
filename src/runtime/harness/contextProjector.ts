import {
  ContextBudget,
  ContextProjectionFailure,
  DEFAULT_CONTEXT_BUDGET,
  HarnessContextResource,
  HarnessMessage,
  HarnessModelContext,
  HarnessToolDefinition
} from "./types";

const MAX_CONTEXT_BUDGET_CHARS = 1_000_000;

function normalizeLimit(value: number | undefined, fallback: number) {
  return Number.isFinite(value) && (value as number) >= 0
    ? Math.min(MAX_CONTEXT_BUDGET_CHARS, Math.floor(value as number))
    : fallback;
}

function textDigest(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

export function normalizeContextBudget(budget?: Partial<ContextBudget>): ContextBudget {
  return {
    maxTotalChars: normalizeLimit(budget?.maxTotalChars, DEFAULT_CONTEXT_BUDGET.maxTotalChars),
    maxCatalogChars: normalizeLimit(budget?.maxCatalogChars, DEFAULT_CONTEXT_BUDGET.maxCatalogChars),
    maxSkillInstructionChars: normalizeLimit(budget?.maxSkillInstructionChars, DEFAULT_CONTEXT_BUDGET.maxSkillInstructionChars),
    maxResourceChars: normalizeLimit(budget?.maxResourceChars, DEFAULT_CONTEXT_BUDGET.maxResourceChars),
    maxSingleToolResultChars: normalizeLimit(budget?.maxSingleToolResultChars, DEFAULT_CONTEXT_BUDGET.maxSingleToolResultChars),
    maxModelResponseChars: normalizeLimit(budget?.maxModelResponseChars, DEFAULT_CONTEXT_BUDGET.maxModelResponseChars)
  };
}

function capText(value: string, maxChars: number, label: string) {
  if (maxChars <= 0) return "";
  if (value.length <= maxChars) return value;
  const marker = `\n[… ${label} truncated; original_chars=${value.length}; digest=${textDigest(value)}]`;
  if (marker.length >= maxChars) return marker.slice(0, maxChars);
  return `${value.slice(0, maxChars - marker.length)}${marker}`;
}

function messageSize(message: HarnessMessage) {
  try {
    const serialized = JSON.stringify(message);
    return typeof serialized === "string" ? serialized.length : Number.MAX_SAFE_INTEGER;
  } catch {
    // A malformed caller-supplied message is never allowed to escape the
    // projector or reach a provider. Treat it as an over-budget message so a
    // mandatory pair fails closed and an optional older message is skipped.
    return Number.MAX_SAFE_INTEGER;
  }
}

function cloneProjectedMessage(message: HarnessMessage, budget: ContextBudget): HarnessMessage {
  if (message.role !== "tool") return message;
  return {
    ...message,
    modelContent: capText(message.modelContent, budget.maxSingleToolResultChars, "tool result")
  };
}

function messageGroups(transcript: HarnessMessage[]) {
  const groups: Array<{ indexes: number[]; messages: HarnessMessage[] }> = [];
  for (let index = 0; index < transcript.length; index += 1) {
    const current = transcript[index];
    if (current.role === "assistant" && current.action && transcript[index + 1]?.role === "tool") {
      groups.push({ indexes: [index, index + 1], messages: [current, transcript[index + 1]] });
      index += 1;
      continue;
    }
    groups.push({ indexes: [index], messages: [current] });
  }
  return groups;
}

function selectMessages(transcript: HarnessMessage[], systemChars: number, budget: ContextBudget): HarnessMessage[] | ContextProjectionFailure {
  const latestUserIndex = transcript.reduce((latest, message, index) => message.role === "user" ? index : latest, -1);
  if (latestUserIndex < 0) {
    return {
      code: "context_budget_exceeded",
      message: "A model run requires a user message, but the transcript has none."
    };
  }

  const latestUser = cloneProjectedMessage(transcript[latestUserIndex], budget);
  const mandatoryChars = systemChars + messageSize(latestUser);
  if (mandatoryChars > budget.maxTotalChars) {
    return {
      code: "context_budget_exceeded",
      message: `Required model context exceeds the total budget (${mandatoryChars}/${budget.maxTotalChars} chars).`
    };
  }

  const selected = new Map<number, HarnessMessage>();
  selected.set(latestUserIndex, latestUser);
  let usedChars = mandatoryChars;
  const groups = messageGroups(transcript);

  // The most recent complete tool call/result pair is required context. It is
  // never silently dropped just because older messages or runtime notices use
  // the remaining budget; if the pair itself cannot fit, fail closed.
  const latestPairIndex = groups.reduce((latest, group, index) =>
    group.messages.length === 2 ? index : latest, -1);
  if (latestPairIndex >= 0) {
    const pair = groups[latestPairIndex];
    const projectedPair = pair.messages.map((message) => cloneProjectedMessage(message, budget));
    const pairChars = projectedPair.reduce((sum, message) => sum + messageSize(message), 0);
    if (usedChars + pairChars > budget.maxTotalChars) {
      return {
        code: "context_budget_exceeded",
        message: `The latest tool call/result pair exceeds the total context budget (${usedChars + pairChars}/${budget.maxTotalChars} chars).`
      };
    }
    pair.indexes.forEach((index, offset) => selected.set(index, projectedPair[offset]));
    usedChars += pairChars;
  }

  // Keep the latest runtime notice, then recent assistant/tool pairs. A pair is
  // admitted atomically so a tool result can never be shown without its call.
  for (let groupIndex = groups.length - 1; groupIndex >= 0; groupIndex -= 1) {
    const group = groups[groupIndex];
    if (groupIndex === latestPairIndex) continue;
    if (group.indexes.includes(latestUserIndex)) continue;
    const projected = group.messages.map((message) => cloneProjectedMessage(message, budget));
    const groupChars = projected.reduce((sum, message) => sum + messageSize(message), 0);
    if (usedChars + groupChars > budget.maxTotalChars) continue;
    group.indexes.forEach((index, offset) => selected.set(index, projected[offset]));
    usedChars += groupChars;
  }

  return Array.from(selected.entries())
    .sort(([left], [right]) => left - right)
    .map(([, message]) => message);
}

export function projectModelContext(args: {
  transcript: HarnessMessage[];
  system?: string;
  tools: HarnessToolDefinition[];
  skillInstructions?: string;
  resources?: HarnessContextResource[];
  budget?: Partial<ContextBudget>;
}): HarnessModelContext | ContextProjectionFailure {
  const budget = normalizeContextBudget(args.budget);
  let catalog: string;
  try {
    const serialized = JSON.stringify(args.tools);
    if (typeof serialized !== "string") {
      return { code: "tool_catalog_too_large", message: "Tool catalog is not serializable." };
    }
    catalog = serialized;
  } catch {
    return { code: "tool_catalog_too_large", message: "Tool catalog is not serializable." };
  }
  if (catalog.length > budget.maxCatalogChars) {
    return {
      code: "tool_catalog_too_large",
      message: `Tool catalog exceeds the catalog budget (${catalog.length}/${budget.maxCatalogChars} chars).`
    };
  }

  const skillInstructions = String(args.skillInstructions ?? "");
  if (skillInstructions.length > budget.maxSkillInstructionChars) {
    return {
      code: "skill_instructions_too_large",
      message: `Skill instructions exceed the skill budget (${skillInstructions.length}/${budget.maxSkillInstructionChars} chars).`
    };
  }

  let resourceChars = 0;
  const resourceBlocks: string[] = [];
  for (const resource of args.resources ?? []) {
    if (resourceBlocks.length >= 100) break;
    if (resourceChars >= budget.maxResourceChars) break;
    const remaining = Math.max(0, budget.maxResourceChars - resourceChars);
    const path = String(resource.path ?? "").slice(0, 512);
    const content = capText(String(resource.content ?? ""), remaining, `resource ${path}`);
    resourceChars += content.length;
    resourceBlocks.push(`[UNTRUSTED_SKILL_RESOURCE path=${JSON.stringify(path)}]\n${content}`);
  }

  const systemParts = [
    args.system?.trim() ?? "",
    catalog ? `[UNTRUSTED_TOOL_CATALOG]\n${catalog}` : "",
    skillInstructions ? `[UNTRUSTED_SKILL_INSTRUCTIONS]\n${skillInstructions}` : "",
    resourceBlocks.length ? resourceBlocks.join("\n\n") : ""
  ].filter(Boolean);
  const system = systemParts.join("\n\n");
  const messages = selectMessages(args.transcript, system.length, budget);
  if (!Array.isArray(messages)) return messages;

  const chars = system.length + messages.reduce((sum, message) => sum + messageSize(message), 0);
  if (chars > budget.maxTotalChars) {
    return {
      code: "context_budget_exceeded",
      message: `Model context exceeds the total budget (${chars}/${budget.maxTotalChars} chars).`
    };
  }

  return {
    system,
    messages,
    tools: args.tools,
    chars
  };
}
