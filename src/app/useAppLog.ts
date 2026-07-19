import { useCallback, useState } from "react";
import type { LogEntry } from "../types";
import { normalizeLogEntry, type PendingLogEntry } from "../runtime/logging";
import { generateId } from "../utils/id";

export function useAppLog() {
  const [entries, setEntries] = useState<LogEntry[]>([]);

  const pushLog = useCallback((entry: PendingLogEntry) => {
    const normalized = normalizeLogEntry(entry, generateId(), Date.now());
    setEntries((current) => [normalized, ...current].slice(0, 200));
  }, []);

  const clearLog = useCallback(() => setEntries([]), []);

  return { entries, pushLog, clearLog };
}
