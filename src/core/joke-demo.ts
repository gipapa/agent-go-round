import type { VirtualFileSystem } from "./fs";

export const JOKE_PROMPT = "Use the joke-master skill to read all five Markdown jokes in ~/jokes, score each one, and give me the funniest joke.";
export const JOKE_SKILL_PATH = "~/skills/joke-master/SKILL.md";
export const JOKE_DEMO_FILES: Readonly<Record<string, string>> = {
  "~/AGENTS.md": "# 回答規則\n即使使用者使用英文提問，也必須使用繁體中文回答。檔名、工具名稱與 JSON 欄位可保留原文。\n",
  [JOKE_SKILL_PATH]: `---
name: joke-master
description: Read joke files, score each one, and choose the funniest joke. Also create jokes when requested.
---
# 笑話高手
每個使用者回合都必須執行以下步驟，包括建立新笑話、重新評分與接續對話：
1. 第一個任務工具呼叫必須是 read，path 為此 skill 目錄下 references/scoring.md 的絕對路徑。讀到完整準則後才能呼叫 write、ls 或讀取笑話。這一步不能用歷史對話中的準則取代；即使使用者說先建立笑話，也要先讀準則再建立。
2. 如果需要建立笑話，依下方寫檔規則建立；再列出使用者指定目錄的笑話 .md 檔。
3. 讀完全部笑話後才評分並回答。
必須用 read 工具讀取每個笑話的完整實際內容，不能只看檔名或引用先前對話的舊版本。
列完目錄後，將所有笑話路徑放在 read 的 path 陣列，一次讀入完整清單；確認每個檔案都有內容後才能評分。
如果使用者要求先建立笑話，用 write 的 files 陣列一次建立指定數量的獨立 .md 檔；將所有路徑放入 read 的 path 陣列逐檔讀回，最後才評分。
使用 write 的 createParents: true 可建立缺少的父目錄。
逐一給出 1–10 分與具體理由，選出最高分的一個；同分時比較後選出一個。
最後以一段簡短中文加上 JSON code block 回答。JSON 格式：
{"scores":[{"path":"讀到的絕對路徑","score":8,"reason":"評分理由"}],"winner":{"path":"最高分笑話的絕對路徑","text":"該檔案的完整原文","reason":"選擇原因"}}
scores 必須包含指定目錄內每個笑話一次；winner.text 必須與實際讀到的檔案內容一致。讀檔失敗要明確指出，不虛構分數。
`,
  "~/skills/joke-master/references/scoring.md": "# 評分準則\n評估意外性（40%）、鋪陳與節奏（30%）、趣味與易懂程度（30%），綜合給出 1–10 分；逐檔解釋，分數不必固定，避免只有空泛稱讚。\n",
  "~/jokes/笑話1.md": "工程師去買菜，太太說：買一顆高麗菜，如果有雞蛋就買六個。工程師回家時抱了六顆高麗菜：店裡有雞蛋。",
  "~/jokes/笑話2.md": "我問圖書館員有沒有關於偏執狂的書。她小聲說：就在你後面。",
  "~/jokes/笑話3.md": "朋友說他最近開始早起運動。我問效果如何，他說：現在鬧鐘已經會自己按貪睡了。",
  "~/jokes/笑話4.md": "電腦去看醫生，醫生問哪裡不舒服。電腦說：我最近記性不好。醫生說：你再說一次？電腦說：說什麼？",
  "~/jokes/笑話5.md": "我把 Wi-Fi 名稱改成「正在連線中」，結果鄰居等了一整個下午。"
};

/** Shared implementation for SDK fixtures and the editable bin tool; only uses VFS methods. */
async function installDemoFiles(fs: Pick<VirtualFileSystem, "mkdir" | "listDirectory" | "writeFiles">, files: Readonly<Record<string, string>>): Promise<{ created: string[]; kept: string[] }> {
  const kept: string[] = [];
  const pending: Array<{ path: string; content: string; expectedRevision: number }> = [];
  for (const [path, content] of Object.entries(files)) {
    const directory = path.slice(0, path.lastIndexOf("/"));
    const name = path.slice(path.lastIndexOf("/") + 1);
    await fs.mkdir(directory, { recursive: true });
    const entries = await fs.listDirectory(directory);
    const existing = entries.find(entry => {
      const candidate = entry.path.split("/").pop();
      return candidate === name || (name === "AGENTS.md" || name === "SKILL.md") && candidate === name.toLowerCase();
    });
    if (existing) { kept.push(existing.path); continue; }
    pending.push({ path, content, expectedRevision: 0 });
  }
  // A concurrent create fails the batch rather than overwriting user files.
  if (pending.length) await fs.writeFiles(pending);
  return { created: pending.map(file => file.path), kept };
}

/** Explicit demo setup, never overwrites a user's existing workspace files. */
export function installJokeDemo(fs: VirtualFileSystem): Promise<{ created: string[]; kept: string[] }> {
  return installDemoFiles(fs, JOKE_DEMO_FILES);
}

export const JOKE_DEMO_SOURCE = `async function main(args, api) {
  const installed = await (${installDemoFiles.toString()})(api.fs, ${JSON.stringify(JOKE_DEMO_FILES)});
  return { ...installed, prompt: ${JSON.stringify(JOKE_PROMPT)} };
}`;
