import { FILE_METHODS, type BinCapability } from "./file-capabilities";
import { randomUUID } from "./random";

export type FileRpc = (method: BinCapability, args: unknown[]) => Promise<unknown>;
export interface BinExecutor {
  execute(source: string, args: unknown, rpc: FileRpc, signal?: AbortSignal): Promise<unknown>;
}

// Serialized into an opaque-origin iframe. It has no access to the app's DOM/storage.
function sandboxBootstrap(): void {
  window.addEventListener("message", (event: MessageEvent) => {
    if (event.source !== parent || !event.ports[0] || event.data?.type !== "start") return;
    const port = event.ports[0];
    const url = URL.createObjectURL(new Blob([event.data.program], { type: "text/javascript" }));
    const worker = new Worker(url);
    URL.revokeObjectURL(url);
    worker.onmessage = (message: MessageEvent) => port.postMessage(message.data);
    worker.onerror = (error: ErrorEvent) => port.postMessage({ type: "error", error: error.message || "Tool worker failed" });
    port.onmessage = (message: MessageEvent) => worker.postMessage(message.data);
    port.start();
  }, { once: true });
}

// Runs in the worker; the only host capabilities are bounded filesystem RPCs.
function workerBootstrap(main: (args: unknown, api: unknown) => Promise<unknown>, args: unknown, methods: readonly string[]): void {
  let nextId = 0;
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  self.onmessage = (event: MessageEvent) => {
    const message = event.data;
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error)); else request.resolve(message.result);
  };
  const call = (method: string, values: unknown[]) => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    self.postMessage({ type: "fs", id, method, args: values });
  });
  const fs = Object.fromEntries(methods.map((method) => [method, (...values: unknown[]) => call(method, values)]));
  const skills = Object.freeze({ load: (name: string) => call("loadSkill", [name]) });
  const host = Object.freeze({ readPage: (options: unknown) => call("readHostPage", [options]) });
  const tools = Object.freeze({ help: (command?: string) => call("commandHelp", [command]), reload: () => call("reloadTools", []) });
  const workspace = Object.freeze({ home: () => call("home", []), reset: () => call("resetWorkspace", []) });
  const agents = Object.freeze({ execute: (options: unknown) => call("tabAgents", [options]) });
  Promise.resolve().then(() => main(args, Object.freeze({ fs: Object.freeze(fs), skills, host, tools, workspace, agents }))).then(
    (result) => self.postMessage({ type: "done", result }),
    (error) => self.postMessage({ type: "error", error: error instanceof Error ? error.message : String(error) })
  );
}

/** A sandboxed iframe creates a terminable Worker; CSP blocks network and imports. */
export class SandboxedBinExecutor implements BinExecutor {
  constructor(private readonly timeoutMs = 10_000) {}
  execute(source: string, args: unknown, rpc: FileRpc, signal?: AbortSignal): Promise<unknown> {
    if (signal?.aborted) return Promise.reject(new Error("Tool cancelled"));
    return new Promise((resolve, reject) => {
      const iframe = document.createElement("iframe");
      iframe.hidden = true;
      iframe.setAttribute("sandbox", "allow-scripts");
      iframe.setAttribute("aria-hidden", "true");
      const nonce = randomUUID().replaceAll("-", "");
      // No allow-same-origin: scripts cannot access the app's IndexedDB or credentials.
      iframe.srcdoc = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; worker-src blob:; connect-src 'none'"><script nonce="${nonce}">(${sandboxBootstrap.toString()})();<\/script>`;
      const channel = new MessageChannel();
      let active = true;
      let calls = 0;
      let inFlight = 0;
      let completed = false;
      let completedResult: unknown;
      const finish = (error?: Error, result?: unknown): void => {
        if (!active) return;
        active = false;
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        channel.port1.close();
        iframe.remove();
        if (error) reject(error); else resolve(result);
      };
      const abort = (): void => finish(new Error("Tool cancelled"));
      const timer = setTimeout(() => finish(new Error("Tool exceeded execution deadline")), this.timeoutMs);
      signal?.addEventListener("abort", abort, { once: true });
      channel.port1.onmessage = (event: MessageEvent) => {
        if (!active) return;
        const message = event.data;
        if (!message || typeof message !== "object") { finish(new Error("Invalid worker message")); return; }
        if (message.type === "done") {
          try {
            if (JSON.stringify(message.result ?? null).length > 128_000) throw new Error("Tool result exceeds 128000 characters; request a smaller range");
            completed = true;
            completedResult = message.result;
            if (!inFlight) finish(undefined, completedResult);
          } catch (error) { finish(error instanceof Error ? error : new Error(String(error))); }
        } else if (message.type === "error") finish(new Error(String(message.error).slice(0, 2000)));
        else if (message.type === "fs") {
          if (completed) return;
          if (++calls > 8192) { finish(new Error("Tool filesystem call limit exceeded")); return; }
          inFlight++;
          void (async () => {
            try {
              const result = await rpc(message.method, message.args);
              if (active) channel.port1.postMessage({ id: message.id, result });
            } catch (error) {
              if (active) channel.port1.postMessage({ id: message.id, error: error instanceof Error ? error.message : String(error) });
            } finally {
              inFlight--;
              if (completed && !inFlight && active) finish(undefined, completedResult);
            }
          })();
        }
      };
      iframe.addEventListener("load", () => {
        if (!active) return;
        const program = `const main = (${source}); (${workerBootstrap.toString()})(main, ${JSON.stringify(args)}, ${JSON.stringify(FILE_METHODS)});`;
        iframe.contentWindow?.postMessage({ type: "start", program }, "*", [channel.port2]);
      }, { once: true });
      document.body.append(iframe);
    });
  }
}
