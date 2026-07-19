import { describe, expect, it } from "vitest";
import {
  formatLogEntryForClipboard,
  inferLogOutcome,
  normalizeLogEntry,
  sortLogEntries
} from "../runtime/logging";
import type { LogEntry } from "../types";

describe("app logging runtime", () => {
  it("normalizes metadata and derives outcomes with explicit values taking precedence", () => {
    expect(
      normalizeLogEntry(
        { category: "", message: "saved", ok: false, outcome: "degraded", requestId: " req-1 ", stage: " save " },
        "log-1",
        123
      )
    ).toEqual({
      id: "log-1",
      ts: 123,
      category: "general",
      agent: undefined,
      ok: false,
      message: "saved",
      level: undefined,
      outcome: "degraded",
      requestId: "req-1",
      stage: "save",
      details: undefined
    });
    expect(inferLogOutcome({ ok: true })).toBe("success");
    expect(inferLogOutcome({ level: "error" })).toBe("failure");
    expect(inferLogOutcome({ level: "warn" })).toBe("degraded");
  });

  it("sorts without mutating the source and keeps equal values stable", () => {
    const entries: LogEntry[] = [
      { id: "one", ts: 2, category: "chat", message: "same", outcome: "info" },
      { id: "two", ts: 1, category: "chat", message: "same", outcome: "failure" },
      { id: "three", ts: 3, category: "mcp", message: "later", outcome: "success" }
    ];
    expect(sortLogEntries(entries, { key: "category", dir: "asc" }).map((entry) => entry.id)).toEqual(["one", "two", "three"]);
    expect(sortLogEntries(entries, { key: "ts", dir: "desc" }).map((entry) => entry.id)).toEqual(["three", "one", "two"]);
    expect(entries.map((entry) => entry.id)).toEqual(["one", "two", "three"]);
  });

  it("formats complete clipboard diagnostics", () => {
    const text = formatLogEntryForClipboard({
      id: "log",
      ts: Date.parse("2026-01-01T00:00:00.000Z"),
      category: "mcp",
      agent: "Browser",
      stage: "tool execution",
      requestId: "req-7",
      outcome: "success",
      message: "Tool completed",
      details: "result=ok"
    });
    expect(text).toContain("request_id=req-7");
    expect(text).toContain("time=2026-01-01T00:00:00.000Z");
    expect(text).toContain("result=ok");
  });
});
