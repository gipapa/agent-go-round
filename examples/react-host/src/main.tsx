import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

type AgentGoRoundWidget = {
  open: () => void;
  close: () => void;
  destroy: () => void;
  registerTool: (spec: {
    name: string;
    label?: string;
    description: string;
    parameters: unknown;
  }, handler: (request: { signal: AbortSignal }) => unknown | Promise<unknown>) => () => void;
};

type AgentGoRoundGlobal = {
  mount: (options?: { appUrl?: string; target?: HTMLElement; mode?: "popup" | "inline"; buttonLabel?: string }) => AgentGoRoundWidget;
};

declare global {
  interface Window {
    AgentGoRound?: AgentGoRoundGlobal;
  }
}

function loadEmbedLoader(appUrl: string): Promise<void> {
  if (window.AgentGoRound) return Promise.resolve();
  const script = document.createElement("script");
  script.type = "module";
  script.src = new URL("embed.js", appUrl).href;
  return new Promise((resolve, reject) => {
    script.addEventListener("load", () => resolve(), { once: true });
    script.addEventListener("error", () => reject(new Error(`Unable to load AgentGoRound from ${script.src}`)), { once: true });
    document.head.append(script);
  });
}

function App() {
  const widget = useRef<AgentGoRoundWidget>();
  const [status, setStatus] = useState("loading embed loader");
  const appUrl = import.meta.env.VITE_AGENT_APP_URL || "http://127.0.0.1:4173/";

  useEffect(() => {
    let disposed = false;
    let unregister: (() => void) | undefined;
    void loadEmbedLoader(appUrl)
      .then(() => {
        if (disposed || !window.AgentGoRound) return;
        const mounted = window.AgentGoRound.mount({ appUrl, target: document.body, mode: "popup", buttonLabel: "Open from React" });
        widget.current = mounted;
        unregister = mounted.registerTool(
          {
            name: "read_react_host_state",
            label: "Read React host state",
            description: "Read the current status from the React host.",
            parameters: { type: "object", additionalProperties: false, properties: {} }
          },
          async ({ signal }) => {
            if (signal.aborted) throw new Error("React host request cancelled");
            return { host: "react", state: "ready" };
          }
        );
        setStatus("widget mounted from React");
      })
      .catch((error: unknown) => setStatus(error instanceof Error ? error.message : String(error)));
    return () => {
      disposed = true;
      unregister?.();
      widget.current?.destroy();
      widget.current = undefined;
    };
  }, [appUrl]);

  return (
    <main className="host-shell">
      <p className="eyebrow">REACT HOST</p>
      <h1>AgentGoRound in a React component</h1>
      <p>{status}</p>
      <div className="actions">
        <button type="button" onClick={() => widget.current?.open()}>Open widget</button>
        <button type="button" onClick={() => widget.current?.close()}>Close widget</button>
      </div>
      <p className="hint">The widget is created in <code>useEffect</code>, registers a host tool, and is destroyed during unmount.</p>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
