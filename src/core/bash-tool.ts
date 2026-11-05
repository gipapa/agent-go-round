import { Type, validateToolArguments } from "@earendil-works/pi-ai";
import type { AgentSession, SessionTool } from "./session";
import type { ShellExecutor } from "./shell-runtime";
import { SHELL_LIMITS } from "./shell-protocol";

export type AgentFileRun = { cwd: string };
export const BASH_PARAMETERS = Type.Object({
  script: Type.String({ minLength: 1, maxLength: SHELL_LIMITS.maxSourceBytes }),
  timeoutMs: Type.Optional(Type.Integer({ minimum: 1, maximum: SHELL_LIMITS.maxTimeoutMs })),
  maxOutputBytes: Type.Optional(Type.Integer({ minimum: 1, maximum: SHELL_LIMITS.maxOutputBytes })),
  maxSteps: Type.Optional(Type.Integer({ minimum: 1, maximum: SHELL_LIMITS.maxSteps }))
}, { additionalProperties: false });

export const BASH_DESCRIPTION = "Execute a complete just-bash script in the same browser workspace as read/write/edit. Returns stdout, stderr, exitCode and actual cwd. Prefer this tool for ordinary file operations and searches. Command names are case-insensitive; paths, variables and arguments retain their case. Supports quoting, Unicode, pipes, redirection, glob, heredocs, conditions and loops. Each call is an independent script: only cwd continues for this agent; variables/functions/options do not. Relative structured-tool paths use the returned cwd too. No host disk, network, Node/Python, hard links, gzip codecs or sqlite3. Options stay within host caps: timeout max 30000 ms (default 15000), bounded output and steps. Nonzero exitCode is a shell result. A cancelled/unknown mutation may already have committed: read back before retrying. Filesystem reads are audited but do not imply the model saw complete files; head/grep/pipes can return partial data. User JS tools remain separate sandboxed structured tools.";

export function createBashTool(session: AgentSession, shell: ShellExecutor, context: AgentFileRun, onCwd?: (cwd: string) => void): SessionTool {
  return {
    name: "bash", label: "bash", parameters: BASH_PARAMETERS,
    description: BASH_DESCRIPTION,
    execute: async (toolCallId, args, signal) => {
      const params = validateToolArguments({ name: "bash", description: BASH_DESCRIPTION, parameters: BASH_PARAMETERS }, { type: "toolCall", id: toolCallId, name: "bash", arguments: args as Record<string, unknown> });
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
