import type { BinRegistry } from "./bin";
import { BASH_PARAMETERS, BASH_DESCRIPTION } from "./bash-tool";
import { SHELL_COMMANDS, SHELL_BUILTINS } from "./shell-catalog";

export const SHELL_NOTICE = "just-bash：指令名稱不分大小寫；變數、路徑與參數保留大小寫，支援引號、管線、重導向、glob 與控制流程。\n每次送出獨立 script，跨送出僅保存 cwd；變數、函式、alias、options 與 $? 不延續。~／HOME 為 /home/user，/ 是工作區虛擬根。\n使用 AI／Shell toggle、新分頁、History 與 Workspace 選單操作對話、預覽和工具。Shell 的 read／help 使用上游定義；AI 的結構化工具不提供 JSON CLI。\n不支援網路、Node／Python、任意系統 binary、hard links、gzip codecs 或 sqlite3。Stop 會終止 Worker；已提交寫入可能保留，狀態不確定時先讀回。";

export type HelpTool = { name: string; description: string; parameters: unknown };
/** AI tool schemas are app data; the shell's help/read stay upstream builtins. */
export function commandHelp(command: string | undefined, bin: BinRegistry, extraTools: readonly HelpTool[] = []): string {
  const local = [{ name: "bash", description: BASH_DESCRIPTION, parameters: BASH_PARAMETERS }, ...bin.list().filter(tool => tool.name !== "bash")];
  const tools = [...local, ...extraTools.filter(extra => !local.some(tool => tool.name === extra.name))];
  if (!command) return `${SHELL_NOTICE}\n\nAI tools: ${tools.map(tool => tool.name).join(", ")}\nUse help({command: "tool name"}) for descriptions and JSON schemas; help({command: "bash"}) includes shell commands and builtins.\nCustom tools: ~/bin/<name>.js and ~/bin/manifests/<name>.tool.json; use Workspace → Reload AI tools after changes. Names are case-insensitive and cannot duplicate another tool or replace bash.`;
  const tool = tools.find(tool => tool.name.toLowerCase() === command.toLowerCase());
  if (!tool) throw new Error(`Unknown AI tool: ${command}. Use shell help for Bash builtins.`);
  const shell = tool.name === "bash" ? `\nCommands: ${SHELL_COMMANDS.join(", ")}\nBuiltins: ${SHELL_BUILTINS.join(", ")}\nSome job-control builtins are virtual or unsupported. Use bash({script: "help"}) for builtin behavior; shell read/help differ from structured AI tools. User bin JS tools are not shell executables.` : "";
  return `${tool.description}${shell}\nJSON arguments:\n${JSON.stringify(tool.parameters, null, 2)}`;
}
