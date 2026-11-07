import { FileSystemError, VFS_HOME, resolvePath, type VirtualFileSystem } from "./fs";
import { DEFAULT_BIN_TOOLS, BIN_DIRECTORY, BIN_MANIFEST_DIRECTORY, installDefaultBin } from "./bin-defaults";
import { INITIAL_WORKSPACE_FILES, INITIAL_WORKSPACE_DIRECTORIES } from "./workspace-template";

export const VFS_SKILLS = `${VFS_HOME}/skills`;
export const TOOL_CATALOG_START = "<!-- agent-go-round:tools:start -->";
export const TOOL_CATALOG_END = "<!-- agent-go-round:tools:end -->";
export const DEFAULT_AGENT_RULES = INITIAL_WORKSPACE_FILES.find(file => file.path === `${VFS_HOME}/agents.md`)!.content;
export const DEFAULT_TOOL_CATALOG = DEFAULT_AGENT_RULES.slice(DEFAULT_AGENT_RULES.indexOf(TOOL_CATALOG_START), DEFAULT_AGENT_RULES.indexOf(TOOL_CATALOG_END) + TOOL_CATALOG_END.length);
const DEFAULT_BIN_PATHS = new Set(DEFAULT_BIN_TOOLS.flatMap(tool => [resolvePath(`${BIN_DIRECTORY}/${tool.name}.js`), resolvePath(`${BIN_MANIFEST_DIRECTORY}/${tool.name}.tool.json`)]));

/** Product defaults belong to the workspace, not the filesystem implementation. */
export async function initializeWorkspace(fs: VirtualFileSystem, options: { reset?: boolean } = {}): Promise<void> {
  // New workspaces and explicit resets use exactly the same atomic seed operation.
  if (await fs.replaceWorkspace(INITIAL_WORKSPACE_FILES, INITIAL_WORKSPACE_DIRECTORIES, { onlyIfEmpty: !options.reset })) return;
  for (const directory of INITIAL_WORKSPACE_DIRECTORIES) await fs.mkdir(directory, { recursive: true });
  await installDefaultBin(fs);
  for (const file of INITIAL_WORKSPACE_FILES) {
    if (file.path === `${VFS_HOME}/agents.md` || DEFAULT_BIN_PATHS.has(file.path)) continue;
    try { await fs.writeFile(file.path, file.content, { expectedRevision: 0 }); }
    catch (error) { if (!(error instanceof FileSystemError) || error.code !== "conflict") throw error; }
  }
  const entries = await fs.listDirectory("~");
  const instructions = entries.filter(entry => /\/(?:AGENTS|agents)\.md$/.test(entry.path));
  // Preserve personal instructions; update only our marked tool catalog.
  if (instructions.length > 1) return; // Context loading reports the ambiguity.
  const file = instructions.length ? await fs.readFile(instructions[0].path) : undefined;
  const content = file
    ? file.content.includes(TOOL_CATALOG_START) && file.content.includes(TOOL_CATALOG_END)
      ? file.content.slice(0, file.content.indexOf(TOOL_CATALOG_START)) + DEFAULT_TOOL_CATALOG + file.content.slice(file.content.indexOf(TOOL_CATALOG_END) + TOOL_CATALOG_END.length)
      : `${file.content.trimEnd()}\n\n${DEFAULT_TOOL_CATALOG}`
    : DEFAULT_AGENT_RULES;
  if (file?.content === content) return;
  try { await fs.writeFile(file?.path ?? "~/agents.md", content, { expectedRevision: file?.revision ?? 0 }); }
  catch (error) { if (!(error instanceof FileSystemError) || error.code !== "conflict") throw error; }
}
