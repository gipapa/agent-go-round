import type { ShellExecutor } from "../core/shell-runtime";
import type { ShellResult } from "../core/shell-protocol";

export type TerminalContext = { shell: ShellExecutor; cwd: string; signal?: AbortSignal };
/** Whole scripts go directly to just-bash, without parsing app actions. */
export function executeTerminalInput(input: string, context: TerminalContext): Promise<ShellResult> {
  return context.shell.execute(input, { cwd: context.cwd, signal: context.signal });
}
