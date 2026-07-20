import { useEffect, useState } from "react";
import { ChatMessage } from "../types";
import { loadChatHistory, saveChatHistory } from "../storage/chatStore";
import { asRecord, msg, normalizeImportedMessage } from "../runtime/chatMessages";
import { PendingLogEntry } from "../runtime/logging";
import { errorMessage } from "../utils/errors";
import { createLogRequestId } from "../runtime/logging";

type HistoryStorage = {
  load: () => Promise<ChatMessage[]>;
  save: (messages: ChatMessage[]) => Promise<void>;
};

type SummaryResult = {
  summary: string;
  agent?: { id?: string; name?: string; model?: string };
};

type UseChatHistoryControllerArgs = {
  activeTab: string;
  historyMessageLimit: number;
  pushLog: (entry: PendingLogEntry) => void;
  summarizeHistory?: (args: { history: ChatMessage[]; requestId: string }) => Promise<SummaryResult>;
  storage?: HistoryStorage;
  download?: (filename: string, content: string, type: string) => void;
};

const defaultStorage: HistoryStorage = {
  load: loadChatHistory,
  save: saveChatHistory
};

export function useChatHistoryController({
  activeTab,
  historyMessageLimit,
  pushLog,
  summarizeHistory,
  storage = defaultStorage,
  download = downloadTextFile
}: UseChatHistoryControllerArgs) {
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [chatComposerDraft, setChatComposerDraft] = useState("");
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [isChatFullscreen, setIsChatFullscreen] = useState(false);
  const [isSummaryExporting, setIsSummaryExporting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const restored = (await storage.load()).map(normalizeImportedMessage).filter(Boolean) as ChatMessage[];
        if (cancelled) return;
        setHistory((current) => current.length === 0 ? restored : current);
        pushLog({ category: "chat", ok: true, message: `History restored (${restored.length})` });
      } catch (error) {
        if (!cancelled) {
          pushLog({ category: "chat", ok: false, message: "History restore failed", details: errorMessage(error) });
        }
      } finally {
        if (!cancelled) setHistoryLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pushLog, storage]);

  useEffect(() => {
    if (!historyLoaded) return;
    let cancelled = false;
    void storage.save(history).catch((error) => {
      if (!cancelled) {
        pushLog({ category: "chat", ok: false, message: "History persist failed", details: errorMessage(error) });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [history, historyLoaded, pushLog, storage]);

  useEffect(() => {
    if (activeTab !== "chat" && isChatFullscreen) setIsChatFullscreen(false);
  }, [activeTab, isChatFullscreen]);

  function append(message: ChatMessage) {
    setHistory((current) => [...current, message]);
  }

  function patchMessage(id: string, patch: Partial<ChatMessage>) {
    setHistory((current) => current.map((message) => message.id === id ? { ...message, ...patch } : message));
  }

  function clearHistory() {
    setHistory([]);
    pushLog({ category: "chat", message: "Chat cleared" });
  }

  function limitHistory(messages: ChatMessage[]) {
    const limit = clampHistoryLimit(historyMessageLimit);
    return messages.filter((message) => message.role !== "tool").slice(-limit);
  }

  function exportRawHistory() {
    const now = Date.now();
    download(
      `agent-go-round-history-${now}.json`,
      JSON.stringify({ kind: "raw_history", exportedAt: now, history }, null, 2),
      "application/json;charset=utf-8"
    );
    pushLog({ category: "chat", ok: true, message: `Raw history exported (${history.length})` });
  }

  async function exportSummaryHistory() {
    if (!summarizeHistory) {
      pushLog({ category: "chat", ok: false, message: "Summary export skipped: no active agent" });
      return;
    }
    if (history.length === 0) {
      pushLog({ category: "chat", ok: false, message: "Summary export skipped: empty history" });
      return;
    }

    setIsSummaryExporting(true);
    const requestId = createLogRequestId("summary");
    try {
      const result = await summarizeHistory({ history, requestId });
      const now = Date.now();
      download(
        `agent-go-round-summary-${now}.json`,
        JSON.stringify({ kind: "summary_history", exportedAt: now, summary: result.summary, agent: result.agent }, null, 2),
        "application/json;charset=utf-8"
      );
      pushLog({
        category: "chat",
        agent: result.agent?.name,
        ok: true,
        requestId,
        stage: "summary export",
        outcome: "success",
        message: "Summary history exported",
        details: result.summary
      });
    } catch (error) {
      pushLog({
        category: "chat",
        ok: false,
        requestId,
        stage: "summary export",
        outcome: "failure",
        message: "Summary export failed",
        details: errorMessage(error)
      });
    } finally {
      setIsSummaryExporting(false);
    }
  }

  async function importHistoryFile(file: File) {
    try {
      const text = await file.text();
      const imported = parseJson(text);
      const importedRecord = asRecord(imported);
      if (importedRecord?.kind === "raw_history" && Array.isArray(importedRecord.history)) {
        const nextHistory = importedRecord.history.map(normalizeImportedMessage).filter(Boolean) as ChatMessage[];
        setHistory(nextHistory);
        pushLog({ category: "chat", ok: true, message: `Raw history imported (${nextHistory.length})` });
        return;
      }

      const summaryText = importedRecord?.kind === "summary_history" && typeof importedRecord.summary === "string"
        ? importedRecord.summary
        : text.trim();
      setHistory([msg("user", summaryText, "summary_import", { displayName: "上次對話總結" })]);
      pushLog({ category: "chat", ok: true, message: "Summary history imported", details: summaryText });
    } catch (error) {
      pushLog({ category: "chat", ok: false, message: "Import history failed", details: errorMessage(error) });
    }
  }

  return {
    history,
    setHistory,
    chatComposerDraft,
    setChatComposerDraft,
    historyLoaded,
    isChatFullscreen,
    setIsChatFullscreen,
    isSummaryExporting,
    append,
    patchMessage,
    clearHistory,
    limitHistory,
    exportRawHistory,
    exportSummaryHistory,
    importHistoryFile
  };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function clampHistoryLimit(value: number) {
  if (!Number.isFinite(value)) return 10;
  return Math.max(1, Math.min(200, Math.round(value)));
}

function downloadTextFile(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(href);
}
