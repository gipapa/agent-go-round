import { describe, expect, it } from "vitest";
import {
  ensureManagedMagiAgents,
  formatManagedMagiAgentName,
  isManagedMagiAgent,
  matchesManagedMagiUnit,
  normalizeManagedMagiAgent
} from "../magi/managedAgents";
import type { AgentConfig, MagiUnitId } from "../types";

function regularAgent(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    id: "regular",
    name: "Regular Agent",
    type: "openai_compat",
    capabilities: { streaming: true },
    ...overrides
  };
}

describe("managed MAGI agents", () => {
  it("creates one managed agent for every MAGI unit without changing regular agents", () => {
    const regular = regularAgent();
    const result = ensureManagedMagiAgents([regular]);

    expect(result[0]).toBe(regular);
    expect(result).toHaveLength(4);
    expect(result.filter(isManagedMagiAgent).map((agent) => agent.managedUnitId)).toEqual([
      "Melchior",
      "Balthasar",
      "Casper"
    ]);
  });

  it("normalizes permissions and removes tutorial ownership from managed agents", () => {
    const source = regularAgent({
      id: "melchior",
      name: "Melchior",
      managedBy: "magi",
      managedUnitId: "Melchior",
      tutorialRole: "primary",
      enableDocs: true,
      enableMcp: true,
      enableBuiltInTools: true,
      enableSkills: false,
      allowedDocIds: ["doc"],
      allowedMcpServerIds: ["mcp"],
      allowedBuiltInToolIds: ["tool"],
      allowedSkillIds: ["skill"]
    });

    const normalized = normalizeManagedMagiAgent(source, "Melchior");
    expect(normalized).toMatchObject({
      id: "melchior",
      name: "[系統保留] Melchior",
      managedBy: "magi",
      managedUnitId: "Melchior",
      tutorialRole: undefined,
      enableDocs: false,
      enableMcp: false,
      enableBuiltInTools: false,
      enableSkills: true,
      allowedDocIds: [],
      allowedMcpServerIds: [],
      allowedBuiltInToolIds: [],
      allowedSkillIds: []
    });
  });

  it("recognizes legacy managed names and becomes referentially stable after normalization", () => {
    const units: MagiUnitId[] = ["Melchior", "Balthasar", "Casper"];
    const legacy = units.map((unitId) =>
      regularAgent({
        id: unitId,
        name: unitId.toLowerCase(),
        managedBy: "magi",
        managedUnitId: undefined
      })
    );

    units.forEach((unitId, index) => {
      expect(matchesManagedMagiUnit(legacy[index], unitId)).toBe(true);
      expect(formatManagedMagiAgentName(unitId)).toBe(`[系統保留] ${unitId}`);
    });

    const normalized = ensureManagedMagiAgents(legacy);
    expect(ensureManagedMagiAgents(normalized)).toBe(normalized);
  });
});
