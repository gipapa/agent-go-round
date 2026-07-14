import type { ModelCredentialEntry } from "../storage/settingsStore";
import type { VoiceSettings } from "../types";

export const VOICE_STT_LANGUAGE_OPTIONS = [
  { value: "", label: "Auto" },
  { value: "zh", label: "Chinese (zh)" },
  { value: "en", label: "English (en)" },
  { value: "ja", label: "Japanese (ja)" },
  { value: "ko", label: "Korean (ko)" },
  { value: "es", label: "Spanish (es)" },
  { value: "fr", label: "French (fr)" },
  { value: "de", label: "German (de)" },
  { value: "pt", label: "Portuguese (pt)" },
  { value: "it", label: "Italian (it)" },
  { value: "nl", label: "Dutch (nl)" },
  { value: "ru", label: "Russian (ru)" },
  { value: "ar", label: "Arabic (ar)" },
  { value: "hi", label: "Hindi (hi)" },
  { value: "id", label: "Indonesian (id)" },
  { value: "th", label: "Thai (th)" },
  { value: "tr", label: "Turkish (tr)" },
  { value: "vi", label: "Vietnamese (vi)" }
] as const;

export const VOICE_TTS_VOICE_OPTIONS = [
  "Kore",
  "Aoede",
  "Charon",
  "Fenrir",
  "Leda",
  "Orus",
  "Puck",
  "Zephyr",
  "Callirrhoe",
  "Autonoe",
  "Enceladus",
  "Iapetus",
  "Umbriel",
  "Algieba",
  "Despina",
  "Erinome",
  "Algenib",
  "Rasalgethi",
  "Laomedeia",
  "Achernar",
  "Alnilam",
  "Schedar",
  "Gacrux",
  "Pulcherrima",
  "Achird",
  "Zubenelgenubi",
  "Vindemiatrix",
  "Sadachbia",
  "Sadaltager",
  "Sulafat"
] as const;

export const DEFAULT_VOICE_STT_PROMPT = "";

export const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  sttLoadBalancerId: "",
  sttLanguage: "",
  sttTemperature: 0,
  sttPrompt: DEFAULT_VOICE_STT_PROMPT,
  ttsLoadBalancerId: "",
  ttsVoice: "Kore"
};

function decodeBase64(base64: string) {
  if (typeof atob === "function") {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  }
  const bufferCtor = (globalThis as { Buffer?: { from: (value: string, encoding: string) => Uint8Array } }).Buffer;
  if (bufferCtor) {
    return new Uint8Array(bufferCtor.from(base64, "base64"));
  }
  throw new Error("Base64 decoding is not available in this environment.");
}

function writeAscii(view: DataView, offset: number, value: string) {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

function base64ToBlob(base64: string, mimeType: string) {
  const bytes = decodeBase64(base64);
  return new Blob([bytes], { type: mimeType });
}

function resolveRequiredVoiceModel(modelOverride: string | undefined, purpose: "STT" | "TTS") {
  const model = String(modelOverride ?? "").trim();
  if (!model) {
    throw new Error(`${purpose} load balancer instance has no model configured.`);
  }
  return model;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function getGeminiParts(candidate: unknown): unknown[] {
  const content = asRecord(asRecord(candidate)?.content);
  const parts = content?.parts;
  return Array.isArray(parts) ? parts : [];
}

export function normalizeVoiceSettings(input?: Partial<VoiceSettings> | null): VoiceSettings {
  const legacyInput = input as Partial<VoiceSettings> & {
    sttCredentialId?: string;
    ttsCredentialId?: string;
  };
  return {
    sttLoadBalancerId: String(input?.sttLoadBalancerId ?? legacyInput?.sttCredentialId ?? "").trim(),
    sttLanguage: String(input?.sttLanguage ?? "").trim(),
    sttTemperature:
      typeof input?.sttTemperature === "number" && Number.isFinite(input.sttTemperature)
        ? Math.max(0, Math.min(1, input.sttTemperature))
        : DEFAULT_VOICE_SETTINGS.sttTemperature,
    sttPrompt: String(input?.sttPrompt ?? DEFAULT_VOICE_SETTINGS.sttPrompt).trim(),
    ttsLoadBalancerId: String(input?.ttsLoadBalancerId ?? legacyInput?.ttsCredentialId ?? "").trim(),
    ttsVoice: String(input?.ttsVoice ?? DEFAULT_VOICE_SETTINGS.ttsVoice).trim() || DEFAULT_VOICE_SETTINGS.ttsVoice
  };
}

export function normalizeTranscriptSpacing(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

export function joinOrderedTranscriptChunks(chunks: Map<number, string>) {
  return normalizeTranscriptSpacing(
    Array.from(chunks.entries())
      .sort((left, right) => left[0] - right[0])
      .map(([, value]) => String(value ?? "").trim())
      .filter(Boolean)
      .join(" ")
  );
}

export async function transcribeAudioChunk(args: {
  credential: ModelCredentialEntry;
  apiKey: string;
  settings: VoiceSettings;
  blob: Blob;
  chunkIndex: number;
  modelOverride?: string;
  allowEmptyTranscript?: boolean;
}): Promise<string> {
  const endpoint = String(args.credential.endpoint || "").replace(/\/+$/, "");
  if (!endpoint) throw new Error("STT credential endpoint is missing.");
  if (!args.apiKey.trim()) throw new Error("STT API key is missing.");
  const model = resolveRequiredVoiceModel(args.modelOverride, "STT");

  const form = new FormData();
  const fileName = `voice-${args.chunkIndex}.${args.blob.type.includes("ogg") ? "ogg" : "webm"}`;
  form.append("file", new File([args.blob], fileName, { type: args.blob.type || "audio/webm" }));
  form.append("model", model);
  form.append("response_format", "json");
  const fallbackLanguage =
    typeof navigator !== "undefined" && /^zh(?:[-_].+)?$/i.test(String(navigator.language || "").trim()) ? "zh" : "";
  const language = String(args.settings.sttLanguage ?? "").trim() || fallbackLanguage;
  if (language) {
    form.append("language", language);
  }
  const prompt = String(args.settings.sttPrompt ?? "").trim();
  if (prompt) {
    form.append("prompt", prompt);
  }
  form.append("temperature", String(args.settings.sttTemperature));

  const response = await fetch(`${endpoint}/audio/transcriptions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${args.apiKey.trim()}`
    },
    body: form
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(text ? `STT HTTP ${response.status}: ${text}` : `STT HTTP ${response.status}`);
  }

  const json = (await response.json().catch(() => null)) as unknown;
  const transcript = normalizeTranscriptSpacing(String(asRecord(json)?.text ?? ""));
  if (!transcript && !args.allowEmptyTranscript) {
    throw new Error("STT returned empty transcript.");
  }
  return transcript;
}

export function pcmBase64ToWavBlob(base64: string, sampleRate = 24000) {
  const pcmBytes = decodeBase64(base64);
  const buffer = new ArrayBuffer(44 + pcmBytes.length);
  const view = new DataView(buffer);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + pcmBytes.length, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, pcmBytes.length, true);
  new Uint8Array(buffer, 44).set(pcmBytes);

  return new Blob([buffer], { type: "audio/wav" });
}

export async function synthesizeGeminiSpeech(args: {
  credential: ModelCredentialEntry;
  apiKey: string;
  settings: VoiceSettings;
  text: string;
  modelOverride?: string;
}): Promise<Blob> {
  const endpoint = String(args.credential.endpoint || "").replace(/\/+$/, "");
  if (!endpoint) throw new Error("TTS credential endpoint is missing.");
  if (!args.apiKey.trim()) throw new Error("TTS API key is missing.");

  const model = resolveRequiredVoiceModel(args.modelOverride, "TTS");
  const response = await fetch(`${endpoint}/models/${model}:generateContent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": args.apiKey.trim()
    },
    body: JSON.stringify({
      contents: [
        {
          parts: [{ text: args.text }]
        }
      ],
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: args.settings.ttsVoice
            }
          }
        }
      }
    })
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(text ? `TTS HTTP ${response.status}: ${text}` : `TTS HTTP ${response.status}`);
  }

  const json = (await response.json().catch(() => null)) as unknown;
  const rawCandidates = asRecord(json)?.candidates;
  const candidates: unknown[] = Array.isArray(rawCandidates) ? rawCandidates : [];
  const audioPart = candidates.length
    ? candidates
        .flatMap(getGeminiParts)
        .find((part) => typeof asRecord(asRecord(part)?.inlineData)?.data === "string")
    : null;
  const inlineData = asRecord(asRecord(audioPart)?.inlineData);
  const audioBase64 = String(inlineData?.data ?? "").trim();
  const audioMimeType = String(inlineData?.mimeType ?? "").trim();
  if (!audioBase64) {
    const diagnostics = JSON.stringify(
      {
        candidateCount: candidates.length,
        finishReasons: candidates.map((candidate) => asRecord(candidate)?.finishReason ?? null),
        textParts: candidates.flatMap((candidate) =>
          getGeminiParts(candidate)
            .filter((part) => typeof asRecord(part)?.text === "string" && String(asRecord(part)?.text).trim())
            .map((part) => String(asRecord(part)?.text).trim())
        )
      },
      null,
      2
    );
    throw new Error(`TTS returned empty audio.\n${diagnostics}`);
  }
  if (/audio\/(?:wav|x-wav|mpeg|mp3|ogg|webm)/i.test(audioMimeType)) {
    return base64ToBlob(audioBase64, audioMimeType);
  }
  return pcmBase64ToWavBlob(audioBase64);
}
