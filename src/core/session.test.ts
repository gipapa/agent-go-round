import { describe, expect, it } from "vitest";
import { createScriptedSession } from "./scripted";
import { SessionBusyError } from "./session";
import { createAssistantMessageEventStream, type AssistantMessage } from "@earendil-works/pi-ai";

describe("AgentSession", () => {
  it("streams text and gives each run one terminal event", async () => {
    const session = createScriptedSession(["hello"], { sessionId: "test-session" });
    const events: string[] = [];
    session.subscribe((event) => {
      if (event.type === "run_finished") events.push(`${event.runId}:${event.status}`);
    });

    const result = await session.prompt("say hello");

    expect(result.status).toBe("success");
    expect(result.text).toBe("hello");
    expect(events).toEqual([`${result.runId}:success`]);
    expect(session.agent.state.messages.filter((message) => message.role === "user")).toHaveLength(1);
  });

  it("rejects a second prompt while the first run is active", async () => {
    const session = createScriptedSession(["slow response"], { delayMs: 3 });
    const first = session.prompt("first");

    await expect(session.prompt("second")).rejects.toBeInstanceOf(SessionBusyError);
    expect((await first).status).toBe("success");
  });

  it("can abort and then reuse the same session", async () => {
    const session = createScriptedSession(["this response is long", "reused"], { delayMs: 4 });
    const first = session.prompt("stop me");
    await new Promise((resolve) => setTimeout(resolve, 12));
    expect(session.stop()).toBe(true);
    expect((await first).status).toBe("aborted");

    const second = await session.prompt("try again");
    expect(second).toMatchObject({ status: "success", text: "reused" });
  });

  it("aborts a slow run at its wall-clock deadline and records a deadline outcome", async () => {
    const session = createScriptedSession(["this response is too slow"], { delayMs: 5, deadlineMs: 12 });
    const finished: string[] = [];
    session.subscribe((event) => {
      if (event.type === "run_finished") finished.push(event.status);
    });

    const result = await session.prompt("finish before the deadline");

    expect(result).toMatchObject({ status: "deadline", error: "Run deadline exceeded" });
    expect(finished).toEqual(["deadline"]);
    expect(session.isRunning).toBe(false);
  });

  it("rejects a non-positive deadline", () => {
    expect(() => createScriptedSession(["response"], { deadlineMs: 0 })).toThrow("deadlineMs must be a positive integer");
  });

  it("truncates streamed text and ends with an output-limit outcome", async () => {
    const session = createScriptedSession(["abcdef"], { maxOutputCharacters: 3 });
    const deltas: string[] = [];
    session.subscribe((event) => {
      if (event.type === "text_delta") deltas.push(event.delta);
    });

    const result = await session.prompt("keep output short");

    expect(result).toMatchObject({ status: "output_limit", text: "abc", error: "Output character limit exceeded" });
    expect(deltas.join("")).toBe("abc");
    expect(session.isRunning).toBe(false);
  });

  it("rejects a negative output limit", () => {
    expect(() => createScriptedSession(["response"], { maxOutputCharacters: -1 })).toThrow("maxOutputCharacters must be a non-negative integer");
  });

  it("reports empty and token-truncated final responses as failures", async () => {
    const empty = createScriptedSession([""]);
    expect(await empty.prompt("respond")).toMatchObject({ status: "error", error: "Model returned an empty final response" });
    const truncated = createScriptedSession(["seed"]);
    await truncated.prompt("seed");
    const seed = truncated.agent.state.messages.find((message) => message.role === "assistant") as AssistantMessage;
    truncated.agent.streamFunction = () => {
      const stream = createAssistantMessageEventStream();
      const message: AssistantMessage = { ...seed, content: [{ type: "text", text: "unfinished" }], stopReason: "length" };
      stream.push({ type: "done", reason: "length", message }); stream.end(message); return stream;
    };
    expect(await truncated.prompt("continue")).toMatchObject({ status: "output_limit", error: "Model response reached its output token limit" });
  });
});
