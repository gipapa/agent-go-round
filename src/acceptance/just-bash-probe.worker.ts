import { Bash, InMemoryFs } from "just-bash/browser";
import { probeFileSystem } from "./just-bash-probe-fs";
import { mountShellFileSystem } from "../core/shell-filesystem";

const scope = self as unknown as { onmessage: ((event: MessageEvent) => void) | null; postMessage(message: unknown): void };
let nextId = 0;
const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
scope.postMessage({ type: "ready" });
scope.onmessage = async ({ data }) => {
  if (data.type === "rpc-result") {
    const call = pending.get(data.id); if (!call) return;
    pending.delete(data.id);
    if (data.error) call.reject(new Error(data.error)); else call.resolve(data.result);
    return;
  }
  if (data.type !== "run") return;
  try {
    const calls: string[] = [];
    const root = new InMemoryFs();
    let fs = root as import("just-bash/browser").IFileSystem;
    if (data.storage === "indexeddb") {
      fs = mountShellFileSystem(probeFileSystem((method, args) => {
        calls.push(method);
        const id = ++nextId;
        return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); scope.postMessage({ type: "rpc", id, method, args }); });
      }));
    }
    const bash = new Bash({ fs, cwd: data.cwd || "/home/user", env: { HOME: "/home/user" }, executionLimits: {
      maxSourceBytes: 64_000, maxOutputSize: data.outputLimit || 128_000, maxCommandCount: data.steps || 10_000,
      maxLoopIterations: data.steps || 10_000, maxExecutionTimeMs: data.timeoutMs || 15_000,
      maxLiveBytes: 32 * 1024 * 1024
    } });
    const result = await bash.exec(data.script, { rawScript: true });
    scope.postMessage({ type: "done", result: { ...result, initialCwd: bash.getCwd(), calls } });
  } catch (error) { scope.postMessage({ type: "error", error: error instanceof Error ? error.message : String(error) }); }
};
