import React, { useMemo, useRef, useState } from "react";
import type { LogEntry } from "../types";
import {
  formatLogEntryForClipboard,
  formatLogOutcomeLabel,
  inferLogOutcome,
  sortLogEntries,
  type LogSort
} from "../runtime/logging";

async function copyText(value: string) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Fall through to textarea fallback below.
  }

  try {
    const area = document.createElement("textarea");
    area.value = value;
    area.setAttribute("readonly", "true");
    area.style.position = "fixed";
    area.style.opacity = "0";
    area.style.pointerEvents = "none";
    document.body.appendChild(area);
    area.focus();
    area.select();
    area.setSelectionRange(0, area.value.length);
    const copied = document.execCommand("copy");
    area.remove();
    return copied;
  } catch {
    return false;
  }
}

export default function LogPanel(props: { entries: LogEntry[]; onClear: () => void }) {
  const [collapsed, setCollapsed] = useState(true);
  const [height, setHeight] = useState(160);
  const [sort, setSort] = useState<LogSort>({ key: "ts", dir: "desc" });
  const resizeRef = useRef<{ startY: number; startHeight: number } | null>(null);
  const sortedEntries = useMemo(() => sortLogEntries(props.entries, sort), [props.entries, sort]);
  const visibleText = useMemo(
    () => sortedEntries.map((item) => formatLogEntryForClipboard(item)).join("\n\n---\n\n"),
    [sortedEntries]
  );

  React.useEffect(() => {
    function onMove(event: MouseEvent) {
      if (!resizeRef.current) return;
      const delta = resizeRef.current.startY - event.clientY;
      setHeight(Math.min(360, Math.max(80, resizeRef.current.startHeight + delta)));
    }

    function onUp() {
      resizeRef.current = null;
      document.body.style.userSelect = "";
    }

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  function toggleSort(key: LogSort["key"]) {
    setSort((current) => ({
      key,
      dir: current.key === key && current.dir === "asc" ? "desc" : "asc"
    }));
  }

  function sortIndicator(key: LogSort["key"]) {
    return sort.key === key ? (sort.dir === "asc" ? " ^" : " v") : "";
  }

  return (
    <div className="log-shell card">
      <div className="log-header">
        <div className="log-title">Log</div>
        <div className="log-actions">
          <button className="log-toggle" onClick={() => visibleText.trim() && void copyText(visibleText)}>
            Copy Visible
          </button>
          <button className="log-toggle" onClick={props.onClear}>Clear</button>
          <button className="log-toggle" onClick={() => setCollapsed((current) => !current)}>
            {collapsed ? "Expand" : "Collapse"}
          </button>
        </div>
      </div>
      {!collapsed && (
        <div className="log-body" style={{ height }}>
          <div
            className="log-resize-handle"
            onMouseDown={(event) => {
              resizeRef.current = { startY: event.clientY, startHeight: height };
              document.body.style.userSelect = "none";
            }}
          />
          {props.entries.length === 0 && <div className="log-empty">No logs yet.</div>}
          {props.entries.length > 0 && (
            <div className="log-table">
              <div className="log-row log-row-head">
                <button className="log-sort" onClick={() => toggleSort("category")}>Category{sortIndicator("category")}</button>
                <button className="log-sort" onClick={() => toggleSort("agent")}>Agent{sortIndicator("agent")}</button>
                <button className="log-sort" onClick={() => toggleSort("outcome")}>Outcome{sortIndicator("outcome")}</button>
                <button className="log-sort" onClick={() => toggleSort("requestId")}>Req{sortIndicator("requestId")}</button>
                <button className="log-sort" onClick={() => toggleSort("ts")}>Time{sortIndicator("ts")}</button>
                <button className="log-sort" onClick={() => toggleSort("message")}>Log{sortIndicator("message")}</button>
              </div>
              {sortedEntries.map((item) => {
                const outcome = item.outcome ?? inferLogOutcome(item);
                const detailsText = formatLogEntryForClipboard(item);
                return (
                  <details key={item.id} className="log-row log-entry">
                    <summary className="log-summary">
                      <div className="log-cell log-category">{item.category}</div>
                      <div className="log-cell log-agent">{item.agent ?? "-"}</div>
                      <div className={`log-cell log-outcome ${outcome}`}>{formatLogOutcomeLabel(outcome)}</div>
                      <div className="log-cell log-request-id">{item.requestId ?? "-"}</div>
                      <div className="log-cell log-time">{new Date(item.ts).toLocaleString()}</div>
                      <div className="log-cell log-message">{item.message}</div>
                    </summary>
                    <div className="log-details">
                      <div className="log-details-head">
                        <div className="log-details-label">Log</div>
                        <button
                          type="button"
                          className="log-copy-btn"
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            void copyText(detailsText);
                          }}
                        >
                          Copy
                        </button>
                      </div>
                      <pre className="log-details-body">{detailsText}</pre>
                    </div>
                  </details>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
