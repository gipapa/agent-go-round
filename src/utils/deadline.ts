export type ExecutionDeadline = {
  signal: AbortSignal;
  startedAt: number;
  expiresAt: number;
  totalMs: number;
  remainingMs: () => number;
  alive: () => boolean;
  throwIfExpired: (label?: string) => void;
  dispose: () => void;
};

function formatMs(ms: number) {
  const rounded = Math.max(0, Math.round(ms));
  if (rounded % 1000 === 0) return `${rounded / 1000}s`;
  return `${rounded}ms`;
}

function reasonMessage(reason: unknown) {
  if (reason instanceof Error) return reason.message;
  if (typeof reason === "string") return reason;
  if (reason === undefined || reason === null) return "";
  return String(reason);
}

function abortController(controller: AbortController, reason: unknown) {
  if (controller.signal.aborted) return;
  try {
    controller.abort(reason);
  } catch {
    controller.abort();
  }
}

function deadlineError(label: string, ms: number) {
  return new Error(`${label} timed out after ${formatMs(ms)}`);
}

export function getDeadlineAbortMessage(signal?: AbortSignal, fallback = "execution aborted") {
  return reasonMessage(signal?.reason) || fallback;
}

export function combineSignals(...signals: Array<AbortSignal | undefined | null>): AbortSignal {
  const activeSignals = signals.filter(Boolean) as AbortSignal[];
  if (activeSignals.length === 0) return new AbortController().signal;
  if (activeSignals.length === 1) return activeSignals[0];

  const controller = new AbortController();
  const abortFrom = (signal: AbortSignal) => abortController(controller, signal.reason || new Error("execution aborted"));

  for (const signal of activeSignals) {
    if (signal.aborted) {
      abortFrom(signal);
      break;
    }
    signal.addEventListener("abort", () => abortFrom(signal), { once: true });
  }

  return controller.signal;
}

export function timeoutAfter(ms: number, label: string, signal?: AbortSignal): Promise<never> {
  const timeoutMs = Math.max(0, Math.round(ms));
  if (signal?.aborted) return Promise.reject(new Error(getDeadlineAbortMessage(signal)));
  if (timeoutMs <= 0) return Promise.reject(deadlineError(label, timeoutMs));

  let timeoutId: ReturnType<typeof globalThis.setTimeout> | null = null;
  let onAbort: (() => void) | undefined;

  return new Promise<never>((_resolve, reject) => {
    timeoutId = globalThis.setTimeout(() => reject(deadlineError(label, timeoutMs)), timeoutMs);
    onAbort = () => {
      if (timeoutId !== null) globalThis.clearTimeout(timeoutId);
      reject(new Error(getDeadlineAbortMessage(signal)));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  }).finally(() => {
    if (timeoutId !== null) globalThis.clearTimeout(timeoutId);
    if (onAbort) signal?.removeEventListener("abort", onAbort);
  });
}

export async function withTimeout<T>(
  promise: PromiseLike<T>,
  ms: number,
  label: string,
  signal?: AbortSignal
): Promise<T> {
  return await Promise.race([Promise.resolve(promise), timeoutAfter(ms, label, signal)]);
}

export function createDeadline(opts: {
  totalMs: number;
  externalSignal?: AbortSignal;
  label?: string;
}): ExecutionDeadline {
  const totalMs = Math.max(0, Math.round(opts.totalMs));
  const startedAt = Date.now();
  const expiresAt = startedAt + totalMs;
  const controller = new AbortController();
  const label = opts.label?.trim() || "execution";

  let timeoutId: ReturnType<typeof globalThis.setTimeout> | null = null;
  let externalAbort: (() => void) | undefined;

  if (opts.externalSignal) {
    externalAbort = () => abortController(controller, opts.externalSignal?.reason || new Error(`${label} aborted`));
    if (opts.externalSignal.aborted) {
      externalAbort();
    } else {
      opts.externalSignal.addEventListener("abort", externalAbort, { once: true });
    }
  }

  if (!controller.signal.aborted) {
    if (totalMs <= 0) {
      abortController(controller, deadlineError(label, totalMs));
    } else {
      timeoutId = globalThis.setTimeout(() => abortController(controller, deadlineError(label, totalMs)), totalMs);
    }
  }

  const remainingMs = () => expiresAt - Date.now();

  const deadline: ExecutionDeadline = {
    signal: controller.signal,
    startedAt,
    expiresAt,
    totalMs,
    remainingMs,
    alive: () => !controller.signal.aborted && remainingMs() > 0,
    throwIfExpired: (stage?: string) => {
      if (!controller.signal.aborted && remainingMs() > 0) return;
      const prefix = stage?.trim() || label;
      const message = controller.signal.aborted
        ? getDeadlineAbortMessage(controller.signal)
        : `${prefix} timed out after ${formatMs(totalMs)}`;
      throw new Error(message);
    },
    dispose: () => {
      if (timeoutId !== null) globalThis.clearTimeout(timeoutId);
      if (externalAbort) opts.externalSignal?.removeEventListener("abort", externalAbort);
    }
  };

  return deadline;
}
