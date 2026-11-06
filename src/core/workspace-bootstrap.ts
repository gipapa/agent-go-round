import { FileSystemError, VFS_HOME, type VirtualFileSystem } from "./fs";

export const VFS_SKILLS = `${VFS_HOME}/skills`;
export const TOOL_CATALOG_START = "<!-- agent-go-round:tools:start -->";
export const TOOL_CATALOG_END = "<!-- agent-go-round:tools:end -->";
export const DEFAULT_TOOL_CATALOG = `${TOOL_CATALOG_START}
## 工具使用入口

優先使用 bash 處理一般檔案操作；需要 revision、完整讀取證據、原子寫入或精確替換時使用 read/write/edit。
工具資訊按需查詢：help({}) 列出工具；help({command: "工具名稱"}) 取得用途與 JSON schema；help({command: "bash"}) 取得可用指令、內建與限制。Shell 內建說明使用 bash({script: "help"})。
指令及工具名稱不分大小寫；路徑、變數、參數內容與 JSON 欄位保留大小寫。技能先用 skill_load 載入，再讀取引用資源。
${TOOL_CATALOG_END}`;
export const DEFAULT_AGENT_RULES = `請回覆繁體中文\n\n${DEFAULT_TOOL_CATALOG}`;

/** Product defaults belong to the workspace, not the filesystem implementation. */
export async function initializeWorkspace(fs: VirtualFileSystem): Promise<void> {
  await fs.mkdir(VFS_SKILLS, { recursive: true });
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
