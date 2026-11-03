import { Bash, type BashExecResult, type ExecOptions } from "just-bash/browser";

export type ShellEngineResult = BashExecResult & { cwd: string };
/** Public result.cwd is provided by scripts/patch-just-bash.mjs, verified on
 * install/build/test. PWD and getCwd() do not report execution-local state.
 */
export async function execShellEngine(bash: Bash, script: string, options?: ExecOptions): Promise<ShellEngineResult> {
  const result = await bash.exec(script, { ...options, rawScript: true });
  if (!("cwd" in result) || typeof result.cwd !== "string" || !result.cwd.startsWith("/")) throw new Error("just-bash public cwd patch is missing or returned an invalid path");
  return result as ShellEngineResult;
}
