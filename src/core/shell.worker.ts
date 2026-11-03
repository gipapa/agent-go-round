import { remoteShellFileSystem, type ShellFsMethod } from "./shell-rpc";
import { runShellScript } from "./shell-execution";

const scope = self as unknown as { onmessage: (event: MessageEvent) => void; postMessage(message: unknown): void };
let nextId = 0, started = false, runId = "";
const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
scope.onmessage = ({ data }) => {
  if (data?.type === "rpc-result" && data.runId === runId) {
    const call = pending.get(data.id); if (!call) return;
    pending.delete(data.id);
    if (data.error) call.reject(new Error(data.error)); else call.resolve(data.result);
  } else if (data?.type === "run" && !started) {
    started = true; runId = data.runId;
    const rpc = (method: ShellFsMethod, args: unknown[]) => new Promise((resolve, reject) => {
      const id = ++nextId; pending.set(id, { resolve, reject }); scope.postMessage({ type: "rpc", runId, id, method, args });
    });
    void runShellScript(data.script, remoteShellFileSystem(rpc), data.options).then(
      result => scope.postMessage({ type: "done", runId, result }),
      error => scope.postMessage({ type: "error", runId, error: error instanceof Error ? error.message : String(error) })
    );
  }
};
scope.postMessage({ type: "ready", origin: self.location.origin, hasDocument: typeof document !== "undefined" });
