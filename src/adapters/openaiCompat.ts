import { AgentAdapter, ChatEvent, ChatRequest, NativeChatEvent, NativeChatRequest, normalizeRetryConfig } from "./base";
import { DetectResult, ChatMessage } from "../types";
import {
  DEFAULT_FETCH_TIMEOUT_MS,
  fetchWithTimeout,
  getAbortSignalMessage,
  getErrorMessage,
  getRetryAfterDelayMs,
  readResponseTextWithLimit,
  sleepWithAbort
} from "../utils/fetchWithTimeout";
import { errorMessage } from "../utils/errors";

type OpenAIMessage = { role: Exclude<ChatMessage["role"], "tool">; content: string };
const MAX_DETECTION_RESPONSE_CHARS = 64 * 1024;
const DEFAULT_MAX_RESPONSE_CHARS = 64_000;
const DEFAULT_MAX_TOKENS = 4_096;
const GPT_OSS_MAX_TOKENS = 1_024;
const GPT_OSS_TEXT_MAX_TOKENS = 4_096;
const MAX_NATIVE_WIRE_RESPONSE_CHARS = 1_024 * 1_024;

function normalizeMaxResponseChars(value: number | undefined) {
  return Number.isFinite(value) && (value as number) >= 0
    ? Math.min(1_000_000, Math.floor(value as number))
    : DEFAULT_MAX_RESPONSE_CHARS;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

async function readJson(response: Response): Promise<unknown> {
  const bounded = await readResponseTextWithLimit(response, MAX_DETECTION_RESPONSE_CHARS);
  if (bounded.exceeded) throw new Error(`Provider discovery response exceeded ${MAX_DETECTION_RESPONSE_CHARS} chars`);
  return JSON.parse(bounded.text) as unknown;
}

function firstChoice(value: unknown): Record<string, unknown> | null {
  const choices = asRecord(value)?.choices;
  return Array.isArray(choices) ? asRecord(choices[0]) : null;
}

function choiceMessageContent(choice: Record<string, unknown> | null): string {
  const message = asRecord(choice?.message);
  if (typeof message?.content === "string") return message.content;
  return typeof choice?.text === "string" ? choice.text : "";
}

function nativeToolCallCount(choice: Record<string, unknown> | null) {
  if (!choice) return 0;
  const message = asRecord(choice.message);
  const delta = asRecord(choice.delta);
  const messageCalls = Array.isArray(message?.tool_calls) ? message.tool_calls.length : 0;
  const deltaCalls = Array.isArray(delta?.tool_calls) ? delta.tool_calls.length : 0;
  const hasMessageFunctionCall = !!message?.function_call && typeof message.function_call === "object";
  const hasDeltaFunctionCall = !!delta?.function_call && typeof delta.function_call === "object";
  return messageCalls + deltaCalls + (hasMessageFunctionCall ? 1 : 0) + (hasDeltaFunctionCall ? 1 : 0);
}

function unexpectedNativeToolCall(choice: Record<string, unknown> | null): ChatEvent | null {
  const count = nativeToolCallCount(choice);
  if (count === 0) return null;
  return {
    type: "error",
    kind: "provider",
    retryable: false,
    message: `unexpected_native_tool_call_in_text_mode: provider returned ${count} native tool call payload${count === 1 ? "" : "s"}.`
  };
}

function httpError(status: number, text: string): ChatEvent {
  const kind = status === 429 ? "rate_limit" : status === 401 || status === 403 ? "auth" : "http";
  const retryable = (status === 429 && !isDailyTokenRateLimit(text)) || status >= 500;
  return { type: "error", kind, retryable, message: `HTTP ${status}${text ? `\n${text}` : ""}` };
}

function nativeHttpError(status: number, text: string): NativeChatEvent {
  const kind = status === 429 ? "rate_limit" : status === 401 || status === 403 ? "auth" : "http";
  const retryable = (status === 429 && !isDailyTokenRateLimit(text)) || status >= 500;
  return { type: "error", kind, retryable, message: `HTTP ${status}${text ? `\n${text}` : ""}` };
}

function isDailyTokenRateLimit(text: string) {
  return /(?:tokens?\s+per\s+day|\bTPD\b)/i.test(text);
}

function toOpenAIMessage(m: ChatMessage) {
  if (m.role === "tool") {
    return null;
  }
  return { role: m.role, content: m.content } satisfies OpenAIMessage;
}

export const OpenAICompatAdapter: AgentAdapter = {
  async detect(agent): Promise<DetectResult> {
    if (!agent.endpoint) return { ok: false, detectedType: "unknown", notes: "No endpoint" };
    try {
      const url = agent.endpoint.replace(/\/$/, "") + "/models";
      const res = await fetchWithTimeout(url, {
        headers: {
          ...(agent.apiKey ? { Authorization: `Bearer ${agent.apiKey}` } : {}),
          ...(agent.headers ?? {})
        }
      });
      if (!res.ok) return { ok: false, detectedType: "unknown", notes: `HTTP ${res.status}` };
      const json = await readJson(res);
      if (Array.isArray(asRecord(json)?.data)) return { ok: true, detectedType: "openai_compat" };
      return { ok: false, detectedType: "unknown", notes: "Unexpected /models response" };
    } catch (e) {
      return { ok: false, detectedType: "unknown", notes: errorMessage(e) || "detect failed" };
    }
  },

  async *chat(req: ChatRequest): AsyncGenerator<ChatEvent> {
    const endpoint = (req.agent.endpoint ?? "").replace(/\/$/, "");
    const url = endpoint + "/chat/completions";
    const retry = normalizeRetryConfig(req.retry);
    const retryDelaySec = retry?.delaySec ?? 0;
    const retryMax = retry?.max ?? 0;
    const timeoutMs = req.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
    const maxResponseChars = normalizeMaxResponseChars(req.maxModelResponseChars);
    const maxResponseBodyChars = maxResponseChars + 65_536;
    const model = req.agent.model ?? "gpt-4o-mini";
    const isGptOss = /^openai\/gpt-oss-(?:20b|120b)$/.test(model);
    const isQwenNonReasoning = model === "qwen/qwen3.6-27b";

    const messages: OpenAIMessage[] = [];
    if (req.system?.trim()) messages.push({ role: "system", content: req.system.trim() });
    for (const m of req.history) {
      const mapped = toOpenAIMessage(m);
      if (mapped) messages.push(mapped);
    }
    messages.push({ role: "user", content: req.input });

    let res: Response | null = null;

    const waitBeforeRetry = async (delayMs: number) => {
      if (delayMs > 0) await sleepWithAbort(delayMs, req.signal);
    };

    for (let attempt = 0; attempt <= retryMax; attempt++) {
      try {
        res = await fetchWithTimeout(
          url,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(req.agent.apiKey ? { Authorization: `Bearer ${req.agent.apiKey}` } : {}),
              ...(req.agent.headers ?? {})
            },
            body: JSON.stringify({
              model,
              stream: true,
              messages,
              ...(isGptOss
                ? {
                    max_completion_tokens: GPT_OSS_TEXT_MAX_TOKENS,
                    reasoning_effort: "low",
                    include_reasoning: false
                  }
                : isQwenNonReasoning
                  ? {
                      max_completion_tokens: DEFAULT_MAX_TOKENS,
                      reasoning_effort: "none",
                      include_reasoning: false
                    }
                  : { max_tokens: DEFAULT_MAX_TOKENS })
            })
          },
          { signal: req.signal, timeoutMs }
        );
      } catch (e) {
        if (req.signal?.aborted) {
          yield { type: "aborted", message: getAbortSignalMessage(req.signal) };
          return;
        }
        if (attempt < retryMax) {
          req.onLog?.(`[retry] network error, attempt ${attempt + 1}/${retryMax}, waiting ${retryDelaySec}s`);
          try {
            await waitBeforeRetry(retryDelaySec * 1000);
          } catch (waitError) {
            if (req.signal?.aborted) yield { type: "aborted", message: getAbortSignalMessage(req.signal) };
            else yield { type: "error", kind: "network", retryable: true, message: getErrorMessage(waitError) };
            return;
          }
          continue;
        }
        yield { type: "error", kind: "network", retryable: true, message: getErrorMessage(e) };
        return;
      }

      if (res.ok && res.body) break;

      const text = (await readResponseTextWithLimit(res, 8_192).catch(() => ({ text: "", exceeded: false }))).text;
      if (res.status === 429 && attempt < retryMax && !isDailyTokenRateLimit(text)) {
        const delayMs = getRetryAfterDelayMs(res.headers, retryDelaySec * 1000);
        req.onLog?.(`[retry] HTTP 429, attempt ${attempt + 1}/${retryMax}, waiting ${Math.round(delayMs / 1000)}s`);
        try {
          await waitBeforeRetry(delayMs);
        } catch (waitError) {
          if (req.signal?.aborted) yield { type: "aborted", message: getAbortSignalMessage(req.signal) };
          else yield { type: "error", kind: "rate_limit", retryable: true, message: getErrorMessage(waitError) };
          return;
        }
        continue;
      }
      yield httpError(res.status, text);
      return;
    }

    if (!res) {
      yield { type: "error", kind: "network", retryable: true, message: "No response" };
      return;
    }

    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("text/event-stream")) {
      const bounded = await readResponseTextWithLimit(res, maxResponseBodyChars);
      if (bounded.exceeded) {
        yield { type: "error", kind: "response_limit", retryable: false, message: `Model response exceeded ${maxResponseChars} chars.` };
        return;
      }
      try {
        const json = JSON.parse(bounded.text) as unknown;
        const choice = firstChoice(json);
        const nativeCallError = unexpectedNativeToolCall(choice);
        if (nativeCallError) {
          yield nativeCallError;
          return;
        }
        const text = choiceMessageContent(choice);
        if (text.length > maxResponseChars) {
          yield { type: "error", kind: "response_limit", retryable: false, message: `Model response exceeded ${maxResponseChars} chars.` };
          return;
        }
        yield { type: "done", text };
        return;
      } catch {
        yield { type: "error", kind: "provider", retryable: false, message: "Provider returned an invalid OpenAI-compatible JSON response." };
        return;
      }
    }

    if (!res.body) {
      yield { type: "error", kind: "empty", retryable: true, message: "Empty response body" };
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buf = "";
    let full = "";
    let wireChars = 0;
    let finishReason = "";
    let completionTokens: number | undefined;
    let reasoningTokens: number | undefined;

    const emptyStreamError = (): ChatEvent => {
      const details = [
        finishReason ? `finish_reason=${finishReason}` : "",
        completionTokens !== undefined ? `completion_tokens=${completionTokens}` : "",
        reasoningTokens !== undefined ? `reasoning_tokens=${reasoningTokens}` : ""
      ].filter(Boolean).join(", ");
      return {
        type: "error",
        kind: "empty",
        retryable: true,
        message: `Model returned an empty response${details ? ` (${details})` : ""}.`
      };
    };

    try {
      while (true) {
        if (req.signal?.aborted) {
          await reader.cancel().catch(() => {});
          yield { type: "aborted", message: getAbortSignalMessage(req.signal) };
          return;
        }

        const { value, done } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        wireChars += chunk.length;
        if (wireChars > maxResponseBodyChars) {
          await reader.cancel().catch(() => {});
          yield { type: "error", kind: "response_limit", retryable: false, message: `Model response exceeded ${maxResponseChars} chars.` };
          return;
        }
        buf += chunk;

        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const data = trimmed.slice(5).trim();
          if (data === "[DONE]") {
            yield full.trim() ? { type: "done", text: full } : emptyStreamError();
            return;
          }
          let j: unknown;
          try {
            j = JSON.parse(data) as unknown;
          } catch {
            await reader.cancel().catch(() => {});
            yield { type: "error", kind: "provider", retryable: false, message: "Provider returned a malformed OpenAI-compatible SSE chunk." };
            return;
          }
          const choice = firstChoice(j);
          const nativeCallError = unexpectedNativeToolCall(choice);
          if (nativeCallError) {
            await reader.cancel().catch(() => {});
            yield nativeCallError;
            return;
          }
          if (typeof choice?.finish_reason === "string") finishReason = choice.finish_reason;
          const usage = asRecord(asRecord(j)?.usage);
          if (typeof usage?.completion_tokens === "number") completionTokens = usage.completion_tokens;
          const completionDetails = asRecord(usage?.completion_tokens_details);
          if (typeof completionDetails?.reasoning_tokens === "number") reasoningTokens = completionDetails.reasoning_tokens;
          const deltaRecord = asRecord(choice?.delta);
          const delta = typeof deltaRecord?.content === "string" ? deltaRecord.content : "";
          const msgContent = choiceMessageContent(choice);
          if (delta) {
            full += delta;
            if (full.length > maxResponseChars) {
              await reader.cancel().catch(() => {});
              yield { type: "error", kind: "response_limit", retryable: false, message: `Model response exceeded ${maxResponseChars} chars.` };
              return;
            }
            yield { type: "delta", text: delta };
            continue;
          }
          if (msgContent) {
            const nextText = msgContent.startsWith(full) ? msgContent.slice(full.length) : msgContent;
            full = msgContent;
            if (full.length > maxResponseChars) {
              await reader.cancel().catch(() => {});
              yield { type: "error", kind: "response_limit", retryable: false, message: `Model response exceeded ${maxResponseChars} chars.` };
              return;
            }
            if (nextText) yield { type: "delta", text: nextText };
          }
        }
      }
    } catch (error) {
      if (req.signal?.aborted) {
        yield { type: "aborted", message: getAbortSignalMessage(req.signal) };
        return;
      }
      yield { type: "error", kind: "network", retryable: true, message: getErrorMessage(error) };
      return;
    }

    yield full.trim() ? { type: "done", text: full } : emptyStreamError();
  },

  async *nativeChat(req: NativeChatRequest): AsyncGenerator<NativeChatEvent> {
    const endpoint = (req.agent.endpoint ?? "").replace(/\/$/, "");
    const url = endpoint + "/chat/completions";
    const retry = normalizeRetryConfig(req.retry);
    const retryDelaySec = retry?.delaySec ?? 0;
    const retryMax = retry?.max ?? 0;
    const timeoutMs = req.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
    const maxResponseChars = normalizeMaxResponseChars(req.maxModelResponseChars);
    const model = req.agent.model ?? "gpt-4o-mini";
    const isGptOss = /^openai\/gpt-oss-(?:20b|120b)$/.test(model);

    const waitBeforeRetry = async (delayMs: number) => {
      if (delayMs > 0) await sleepWithAbort(delayMs, req.signal);
    };
    const emptyResponseOutcome = async (attempt: number): Promise<NativeChatEvent | null> => {
      if (req.signal?.aborted) return { type: "aborted", message: getAbortSignalMessage(req.signal) };
      if (attempt >= retryMax) {
        return { type: "error", kind: "empty", retryable: true, message: "Native model returned an empty response." };
      }
      req.onLog?.(`[retry] native empty response, attempt ${attempt + 1}/${retryMax}, waiting ${retryDelaySec}s`);
      try {
        await waitBeforeRetry(retryDelaySec * 1000);
      } catch (error) {
        return req.signal?.aborted
          ? { type: "aborted", message: getAbortSignalMessage(req.signal) }
          : { type: "error", kind: "empty", retryable: true, message: getErrorMessage(error) };
      }
      return null;
    };

    for (let attempt = 0; attempt <= retryMax; attempt += 1) {
      let res: Response;
      try {
        res = await fetchWithTimeout(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(req.agent.apiKey ? { Authorization: `Bearer ${req.agent.apiKey}` } : {}),
            ...(req.agent.headers ?? {})
          },
          body: JSON.stringify({
            model,
            stream: true,
            messages: req.messages,
            tools: req.tools,
            tool_choice: req.toolChoice ?? "auto",
            ...(isGptOss
              ? {
                  max_completion_tokens: GPT_OSS_MAX_TOKENS,
                  reasoning_effort: "low",
                  include_reasoning: false
                }
              : { max_tokens: DEFAULT_MAX_TOKENS })
          })
        }, { signal: req.signal, timeoutMs });
      } catch (error) {
        if (req.signal?.aborted) {
          yield { type: "aborted", message: getAbortSignalMessage(req.signal) };
          return;
        }
        if (attempt < retryMax) {
          req.onLog?.(`[retry] native network error, attempt ${attempt + 1}/${retryMax}, waiting ${retryDelaySec}s`);
          try {
            await waitBeforeRetry(retryDelaySec * 1000);
          } catch (waitError) {
            yield req.signal?.aborted
              ? { type: "aborted", message: getAbortSignalMessage(req.signal) }
              : { type: "error", kind: "network", retryable: true, message: getErrorMessage(waitError) };
            return;
          }
          continue;
        }
        yield { type: "error", kind: "network", retryable: true, message: getErrorMessage(error) };
        return;
      }

      if (!res.ok) {
        const text = (await readResponseTextWithLimit(res, 8_192).catch(() => ({ text: "", exceeded: false }))).text;
      if (res.status === 429 && attempt < retryMax && !isDailyTokenRateLimit(text)) {
          try {
            await waitBeforeRetry(getRetryAfterDelayMs(res.headers, retryDelaySec * 1000));
          } catch (waitError) {
            yield req.signal?.aborted
              ? { type: "aborted", message: getAbortSignalMessage(req.signal) }
              : { type: "error", kind: "rate_limit", retryable: true, message: getErrorMessage(waitError) };
            return;
          }
          continue;
        }
        yield nativeHttpError(res.status, text);
        return;
      }

      if (!res.body) {
        const outcome = await emptyResponseOutcome(attempt);
        if (outcome) {
          yield outcome;
          return;
        }
        continue;
      }

      const contentType = res.headers.get("content-type") ?? "";
      if (!contentType.includes("text/event-stream")) {
        const bounded = await readResponseTextWithLimit(res, maxResponseChars + 65_536);
        if (bounded.exceeded) {
          yield { type: "error", kind: "response_limit", retryable: false, message: `Native model response exceeded ${maxResponseChars} chars.` };
          return;
        }
        try {
          const json = JSON.parse(bounded.text) as unknown;
          const choice = firstChoice(json);
          const message = asRecord(choice?.message);
          const content = typeof message?.content === "string" ? message.content : "";
          const calls = Array.isArray(message?.tool_calls) ? message.tool_calls : [];
          const normalizedCalls = calls.map((entry, index) => {
            const call = asRecord(entry);
            const fn = asRecord(call?.function);
            return {
              index,
              id: typeof call?.id === "string" ? call.id : undefined,
              name: typeof fn?.name === "string" ? fn.name : undefined,
              arguments: typeof fn?.arguments === "string" ? fn.arguments : ""
            };
          });
          let responseChars = content.length;
          for (const call of normalizedCalls) responseChars += call.arguments.length;
          if (responseChars > maxResponseChars) {
            yield { type: "error", kind: "response_limit", retryable: false, message: `Native model response exceeded ${maxResponseChars} chars.` };
            return;
          }
          const finishReason = typeof choice?.finish_reason === "string" ? choice.finish_reason : undefined;
          const announcedToolCall = finishReason === "tool_calls" || finishReason === "function_call";
          const hasPayload = !!content || normalizedCalls.some((call) => !!call.id || !!call.name || !!call.arguments);
          if (!hasPayload && !announcedToolCall) {
            const outcome = await emptyResponseOutcome(attempt);
            if (outcome) {
              yield outcome;
              return;
            }
            continue;
          }
          if (content) yield { type: "text_delta", text: content };
          for (const call of normalizedCalls) yield { type: "tool_call_delta", call };
          yield { type: "done", finishReason };
          return;
        } catch (error) {
          yield { type: "error", kind: "provider", retryable: false, message: getErrorMessage(error) };
          return;
        }
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let buffer = "";
      let responseChars = 0;
      let wireChars = 0;
      let hasPayload = false;
      let finishReason: string | undefined;
      try {
        let finished = false;
        while (!finished) {
          if (req.signal?.aborted) {
            await reader.cancel().catch(() => {});
            yield { type: "aborted", message: getAbortSignalMessage(req.signal) };
            return;
          }
          const { value, done } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          wireChars += chunk.length;
          // Native providers may include hidden reasoning and repeated SSE
          // envelope metadata in the wire stream. Bound that separately from
          // the visible text/tool payload limit below.
          if (wireChars > MAX_NATIVE_WIRE_RESPONSE_CHARS) {
            await reader.cancel().catch(() => {});
            yield { type: "error", kind: "response_limit", retryable: false, message: `Native model response exceeded ${maxResponseChars} chars.` };
            return;
          }
          buffer += chunk;
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data:")) continue;
            const data = trimmed.slice(5).trim();
            if (data === "[DONE]") {
              finished = true;
              break;
            }
            let parsed: unknown;
            try {
              parsed = JSON.parse(data) as unknown;
            } catch {
              await reader.cancel().catch(() => {});
              yield { type: "error", kind: "provider", retryable: false, message: "Provider returned a malformed OpenAI-compatible native SSE chunk." };
              return;
            }
            const choice = firstChoice(parsed);
            const delta = asRecord(choice?.delta);
            const text = typeof delta?.content === "string" ? delta.content : "";
            if (text) {
              hasPayload = true;
              responseChars += text.length;
              if (responseChars > maxResponseChars) {
                await reader.cancel().catch(() => {});
                yield { type: "error", kind: "response_limit", retryable: false, message: `Native model response exceeded ${maxResponseChars} chars.` };
                return;
              }
              yield { type: "text_delta", text };
            }
            const calls = Array.isArray(delta?.tool_calls) ? delta.tool_calls : [];
            for (const entry of calls) {
              const call = asRecord(entry);
              const fn = asRecord(call?.function);
              const index = typeof call?.index === "number" ? call.index : Number.NaN;
              if (!Number.isInteger(index) || index < 0) {
                await reader.cancel().catch(() => {});
                yield { type: "error", kind: "provider", retryable: false, message: "Provider returned a native tool call without a valid index." };
                return;
              }
              const id = typeof call?.id === "string" ? call.id : undefined;
              const name = typeof fn?.name === "string" ? fn.name : undefined;
              const argumentsText = typeof fn?.arguments === "string" ? fn.arguments : "";
              hasPayload ||= !!id || !!name || !!argumentsText;
              responseChars += argumentsText.length;
              if (responseChars > maxResponseChars) {
                await reader.cancel().catch(() => {});
                yield { type: "error", kind: "response_limit", retryable: false, message: `Native model response exceeded ${maxResponseChars} chars.` };
                return;
              }
              yield { type: "tool_call_delta", call: { index, id, name, arguments: argumentsText } };
            }
            if (typeof choice?.finish_reason === "string") {
              finishReason = choice.finish_reason;
              finished = true;
              break;
            }
          }
        }
      } catch (error) {
        if (req.signal?.aborted) yield { type: "aborted", message: getAbortSignalMessage(req.signal) };
        else yield { type: "error", kind: "network", retryable: true, message: getErrorMessage(error) };
        return;
      }

      const announcedToolCall = finishReason === "tool_calls" || finishReason === "function_call";
      if (!hasPayload && !announcedToolCall) {
        const outcome = await emptyResponseOutcome(attempt);
        if (outcome) {
          yield outcome;
          return;
        }
        continue;
      }
      yield { type: "done", finishReason };
      return;
    }
  }
};
