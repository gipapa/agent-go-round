import type {
  ChatMessage,
  ChatTraceEntry,
  SkillPhase,
  SkillTodoItem,
  SkillTodoSource,
  SkillTodoStatus
} from "../types";
import { generateId } from "../utils/id";

export function msg(
  role: ChatMessage["role"],
  content: string,
  name?: string,
  meta?: { displayName?: string; avatarUrl?: string }
): ChatMessage {
  return { id: generateId(), role, content, name, displayName: meta?.displayName, avatarUrl: meta?.avatarUrl, ts: Date.now() };
}

export function stringifyAny(value: unknown): string {
  if (value === null || value === undefined) return String(value);
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

export function confirmedFromToolOutput(value: unknown): boolean | null {
  const record = asRecord(value);
  return typeof record?.confirmed === "boolean" ? record.confirmed : null;
}

export function mergeSystemText(...parts: Array<string | undefined>) {
  return parts
    .map((part) => String(part ?? "").trim())
    .filter(Boolean)
    .join("\n\n");
}

export function getThinkStreamingState(buffer: string) {
  const trimmed = buffer.trimStart();
  const lower = trimmed.toLowerCase();
  if (lower.startsWith("<think>")) {
    return {
      hideWhileStreaming: !lower.includes("</think>"),
      statusText: lower.includes("</think>") ? undefined : "思考中…"
    };
  }
  if ("<think>".startsWith(lower)) {
    return {
      hideWhileStreaming: true,
      statusText: "思考中…"
    };
  }
  return {
    hideWhileStreaming: false,
    statusText: undefined
  };
}

export function normalizeImportedMessage(input: unknown): ChatMessage | null {
  const record = asRecord(input);
  if (!record) return null;
  if (typeof record.role !== "string" || typeof record.content !== "string") return null;
  if (!["system", "user", "assistant", "tool"].includes(record.role)) return null;
  const isTraceEntry = (entry: unknown): entry is Record<string, unknown> => {
    const item = asRecord(entry);
    return !!item && typeof item.label === "string" && typeof item.content === "string";
  };
  const isTodoItem = (entry: unknown): entry is Record<string, unknown> => {
    const item = asRecord(entry);
    return (
      !!item &&
      typeof item.id === "string" &&
      typeof item.label === "string" &&
      ["pending", "in_progress", "completed", "blocked"].includes(String(item.status)) &&
      ["skill", "planner", "system"].includes(String(item.source))
    );
  };
  const skillTrace = Array.isArray(record.skillTrace)
    ? record.skillTrace
        .filter(isTraceEntry)
        .map((entry) => ({ label: String(entry.label), content: String(entry.content) } satisfies ChatTraceEntry))
    : undefined;
  const skillTodo = Array.isArray(record.skillTodo)
    ? record.skillTodo
        .filter(isTodoItem)
        .map(
          (item) =>
            ({
              id: String(item.id),
              label: String(item.label),
              status: item.status as SkillTodoStatus,
              source: item.source as SkillTodoSource,
              reason: typeof item.reason === "string" ? item.reason : undefined,
              updatedAt: typeof item.updatedAt === "number" ? item.updatedAt : Date.now()
            }) satisfies SkillTodoItem
        )
    : undefined;
  const skillPhase =
    typeof record.skillPhase === "string" &&
    [
      "skill_load",
      "bootstrap_plan",
      "observe",
      "plan_next_step",
      "act",
      "sync_state",
      "completion_gate",
      "manual_gate",
      "final_answer",
      "verify_refine"
    ].includes(record.skillPhase)
      ? (record.skillPhase as SkillPhase)
      : undefined;
  return {
    id: typeof record.id === "string" ? record.id : generateId(),
    role: record.role as ChatMessage["role"],
    content: record.content,
    name: typeof record.name === "string" ? record.name : undefined,
    displayName: typeof record.displayName === "string" ? record.displayName : undefined,
    avatarUrl: typeof record.avatarUrl === "string" ? record.avatarUrl : undefined,
    statusText: typeof record.statusText === "string" ? record.statusText : undefined,
    isStreaming: record.isStreaming === true,
    hideWhileStreaming: record.hideWhileStreaming === true,
    skillTrace: skillTrace?.length ? skillTrace : undefined,
    skillGoal: typeof record.skillGoal === "string" && record.skillGoal.trim() ? record.skillGoal : undefined,
    skillTodo: skillTodo?.length ? skillTodo : undefined,
    skillPhase,
    ts: typeof record.ts === "number" ? record.ts : Date.now()
  };
}

const TOOL_SUMMARY_MARKERS = ["\n\n請根據以下工具摘要完成回答：\n", "\n\n請將以下工具資訊一起納入回答：\n"];

export function stripPreviousToolPromptSummaries(input: string) {
  let next = input;
  for (const marker of TOOL_SUMMARY_MARKERS) {
    const index = next.indexOf(marker);
    if (index !== -1) {
      next = next.slice(0, index).trimEnd();
    }
  }
  return next;
}

export function appendToolPromptSummary(input: string, summaryBlock: string) {
  const base = stripPreviousToolPromptSummaries(input);
  return `${base}\n\n請根據以下工具摘要完成回答：\n${summaryBlock}\n\n請從目前已建立的頁面、session、工具結果或上下文繼續下一步，不要無理由重複上一個工具動作。若已成功打開頁面，優先觀察、讀取、填寫、點擊或等待，而不是再次打開同一個網址。`;
}
