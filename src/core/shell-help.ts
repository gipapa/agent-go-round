import { SHELL_COMMANDS, commandDefinition } from "./command-definitions";
import type { BinRegistry } from "./bin";

export const SHELL_NOTICE = "簡易 bash：操作目前工作區的虛擬檔案。指令名稱不分大小寫，路徑與內容保留大小寫。\n檔案工具：read／cat、write、edit、grep、find、ls。\n其他指令：pwd、cd、mkdir、touch、rm、rmdir、mv、preview、history、agents、clear、help、rehash、restore-bin、demo jokes。\n輸入 ai 啟動 agent；ai --new 開新對話，ai --resume ID 接續歷史。\nhelp COMMAND 或 COMMAND --help 查看語法、選項與簡化範圍。不支援管線、重導向或作業系統程式。";


export type HelpTool = { name: string; description: string; parameters: unknown };
export function commandHelp(command: string | undefined, bin: BinRegistry, extraTools: readonly HelpTool[] = []): string {
  const local = bin.list();
  const tools = [...local, ...extraTools.filter(extra => !local.some(tool => tool.name === extra.name))];
  if (!command) return `${SHELL_NOTICE}\n\n${SHELL_COMMANDS.help.help}\n\n可用工具：${tools.map(tool => tool.name).join(", ")}`;
  const name = command.toLowerCase();
  const tool = tools.find(tool => tool.name.toLowerCase() === name);
  if (!commandDefinition(name) && !tool) throw new Error(`Command not found: ${command}; use help`);
  return [commandDefinition(name)?.help, tool && `${tool.description}\nJSON arguments:\n${JSON.stringify(tool.parameters, null, 2)}`].filter(Boolean).join("\n\n");
}

export function requestedHelp(words: string[], bin: BinRegistry, extraTools: readonly HelpTool[] = []): string | undefined {
  const name = words[0]?.toLowerCase();
  if (name === "help") {
    if (words.length > 2) throw new Error("Usage: help [COMMAND]");
    return commandHelp(/^(--help|—help|–help)$/i.test(words[1] ?? "") ? "help" : words[1], bin, extraTools);
  }
  if (words.length === 2 && /^(--help|—help|–help)$/i.test(words[1])) return commandHelp(name, bin, extraTools);
  return undefined;
}
