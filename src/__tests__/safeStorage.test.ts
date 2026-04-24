import { afterEach, describe, expect, it, vi } from "vitest";
import { loadAgents, saveAgents } from "../storage/agentStore";
import { readJsonStorage, safeSetItem, writeJsonStorage } from "../storage/safeStorage";

describe("safeStorage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("round-trips versioned JSON payloads", () => {
    const result = writeJsonStorage("test_key", [{ id: "a" }]);
    expect(result.ok).toBe(true);

    const loaded = readJsonStorage("test_key", {
      defaultValue: [],
      validate: (value): value is Array<{ id: string }> => Array.isArray(value)
    });

    expect(loaded).toEqual([{ id: "a" }]);
    expect(JSON.parse(localStorage.getItem("test_key") || "{}")).toMatchObject({ __version: 1 });
  });

  it("backs up corrupted JSON before returning defaults", () => {
    localStorage.setItem("test_key", "{not-json");
    const loaded = readJsonStorage("test_key", { defaultValue: "fallback" });

    expect(loaded).toBe("fallback");
    expect(Object.keys(localStorage).some((key) => key.startsWith("__backup_test_key_"))).toBe(true);
  });

  it("classifies quota errors", () => {
    const error = new DOMException("full", "QuotaExceededError");
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw error;
    });

    const result = safeSetItem("test_key", "value");

    expect(result).toMatchObject({ ok: false, reason: "quota" });
  });

  it("loads legacy raw agent arrays and saves the versioned shape", () => {
    localStorage.setItem(
      "agr_agents_v1",
      JSON.stringify([{ id: "agent-1", name: "Mock", type: "openai_compat" }])
    );

    expect(loadAgents()).toHaveLength(1);

    saveAgents([{ id: "agent-1", name: "Mock", type: "openai_compat" }]);
    expect(JSON.parse(localStorage.getItem("agr_agents_v1") || "{}")).toMatchObject({ __version: 1 });
  });
});
