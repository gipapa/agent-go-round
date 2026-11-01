import { validateToolArguments, type TSchema } from "@earendil-works/pi-ai";
import { BIN_DIRECTORY, BIN_MANIFEST_DIRECTORY, migrateBinManifests, BIN_CAPABILITIES, type BinManifest, type FileMethod, type BinCapability } from "./bin-defaults";
import { resolvePath, VFS_HOME, type VirtualFileSystem } from "./fs";
import { ToolOutcomeUnknownError, type SessionTool } from "./session";
import type { BinExecutor } from "./bin-sandbox";
import { commandHelp } from "./shell-help";

type LoadedBin = { manifest: BinManifest; source: string };
export type BinFileAccess = { method: FileMethod; path: string; revision?: number };
export const NO_HOST_PAGE = "目前沒有連接宿主頁，請從 Host page 開啟 popup。";
export type BinHostContext = { sessionId?: string; toolCallId?: string };
export class BinRegistry {
  private tools = new Map<string, LoadedBin>();
  constructor(readonly fs: VirtualFileSystem, private readonly executor: BinExecutor, private readonly services: {
    readHostPage?: (args: { offset?: number; limit?: number }, signal: AbortSignal, context: BinHostContext) => Promise<unknown>;
  } = {}) {}

  /** Load source + metadata once while idle; a running tool sees an immutable definition. */
  async reload(): Promise<void> {
    await migrateBinManifests(this.fs);
    const next = new Map<string, LoadedBin>();
    const files = await this.fs.listDirectory(BIN_MANIFEST_DIRECTORY);
    for (const file of files) {
      if (file.kind !== "file" || !file.path.endsWith(".tool.json")) continue;
      if (next.size >= 64) throw new Error("Bin catalog exceeds 64 tools");
      const metadata = await this.fs.readFile(file.path);
      if (metadata.content.length > 16_000) throw new Error(`Tool manifest is too large: ${file.path}`);
      const manifest = JSON.parse(metadata.content) as BinManifest;
      if (manifest.version !== 1 || typeof manifest.name !== "string" || !/^[a-z][a-z0-9_]{0,63}$/.test(manifest.name) || file.path.split("/").pop() !== `${manifest.name}.tool.json`) throw new Error(`Invalid tool identity: ${file.path}`);
      if (typeof manifest.description !== "string" || !manifest.description.trim() || manifest.description.length > 2000) throw new Error(`Invalid tool description: ${file.path}`);
      if (!manifest.parameters || (manifest.parameters as { type?: string }).type !== "object" || !Array.isArray(manifest.capabilities) || manifest.capabilities.some((value) => !BIN_CAPABILITIES.includes(value))) throw new Error(`Invalid tool schema or capabilities: ${file.path}`);
      const source = await this.fs.readFile(`${BIN_DIRECTORY}/${manifest.name}.js`);
      if (!source.content.trim() || source.content.length > 64_000) throw new Error(`Invalid tool source: ${source.path}`);
      next.set(manifest.name, { manifest, source: source.content });
    }
    this.tools = next;
  }

  list(): readonly BinManifest[] { return [...this.tools.values()].map(({ manifest }) => structuredClone(manifest)); }

  async execute(name: string, args: unknown, cwd = VFS_HOME, signal?: AbortSignal): Promise<unknown> {
    const definition = this.tools.get(name);
    if (!definition) throw new Error(`Command not found in ~/bin: ${name}`);
    return this.executeDefinition(definition, args, cwd, signal);
  }

  private async executeDefinition(definition: LoadedBin, args: unknown, cwd: string, signal?: AbortSignal, onAccess?: (access: BinFileAccess) => void, loadSkill?: (name: string, signal: AbortSignal) => Promise<unknown>, context: BinHostContext = {}): Promise<unknown> {
    const { manifest, source } = definition;
    const name = manifest.name;
    const validated = validateToolArguments({ name, description: manifest.description, parameters: manifest.parameters as TSchema }, { type: "toolCall", id: "bin", name, arguments: args as Record<string, unknown> });
    let active = true;
    let mutations = 0;
    const execution = new AbortController();
    const abort = () => execution.abort();
    if (signal?.aborted) abort(); else signal?.addEventListener("abort", abort, { once: true });
    const accessed = (access: BinFileAccess) => { if (active && !execution.signal.aborted) onAccess?.(access); };
    const rpc = async (method: BinCapability, values: unknown[]): Promise<unknown> => {
      if (!active || execution.signal.aborted) throw new Error("Tool cancelled");
      if (!manifest.capabilities.includes(method) || !BIN_CAPABILITIES.includes(method)) throw new Error(`Tool lacks filesystem capability: ${method}`);
      if (method === "commandHelp") {
        if (!Array.isArray(values) || values[0] !== undefined && typeof values[0] !== "string") throw new Error("Invalid help arguments");
        return commandHelp(values[0] as string | undefined, this);
      }
      if (method === "readHostPage") {
        const range = values?.[0] as { offset?: unknown; limit?: unknown } | undefined;
        if (!range || typeof range !== "object" || Array.isArray(range) || Object.keys(range).some(key => key !== "offset" && key !== "limit") || range.offset !== undefined && (!Number.isInteger(range.offset) || (range.offset as number) < 0) || range.limit !== undefined && (!Number.isInteger(range.limit) || (range.limit as number) < 1 || (range.limit as number) > 64000)) throw new Error("Invalid host page range");
        if (!this.services.readHostPage) throw new Error(NO_HOST_PAGE);
        return this.services.readHostPage(range as { offset?: number; limit?: number }, execution.signal, context);
      }
      if (method === "loadSkill") {
        if (!Array.isArray(values) || typeof values[0] !== "string" || !loadSkill) throw new Error("Skill runtime unavailable; enter Pi to load a catalog skill");
        return loadSkill(values[0], execution.signal);
      }
      if (method === "writeFiles") {
        if (!Array.isArray(values) || !Array.isArray(values[0]) || !values[0].length || values[0].length > 32) throw new Error("Invalid file write batch");
        const files = values[0].map((entry: { path?: unknown; content?: unknown; expectedRevision?: unknown }) => {
          if (!entry || typeof entry.path !== "string" || typeof entry.content !== "string" || (entry.expectedRevision !== undefined && (!Number.isInteger(entry.expectedRevision) || (entry.expectedRevision as number) < 0))) throw new Error("Invalid file in write batch");
          return { path: resolvePath(entry.path, cwd), content: entry.content, expectedRevision: entry.expectedRevision as number | undefined };
        });
        mutations++;
        try {
          const result = await this.fs.writeFiles(files);
          for (const file of result) accessed({ method: "writeFile", path: file.path, revision: file.revision });
          return result;
        } catch (error) { mutations--; throw error; }
      }
      if (!Array.isArray(values) || typeof values[0] !== "string") throw new Error("Invalid filesystem arguments");
      const path = resolvePath(values[0], cwd);
      if (method === "stat") { const node = await this.fs.stat(path); return { ...node, content: "" }; }
      if (method === "listDirectory") return (await this.fs.listDirectory(path)).map((node) => ({ ...node, content: "" }));
      if (method === "readFile") {
        const file = await this.fs.readFile(path);
        accessed({ method, path, revision: file.revision });
        return file;
      }
      // Validate in the trusted host, not only inside user-editable JS.
      if (method === "writeFile") {
        if (typeof values[1] !== "string") throw new Error("File content must be text");
        const options = values[2] as { expectedRevision?: unknown } | undefined;
        const expectedRevision = options?.expectedRevision;
        if (expectedRevision !== undefined && (!Number.isInteger(expectedRevision) || (expectedRevision as number) < 0)) throw new Error("Invalid expectedRevision");
        mutations++;
        try {
          const file = await this.fs.writeFile(path, values[1], { expectedRevision: expectedRevision as number | undefined });
          accessed({ method, path, revision: file.revision });
          return file;
        }
        catch (error) { mutations--; throw error; }
      }
      mutations++;
      try {
        if (method === "mkdir") return await this.fs.mkdir(path, { recursive: (values[1] as { recursive?: unknown } | undefined)?.recursive === true });
        return await this.fs.remove(path);
      } catch (error) { mutations--; throw error; }
    };
    try { return await this.executor.execute(source, validated, rpc, execution.signal); }
    catch (error) {
      if (mutations > 0) throw new ToolOutcomeUnknownError(`Tool did not finish after a filesystem mutation; read back before retrying. ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    } finally { active = false; execution.abort(); signal?.removeEventListener("abort", abort); }
  }

  sessionTools(cwd: string | (() => string) = VFS_HOME, onAccess?: (access: BinFileAccess, toolCallId: string) => void, loadSkill?: (name: string, toolCallId: string, signal: AbortSignal) => Promise<unknown>, sessionId?: string): SessionTool[] {
    return [...this.tools.values()].map((definition) => {
      const { manifest } = definition;
      return {
      name: manifest.name, label: manifest.name, description: manifest.description, parameters: manifest.parameters,
      execute: async (id, args, signal) => {
        const result = await this.executeDefinition(definition, args, typeof cwd === "function" ? cwd() : cwd, signal, (access) => onAccess?.(access, id), loadSkill ? (name, executionSignal) => loadSkill(name, id, executionSignal) : undefined, { sessionId, toolCallId: id });
        return { content: [{ type: "text", text: JSON.stringify(result) ?? "null" }], details: result };
      }
    }; });
  }
}
