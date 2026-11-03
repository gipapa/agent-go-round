export const SHELL_LIMITS = Object.freeze({ timeoutMs: 15_000, maxTimeoutMs: 30_000, maxOutputBytes: 128_000, maxSteps: 10_000, maxSourceBytes: 64_000, maxRpcCalls: 20_000 });
export type ShellOptions = { cwd: string; timeoutMs?: number; maxOutputBytes?: number; maxSteps?: number };
export type ShellResult = { stdout: string; stderr: string; exitCode: number; cwd: string };
const bounded = (value: number | undefined, maximum: number, fallback: number): number => {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < 1 || value > maximum) throw new Error(`Execution option must be an integer from 1 to ${maximum}`);
  return value;
};
export function shellOptions(options: ShellOptions): Required<ShellOptions> {
  if (typeof options.cwd !== "string" || !options.cwd.startsWith("/") || options.cwd.includes("\0") || options.cwd.length > 4096) throw new Error("Invalid shell cwd");
  return { cwd: options.cwd, timeoutMs: bounded(options.timeoutMs, SHELL_LIMITS.maxTimeoutMs, SHELL_LIMITS.timeoutMs), maxOutputBytes: bounded(options.maxOutputBytes, SHELL_LIMITS.maxOutputBytes, SHELL_LIMITS.maxOutputBytes), maxSteps: bounded(options.maxSteps, SHELL_LIMITS.maxSteps, SHELL_LIMITS.maxSteps) };
}
