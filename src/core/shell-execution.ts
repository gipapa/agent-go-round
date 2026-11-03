import { Bash, getCommandNames, type CommandName, type IFileSystem } from "just-bash/browser";
import { execShellEngine } from "./shell-engine";
import { mountShellFileSystem } from "./shell-filesystem";

import { SHELL_LIMITS, shellOptions, type ShellOptions, type ShellResult } from "./shell-protocol";

/** The only interpreter path, shared by the real Worker and engine tests. */
export async function runShellScript(script: string, workspace: IFileSystem, input: ShellOptions): Promise<ShellResult> {
  const options = shellOptions(input);
  if (typeof script !== "string" || new TextEncoder().encode(script).byteLength > SHELL_LIMITS.maxSourceBytes) throw new Error("Shell script exceeds 64000 bytes");
  const fs = mountShellFileSystem(workspace);
  if (!(await fs.stat(options.cwd)).isDirectory) throw new Error("ENOTDIR: Invalid shell cwd");
  const bash = new Bash({ fs, cwd: options.cwd, env: { HOME: "/home/user" },
    commands: getCommandNames().filter(name => !["gzip", "gunzip", "zcat", "sqlite3", "python", "python3", "node", "js-exec", "curl", "wget"].includes(name)) as CommandName[],
    executionLimits: {
      maxSourceBytes: SHELL_LIMITS.maxSourceBytes, maxOutputSize: options.maxOutputBytes,
      maxCommandCount: options.maxSteps, maxLoopIterations: options.maxSteps, maxExecutionTimeMs: options.timeoutMs,
      maxAwkIterations: options.maxSteps, maxSedIterations: options.maxSteps, maxJqIterations: options.maxSteps,
      maxLiveBytes: 32 * 1024 * 1024, maxInputBytes: 16 * 1024 * 1024, maxStringLength: 1024 * 1024,
      maxArrayElements: 100_000, maxFileDescriptors: 128, maxCallDepth: 64, maxWorkUnits: 250_000
    }
  });
  const { stdout, stderr, exitCode, cwd } = await execShellEngine(bash, script);
  return { stdout, stderr, exitCode, cwd };
}
