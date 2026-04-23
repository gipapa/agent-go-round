import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_RADIO_SETTINGS,
  joinOrderedTranscriptChunks,
  normalizeRadioSettings,
  synthesizeGeminiSpeech,
  transcribeAudioChunk
} from "../radio/runtime";
import type { ModelCredentialEntry } from "../storage/settingsStore";

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

  it("requires explicit STT/TTS models from load balancer instances instead of silently falling back", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const credential: ModelCredentialEntry = {
      id: "test-credential",
      preset: "gemini",
      label: "Gemini",
      endpoint: "https://example.com",
      keys: [],
      createdAt: 0,
      updatedAt: 0
    };

    await expect(
      transcribeAudioChunk({
        credential,
        apiKey: "test-key",
        settings: DEFAULT_RADIO_SETTINGS,
        blob: new Blob(["demo"], { type: "audio/webm" }),
        chunkIndex: 0,
        modelOverride: ""
      })
    ).rejects.toThrow("STT load balancer instance has no model configured.");

    await expect(
      synthesizeGeminiSpeech({
        credential,
        apiKey: "test-key",
        settings: DEFAULT_RADIO_SETTINGS,
        text: "hello",
        modelOverride: ""
      })
    ).rejects.toThrow("TTS load balancer instance has no model configured.");

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
