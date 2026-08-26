import type {
  ChatMessage,
  ChatTraceEntry,
  SkillPhase,
  SkillTodoItem,
  SkillTodoSource,
  SkillTodoStatus
} from "../types";
import { generateId } from "../utils/id";

export const MAX_PERSISTED_CHAT_CONTENT_CHARS = 64_000;
const MAX_PERSISTED_TRACE_ENTRIES = 80;
const MAX_PERSISTED_TODO_ENTRIES = 100;
const MAX_PERSISTED_ACTIVITY_ENTRIES = 256;
const MAX_PERSISTED_ID_CHARS = 200;
const MAX_PERSISTED_LABEL_CHARS = 160;
const MAX_PERSISTED_METADATA_CHARS = 2_000;

function boundedPersistedText(value: string, maxChars: number) {
  if (value.length <= maxChars) return value;
  const marker = `\n[… persisted text truncated; original_chars=${value.length}]`;
  return maxChars <= marker.length ? marker.slice(0, maxChars) : `${value.slice(0, maxChars - marker.length)}${marker}`;
}

export function boundChatContent(value: string) {
  return boundedPersistedText(value, MAX_PERSISTED_CHAT_CONTENT_CHARS);
}

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
        .slice(-MAX_PERSISTED_TRACE_ENTRIES)
        .map(
          (entry) =>
            ({
              label: String(entry.label).slice(0, MAX_PERSISTED_LABEL_CHARS),
              content: boundedPersistedText(String(entry.content), MAX_PERSISTED_METADATA_CHARS)
            } satisfies ChatTraceEntry)
        )
    : undefined;
  const skillTodo = Array.isArray(record.skillTodo)
    ? record.skillTodo
        .filter(isTodoItem)
        .slice(-MAX_PERSISTED_TODO_ENTRIES)
        .map(
          (item) =>
            ({
              id: String(item.id).slice(0, MAX_PERSISTED_ID_CHARS),
              label: String(item.label).slice(0, MAX_PERSISTED_LABEL_CHARS),
              status: item.status as SkillTodoStatus,
              source: item.source as SkillTodoSource,
              reason: typeof item.reason === "string" ? boundedPersistedText(item.reason, MAX_PERSISTED_METADATA_CHARS) : undefined,
              updatedAt: typeof item.updatedAt === "number" && Number.isFinite(item.updatedAt) ? item.updatedAt : Date.now()
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
  const harnessRunRecord = asRecord(record.harnessRun);
  const harnessActivity = Array.isArray(harnessRunRecord?.activity)
    ? harnessRunRecord.activity
        .map((entry) => asRecord(entry))
        .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry.type === "string")
        .slice(-MAX_PERSISTED_ACTIVITY_ENTRIES)
        .map((entry) => ({
          type: String(entry.type).slice(0, MAX_PERSISTED_LABEL_CHARS),
          message: typeof entry.message === "string" ? boundedPersistedText(entry.message, 500) : undefined
        }))
    : [];
  const harnessRun =
    harnessRunRecord &&
    typeof harnessRunRecord.runId === "string" &&
    typeof harnessRunRecord.generation === "number" && Number.isFinite(harnessRunRecord.generation) &&
    typeof harnessRunRecord.stepCount === "number" && Number.isFinite(harnessRunRecord.stepCount) &&
    typeof harnessRunRecord.toolCallCount === "number" && Number.isFinite(harnessRunRecord.toolCallCount) &&
    typeof harnessRunRecord.durationMs === "number" && Number.isFinite(harnessRunRecord.durationMs) &&
    typeof harnessRunRecord.terminalReason === "string"
      ? {
          runId: harnessRunRecord.runId.slice(0, MAX_PERSISTED_ID_CHARS),
          generation: Math.max(0, Math.floor(harnessRunRecord.generation)),
          skillId: typeof harnessRunRecord.skillId === "string" ? harnessRunRecord.skillId.slice(0, MAX_PERSISTED_ID_CHARS) : undefined,
          stepCount: Math.max(0, Math.floor(harnessRunRecord.stepCount)),
          toolCallCount: Math.max(0, Math.floor(harnessRunRecord.toolCallCount)),
          durationMs: Math.max(0, Math.floor(harnessRunRecord.durationMs)),
          terminalReason: harnessRunRecord.terminalReason.slice(0, MAX_PERSISTED_LABEL_CHARS),
          activity: harnessActivity
        }
      : undefined;
  const interruptedAssistant =
    record.role === "assistant" &&
    (record.isStreaming === true || (!!harnessRunRecord && typeof harnessRunRecord.terminalReason !== "string"));
  const normalizedContent = interruptedAssistant
    ? record.content.trim()
      ? `${record.content}\n\n【執行中斷】\n上一輪執行在頁面重新載入前尚未完成。`
      : "【執行中斷】\n上一輪執行在頁面重新載入前尚未完成。"
    : record.content;
  return {
    id: typeof record.id === "string" ? record.id.slice(0, MAX_PERSISTED_ID_CHARS) : generateId(),
    role: record.role as ChatMessage["role"],
    content: boundChatContent(normalizedContent),
    name: typeof record.name === "string" ? record.name.slice(0, MAX_PERSISTED_ID_CHARS) : undefined,
    displayName: typeof record.displayName === "string" ? record.displayName.slice(0, MAX_PERSISTED_LABEL_CHARS) : undefined,
    avatarUrl: typeof record.avatarUrl === "string" ? record.avatarUrl.slice(0, MAX_PERSISTED_METADATA_CHARS) : undefined,
    statusText: interruptedAssistant
      ? undefined
      : typeof record.statusText === "string"
        ? boundedPersistedText(record.statusText, MAX_PERSISTED_METADATA_CHARS)
        : undefined,
    isStreaming: interruptedAssistant ? false : record.isStreaming === true,
    hideWhileStreaming: interruptedAssistant ? false : record.hideWhileStreaming === true,
    skillTrace: skillTrace?.length ? skillTrace : undefined,
    harnessRun,
    skillGoal:
      typeof record.skillGoal === "string" && record.skillGoal.trim()
        ? boundedPersistedText(record.skillGoal, MAX_PERSISTED_METADATA_CHARS)
        : undefined,
    skillTodo: skillTodo?.length ? skillTodo : undefined,
    skillPhase,
    ts: typeof record.ts === "number" && Number.isFinite(record.ts) ? record.ts : Date.now()
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
