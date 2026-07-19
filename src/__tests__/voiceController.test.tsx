import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_VOICE_SETTINGS } from "../voice/runtime";
import { getVoiceRecorderOptions, useVoiceController } from "../voice/useVoiceController";

type Controller = ReturnType<typeof useVoiceController>;

let container: HTMLDivElement;
let root: Root;
let current: Controller | null;
const originalMediaDevices = Object.getOwnPropertyDescriptor(navigator, "mediaDevices");

function Harness(props: { sttLoadBalancerId?: string; ttsLoadBalancerId?: string; runTask?: never }) {
  current = useVoiceController({
    settings: DEFAULT_VOICE_SETTINGS,
    sttLoadBalancerId: props.sttLoadBalancerId,
    ttsLoadBalancerId: props.ttsLoadBalancerId,
    activeAgentName: "Agent",
    runTask: vi.fn(async () => {
      throw new Error("runTask should not be called in this test");
    }),
    pushLog: vi.fn(),
    onTranscript: vi.fn()
  });
  return <div data-status={current.dictationStatus}>{current.error}</div>;
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  current = null;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
  if (originalMediaDevices) {
    Object.defineProperty(navigator, "mediaDevices", originalMediaDevices);
  } else {
    Reflect.deleteProperty(navigator, "mediaDevices");
  }
});

describe("voice controller", () => {
  it("reports missing STT and TTS configuration without invoking providers", async () => {
    await act(async () => root.render(<Harness />));

    await act(async () => current?.toggleDictation());
    expect(current?.error).toBe("請先在 Chat Config > Voice 設定可用的 STT load balancer。");

    await act(async () => current?.testStt());
    expect(current?.probeState.stt).toEqual({ running: false, ok: false, message: "請先選擇 STT load balancer。" });

    await act(async () => current?.testTts());
    expect(current?.probeState.tts).toEqual({ running: false, ok: false, message: "請先選擇 TTS load balancer。" });

    await act(async () => current?.playMessage("message-1", "hello"));
    expect(current?.error).toBe("請先在 Chat Config > Voice 設定可用的 TTS load balancer。");
  });

  it("chooses the first supported recorder format", () => {
    vi.stubGlobal("MediaRecorder", {
      isTypeSupported: vi.fn((mimeType: string) => mimeType === "audio/webm")
    });
    expect(getVoiceRecorderOptions()).toEqual({ mimeType: "audio/webm" });
  });

  it("stops microphone tracks and an active recorder on unmount", async () => {
    const stopTrack = vi.fn();
    const stream = { getTracks: () => [{ stop: stopTrack }] } as unknown as MediaStream;
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn(async () => stream) }
    });

    class FakeMediaRecorder {
      static isTypeSupported() {
        return true;
      }
      state: RecordingState = "inactive";
      mimeType = "audio/webm";
      ondataavailable: ((event: BlobEvent) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;
      onstop: ((event: Event) => void) | null = null;
      start() {
        this.state = "recording";
      }
      stop() {
        this.state = "inactive";
        this.onstop?.(new Event("stop"));
      }
    }
    vi.stubGlobal("MediaRecorder", FakeMediaRecorder);

    await act(async () => root.render(<Harness sttLoadBalancerId="stt" />));
    await act(async () => current?.toggleDictation());
    expect(current?.dictationStatus).toBe("recording");

    await act(async () => root.unmount());
    expect(stopTrack).toHaveBeenCalledOnce();

    root = createRoot(container);
  });
});
