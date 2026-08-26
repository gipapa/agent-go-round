import type { ContextProjectionFailure, HarnessMessage, HarnessModelContext, HarnessTransport, HarnessTransportResult, HarnessToolDefinition } from "./types";
import { errorMessage } from "../../utils/errors";

export type HarnessTransportCandidate = {
  id: string;
  create: () => HarnessTransport;
  project?: (source: { transcript: HarnessMessage[]; system?: string; tools: HarnessToolDefinition[] }) => HarnessModelContext | ContextProjectionFailure;
};

export function createFailoverTransport(args: {
  candidates: HarnessTransportCandidate[];
  onFailover?: (fromId: string, toId: string, message: string) => void;
  onContextProjected?: (candidateId: string, context: HarnessModelContext) => void;
  onCandidateSuccess?: (candidateId: string) => void;
  onCandidateFailure?: (candidateId: string, message: string) => void;
}): HarnessTransport {
  let index = 0;
  let current: HarnessTransport | null = null;
  return {
    async runStep(
      context: HarnessModelContext,
      signal: AbortSignal,
      projection?: { transcript: HarnessMessage[]; system?: string; tools: HarnessToolDefinition[]; isCurrent?: () => boolean }
    ): Promise<HarnessTransportResult> {
      if (!args.candidates.length) return { status: "transport_error", kind: "provider", retryable: false, message: "No compatible transport candidate is available." };
      const isCurrent = projection?.isCurrent ?? (() => true);
      while (index < args.candidates.length) {
        if (signal.aborted || !isCurrent()) return { status: "aborted", message: "Transport failover was aborted." };
        const candidate = args.candidates[index];
        let candidateContext: HarnessModelContext | ContextProjectionFailure = context;
        try {
          candidateContext = candidate.project && projection ? candidate.project(projection) : context;
        } catch (error) {
          candidateContext = {
            code: "context_budget_exceeded",
            message: errorMessage(error)
          };
        }
        if (!("messages" in candidateContext)) {
          const result: HarnessTransportResult = {
            status: "context_error",
            code: candidateContext.code,
            candidateId: candidate.id,
            message: candidateContext.message
          };
          if (index >= args.candidates.length - 1) return result;
          if (signal.aborted || !isCurrent()) return { status: "aborted", message: "Transport failover was aborted." };
          const next = args.candidates[index + 1];
          args.onFailover?.(candidate.id, next.id, candidateContext.message);
          index += 1;
          current = null;
          continue;
        }
        args.onContextProjected?.(candidate.id, candidateContext);
        if (!current) {
          try {
            const created = candidate.create();
            if (!created || typeof created.runStep !== "function") {
              throw new Error("Candidate factory returned an invalid transport.");
            }
            current = created;
          } catch (error) {
            const message = `Transport candidate ${candidate.id} could not be created: ${errorMessage(error)}`;
            const retryable = index < args.candidates.length - 1;
            args.onCandidateFailure?.(candidate.id, message);
            if (!retryable) {
              return { status: "transport_error", kind: "provider", retryable: false, message };
            }
            const next = args.candidates[index + 1];
            if (signal.aborted || !isCurrent()) return { status: "aborted", message: "Transport failover was aborted." };
            args.onFailover?.(candidate.id, next.id, message);
            index += 1;
            continue;
          }
        }
        let result: HarnessTransportResult;
        try {
          result = await current.runStep(candidateContext, signal);
        } catch (error) {
          result = {
            status: "transport_error",
            kind: "provider",
            retryable: true,
            message: `Transport candidate ${candidate.id} failed: ${errorMessage(error)}`
          };
        }
        if (signal.aborted || !isCurrent()) return { status: "aborted", message: "Transport failover was aborted." };
        if (result.status === "step") {
          args.onCandidateSuccess?.(candidate.id);
          return result;
        }
        if (result.status === "protocol_error") return result;
        if (result.status !== "transport_error" || !result.retryable) return result;
        if (signal.aborted || !isCurrent()) return { status: "aborted", message: "Transport failover was aborted." };
        args.onCandidateFailure?.(candidate.id, result.message);
        if (index >= args.candidates.length - 1) return result;
        const next = args.candidates[index + 1];
        args.onFailover?.(candidate.id, next.id, result.message);
        index += 1;
        current = null;
      }
      return { status: "transport_error", kind: "provider", retryable: false, message: "All compatible transport candidates failed." };
    }
  };
}
