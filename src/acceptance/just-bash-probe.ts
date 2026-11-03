import { FileSystemError, IndexedDbFileSystem } from "../core/fs";
import { executeProbeRpc } from "./just-bash-probe-fs";

type ProbeOptions = { script: string; storage?: "memory" | "indexeddb"; cwd?: string; timeoutMs?: number; steps?: number; outputLimit?: number };
type ProbeResult = { stdout: string; stderr: string; exitCode: number; env: Record<string, string>; initialCwd: string; calls: string[] };
const workspace = new URL(location.href).searchParams.get("workspace") || "just-bash-p0";
const fs = new IndexedDbFileSystem(indexedDB, workspace);
let stop: (() => void) | undefined;

async function run(options: ProbeOptions): Promise<ProbeResult> {
  if (stop) throw new Error("Probe already running");
  await fs.mkdir("~", { recursive: true });
  await fs.mkdir("/usr", { recursive: true });
  await fs.mkdir("/tmp", { recursive: true });
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./just-bash-probe.worker.ts", import.meta.url), { type: "module" });
    let active = true;
    const finish = (error?: Error, result?: ProbeResult) => {
      if (!active) return;
      active = false; clearTimeout(timer); worker.terminate(); stop = undefined;
      if (error) reject(error); else resolve(result!);
    };
    stop = () => finish(new Error("Probe cancelled; committed writes may remain"));
    let timer = setTimeout(() => finish(new Error("Probe Worker startup deadline exceeded")), 30_000);
    worker.onerror = event => finish(new Error(event.message));
    worker.onmessage = ({ data }) => {
      if (!active) return;
      if (data.type === "ready") {
        clearTimeout(timer);
        timer = setTimeout(() => finish(new Error("Probe host execution deadline exceeded")), (options.timeoutMs ?? 15_000) + 1000);
        worker.postMessage({ type: "run", ...options, timeoutMs: options.timeoutMs ?? 15_000 });
      } else if (data.type === "done") finish(undefined, data.result);
      else if (data.type === "error") finish(new Error(data.error));
      else if (data.type === "rpc") {
        void executeProbeRpc(fs, data.method, data.args).then(
          result => { if (active) worker.postMessage({ type: "rpc-result", id: data.id, result }); },
          error => {
            const codes: Record<string, string> = { not_found: "ENOENT", wrong_kind: "ENOTDIR", not_empty: "ENOTEMPTY", conflict: "EEXIST", quota: "ENOSPC" };
            if (active) worker.postMessage({ type: "rpc-result", id: data.id, error: error instanceof FileSystemError ? `${codes[error.code] || error.code}: ${error.message}` : error instanceof Error ? error.message : String(error) });
          }
        );
      }
    };
  });
}

const api = {
  run, stop: () => stop?.(), read: async (path: string) => (await fs.readFile(path)).content,
  bytes: {
    write: (path: string, data: number[]) => fs.writeBytes(path, new Uint8Array(data)),
    append: (path: string, data: number[]) => fs.appendBytes(path, new Uint8Array(data)),
    read: async (path: string) => Array.from((await fs.readBytes(path)).content),
    stat: (path: string) => fs.stat(path),
    exclusive: (path: string) => fs.createExclusive(path, { mode: 0o600 }),
    verifyQuota: async () => {
      let quota = false, rolledBack = false;
      try { await fs.writeByteFiles(Array.from({ length: 32 }, (_, index) => ({ path: `~/quota-${index}`, content: new Uint8Array(512 * 1024) }))); }
      catch (error) { if (error instanceof FileSystemError && error.code === "quota") quota = true; else throw error; }
      try { await fs.stat("~/quota-0"); }
      catch (error) { if (error instanceof FileSystemError && error.code === "not_found") rolledBack = true; else throw error; }
      return { quota, rolledBack };
    }
  }
};
Object.assign(window, { justBashProbe: api });
document.querySelector("form")!.addEventListener("submit", event => {
  event.preventDefault();
  const script = document.querySelector("textarea")!.value;
  void run({ script, storage: "indexeddb" }).then(result => { document.querySelector("pre")!.textContent = JSON.stringify(result, null, 2); }, error => { document.querySelector("pre")!.textContent = error.message; });
});
document.querySelector("#stop")!.addEventListener("click", api.stop);
document.querySelector("#status")!.textContent = "ready";
