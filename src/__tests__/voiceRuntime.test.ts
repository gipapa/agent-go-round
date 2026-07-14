import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_VOICE_SETTINGS,
  joinOrderedTranscriptChunks,
  normalizeVoiceSettings,
  synthesizeGeminiSpeech,
  transcribeAudioChunk
} from "../voice/runtime";
import type { ModelCredentialEntry } from "../storage/settingsStore";

describe("voice runtime helpers", () => {
  it("normalizes voice settings with defaults", () => {
    expect(
      normalizeVoiceSettings({
        sttPrompt: ""
      })
    ).toEqual({
      ...DEFAULT_VOICE_SETTINGS,
      sttLoadBalancerId: "",
      sttLanguage: "",
      ttsLoadBalancerId: ""
    });
  });

  it("migrates legacy radio credential ids into voice load balancers", () => {
    expect(
      normalizeVoiceSettings({
        sttCredentialId: "legacy-stt",
        ttsCredentialId: "legacy-tts"
      } as Parameters<typeof normalizeVoiceSettings>[0])
    ).toMatchObject({
      sttLoadBalancerId: "legacy-stt",
      ttsLoadBalancerId: "legacy-tts"
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

  it("keeps voice defaults stable", () => {
    expect(DEFAULT_VOICE_SETTINGS.sttTemperature).toBe(0);
    expect(DEFAULT_VOICE_SETTINGS.sttPrompt).toBe("");
    expect(DEFAULT_VOICE_SETTINGS.ttsVoice).toBe("Kore");
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
        settings: DEFAULT_VOICE_SETTINGS,
        blob: new Blob(["demo"], { type: "audio/webm" }),
        chunkIndex: 0,
        modelOverride: ""
      })
    ).rejects.toThrow("STT load balancer instance has no model configured.");

    await expect(
      synthesizeGeminiSpeech({
        credential,
        apiKey: "test-key",
        settings: DEFAULT_VOICE_SETTINGS,
        text: "hello",
        modelOverride: ""
      })
    ).rejects.toThrow("TTS load balancer instance has no model configured.");

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
