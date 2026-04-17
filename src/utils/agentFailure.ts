export function detectTerminalAgentFailure(text: string) {
  const normalized = String(text ?? "").trim();
  if (!normalized) return null;
  if (/^Request failed:/i.test(normalized)) return normalized;
  if (/^HTTP \d+/i.test(normalized)) return normalized;
  if (/rate_limit_exceeded|insufficient_quota|quota|api key|invalid api key/i.test(normalized)) return normalized;
  if (/Chrome Prompt API not available/i.test(normalized)) return normalized;
  return null;
}

export function buildAgentFailureContent(errorText: string, task?: string) {
  const lines = ["【執行失敗】", "這一輪請求沒有成功完成，系統已停止重試。"];
  if (task) {
    lines.push("", "【原始任務】", task);
  }
  lines.push("", "【錯誤訊息】", String(errorText ?? "").trim());
  return lines.join("\n");
}

export function classifyRetryableAgentFailure(text: string) {
  const normalized = String(text ?? "").trim();
  if (!normalized) return null;
  if (normalized.startsWith("Request failed: HTTP 400") || normalized.startsWith("Request failed: HTTP 422")) {
    return { retryable: false, markFailure: false };
  }
  if (normalized.startsWith("Request failed: HTTP ")) {
    const status = Number(normalized.slice("Request failed: HTTP ".length).split(/\D/, 1)[0] || 0);
    if (status === 400 || status === 422) return { retryable: false, markFailure: false };
    return { retryable: true, markFailure: true };
  }
  if (normalized.startsWith("Request failed:")) {
    return { retryable: true, markFailure: true };
  }
  if (normalized.startsWith("HTTP 400") || normalized.startsWith("HTTP 422")) {
    return { retryable: false, markFailure: false };
  }
  if (normalized.startsWith("HTTP ")) {
    return { retryable: true, markFailure: true };
  }
  if (normalized.includes("Chrome Prompt API not available")) {
    return { retryable: true, markFailure: true };
  }
  return null;
}
