import type { ModelCredentialEntry } from "../storage/settingsStore";
import type { RadioSettings } from "../types";

export const RADIO_STT_LANGUAGE_OPTIONS = [
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

export const RADIO_TTS_VOICE_OPTIONS = [
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

export const DEFAULT_RADIO_STT_PROMPT = "";
export const DEFAULT_RADIO_STT_MODEL = "whisper-large-v3-turbo";
export const DEFAULT_RADIO_TTS_MODEL = "gemini-2.5-flash-preview-tts";

export const DEFAULT_RADIO_REFINE_PROMPT = [
  "You clean up a speech-to-text draft before it is sent to another assistant.",
  "Return only the cleaned transcript.",
  "Do not answer the user's request.",
  "Do not continue the conversation.",
  "Do not add facts, jokes, examples, or explanations.",
  "Keep the original meaning and language.",
  "Fix obvious STT noise, repetition, punctuation, and awkward line breaks.",
  "If the draft is already understandable, make only minimal edits.",
  "Return plain text only."
].join("\n");

export const DEFAULT_RADIO_SETTINGS: RadioSettings = {
  sttLoadBalancerId: "",
  sttLanguage: "",
  sttTemperature: 0,
  sttPrompt: DEFAULT_RADIO_STT_PROMPT,
  chunkSeconds: 60,
  refinePrompt: DEFAULT_RADIO_REFINE_PROMPT,
  refineAgentId: "",
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

export function normalizeRadioSettings(input?: Partial<RadioSettings> | null): RadioSettings {
  const legacyInput = input as Partial<RadioSettings> & {
    sttCredentialId?: string;
    ttsCredentialId?: string;
  };
  return {
    sttLoadBalancerId: String(input?.sttLoadBalancerId ?? legacyInput?.sttCredentialId ?? "").trim(),
    sttLanguage: String(input?.sttLanguage ?? "").trim(),
    sttTemperature:
      typeof input?.sttTemperature === "number" && Number.isFinite(input.sttTemperature)
        ? Math.max(0, Math.min(1, input.sttTemperature))
        : DEFAULT_RADIO_SETTINGS.sttTemperature,
    sttPrompt: String(input?.sttPrompt ?? DEFAULT_RADIO_SETTINGS.sttPrompt).trim(),
    chunkSeconds:
      typeof input?.chunkSeconds === "number" && Number.isFinite(input.chunkSeconds)
        ? Math.max(2, Math.min(300, Math.round(input.chunkSeconds)))
        : DEFAULT_RADIO_SETTINGS.chunkSeconds,
    refinePrompt: String(input?.refinePrompt ?? DEFAULT_RADIO_SETTINGS.refinePrompt).trim() || DEFAULT_RADIO_SETTINGS.refinePrompt,
    refineAgentId: String(input?.refineAgentId ?? "").trim(),
    ttsLoadBalancerId: String(input?.ttsLoadBalancerId ?? legacyInput?.ttsCredentialId ?? "").trim(),
    ttsVoice: String(input?.ttsVoice ?? DEFAULT_RADIO_SETTINGS.ttsVoice).trim() || DEFAULT_RADIO_SETTINGS.ttsVoice
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
  settings: RadioSettings;
  blob: Blob;
  chunkIndex: number;
  modelOverride?: string;
  allowEmptyTranscript?: boolean;
}): Promise<string> {
  const endpoint = String(args.credential.endpoint || "").replace(/\/+$/, "");
  if (!endpoint) throw new Error("STT credential endpoint is missing.");
  if (!args.apiKey.trim()) throw new Error("STT API key is missing.");

  const form = new FormData();
  const fileName = `radio-${args.chunkIndex}.${args.blob.type.includes("ogg") ? "ogg" : "webm"}`;
  form.append("file", new File([args.blob], fileName, { type: args.blob.type || "audio/webm" }));
  form.append("model", String(args.modelOverride ?? DEFAULT_RADIO_STT_MODEL).trim() || DEFAULT_RADIO_STT_MODEL);
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

  const json = await response.json().catch(() => null);
  const transcript = normalizeTranscriptSpacing(String(json?.text ?? ""));
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
  settings: RadioSettings;
  text: string;
  modelOverride?: string;
}): Promise<Blob> {
  const endpoint = String(args.credential.endpoint || "").replace(/\/+$/, "");
  if (!endpoint) throw new Error("TTS credential endpoint is missing.");
  if (!args.apiKey.trim()) throw new Error("TTS API key is missing.");

  const model = String(args.modelOverride ?? DEFAULT_RADIO_TTS_MODEL).trim() || DEFAULT_RADIO_TTS_MODEL;
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

  const json = await response.json().catch(() => null);
  const audioPart = Array.isArray(json?.candidates)
    ? json.candidates
        .flatMap((candidate: any) => (Array.isArray(candidate?.content?.parts) ? candidate.content.parts : []))
        .find((part: any) => typeof part?.inlineData?.data === "string")
    : null;
  const audioBase64 = String(audioPart?.inlineData?.data ?? "").trim();
  const audioMimeType = String(audioPart?.inlineData?.mimeType ?? "").trim();
  if (!audioBase64) {
    const diagnostics = JSON.stringify(
      {
        candidateCount: Array.isArray(json?.candidates) ? json.candidates.length : 0,
        finishReasons: Array.isArray(json?.candidates) ? json.candidates.map((candidate: any) => candidate?.finishReason ?? null) : [],
        textParts: Array.isArray(json?.candidates)
          ? json.candidates.flatMap((candidate: any) =>
              Array.isArray(candidate?.content?.parts)
                ? candidate.content.parts
                    .filter((part: any) => typeof part?.text === "string" && part.text.trim())
                    .map((part: any) => String(part.text).trim())
                : []
            )
          : []
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
