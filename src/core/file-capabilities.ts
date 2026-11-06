import { FileSystemError, resolvePath, type FileNode, type VirtualFileSystem } from "./fs";
import type { FileReadRange } from "./session";

export const FILE_METHODS = ["stat", "readFile", "listDirectory", "writeFile", "writeFiles", "mkdir", "remove"] as const satisfies readonly (keyof VirtualFileSystem)[];
export type FileMethod = typeof FILE_METHODS[number];
export const BIN_CAPABILITIES = [...FILE_METHODS, "loadSkill", "readHostPage", "commandHelp", "tabAgents", "home", "reloadTools"] as const;
export type BinCapability = typeof BIN_CAPABILITIES[number];
export type BinFileAccess = { method: FileMethod; path: string; revision?: number; readRange?: FileReadRange };
export type FileCapabilityArguments = { [K in FileMethod]: Parameters<VirtualFileSystem[K]> };
export type FileCapabilityResults = { [K in FileMethod]: Awaited<ReturnType<VirtualFileSystem[K]>> };
type CapabilityContext = {
  fs: VirtualFileSystem; cwd: string;
  onAccess(access: BinFileAccess): void;
  onRead(file: FileNode): void;
  mutation<T>(operation: () => Promise<T>): Promise<T>;
};
function revision(value: unknown): number | undefined {
  if (value !== undefined && (!Number.isInteger(value) || (value as number) < 0)) throw new Error("Invalid expectedRevision");
  return value as number | undefined;
}

async function writeWithGuidance<T>(operation: () => Promise<T>): Promise<T> {
  try { return await operation(); }
  catch (error) {
    if (error instanceof FileSystemError && error.code === "conflict") {
      throw new FileSystemError("conflict", `${error.message}. No file contents were written. Call read with the target path, inspect the current content, then pass its returned revision as expectedRevision in write (per file for a batch). Omitted expectedRevision or 0 in write means create only. Do not retry the same write unchanged.`);
    }
    throw error;
  }
}

/** Validate untrusted worker messages in the host before calling the typed VFS. */
export async function executeFileCapability(method: FileMethod, values: unknown[], context: CapabilityContext): Promise<FileCapabilityResults[FileMethod]> {
  const { fs, cwd, onAccess, onRead, mutation } = context;
  if (!Array.isArray(values)) throw new Error("Invalid filesystem arguments");
  if (method === "writeFiles") {
    if (!Array.isArray(values[0]) || !values[0].length || values[0].length > 32) throw new Error("Invalid file write batch");
    const files = values[0].map((entry: { path?: unknown; content?: unknown; expectedRevision?: unknown }) => {
      if (!entry || typeof entry.path !== "string" || typeof entry.content !== "string") throw new Error("Invalid file in write batch");
      return { path: resolvePath(entry.path, cwd), content: entry.content, expectedRevision: revision(entry.expectedRevision) };
    });
    const result = await mutation(() => writeWithGuidance(() => fs.writeFiles(files)));
    for (const file of result) onAccess({ method: "writeFile", path: file.path, revision: file.revision });
    return result;
  }
  if (typeof values[0] !== "string") throw new Error("Invalid filesystem arguments");
  const path = resolvePath(values[0], cwd);
  switch (method) {
    case "stat": return fs.stat(path);
    case "listDirectory": return fs.listDirectory(path);
    case "readFile": {
      const file = await fs.readFile(path);
      onAccess({ method, path, revision: file.revision }); onRead(file); return file;
    }
    case "writeFile": {
      if (typeof values[1] !== "string") throw new Error("File content must be text");
      const content = values[1], options = values[2] as { expectedRevision?: unknown } | undefined;
      const expectedRevision = revision(options?.expectedRevision);
      const file = await mutation(() => writeWithGuidance(() => fs.writeFile(path, content, { expectedRevision })));
      onAccess({ method, path, revision: file.revision }); return file;
    }
    case "mkdir": return mutation(() => fs.mkdir(path, { recursive: (values[1] as { recursive?: unknown } | undefined)?.recursive === true }));
    case "remove": return mutation(() => fs.remove(path));
    default: { const unsupported: never = method; throw new Error(`Unknown file capability: ${unsupported}`); }
  }
}
