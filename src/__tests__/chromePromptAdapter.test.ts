import { afterEach, describe, expect, it } from "vitest";
import { ChromePromptAdapter } from "../adapters/chromePrompt";

describe("Chrome Prompt adapter", () => {
  afterEach(() => {
    delete window.ai;
  });

  it("fails closed when the prompt stream returns a non-text chunk", async () => {
    window.ai = {
      languageModel: {
        create: async () => ({
          promptStreaming: async function* () {
            yield { unexpected: true };
          }
        })
      }
    };
    const events = [];
    for await (const event of ChromePromptAdapter.chat({
      agent: { id: "chrome", name: "Chrome", type: "chrome_prompt" },
      input: "hello",
      history: []
    })) events.push(event);
    expect(events).toEqual([{ type: "error", kind: "provider", retryable: false, message: "Chrome Prompt API returned a non-text stream chunk." }]);
  });

  it("uses a safe default when the response limit is malformed", async () => {
    window.ai = {
      languageModel: {
        create: async () => ({
          promptStreaming: async function* () {
            yield "done";
          }
        })
      }
    };
    const events = [];
    for await (const event of ChromePromptAdapter.chat({
      agent: { id: "chrome", name: "Chrome", type: "chrome_prompt" },
      input: "hello",
      history: [],
      maxModelResponseChars: Number.NaN
    })) events.push(event);
    expect(events).toEqual([{ type: "delta", text: "done" }, { type: "done", text: "done" }]);
  });
});
