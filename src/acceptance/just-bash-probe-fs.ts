import type { IFileSystem } from "just-bash/browser";
import type { VirtualFileSystem } from "../core/fs";
import { JustBashFileSystem } from "../core/just-bash-fs";

export type ProbeRpc = (method: string, args: unknown[]) => Promise<unknown>;
const METHODS = ["readFile", "readFileBuffer", "writeFile", "appendFile", "exists", "stat", "lstat", "mkdir", "readdir", "readdirWithFileTypes", "rm", "cp", "mv", "chmod", "symlink", "link", "readlink", "realpath", "utimes", "createExclusive"];

/** Remote facade; contents are never copied into a worker-owned tree. */
export function probeFileSystem(rpc: ProbeRpc): IFileSystem {
  return new Proxy({
    resolvePath: (base: string, path: string) => {
      const parts: string[] = [];
      for (const part of (path.startsWith("/") ? path : `${base}/${path}`).split("/")) {
        if (part === "..") parts.pop(); else if (part && part !== ".") parts.push(part);
      }
      return "/" + parts.join("/");
    },
    // P0 measures whether ordinary glob traversal needs a synchronous index.
    getAllPaths: () => []
  }, {
    get(target, key) {
      if (key in target) return Reflect.get(target, key);
      if (typeof key === "string" && METHODS.includes(key)) return (...args: unknown[]) => rpc(key, args);
      return undefined;
    }
  }) as unknown as IFileSystem;
}

/** RPC is bound to one host VFS; a worker cannot select another workspace. */
export async function executeProbeRpc(fs: VirtualFileSystem, method: string, args: unknown[]): Promise<unknown> {
  if (!METHODS.includes(method) || !Array.isArray(args) || typeof args[0] !== "string") throw new Error("EINVAL: Invalid probe filesystem request");
  const adapter = new JustBashFileSystem(fs);
  return Reflect.get(adapter, method).apply(adapter, args);
}
