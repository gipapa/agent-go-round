import { afterEach, describe, expect, it, vi } from "vitest";
import { createInitialState, resolveFinalVerdict, MAGI_UNIT_LAYOUT, runMagi, type MagiPreparedUnit } from "../orchestrators/magi";

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

function ballot(verdict: "APPROVE" | "REJECT" | "ABSTAIN", unit = verdict) {
  return JSON.stringify({
    verdict,
    confidence: 80,
    summary: `${unit} summary`,
    rationale: `${unit} rationale`,
    concerns: []
  });
}

afterEach(() => {
  vi.useRealTimers();
});

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
  it("creates EVA-style unit order with thinking status", () => {
    const state = createInitialState("magi_vote", "是否批准測試計畫", buildUnits());

    expect(state.mode).toBe("magi_vote");
    expect(state.status).toBe("running");
    expect(state.units).toHaveLength(3);
    expect(state.units.map((unit) => unit.unitId)).toEqual(["Melchior", "Balthasar", "Casper"]);
    expect(state.units.every((unit) => unit.status === "thinking")).toBe(true);
    expect(state.code).toBe("473");
  });
});

describe("runMagi reliability guards", () => {
  it("exits consensus early when a majority is reached", async () => {
    const units = buildUnits();
    const invokeUnit = vi.fn(async ({ unit }: { unit: MagiPreparedUnit }) =>
      unit.unitId === "Casper" ? ballot("REJECT", unit.unitId) : ballot("APPROVE", unit.unitId)
    );

    const result = await runMagi({
      mode: "magi_consensus",
      question: "ship it?",
      units,
      history: [],
      maxConsensusRounds: 5,
      invokeUnit
    });

    expect(result.state.finalVerdict).toBe("APPROVE");
    expect(result.state.round).toBe(1);
    expect(invokeUnit).toHaveBeenCalledTimes(3);
  });

  it("detects repeated deadlock ballots before max rounds", async () => {
    const units = buildUnits();
    const verdictByUnit = {
      Melchior: "APPROVE",
      Balthasar: "REJECT",
      Casper: "ABSTAIN"
    } as const;
    const invokeUnit = vi.fn(async ({ unit }: { unit: MagiPreparedUnit }) => ballot(verdictByUnit[unit.unitId], unit.unitId));

    const result = await runMagi({
      mode: "magi_consensus",
      question: "ship it?",
      units,
      history: [],
      maxConsensusRounds: 5,
      deadlockRounds: 2,
      invokeUnit
    });

    expect(result.state.finalVerdict).toBe("DEADLOCK");
    expect(result.state.finalSummary).toContain("deadlock");
    expect(result.state.round).toBe(3);
    expect(invokeUnit).toHaveBeenCalledTimes(9);
  });

  it("keeps fast unit results when another unit times out", async () => {
    vi.useFakeTimers();
    const units = buildUnits();
    const invokeUnit = vi.fn(async ({ unit }: { unit: MagiPreparedUnit }) => {
      if (unit.unitId === "Casper") return await new Promise<string>(() => {});
      return ballot("APPROVE", unit.unitId);
    });

    const pending = runMagi({
      mode: "magi_consensus",
      question: "ship it?",
      units,
      history: [],
      maxConsensusRounds: 5,
      unitTimeoutMs: 25,
      roundTimeoutMs: 50,
      invokeUnit
    });

    await vi.advanceTimersByTimeAsync(25);
    const result = await pending;

    expect(result.state.finalVerdict).toBe("APPROVE");
    expect(result.state.units.find((unit) => unit.unitId === "Casper")?.status).toBe("error");
  });
});
