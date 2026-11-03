import type { BufferEncoding, CpOptions, CreateExclusiveOptions, FileContent, FsStat, IFileSystem, MkdirOptions, RmOptions } from "just-bash/browser";
import { FileSystemError, resolvePath, type FileStat, type VirtualFileSystem } from "./fs";

export const FS_ERROR_CODES: Readonly<Record<string, string>> = {
  not_found: "ENOENT", not_directory: "ENOTDIR", wrong_kind: "EISDIR", exists: "EEXIST",
  not_empty: "ENOTEMPTY", conflict: "EBUSY", quota: "ENOSPC", protected: "EPERM",
  invalid_path: "EINVAL", invalid_mode: "EINVAL", invalid_time: "EINVAL", invalid_revision: "EINVAL",
  invalid_encoding: "EILSEQ", symlink_loop: "ELOOP", is_directory: "EISDIR", storage: "EIO"
};
export function posixError(error: unknown): Error {
  if (error instanceof FileSystemError) return new Error(`${FS_ERROR_CODES[error.code] ?? "EIO"}: ${error.message}`);
  return error instanceof Error ? error : new Error(String(error));
}
export function bashStat(node: FileStat): FsStat {
  return { isFile: node.kind === "file", isDirectory: node.kind === "directory", isSymbolicLink: node.kind === "symlink", mode: node.mode, size: node.size, mtime: new Date(node.mtime) };
}
type EncodingOptions = BufferEncoding | { encoding?: BufferEncoding | null };
function encoding(options?: EncodingOptions): BufferEncoding { return (typeof options === "string" ? options : options?.encoding) || "utf8"; }
function binaryString(bytes: Uint8Array): string {
  let value = "";
  for (let offset = 0; offset < bytes.length; offset += 8192) value += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return value;
}
export function decodeFileBytes(bytes: Uint8Array, options?: EncodingOptions): string {
  switch (encoding(options)) {
    case "utf8": case "utf-8":
      try { return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); }
      catch { throw new Error("EILSEQ: File is not valid UTF-8; use raw bytes or an explicit encoding"); }
    case "binary": case "latin1": return binaryString(bytes);
    case "ascii": return binaryString(bytes.map(byte => byte & 0x7f));
    case "base64": return btoa(binaryString(bytes));
    case "hex": return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
    default: throw new Error("EINVAL: Unsupported file encoding");
  }
}
export function encodeFileBytes(content: FileContent, options?: EncodingOptions): Uint8Array {
  if (content instanceof Uint8Array) return content.slice();
  if (typeof content !== "string") throw new Error("EINVAL: Expected string or Uint8Array");
  switch (encoding(options)) {
    case "utf8": case "utf-8": return new TextEncoder().encode(content);
    case "binary": case "latin1": case "ascii": {
      const bytes = new Uint8Array(content.length);
      for (let i = 0; i < content.length; i++) bytes[i] = content.charCodeAt(i) & 255;
      return bytes;
    }
    case "base64": {
      try {
        // Buffer-compatible URL alphabet, whitespace and optional padding.
        const text = content.replace(/\s/g, "").replace(/-/g, "+").replace(/_/g, "/");
        return Uint8Array.from(atob(text), char => char.charCodeAt(0));
      } catch { throw new Error("EINVAL: Invalid base64 file content"); }
    }
    case "hex": {
      if (content.length % 2 || !/^[0-9a-f]*$/i.test(content)) throw new Error("EINVAL: Invalid hex file content");
      return Uint8Array.from(content.match(/../g) ?? [], pair => Number.parseInt(pair, 16));
    }
    default: throw new Error("EINVAL: Unsupported file encoding");
  }
}

/** All contents stay in the workspace VFS. No second tree or end-of-script sync. */
export class JustBashFileSystem implements IFileSystem {
  constructor(readonly vfs: VirtualFileSystem, private readonly onAccess?: (method: string, path: string, revision?: number) => void) {}
  private async call<T>(operation: () => Promise<T>): Promise<T> { try { return await operation(); } catch (error) { throw posixError(error); } }
  readFile(path: string, options?: EncodingOptions): Promise<string> { return this.readFileBuffer(path).then(bytes => decodeFileBytes(bytes, options)); }
  readFileBuffer(path: string): Promise<Uint8Array> {
    return this.call(async () => { const file = await this.vfs.readBytes(path); this.onAccess?.("readBytes", file.path, file.revision); return file.content; });
  }
  writeFile(path: string, content: FileContent, options?: EncodingOptions): Promise<void> {
    return this.call(async () => { const file = await this.vfs.writeBytes(path, encodeFileBytes(content, options)); this.onAccess?.("writeBytes", file.path, file.revision); });
  }
  appendFile(path: string, content: FileContent, options?: EncodingOptions): Promise<void> {
    return this.call(async () => { const file = await this.vfs.appendBytes(path, encodeFileBytes(content, options)); this.onAccess?.("appendBytes", file.path, file.revision); });
  }
  exists(path: string): Promise<boolean> {
    return this.call(async () => {
      try { await this.vfs.stat(path); return true; }
      catch (error) { if (error instanceof FileSystemError && ["not_found", "not_directory"].includes(error.code)) return false; throw error; }
    });
  }
  stat(path: string): Promise<FsStat> { return this.call(async () => bashStat(await this.vfs.stat(path))); }
  lstat(path: string): Promise<FsStat> { return this.call(async () => bashStat(await this.vfs.lstat(path))); }
  mkdir(path: string, options?: MkdirOptions): Promise<void> {
    return this.call(async () => {
      // Nonrecursive mkdir must fail for an existing name, including links.
      if (!options?.recursive) { const file = await this.vfs.createExclusive(path, { mode: 0o755, directory: true }); this.onAccess?.("mkdir", file.path, file.revision); }
      else { const file = await this.vfs.mkdir(path, { recursive: true }); this.onAccess?.("mkdir", file.path, file.revision); }
    });
  }
  createExclusive(path: string, options: CreateExclusiveOptions): Promise<void> {
    return this.call(async () => { const node = await this.vfs.createExclusive(path, options); this.onAccess?.("createExclusive", node.path, node.revision); });
  }
  readdir(path: string): Promise<string[]> { return this.call(async () => (await this.vfs.listDirectory(path)).map(node => node.path.split("/").at(-1)!)); }
  readdirWithFileTypes(path: string) {
    return this.call(async () => (await this.vfs.listDirectory(path)).map(node => ({ name: node.path.split("/").at(-1)!, isFile: node.kind === "file", isDirectory: node.kind === "directory", isSymbolicLink: node.kind === "symlink" })));
  }
  rm(path: string, options?: RmOptions): Promise<void> { return this.call(async () => { await this.vfs.remove(path, options); this.onAccess?.("remove", path); }); }
  cp(source: string, destination: string, options?: CpOptions): Promise<void> { return this.call(async () => { await this.vfs.copy(source, destination, options); this.onAccess?.("copy", destination, (await this.vfs.lstat(destination)).revision); }); }
  mv(source: string, destination: string): Promise<void> { return this.call(async () => { await this.vfs.rename(source, destination, { replace: true }); this.onAccess?.("rename", destination, (await this.vfs.lstat(destination)).revision); }); }
  resolvePath(base: string, path: string): string { return resolvePath(path, base); }
  // In 3.6.0 globbing traverses async readdir/stat. Returning no optional index
  // avoids stale metadata across tabs; the adapter never synchronously reads IDB.
  getAllPaths(): string[] { return []; }
  chmod(path: string, mode: number): Promise<void> { return this.call(async () => { const file = await this.vfs.chmod(path, mode); this.onAccess?.("chmod", file.path, file.revision); }); }
  utimes(path: string, atime: Date, mtime: Date): Promise<void> { return this.call(async () => { const file = await this.vfs.utimes(path, atime.getTime(), mtime.getTime()); this.onAccess?.("utimes", file.path, file.revision); }); }
  symlink(target: string, path: string): Promise<void> { return this.call(async () => { const file = await this.vfs.symlink(target, path); this.onAccess?.("symlink", file.path, file.revision); }); }
  link(_existingPath: string, _newPath: string): Promise<void> { return Promise.reject(new Error("ENOSYS: Hard links are not supported by the workspace filesystem")); }
  readlink(path: string): Promise<string> {
    return this.call(async () => {
      try { return await this.vfs.readlink(path); }
      catch (error) { if (error instanceof FileSystemError && error.code === "wrong_kind") throw new Error("EINVAL: Path is not a symbolic link"); throw error; }
    });
  }
  realpath(path: string): Promise<string> { return this.call(() => this.vfs.realpath(path)); }
}
