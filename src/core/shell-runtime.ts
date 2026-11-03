import { randomUUID } from "./random";
import { JustBashFileSystem } from "./just-bash-fs";
import { executeShellRpc, type ShellFsMethod } from "./shell-rpc";
import { SHELL_LIMITS, shellOptions, type ShellOptions, type ShellResult } from "./shell-protocol";
import type { FileAccess, VirtualFileSystem } from "./fs";

export type ShellIdentity = { workspaceId: string; tabId: string; kind: "human" | "agent"; sessionId?: string };
export type ShellAccess = FileAccess;
export class ShellExecutionError extends Error {
  constructor(readonly code: "aborted" | "deadline" | "error" | "outcome_unknown", message: string) { super(message); this.name = "ShellExecutionError"; }
}
export interface ShellExecutor { execute(script: string, options: ShellOptions & { signal?: AbortSignal; onAccess?: (access: ShellAccess) => void }): Promise<ShellResult> }

function sandboxBootstrap(): void {
  window.addEventListener("message", (event: MessageEvent) => {
    if (event.source !== parent || event.data?.type !== "start" || !event.ports[0]) return;
    const port = event.ports[0];
    const url = URL.createObjectURL(new Blob([event.data.program], { type: "text/javascript" }));
    const worker = new Worker(url); URL.revokeObjectURL(url);
    worker.onmessage = event => port.postMessage(event.data);
    worker.onerror = event => port.postMessage({ type: "bootstrap-error", error: event.message || "Shell worker failed" });
    port.onmessage = event => {
      if (event.data?.type === "terminate") { worker.terminate(); port.close(); }
      else worker.postMessage(event.data);
    };
    port.start();
  }, { once: true });
}
const MUTATIONS = new Set<ShellFsMethod>(["writeFile", "appendFile", "mkdir", "rm", "cp", "mv", "chmod", "symlink", "link", "utimes", "createExclusive"]);
let program: Promise<string> | undefined;
const workerProgram = () => program ??= import("virtual:agent-go-round-shell-worker").then(module => module.default).catch(error => { program = undefined; throw error; });
function prepare<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    let active = true;
    const finish = (error?: unknown, result?: T) => {
      if (!active) return;
      active = false; clearTimeout(timer); signal?.removeEventListener("abort", abort);
      if (error) reject(error); else resolve(result!);
    };
    const abort = () => finish(new ShellExecutionError("aborted", "Shell cancelled before execution"));
    const timer = setTimeout(() => finish(new ShellExecutionError("deadline", "Shell preparation deadline exceeded")), 30_000);
    signal?.addEventListener("abort", abort, { once: true });
    promise.then(value => finish(undefined, value), error => finish(error));
    if (signal?.aborted) abort();
  });
}

/** One tab/run owner; each execute starts an independent, terminable script.
 * Filesystem capabilities are bound here, never selected by worker messages.
 */
export class ShellRuntime implements ShellExecutor {
  private running = false;
  readonly identity: Readonly<ShellIdentity>;
  constructor(private readonly fs: VirtualFileSystem, identity: ShellIdentity) { this.identity = Object.freeze({ ...identity }); }
  async execute(script: string, input: ShellOptions & { signal?: AbortSignal; onAccess?: (access: ShellAccess) => void }): Promise<ShellResult> {
    if (typeof document === "undefined") throw new Error("ShellRuntime requires a browser DOM; provide an explicit ShellExecutor in a non-browser harness");
    if (this.running) throw new Error("Shell is already running");
    const options = shellOptions(input);
    if (typeof script !== "string" || new TextEncoder().encode(script).byteLength > SHELL_LIMITS.maxSourceBytes) throw new Error("Shell script exceeds 64000 bytes");
    if (input.signal?.aborted) throw new ShellExecutionError("aborted", "Shell cancelled before execution");
    this.running = true;
    try {
      const seen = new Set<string>(), record = input.onAccess;
      const fs = record ? this.fs.withAccessRecorder(access => {
        const key = JSON.stringify([access.method, access.path, access.revision]);
        if (!seen.has(key)) { seen.add(key); record(access); }
      }) : this.fs;
      const source = await prepare(workerProgram(), input.signal);
      if (input.signal?.aborted) throw new ShellExecutionError("aborted", "Shell cancelled before execution");
      await prepare(fs.mkdir("/usr", { recursive: true }), input.signal);
      if (input.signal?.aborted) throw new ShellExecutionError("aborted", "Shell cancelled before execution");
      await prepare(fs.mkdir("/tmp", { recursive: true }), input.signal);
      if (input.signal?.aborted) throw new ShellExecutionError("aborted", "Shell cancelled before execution");
      return await this.start(script, options, source, fs, input.signal);
    } finally { this.running = false; }
  }
  private start(script: string, options: Required<ShellOptions>, program: string, fs: VirtualFileSystem, signal?: AbortSignal): Promise<ShellResult> {
    return new Promise((resolve, reject) => {
      const runId = randomUUID(), iframe = document.createElement("iframe"), channel = new MessageChannel();
      iframe.hidden = true; iframe.setAttribute("sandbox", "allow-scripts"); iframe.setAttribute("aria-hidden", "true"); iframe.dataset.shellOwner = this.identity.tabId;
      const nonce = randomUUID().replaceAll("-", "");
      iframe.srcdoc = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; worker-src blob:; connect-src 'none'; child-src 'none'"><script nonce="${nonce}">(${sandboxBootstrap.toString()})();<\/script>`;
      let active = true, started = false, mutations = 0, calls = 0, inFlight = 0;
      let done: ShellResult | undefined;
      const requestIds = new Set<number>();
      let timer: ReturnType<typeof setTimeout>;
      const finish = (error?: ShellExecutionError, result?: ShellResult) => {
        if (!active) return;
        active = false; clearTimeout(timer); signal?.removeEventListener("abort", abort);
        channel.port1.postMessage({ type: "terminate" }); channel.port1.close(); iframe.remove();
        if (error) reject(mutations ? new ShellExecutionError("outcome_unknown", `${error.message}. Filesystem mutations may already have committed; read back before retrying.`) : error);
        else resolve(result!);
      };
      const abort = () => finish(new ShellExecutionError("aborted", "Shell cancelled"));
      const adapter = new JustBashFileSystem(fs);
      timer = setTimeout(() => finish(new ShellExecutionError("deadline", "Shell Worker startup deadline exceeded")), 30_000);
      signal?.addEventListener("abort", abort, { once: true });
      channel.port1.onmessage = ({ data }) => {
        if (!active || !data || typeof data !== "object") return;
        if (data.type === "ready" && !started) {
          if (data.origin !== "null" || data.hasDocument !== false) { finish(new ShellExecutionError("error", "Shell Worker isolation was not established")); return; }
          iframe.dataset.shellIsolation = "opaque-worker";
          started = true; clearTimeout(timer);
          timer = setTimeout(() => finish(new ShellExecutionError("deadline", "Shell execution deadline exceeded")), options.timeoutMs + 1000);
          channel.port1.postMessage({ type: "run", runId, owner: this.identity, script, options }); return;
        }
        if (data.type === "bootstrap-error") { finish(new ShellExecutionError("error", String(data.error).slice(0, 2000))); return; }
        if (!started || data.runId !== runId) return;
        if (data.type === "done") {
          const value = data.result as Partial<ShellResult>;
          if (!value || typeof value.stdout !== "string" || typeof value.stderr !== "string" || !Number.isInteger(value.exitCode) || typeof value.cwd !== "string" || !value.cwd.startsWith("/") || value.cwd.includes("\0") || value.cwd.length > 4096 || new TextEncoder().encode(value.stdout + value.stderr).byteLength > options.maxOutputBytes + 4000) { finish(new ShellExecutionError("error", "Invalid shell result")); return; }
          done = value as ShellResult;
          if (!inFlight) finish(undefined, done);
        } else if (data.type === "error") finish(new ShellExecutionError("error", String(data.error).slice(0, 2000)));
        else if (data.type === "rpc" && !done) {
          if (!Number.isInteger(data.id) || requestIds.has(data.id) || ++calls > SHELL_LIMITS.maxRpcCalls) { finish(new ShellExecutionError("error", "Shell filesystem request limit exceeded")); return; }
          requestIds.add(data.id);
          if (MUTATIONS.has(data.method)) mutations++;
          inFlight++;
          void executeShellRpc(adapter, data.method, data.args).then(
            result => { if (active) channel.port1.postMessage({ type: "rpc-result", runId, id: data.id, result }); },
            error => { if (active) channel.port1.postMessage({ type: "rpc-result", runId, id: data.id, error: error instanceof Error ? error.message : String(error) }); }
          ).finally(() => { inFlight--; if (done && !inFlight && active) finish(undefined, done); });
        }
      };
      iframe.addEventListener("load", () => { if (active) iframe.contentWindow?.postMessage({ type: "start", program }, "*", [channel.port2]); }, { once: true });
      document.body.append(iframe);
      if (signal?.aborted) abort();
    });
  }
}
