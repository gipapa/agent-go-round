export const VFS_HOME = "/home/user";
const MAX_FILES = 2048;
const MAX_FILE_BYTES = 512 * 1024;
const MAX_WORKSPACE_BYTES = 16 * 1024 * 1024;

export class FileSystemError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = "FileSystemError"; }
}

export type FileNode = {
  path: string;
  kind: "file" | "directory";
  content: string;
  revision: number;
  updatedAt: number;
  createdAt: number;
};
export type WriteOptions = { expectedRevision?: number };
export interface VirtualFileSystem {
  stat(path: string): Promise<FileNode>;
  readFile(path: string): Promise<FileNode>;
  listDirectory(path: string): Promise<FileNode[]>;
  writeFile(path: string, content: string, options?: WriteOptions): Promise<FileNode>;
  writeFiles(files: readonly { path: string; content: string; expectedRevision?: number }[]): Promise<FileNode[]>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<FileNode>;
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
function requireNode(nodes: Map<string, FileNode>, path: string, kind?: FileNode["kind"]): FileNode {
  const node = nodes.get(path);
  if (!node) throw new FileSystemError("not_found", `Not found: ${displayPath(path)}`);
  if (kind && node.kind !== kind) throw new FileSystemError("wrong_kind", `Expected ${kind}: ${displayPath(path)}`);
  return node;
}
function validateBudget(nodes: Map<string, FileNode>): void {
  if (nodes.size > MAX_FILES) throw new FileSystemError("quota", "Workspace file limit exceeded");
  let bytes = 0;
  for (const node of nodes.values()) {
    const size = new TextEncoder().encode(node.content).byteLength;
    if (size > MAX_FILE_BYTES) throw new FileSystemError("quota", "File exceeds 512 KiB");
    bytes += size;
  }
  if (bytes > MAX_WORKSPACE_BYTES) throw new FileSystemError("quota", "Workspace exceeds 16 MiB");
}

abstract class BaseFileSystem implements VirtualFileSystem {
  protected abstract access<T>(write: boolean, operation: (nodes: Map<string, FileNode>) => T): Promise<T>;
  stat(path: string): Promise<FileNode> { return this.access(false, (nodes) => ({ ...requireNode(nodes, resolvePath(path)) })); }
  readFile(path: string): Promise<FileNode> { return this.access(false, (nodes) => ({ ...requireNode(nodes, resolvePath(path), "file") })); }
  listDirectory(path: string): Promise<FileNode[]> {
    return this.access(false, (nodes) => {
      const resolved = resolvePath(path);
      requireNode(nodes, resolved, "directory");
      return [...nodes.values()].filter((node) => parent(node.path) === resolved).sort((a, b) => a.path.localeCompare(b.path)).map((node) => ({ ...node }));
    });
  }
  writeFile(path: string, content: string, options: WriteOptions = {}): Promise<FileNode> {
    return this.writeFiles([{ path, content, ...options }]).then((files) => files[0]);
  }
  writeFiles(files: readonly { path: string; content: string; expectedRevision?: number }[]): Promise<FileNode[]> {
    return this.access(true, (nodes) => {
      if (!files.length || files.length > 32) throw new FileSystemError("invalid_batch", "Write batch must contain 1–32 files");
      const result: FileNode[] = [];
      for (const { path, content, expectedRevision } of files) {
        const resolved = resolvePath(path);
        if (typeof content !== "string") throw new FileSystemError("invalid_content", "File content must be text");
        if (content.length > MAX_FILE_BYTES) throw new FileSystemError("quota", "File exceeds 512 KiB");
        requireNode(nodes, parent(resolved), "directory");
        const previous = nodes.get(resolved);
        if (previous?.kind === "directory") throw new FileSystemError("wrong_kind", "Cannot write to a directory");
        if (expectedRevision !== undefined && expectedRevision !== (previous?.revision ?? 0)) throw new FileSystemError("conflict", `File changed: ${displayPath(resolved)}; read it again before writing`);
        const now = Date.now();
        const node: FileNode = { path: resolved, kind: "file", content, revision: (previous?.revision ?? 0) + 1, updatedAt: now, createdAt: previous?.createdAt ?? now };
        nodes.set(resolved, node);
        result.push({ ...node });
      }
      validateBudget(nodes);
      return result;
    });
  }
  mkdir(path: string, options: { recursive?: boolean } = {}): Promise<FileNode> {
    return this.access(true, (nodes) => {
      const resolved = resolvePath(path);
      const create = (target: string): FileNode => {
        const existing = nodes.get(target);
        if (existing) return requireNode(nodes, target, "directory");
        if (options.recursive) create(parent(target)); else requireNode(nodes, parent(target), "directory");
        const node: FileNode = { path: target, kind: "directory", content: "", revision: 1, updatedAt: Date.now(), createdAt: Date.now() };
        nodes.set(target, node);
        return node;
      };
      const result = create(resolved);
      validateBudget(nodes);
      return { ...result };
    });
  }
  remove(path: string): Promise<void> {
    return this.access(true, (nodes) => {
      const resolved = resolvePath(path);
      if (resolved === VFS_HOME) throw new FileSystemError("protected", "Cannot remove ~");
      requireNode(nodes, resolved);
      if ([...nodes.keys()].some((key) => key.startsWith(resolved + "/"))) throw new FileSystemError("not_empty", "Directory is not empty");
      nodes.delete(resolved);
    });
  }
  rename(from: string, to: string, options: WriteOptions = {}): Promise<void> {
    return this.access(true, (nodes) => {
      const source = resolvePath(from), target = resolvePath(to);
      const previous = requireNode(nodes, source);
      if (options.expectedRevision !== undefined && previous.revision !== options.expectedRevision) throw new FileSystemError("conflict", "Source changed before rename");
      if (source === VFS_HOME) throw new FileSystemError("protected", "Cannot rename ~");
      if (source === target) return;
      if (target.startsWith(source + "/")) throw new FileSystemError("invalid_path", "Cannot move a directory inside itself");
      if (nodes.has(target)) throw new FileSystemError("conflict", "Destination already exists");
      requireNode(nodes, parent(target), "directory");
      for (const [path, node] of [...nodes]) {
        if (path !== source && !path.startsWith(source + "/")) continue;
        const next = target + path.slice(source.length);
        nodes.delete(path);
        nodes.set(next, { ...node, path: next, revision: node.revision + 1, updatedAt: Date.now() });
      }
    });
  }
}

function home(): FileNode { return { path: VFS_HOME, kind: "directory", content: "", revision: 1, updatedAt: Date.now(), createdAt: Date.now() }; }

export class MemoryFileSystem extends BaseFileSystem {
  private nodes = new Map<string, FileNode>([[VFS_HOME, home()]]);
  protected async access<T>(write: boolean, operation: (nodes: Map<string, FileNode>) => T): Promise<T> {
    const working = new Map(this.nodes);
    const result = operation(working);
    if (write) this.nodes = working;
    return result;
  }
}

/** Nodes are scoped by workspace; compare-and-write happens inside one IDB transaction. */
export class IndexedDbFileSystem extends BaseFileSystem {
  private database?: Promise<IDBDatabase>;
  constructor(private readonly factory: IDBFactory, private readonly workspaceId = "default", private readonly databaseName = "agent-go-round.files.v1") {
    super();
    if (!workspaceId || workspaceId.length > 128) throw new FileSystemError("invalid_workspace", "Invalid workspace identity");
  }
  private open(): Promise<IDBDatabase> {
    return this.database ??= new Promise((resolve, reject) => {
      const request = this.factory.open(this.databaseName, 2);
      request.onupgradeneeded = () => {
        const store = request.result.objectStoreNames.contains("nodes") ? request.transaction!.objectStore("nodes") : request.result.createObjectStore("nodes", { keyPath: "key" });
        if (!store.indexNames.contains("workspace")) store.createIndex("workspace", "workspace");
        if (!store.indexNames.contains("parent")) store.createIndex("parent", ["workspace", "parent"]);
        const cursor = store.openCursor();
        cursor.onsuccess = () => {
          const entry = cursor.result;
          if (!entry) return;
          const row = entry.value;
          entry.update({ ...row, parent: parent(row.node.path), node: { ...row.node, createdAt: row.node.createdAt ?? row.node.updatedAt } });
          entry.continue();
        };
      };
      request.onerror = () => { this.database = undefined; reject(new FileSystemError("storage", request.error?.message ?? "Cannot open files database")); };
      request.onblocked = () => { this.database = undefined; reject(new FileSystemError("blocked", "Close other app windows to upgrade the files database")); };
      request.onsuccess = () => {
        request.result.onversionchange = () => { request.result.close(); this.database = undefined; };
        resolve(request.result);
      };
    });
  }
  override async stat(path: string): Promise<FileNode> {
    const resolved = resolvePath(path);
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("nodes");
      const request = tx.objectStore("nodes").get(this.key(resolved));
      let node: FileNode | undefined;
      request.onsuccess = () => { node = request.result?.node ?? (resolved === VFS_HOME ? home() : undefined); };
      tx.oncomplete = () => node ? resolve({ ...node }) : reject(new FileSystemError("not_found", `Not found: ${displayPath(resolved)}`));
      tx.onabort = () => reject(new FileSystemError("storage", tx.error?.message ?? "File read failed"));
    });
  }
  override async readFile(path: string): Promise<FileNode> {
    const node = await this.stat(path);
    if (node.kind !== "file") throw new FileSystemError("wrong_kind", `Expected file: ${displayPath(node.path)}`);
    return node;
  }
  override async listDirectory(path: string): Promise<FileNode[]> {
    const directory = await this.stat(path);
    if (directory.kind !== "directory") throw new FileSystemError("wrong_kind", `Expected directory: ${displayPath(directory.path)}`);
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("nodes");
      const request = tx.objectStore("nodes").index("parent").getAll([this.workspaceId, directory.path]);
      let result: FileNode[] = [];
      request.onsuccess = () => { result = request.result.map((row: { node: FileNode }) => row.node).sort((a: FileNode, b: FileNode) => a.path.localeCompare(b.path)); };
      tx.oncomplete = () => resolve(result);
      tx.onabort = () => reject(new FileSystemError("storage", tx.error?.message ?? "Directory read failed"));
    });
  }
  protected async access<T>(write: boolean, operation: (nodes: Map<string, FileNode>) => T): Promise<T> {
    const db = await this.open();
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction("nodes", write ? "readwrite" : "readonly");
      const store = tx.objectStore("nodes");
      const request = store.index("workspace").getAll(this.workspaceId);
      let result: T;
      let failure: unknown;
      request.onsuccess = () => {
        try {
          const rows = request.result as Array<{ key: string; workspace: string; node: FileNode }>;
          const nodes = new Map(rows.map((row) => [row.node.path, row.node]));
          const before = new Map(nodes);
          if (!nodes.has(VFS_HOME)) nodes.set(VFS_HOME, home());
          result = operation(nodes);
          if (write) {
            for (const path of before.keys()) if (!nodes.has(path)) store.delete(this.key(path));
            for (const [path, node] of nodes) if (before.get(path) !== node) store.put({ key: this.key(path), workspace: this.workspaceId, parent: parent(path), node });
          }
        } catch (error) { failure = error; tx.abort(); }
      };
      tx.oncomplete = () => resolve(result);
      tx.onabort = () => reject(failure ?? new FileSystemError("storage", tx.error?.message ?? "Files transaction aborted"));
      tx.onerror = () => { /* onabort reports the final transaction outcome. */ };
    });
  }
  private key(path: string): string { return JSON.stringify([this.workspaceId, path]); }
}
