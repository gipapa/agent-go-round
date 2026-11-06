import { executeFileCapability, FILE_METHODS, BIN_CAPABILITIES, type BinCapability, type FileMethod, type BinFileAccess } from "./file-capabilities";
import { validateToolArguments, type TSchema } from "@earendil-works/pi-ai";
import { BIN_DIRECTORY, BIN_MANIFEST_DIRECTORY, type BinManifest } from "./bin-defaults";
import { VFS_HOME, resolvePath, type FileNode, type VirtualFileSystem } from "./fs";
import { ToolOutcomeUnknownError, type SessionTool, type FileReadRange } from "./session";
import type { BinExecutor } from "./bin-sandbox";
import { commandHelp } from "./shell-help";
import { AGENTS_PARAMETERS } from "./tab-agents";

type LoadedBin = { manifest: BinManifest; source: string };
export type { BinFileAccess } from "./file-capabilities";
export const NO_HOST_PAGE = "目前沒有連接宿主頁，請從 Host page 開啟 popup。";
export type BinHostContext = { sessionId?: string; toolCallId?: string; tabId?: string };
export class BinRegistry {
  private tools = new Map<string, LoadedBin>();
  constructor(readonly fs: VirtualFileSystem, private readonly executor: BinExecutor, private readonly services: {
    readHostPage?: (args: { offset?: number; limit?: number }, signal: AbortSignal, context: BinHostContext) => Promise<unknown>;
    tabAgents?: (args: unknown, signal: AbortSignal, context: BinHostContext) => Promise<unknown>;
    openPreview?: (entry: string, signal: AbortSignal, context: BinHostContext) => Promise<unknown>;
  } = {}) {}

  /** Atomically replace the catalog; tools already registered in a run keep immutable definitions. */
  async reload(): Promise<void> {
    const next = new Map<string, LoadedBin>();
    const files = await this.fs.listDirectory(BIN_MANIFEST_DIRECTORY);
    for (const file of files) {
      if (file.kind !== "file" || !file.path.toLowerCase().endsWith(".tool.json")) continue;
      if (next.size >= 64) throw new Error("Bin catalog exceeds 64 tools");
      const metadata = await this.fs.readFile(file.path);
      if (metadata.content.length > 16_000) throw new Error(`Tool manifest is too large: ${file.path}`);
      const manifest = JSON.parse(metadata.content) as BinManifest;
      if (manifest.version !== 1 || typeof manifest.name !== "string" || !/^[a-z][a-z0-9_]{0,63}$/i.test(manifest.name) || file.path.split("/").pop()!.toLowerCase() !== `${manifest.name.toLowerCase()}.tool.json`) throw new Error(`Invalid tool identity: ${file.path}`);
      if (typeof manifest.description !== "string" || !manifest.description.trim() || manifest.description.length > 2000) throw new Error(`Invalid tool description: ${file.path}`);
      if (!manifest.parameters || (manifest.parameters as { type?: string }).type !== "object" || !Array.isArray(manifest.capabilities) || manifest.capabilities.some((value) => !BIN_CAPABILITIES.includes(value))) throw new Error(`Invalid tool schema or capabilities: ${file.path}`);
      const source = await this.fs.readFile(`${BIN_DIRECTORY}/${manifest.name}.js`);
      if (!source.content.trim() || source.content.length > 64_000) throw new Error(`Invalid tool source: ${source.path}`);
      const key = manifest.name.toLowerCase();
      if (next.has(key)) throw new Error(`Duplicate tool name (case-insensitive): ${manifest.name}`);
      next.set(key, { manifest, source: source.content });
    }
    this.tools = next;
  }

  list(): readonly BinManifest[] { return [...this.tools.values()].map(({ manifest }) => structuredClone(manifest)); }

  async execute(name: string, args: unknown, cwd = VFS_HOME, signal?: AbortSignal, context: BinHostContext = {}): Promise<unknown> {
    const definition = this.tools.get(name.toLowerCase());
    if (!definition) throw new Error(`Command not found in ~/bin: ${name}`);
    return this.executeDefinition(definition, args, cwd, signal, undefined, undefined, context);
  }

  private async executeDefinition(definition: LoadedBin, args: unknown, cwd: string, signal?: AbortSignal, onAccess?: (access: BinFileAccess) => void, loadSkill?: (name: string, signal: AbortSignal) => Promise<unknown>, context: BinHostContext = {}, onCwd?: (cwd: string) => void): Promise<unknown> {
    const { manifest, source } = definition;
    const name = manifest.name;
    const validated = validateToolArguments({ name, description: manifest.description, parameters: manifest.parameters as TSchema }, { type: "toolCall", id: "bin", name, arguments: args as Record<string, unknown> });
    let active = true;
    let mutations = 0;
    let tabDispatchStarted = false;
    let tabRequestId: string | undefined;
    const reads: FileNode[] = [];
    const execution = new AbortController();
    const abort = () => execution.abort();
    if (signal?.aborted) abort(); else signal?.addEventListener("abort", abort, { once: true });
    const accessed = (access: BinFileAccess) => { if (active && !execution.signal.aborted) onAccess?.(access); };
    const rpc = async (method: BinCapability, values: unknown[]): Promise<unknown> => {
      if (!active || execution.signal.aborted) throw new Error("Tool cancelled");
      if (!manifest.capabilities.includes(method) || !BIN_CAPABILITIES.includes(method)) throw new Error(`Tool lacks filesystem capability: ${method}`);
      if (method === "home" || method === "reloadTools") {
        if (!Array.isArray(values) || values.length) throw new Error(`Invalid ${method} arguments`);
        if (method === "home") {
          if (!onCwd) throw new Error("Agent working directory unavailable");
          onCwd(VFS_HOME);
          return { cwd: VFS_HOME };
        }
        await this.reload();
        return { tools: this.list().map(tool => tool.name), message: "AI tools reloaded. New definitions apply on the next run; running calls keep their original definitions." };
      }
      if (method === "openPreview") {
        if (!Array.isArray(values) || values.length > 1 || values[0] !== undefined && (typeof values[0] !== "string" || !values[0].length || values[0].length > 1024)) throw new Error("Invalid preview path");
        if (!this.services.openPreview) throw new Error("Preview UI unavailable");
        return this.services.openPreview(resolvePath((values[0] as string | undefined) ?? "~/main.html", cwd), execution.signal, context);
      }
      if (method === "tabAgents") {
        if (!Array.isArray(values) || values.length !== 1) throw new Error("Invalid agents arguments");
        const options = validateToolArguments({ name: "agents", description: "Cross-tab agents", parameters: AGENTS_PARAMETERS }, { type: "toolCall", id: "agents-rpc", name: "agents", arguments: values[0] as Record<string, unknown> });
        if (!this.services.tabAgents) throw new Error("Cross-tab agent runtime unavailable");
        const result = await this.services.tabAgents(options, execution.signal, context);
        if ((options as { action: string }).action === "send") {
          const requestId = (result as { requestId?: string }).requestId;
          if (requestId) { tabRequestId = requestId; tabDispatchStarted = true; }
        }
        return result;
      }
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
      if (!(FILE_METHODS as readonly string[]).includes(method)) throw new Error(`Unknown file capability: ${method}`);
      return executeFileCapability(method as FileMethod, values, {
        fs: this.fs, cwd, onAccess: accessed, onRead: file => reads.push(file),
        async mutation(operation) {
          mutations++;
          try { return await operation(); } catch (error) { mutations--; throw error; }
        }
      });
    };
    try {
      const result = await this.executor.execute(source, validated, rpc, execution.signal);
      // An RPC read alone does not prove the tool returned the content to the model.
      const output = result as { files?: unknown[] } | null;
      const items = output && Array.isArray(output.files) ? output.files : [result];
      for (const file of reads) {
        let readRange: FileReadRange | undefined;
        for (const item of items) {
          if (!item || typeof item !== "object") continue;
          const returned = item as { path?: unknown; revision?: unknown; content?: unknown; totalLines?: unknown; nextOffset?: unknown };
          if (returned.path !== file.path || returned.revision !== file.revision || typeof returned.content !== "string") continue;
          const lines = file.content.split("\n");
          if (returned.totalLines === undefined && returned.content === file.content) {
            readRange = { startLine: 1, endLine: lines.length, totalLines: lines.length };
          } else if (returned.totalLines === lines.length) {
            const startLine = (validated as { offset?: number }).offset ?? 1;
            const endLine = startLine + returned.content.split("\n").length - 1;
            if (startLine >= 1 && endLine <= lines.length && returned.content === lines.slice(startLine - 1, endLine).join("\n") && returned.nextOffset === (endLine < lines.length ? endLine + 1 : undefined)) {
              readRange = { startLine, endLine, totalLines: lines.length };
            }
          }
        }
        if (readRange) accessed({ method: "readFile", path: file.path, revision: file.revision, readRange });
      }
      return result;
    }
    catch (error) {
      if (tabDispatchStarted) throw new ToolOutcomeUnknownError(`Cross-tab dispatch did not finish. The target may still be running; use agents ${tabRequestId ? `read with requestId ${tabRequestId}` : "list to recover the requestId"} before considering another send. ${error instanceof Error ? error.message : String(error)}`);
      if (mutations > 0) throw new ToolOutcomeUnknownError(`Tool did not finish after a filesystem mutation; read back before retrying. ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    } finally { active = false; execution.abort(); signal?.removeEventListener("abort", abort); }
  }

  sessionTools(cwd: string | (() => string) = VFS_HOME, onAccess?: (access: BinFileAccess, toolCallId: string) => void, loadSkill?: (name: string, toolCallId: string, signal: AbortSignal) => Promise<unknown>, sessionId?: string, onCwd?: (cwd: string) => void): SessionTool[] {
    return [...this.tools.values()].map((definition) => {
      const { manifest } = definition;
      return {
      name: manifest.name, label: manifest.name, description: manifest.description, parameters: manifest.parameters,
      execute: async (id, args, signal) => {
        const result = await this.executeDefinition(definition, args, typeof cwd === "function" ? cwd() : cwd, signal, (access) => onAccess?.(access, id), loadSkill ? (name, executionSignal) => loadSkill(name, id, executionSignal) : undefined, { sessionId, toolCallId: id }, onCwd);
        return { content: [{ type: "text", text: JSON.stringify(result) ?? "null" }], details: result };
      }
    }; });
  }
}
