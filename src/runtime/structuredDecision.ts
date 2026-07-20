import { detectTerminalAgentFailure } from "../utils/agentFailure";

type StructuredDecisionRetry = {
  delaySec: number;
  max: number;
};

type RunStructuredDecisionArgs<T> = {
  retry: StructuredDecisionRetry;
  invoke: (attempt: number) => Promise<string>;
  parse: (raw: string) => T | null;
  onSuccess?: (decision: T, raw: string, attempt: number) => void;
  onInvalid?: (raw: string, attempt: number, totalAttempts: number) => void;
  onTerminal?: (raw: string, failure: string, attempt: number) => void;
  wait?: (ms: number) => Promise<void>;
};

export async function runStructuredDecision<T>({
  retry,
  invoke,
  parse,
  onSuccess,
  onInvalid,
  onTerminal,
  wait = sleep
}: RunStructuredDecisionArgs<T>): Promise<T | null> {
  const max = Math.max(0, Math.round(retry.max));
  const totalAttempts = max + 1;
  for (let attempt = 0; attempt < totalAttempts; attempt++) {
    const raw = await invoke(attempt);
    const terminalFailure = detectTerminalAgentFailure(raw);
    if (terminalFailure) {
      onTerminal?.(raw, terminalFailure, attempt);
      return null;
    }

    const decision = parse(raw);
    if (decision !== null) {
      onSuccess?.(decision, raw, attempt);
      return decision;
    }

    onInvalid?.(raw, attempt, totalAttempts);
    if (attempt < max) {
      await wait(Math.max(0, retry.delaySec) * 1000);
    }
  }
  return null;
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}
