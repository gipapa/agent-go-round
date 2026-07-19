import { useCallback, useEffect, useRef, useState } from "react";
import type { ModelCredentialEntry } from "../storage/settingsStore";
import type { VoiceSettings } from "../types";
import type { ResolvedLoadBalancerInstance } from "../utils/loadBalancer";
import { errorMessage } from "../utils/errors";
import { createLogRequestId, type PendingLogEntry } from "../runtime/logging";
import {
  createVoiceProbeWavBlob,
  getVoiceMicrophoneSupportIssue,
  MIN_VOICE_STT_BLOB_BYTES
} from "./helpers";
import { normalizeTranscriptSpacing, synthesizeGeminiSpeech, transcribeAudioChunk } from "./runtime";

export type VoiceProbeState = {
  running: boolean;
  ok?: boolean;
  message?: string;
};

type RunVoiceTask = <T>(args: {
  loadBalancerId?: string;
  requestId?: string;
  stage: string;
  voiceModel: string;
  execute: (candidate: ResolvedLoadBalancerInstance) => Promise<T>;
  describeSuccess?: (result: T) => string;
}) => Promise<T>;

type UseVoiceControllerArgs = {
  settings: VoiceSettings;
  sttLoadBalancerId?: string;
  ttsLoadBalancerId?: string;
  activeAgentName?: string;
  runTask: RunVoiceTask;
  pushLog: (entry: PendingLogEntry) => void;
  onTranscript: (transcript: string) => void;
};

function getCredentialApiKey(
  credential: ModelCredentialEntry | null,
  key?: ModelCredentialEntry["keys"][number]
) {
  if (!credential) return "";
  const target = key && key.apiKey.trim() ? key : credential.keys.find((entry) => entry.apiKey.trim());
  return target?.apiKey.trim() ?? "";
}

export function getVoiceRecorderOptions() {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"];
  for (const candidate of candidates) {
    if (typeof MediaRecorder.isTypeSupported === "function" && MediaRecorder.isTypeSupported(candidate)) {
      return { mimeType: candidate };
    }
  }
  return undefined;
}

export function useVoiceController(args: UseVoiceControllerArgs) {
  const [dictationStatus, setDictationStatus] = useState<"idle" | "recording" | "transcribing">("idle");
  const [playbackMessageId, setPlaybackMessageId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [probeState, setProbeState] = useState<{ stt: VoiceProbeState; tts: VoiceProbeState }>({
    stt: { running: false },
    tts: { running: false }
  });
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);

  const stopPlayback = useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.src = "";
    }
    audioRef.current = null;
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }
    setPlaybackMessageId(null);
  }, []);

  const stopCapture = useCallback(() => {
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (recorder && recorder.state !== "inactive") {
      try {
        recorder.stop();
      } catch {
        // Ignore recorder stop races.
      }
    }

    const stream = mediaStreamRef.current;
    mediaStreamRef.current = null;
    if (stream) {
      for (const track of stream.getTracks()) {
        track.stop();
      }
    }
  }, []);

  useEffect(() => {
    return () => {
      stopPlayback();
      stopCapture();
    };
  }, [stopCapture, stopPlayback]);

  async function transcribeBlob(blob: Blob, requestId: string) {
    if (!args.sttLoadBalancerId) {
      throw new Error("請先在 Chat Config > Voice 設定可用的 STT load balancer。");
    }
    return await args.runTask({
      loadBalancerId: args.sttLoadBalancerId,
      requestId,
      stage: "voice stt",
      voiceModel: "(from load balancer)",
      execute: async (candidate) => {
        const apiKey = getCredentialApiKey(candidate.credential, candidate.key);
        if (!apiKey) throw new Error("STT load balancer instance is missing API key.");
        return transcribeAudioChunk({
          credential: candidate.credential,
          apiKey,
          settings: args.settings,
          blob,
          chunkIndex: 0,
          modelOverride: candidate.instance.model
        });
      },
      describeSuccess: (text) => `response_length=${String(text ?? "").length}`
    });
  }

  async function startDictation() {
    setError(null);
    if (!args.sttLoadBalancerId) {
      setError("請先在 Chat Config > Voice 設定可用的 STT load balancer。");
      return;
    }
    const microphoneIssue = getVoiceMicrophoneSupportIssue();
    if (microphoneIssue) {
      setError(microphoneIssue);
      return;
    }

    const requestId = createLogRequestId("voice");
    args.pushLog({
      category: "voice",
      agent: args.activeAgentName ?? "Voice",
      requestId,
      stage: "dictation",
      message: "Voice dictation started"
    });

    try {
      stopCapture();
      recordedChunksRef.current = [];
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      const recorderOptions = getVoiceRecorderOptions();
      const recorder = recorderOptions ? new MediaRecorder(stream, recorderOptions) : new MediaRecorder(stream);
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) recordedChunksRef.current.push(event.data);
      };
      recorder.onerror = () => {
        setError("語音錄音失敗。");
        setDictationStatus("idle");
        stopCapture();
      };
      recorder.start();
      setDictationStatus("recording");
    } catch (caught) {
      stopCapture();
      setDictationStatus("idle");
      const message = errorMessage(caught);
      setError(message);
      args.pushLog({
        category: "voice",
        agent: args.activeAgentName ?? "Voice",
        ok: false,
        requestId,
        stage: "dictation",
        message: "Voice dictation failed to start",
        details: message
      });
    }
  }

  async function stopDictationAndTranscribe() {
    const recorder = recorderRef.current;
    if (!recorder) {
      setDictationStatus("idle");
      stopCapture();
      return;
    }

    const requestId = createLogRequestId("voice");
    setError(null);
    setDictationStatus("transcribing");
    const stopped = new Promise<void>((resolve) => {
      const previousOnStop = recorder.onstop;
      recorder.onstop = (event) => {
        if (typeof previousOnStop === "function") previousOnStop.call(recorder, event);
        resolve();
      };
    });

    try {
      if (recorder.state !== "inactive") recorder.stop();
      await stopped;
      const mimeType = recordedChunksRef.current.find((chunk) => chunk.type)?.type || recorder.mimeType || "audio/webm";
      const blob = new Blob(recordedChunksRef.current, { type: mimeType });
      stopCapture();
      recordedChunksRef.current = [];
      if (blob.size < MIN_VOICE_STT_BLOB_BYTES) throw new Error("錄音太短，沒有送出轉寫。");
      const transcript = await transcribeBlob(blob, requestId);
      const normalizedTranscript = normalizeTranscriptSpacing(transcript);
      if (normalizedTranscript) args.onTranscript(normalizedTranscript);
      args.pushLog({
        category: "voice",
        agent: args.activeAgentName ?? "Voice",
        ok: true,
        requestId,
        stage: "stt",
        message: "Voice dictation transcribed",
        details: transcript
      });
    } catch (caught) {
      const message = errorMessage(caught);
      setError(message);
      args.pushLog({
        category: "voice",
        agent: args.activeAgentName ?? "Voice",
        ok: false,
        requestId,
        stage: "stt",
        message: "Voice dictation transcription failed",
        details: message
      });
    } finally {
      stopCapture();
      setDictationStatus("idle");
    }
  }

  async function toggleDictation() {
    if (dictationStatus === "recording") {
      await stopDictationAndTranscribe();
      return;
    }
    if (dictationStatus === "idle") await startDictation();
  }

  async function playMessage(messageId: string, text: string) {
    const trimmed = String(text ?? "").trim();
    if (!trimmed) return;
    if (playbackMessageId === messageId) {
      stopPlayback();
      return;
    }
    if (!args.ttsLoadBalancerId) {
      setError("請先在 Chat Config > Voice 設定可用的 TTS load balancer。");
      return;
    }

    const requestId = createLogRequestId("voice");
    setError(null);
    stopPlayback();
    setPlaybackMessageId(messageId);
    try {
      const audioBlob = await args.runTask({
        loadBalancerId: args.ttsLoadBalancerId,
        requestId,
        stage: "voice tts",
        voiceModel: "(from load balancer)",
        execute: async (candidate) => {
          const apiKey = getCredentialApiKey(candidate.credential, candidate.key);
          if (!apiKey) throw new Error("TTS load balancer instance is missing API key.");
          return synthesizeGeminiSpeech({
            credential: candidate.credential,
            apiKey,
            settings: args.settings,
            text: trimmed,
            modelOverride: candidate.instance.model
          });
        },
        describeSuccess: (blob) => `audio_bytes=${blob.size}`
      });
      const audioUrl = URL.createObjectURL(audioBlob);
      const audio = new Audio(audioUrl);
      audioRef.current = audio;
      audioUrlRef.current = audioUrl;
      audio.onended = () => {
        if (audioRef.current === audio) stopPlayback();
      };
      audio.onerror = () => {
        if (audioRef.current === audio) stopPlayback();
        setError("語音播放失敗。");
      };
      await audio.play();
      args.pushLog({
        category: "voice",
        agent: args.activeAgentName ?? "Voice",
        ok: true,
        requestId,
        stage: "tts",
        message: "Voice playback started",
        details: `message_id=${messageId}`
      });
    } catch (caught) {
      const message = errorMessage(caught);
      stopPlayback();
      setError(message);
      args.pushLog({
        category: "voice",
        agent: args.activeAgentName ?? "Voice",
        ok: false,
        requestId,
        stage: "tts",
        message: "Voice playback failed",
        details: message
      });
    }
  }

  async function testStt() {
    const requestId = createLogRequestId("voice");
    if (!args.sttLoadBalancerId) {
      setProbeState((current) => ({
        ...current,
        stt: { running: false, ok: false, message: "請先選擇 STT load balancer。" }
      }));
      return;
    }
    setProbeState((current) => ({ ...current, stt: { running: true } }));
    try {
      const transcript = await args.runTask({
        loadBalancerId: args.sttLoadBalancerId,
        requestId,
        stage: "voice stt probe",
        voiceModel: "(from load balancer)",
        execute: async (candidate) => {
          const apiKey = getCredentialApiKey(candidate.credential, candidate.key);
          if (!apiKey) throw new Error("STT load balancer instance is missing API key.");
          return transcribeAudioChunk({
            credential: candidate.credential,
            apiKey,
            settings: args.settings,
            blob: createVoiceProbeWavBlob(),
            chunkIndex: 0,
            modelOverride: candidate.instance.model,
            allowEmptyTranscript: true
          });
        },
        describeSuccess: (text) => `response_length=${String(text ?? "").length}`
      });
      const message = `STT probe OK${transcript ? `，transcript=${transcript}` : "，provider accepted probe audio"}`;
      setProbeState((current) => ({ ...current, stt: { running: false, ok: true, message } }));
    } catch (caught) {
      setProbeState((current) => ({
        ...current,
        stt: { running: false, ok: false, message: errorMessage(caught) }
      }));
    }
  }

  async function testTts() {
    const requestId = createLogRequestId("voice");
    if (!args.ttsLoadBalancerId) {
      setProbeState((current) => ({
        ...current,
        tts: { running: false, ok: false, message: "請先選擇 TTS load balancer。" }
      }));
      return;
    }
    setProbeState((current) => ({ ...current, tts: { running: true } }));
    try {
      const audioBlob = await args.runTask({
        loadBalancerId: args.ttsLoadBalancerId,
        requestId,
        stage: "voice tts probe",
        voiceModel: "(from load balancer)",
        execute: async (candidate) => {
          const apiKey = getCredentialApiKey(candidate.credential, candidate.key);
          if (!apiKey) throw new Error("TTS load balancer instance is missing API key.");
          return synthesizeGeminiSpeech({
            credential: candidate.credential,
            apiKey,
            settings: args.settings,
            text: "Voice TTS test.",
            modelOverride: candidate.instance.model
          });
        },
        describeSuccess: (blob) => `audio_bytes=${blob.size}`
      });
      setProbeState((current) => ({
        ...current,
        tts: { running: false, ok: true, message: `TTS probe OK，audio_bytes=${audioBlob.size}` }
      }));
    } catch (caught) {
      setProbeState((current) => ({
        ...current,
        tts: { running: false, ok: false, message: errorMessage(caught) }
      }));
    }
  }

  return {
    dictationStatus,
    playbackMessageId,
    error,
    probeState,
    toggleDictation,
    playMessage,
    testStt,
    testTts,
    stopPlayback,
    stopCapture
  };
}
