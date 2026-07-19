import { PendingLogEntry } from "./logging";
import { classifyRetryableAgentFailure } from "../utils/agentFailure";
import { errorMessage } from "../utils/errors";
import { ResolvedLoadBalancerInstance, getLoadBalancerResumeMs } from "../utils/loadBalancer";
import { describeResolvedLoadBalancerCandidate, formatLoadBalancerDateTime } from "../utils/loadBalancerDiagnostics";
import { ExecutionDeadline } from "../utils/deadline";

type LoadBalancerRunnerBase = {
  agentName: string;
  requestId?: string;
  stage: string;
  candidates: ResolvedLoadBalancerInstance[];
  noCandidateDetails: string;
  pushLog: (entry: PendingLogEntry) => void;
  markSuccess: (candidate: ResolvedLoadBalancerInstance) => void;
  markFailure: (candidate: ResolvedLoadBalancerInstance) => void;
};

export async function runLoadBalancedTask<T>(args: LoadBalancerRunnerBase & {
  execute: (candidate: ResolvedLoadBalancerInstance) => Promise<T>;
  selectionDetails?: (candidate: ResolvedLoadBalancerInstance) => string;
  successDetails?: (candidate: ResolvedLoadBalancerInstance, result: T) => string;
  errorDetails?: (candidate: ResolvedLoadBalancerInstance, error: string) => string;
  noCandidateError: string;
  unknownFailureError: string;
}) {
  if (!args.candidates.length) {
    args.pushLog({
      category: "load_balancer",
      agent: args.agentName,
      ok: false,
      requestId: args.requestId,
      stage: args.stage,
      message: `LB no available instance [${args.stage}]`,
      details: args.noCandidateDetails
    });
    throw new Error(args.noCandidateError);
  }

  let lastError: unknown = new Error(args.noCandidateError);
  let lastFailureDetails = errorMessage(lastError);
  for (const [candidateIndex, candidate] of args.candidates.entries()) {
    args.pushLog({
      category: "load_balancer",
      agent: args.agentName,
      requestId: args.requestId,
      stage: args.stage,
      message: `LB selected [${args.stage}]`,
      details: args.selectionDetails?.(candidate) ?? describeResolvedLoadBalancerCandidate(candidate)
    });
    try {
      const result = await args.execute(candidate);
      args.markSuccess(candidate);
      args.pushLog({
        category: "load_balancer",
        agent: args.agentName,
        ok: true,
        requestId: args.requestId,
        stage: args.stage,
        message: `LB success [${args.stage}]`,
        details: args.successDetails?.(candidate, result) ?? describeResolvedLoadBalancerCandidate(candidate)
      });
      return result;
    } catch (error) {
      lastError = error;
      const errorText = errorMessage(error);
      lastFailureDetails = errorText;
      const failure = classifyRetryableAgentFailure(errorText);
      if (failure?.retryable) {
        const nextCandidate = args.candidates[candidateIndex + 1] ?? null;
        if (failure.markFailure) args.markFailure(candidate);
        args.pushLog({
          category: "load_balancer",
          agent: args.agentName,
          ok: false,
          requestId: args.requestId,
          stage: args.stage,
          message: `${nextCandidate ? "LB failover" : "LB exhausted"} [${args.stage}]`,
          details: [
            args.errorDetails?.(candidate, errorText) ?? describeResolvedLoadBalancerCandidate(candidate),
            `error=${errorText}`,
            `marked_failure=${failure.markFailure}`,
            nextCandidate ? `next_candidate:\n${describeResolvedLoadBalancerCandidate(nextCandidate)}` : "next_candidate: none"
          ].join("\n\n")
        });
        continue;
      }
      args.pushLog({
        category: "load_balancer",
        agent: args.agentName,
        ok: false,
        requestId: args.requestId,
        stage: args.stage,
        message: `LB terminal error [${args.stage}]`,
        details: [
          args.errorDetails?.(candidate, errorText) ?? describeResolvedLoadBalancerCandidate(candidate),
          `error=${errorText}`
        ].join("\n\n")
      });
      throw error;
    }
  }

  args.pushLog({
    category: "load_balancer",
    agent: args.agentName,
    ok: false,
    requestId: args.requestId,
    stage: args.stage,
    message: `LB final failure [${args.stage}]`,
    details: lastFailureDetails
  });
  throw lastError instanceof Error ? lastError : new Error(String(lastError ?? args.unknownFailureError));
}

export async function runLoadBalancedTextTask(args: LoadBalancerRunnerBase & {
  execute: (candidate: ResolvedLoadBalancerInstance) => Promise<string>;
  fallback: () => Promise<string>;
  deadline?: ExecutionDeadline;
}) {
  args.deadline?.throwIfExpired(args.stage);
  if (!args.candidates.length) {
    args.pushLog({
      category: "load_balancer",
      agent: args.agentName,
      ok: false,
      requestId: args.requestId,
      stage: args.stage,
      message: `LB no available instance [${args.stage}]`,
      details: args.noCandidateDetails
    });
    return await args.fallback();
  }

  let lastFailureText = "No available load balancer instance.";
  let lastFailureDetails = lastFailureText;
  let shouldReturnEmptyResponse = false;
  for (const [candidateIndex, candidate] of args.candidates.entries()) {
    args.deadline?.throwIfExpired(`${args.stage} failover`);
    args.pushLog({
      category: "load_balancer",
      agent: args.agentName,
      requestId: args.requestId,
      stage: args.stage,
      message: `LB selected [${args.stage}]`,
      details: describeResolvedLoadBalancerCandidate(candidate)
    });
    const text = await args.execute(candidate);
    const trimmedText = String(text ?? "").trim();
    if (!trimmedText) {
      shouldReturnEmptyResponse = true;
      lastFailureText = "";
      lastFailureDetails = "模型沒有回傳任何內容。";
      const nextCandidate = args.candidates[candidateIndex + 1] ?? null;
      args.pushLog({
        category: "load_balancer",
        agent: args.agentName,
        ok: false,
        outcome: "degraded",
        requestId: args.requestId,
        stage: args.stage,
        message: `${nextCandidate ? "LB empty response failover" : "LB empty response exhausted"} [${args.stage}]`,
        details: [
          describeResolvedLoadBalancerCandidate(candidate),
          "response_length=0",
          "marked_failure=false",
          nextCandidate ? `next_candidate:\n${describeResolvedLoadBalancerCandidate(nextCandidate)}` : "next_candidate: none"
        ].join("\n\n")
      });
      if (nextCandidate) continue;
      break;
    }

    const failure = classifyRetryableAgentFailure(text);
    if (failure?.retryable) {
      shouldReturnEmptyResponse = false;
      lastFailureText = text;
      lastFailureDetails = text;
      const nextCandidate = args.candidates[candidateIndex + 1] ?? null;
      const failureUpdateDetails = failure.markFailure
        ? `updated_failure_count=${candidate.instance.failureCount + 1}\nupdated_next_check_time=${formatLoadBalancerDateTime(
            Date.now() + getLoadBalancerResumeMs(candidate.instance)
          )}`
        : "";
      if (failure.markFailure) args.markFailure(candidate);
      args.pushLog({
        category: "load_balancer",
        agent: args.agentName,
        ok: false,
        requestId: args.requestId,
        stage: args.stage,
        message: `${nextCandidate ? "LB failover" : "LB exhausted"} [${args.stage}]`,
        details: [
          describeResolvedLoadBalancerCandidate(candidate),
          `error=${text}`,
          `marked_failure=${failure.markFailure}`,
          failureUpdateDetails,
          nextCandidate ? `next_candidate:\n${describeResolvedLoadBalancerCandidate(nextCandidate)}` : "next_candidate: none"
        ].filter(Boolean).join("\n\n")
      });
      continue;
    }

    if (failure && !failure.retryable) {
      args.pushLog({
        category: "load_balancer",
        agent: args.agentName,
        ok: false,
        requestId: args.requestId,
        stage: args.stage,
        message: `LB terminal error [${args.stage}]`,
        details: [describeResolvedLoadBalancerCandidate(candidate), `error=${text}`].join("\n\n")
      });
      return text;
    }

    args.markSuccess(candidate);
    const responseLength = String(text ?? "").length;
    args.pushLog({
      category: "load_balancer",
      agent: args.agentName,
      ok: responseLength > 0,
      outcome: responseLength > 0 ? "success" : "degraded",
      requestId: args.requestId,
      stage: args.stage,
      message: responseLength > 0 ? `LB success [${args.stage}]` : `LB empty response [${args.stage}]`,
      details: [describeResolvedLoadBalancerCandidate(candidate), `response_length=${responseLength}`].join("\n\n")
    });
    return text;
  }

  args.pushLog({
    category: "load_balancer",
    agent: args.agentName,
    ok: false,
    requestId: args.requestId,
    stage: args.stage,
    message: `LB final failure [${args.stage}]`,
    details: lastFailureDetails
  });
  return shouldReturnEmptyResponse ? "" : lastFailureText;
}
