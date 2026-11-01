import type { BinRegistry } from "./bin";

export const SHELL_NOTICE = "簡易 bash：操作目前工作區的虛擬檔案。指令名稱不分大小寫，路徑與內容保留大小寫。\n檔案工具：read／cat、write、edit、grep、find、ls。\n其他指令：pwd、cd、mkdir、touch、rm、rmdir、mv、preview、history、clear、help、rehash、restore-bin、demo jokes。\n輸入 ai 啟動 agent；ai --new 開新對話，ai --resume ID 接續歷史。\nhelp COMMAND 或 COMMAND --help 查看語法、選項與簡化範圍。不支援管線、重導向或作業系統程式。";

const HELP: Record<string, string> = {
  ls: 'ls [-aA1lF] [--] [PATH…]\n列出目前目錄（預設 .）的直接子項，或指定檔案；預設隱藏點開頭的項目。\n-a 包含隱藏項目及 . / ..；-A 包含隱藏項目；-1 一行一項（預設）；-F 目錄加 /；-l 顯示 VFS 類型、UTF-8 bytes、revision、更新時間與名稱。\n沒有作業系統權限／owner metadata；不支援排序選項或萬用字元展開。JSON 形式保留原始工具結果（含隱藏檔）：ls {"path":"."}',
  cat: 'cat [-n] [--] FILE…\n讀取完整檔案正文，依指定順序串接；-n 加上行號。分頁讀取會接續至檔尾；每頁最多 200 行／64000 字元，超限會報錯，請用 read JSON 選擇較小行範圍。\n不支援 stdin、管線或重導向；使用 read 取得 revision／分頁 metadata。',
  read: 'read PATH | read JSON\n此為 VFS 讀檔工具，不是 bash 的輸入變數 read。回傳 JSON：content、revision、totalLines、nextOffset；預設最多 200 行。\n例：read {"path":"notes.md","offset":1,"limit":100}。需要全文請用 cat。',
  write: 'write PATH "CONTENT" | write JSON\n此為 VFS 擴充指令，非標準 bash。預設只建立新檔，覆寫需提供 expectedRevision。\n例：write {"path":"notes.md","content":"hello","expectedRevision":1}\n支援 files 批次與 createParents:true；換行可用 JSON 的 \\n；不支援 > 重導向。',
  edit: 'edit PATH | edit PATH "OLD" "NEW" | edit JSON\n單一路徑開啟文字編輯器；提供 OLD／NEW 則精確替換，歧義會失敗。此為 VFS 擴充指令。\nJSON 可提供 replaceAll、expectedRevision；不支援正規表示式替換。',
  grep: 'grep [-inrRFE] [--] PATTERN [PATH…] | grep JSON\n搜尋檔案內容；-i 忽略大小寫、-n 顯示行號、-r/-R 遞迴目錄、-F 純文字、-E JavaScript 正規表示式（預設）。\n未指定 PATH 時遞迴搜尋目前目錄，因為沒有 stdin；指定目錄需 -r。Shell 形式不支援多行 pattern。\n正規表示式不是 POSIX BRE；單一路徑最多 500 筆，截斷會明示。JSON 保留舊工具語意：預設 literal、遞迴、100 筆。',
  find: 'find [PATH] [-name GLOB] [-type f|d] | find JSON\n遞迴列出目前目錄（預設 .）或指定路徑，包含起點與隱藏項目。-name 匹配 basename（*、?）；-type f 檔案、d 目錄。\n例：find . -name "*.md" -type f。相容舊語法 find PATH GLOB。\n不支援 -exec、布林運算或多個起點；最多 500 筆，截斷會明示。',
  pwd: 'pwd\n顯示目前目錄的絕對路徑；工作區 home 為 /home/user（~）。不支援 symlink 或 -L/-P。',
  cd: 'cd [--] [PATH]\n切換目前 tab 的目錄；省略 PATH 回到 ~，支援 . 與 ..。不得離開工作區 ~。\n不支援 cd -、環境變數或 symlink。',
  mkdir: 'mkdir [-p] [--] DIRECTORY…\n建立目錄；-p 建立缺少的父目錄並接受既有目錄。沒有 -p 時父目錄必須存在，且目標不可已存在。\n不支援權限設定。',
  touch: 'touch [--] FILE…\n建立不存在的空檔案，保留既有內容。簡化：既有檔案的時間戳不更新；不支援時間／日期選項。',
  rm: 'rm [-rfR] [--] PATH…\n移除檔案；-r/-R 遞迴移除目錄、-f 忽略不存在的路徑。目錄必須明確使用 -r；不得刪除工作區 ~。\n不支援互動確認、glob 展開；多個路徑依序處理，不是批次交易。',
  rmdir: 'rmdir [--] DIRECTORY…\n只移除空目錄；非空目錄回報錯誤。不支援 -p。',
  mv: 'mv [--] SOURCE DEST\n移動／重新命名；DEST 是既有目錄時移入該目錄。\n簡化：只支援單一來源，既有目的檔案不覆寫；不支援 -f/-i 或跨工作區搬移。',
  ai: 'ai | ai --new | ai --resume SESSION_ID\n啟動／接續 agent；--new 另開對話；--resume 接回保存的對話。Groq 需先連線。\n在 agent 輸入 /exit 返回 shell；/skill NAME TASK 載入 skill；/skill off 清除選用。',
  preview: 'preview [PATH]\n開啟 HTML/CSS/SVG 預覽，預設 ~/main.html，popup 共用同一工作區。頁面腳本與外部載入不執行。',
  history: 'history\n列出保存的 agent 對話與 session ID（不是 bash 指令歷史）。使用 ai --resume SESSION_ID 接回。',
  clear: 'clear\n清空目前 terminal 顯示，保留檔案與 agent 對話。',
  rehash: 'rehash\n重新載入 ~/bin 的 JS 與 ~/bin/manifests 的 .tool.json；自動搬移舊位置的 manifest，下一輪 agent 使用新版本。',
  'restore-bin': 'restore-bin NAME\n還原一個預設工具的 JS 與 manifest（含 skill_load）；會覆寫該工具的自訂內容。',
  demo: 'demo jokes\n建立規則、joke-master skill、評分參考與五個笑話；不覆寫既有檔案。',
  help: 'help [COMMAND] | COMMAND --help\n顯示指令語法、簡化範圍；自訂工具顯示 manifest 說明與 JSON schema。\nShell 不執行管線、重導向、指令替換、環境變數或路徑 glob 展開；請使用 find -name。\n引號／反斜線採 bash 基本規則；字串換行可直接輸入換行或使用 write JSON。'
};

type HelpTool = { name: string; description: string; parameters: unknown };
export function commandHelp(command: string | undefined, bin: BinRegistry, extraTools: readonly HelpTool[] = []): string {
  const local = bin.list();
  const tools = [...local, ...extraTools.filter(extra => !local.some(tool => tool.name === extra.name))];
  if (!command) return `${SHELL_NOTICE}\n\n${HELP.help}\n\n可用工具：${tools.map(tool => tool.name).join(", ")}`;
  const name = command.toLowerCase();
  const tool = tools.find(tool => tool.name.toLowerCase() === name);
  if (!HELP[name] && !tool) throw new Error(`Command not found: ${command}; use help`);
  return [HELP[name], tool && `${tool.description}\nJSON arguments:\n${JSON.stringify(tool.parameters, null, 2)}`].filter(Boolean).join("\n\n");
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
