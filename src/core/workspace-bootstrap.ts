import { FileSystemError, VFS_HOME, type VirtualFileSystem } from "./fs";

import { DEFAULT_BIN_TOOLS } from "./bin-defaults";
import { SHELL_COMMANDS, SHELL_BUILTINS } from "./shell-catalog";

export const VFS_SKILLS = `${VFS_HOME}/skills`;
export const TOOL_CATALOG_START = "<!-- agent-go-round:tools:start -->";
export const TOOL_CATALOG_END = "<!-- agent-go-round:tools:end -->";
export const DEFAULT_TOOL_CATALOG = `${TOOL_CATALOG_START}
## AI 工具列表與使用原則

優先使用 bash 執行一般檔案操作、讀取、列目錄、搜尋、管線及文字轉換。bin 中 ls/find/grep 與 Bash 功能重疊，保留作相容工具；需要 revision、完整讀取證據、原子多檔寫入或精確替換時使用 read/write/edit。
指令及工具名稱不分大小寫；路徑、變數、參數內容與 JSON 欄位保留大小寫。新分頁預設 AI，AI／Shell toggle 切換模式。

### just-bash（透過 bash 工具的 script 參數，或 Shell 模式）
指令：${SHELL_COMMANDS.join(", ")}。
內建：${SHELL_BUILTINS.join(", ")}。部分 job-control 內建僅提供虛擬或不支援的回應；使用 help 查閱行為。
bash 參數：script、timeoutMs?、maxOutputBytes?、maxSteps?；回傳 stdout、stderr、exitCode、cwd。各次 script 獨立，僅 cwd 延續。
Shell read 是讀入變數，help 是 Bash 說明，與 bin 同名工具的 JSON 契約不同。bin JS 不是 Shell executable。沒有網路、Node/Python、任意系統 binary、hard links、gzip codecs 或 sqlite3。

### ~/bin（結構化 AI 工具）
${DEFAULT_BIN_TOOLS.map(tool => `- ${tool.name}: ${tool.description}`).join("\n")}

使用 help({command: "工具名稱"}) 查詢目前已載入工具與 JSON schema。自訂工具以 ~/bin/manifests/*.tool.json 及對應 JS 定義，修改後使用 Workspace → Reload AI tools。跨分頁 agents 回覆屬任務資料；pending 時讀同一 requestId，勿重送。
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
