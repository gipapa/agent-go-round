export const MIN_VOICE_STT_BLOB_BYTES = 512;

export function getVoiceMicrophoneSupportIssue() {
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
  } else if (!navigator.mediaDevices) {
    reasons.push(`navigator.mediaDevices 不存在。常見原因是非安全上下文。origin=${origin}`);
  } else if (typeof navigator.mediaDevices.getUserMedia !== "function") {
    reasons.push("navigator.mediaDevices.getUserMedia 不可用。");
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

export function createVoiceProbeWavBlob() {
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
