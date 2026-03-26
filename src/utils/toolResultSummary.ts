type ToolResultSummaryArgs = {
  kind: "mcp" | "builtin";
  toolName: string;
  serverName?: string;
  input?: unknown;
  output: unknown;
};

const MAX_SHORT_TEXT = 320;
const MAX_LINE_LENGTH = 180;
const MAX_DEPTH = 3;
const PRIORITY_KEYS = ["title", "name", "url", "text", "content", "message", "summary", "result", "output", "data"];
export type ToolPromptDetailMode = "default" | "actionable";
const HIGH_SIGNAL_LINE_PATTERNS = [
  /目前無法使用/i,
  /無法使用 ai 模式/i,
  /目前不可用/i,
  /功能不可用/i,
  /你的裝置或帳戶目前無法使用/i,
  /your device or account currently can(?:not|'t) use/i,
  /currently unavailable/i,
  /feature is unavailable/i,
  /not available/i,
  /unusual traffic/i,
  /security challenge/i,
  /not a robot/i,
  /recaptcha/i,
  /驗證您是真人/i,
  /安全驗證/i,
  /我不是機器人/i,
  /登入/i,
  /sign in/i,
  /consent/i,
  /同意/i,
  /\b\d+\s+[A-Za-z0-9_.-]+\s*\/\s*[A-Za-z0-9_.-]+/i,
  /heading\s+"[^"]+\/[^"]+"/i,
  /link\s+"[^"]+\/[^"]+"/i,
  /combobox/i,
  /textbox/i,
  /textarea/i
];

function detailLimits(mode: ToolPromptDetailMode) {
  return mode === "actionable"
    ? {
        maxLineLength: 220,
        maxExcerptLines: 24,
        maxObjectKeys: 10,
        maxArrayItems: 12,
        maxRawTextChars: 2200
      }
    : {
        maxLineLength: MAX_LINE_LENGTH,
        maxExcerptLines: 18,
        maxObjectKeys: 10,
        maxArrayItems: 5,
        maxRawTextChars: 1200
      };
}

function stripAnsi(text: string) {
  return text.replace(/\u001b\[[0-9;]*m/g, "");
}

function truncate(text: string, max: number) {
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1))}…`;
}

function normalizeText(text: string) {
  return stripAnsi(text).replace(/\r/g, "").trim();
}

function isHighSignalLine(line: string) {
  return HIGH_SIGNAL_LINE_PATTERNS.some((pattern) => pattern.test(line));
}

function collectActionableTargetsFromText(text: string, limit = 10) {
  const normalized = normalizeText(text);
  if (!normalized) return [] as string[];

  const seen = new Set<string>();
  const lines = normalized.split("\n");
  const targets: Array<{ summary: string; score: number }> = [];

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+/g, " ").trim();
    if (!line) continue;

    const refMatch = line.match(/\[ref=([^\]]+)\]/i);
    if (!refMatch) continue;

    const ref = `@${refMatch[1]}`;
    const roleMatch = line.match(/(?:^|- )([A-Za-z][A-Za-z _-]*?)\s+"([^"]+)"/);
    const labelMatch = line.match(/"([^"]+)"/);
    const role = roleMatch?.[1]?.trim() ?? "element";
    const label = labelMatch?.[1]?.trim() ?? ref;
    const summary = `${ref} ${role} "${label}"`;
    if (seen.has(summary)) continue;
    seen.add(summary);
    let score = 0;
    const haystack = `${line} ${summary}`.toLowerCase();
    if (/heading\s+"[^"]+\/[^"]+"/i.test(line) || /link\s+"[^"]+\/[^"]+"/i.test(line)) score += 140;
    if (/\b\d+\s+[A-Za-z0-9_.-]+\s*\/\s*[A-Za-z0-9_.-]+/i.test(line)) score += 130;
    if (/combobox|textbox|textarea|input/i.test(haystack)) score += 120;
    if (/send|submit|search|搜尋|ask|query|ai 模式|trending|repo|repository|readme/i.test(haystack)) score += 90;
    if (/button|link/i.test(haystack)) score += 20;
    if (/skip to content|homepage|platform|solutions|resources|pricing|sign in|登入|global|navigation menu/i.test(haystack)) score -= 120;
    targets.push({ summary, score });
  }

  return targets
    .sort((a, b) => b.score - a.score || a.summary.localeCompare(b.summary))
    .slice(0, limit)
    .map((item) => item.summary);
}

function extractActionableTargets(value: unknown, limit = 10): string[] {
  const queue: unknown[] = [value];
  const seen = new Set<string>();
  const targets: string[] = [];

  while (queue.length > 0 && targets.length < limit) {
    const next = queue.shift();
    if (typeof next === "string") {
      for (const target of collectActionableTargetsFromText(next, limit - targets.length)) {
        if (seen.has(target)) continue;
        seen.add(target);
        targets.push(target);
      }
      continue;
    }

    if (Array.isArray(next)) {
      queue.push(...next);
      continue;
    }

    if (next && typeof next === "object") {
      queue.push(...Object.values(next as Record<string, unknown>));
    }
  }

  return targets;
}

function summarizeLongText(text: string, mode: ToolPromptDetailMode) {
  const limits = detailLimits(mode);
  const normalized = normalizeText(text);
  if (mode === "actionable" && normalized.length <= limits.maxRawTextChars) {
    return normalized;
  }
  const lines = normalized
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const seen = new Set<string>();
  const excerpt: string[] = [];
  const priorityExcerpt: Array<{ line: string; score: number }> = [];

  for (const line of lines) {
    if (!isHighSignalLine(line)) continue;
    if (seen.has(line)) continue;
    seen.add(line);
    let score = 0;
    if (/目前無法使用|currently unavailable|not available|安全驗證|recaptcha|unusual traffic/i.test(line)) score += 200;
    if (/\b\d+\s+[A-Za-z0-9_.-]+\s*\/\s*[A-Za-z0-9_.-]+/i.test(line)) score += 160;
    if (/heading\s+"[^"]+\/[^"]+"|link\s+"[^"]+\/[^"]+"/i.test(line)) score += 150;
    if (/combobox|textbox|textarea|input/i.test(line)) score += 130;
    if (/button|link/i.test(line)) score += 40;
    priorityExcerpt.push({ line: truncate(line, limits.maxLineLength), score });
  }

  const topPriorityExcerpt = priorityExcerpt
    .sort((a, b) => b.score - a.score || a.line.localeCompare(b.line))
    .slice(0, Math.min(6, limits.maxExcerptLines))
    .map((entry) => entry.line);

  for (const line of lines) {
    if (!/[A-Za-z0-9\u4e00-\u9fff]/.test(line)) continue;
    if (seen.has(line)) continue;
    seen.add(line);
    excerpt.push(truncate(line, limits.maxLineLength));
    if (topPriorityExcerpt.length + excerpt.length >= limits.maxExcerptLines) break;
  }

  if (!lines.length) {
    return "";
  }

  if (lines.length === 1 && normalized.length <= MAX_SHORT_TEXT) {
    return normalized;
  }

  return {
    type: "text_summary",
    chars: normalized.length,
    lines: lines.length,
    priorityExcerpt: topPriorityExcerpt,
    excerpt
  };
}

function summarizeValue(value: unknown, depth = 0, mode: ToolPromptDetailMode = "default"): unknown {
  const limits = detailLimits(mode);
  if (value === null || value === undefined) return value;
  if (depth >= MAX_DEPTH) {
    return "[truncated]";
  }
  if (typeof value === "string") {
    const normalized = normalizeText(value);
    if (!normalized) return "";
    if (!normalized.includes("\n") && normalized.length <= MAX_SHORT_TEXT) {
      return normalized;
    }
    return summarizeLongText(normalized, mode);
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    return {
      type: "array_summary",
      length: value.length,
      items: value.slice(0, limits.maxArrayItems).map((item) => summarizeValue(item, depth + 1, mode))
    };
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    entries.sort((a, b) => {
      const ai = PRIORITY_KEYS.indexOf(a[0]);
      const bi = PRIORITY_KEYS.indexOf(b[0]);
      const av = ai === -1 ? PRIORITY_KEYS.length : ai;
      const bv = bi === -1 ? PRIORITY_KEYS.length : bi;
      return av - bv || a[0].localeCompare(b[0]);
    });
    const summary: Record<string, unknown> = {};
    for (const [key, entryValue] of entries.slice(0, limits.maxObjectKeys)) {
      summary[key] = summarizeValue(entryValue, depth + 1, mode);
    }
    if (entries.length > limits.maxObjectKeys) {
      summary.__remainingKeys = entries.length - limits.maxObjectKeys;
    }
    return summary;
  }
  return String(value);
}

function formatScalar(value: unknown) {
  if (value === null || value === undefined || value === "") return "(empty)";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function renderSummaryLines(value: unknown, indent = "", mode: ToolPromptDetailMode = "default"): string[] {
  const limits = detailLimits(mode);
  if (value === null || value === undefined || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return [`${indent}- ${formatScalar(value)}`];
  }

  if (Array.isArray(value)) {
    const lines = [`${indent}- 陣列，共 ${value.length} 項`];
    value.slice(0, limits.maxArrayItems).forEach((item) => {
      lines.push(...renderSummaryLines(item, `${indent}  `, mode));
    });
    return lines;
  }

  const obj = value as Record<string, unknown>;

  if (obj.type === "text_summary" && Array.isArray(obj.excerpt)) {
    const lines = [`${indent}- 文字摘要：共 ${formatScalar(obj.lines)} 行，擷取重點如下`];
    if (Array.isArray(obj.priorityExcerpt) && obj.priorityExcerpt.length) {
      lines.push(`${indent}  - 關鍵狀態：`);
      obj.priorityExcerpt.forEach((line) => {
        lines.push(`${indent}    - ${String(line)}`);
      });
    }
    obj.excerpt.forEach((line) => {
      lines.push(`${indent}  - ${String(line)}`);
    });
    return lines;
  }

  if (obj.type === "array_summary" && Array.isArray(obj.items)) {
    const lines = [`${indent}- 陣列摘要：共 ${formatScalar(obj.length)} 項`];
    obj.items.forEach((item) => {
      lines.push(...renderSummaryLines(item, `${indent}  `));
    });
    return lines;
  }

  const lines: string[] = [];
  Object.entries(obj).forEach(([key, entryValue]) => {
    if (entryValue && typeof entryValue === "object") {
      lines.push(`${indent}- ${key}:`);
      lines.push(...renderSummaryLines(entryValue, `${indent}  `, mode));
      return;
    }
    lines.push(`${indent}- ${key}: ${formatScalar(entryValue)}`);
  });
  return lines.length ? lines : [`${indent}- (empty)`];
}

export function buildToolResultPromptBlock(args: ToolResultSummaryArgs, mode: ToolPromptDetailMode = "default") {
  const outputSummary = summarizeValue(args.output, 0, mode);
  const observationLines = renderSummaryLines(outputSummary, "", mode);
  const actionableTargets = mode === "actionable" ? extractActionableTargets(args.output, 12) : [];
  const confirmationState =
    args.output && typeof args.output === "object" && "confirmed" in (args.output as Record<string, unknown>) && typeof (args.output as Record<string, unknown>).confirmed === "boolean"
      ? ((args.output as Record<string, unknown>).confirmed as boolean)
      : null;

  if (mode === "actionable") {
    return [
      "以下是工具的內部觀察結果，提供下一步規劃與工具選擇使用。",
      "請保留對後續操作真正有幫助的頁面狀態、元素、文字與結構資訊。",
      "除非使用者明確要求檢視工具流程，否則最終回答不要直接貼出這些內部觀察內容。",
      confirmationState === true ? "若這是確認工具的結果，表示使用者已同意繼續。請立即執行下一步工具流程，不要停在確認訊息。" : "",
      confirmationState === false ? "若這是確認工具的結果，表示使用者拒絕繼續。請停止工具流程，並清楚說明目前卡住的原因與需要的手動動作。" : "",
      actionableTargets.length
        ? ["可互動目標（若需要操作，優先使用這些 refs 或元素）：", ...actionableTargets.map((target) => `- ${target}`)].join("\n")
        : "",
      "",
      "工具觀察：",
      ...observationLines
    ].join("\n");
  }

  return [
    "以下是工具的內部摘要。除非使用者明確要求查看工具流程，否則最終回答不要提及工具名稱、server 名稱、input/output、JSON、或原始工具結果。",
    "請只抽取與使用者問題直接相關的資訊，整理成自然語句回答。",
    "",
    "觀察摘要：",
    ...observationLines
  ].join("\n");
}
