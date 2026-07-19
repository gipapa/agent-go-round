import type { LogEntry, LogOutcome } from "../types";
import { generateId } from "../utils/id";

export type LogSortKey = "category" | "agent" | "outcome" | "requestId" | "ts" | "message";
export type LogSort = { key: LogSortKey; dir: "asc" | "desc" };
export type PendingLogEntry = Omit<LogEntry, "id" | "ts"> & { ts?: number };

export function createLogRequestId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${generateId().slice(0, 6)}`;
}

export function inferLogOutcome(entry: Pick<LogEntry, "ok" | "level" | "outcome">): LogOutcome {
  if (entry.outcome) return entry.outcome;
  if (entry.ok === true) return "success";
  if (entry.ok === false) return "failure";
  if (entry.level === "error") return "failure";
  if (entry.level === "warn") return "degraded";
  return "info";
}

export function normalizeLogEntry(entry: PendingLogEntry, id: string, now: number): LogEntry {
  return {
    id,
    ts: entry.ts ?? now,
    category: entry.category || "general",
    agent: entry.agent,
    ok: entry.ok,
    message: entry.message,
    level: entry.level,
    outcome: inferLogOutcome(entry),
    requestId: entry.requestId?.trim() || undefined,
    stage: entry.stage?.trim() || undefined,
    details: entry.details
  };
}

export function formatLogOutcomeLabel(outcome: LogOutcome) {
  switch (outcome) {
    case "success":
      return "SUCCESS";
    case "failure":
      return "FAILURE";
    case "degraded":
      return "DEGRADED";
    case "info":
    default:
      return "INFO";
  }
}

export function formatLogEntryForClipboard(entry: LogEntry) {
  const lines = [
    `request_id=${entry.requestId ?? "-"}`,
    `category=${entry.category}`,
    `agent=${entry.agent ?? "-"}`,
    `stage=${entry.stage ?? "-"}`,
    `outcome=${entry.outcome ?? inferLogOutcome(entry)}`,
    `time=${new Date(entry.ts).toISOString()}`,
    `message=${entry.message}`
  ];
  if (entry.details?.trim()) {
    lines.push("", entry.details.trim());
  }
  return lines.join("\n");
}

export function sortLogEntries(entries: LogEntry[], sort: LogSort) {
  return entries
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const key = sort.key;
      let cmp = 0;
      if (key === "ts") cmp = a.item.ts - b.item.ts;
      if (key === "outcome") cmp = formatLogOutcomeLabel(a.item.outcome ?? inferLogOutcome(a.item)).localeCompare(formatLogOutcomeLabel(b.item.outcome ?? inferLogOutcome(b.item)));
      if (key === "requestId") cmp = (a.item.requestId || "").toLowerCase().localeCompare((b.item.requestId || "").toLowerCase());
      if (key === "category") cmp = (a.item.category || "").toLowerCase().localeCompare((b.item.category || "").toLowerCase());
      if (key === "agent") cmp = (a.item.agent || "").toLowerCase().localeCompare((b.item.agent || "").toLowerCase());
      if (key === "message") cmp = (a.item.message || "").toLowerCase().localeCompare((b.item.message || "").toLowerCase());
      if (cmp === 0) cmp = a.index - b.index;
      return sort.dir === "asc" ? cmp : -cmp;
    })
    .map(({ item }) => item);
}
