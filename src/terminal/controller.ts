import type { BinRegistry } from "../core/bin";
import type { VirtualFileSystem } from "../core/fs";
import { resolvePath } from "../core/fs";
import { parseShellCommand } from "../core/shell-command";
import { commandDefinition } from "../core/command-definitions";
import { executeShell } from "../core/shell";
import { requestedHelp, type HelpTool } from "../core/shell-help";
import { installJokeDemo, JOKE_PROMPT } from "../core/joke-demo";
import type { WorkspaceTabSnapshot } from "../core/workspace-store";

export type AgentStart = { kind: "continue" } | { kind: "new" } | { kind: "resume"; sessionId: string };
export type TerminalContext = {
  fs: VirtualFileSystem;
  bin: BinRegistry;
  cwd: string;
  signal?: AbortSignal;
  extraTools?: readonly HelpTool[];
  history(): Promise<WorkspaceTabSnapshot[]>;
  openPreview(path: string): void;
  openEditor(path: string): Promise<void>;
  enterAgent(start: AgentStart): Promise<void>;
};
export type TerminalResult = { text: string; cwd?: string; clear?: boolean };

/** Interpret a command once; UI actions are supplied by the workspace. */
export async function executeTerminalInput(input: string, context: TerminalContext): Promise<TerminalResult> {
  const command = parseShellCommand(input);
  if (!command) return { text: "" };
  const { name, values } = command;
  if (command.json === undefined) {
    const help = requestedHelp([name, ...values], context.bin, context.extraTools);
    if (help !== undefined) return { text: help };
    switch (commandDefinition(name)?.action) {
      case "preview":
        if (values.length > 1) throw new Error("Usage: preview [PATH]");
        context.openPreview(resolvePath(values[0] || "~/main.html", context.cwd)); return { text: "" };
      case "agent": {
        let start: AgentStart;
        if (!values.length) start = { kind: "continue" };
        else if (values.length === 1 && values[0].toLowerCase() === "--new") start = { kind: "new" };
        else if (values.length === 2 && values[0].toLowerCase() === "--resume") start = { kind: "resume", sessionId: values[1] };
        else throw new Error("Usage: ai | ai --new | ai --resume SESSION_ID");
        await context.enterAgent(start); return { text: "" };
      }
      case "history": {
        if (values.length) throw new Error("Usage: history; use history --help");
        const history = await context.history();
        return { text: history.map(entry => `${entry.session.sessionId} · ${entry.name} · ${entry.provider ?? entry.session.model.provider} · ${new Date(entry.session.savedAt).toLocaleString()}`).join("\n") || "No saved conversations" };
      }
      case "demo": {
        if (values.length !== 1 || values[0].toLowerCase() !== "jokes") throw new Error("Usage: demo jokes; use demo --help");
        const installed = await installJokeDemo(context.fs);
        return { text: `Joke demo: ${installed.created.length} files created, ${installed.kept.length} existing files kept.\nRun ai, then ask:\n${JOKE_PROMPT}` };
      }
      case "editor": if (values.length <= 1) { await context.openEditor(values[0] ?? context.cwd); return { text: "" }; }
    }
  }
  return executeShell(command, context.fs, context.bin, context.cwd, context.signal);
}
