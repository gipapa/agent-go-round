import { BuiltInToolConfig } from "../types";
import type { ToolDashboardHelpers } from "./toolDashboard";
import { combineSignals, getDeadlineAbortMessage, withTimeout } from "./deadline";
import { errorMessage } from "./errors";

export const DEFAULT_BUILT_IN_TOOL_TIMEOUT_MS = 10_000;

export type BuiltInToolHelpers = {
  system?: {
    get_user_profile?: () => Promise<unknown> | unknown;
    pick_best_agent_for_question?: (question: string) => Promise<string> | string;
    request_user_confirmation?: (message: string) => Promise<unknown> | unknown;
  };
  ui?: {
    dashboard?: ToolDashboardHelpers;
  };
};

export type BuiltInToolRunOptions = {
  timeoutMs?: number;
  signal?: AbortSignal;
  sandbox?: "auto" | "worker" | "inline";
};

type HelperCallMessage = {
  type: "helper_call";
  id: string;
  path: string;
  args: unknown[];
};

type WorkerResultMessage =
  | { type: "result"; ok: true; result: unknown }
  | { type: "result"; ok: false; error: string }
  | HelperCallMessage;

const INLINE_REQUIRED_PATTERN =
  /\b(?:window|document|alert|confirm|prompt|localStorage|sessionStorage|indexedDB|navigator|dashboard)\b/;

function createRunner(code: string) {
  return new Function(
    "input",
    "helpers",
    `
      "use strict";
      const system = helpers.system ?? {};
      const ui = helpers.ui ?? {};
      const pick_best_agent_for_question = system.pick_best_agent_for_question;
      const get_user_profile = system.get_user_profile;
      const request_user_confirmation = system.request_user_confirmation;
      const dashboard = ui.dashboard;
      return (async () => {
        ${code}
      })();
    `
  ) as (input: unknown, helpers: BuiltInToolHelpers) => Promise<unknown> | unknown;
}

function canUseWorker() {
  return (
    typeof Worker !== "undefined" &&
    typeof Blob !== "undefined" &&
    typeof URL !== "undefined" &&
    typeof URL.createObjectURL === "function"
  );
}

function shouldUseInline(code: string, sandbox: BuiltInToolRunOptions["sandbox"]) {
  if (sandbox === "inline") return true;
  if (sandbox === "worker") return false;
  return INLINE_REQUIRED_PATTERN.test(code);
}

function collectHelperPaths(helpers: BuiltInToolHelpers) {
  const paths: string[] = [];
  if (helpers.system?.get_user_profile) paths.push("system.get_user_profile");
  if (helpers.system?.pick_best_agent_for_question) paths.push("system.pick_best_agent_for_question");
  if (helpers.system?.request_user_confirmation) paths.push("system.request_user_confirmation");
  return paths;
}

function resolveHelperFunction(helpers: BuiltInToolHelpers, path: string) {
  if (path === "system.get_user_profile") return helpers.system?.get_user_profile;
  if (path === "system.pick_best_agent_for_question") return helpers.system?.pick_best_agent_for_question;
  if (path === "system.request_user_confirmation") return helpers.system?.request_user_confirmation;
  return undefined;
}

function buildWorkerSource() {
  return `
const blockedGlobals = [
  "window",
  "document",
  "localStorage",
  "sessionStorage",
  "indexedDB",
  "XMLHttpRequest",
  "WebSocket",
  "EventSource",
  "Worker",
  "SharedWorker",
  "importScripts",
  "fetch"
];

for (const key of blockedGlobals) {
  try {
    Object.defineProperty(globalThis, key, { value: undefined, writable: false, configurable: true });
  } catch (_) {
    try { globalThis[key] = undefined; } catch (_) {}
  }
}

let helperSeq = 0;
const pendingHelpers = new Map();

function callHelper(path, args) {
  const id = String(++helperSeq);
  self.postMessage({ type: "helper_call", id, path, args });
  return new Promise((resolve, reject) => {
    pendingHelpers.set(id, { resolve, reject });
  });
}

function assignPath(root, path) {
  const parts = path.split(".");
  let target = root;
  for (let index = 0; index < parts.length - 1; index += 1) {
    const key = parts[index];
    target[key] = target[key] || {};
    target = target[key];
  }
  target[parts[parts.length - 1]] = (...args) => callHelper(path, args);
}

function createHelpers(paths) {
  const helpers = {};
  for (const path of paths) assignPath(helpers, path);
  return helpers;
}

function createRunner(code) {
  return new Function(
    "input",
    "helpers",
    '"use strict";\\n' +
      'const system = helpers.system ?? {};\\n' +
      'const ui = helpers.ui ?? {};\\n' +
      'const pick_best_agent_for_question = system.pick_best_agent_for_question;\\n' +
      'const get_user_profile = system.get_user_profile;\\n' +
      'const request_user_confirmation = system.request_user_confirmation;\\n' +
      'const dashboard = ui.dashboard;\\n' +
      'return (async () => {\\n' + code + '\\n})();'
  );
}

self.onmessage = async (event) => {
  const message = event.data || {};
  if (message.type === "helper_result") {
    const pending = pendingHelpers.get(message.id);
    if (!pending) return;
    pendingHelpers.delete(message.id);
    if (message.ok) pending.resolve(message.result);
    else pending.reject(new Error(message.error || "helper failed"));
    return;
  }

  if (message.type !== "run") return;

  try {
    const helpers = createHelpers(message.helperPaths || []);
    const runner = createRunner(String(message.code || ""));
    const result = await runner(message.input, helpers);
    self.postMessage({ type: "result", ok: true, result });
  } catch (error) {
    self.postMessage({ type: "result", ok: false, error: error && error.message ? error.message : String(error) });
  }
};
`;
}

async function runInline(
  tool: Pick<BuiltInToolConfig, "code">,
  input: unknown,
  helpers: BuiltInToolHelpers,
  options: Required<Pick<BuiltInToolRunOptions, "timeoutMs">> & Pick<BuiltInToolRunOptions, "signal">
) {
  const runner = createRunner(tool.code);
  return await withTimeout(Promise.resolve(runner(input, helpers)), options.timeoutMs, "Built-in tool execution", options.signal);
}

async function runInWorker(
  tool: Pick<BuiltInToolConfig, "code">,
  input: unknown,
  helpers: BuiltInToolHelpers,
  options: Required<Pick<BuiltInToolRunOptions, "timeoutMs">> & Pick<BuiltInToolRunOptions, "signal">
) {
  if (!canUseWorker()) {
    return await runInline(tool, input, helpers, options);
  }

  const blob = new Blob([buildWorkerSource()], { type: "text/javascript" });
  const url = URL.createObjectURL(blob);
  const worker = new Worker(url);
  const helperPaths = collectHelperPaths(helpers);

  let timeoutId: ReturnType<typeof globalThis.setTimeout> | null = null;
  let onAbort: (() => void) | undefined;

  try {
    return await new Promise<unknown>((resolve, reject) => {
      const cleanup = () => {
        if (timeoutId !== null) globalThis.clearTimeout(timeoutId);
        if (onAbort) options.signal?.removeEventListener("abort", onAbort);
        worker.terminate();
        URL.revokeObjectURL(url);
      };

      const fail = (error: unknown) => {
        cleanup();
        reject(error instanceof Error ? error : new Error(String(error)));
      };

      if (options.signal?.aborted) {
        fail(new Error(getDeadlineAbortMessage(options.signal)));
        return;
      }

      timeoutId = globalThis.setTimeout(() => {
        fail(new Error(`Built-in tool execution timed out after ${Math.round(options.timeoutMs / 1000)}s`));
      }, options.timeoutMs);

      onAbort = () => fail(new Error(getDeadlineAbortMessage(options.signal)));
      options.signal?.addEventListener("abort", onAbort, { once: true });

      worker.onerror = (event) => {
        fail(new Error(event.message || "Built-in tool worker failed."));
      };

      worker.onmessage = (event: MessageEvent<WorkerResultMessage>) => {
        const message = event.data;
        if (message.type === "helper_call") {
          const helper = resolveHelperFunction(helpers, message.path);
          if (!helper) {
            worker.postMessage({ type: "helper_result", id: message.id, ok: false, error: `Helper not allowed: ${message.path}` });
            return;
          }
          Promise.resolve()
            .then(() => (helper as (...args: unknown[]) => unknown)(...message.args))
            .then((result) => worker.postMessage({ type: "helper_result", id: message.id, ok: true, result }))
            .catch((error) =>
              worker.postMessage({ type: "helper_result", id: message.id, ok: false, error: errorMessage(error) })
            );
          return;
        }

        if (message.ok) {
          cleanup();
          resolve(message.result);
          return;
        }
        fail(new Error(message.error));
      };

      try {
        worker.postMessage({
          type: "run",
          code: tool.code,
          input,
          helperPaths
        });
      } catch (error) {
        fail(error);
      }
    });
  } catch (error) {
    worker.terminate();
    URL.revokeObjectURL(url);
    throw error;
  }
}

export async function runBuiltInScriptTool(
  tool: Pick<BuiltInToolConfig, "code">,
  input: unknown,
  helpers: BuiltInToolHelpers = {},
  options: BuiltInToolRunOptions = {}
) {
  const timeoutMs = Math.max(1, Math.round(options.timeoutMs ?? DEFAULT_BUILT_IN_TOOL_TIMEOUT_MS));
  const signal = options.signal ? combineSignals(options.signal) : undefined;

  if (shouldUseInline(tool.code, options.sandbox)) {
    return await runInline(tool, input, helpers, { timeoutMs, signal });
  }

  return await runInWorker(tool, input, helpers, { timeoutMs, signal });
}
