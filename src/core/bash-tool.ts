import { Type } from "@earendil-works/pi-ai";
import type { AgentSession, SessionTool } from "./session";
import type { ShellExecutor } from "./shell-runtime";
import { SHELL_LIMITS } from "./shell-protocol";
import { validateArgumentsWithGuidance } from "./tool-arguments";

export type AgentFileRun = { cwd: string };
export const BASH_PARAMETERS = Type.Object({
  script: Type.String({ minLength: 1, maxLength: SHELL_LIMITS.maxSourceBytes, description: "Complete Bash source, at most 64000 UTF-8 bytes. For literal multiline text/HTML use a quoted heredoc: cat > main.html <<'HTML'\n<!doctype html>\n<p>Text with quotes, $ and backticks stays literal.</p>\nHTML\nChoose a delimiter absent from the content; put its closing line alone without indentation. Avoid echo or printf with interpolated content." }),
  timeoutMs: Type.Optional(Type.Integer({ minimum: 1, maximum: SHELL_LIMITS.maxTimeoutMs, description: "Execution timeout in milliseconds; default 15000, maximum 30000." })),
  maxOutputBytes: Type.Optional(Type.Integer({ minimum: 1, maximum: SHELL_LIMITS.maxOutputBytes, description: "Output cap in bytes; default/maximum 128000. Keep output focused; this does not limit file size." })),
  maxSteps: Type.Optional(Type.Integer({ minimum: 1, maximum: SHELL_LIMITS.maxSteps, description: "Command/loop step limit; default/maximum 10000." }))
}, { additionalProperties: false });

export const BASH_DESCRIPTION = "Execute a complete just-bash script in the same browser workspace as read/write/edit. Returns stdout, stderr, exitCode and actual cwd. Prefer this tool for ordinary file operations and searches. Write literal text/HTML with a quoted heredoc (see script); > replaces a file, >> appends. A successful write may have empty stdout; do not repeat it just to get output. Inspect stderr and exitCode before correcting a failure; do not retry unchanged arguments. Command names are case-insensitive; paths, variables and arguments retain their case. Supports quoting, Unicode, pipes, redirection, glob, heredocs, conditions and loops. Each call is an independent script: only cwd continues for this agent; variables/functions/options do not. Relative structured-tool paths use the returned cwd too. No host disk, network, Node/Python, hard links, gzip codecs or sqlite3. Options stay within host caps: timeout max 30000 ms (default 15000), bounded output and steps. Nonzero exitCode is a shell result. A cancelled/unknown mutation may already have committed: read back before retrying. Filesystem reads are audited but do not imply the model saw complete files; head/grep/pipes can return partial data. User JS tools remain separate sandboxed structured tools.";

export function createBashTool(session: AgentSession, shell: ShellExecutor, context: AgentFileRun, onCwd?: (cwd: string) => void): SessionTool {
  return {
    name: "bash", label: "bash", parameters: BASH_PARAMETERS,
    description: BASH_DESCRIPTION,
    execute: async (toolCallId, args, signal) => {
      const params = validateArgumentsWithGuidance({ name: "bash", description: BASH_DESCRIPTION, parameters: BASH_PARAMETERS }, args, toolCallId);
      const record = session.bindFileAccessRecorder(toolCallId);
      let wrote = false;
      const result = await shell.execute(params.script, {
        cwd: context.cwd, timeoutMs: params.timeoutMs, maxOutputBytes: params.maxOutputBytes, maxSteps: params.maxSteps, signal,
        onAccess: access => { if (["writeBytes", "metadataWrite", "remove"].includes(access.method)) wrote = true; record(access); }
      });
      if (signal?.aborted) {
        const error = new Error(wrote ? "Shell cancelled after a committed filesystem mutation; read back before retrying" : "Shell cancelled");
        Object.assign(error, { code: wrote ? "outcome_unknown" : "aborted" }); throw error;
      }
      context.cwd = result.cwd; onCwd?.(result.cwd);
      return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
    }
  };
}
