/** Behaviour shared by the human Preview and Edit surfaces. */
const TOUCH_LAYOUT = "(max-width: 760px), (hover: none) and (pointer: coarse)";

/** Matches the stylesheet breakpoint that switches these surfaces to their touch layout. */
export function isTouchLayout(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia(TOUCH_LAYOUT).matches;
}

/** Enter and Escape belong to the IME while Chinese input is still being composed. */
export const isComposing = (event: KeyboardEvent): boolean => event.isComposing || event.keyCode === 229;

export function trapTabKey(event: KeyboardEvent, root: HTMLElement): void {
  const controls = [...root.querySelectorAll<HTMLElement>("button, input, textarea, a[href]")]
    .filter(control => !control.matches(":disabled") && control.tabIndex >= 0 && control.getClientRects().length > 0);
  const first = controls[0], last = controls.at(-1), active = document.activeElement;
  if (event.shiftKey && (active === first || active === root)) { event.preventDefault(); last?.focus(); }
  else if (!event.shiftKey && active === last) { event.preventDefault(); first?.focus(); }
}

export type ToolButtonOptions = { icon?: string; tone?: "primary" | "danger" | "ghost" };

/** The label stays in the DOM on every layout, so it keeps naming icon-only touch buttons. */
export function toolButton(label: string, { icon, tone }: ToolButtonOptions = {}): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = tone ? `tool-button ${tone}` : "tool-button";
  button.title = label;
  if (icon) button.dataset.icon = icon;
  const text = document.createElement("span");
  text.className = "tool-label";
  text.textContent = label;
  button.append(text);
  return button;
}
