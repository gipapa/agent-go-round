import type { BinRegistry } from "./bin";
import { BIN_DIRECTORY, DEFAULT_BIN_TOOLS } from "./bin-defaults";
import { displayPath, resolvePath, type VirtualFileSystem } from "./fs";

/** Small bash-style tokenizer. Operators and command substitution are never evaluated. */
export function shellWords(input: string): string[] {
  const words: string[] = [];
  let word = "", quote = "", escaped = false, started = false;
  for (const char of input) {
    if (escaped) { word += char === "n" ? "\n" : char === "t" ? "\t" : char; escaped = false; continue; }
    if (char === "\\" && quote !== "'") { escaped = true; started = true; continue; }
    if (quote) { if (char === quote) quote = ""; else word += char; continue; }
    if (char === '"' || char === "'") { quote = char; started = true; continue; }
    if (/\s/.test(char)) { if (started) { words.push(word); word = ""; started = false; } continue; }
    word += char; started = true;
  }
  if (escaped || quote) throw new Error("Unclosed quote or escape");
  if (started) words.push(word);
  return words;
}

export async function executeShell(input: string, fs: VirtualFileSystem, bin: BinRegistry, cwd: string, signal?: AbortSignal): Promise<{ text: string; cwd?: string; mode?: "agent"; clear?: boolean }> {
  const match = input.trim().match(/^(\S+)(?:\s+([\s\S]*))?$/);
  if (!match) return { text: "" };
  const name = match[1], tail = match[2] ?? "";
  if (name === "help") return { text: 'pwd | cd PATH | mkdir PATH | touch PATH | rm PATH | mv FROM TO | clear | rehash\nls [PATH] | read PATH | write PATH "CONTENT" | edit PATH ["OLD" "NEW"]\ngrep "TEXT" [PATH] | find [PATH] [NAME_GLOB]\nedit PATH opens the file editor. preview [PATH] opens a page tab with Pi popup (default ~/main.html).\npi | pi --new | history | pi --resume SESSION_ID\ndemo jokes creates the AGENTS.md, joke-master skill and five joke files.\nEvery bin tool also accepts JSON: write {"path":"demo.md","content":"hello"}\nread returns revision; supply expectedRevision when replacing an existing file. createParents:true creates missing directories.\nTools: ~/bin/NAME.js + NAME.tool.json. rehash loads new/changed tools.\nRecovery: restore-bin NAME resets one default tool. rm removes a broken custom manifest.\nIn Pi: /exit returns to shell; /skill NAME TASK explicitly loads a skill.' };
  if (name === "pwd") return { text: cwd };
  if (name === "clear") return { text: "", clear: true };
  if (name === "rehash") { await bin.reload(); return { text: `Loaded: ${bin.list().map((tool) => tool.name).join(", ")}` }; }
  const values = tail.trim().startsWith("{") ? undefined : shellWords(tail);
  if (name === "restore-bin") {
    const definition = DEFAULT_BIN_TOOLS.find((tool) => tool.name === values?.[0]);
    if (!definition) throw new Error("Usage: restore-bin read|write|edit|grep|find|ls (resets JS and manifest)");
    const { source, ...manifest } = definition;
    await fs.mkdir(BIN_DIRECTORY, { recursive: true });
    await fs.writeFile(`${BIN_DIRECTORY}/${definition.name}.js`, source);
    await fs.writeFile(`${BIN_DIRECTORY}/${definition.name}.tool.json`, JSON.stringify(manifest, null, 2));
    await bin.reload();
    return { text: `Restored ${definition.name}` };
  }
  if (name === "rm") { await fs.remove(resolvePath(values?.[0] || "", cwd)); return { text: "Removed" }; }
  if (name === "mv") {
    if (values?.length !== 2) throw new Error("Usage: mv FROM TO");
    await fs.rename(resolvePath(values[0], cwd), resolvePath(values[1], cwd)); return { text: "Moved" };
  }
  if (name === "touch") {
    const path = resolvePath(values?.[0] || "", cwd);
    try { await fs.stat(path); } catch (error) { if (!(error instanceof Error && "code" in error && error.code === "not_found")) throw error; await fs.writeFile(path, "", { expectedRevision: 0 }); }
    return { text: displayPath(path) };
  }
  if (name === "cd") {
    const target = resolvePath(values?.[0] || "~", cwd);
    if ((await fs.stat(target)).kind !== "directory") throw new Error("cd expects a directory");
    return { text: displayPath(target), cwd: target };
  }
  if (name === "mkdir") { const target = resolvePath(values?.[0] || "", cwd); await fs.mkdir(target, { recursive: true }); return { text: displayPath(target) }; }
  if (name === "pi") return { text: "Pi active · /exit returns to shell", mode: "agent" };
  const args = values === undefined ? JSON.parse(tail) : name === "read" || name === "cat" ? { path: values[0] }
    : name === "write" ? { path: values[0], content: values[1] }
    : name === "edit" ? { path: values[0], oldText: values[1], newText: values[2] }
    : name === "grep" ? { pattern: values[0], ...(values[1] ? { path: values[1] } : {}) }
    : name === "find" ? { ...(values[0] ? { path: values[0] } : {}), ...(values[1] ? { name: values[1] } : {}) }
    : name === "ls" ? { ...(values[0] ? { path: values[0] } : {}) }
    : values.length ? (() => { throw new Error("Custom tools accept a JSON argument object"); })() : {};
  const result = await bin.execute(name === "cat" ? "read" : name, args, cwd, signal);
  return { text: JSON.stringify(result, null, 2) ?? "null" };
}
