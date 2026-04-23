import React, { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ErrorBoundary from "../ui/ErrorBoundary";

function CrashingChild() {
  throw new Error("render boom");
}

describe("ErrorBoundary", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    vi.spyOn(console, "error").mockImplementation(() => {});
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root?.unmount();
      });
    }
    container?.remove();
    root = null;
    container = null;
    vi.restoreAllMocks();
  });

  it("renders fallback UI and reports render errors", async () => {
    const onError = vi.fn();

    await act(async () => {
      root?.render(
        <ErrorBoundary onError={onError}>
          <CrashingChild />
        </ErrorBoundary>
      );
    });

    expect(container?.textContent).toContain("Render failed");
    expect(container?.textContent).toContain("render boom");
    expect(onError).toHaveBeenCalledTimes(1);
  });
});
