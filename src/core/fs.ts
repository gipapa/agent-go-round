export const VFS_HOME = "/home/user";
// Byte storage is intentionally a new namespace. Legacy text workspaces stay intact.
export const VFS_DATABASE = "agent-go-round.vfs.bytes-v2";
export const VFS_SCHEMA_VERSION = 1;
const MAX_FILES = 2048;
const MAX_FILE_BYTES = 512 * 1024;
const MAX_WORKSPACE_BYTES = 16 * 1024 * 1024;
const ROOTS = ["/", "/home", VFS_HOME];
const encoder = new TextEncoder();

export class FileSystemError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = "FileSystemError"; }
}
export type FileStat = {
  path: string; kind: "file" | "directory" | "symlink"; size: number; revision: number;
  updatedAt: number; createdAt: number; mode: number; mtime: number; atime: number; target?: string;
};
export type FileNode = FileStat & { kind: "file"; content: string };
export type ByteFileNode = FileStat & { kind: "file"; content: Uint8Array };
export type WriteOptions = { expectedRevision?: number; mode?: number };
export type FileWrite = { path: string; content: string; expectedRevision?: number };
export type FileRemoval = { path: string; expectedRevision: number; expectedContent: string };
export type ByteFileWrite = { path: string; content: Uint8Array; expectedRevision?: number; mode?: number };
export type RemoveOptions = { recursive?: boolean; force?: boolean };
export type FileAccess = { method: "readBytes" | "writeBytes" | "metadataRead" | "metadataWrite" | "remove"; path: string; revision: number };
export type FileAccessRecorder = (access: FileAccess) => void;
export interface VirtualFileSystem {
  withAccessRecorder(record: FileAccessRecorder): VirtualFileSystem;
  stat(path: string): Promise<FileStat>;
  lstat(path: string): Promise<FileStat>;
  realpath(path: string): Promise<string>;
  readlink(path: string): Promise<string>;
  readFile(path: string): Promise<FileNode>;
  readBytes(path: string): Promise<ByteFileNode>;
  listDirectory(path: string): Promise<FileStat[]>;
  writeFile(path: string, content: string, options?: WriteOptions): Promise<FileStat>;
  writeFiles(files: readonly FileWrite[]): Promise<FileStat[]>;
  writeBytes(path: string, content: Uint8Array, options?: WriteOptions): Promise<FileStat>;
  writeByteFiles(files: readonly ByteFileWrite[]): Promise<FileStat[]>;
  appendBytes(path: string, content: Uint8Array, options?: WriteOptions): Promise<FileStat>;
  createExclusive(path: string, options: { mode: number; directory?: boolean }): Promise<FileStat>;
  mkdir(path: string, options?: { recursive?: boolean; mode?: number }): Promise<FileStat>;
  remove(path: string, options?: RemoveOptions): Promise<void>;
  removeFiles(files: readonly FileRemoval[]): Promise<void>;
  rename(from: string, to: string, options?: WriteOptions & { replace?: boolean }): Promise<void>;
  copy(from: string, to: string, options?: { recursive?: boolean }): Promise<void>;
  symlink(target: string, path: string): Promise<FileStat>;
  chmod(path: string, mode: number): Promise<FileStat>;
  utimes(path: string, atime: number, mtime: number): Promise<FileStat>;
}

function absolutePath(path: string, cwd = VFS_HOME): string {
  if (typeof path !== "string" || !path || path.includes("\0") || path.length > 4096) throw new FileSystemError("invalid_path", "Invalid file path");
  return path === "~" ? VFS_HOME : path.startsWith("~/") ? VFS_HOME + path.slice(1) : path.startsWith("/") ? path : `${cwd}/${path}`;
}
/** Lexical path resolution for callers; filesystem operations also resolve each symlink. */
export function resolvePath(path: string, cwd = VFS_HOME): string {
  const parts: string[] = [];
  for (const part of absolutePath(path, cwd).split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop(); else parts.push(part);
  }
  return "/" + parts.join("/");
}
export function isHomePath(path: string): boolean { return path === VFS_HOME || path.startsWith(VFS_HOME + "/"); }
export function displayPath(path: string): string { return path === VFS_HOME ? "~" : path.startsWith(VFS_HOME + "/") ? "~" + path.slice(VFS_HOME.length) : path; }
function parent(path: string): string { return path === "/" ? "" : path.slice(0, path.lastIndexOf("/")) || "/"; }
function nodeAt(path: string, kind: FileStat["kind"], mode = kind === "directory" ? 0o755 : kind === "symlink" ? 0o777 : 0o644): FileStat {
  const now = Date.now(); return { path, kind, mode, size: 0, revision: 1, createdAt: now, updatedAt: now, mtime: now, atime: now };
}
function checkMode(mode: number): void { if (!Number.isInteger(mode) || mode < 0 || mode > 0o7777) throw new FileSystemError("invalid_mode", "Invalid virtual permission bits"); }
function checkRevision(node: FileStat | undefined, expected?: number): void {
  if (expected !== undefined && (!Number.isInteger(expected) || expected < 0)) throw new FileSystemError("invalid_revision", "Invalid expectedRevision");
  if (expected !== undefined && expected !== (node?.revision ?? 0)) throw new FileSystemError("conflict", `File changed: ${displayPath(node?.path ?? "file")}; read it again before writing`);
}
type Usage = { count: number; bytes: number };
interface FileTransaction {
  observeMetadata?(node: FileStat): void;
  get(path: string): Promise<FileStat | undefined>;
  children(path: string): Promise<FileStat[]>;
  put(node: FileStat): Promise<void>;
  delete(path: string): Promise<void>;
  readContent(path: string): Promise<Uint8Array | undefined>;
  writeContent(path: string, content: Uint8Array): Promise<void>;
  usage(): Promise<Usage | undefined>;
  saveUsage(usage: Usage): Promise<void>;
}
interface FileMutation extends FileTransaction {
  save(node: FileStat, content?: Uint8Array): Promise<void>;
  removeNode(path: string): Promise<void>;
  preserveTreeTimes(path: string): void;
}
async function getNode(tx: FileTransaction, path: string): Promise<FileStat | undefined> {
  return await tx.get(path) ?? (ROOTS.includes(path) ? { ...nodeAt(path, "directory"), createdAt: 0, updatedAt: 0, atime: 0, mtime: 0 } : undefined);
}
/** Resolve every component, including intermediate links and physical link/.. traversal. */
async function lookup(tx: FileTransaction, path: string, followFinal = true, allowMissingFinal = false): Promise<{ path: string; node?: FileStat }> {
  const input = absolutePath(path), trailingSlash = input.endsWith("/");
  let parts = input.split("/").filter(Boolean), current = "/", links = 0;
  while (parts.length) {
    const part = parts.shift()!;
    const directory = await getNode(tx, current);
    if (!directory) throw new FileSystemError("not_found", `Not found: ${displayPath(current)}`);
    if (directory.kind !== "directory") throw new FileSystemError("not_directory", `Not a directory: ${displayPath(current)}`);
    if (part === ".") continue;
    if (part === "..") { current = parent(current) || "/"; continue; }
    const next = current === "/" ? `/${part}` : `${current}/${part}`;
    const node = await getNode(tx, next);
    if (!node) {
      if (allowMissingFinal && !parts.length && !trailingSlash) return { path: next };
      throw new FileSystemError("not_found", `Not found: ${displayPath(next)}`);
    }
    if (node.kind === "symlink" && (followFinal || parts.length > 0 || trailingSlash)) {
      if (++links > 40) throw new FileSystemError("symlink_loop", `Too many symbolic links: ${displayPath(path)}`);
      const target = node.target!;
      parts = [...target.split("/").filter(Boolean), ...parts];
      if (target.startsWith("/")) current = "/";
    } else current = next;
  }
  const node = await getNode(tx, current);
  if (trailingSlash && node?.kind !== "directory") throw new FileSystemError("not_directory", `Not a directory: ${displayPath(current)}`);
  return { path: current, node };
}
async function requireNode(tx: FileTransaction, path: string, kind?: FileStat["kind"], followFinal = true): Promise<FileStat> {
  const { node } = await lookup(tx, path, followFinal);
  if (!node) throw new FileSystemError("not_found", `Not found: ${displayPath(path)}`);
  if (kind && node.kind !== kind) throw new FileSystemError(kind === "directory" ? "not_directory" : "wrong_kind", `Expected ${kind}: ${displayPath(path)}`);
  return node;
}
function protect(path: string): void { if (ROOTS.includes(path)) throw new FileSystemError("protected", `Cannot remove or replace workspace root: ${displayPath(path)}`); }
function bytes(content: Uint8Array): Uint8Array {
  if (!(content instanceof Uint8Array)) throw new FileSystemError("invalid_content", "File content must be Uint8Array");
  if (content.byteLength > MAX_FILE_BYTES) throw new FileSystemError("quota", "File exceeds 512 KiB");
  return content.slice();
}

abstract class BaseFileSystem implements VirtualFileSystem {
  constructor(private readonly record?: FileAccessRecorder) {}
  protected abstract storageTransaction<T>(write: boolean, operation: (tx: FileTransaction) => Promise<T>): Promise<T>;
  /** A context facade over the SAME storage, not a global observer or another
   * tree. Independent runs cannot observe or attribute each other's calls.
   */
  withAccessRecorder(record: FileAccessRecorder): VirtualFileSystem {
    return new ScopedFileSystem(this.storageTransaction.bind(this), record);
  }
  private async transaction<T>(write: boolean, operation: (tx: FileTransaction) => Promise<T>): Promise<T> {
    if (!this.record) return this.storageTransaction(write, operation);
    const reads = new Map<string, FileAccess>(), originals = new Map<string, FileStat | undefined>();
    const finalNodes = new Map<string, FileStat | undefined>(), contents = new Set<string>();
    const note = (method: FileAccess["method"], node: FileStat) => {
      const access = { method, path: node.path, revision: node.revision };
      reads.set(JSON.stringify([method, node.path, node.revision]), access);
    };
    let result: T;
    try {
      result = await this.storageTransaction(write, tx => operation({ ...tx,
        observeMetadata: node => note("metadataRead", node),
        readContent: async path => {
          const content = await tx.readContent(path);
          if (content !== undefined) { const node = await tx.get(path); if (node) note("readBytes", node); }
          return content;
        },
        put: async node => {
          if (!originals.has(node.path)) originals.set(node.path, await tx.get(node.path));
          await tx.put(node); finalNodes.set(node.path, { ...node });
        },
        delete: async path => {
          if (!originals.has(path)) originals.set(path, await tx.get(path));
          await tx.delete(path); finalNodes.set(path, undefined);
        },
        writeContent: async (path, content) => { await tx.writeContent(path, content); contents.add(path); }
      }));
    } catch (error) {
      // Reads happened even if a later mutation rolled back. No attempted write
      // is reported as committed, and none of these reads imply model delivery.
      for (const access of reads.values()) this.record(access);
      throw error;
    }
    for (const access of reads.values()) this.record(access);
    // Use the final metadata from THIS transaction. A later stat could race
    // another tab and incorrectly report its revision as this run's write.
    for (const [path, node] of finalNodes) {
      if (node) this.record({ method: contents.has(path) && node.kind === "file" ? "writeBytes" : "metadataWrite", path, revision: node.revision });
      else { const original = originals.get(path); if (original) this.record({ method: "remove", path, revision: original.revision }); }
    }
    return result;
  }
  private mutate<T>(operation: (tx: FileMutation) => Promise<T>): Promise<T> {
    return this.transaction(true, async tx => {
      const usage = await tx.usage() ?? { count: 0, bytes: 0 };
      const changedParents = new Set<string>(), preservedTrees = new Set<string>();
      const save = async (node: FileStat, content?: Uint8Array) => {
        const previous = await tx.get(node.path);
        usage.count += previous ? 0 : 1;
        usage.bytes += node.size - (previous?.size ?? 0);
        if (!previous && parent(node.path)) changedParents.add(parent(node.path));
        await tx.put(node);
        if (content !== undefined) await tx.writeContent(node.path, content);
      };
      const removeNode = async (path: string) => {
        // Callers pass canonical physical keys. During subtree rename the old
        // parent may already have moved, so traversing it again would fail.
        const previous = await tx.get(path);
        if (!previous) throw new FileSystemError("not_found", `Not found: ${displayPath(path)}`);
        usage.count--; usage.bytes -= previous.size;
        if (parent(path)) changedParents.add(parent(path));
        await tx.delete(path);
      };
      for (const root of ROOTS) if (!await tx.get(root)) await save(nodeAt(root, "directory"));
      const result = await operation({ ...tx, save, removeNode, preserveTreeTimes: path => { preservedTrees.add(path); } });
      // Validate final usage: atomic replacements/moves can temporarily exceed quota.
      if (usage.count > MAX_FILES || usage.bytes > MAX_WORKSPACE_BYTES) throw new FileSystemError("quota", "Workspace file or byte limit exceeded");
      for (const path of changedParents) {
        if ([...preservedTrees].some(tree => path === tree || path.startsWith(tree + "/"))) continue;
        const directory = await tx.get(path);
        if (directory?.kind === "directory") await tx.put({ ...directory, revision: directory.revision + 1, updatedAt: Date.now(), mtime: Date.now() });
      }
      await tx.saveUsage(usage);
      return result;
    });
  }
  stat(path: string): Promise<FileStat> { return this.transaction(false, async tx => { const node = await requireNode(tx, path); tx.observeMetadata?.(node); return node; }); }
  lstat(path: string): Promise<FileStat> { return this.transaction(false, async tx => { const node = await requireNode(tx, path, undefined, false); tx.observeMetadata?.(node); return node; }); }
  realpath(path: string): Promise<string> { return this.stat(path).then(node => node.path); }
  readlink(path: string): Promise<string> { return this.transaction(false, async tx => { const node = await requireNode(tx, path, "symlink", false); tx.observeMetadata?.(node); return node.target!; }); }
  async readFile(path: string): Promise<FileNode> {
    const file = await this.readBytes(path);
    try { return { ...file, content: new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(file.content) }; }
    catch { throw new FileSystemError("invalid_encoding", `File is not valid UTF-8; use byte access: ${displayPath(file.path)}`); }
  }
  readBytes(path: string): Promise<ByteFileNode> {
    return this.transaction(false, async tx => {
      const node = await requireNode(tx, path, "file");
      const content = await tx.readContent(node.path);
      if (content === undefined) throw new FileSystemError("storage", `Missing file content: ${displayPath(node.path)}`);
      return { ...node, kind: "file", content: content.slice() };
    });
  }
  listDirectory(path: string): Promise<FileStat[]> {
    return this.transaction(false, async tx => {
      const node = await requireNode(tx, path, "directory");
      const children = await tx.children(node.path);
      for (const root of ROOTS) if (parent(root) === node.path && !children.some(child => child.path === root)) children.push((await getNode(tx, root))!);
      tx.observeMetadata?.(node); for (const child of children) tx.observeMetadata?.(child);
      return children.sort((a, b) => a.path.localeCompare(b.path));
    });
  }
  writeFile(path: string, content: string, options: WriteOptions = {}): Promise<FileStat> {
    if (typeof content !== "string") return Promise.reject(new FileSystemError("invalid_content", "File content must be text"));
    return this.writeBytes(path, encoder.encode(content), options);
  }
  async writeFiles(files: readonly FileWrite[]): Promise<FileStat[]> {
    return this.writeByteFiles(files.map(file => {
      if (typeof file.content !== "string") throw new FileSystemError("invalid_content", "File content must be text");
      return { ...file, content: encoder.encode(file.content) };
    }));
  }
  writeBytes(path: string, content: Uint8Array, options: WriteOptions = {}): Promise<FileStat> { return this.writeByteFiles([{ path, content, ...options }]).then(files => files[0]); }
  async writeByteFiles(files: readonly ByteFileWrite[]): Promise<FileStat[]> {
    if (!files.length || files.length > 32) throw new FileSystemError("invalid_batch", "Write batch must contain 1–32 files");
    const batch = files.map(file => ({ ...file, content: bytes(file.content) }));
    return this.mutate(async tx => {
      const result: FileStat[] = [], paths = new Set<string>();
      for (const file of batch) {
        const { path, node: previous } = await lookup(tx, file.path, true, true);
        if (paths.has(path)) throw new FileSystemError("invalid_batch", `Duplicate file path: ${displayPath(path)}`);
        paths.add(path);
        const node = this.writtenNode(path, previous, file.content, file);
        await tx.save(node, file.content); result.push(node);
      }
      return result;
    });
  }
  private writtenNode(path: string, previous: FileStat | undefined, content: Uint8Array, options: WriteOptions): FileStat {
    if (previous && previous.kind !== "file") throw new FileSystemError("wrong_kind", "Cannot write to a directory");
    checkRevision(previous, options.expectedRevision);
    if (options.mode !== undefined) checkMode(options.mode);
    const now = Date.now();
    return { ...(previous ?? nodeAt(path, "file", options.mode)), path, kind: "file", size: content.byteLength, revision: (previous?.revision ?? 0) + 1, updatedAt: now, mtime: now };
  }
  async appendBytes(path: string, content: Uint8Array, options: WriteOptions = {}): Promise<FileStat> {
    const suffix = bytes(content);
    return this.mutate(async tx => {
      const target = await lookup(tx, path, true, true);
      if (target.node && target.node.kind !== "file") throw new FileSystemError("wrong_kind", "Cannot append to a directory");
      const before = target.node ? await tx.readContent(target.path) : new Uint8Array();
      if (!before) throw new FileSystemError("storage", "Missing file content");
      if (before.byteLength + suffix.byteLength > MAX_FILE_BYTES) throw new FileSystemError("quota", "File exceeds 512 KiB");
      const combined = new Uint8Array(before.byteLength + suffix.byteLength);
      combined.set(before); combined.set(suffix, before.byteLength);
      const node = this.writtenNode(target.path, target.node, combined, options);
      await tx.save(node, combined); return node;
    });
  }
  createExclusive(path: string, options: { mode: number; directory?: boolean }): Promise<FileStat> {
    return this.mutate(async tx => {
      checkMode(options.mode);
      const target = await lookup(tx, options.directory ? absolutePath(path).replace(/\/+$/, "") || "/" : path, false, true);
      if (target.node) throw new FileSystemError("exists", `Already exists: ${displayPath(target.path)}`);
      const node = nodeAt(target.path, options.directory ? "directory" : "file", options.mode);
      await tx.save(node, options.directory ? undefined : new Uint8Array()); return node;
    });
  }
  mkdir(path: string, options: { recursive?: boolean; mode?: number } = {}): Promise<FileStat> {
    return this.mutate(async tx => {
      if (options.mode !== undefined) checkMode(options.mode);
      const create = async (target: string): Promise<FileStat> => {
        try {
          const existing = await requireNode(tx, target, "directory");
          // Existing VFS mkdir callers rely on idempotency; adapter enforces EEXIST.
          return existing;
        } catch (error) { if (!(error instanceof FileSystemError) || error.code !== "not_found") throw error; }
        const input = absolutePath(target), index = input.lastIndexOf("/"), name = input.slice(index + 1);
        if (!name || name === "." || name === "..") throw new FileSystemError("invalid_path", "Invalid directory path");
        const parentPath = input.slice(0, index) || "/";
        const parentNode = options.recursive ? await create(parentPath) : await requireNode(tx, parentPath, "directory");
        const physical = (parentNode.path === "/" ? "" : parentNode.path) + "/" + name;
        if (await getNode(tx, physical)) throw new FileSystemError("exists", `Already exists: ${displayPath(physical)}`);
        const node = nodeAt(physical, "directory", options.mode); await tx.save(node); return node;
      };
      return create(absolutePath(path).replace(/\/+$/, "") || "/");
    });
  }
  /** Host-only atomic cleanup: a concurrent change to either tool file aborts the whole removal. */
  removeFiles(files: readonly FileRemoval[]): Promise<void> {
    return this.mutate(async tx => {
      if (!files.length || files.length > 32) throw new FileSystemError("invalid_path", "Remove batch must contain 1–32 files");
      const paths = new Set<string>();
      for (const file of files) {
        const node = await requireNode(tx, file.path, "file", false);
        protect(node.path); checkRevision(node, file.expectedRevision);
        const content = await tx.readContent(node.path), expected = encoder.encode(file.expectedContent);
        if (node.path !== resolvePath(file.path) || !content || content.length !== expected.length || expected.some((byte, index) => byte !== content[index])) {
          throw new FileSystemError("conflict", "File contents or removal path changed");
        }
        if (paths.has(node.path)) throw new FileSystemError("invalid_path", "Duplicate removal path");
        paths.add(node.path);
        await tx.removeNode(node.path);
      }
    });
  }
  remove(path: string, options: RemoveOptions = {}): Promise<void> {
    return this.mutate(async tx => {
      let node: FileStat;
      try { node = await requireNode(tx, path, undefined, false); }
      catch (error) { if (options.force && error instanceof FileSystemError && error.code === "not_found") return; throw error; }
      protect(node.path);
      const erase = async (entry: FileStat): Promise<void> => {
        if (entry.kind === "directory") {
          const children = await tx.children(entry.path);
          if (children.length && !options.recursive) throw new FileSystemError("not_empty", "Directory is not empty");
          for (const child of children) { protect(child.path); await erase(child); }
        }
        await tx.removeNode(entry.path);
      };
      await erase(node);
    });
  }
  rename(from: string, to: string, options: WriteOptions & { replace?: boolean } = {}): Promise<void> {
    return this.mutate(async tx => {
      const node = await requireNode(tx, from, undefined, false);
      const source = node.path, destination = await lookup(tx, to, false, true), target = destination.path;
      checkRevision(node, options.expectedRevision); protect(source);
      if (source === target) return;
      protect(target);
      if (target.startsWith(source + "/")) throw new FileSystemError("invalid_path", "Cannot move a directory inside itself");
      if (destination.node) {
        if (!options.replace) throw new FileSystemError("conflict", "Destination already exists");
        if ((node.kind === "directory") !== (destination.node.kind === "directory")) throw new FileSystemError(node.kind === "directory" ? "not_directory" : "is_directory", "Cannot replace file with directory or directory with file");
        if (destination.node.kind === "directory" && (await tx.children(target)).length) throw new FileSystemError("not_empty", "Destination directory is not empty");
        await tx.removeNode(target);
      }
      const entries = [node];
      for (let i = 0; i < entries.length; i++) if (entries[i].kind === "directory") entries.push(...await tx.children(entries[i].path));
      // Re-keying descendants does not change the contents of the moved
      // directories. Only the source and destination parents change entries.
      tx.preserveTreeTimes(source); tx.preserveTreeTimes(target);
      for (const entry of entries) {
        const content = entry.kind === "file" ? await tx.readContent(entry.path) : undefined;
        if (entry.kind === "file" && !content) throw new FileSystemError("storage", `Missing file content: ${displayPath(entry.path)}`);
        await tx.removeNode(entry.path);
        await tx.save({ ...entry, path: target + entry.path.slice(source.length), revision: Math.max(entry.revision, entry === node ? destination.node?.revision ?? 0 : 0) + 1, updatedAt: Date.now() }, content);
      }
    });
  }
  copy(from: string, to: string, options: { recursive?: boolean } = {}): Promise<void> {
    return this.mutate(async tx => {
      const source = await requireNode(tx, from, undefined, false);
      const destination = await lookup(tx, to, false, true);
      if (source.path === destination.path || destination.path.startsWith(source.path + "/")) throw new FileSystemError("invalid_path", "Cannot copy a file onto itself or a directory into itself");
      if (source.kind === "directory" && !options.recursive) throw new FileSystemError("is_directory", "Recursive copy required for directory");
      const copy = async (entry: FileStat, target: string): Promise<void> => {
        protect(target);
        const previous = await tx.get(target);
        if (previous && (entry.kind === "directory") !== (previous.kind === "directory")) throw new FileSystemError(entry.kind === "directory" ? "not_directory" : "is_directory", "Copy source and destination kinds differ");
        if (entry.kind === "directory" && previous) {
          for (const child of await tx.children(entry.path)) await copy(child, target + child.path.slice(entry.path.length));
          return;
        }
        const content = entry.kind === "file" ? await tx.readContent(entry.path) : undefined;
        if (entry.kind === "file" && !content) throw new FileSystemError("storage", "Missing copy source content");
        // Remove old contents when replacing a file with a symlink, too.
        if (previous) await tx.removeNode(target);
        const now = Date.now();
        await tx.save({ ...entry, path: target, revision: (previous?.revision ?? 0) + 1, createdAt: previous?.createdAt ?? now, updatedAt: now, mtime: now }, content);
        if (entry.kind === "directory") for (const child of await tx.children(entry.path)) await copy(child, target + child.path.slice(entry.path.length));
      };
      await copy(source, destination.path);
    });
  }
  symlink(target: string, path: string): Promise<FileStat> {
    return this.mutate(async tx => {
      if (typeof target !== "string" || !target || target.includes("\0") || target.length > 4096) throw new FileSystemError("invalid_path", "Invalid symbolic link target");
      const destination = await lookup(tx, path, false, true);
      if (destination.node) throw new FileSystemError("exists", "Symbolic link destination exists");
      const node = { ...nodeAt(destination.path, "symlink"), target, size: encoder.encode(target).byteLength };
      await tx.save(node); return node;
    });
  }
  chmod(path: string, mode: number): Promise<FileStat> {
    return this.mutate(async tx => {
      checkMode(mode); const previous = await requireNode(tx, path);
      const node = { ...previous, mode, revision: previous.revision + 1, updatedAt: Date.now() }; await tx.save(node); return node;
    });
  }
  utimes(path: string, atime: number, mtime: number): Promise<FileStat> {
    return this.mutate(async tx => {
      if (!Number.isFinite(atime) || !Number.isFinite(mtime)) throw new FileSystemError("invalid_time", "Invalid virtual file time");
      const previous = await requireNode(tx, path);
      const node = { ...previous, atime, mtime, revision: previous.revision + 1, updatedAt: Date.now() }; await tx.save(node); return node;
    });
  }
}

type StorageTransaction = <T>(write: boolean, operation: (tx: FileTransaction) => Promise<T>) => Promise<T>;
class ScopedFileSystem extends BaseFileSystem {
  constructor(private readonly delegate: StorageTransaction, record: FileAccessRecorder) { super(record); }
  protected storageTransaction<T>(write: boolean, operation: (tx: FileTransaction) => Promise<T>): Promise<T> { return this.delegate(write, operation); }
}

export class MemoryFileSystem extends BaseFileSystem {
  private nodes = new Map<string, FileStat>();
  private contents = new Map<string, Uint8Array>();
  private used?: Usage;
  private pending: Promise<unknown> = Promise.resolve();
  protected storageTransaction<T>(write: boolean, operation: (tx: FileTransaction) => Promise<T>): Promise<T> {
    const result = this.pending.then(async () => {
      const nodes = new Map(this.nodes), contents = new Map(this.contents);
      let usage = this.used && { ...this.used };
      const result = await operation({
        get: async path => { const node = nodes.get(path); return node && { ...node }; },
        children: async path => [...nodes.values()].filter(node => parent(node.path) === path).map(node => ({ ...node })),
        put: async node => { nodes.set(node.path, { ...node }); },
        delete: async path => { nodes.delete(path); contents.delete(path); },
        readContent: async path => contents.get(path)?.slice(),
        writeContent: async (path, content) => { contents.set(path, content.slice()); },
        usage: async () => usage,
        saveUsage: async value => { usage = { ...value }; }
      });
      if (write) { this.nodes = nodes; this.contents = contents; this.used = usage; }
      return result;
    });
    this.pending = result.then(() => undefined, () => undefined);
    return result;
  }
}

function request<T>(operation: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => { operation.onsuccess = () => resolve(operation.result); operation.onerror = () => reject(operation.error); });
}
/** Metadata, contents and usage commit together; ordinary operations read only necessary keys. */
export class IndexedDbFileSystem extends BaseFileSystem {
  private database?: Promise<IDBDatabase>;
  constructor(private readonly factory: IDBFactory, private readonly workspaceId = "default") {
    super();
    if (!workspaceId || workspaceId.length > 128) throw new FileSystemError("invalid_workspace", "Invalid workspace identity");
  }
  private open(): Promise<IDBDatabase> {
    return this.database ??= new Promise((resolve, reject) => {
      const opening = this.factory.open(VFS_DATABASE, VFS_SCHEMA_VERSION);
      opening.onupgradeneeded = () => {
        const nodes = opening.result.createObjectStore("nodes", { keyPath: "key" });
        nodes.createIndex("workspace", "workspace"); nodes.createIndex("parent", ["workspace", "parent"]);
        opening.result.createObjectStore("contents", { keyPath: "key" });
        opening.result.createObjectStore("usage", { keyPath: "workspace" });
      };
      opening.onerror = () => { this.database = undefined; reject(new FileSystemError("storage", opening.error?.message ?? "Cannot open files database")); };
      opening.onblocked = () => { this.database = undefined; reject(new FileSystemError("blocked", "Close other app windows to open the files database")); };
      opening.onsuccess = () => { const db = opening.result; db.onversionchange = () => { db.close(); this.database = undefined; }; resolve(db); };
    });
  }
  protected async storageTransaction<T>(write: boolean, operation: (tx: FileTransaction) => Promise<T>): Promise<T> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(["nodes", "contents", "usage"], write ? "readwrite" : "readonly");
      const nodes = tx.objectStore("nodes"), contents = tx.objectStore("contents"), usage = tx.objectStore("usage");
      const key = (path: string) => JSON.stringify([this.workspaceId, path]);
      let result: T, failure: unknown;
      tx.oncomplete = () => resolve(result);
      tx.onabort = () => reject(failure ?? new FileSystemError("storage", tx.error?.message ?? "Files transaction aborted"));
      tx.onerror = () => {};
      void operation({
        get: async path => (await request(nodes.get(key(path))))?.node,
        children: async path => (await request(nodes.index("parent").getAll([this.workspaceId, path]))).map(row => row.node),
        put: async node => { await request(nodes.put({ key: key(node.path), workspace: this.workspaceId, parent: parent(node.path), node })); },
        delete: async path => { await request(nodes.delete(key(path))); await request(contents.delete(key(path))); },
        readContent: async path => (await request(contents.get(key(path))))?.content,
        writeContent: async (path, content) => { await request(contents.put({ key: key(path), content })); },
        usage: async () => { const row = await request(usage.get(this.workspaceId)); return row && { count: row.count, bytes: row.bytes }; },
        saveUsage: async value => { await request(usage.put({ workspace: this.workspaceId, ...value })); }
      }).then(value => { result = value; }).catch(error => { failure = error; tx.abort(); });
    });
  }
}
