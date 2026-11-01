export const VFS_HOME = "/home/user";
export const VFS_DATABASE = "agent-go-round.vfs";
const MAX_FILES = 2048;
const MAX_FILE_BYTES = 512 * 1024;
const MAX_WORKSPACE_BYTES = 16 * 1024 * 1024;

export class FileSystemError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = "FileSystemError"; }
}

export type FileStat = { path: string; kind: "file" | "directory"; size: number; revision: number; updatedAt: number; createdAt: number };
export type FileNode = FileStat & { kind: "file"; content: string };
export type WriteOptions = { expectedRevision?: number };
export type FileWrite = { path: string; content: string; expectedRevision?: number };
export interface VirtualFileSystem {
  stat(path: string): Promise<FileStat>;
  readFile(path: string): Promise<FileNode>;
  listDirectory(path: string): Promise<FileStat[]>;
  writeFile(path: string, content: string, options?: WriteOptions): Promise<FileStat>;
  writeFiles(files: readonly FileWrite[]): Promise<FileStat[]>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<FileStat>;
  remove(path: string): Promise<void>;
  rename(from: string, to: string, options?: WriteOptions): Promise<void>;
}

export function resolvePath(path: string, cwd = VFS_HOME): string {
  if (typeof path !== "string" || !path || path.includes("\0") || path.length > 1024) throw new FileSystemError("invalid_path", "Invalid file path");
  const input = path === "~" ? VFS_HOME : path.startsWith("~/") ? VFS_HOME + path.slice(1) : path.startsWith("/") ? path : `${cwd}/${path}`;
  const parts: string[] = [];
  for (const part of input.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop(); else parts.push(part);
  }
  const result = "/" + parts.join("/");
  if (result !== VFS_HOME && !result.startsWith(VFS_HOME + "/")) throw new FileSystemError("outside_workspace", "Path must stay inside ~");
  return result;
}
export function displayPath(path: string): string { return path === VFS_HOME ? "~" : path.startsWith(VFS_HOME + "/") ? "~" + path.slice(VFS_HOME.length) : path; }
function parent(path: string): string { return path.slice(0, path.lastIndexOf("/")); }
function directory(path: string): FileStat { const now = Date.now(); return { path, kind: "directory", size: 0, revision: 1, createdAt: now, updatedAt: now }; }
function checkRevision(node: FileStat | undefined, expected?: number): void {
  if (expected !== undefined && expected !== (node?.revision ?? 0)) throw new FileSystemError("conflict", `File changed: ${displayPath(node?.path ?? "file")}; read it again before writing`);
}
type Usage = { count: number; bytes: number };
interface FileTransaction {
  get(path: string): Promise<FileStat | undefined>;
  children(path: string): Promise<FileStat[]>;
  put(node: FileStat): Promise<void>;
  delete(path: string): Promise<void>;
  readContent(path: string): Promise<string | undefined>;
  writeContent(path: string, content: string): Promise<void>;
  usage(): Promise<Usage | undefined>;
  saveUsage(usage: Usage): Promise<void>;
}
interface FileMutation extends FileTransaction { save(node: FileStat, content?: string): Promise<void>; removeNode(path: string): Promise<void> }
async function requireNode(tx: FileTransaction, path: string, kind?: FileStat["kind"]): Promise<FileStat> {
  const node = await tx.get(path) ?? (path === VFS_HOME ? directory(path) : undefined);
  if (!node) throw new FileSystemError("not_found", `Not found: ${displayPath(path)}`);
  if (kind && node.kind !== kind) throw new FileSystemError("wrong_kind", `Expected ${kind}: ${displayPath(path)}`);
  return node;
}

abstract class BaseFileSystem implements VirtualFileSystem {
  protected abstract transaction<T>(write: boolean, operation: (tx: FileTransaction) => Promise<T>): Promise<T>;
  private mutate<T>(operation: (tx: FileMutation) => Promise<T>): Promise<T> {
    return this.transaction(true, async tx => {
      const usage = await tx.usage() ?? { count: 0, bytes: 0 };
      const save = async (node: FileStat, content?: string) => {
        const previous = await tx.get(node.path);
        usage.count += previous ? 0 : 1;
        usage.bytes += node.size - (previous?.size ?? 0);
        if (usage.count > MAX_FILES || usage.bytes > MAX_WORKSPACE_BYTES) throw new FileSystemError("quota", "Workspace file or byte limit exceeded");
        await tx.put(node);
        if (content !== undefined) await tx.writeContent(node.path, content);
      };
      const removeNode = async (path: string) => {
        const previous = await requireNode(tx, path);
        usage.count--; usage.bytes -= previous.size;
        await tx.delete(path);
      };
      if (!await tx.get(VFS_HOME)) await save(directory(VFS_HOME));
      const result = await operation({ ...tx, save, removeNode });
      await tx.saveUsage(usage);
      return result;
    });
  }
  stat(path: string): Promise<FileStat> { return this.transaction(false, tx => requireNode(tx, resolvePath(path))); }
  readFile(path: string): Promise<FileNode> {
    return this.transaction(false, async tx => {
      const node = await requireNode(tx, resolvePath(path), "file");
      const content = await tx.readContent(node.path);
      if (content === undefined) throw new FileSystemError("storage", `Missing file content: ${displayPath(node.path)}`);
      return { ...node, kind: "file", content };
    });
  }
  listDirectory(path: string): Promise<FileStat[]> {
    return this.transaction(false, async tx => {
      const node = await requireNode(tx, resolvePath(path), "directory");
      return (await tx.children(node.path)).sort((a, b) => a.path.localeCompare(b.path));
    });
  }
  writeFile(path: string, content: string, options: WriteOptions = {}): Promise<FileStat> { return this.writeFiles([{ path, content, ...options }]).then(files => files[0]); }
  writeFiles(files: readonly FileWrite[]): Promise<FileStat[]> {
    if (!files.length || files.length > 32) return Promise.reject(new FileSystemError("invalid_batch", "Write batch must contain 1–32 files"));
    return this.mutate(async tx => {
      const result: FileStat[] = [], paths = new Set<string>();
      for (const file of files) {
        const path = resolvePath(file.path);
        if (paths.has(path)) throw new FileSystemError("invalid_batch", `Duplicate file path: ${displayPath(path)}`);
        paths.add(path);
        if (typeof file.content !== "string") throw new FileSystemError("invalid_content", "File content must be text");
        const size = new TextEncoder().encode(file.content).byteLength;
        if (size > MAX_FILE_BYTES) throw new FileSystemError("quota", "File exceeds 512 KiB");
        await requireNode(tx, parent(path), "directory");
        const previous = await tx.get(path);
        if (previous?.kind === "directory") throw new FileSystemError("wrong_kind", "Cannot write to a directory");
        checkRevision(previous, file.expectedRevision);
        const now = Date.now();
        const node: FileStat = { path, kind: "file", size, revision: (previous?.revision ?? 0) + 1, updatedAt: now, createdAt: previous?.createdAt ?? now };
        await tx.save(node, file.content); result.push(node);
      }
      return result;
    });
  }
  mkdir(path: string, options: { recursive?: boolean } = {}): Promise<FileStat> {
    return this.mutate(async tx => {
      const create = async (target: string): Promise<FileStat> => {
        if (await tx.get(target)) return requireNode(tx, target, "directory");
        if (options.recursive) await create(parent(target)); else await requireNode(tx, parent(target), "directory");
        const node = directory(target); await tx.save(node); return node;
      };
      return create(resolvePath(path));
    });
  }
  remove(path: string): Promise<void> {
    return this.mutate(async tx => {
      const resolved = resolvePath(path);
      if (resolved === VFS_HOME) throw new FileSystemError("protected", "Cannot remove ~");
      await requireNode(tx, resolved);
      if ((await tx.children(resolved)).length) throw new FileSystemError("not_empty", "Directory is not empty");
      await tx.removeNode(resolved);
    });
  }
  rename(from: string, to: string, options: WriteOptions = {}): Promise<void> {
    return this.mutate(async tx => {
      const source = resolvePath(from), target = resolvePath(to);
      const node = await requireNode(tx, source); checkRevision(node, options.expectedRevision);
      if (source === VFS_HOME) throw new FileSystemError("protected", "Cannot rename ~");
      if (source === target) return;
      if (target.startsWith(source + "/")) throw new FileSystemError("invalid_path", "Cannot move a directory inside itself");
      if (await tx.get(target)) throw new FileSystemError("conflict", "Destination already exists");
      await requireNode(tx, parent(target), "directory");
      const entries = [node];
      for (let i = 0; i < entries.length; i++) if (entries[i].kind === "directory") entries.push(...await tx.children(entries[i].path));
      for (const entry of entries) {
        const content = entry.kind === "file" ? await tx.readContent(entry.path) : undefined;
        if (entry.kind === "file" && content === undefined) throw new FileSystemError("storage", `Missing file content: ${displayPath(entry.path)}`);
        await tx.removeNode(entry.path);
        await tx.save({ ...entry, path: target + entry.path.slice(source.length), revision: entry.revision + 1, updatedAt: Date.now() }, content);
      }
    });
  }
}

export class MemoryFileSystem extends BaseFileSystem {
  private nodes = new Map<string, FileStat>();
  private contents = new Map<string, string>();
  private used?: Usage;
  private pending: Promise<unknown> = Promise.resolve();
  protected transaction<T>(write: boolean, operation: (tx: FileTransaction) => Promise<T>): Promise<T> {
    const result = this.pending.then(async () => {
      const nodes = new Map(this.nodes), contents = new Map(this.contents);
      let usage = this.used && { ...this.used };
      const result = await operation({
        get: async path => { const node = nodes.get(path); return node && { ...node }; },
        children: async path => [...nodes.values()].filter(node => parent(node.path) === path).map(node => ({ ...node })),
        put: async node => { nodes.set(node.path, { ...node }); },
        delete: async path => { nodes.delete(path); contents.delete(path); },
        readContent: async path => contents.get(path),
        writeContent: async (path, content) => { contents.set(path, content); },
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
      const opening = this.factory.open(VFS_DATABASE, 1);
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
  protected async transaction<T>(write: boolean, operation: (tx: FileTransaction) => Promise<T>): Promise<T> {
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
