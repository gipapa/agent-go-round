import { describe, expect, it } from "vitest";
import {
  DEFAULT_RADIO_SETTINGS,
  joinOrderedTranscriptChunks,
  normalizeRadioSettings
} from "../radio/runtime";

describe("radio runtime helpers", () => {
  it("normalizes radio settings with defaults and clamps chunk length", () => {
    expect(
      normalizeRadioSettings({
        chunkSeconds: 999,
        sttPrompt: "",
        refinePrompt: ""
      })
    ).toEqual({
      ...DEFAULT_RADIO_SETTINGS,
      chunkSeconds: 300,
      sttLoadBalancerId: "",
      sttLanguage: "",
      refineAgentId: "",
      ttsLoadBalancerId: ""
    });
  });

  it("joins transcript chunks in index order", () => {
    const chunks = new Map<number, string>([
      [2, "three"],
      [0, "one"],
      [1, "two"]
    ]);

    expect(joinOrderedTranscriptChunks(chunks)).toBe("one two three");
  });

  it("keeps radio defaults stable", () => {
    expect(DEFAULT_RADIO_SETTINGS.sttTemperature).toBe(0);
    expect(DEFAULT_RADIO_SETTINGS.chunkSeconds).toBe(60);
    expect(DEFAULT_RADIO_SETTINGS.sttPrompt).toBe("");
    expect(DEFAULT_RADIO_SETTINGS.refinePrompt.length).toBeGreaterThan(0);
  });
});
