import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { WorkspaceTranscriptLine } from "../core/workspace-store";
import { SHELL_NOTICE } from "../core/shell-help";

export type TerminalLine = WorkspaceTranscriptLine;
export type TerminalModel = {
  id: string;
  mode: string;
  transcript: readonly TerminalLine[];
  messages: readonly AgentMessage[];
  expandedTools: Set<string>;
};
export const AI_WELCOME_ART = `                 ⚑
                 │
            .────┴────.
         .─╱   ╱ │ ╲   ╲─.
        ╱_____╱__│__╲_____╲
        ╰─┬─┬─┬─┬─┬─┬─┬─┬─╯
          │      │      │
       ___│      │   ___│
      /  /└───────┘  /  /
     /__/            /__/
     \  \            /  /
      \__\          /__/
         │   │  │   │
         └───┴──┴───┘

          agent-go-round

    › 輸入訊息，開始對話`;
type ToolDetails = { args?: unknown; result?: unknown };
type Row = { element: HTMLDivElement; marker: HTMLSpanElement; content: HTMLDivElement; text?: string; streaming?: boolean; details?: HTMLDetailsElement; pre?: HTMLPreElement; tool?: ToolDetails };

/** Owns terminal DOM only; rows survive unrelated updates and streaming is frame-batched. */
export class TerminalView {
  private rows = new Map<string, Row>();
  private tabId?: string;
  private mode?: string;
  private intro: HTMLDivElement;
  private logo: HTMLSpanElement;
  private label: HTMLSpanElement;
  private welcome: HTMLPreElement;
  private notice: HTMLParagraphElement;
  private pending?: TerminalModel;
  private frame?: number;
  constructor(private readonly element: HTMLDivElement) {
    this.intro = document.createElement("div"); this.intro.className = "terminal-intro";
    this.logo = document.createElement("span"); this.logo.className = "terminal-logo"; this.logo.textContent = "▐▛███▜▌";
    this.label = document.createElement("span");
    this.welcome = document.createElement("pre"); this.welcome.className = "terminal-welcome"; this.welcome.textContent = AI_WELCOME_ART; this.welcome.hidden = true;
    this.intro.append(this.logo, this.label, this.welcome);
    this.notice = document.createElement("p"); this.notice.className = "shell-notice"; this.notice.textContent = SHELL_NOTICE;
    element.append(this.intro);
  }
  schedule(model: TerminalModel): void {
    this.pending = model;
    if (this.frame !== undefined) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = undefined;
      const latest = this.pending; this.pending = undefined;
      if (latest && this.element.isConnected) this.render(latest);
    });
  }
  render(model: TerminalModel): void {
    if (this.frame !== undefined) cancelAnimationFrame(this.frame);
    this.frame = undefined; this.pending = undefined;
    const previousTop = this.element.scrollTop;
    let changed = this.tabId !== model.id || this.mode !== model.mode;
    this.tabId = model.id; this.mode = model.mode; this.element.dataset.tabId = model.id;
    const isAgent = model.mode === "agent";
    this.intro.classList.toggle("agent-welcome", isAgent);
    this.logo.hidden = isAgent;
    this.label.hidden = isAgent;
    this.welcome.hidden = !isAgent;
    this.label.textContent = model.mode === "shell" ? "簡易 bash · 虛擬檔案系統" : "AgentGoRound · Pi runtime";
    if (model.mode === "shell") { if (!this.notice.isConnected) this.intro.after(this.notice); }
    else this.notice.remove();
    const tools = new Map<string, ToolDetails>();
    for (const message of model.messages) {
      if (message.role === "assistant") for (const block of message.content) if (block.type === "toolCall") tools.set(block.id, { ...tools.get(block.id), args: block.arguments });
      if (message.role === "toolResult") tools.set(message.toolCallId, { ...tools.get(message.toolCallId), result: message.content });
    }
    const ids = new Set(model.transcript.map(line => line.id));
    for (const [id, row] of this.rows) if (!ids.has(id)) { row.element.remove(); this.rows.delete(id); changed = true; }
    let cursor: ChildNode | null = (model.mode === "shell" ? this.notice : this.intro).nextSibling;
    for (const line of model.transcript) {
      let row = this.rows.get(line.id);
      if (!row) {
        const element = document.createElement("div"), marker = document.createElement("span"), content = document.createElement("div");
        marker.className = "line-marker"; content.className = "line-content"; element.append(marker, content);
        row = { element, marker, content }; this.rows.set(line.id, row); changed = true;
      }
      if (row.element !== cursor) { this.element.insertBefore(row.element, cursor); changed = true; }
      cursor = row.element.nextSibling;
      row.element.className = `terminal-line ${line.role}${line.streaming ? " streaming" : ""}`;
      row.marker.textContent = line.role === "input" ? "❯" : line.role === "assistant" ? (line.streaming ? "⠇" : "●") : "·";
      if (row.text !== line.text || row.streaming !== line.streaming) {
        if (row.details) row.details.querySelector("summary")!.textContent = line.text;
        else if (!line.toolCallId) row.content.textContent = line.text;
        row.text = line.text; row.streaming = line.streaming; changed = true;
      }
      if (line.toolCallId) {
        if (!row.details) {
          const details = document.createElement("details"), summary = document.createElement("summary"), pre = document.createElement("pre");
          summary.textContent = line.text; details.open = model.expandedTools.has(line.toolCallId);
          details.addEventListener("toggle", () => { if (details.isConnected) { if (details.open) model.expandedTools.add(line.toolCallId!); else model.expandedTools.delete(line.toolCallId!); } });
          details.append(summary, pre); row.content.replaceChildren(details); row.details = details; row.pre = pre;
        }
        const tool = tools.get(line.toolCallId);
        if (!row.tool || row.tool.args !== tool?.args || row.tool.result !== tool?.result) {
          row.pre!.textContent = JSON.stringify({ arguments: tool?.args, result: tool?.result ?? "pending" }, null, 2);
          row.tool = tool;
        }
      }
    }
    this.element.scrollTop = changed ? this.element.scrollHeight : previousTop;
  }
  hasSelection(): boolean {
    const selection = window.getSelection();
    return !!selection && !selection.isCollapsed && (this.element.contains(selection.anchorNode) || this.element.contains(selection.focusNode));
  }
  destroy(): void {
    if (this.frame !== undefined) cancelAnimationFrame(this.frame);
    this.pending = undefined; this.frame = undefined; this.rows.clear(); this.element.replaceChildren();
  }
}
