import { describe, expect, it } from "vitest";
import { createInitialState, resolveFinalVerdict, MAGI_UNIT_LAYOUT, type MagiPreparedUnit } from "../orchestrators/magi";

function buildUnits(): MagiPreparedUnit[] {
  return MAGI_UNIT_LAYOUT.map(({ unitId, unitNumber }) => ({
    unitId,
    unitNumber,
    agent: {
      id: unitId.toLowerCase(),
      name: unitId,
      type: "openai_compat",
      loadBalancerId: `${unitId.toLowerCase()}-lb`
    },
    system: `${unitId} system`
  }));
}

describe("resolveFinalVerdict", () => {
  it("returns APPROVE when two units approve", () => {
    expect(
      resolveFinalVerdict([{ verdict: "APPROVE" }, { verdict: "APPROVE" }, { verdict: "REJECT" }])
    ).toBe("APPROVE");
  });

  it("returns REJECT when two units reject", () => {
    expect(
      resolveFinalVerdict([{ verdict: "REJECT" }, { verdict: "ABSTAIN" }, { verdict: "REJECT" }])
    ).toBe("REJECT");
  });

  it("returns ABSTAIN when two units abstain", () => {
    expect(
      resolveFinalVerdict([{ verdict: "ABSTAIN" }, { verdict: "APPROVE" }, { verdict: "ABSTAIN" }])
    ).toBe("ABSTAIN");
  });

  it("returns DEADLOCK when all three units disagree", () => {
    expect(
      resolveFinalVerdict([{ verdict: "APPROVE" }, { verdict: "REJECT" }, { verdict: "ABSTAIN" }])
    ).toBe("DEADLOCK");
  });
});

describe("createInitialState", () => {
  it("creates EVA-style unit order with pending status", () => {
    const state = createInitialState("magi_vote", "是否批准測試計畫", buildUnits());

    expect(state.mode).toBe("magi_vote");
    expect(state.status).toBe("running");
    expect(state.units).toHaveLength(3);
    expect(state.units.map((unit) => unit.unitId)).toEqual(["Melchior", "Balthasar", "Casper"]);
    expect(state.units.every((unit) => unit.status === "pending")).toBe(true);
    expect(state.code).toBe("473");
  });
});
