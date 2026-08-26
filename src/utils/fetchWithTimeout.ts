export const DEFAULT_FETCH_TIMEOUT_MS = 60_000;
export const MAX_FETCH_TIMEOUT_MS = 24 * 60 * 60 * 1000;
const MAX_RESPONSE_TEXT_CHARS = 1_000_000;

export type FetchWithTimeoutOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
};

function formatMs(ms: number) {
  const seconds = ms / 1000;
  return Number.isInteger(seconds) ? `${seconds}s` : `${Math.round(ms)}ms`;
}

function abortController(controller: AbortController, reason: unknown) {
  try {
    controller.abort(reason);
  } catch {
    controller.abort();
  }
}

function getReasonMessage(reason: unknown) {
  if (reason instanceof Error) return reason.message;
  if (typeof reason === "string") return reason;
  if (reason === undefined || reason === null) return "";
  return String(reason);
}

export function getAbortSignalMessage(signal: AbortSignal | undefined, fallback = "request aborted") {
  const message = getReasonMessage(signal?.reason);
  return message || fallback;
}

export function isAbortLikeError(error: unknown) {
  const maybeError = error as { name?: string } | null;
  return maybeError?.name === "AbortError";
}

export function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return String(error ?? "Unknown error");
}

export function getRetryAfterDelayMs(headers: Headers, fallbackMs: number) {
  const raw = headers.get("Retry-After")?.trim();
  if (!raw) return fallbackMs;

  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(MAX_FETCH_TIMEOUT_MS, seconds * 1000);

  const dateMs = Date.parse(raw);
  if (Number.isFinite(dateMs)) return Math.min(MAX_FETCH_TIMEOUT_MS, Math.max(0, dateMs - Date.now()));

  return Number.isFinite(fallbackMs) ? Math.min(MAX_FETCH_TIMEOUT_MS, Math.max(0, fallbackMs)) : 0;
}

export async function readResponseTextWithLimit(response: Response, maxChars: number) {
  const limit = Number.isFinite(maxChars)
    ? Math.min(MAX_RESPONSE_TEXT_CHARS, Math.max(0, Math.floor(maxChars)))
    : MAX_RESPONSE_TEXT_CHARS;
  if (!response.body) {
    const text = await response.text();
    return { text: text.slice(0, limit), exceeded: text.length > limit };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let text = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      const remaining = Math.max(0, limit - text.length);
      if (chunk.length > remaining) {
        text += chunk.slice(0, remaining);
        await reader.cancel().catch(() => {});
        return { text: text.slice(0, limit), exceeded: true };
      }
      text += chunk;
    }
    const tail = decoder.decode();
    const remaining = Math.max(0, limit - text.length);
    if (tail.length > remaining) return { text: `${text}${tail.slice(0, remaining)}`.slice(0, limit), exceeded: true };
    text += tail;
    return { text: text.slice(0, limit), exceeded: false };
  } finally {
    reader.releaseLock();
  }
}

export function sleepWithAbort(ms: number, signal?: AbortSignal) {
  if (ms <= 0) return Promise.resolve();
  if (signal?.aborted) return Promise.reject(new Error(getAbortSignalMessage(signal)));

  let onAbort: (() => void) | undefined;
  return new Promise<void>((resolve, reject) => {
    const timeoutId = globalThis.setTimeout(resolve, ms);
    onAbort = () => {
      globalThis.clearTimeout(timeoutId);
      reject(new Error(getAbortSignalMessage(signal)));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  }).finally(() => {
    if (onAbort) signal?.removeEventListener("abort", onAbort);
  });
}

export async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit = {}, options: FetchWithTimeoutOptions = {}) {
  const requestedTimeoutMs = options.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
  const timeoutMs = Number.isFinite(requestedTimeoutMs)
    ? Math.min(MAX_FETCH_TIMEOUT_MS, Math.max(0, Math.round(requestedTimeoutMs)))
    : DEFAULT_FETCH_TIMEOUT_MS;
  const controller = new AbortController();
  const linkedSignals = [init.signal, options.signal].filter(Boolean) as AbortSignal[];
  const linkedAbortHandlers: Array<() => void> = [];
  let timedOut = false;
  let timeoutId: ReturnType<typeof globalThis.setTimeout> | null = null;

  const abortFromSignal = (signal: AbortSignal) => {
    abortController(controller, signal.reason || new Error("request aborted"));
  };

  for (const signal of linkedSignals) {
    if (signal.aborted) {
      abortFromSignal(signal);
      break;
    }
    const onAbort = () => abortFromSignal(signal);
    linkedAbortHandlers.push(() => signal.removeEventListener("abort", onAbort));
    signal.addEventListener("abort", onAbort, { once: true });
  }

  if (Number.isFinite(timeoutMs) && timeoutMs > 0 && !controller.signal.aborted) {
    timeoutId = globalThis.setTimeout(() => {
      timedOut = true;
      abortController(controller, new Error(`fetch timeout after ${formatMs(timeoutMs)}`));
    }, timeoutMs);
  }

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (timedOut) {
      throw new Error(`fetch timeout after ${formatMs(timeoutMs)}`);
    }
    if (controller.signal.aborted || isAbortLikeError(error)) {
      throw new Error(getAbortSignalMessage(controller.signal));
    }
    throw error;
  } finally {
    if (timeoutId !== null) globalThis.clearTimeout(timeoutId);
    linkedAbortHandlers.forEach((remove) => remove());
  }
}
