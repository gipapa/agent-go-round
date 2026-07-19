import { describe, expect, it } from "vitest";
import {
  findTutorialAgentInList,
  normalizeTutorialPrimaryAgentList,
  usesTutorialLoadBalancer
} from "../onboarding/agentManagement";
import type { AgentConfig, LoadBalancerConfig } from "../types";

function agent(id: string, overrides: Partial<AgentConfig> = {}): AgentConfig {
  return { id, name: id, type: "openai_compat", ...overrides };
}

function loadBalancer(id: string, name: string): LoadBalancerConfig {
  return { id, name, instances: [], createdAt: 0, updatedAt: 0 };
}

const tutorialLoadBalancer = loadBalancer("tutorial-lb", "教學用Load Balancer 1");

describe("tutorial agent management", () => {
  it("keeps only the first explicit primary tag", () => {
    const result = normalizeTutorialPrimaryAgentList(
      [agent("first", { tutorialRole: "primary" }), agent("second", { tutorialRole: "primary" })],
      []
    );
    expect(result.map((entry) => entry.tutorialRole)).toEqual(["primary", undefined]);
  });

  it("migrates exactly one legacy tutorial load-balancer agent", () => {
    const legacy = agent("legacy", { loadBalancerId: tutorialLoadBalancer.id });
    expect(usesTutorialLoadBalancer(legacy, [tutorialLoadBalancer])).toBe(true);
    expect(normalizeTutorialPrimaryAgentList([legacy], [tutorialLoadBalancer])[0].tutorialRole).toBe("primary");

    const ambiguous = [legacy, agent("legacy-2", { loadBalancerId: tutorialLoadBalancer.id })];
    expect(normalizeTutorialPrimaryAgentList(ambiguous, [tutorialLoadBalancer])).toBe(ambiguous);
  });

  it("never allows a managed MAGI agent to own the tutorial role", () => {
    const managed = agent("magi", {
      tutorialRole: "primary",
      managedBy: "magi",
      managedUnitId: "Melchior"
    });
    const result = normalizeTutorialPrimaryAgentList([managed], []);
    expect(result[0].tutorialRole).toBeUndefined();
  });

  it("returns a runnable tutorial agent only when all optional resources are disabled", () => {
    const ready = agent("ready", {
      tutorialRole: "primary",
      enableDocs: false,
      enableMcp: false,
      enableBuiltInTools: false,
      enableSkills: false
    });
    expect(findTutorialAgentInList([ready], [])).toBe(ready);
    expect(findTutorialAgentInList([{ ...ready, enableMcp: true }], [])).toBeNull();
  });
});
