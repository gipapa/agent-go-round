import { SkillTodoItem, SkillTodoStatus } from "../types";
import { generateId } from "../utils/id";

export function createTodoItem(label: string, source: SkillTodoItem["source"] = "planner"): SkillTodoItem {
  return {
    id: generateId(),
    label: label.trim(),
    status: "pending",
    source,
    updatedAt: Date.now()
  };
}

export function normalizeTodoLabels(labels: string[]) {
  const seen = new Set<string>();
  return labels
    .map((label) => label.replace(/\s+/g, " ").trim())
    .filter((label) => label.length > 0)
    .filter((label) => {
      const key = label.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export function bootstrapTodoList(labels: string[], source: SkillTodoItem["source"] = "planner") {
  return normalizeTodoLabels(labels).slice(0, 7).map((label) => createTodoItem(label, source));
}

export function applyTodoStatus(
  todo: SkillTodoItem[],
  todoIds: string[] | undefined,
  status: SkillTodoStatus,
  reason?: string
) {
  if (!todoIds?.length) return todo;
  const now = Date.now();
  const idSet = new Set(todoIds);
  return todo.map((item) =>
    idSet.has(item.id)
      ? {
          ...item,
          status,
          reason: reason?.trim() || item.reason,
          updatedAt: now
        }
      : item
  );
}

export function markFirstPendingTodoInProgress(todo: SkillTodoItem[], reason?: string) {
  const pending = todo.find((item) => item.status === "pending");
  if (!pending) return todo;
  return applyTodoStatus(todo, [pending.id], "in_progress", reason);
}

export function summarizeTodo(todo: SkillTodoItem[]) {
  return todo
    .map((item, index) =>
      [`${index + 1}. [${item.status}] ${item.label}`, item.reason ? `原因：${item.reason}` : ""].filter(Boolean).join("\n")
    )
    .join("\n\n");
}
