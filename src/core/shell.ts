import type { BinRegistry } from "./bin";
import { BIN_DIRECTORY, BIN_MANIFEST_DIRECTORY, migrateBinManifests, DEFAULT_BIN_TOOLS } from "./bin-defaults";
import { FileSystemError, VFS_HOME, resolvePath, type FileNode, type VirtualFileSystem } from "./fs";
import { requestedHelp } from "./shell-help";
export { SHELL_NOTICE, requestedHelp } from "./shell-help";

/** Bash-style quoting; unsupported operators are rejected instead of becoming paths. */
export function shellWords(input: string): string[] {
  const words: string[] = [];
  let word = "", quote = "", started = false;
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (char === "\\" && quote !== "'") {
      const next = input[++i];
      if (next === undefined) throw new Error("Unclosed quote or escape");
      if (next !== "\n") word += quote === '"' && !'"\\$`'.includes(next) ? "\\" + next : next;
      started = true; continue;
    }
    if (quote) { if (char === quote) quote = ""; else { if (quote === '"' && (char === '`' || char === '$' && input[i + 1] === '(')) throw new Error("Command substitution is unsupported; use help"); word += char; } continue; }
    if (char === '"' || char === "'") { quote = char; started = true; continue; }
    if (/[|&;<>`]/.test(char) || char === '$' && input[i + 1] === '(') throw new Error("Shell operators and command substitution are unsupported; use help");
    if (/\s/.test(char)) { if (started) { words.push(word); word = ""; started = false; } continue; }
    word += char; started = true;
  }
  if (quote) throw new Error("Unclosed quote or escape");
  if (started) words.push(word);
  return words;
}

function argumentsFor(name: string, values: string[], allowed = ""): { flags: Set<string>; paths: string[] } {
  const flags = new Set<string>(), paths: string[] = [];
  let options = true;
  for (const value of values) {
    if (options && value === "--") { options = false; continue; }
    if (options && value.startsWith("-") && value !== "-") {
      for (const flag of value.slice(1)) {
        if (!allowed.includes(flag)) throw new Error(`${name}: unsupported option ${value}; use ${name} --help`);
        flags.add(flag);
      }
    } else paths.push(value);
  }
  return { flags, paths };
}
function arity(name: string, values: string[], min: number, max = min): void {
  if (values.length < min || values.length > max) throw new Error(`${name}: invalid arguments; use ${name} --help`);
}
function notFound(error: unknown): boolean { return error instanceof FileSystemError && error.code === "not_found"; }

export async function executeShell(input: string, fs: VirtualFileSystem, bin: BinRegistry, cwd: string, signal?: AbortSignal): Promise<{ text: string; cwd?: string; mode?: "agent"; clear?: boolean }> {
  const match = input.trim().match(/^(\S+)(?:\s+([\s\S]*))?$/);
  if (!match) return { text: "" };
  const name = match[1].toLowerCase(), tail = match[2] ?? "";
  // JSON remains a structured tool interface, without shell tokenization.
  if (tail.trim().startsWith("{")) return { text: JSON.stringify(await bin.execute(name === "cat" ? "read" : name, JSON.parse(tail), cwd, signal), null, 2) ?? "null" };
  const values = shellWords(tail);
  const help = requestedHelp([name, ...values], bin);
  if (help !== undefined) return { text: help };
  const done = { text: "" };
  if (["pwd", "clear", "rehash"].includes(name)) {
    arity(name, values, 0);
    if (name === "pwd") return { text: cwd };
    if (name === "clear") return { ...done, clear: true };
    await bin.reload(); return { text: `Loaded: ${bin.list().map(tool => tool.name).join(", ")}` };
  }
  if (name === "restore-bin") {
    arity(name, values, 1);
    const definition = DEFAULT_BIN_TOOLS.find(tool => tool.name === values[0].toLowerCase());
    if (!definition) throw new Error("Unknown default tool; use restore-bin --help");
    const { source, ...manifest } = definition;
    await migrateBinManifests(fs);
    await fs.writeFile(`${BIN_DIRECTORY}/${definition.name}.js`, source);
    await fs.writeFile(`${BIN_MANIFEST_DIRECTORY}/${definition.name}.tool.json`, JSON.stringify(manifest, null, 2));
    await bin.reload(); return { text: `Restored ${definition.name}` };
  }
  if (name === "cd") {
    const { paths } = argumentsFor(name, values); arity(name, paths, 0, 1);
    const target = resolvePath(paths[0] || "~", cwd);
    if ((await fs.stat(target)).kind !== "directory") throw new Error("cd: not a directory");
    return { text: "", cwd: target };
  }
  if (["mkdir", "touch", "rm", "rmdir", "mv"].includes(name)) {
    const { flags, paths } = argumentsFor(name, values, name === "mkdir" ? "p" : name === "rm" ? "rfR" : "");
    arity(name, paths, name === "mv" ? 2 : name === "rm" && flags.has("f") ? 0 : 1, name === "mv" ? 2 : Infinity);
    const remove = async (path: string): Promise<void> => {
      if (signal?.aborted) throw new Error("Command cancelled");
      if (path === VFS_HOME) throw new Error("rm: cannot remove workspace home");
      const node = await fs.stat(path);
      if (node.kind === "directory") {
        if (!flags.has("r") && !flags.has("R")) throw new Error("rm: is a directory; use -r");
        for (const child of await fs.listDirectory(path)) await remove(child.path);
      }
      await fs.remove(path);
    };
    if (name === "mv") {
      const source = resolvePath(paths[0], cwd);
      let target = resolvePath(paths[1], cwd);
      try { if ((await fs.stat(target)).kind === "directory") target += "/" + source.split("/").pop(); } catch (error) { if (!notFound(error)) throw error; }
      await fs.rename(source, target); return done;
    }
    for (const value of paths) {
      if (signal?.aborted) throw new Error("Command cancelled");
      if (name === "rm" && /(?:^|\/)\.{1,2}\/*$/.test(value)) throw new Error("rm: refusing to remove . or ..");
      const path = resolvePath(value, cwd);
      if (name === "mkdir") {
        if (!flags.has("p")) {
          let exists = false; try { await fs.stat(path); exists = true; } catch (error) { if (!notFound(error)) throw error; }
          if (exists) throw new Error(`mkdir: already exists: ${value}`);
        }
        await fs.mkdir(path, { recursive: flags.has("p") });
      } else if (name === "touch") {
        try { await fs.stat(path); } catch (error) { if (!notFound(error)) throw error; await fs.writeFile(path, "", { expectedRevision: 0 }); }
      } else if (name === "rmdir") {
        if ((await fs.stat(path)).kind !== "directory") throw new Error("rmdir: not a directory");
        await fs.remove(path);
      } else {
        try { await remove(path); } catch (error) { if (!flags.has("f") || !notFound(error)) throw error; }
      }
    }
    return done;
  }
  if (name === "ai") { arity(name, values, 0); return { text: "AI active · /exit returns to shell", mode: "agent" }; }
  if (name === "ls") {
    const { flags, paths } = argumentsFor(name, values, "aA1lF");
    const groups: string[] = [];
    for (const value of paths.length ? paths : ["."]) {
      const path = resolvePath(value, cwd), node = await fs.stat(path);
      const directory = node.kind === "directory";
      let entries: Array<Pick<FileNode, "path" | "kind" | "revision"> & { name?: string }> = directory
        ? (await bin.execute("ls", { path }, cwd, signal) as { entries: FileNode[] }).entries : [node];
      if (!flags.has("a") && !flags.has("A")) entries = entries.filter(entry => !entry.path.split("/").pop()!.startsWith(".") || !directory);
      entries.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
      if (directory && flags.has("a")) entries.unshift({ ...node, name: "." }, { ...node, name: ".." });
      const lines: string[] = [];
      for (const entry of entries) {
        const filename = (entry.name || (directory ? entry.path.split("/").pop()! : value)) + (flags.has("F") && entry.kind === "directory" ? "/" : "");
        if (!flags.has("l")) lines.push(filename);
        else {
          const metadata = await fs.stat(entry.name === ".." && path !== VFS_HOME ? resolvePath("..", path) : entry.path);
          const size = metadata.kind === "file" ? new TextEncoder().encode((await fs.readFile(metadata.path)).content).length : 0;
          lines.push(`${metadata.kind === "directory" ? "d" : "-"} ${size} r${metadata.revision} ${new Date(metadata.updatedAt).toISOString()} ${filename}`);
        }
      }
      groups.push((paths.length > 1 ? `${value}:\n` : "") + lines.join("\n"));
    }
    return { text: groups.join("\n\n") };
  }
  if (name === "cat") {
    const { flags, paths } = argumentsFor(name, values, "n"); arity(name, paths, 1, Infinity);
    let text = "";
    for (const path of paths) {
      let offset = 1, revision: number | undefined;
      do {
        const page = await bin.execute("read", { path, offset, limit: 200 }, cwd, signal) as { content: string; revision: number; nextOffset?: number };
        if (revision !== undefined && page.revision !== revision) throw new Error("cat: file changed during read; try again");
        if (typeof page.content !== "string" || page.nextOffset !== undefined && page.nextOffset <= offset) throw new Error("cat: invalid read tool pagination");
        revision = page.revision;
        text += page.content + (page.nextOffset ? "\n" : "");
        offset = page.nextOffset ?? 0;
      } while (offset);
    }
    if (flags.has("n")) text = text.replace(/^/gm, (() => { let line = 0; return () => `${++line}\t`; })()).replace(/\n\d+\t$/, "\n");
    return { text };
  }
  if (name === "find") {
    let path = ".", pattern: string | undefined, type: string | undefined;
    const args = [...values];
    if (args[0] && !args[0].startsWith("-")) path = args.shift()!;
    if (args[0] && !args[0].startsWith("-")) pattern = args.shift(); // legacy PATH GLOB
    while (args.length) {
      const option = args.shift(), value = args.shift();
      if (!value || option !== "-name" && option !== "-type") throw new Error("find: unsupported expression; use find --help");
      if (option === "-name") pattern = value;
      else { if (value !== "f" && value !== "d") throw new Error("find: -type expects f or d"); type = value === "f" ? "file" : "directory"; }
    }
    const result = await bin.execute("find", { path, ...(pattern !== undefined ? { name: pattern } : {}), ...(type ? { type } : {}), limit: 500 }, cwd, signal) as { entries: FileNode[]; truncated: boolean };
    const start = resolvePath(path, cwd);
    const rendered = result.entries.map(entry => path.startsWith("/") ? entry.path : path.replace(/\/$/, "") + entry.path.slice(start.length));
    if (result.truncated) rendered.push("[results truncated at 500; narrow the path or use find JSON]");
    return { text: rendered.join("\n") };
  }
  if (name === "grep") {
    const { flags, paths } = argumentsFor(name, values, "inrRFE"); arity(name, paths, 1, Infinity);
    const [pattern, ...targets] = paths;
    if (pattern.includes("\n")) throw new Error("grep: multiline patterns are unsupported; use grep --help");
    const lines: string[] = [];
    const recursive = flags.has("r") || flags.has("R") || !targets.length;
    const searchPaths = targets.length ? targets : ["."];
    for (const path of searchPaths) {
      const node = await fs.stat(resolvePath(path, cwd));
      if (node.kind === "directory" && !recursive) throw new Error(`grep: ${path}: is a directory; use -r`);
      const result = await bin.execute("grep", { path, pattern, regex: !flags.has("F"), ignoreCase: flags.has("i"), limit: 500 }, cwd, signal) as { matches: { path: string; line: number; text: string }[]; truncated: boolean };
      for (const match of result.matches) {
        const label = path.startsWith("/") ? match.path : node.kind === "file" ? path : path.replace(/\/$/, "") + match.path.slice(node.path.length);
        lines.push((node.kind === "directory" || searchPaths.length > 1 ? label + ":" : "") + (flags.has("n") ? match.line + ":" : "") + match.text);
      }
      if (result.truncated) lines.push("[results truncated at 500; narrow the path or use grep JSON]");
    }
    return { text: lines.join("\n") };
  }
  const args = name === "read" ? (arity(name, values, 1), { path: values[0] })
    : name === "write" ? (arity(name, values, 2), { path: values[0], content: values[1] })
    : name === "edit" ? (arity(name, values, 3), { path: values[0], oldText: values[1], newText: values[2] })
    : values.length ? (() => { throw new Error(`${name}: custom tools accept JSON; use ${name} --help`); })() : {};
  return { text: JSON.stringify(await bin.execute(name, args, cwd, signal), null, 2) ?? "null" };
}
