import { afterEach, describe, expect, it, vi } from "vitest";
import { loadAgents, saveAgents } from "../storage/agentStore";
import { loadLoadBalancers, saveLoadBalancers } from "../storage/settingsStore";
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

  it("migrates legacy tool calling capability fields when loading load balancers", () => {
    localStorage.setItem("agr_load_balancers_v1", JSON.stringify([
      {
        id: "lb-legacy",
        name: "Legacy",
        instances: [
          { id: "native", toolCallingCapability: "native" },
          { id: "text", toolCallingCapability: "text_protocol" },
          { id: "none", toolCallingCapability: "none" },
          { id: "missing" }
        ]
      }
    ]));

    const [loadBalancer] = loadLoadBalancers();
    expect(loadBalancer.instances.map((instance) => instance.toolTransportPolicy)).toEqual([
      "native_only",
      "text_only",
      "disabled",
      "disabled"
    ]);
    expect(loadBalancer.instances.every((instance) => !("toolCallingCapability" in instance))).toBe(true);
  });

  it("writes canonical load-balancer policies and removes legacy fields", () => {
    saveLoadBalancers([{
      id: "lb-legacy-write",
      name: "Legacy write",
      instances: [{
        id: "text",
        credentialId: "",
        model: "",
        description: "",
        maxRetries: 0,
        delaySecond: 0,
        resumeMinute: 60,
        failure: false,
        failureCount: 0,
        createdAt: 0,
        updatedAt: 0,
        toolCallingCapability: "text_protocol" as const
      }],
      createdAt: 0,
      updatedAt: 0
    }]);

    const stored = JSON.parse(localStorage.getItem("agr_load_balancers_v1") || "{}");
    expect(stored.data[0].instances[0].toolTransportPolicy).toBe("text_only");
    expect(stored.data[0].instances[0].toolCallingCapability).toBeUndefined();
  });
});
