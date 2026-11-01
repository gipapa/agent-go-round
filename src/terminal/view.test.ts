import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { TerminalView, type TerminalModel } from "./view";

let frames: Map<number, FrameRequestCallback>;
beforeEach(() => {
  frames = new Map(); let next = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.set(++next, callback); return next; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
});
afterEach(() => { document.body.replaceChildren(); vi.unstubAllGlobals(); });
function setup() {
  const element = document.createElement("div"); document.body.append(element);
  const view = new TerminalView(element);
  const model: TerminalModel = { id: "main", mode: "agent", transcript: [{ id: "old", role: "assistant", text: "Keep this selection" }, { id: "live", role: "assistant", text: "", streaming: true }], messages: [], expandedTools: new Set() };
  return { element, view, model };
}
it("preserves historical DOM and selection while appending and updating a stream", () => {
  const { element, view, model } = setup();
  model.transcript = [...Array.from({ length: 500 }, (_, index) => ({ id: `history-${index}`, role: "system" as const, text: `History ${index}` })), ...model.transcript];
  view.render(model);
  const rows = [...element.querySelectorAll(".terminal-line")];
  const selected = rows.at(-2)!.querySelector(".line-content")!.firstChild!;
  const range = document.createRange(); range.selectNodeContents(selected);
  const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
  view.render({ ...model, transcript: [...model.transcript.slice(0, -1), { id: "live", role: "assistant", text: "New text", streaming: true }, { id: "new", role: "system", text: "Appended" }] });
  expect([...element.querySelectorAll(".terminal-line")].slice(0, -1)).toEqual(rows);
  expect(rows.at(-2)!.querySelector(".line-content")!.firstChild).toBe(selected);
  expect(selection.toString()).toBe("Keep this selection");
  expect(view.hasSelection()).toBe(true);
  expect(rows.at(-1)!.textContent).toContain("New text");
});
it("coalesces deltas into one frame and discards a pending update when switching tabs", () => {
  const { element, view, model } = setup(); view.render(model);
  const update = (text: string) => ({ ...model, transcript: [model.transcript[0], { ...model.transcript[1], text }] });
  view.schedule(update("a")); view.schedule(update("ab")); view.schedule(update("abc"));
  expect(frames.size).toBe(1); expect(element.textContent).not.toContain("abc");
  for (const [id, callback] of frames) { frames.delete(id); callback(1); }
  expect(element.textContent).toContain("abc");
  view.schedule(update("wrong tab"));
  view.render({ ...model, id: "other", transcript: [{ id: "other", role: "system", text: "Other tab" }] });
  expect(frames.size).toBe(0); expect(element.textContent).not.toContain("wrong tab");
  expect(element.textContent).toContain("Other tab");
});
it("keeps a tool panel open as its result arrives and unrelated lines change", () => {
  const { element, view, model } = setup();
  const tool = { id: "tool", role: "system" as const, text: "read finished", toolCallId: "call" };
  model.transcript = [tool]; model.expandedTools.add("call"); view.render(model);
  const details = element.querySelector("details")!;
  const messages = [{ role: "toolResult", toolCallId: "call", content: [{ type: "text", text: "Actual file contents" }] }] as unknown as AgentMessage[];
  view.render({ ...model, messages, transcript: [tool, { id: "next", role: "assistant", text: "Next delta" }] });
  expect(element.querySelector("details")).toBe(details); expect(details.open).toBe(true);
  expect(details.querySelector("pre")!.textContent).toContain("Actual file contents");
});
it("preserves manual scrolling on unchanged renders and follows new output", () => {
  const { element, view, model } = setup();
  Object.defineProperty(element, "scrollHeight", { value: 1000 }); view.render(model);
  element.scrollTop = 200; view.render(model); expect(element.scrollTop).toBe(200);
  view.render({ ...model, transcript: [...model.transcript, { id: "new", role: "system", text: "New output" }] });
  expect(element.scrollTop).toBe(1000);
});
