import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { IDBFactory } from "fake-indexeddb";

beforeEach(() => { vi.stubGlobal("indexedDB", new IDBFactory()); });

let testStorage: Storage;

function installStorage(): Storage {
  const values = new Map<string, string>();
  const storage = {
    get length() {
      return values.size;
    },
    key(index: number) {
      return [...values.keys()][index] ?? null;
    },
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(String(key), String(value));
    },
    removeItem(key: string) {
      values.delete(key);
    },
    clear() {
      values.clear();
    }
  } as Storage;
  Object.defineProperty(window, "localStorage", { configurable: true, value: storage });
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
  testStorage = storage;
  return storage;
}

async function loadApp(): Promise<void> {
  if (!testStorage) installStorage();
  vi.resetModules();
  document.body.innerHTML = '<main id="app"></main>';
  await import("./main");
  await vi.waitFor(() => expect(document.querySelector("#send")?.hasAttribute("disabled")).toBe(false));
  await new Promise<void>((resolve) => setTimeout(resolve, 40));
}

afterEach(() => {
  testStorage.clear();
  document.body.innerHTML = "";
});

describe("main workspace UI", () => {
  it("opens the provider surface and restores focus after Escape", async () => {
    await loadApp();
    const providerButton = document.querySelector<HTMLButtonElement>("#provider-toggle");
    const drawer = document.querySelector<HTMLElement>("#settings-drawer");
    const remember = document.querySelector<HTMLInputElement>("#remember-key");
    if (!providerButton || !drawer || !remember) throw new Error("Expected provider controls");
    expect(remember.checked).toBe(true);

    providerButton.focus();
    providerButton.click();
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    expect(drawer.hidden).toBe(false);
    expect(document.activeElement?.id).toBe("api-key");

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(drawer.hidden).toBe(true);
    expect(document.activeElement).toBe(providerButton);
  });

  it("keeps the app aligned with a keyboard-shrunken visual viewport", async () => {
    const originalVisualViewport = Object.getOwnPropertyDescriptor(window, "visualViewport");
    const listeners: Record<string, () => void> = {};
    const visualViewportState = {
      height: 400,
      offsetTop: 120,
      addEventListener(type: string, listener: () => void) {
        listeners[type] = listener;
      },
      removeEventListener() {}
    };
    const visualViewport = visualViewportState as unknown as VisualViewport;
    Object.defineProperty(window, "visualViewport", { configurable: true, value: visualViewport });

    try {
      await loadApp();
      expect(document.documentElement.style.getPropertyValue("--viewport-height")).toBe("400px");
      expect(document.documentElement.style.getPropertyValue("--viewport-offset-top")).toBe("120px");

      visualViewportState.height = 300;
      visualViewportState.offsetTop = 200;
      listeners.resize?.();

      expect(document.documentElement.style.getPropertyValue("--viewport-height")).toBe("300px");
      expect(document.documentElement.style.getPropertyValue("--viewport-offset-top")).toBe("200px");
    } finally {
      if (originalVisualViewport) Object.defineProperty(window, "visualViewport", originalVisualViewport);
      else Reflect.deleteProperty(window, "visualViewport");
    }
  });

  it("routes an explicit question to the other tab without creating a queue", async () => {
    await loadApp();
    const routeButton = document.querySelector<HTMLButtonElement>("#route-tab");
    const routeDialog = document.querySelector<HTMLElement>("#route-dialog");
    const routeTarget = document.querySelector<HTMLSelectElement>("#route-target");
    const routeMessage = document.querySelector<HTMLTextAreaElement>("#route-message");
    const routeForm = document.querySelector<HTMLFormElement>("#route-form");
    if (!routeButton || !routeDialog || !routeTarget || !routeMessage || !routeForm) throw new Error("Expected route controls");

    routeButton.click();
    expect(routeDialog.hidden).toBe(false);
    expect(routeTarget.options).toHaveLength(1);
    routeMessage.value = "Check the review tab";
    routeMessage.dispatchEvent(new Event("input", { bubbles: true }));
    routeForm.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

    expect(routeDialog.hidden).toBe(true);
    await new Promise<void>((resolve) => setTimeout(resolve, 1_000));
    expect(document.querySelectorAll("#tab-list .tab")).toHaveLength(2);
  });

  it("persists and restores a draft without requiring a provider key", async () => {
    await loadApp();
    const prompt = document.querySelector<HTMLTextAreaElement>("#prompt");
    if (!prompt) throw new Error("Expected prompt");
    prompt.value = "unfinished local draft";
    prompt.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise<void>((resolve) => setTimeout(resolve, 240));

    await loadApp();
    const restoredPrompt = document.querySelector<HTMLTextAreaElement>("#prompt");
    expect(restoredPrompt?.value).toBe("unfinished local draft");
    expect(window.localStorage.getItem("agent-go-round.workspace")).toBeNull();
    const { IndexedDbConversationStore, IndexedWorkspaceRecords } = await import("./core/conversations");
    const saved = await new IndexedDbConversationStore(new IndexedWorkspaceRecords(window.indexedDB)).load();
    expect(JSON.stringify(saved)).not.toContain("gsk_");
  });
});
