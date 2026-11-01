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

export type ShellCommand = { name: string; values: string[]; json?: unknown };

export function parseShellCommand(input: string): ShellCommand | undefined {
  const match = input.trim().match(/^(\S+)(?:\s+([\s\S]*))?$/);
  if (!match) return undefined;
  const name = match[1].toLowerCase(), tail = match[2] ?? "";
  return tail.trim().startsWith("{") ? { name, values: [], json: JSON.parse(tail) } : { name, values: shellWords(tail) };
}
