import { AgentAdapter, ChatEvent, ChatRequest } from "./base";
import { DEFAULT_FETCH_TIMEOUT_MS, getAbortSignalMessage, getErrorMessage } from "../utils/fetchWithTimeout";

type ChromePromptSession = {
  promptStreaming: (prompt: string) => AsyncIterable<unknown> | Promise<AsyncIterable<unknown>>;
  destroy?: () => void;
};

type ChromePromptLanguageModel = {
  create: (options: { temperature: number; topK: number }) => Promise<ChromePromptSession>;
};

declare global {
  interface Window {
    ai?: {
      languageModel?: ChromePromptLanguageModel;
    };
  }
}

function renderHistory(history: { role: string; content: string }[]) {
  // MVP: flatten history into a text context.
  return history.map((m) => `${m.role.toUpperCase()}: ${m.content}`).join("\n");
}

function createPromptAbortGuard(externalSignal: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof globalThis.setTimeout> | null = null;
  let removeExternalAbort: (() => void) | null = null;

  const abort = (reason: unknown) => {
    try {
      controller.abort(reason);
    } catch {
      controller.abort();
    }
  };

  if (externalSignal?.aborted) {
    abort(externalSignal.reason || new Error("request aborted"));
  } else if (externalSignal) {
    const onAbort = () => abort(externalSignal.reason || new Error("request aborted"));
    externalSignal.addEventListener("abort", onAbort, { once: true });
    removeExternalAbort = () => externalSignal.removeEventListener("abort", onAbort);
  }

  if (Number.isFinite(timeoutMs) && timeoutMs > 0 && !controller.signal.aborted) {
    timeoutId = globalThis.setTimeout(() => {
      abort(new Error(`Prompt API timeout after ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);
  }

  const dispose = () => {
    if (timeoutId !== null) globalThis.clearTimeout(timeoutId);
    removeExternalAbort?.();
  };

  return { signal: controller.signal, dispose };
}

function throwIfAborted(signal: AbortSignal) {
  if (signal.aborted) throw new Error(getAbortSignalMessage(signal));
}

async function raceWithAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  throwIfAborted(signal);
  return await new Promise<T>((resolve, reject) => {
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    const onAbort = () => {
      cleanup();
      reject(new Error(getAbortSignalMessage(signal)));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error) => {
        cleanup();
        reject(error);
      }
    );
  });
}

export const ChromePromptAdapter: AgentAdapter = {
  async *chat(req: ChatRequest): AsyncGenerator<ChatEvent> {
    if (!window.ai?.languageModel) {
      yield { type: "done", text: "Chrome Prompt API not available in this browser/profile." };
      return;
    }

    const context = renderHistory(req.history.filter((h) => h.role !== "tool").map((h) => ({ role: h.role, content: h.content })));
    const system = req.system?.trim() ? `SYSTEM:\n${req.system.trim()}\n\n` : "";
    const prompt = `${system}${context ? `HISTORY:\n${context}\n\n` : ""}USER:\n${req.input}`;
    const guard = createPromptAbortGuard(req.signal, req.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS);
    let session: ChromePromptSession | undefined;

    try {
      session = await raceWithAbort(
        window.ai.languageModel.create({
          temperature: 0.7,
          topK: 40
        }),
        guard.signal
      );

      const stream = await raceWithAbort(Promise.resolve(session.promptStreaming(prompt)), guard.signal);
      const iterator = stream[Symbol.asyncIterator]() as AsyncIterator<unknown, undefined, unknown>;
      let full = "";
      while (true) {
        const result = await raceWithAbort<IteratorResult<unknown, undefined>>(iterator.next(), guard.signal);
        if (result.done) break;
        const chunk = String(result.value ?? "");
        full += chunk;
        if (chunk) yield { type: "delta", text: chunk };
      }
      yield { type: "done", text: full };
    } catch (error) {
      yield { type: "done", text: `Request failed: ${getErrorMessage(error)}` };
    } finally {
      guard.dispose();
      session?.destroy?.();
    }
  }
};
