import type { RadioSessionState } from "../types";

export const MIN_RADIO_STT_BLOB_BYTES = 512;
export const RADIO_VAD_RMS_THRESHOLD = 0.02;
export const RADIO_SILENCE_FINALIZE_MS = 1400;
export const RADIO_MIN_SPEECH_MS = 450;

export function getDefaultRadioSessionState(): RadioSessionState {
  return {
    status: "idle",
    turn: "human",
    draftTranscriptRaw: "",
    draftTranscriptRefinedPreview: undefined,
    lastError: undefined,
    lastNotice: undefined,
    currentChunkIndex: 0,
    lastProcessedChunkIndex: -1
  };
}

export function buildRadioAgentSystemPrompt() {
  return [
    "You are speaking over a walkie-talkie.",
    "Reply in short spoken sentences.",
    "Use natural language suitable for TTS playback.",
    "Do not use markdown, code fences, tables, or bullet lists."
  ].join("\n");
}

export function buildRadioTtsFallbackSystemPrompt() {
  return [
    "You convert a short walkie-talkie reply into natural spoken English for TTS playback.",
    "Preserve the original meaning and tone.",
    "Keep it concise and easy to speak.",
    "Return plain English only.",
    "Do not include markdown, lists, or explanations."
  ].join("\n");
}

export function normalizeRadioAssistantText(raw: string) {
  return String(raw ?? "").trim();
}

export function buildLocalRadioRefineFallback(raw: string) {
  return String(raw ?? "")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*([,.;:!?])\s*/g, "$1 ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeRadioRefineComparisonText(text: string) {
  return String(text ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, "");
}

function computeLcsLength(left: string, right: string) {
  if (!left || !right) return 0;
  const previous = new Uint16Array(right.length + 1);
  const current = new Uint16Array(right.length + 1);
  for (let i = 1; i <= left.length; i += 1) {
    for (let j = 1; j <= right.length; j += 1) {
      current[j] =
        left[i - 1] === right[j - 1]
          ? previous[j - 1] + 1
          : Math.max(previous[j], current[j - 1]);
    }
    previous.set(current);
    current.fill(0);
  }
  return previous[right.length];
}

export function shouldRejectRadioRefine(rawDraft: string, refinedDraft: string) {
  const raw = normalizeRadioRefineComparisonText(rawDraft);
  const refined = normalizeRadioRefineComparisonText(refinedDraft);
  if (!raw || !refined) return false;

  const lcsLength = computeLcsLength(raw, refined);
  const overlapRatio = lcsLength / Math.max(1, raw.length);
  const expansionRatio = refined.length / Math.max(1, raw.length);

  if (raw.length >= 6 && overlapRatio < 0.62) {
    return true;
  }
  if (raw.length >= 6 && expansionRatio > 2.4 && refined.length - raw.length > 36) {
    return true;
  }
  return false;
}

export function getRadioMicrophoneSupportIssue() {
  const reasons: string[] = [];
  const origin = typeof location !== "undefined" ? location.origin : "unknown";
  const isLocalhost =
    typeof location !== "undefined" &&
    (location.hostname === "localhost" || location.hostname === "127.0.0.1" || location.hostname === "[::1]");

  if (typeof window !== "undefined" && window.isSecureContext === false && !isLocalhost) {
    reasons.push(`目前頁面不是安全上下文。請改用 https 或 localhost/127.0.0.1 開啟。origin=${origin}`);
  }

  if (typeof navigator === "undefined") {
    reasons.push("navigator 不存在。這通常代表目前不是一般瀏覽器執行環境。");
  } else {
    if (!navigator.mediaDevices) {
      reasons.push(`navigator.mediaDevices 不存在。常見原因是非安全上下文。origin=${origin}`);
    } else if (typeof navigator.mediaDevices.getUserMedia !== "function") {
      reasons.push("navigator.mediaDevices.getUserMedia 不可用。");
    }
  }

  if (typeof MediaRecorder === "undefined") {
    reasons.push("MediaRecorder 不可用。");
  }

  try {
    const permissionsPolicy =
      typeof document !== "undefined"
        ? ((document as Document & { permissionsPolicy?: { allowsFeature?: (name: string) => boolean } }).permissionsPolicy ??
          (document as Document & { featurePolicy?: { allowsFeature?: (name: string) => boolean } }).featurePolicy)
        : null;
    if (permissionsPolicy && typeof permissionsPolicy.allowsFeature === "function" && !permissionsPolicy.allowsFeature("microphone")) {
      reasons.push("目前文件的 Permissions Policy 不允許 microphone。");
    }
  } catch {
    // Ignore policy inspection failures.
  }

  return reasons.length ? reasons.join("\n") : null;
}

export function isRadioTtsEmptyAudioError(error: unknown) {
  return /TTS returned empty audio/i.test(String((error as any)?.message ?? error ?? ""));
}

export function isRadioTtsQuotaExhaustedError(error: unknown) {
  const text = String((error as any)?.message ?? error ?? "");
  return /(TTS HTTP 429|RESOURCE_EXHAUSTED|Quota exceeded|exceeded your current quota|quotaMetric)/i.test(text);
}

export async function playRadioSystemTone() {
  try {
    const AudioContextCtor =
      typeof window !== "undefined"
        ? (globalThis.AudioContext ??
          (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)
        : undefined;
    if (AudioContextCtor) {
      const context = new AudioContextCtor();
      if (context.state === "suspended") {
        await context.resume();
      }
      const now = context.currentTime;
      const gain = context.createGain();
      gain.connect(context.destination);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.22, now + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
      gain.gain.setValueAtTime(0.0001, now + 0.2);
      gain.gain.exponentialRampToValueAtTime(0.18, now + 0.22);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.34);

      const first = context.createOscillator();
      first.type = "triangle";
      first.frequency.setValueAtTime(880, now);
      first.connect(gain);
      first.start(now);
      first.stop(now + 0.16);

      const second = context.createOscillator();
      second.type = "triangle";
      second.frequency.setValueAtTime(1174, now + 0.2);
      second.connect(gain);
      second.start(now + 0.2);
      second.stop(now + 0.34);

      await new Promise<void>((resolve) => window.setTimeout(resolve, 420));
      await context.close().catch(() => {});
      return;
    }

    const sampleRate = 22050;
    const durationSec = 0.42;
    const frameCount = Math.floor(sampleRate * durationSec);
    const buffer = new ArrayBuffer(44 + frameCount * 2);
    const view = new DataView(buffer);

    const writeAscii = (offset: number, value: string) => {
      for (let index = 0; index < value.length; index += 1) {
        view.setUint8(offset + index, value.charCodeAt(index));
      }
    };

    writeAscii(0, "RIFF");
    view.setUint32(4, 36 + frameCount * 2, true);
    writeAscii(8, "WAVE");
    writeAscii(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeAscii(36, "data");
    view.setUint32(40, frameCount * 2, true);

    for (let index = 0; index < frameCount; index += 1) {
      const t = index / sampleRate;
      const frequency = t < 0.2 ? 880 : 1174;
      const attack = Math.min(1, index / (sampleRate * 0.01));
      const release = t < 0.2 ? Math.max(0, 1 - t / 0.2) : Math.max(0, 1 - (t - 0.2) / 0.22);
      const envelope = attack * release;
      const sample = Math.sin(2 * Math.PI * frequency * t) * 0.7 * envelope;
      view.setInt16(44 + index * 2, Math.max(-1, Math.min(1, sample)) * 0x7fff, true);
    }

    const url = URL.createObjectURL(new Blob([buffer], { type: "audio/wav" }));
    const audio = new Audio(url);
    audio.volume = 1;
    try {
      await new Promise<void>((resolve) => {
        audio.onended = () => resolve();
        audio.onerror = () => resolve();
        void audio.play().catch(() => resolve());
      });
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch {
    // Best-effort tone only.
  }
}

export function createRadioProbeWavBlob() {
  const sampleRate = 16000;
  const durationSec = 0.7;
  const frameCount = Math.floor(sampleRate * durationSec);
  const buffer = new ArrayBuffer(44 + frameCount * 2);
  const view = new DataView(buffer);

  const writeAscii = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  };

  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + frameCount * 2, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(36, "data");
  view.setUint32(40, frameCount * 2, true);

  for (let index = 0; index < frameCount; index += 1) {
    const t = index / sampleRate;
    const envelope = Math.max(0, 1 - t / durationSec);
    const sample = (Math.sin(2 * Math.PI * 440 * t) + 0.4 * Math.sin(2 * Math.PI * 660 * t)) * 0.28 * envelope;
    view.setInt16(44 + index * 2, Math.max(-1, Math.min(1, sample)) * 0x7fff, true);
  }

  return new Blob([buffer], { type: "audio/wav" });
}
