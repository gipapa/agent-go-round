import { describe, expect, it } from "vitest";
import { createScriptedSession } from "./scripted";
import { SessionBusyError } from "./session";

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
});
