import { describe, expect, it, vi } from "vitest";
import { runLoadBalancedTask, runLoadBalancedTextTask } from "../runtime/loadBalancerRunner";
import { ResolvedLoadBalancerInstance } from "../utils/loadBalancer";

function candidate(id: string): ResolvedLoadBalancerInstance {
  const now = 1;
  const credential = {
    id: `credential-${id}`,
    preset: "openai" as const,
    label: `Credential ${id}`,
    endpoint: "https://example.com/v1",
    keys: [{ id: `key-${id}`, apiKey: "secret", createdAt: now, updatedAt: now }],
    createdAt: now,
    updatedAt: now
  };
  const instance = {
    id: `instance-${id}`,
    credentialId: credential.id,
    credentialKeyId: credential.keys[0].id,
    model: `model-${id}`,
    description: "",
    maxRetries: 0,
    delaySecond: 0,
    resumeMinute: 1,
    failure: false,
    failureCount: 0,
    nextCheckTime: null,
    createdAt: now,
    updatedAt: now
  };
  const loadBalancer = {
    id: "lb",
    name: "LB",
    description: "",
    instances: [instance],
    createdAt: now,
    updatedAt: now
  };
  return {
    loadBalancer,
    instance,
    credential,
    key: credential.keys[0],
    hydratedAgent: {
      id: `agent-${id}`,
      name: `Agent ${id}`,
      type: "openai_compat",
      model: instance.model,
      endpoint: credential.endpoint,
      apiKey: credential.keys[0].apiKey
    }
  };
}

function base(candidates: ResolvedLoadBalancerInstance[]) {
  return {
    agentName: "Agent",
    stage: "test",
    candidates,
    noCandidateDetails: "none available",
    pushLog: vi.fn(),
    markSuccess: vi.fn(),
    markFailure: vi.fn()
  };
}

describe("load balancer runner", () => {
  it("reports no available candidate for task execution", async () => {
    const args = base([]);
    await expect(runLoadBalancedTask({
      ...args,
      execute: vi.fn(),
      noCandidateError: "missing",
      unknownFailureError: "unknown"
    })).rejects.toThrow("missing");
    expect(args.pushLog).toHaveBeenCalledWith(expect.objectContaining({ message: "LB no available instance [test]" }));
  });

  it("fails over retryable task errors and marks the recovered candidate", async () => {
    const first = candidate("first");
    const second = candidate("second");
    const args = base([first, second]);
    const execute = vi.fn(async (entry: ResolvedLoadBalancerInstance) => {
      if (entry === first) throw new Error("HTTP 500");
      return "done";
    });

    await expect(runLoadBalancedTask({
      ...args,
      execute,
      noCandidateError: "missing",
      unknownFailureError: "unknown"
    })).resolves.toBe("done");
    expect(args.markFailure).toHaveBeenCalledWith(first);
    expect(args.markSuccess).toHaveBeenCalledWith(second);
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("does not fail over terminal task errors", async () => {
    const args = base([candidate("first"), candidate("second")]);
    const execute = vi.fn(async () => { throw new Error("HTTP 400"); });
    await expect(runLoadBalancedTask({
      ...args,
      execute,
      noCandidateError: "missing",
      unknownFailureError: "unknown"
    })).rejects.toThrow("HTTP 400");
    expect(execute).toHaveBeenCalledOnce();
    expect(args.markFailure).not.toHaveBeenCalled();
  });

  it("uses the legacy fallback when a text task has no candidates", async () => {
    const args = base([]);
    const fallback = vi.fn(async () => "fallback");
    await expect(runLoadBalancedTextTask({ ...args, execute: vi.fn(), fallback })).resolves.toBe("fallback");
    expect(fallback).toHaveBeenCalledOnce();
  });

  it("fails over empty responses without marking the instance failed", async () => {
    const first = candidate("first");
    const second = candidate("second");
    const args = base([first, second]);
    const execute = vi.fn(async (entry: ResolvedLoadBalancerInstance) => entry === first ? "  " : "answer");

    await expect(runLoadBalancedTextTask({ ...args, execute, fallback: vi.fn() })).resolves.toBe("answer");
    expect(args.markFailure).not.toHaveBeenCalled();
    expect(args.markSuccess).toHaveBeenCalledWith(second);
  });

  it("marks retryable text failures and returns the next candidate response", async () => {
    const first = candidate("first");
    const second = candidate("second");
    const args = base([first, second]);
    const execute = vi.fn(async (entry: ResolvedLoadBalancerInstance) => entry === first ? "Request failed: HTTP 503" : "answer");

    await expect(runLoadBalancedTextTask({ ...args, execute, fallback: vi.fn() })).resolves.toBe("answer");
    expect(args.markFailure).toHaveBeenCalledWith(first);
    expect(args.markSuccess).toHaveBeenCalledWith(second);
  });
});
