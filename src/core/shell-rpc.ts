import type { IFileSystem } from "just-bash/browser";
import { JustBashFileSystem } from "./just-bash-fs";
import { resolvePath } from "./fs";

export const SHELL_FS_METHODS = ["readFile", "readFileBuffer", "writeFile", "appendFile", "exists", "stat", "lstat", "mkdir", "readdir", "readdirWithFileTypes", "rm", "cp", "mv", "chmod", "symlink", "link", "readlink", "realpath", "utimes", "createExclusive"] as const;
export type ShellFsMethod = typeof SHELL_FS_METHODS[number];
export type ShellRpc = (method: ShellFsMethod, args: unknown[]) => Promise<unknown>;
const encodings = ["utf8", "utf-8", "ascii", "binary", "base64", "hex", "latin1"];
const path = (value: unknown): value is string => typeof value === "string" && value.startsWith("/") && value.length <= 4096 && !value.includes("\0");
export function remoteShellFileSystem(rpc: ShellRpc): IFileSystem {
  return new Proxy({ resolvePath: (base: string, value: string) => resolvePath(value, base), getAllPaths: () => [] as string[] }, {
    get(target, key) {
      if (Object.hasOwn(target, key)) return Reflect.get(target, key);
      if (SHELL_FS_METHODS.includes(key as ShellFsMethod)) return (...args: unknown[]) => rpc(key as ShellFsMethod, args);
    }
  }) as unknown as IFileSystem;
}

/** Validate every incoming capability request in the host. Identity and liveness
 * are checked by ShellRuntime before this bound adapter can be reached.
 */
export async function executeShellRpc(adapter: JustBashFileSystem, method: unknown, args: unknown): Promise<unknown> {
  if (!SHELL_FS_METHODS.includes(method as ShellFsMethod) || !Array.isArray(args) || typeof args[0] !== "string" || !args[0] || args[0].length > 4096 || args[0].includes("\0") || method !== "symlink" && !path(args[0]) || args.length > 3) throw new Error("EINVAL: Invalid shell filesystem request");
  const name = method as ShellFsMethod;
  const options = (value: unknown, keys: string[]) => {
    if (value === undefined) return;
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) throw new Error("EINVAL: Invalid filesystem options");
    for (const key of keys) {
      const field = (value as Record<string, unknown>)[key];
      if (field !== undefined && (key === "mode" ? !Number.isInteger(field) || (field as number) < 0 || (field as number) > 0o7777 : typeof field !== "boolean")) throw new Error("EINVAL: Invalid filesystem option");
    }
  };
  const checkEncoding = (value: unknown) => {
    if (value === undefined) return;
    const format = typeof value === "string" ? value : value && typeof value === "object" && Object.keys(value).every(key => key === "encoding") ? (value as { encoding?: unknown }).encoding : false;
    if (format !== undefined && format !== null && !encodings.includes(format as string)) throw new Error("EINVAL: Invalid encoding");
  };
  if (name === "writeFile" || name === "appendFile") {
    if (!(typeof args[1] === "string" || args[1] instanceof Uint8Array) || args[1].length > 1024 * 1024) throw new Error("EINVAL: Invalid filesystem content");
    checkEncoding(args[2]);
  } else if (name === "readFile") checkEncoding(args[1]);
  else if (name === "cp" || name === "mv" || name === "link") { if (!path(args[1])) throw new Error("EINVAL: Invalid destination"); if (name === "cp") options(args[2], ["recursive"]); }
  else if (name === "symlink") { if (!path(args[1])) throw new Error("EINVAL: Invalid symlink path"); } // target can be relative; checked below
  else if (name === "mkdir") options(args[1], ["recursive"]);
  else if (name === "rm") options(args[1], ["recursive", "force"]);
  else if (name === "createExclusive") { if (!args[1] || typeof args[1] !== "object" || !("mode" in args[1])) throw new Error("EINVAL: Missing exclusive creation mode"); options(args[1], ["mode", "directory"]); }
  else if (name === "chmod") { if (!Number.isInteger(args[1]) || (args[1] as number) < 0 || (args[1] as number) > 0o7777) throw new Error("EINVAL: Invalid mode"); }
  else if (name === "utimes") { if (!args.slice(1).every(value => value instanceof Date && Number.isFinite(value.getTime())) || args.length !== 3) throw new Error("EINVAL: Invalid times"); }
  return Reflect.apply(Reflect.get(adapter, name), adapter, args);
}
