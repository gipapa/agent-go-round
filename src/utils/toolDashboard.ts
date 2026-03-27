import { generateId } from "./id";

type DashboardShowSpec = {
  key?: string;
  title: string;
  subtitle?: string;
  width?: string;
};

type DashboardEntry = {
  id: string;
  key?: string;
  root: HTMLDivElement;
  titleEl: HTMLDivElement;
  subtitleEl: HTMLDivElement;
  bodyEl: HTMLDivElement;
  cleanup: Set<() => void>;
};

type DashboardHandle = {
  id: string;
  key?: string;
  root: HTMLDivElement;
  body: HTMLDivElement;
  title: HTMLDivElement;
  subtitle: HTMLDivElement;
};

type DashboardRegistry = {
  byId: Map<string, DashboardEntry>;
  byKey: Map<string, string>;
};

declare global {
  interface Window {
    __agrToolDashboardRegistry?: DashboardRegistry;
  }
}

function getRegistry() {
  if (typeof window === "undefined") {
    throw new Error("dashboard helper 只能在瀏覽器環境中使用。");
  }

  if (!window.__agrToolDashboardRegistry) {
    window.__agrToolDashboardRegistry = {
      byId: new Map<string, DashboardEntry>(),
      byKey: new Map<string, string>()
    };
  }

  return window.__agrToolDashboardRegistry;
}

function resolveEntry(idOrKey: string) {
  const registry = getRegistry();
  const direct = registry.byId.get(idOrKey) ?? null;
  if (direct) return direct;
  const keyId = registry.byKey.get(idOrKey);
  if (!keyId) return null;
  return registry.byId.get(keyId) ?? null;
}

function runCleanup(entry: DashboardEntry) {
  Array.from(entry.cleanup).forEach((cleanup) => {
    try {
      cleanup();
    } catch {
      // ignore cleanup errors
    }
  });
  entry.cleanup.clear();
}

function buildDashboardDom(spec: DashboardShowSpec) {
  if (typeof document === "undefined" || !document.body) {
    throw new Error("目前頁面還不能建立 dashboard。");
  }

  const root = document.createElement("div");
  root.dataset.agrToolDashboard = "true";
  root.style.position = "fixed";
  root.style.right = "18px";
  root.style.bottom = "18px";
  root.style.width = spec.width ?? "min(360px, calc(100vw - 28px))";
  root.style.maxWidth = "calc(100vw - 28px)";
  root.style.borderRadius = "20px";
  root.style.border = "1px solid rgba(120, 144, 255, 0.28)";
  root.style.background = "linear-gradient(180deg, rgba(7,14,28,0.96), rgba(12,19,35,0.96))";
  root.style.boxShadow = "0 18px 48px rgba(0, 0, 0, 0.42)";
  root.style.backdropFilter = "blur(14px)";
  root.style.zIndex = "2147483000";
  root.style.color = "#f3f7ff";
  root.style.overflow = "hidden";
  root.style.fontFamily = "\"Segoe UI\", \"Noto Sans TC\", sans-serif";

  const header = document.createElement("div");
  header.style.display = "flex";
  header.style.alignItems = "flex-start";
  header.style.justifyContent = "space-between";
  header.style.gap = "12px";
  header.style.padding = "14px 16px 10px";
  header.style.borderBottom = "1px solid rgba(255,255,255,0.08)";

  const textWrap = document.createElement("div");
  textWrap.style.display = "grid";
  textWrap.style.gap = "4px";

  const titleEl = document.createElement("div");
  titleEl.style.fontSize = "14px";
  titleEl.style.fontWeight = "800";
  titleEl.style.letterSpacing = "0.06em";
  titleEl.style.textTransform = "uppercase";
  titleEl.textContent = spec.title;

  const subtitleEl = document.createElement("div");
  subtitleEl.style.fontSize = "12px";
  subtitleEl.style.opacity = "0.78";
  subtitleEl.textContent = spec.subtitle ?? "";
  subtitleEl.style.display = spec.subtitle ? "block" : "none";

  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.textContent = "×";
  closeButton.style.width = "30px";
  closeButton.style.height = "30px";
  closeButton.style.border = "1px solid rgba(255,255,255,0.15)";
  closeButton.style.borderRadius = "999px";
  closeButton.style.background = "rgba(255,255,255,0.06)";
  closeButton.style.color = "#f3f7ff";
  closeButton.style.cursor = "pointer";
  closeButton.style.fontSize = "18px";
  closeButton.style.lineHeight = "1";

  const bodyEl = document.createElement("div");
  bodyEl.style.padding = "16px";

  textWrap.append(titleEl, subtitleEl);
  header.append(textWrap, closeButton);
  root.append(header, bodyEl);
  document.body.appendChild(root);

  return { root, titleEl, subtitleEl, bodyEl, closeButton };
}

function toHandle(entry: DashboardEntry): DashboardHandle {
  return {
    id: entry.id,
    key: entry.key,
    root: entry.root,
    body: entry.bodyEl,
    title: entry.titleEl,
    subtitle: entry.subtitleEl
  };
}

export type ToolDashboardHelpers = ReturnType<typeof createToolDashboardHelpers>;

export function createToolDashboardHelpers() {
  function close(idOrKey: string) {
    const registry = getRegistry();
    const entry = resolveEntry(idOrKey);
    if (!entry) return false;

    runCleanup(entry);
    entry.root.remove();
    registry.byId.delete(entry.id);
    if (entry.key) registry.byKey.delete(entry.key);
    return true;
  }

  return {
    show(spec: DashboardShowSpec): DashboardHandle {
      const registry = getRegistry();
      const existing = spec.key ? resolveEntry(spec.key) : null;
      if (existing) {
        runCleanup(existing);
        existing.titleEl.textContent = spec.title;
        existing.subtitleEl.textContent = spec.subtitle ?? "";
        existing.subtitleEl.style.display = spec.subtitle ? "block" : "none";
        existing.bodyEl.replaceChildren();
        return toHandle(existing);
      }

      const dom = buildDashboardDom(spec);
      const entry: DashboardEntry = {
        id: generateId(),
        key: spec.key,
        root: dom.root,
        titleEl: dom.titleEl,
        subtitleEl: dom.subtitleEl,
        bodyEl: dom.bodyEl,
        cleanup: new Set()
      };

      dom.closeButton.addEventListener("click", () => {
        close(entry.id);
      });

      registry.byId.set(entry.id, entry);
      if (entry.key) registry.byKey.set(entry.key, entry.id);
      return toHandle(entry);
    },
    get(idOrKey: string): DashboardHandle | null {
      const entry = resolveEntry(idOrKey);
      return entry ? toHandle(entry) : null;
    },
    update(idOrKey: string, patch: { title?: string; subtitle?: string; html?: string }) {
      const entry = resolveEntry(idOrKey);
      if (!entry) {
        throw new Error(`Dashboard not found: ${idOrKey}`);
      }
      if (typeof patch.title === "string") {
        entry.titleEl.textContent = patch.title;
      }
      if (typeof patch.subtitle === "string") {
        entry.subtitleEl.textContent = patch.subtitle;
        entry.subtitleEl.style.display = patch.subtitle ? "block" : "none";
      }
      if (typeof patch.html === "string") {
        entry.bodyEl.innerHTML = patch.html;
      }
      return toHandle(entry);
    },
    registerCleanup(idOrKey: string, cleanup: () => void) {
      const entry = resolveEntry(idOrKey);
      if (!entry) {
        throw new Error(`Dashboard not found: ${idOrKey}`);
      }
      entry.cleanup.add(cleanup);
    },
    clear(idOrKey: string) {
      const entry = resolveEntry(idOrKey);
      if (!entry) return false;
      runCleanup(entry);
      entry.bodyEl.replaceChildren();
      return true;
    },
    close
  };
}
