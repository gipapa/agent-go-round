import { FileSystemError, VFS_HOME, type VirtualFileSystem } from "./fs";

export const VFS_SKILLS = `${VFS_HOME}/skills`;
export const DEFAULT_AGENT_RULES = "請回覆繁體中文";

/** Product defaults belong to the workspace, not the filesystem implementation. */
export async function initializeWorkspace(fs: VirtualFileSystem): Promise<void> {
  await fs.mkdir(VFS_SKILLS, { recursive: true });
  const entries = await fs.listDirectory("~");
  if (entries.some(entry => /\/(?:AGENTS|agents)\.md$/.test(entry.path))) return;
  try { await fs.writeFile("~/agents.md", DEFAULT_AGENT_RULES, { expectedRevision: 0 }); }
  catch (error) { if (!(error instanceof FileSystemError) || error.code !== "conflict") throw error; }
}
