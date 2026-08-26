import { describe, expect, it, vi } from "vitest";
import { createFailoverTransport } from "../runtime/harness/failoverTransport";
import type { HarnessModelContext } from "../runtime/harness/types";

const context: HarnessModelContext = { system: "", messages: [{ role: "user", content: "goal" }], tools: [], chars: 0 };

describe("harness transport failover", () => {
  it("rebuilds the candidate transport from the same canonical context", async () => {
    const seen: string[] = [];
    const onFailover = vi.fn();
    const transport = createFailoverTransport({
      onFailover,
      candidates: [
        { id: "first", create: () => ({ runStep: async (nextContext) => { seen.push(`first:${nextContext.messages.length}`); return { status: "transport_error", kind: "network", retryable: true, message: "offline" }; } }) },
        { id: "second", create: () => ({ runStep: async (nextContext) => { seen.push(`second:${nextContext.messages.length}`); return { status: "step", candidateId: "second", step: { type: "final", answer: "ok" } }; } }) }
      ]
    });
    await expect(transport.runStep(context, new AbortController().signal)).resolves.toMatchObject({ status: "step", candidateId: "second" });
    expect(seen).toEqual(["first:1", "second:1"]);
    expect(onFailover).toHaveBeenCalledWith("first", "second", "offline");
  });

  it("does not fail over protocol errors", async () => {
    const second = vi.fn();
    const success = vi.fn();
    const transport = createFailoverTransport({
      onCandidateSuccess: success,
      candidates: [
        { id: "first", create: () => ({ runStep: async () => ({ status: "protocol_error", candidateId: "first", rawPreview: "bad", message: "invalid" }) }) },
        { id: "second", create: () => ({ runStep: second }) }
      ]
    });
    await expect(transport.runStep(context, new AbortController().signal)).resolves.toMatchObject({ status: "protocol_error" });
    expect(second).not.toHaveBeenCalled();
    expect(success).not.toHaveBeenCalled();
  });

  it("reports a retryable failure when the last candidate is exhausted", async () => {
    const failures: string[] = [];
    const transport = createFailoverTransport({
      candidates: [
        {
          id: "only",
          create: () => ({
            runStep: async () => ({ status: "transport_error" as const, kind: "network" as const, retryable: true, message: "offline" })
          })
        }
      ],
      onCandidateFailure: (candidateId) => failures.push(candidateId)
    });
    await transport.runStep(context, new AbortController().signal);
    expect(failures).toEqual(["only"]);
  });

  it("contains a candidate factory failure and tries the next candidate", async () => {
    const transport = createFailoverTransport({
      candidates: [
        { id: "broken", create: () => { throw new Error("factory failed"); } },
        { id: "healthy", create: () => ({ runStep: async () => ({ status: "step" as const, candidateId: "healthy", step: { type: "final" as const, answer: "ok" } }) }) }
      ]
    });
    await expect(transport.runStep(context, new AbortController().signal)).resolves.toMatchObject({ status: "step", candidateId: "healthy" });
  });

  it("does not start another candidate after abort", async () => {
    const controller = new AbortController();
    const second = vi.fn(async () => ({ status: "step" as const, candidateId: "second", step: { type: "final" as const, answer: "late" } }));
    const transport = createFailoverTransport({
      candidates: [
        {
          id: "first",
          create: () => ({
            runStep: async () => {
              controller.abort("stopped");
              return { status: "transport_error" as const, kind: "network" as const, retryable: true, message: "offline" };
            }
          })
        },
        { id: "second", create: () => ({ runStep: second }) }
      ]
    });
    await expect(transport.runStep(context, controller.signal)).resolves.toMatchObject({ status: "aborted" });
    expect(second).not.toHaveBeenCalled();
  });

  it("does not start another candidate after ownership changes", async () => {
    let current = true;
    const second = vi.fn(async () => ({ status: "step" as const, candidateId: "second", step: { type: "final" as const, answer: "late" } }));
    const transport = createFailoverTransport({
      candidates: [
        {
          id: "first",
          create: () => ({
            runStep: async () => {
              current = false;
              return { status: "transport_error" as const, kind: "network" as const, retryable: true, message: "offline" };
            }
          })
        },
        { id: "second", create: () => ({ runStep: second }) }
      ]
    });
    await expect(transport.runStep(context, new AbortController().signal, { ...context, transcript: context.messages, tools: [], isCurrent: () => current })).resolves.toMatchObject({ status: "aborted" });
    expect(second).not.toHaveBeenCalled();
  });

  it("reprojects canonical transcript for each candidate budget", async () => {
    const seen: string[] = [];
    const projected: string[] = [];
    const transport = createFailoverTransport({
      onContextProjected: (candidateId, candidateContext) => projected.push(`${candidateId}:${candidateContext.chars}`),
      candidates: [
        {
          id: "small",
          project: ({ transcript }) => ({ code: "context_budget_exceeded", message: "small candidate is full" }),
          create: () => ({ runStep: async () => ({ status: "step" as const, candidateId: "small", step: { type: "final" as const, answer: "unexpected" } }) })
        },
        {
          id: "large",
          project: ({ transcript }) => {
            seen.push(transcript.map((message) => message.role).join(","));
            return { ...context, messages: transcript };
          },
          create: () => ({ runStep: async (candidateContext) => ({ status: "step" as const, candidateId: "large", step: { type: "final" as const, answer: String(candidateContext.messages.length) } }) })
        }
      ]
    });
    await expect(transport.runStep(context, new AbortController().signal, {
      transcript: [{ role: "user", content: "goal" }, { role: "runtime", kind: "context_notice", content: "canonical" }],
      system: "system",
      tools: []
    })).resolves.toMatchObject({ status: "step", candidateId: "large", step: { answer: "2" } });
    expect(seen).toEqual(["user,runtime"]);
    expect(projected).toEqual(["large:0"]);
  });
});
