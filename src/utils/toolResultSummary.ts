type ToolResultSummaryArgs = {
  kind: "mcp" | "builtin";
  toolName: string;
  serverName?: string;
  input?: unknown;
  output: unknown;
};

const MAX_SHORT_TEXT = 320;
const MAX_LINE_LENGTH = 180;
const MAX_EXCERPT_LINES = 18;
const MAX_OBJECT_KEYS = 10;
const MAX_ARRAY_ITEMS = 5;
const MAX_DEPTH = 3;
const PRIORITY_KEYS = ["title", "name", "url", "text", "content", "message", "summary", "result", "output", "data"];

function stripAnsi(text: string) {
  return text.replace(/\u001b\[[0-9;]*m/g, "");
}

function truncate(text: string, max: number) {
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1))}…`;
}

function normalizeText(text: string) {
  return stripAnsi(text).replace(/\r/g, "").trim();
}

function summarizeLongText(text: string) {
  const normalized = normalizeText(text);
  const lines = normalized
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const seen = new Set<string>();
  const excerpt: string[] = [];
  for (const line of lines) {
    if (!/[A-Za-z0-9\u4e00-\u9fff]/.test(line)) continue;
    if (seen.has(line)) continue;
    seen.add(line);
    excerpt.push(truncate(line, MAX_LINE_LENGTH));
    if (excerpt.length >= MAX_EXCERPT_LINES) break;
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
    excerpt
  };
}

function summarizeValue(value: unknown, depth = 0): unknown {
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
    return summarizeLongText(normalized);
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    return {
      type: "array_summary",
      length: value.length,
      items: value.slice(0, MAX_ARRAY_ITEMS).map((item) => summarizeValue(item, depth + 1))
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
    for (const [key, entryValue] of entries.slice(0, MAX_OBJECT_KEYS)) {
      summary[key] = summarizeValue(entryValue, depth + 1);
    }
    if (entries.length > MAX_OBJECT_KEYS) {
      summary.__remainingKeys = entries.length - MAX_OBJECT_KEYS;
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

function renderSummaryLines(value: unknown, indent = ""): string[] {
  if (value === null || value === undefined || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return [`${indent}- ${formatScalar(value)}`];
  }

  if (Array.isArray(value)) {
    const lines = [`${indent}- 陣列，共 ${value.length} 項`];
    value.slice(0, MAX_ARRAY_ITEMS).forEach((item) => {
      lines.push(...renderSummaryLines(item, `${indent}  `));
    });
    return lines;
  }

  const obj = value as Record<string, unknown>;

  if (obj.type === "text_summary" && Array.isArray(obj.excerpt)) {
    const lines = [`${indent}- 文字摘要：共 ${formatScalar(obj.lines)} 行，擷取重點如下`];
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
      lines.push(...renderSummaryLines(entryValue, `${indent}  `));
      return;
    }
    lines.push(`${indent}- ${key}: ${formatScalar(entryValue)}`);
  });
  return lines.length ? lines : [`${indent}- (empty)`];
}

export function buildToolResultPromptBlock(args: ToolResultSummaryArgs) {
  const outputSummary = summarizeValue(args.output);
  const observationLines = renderSummaryLines(outputSummary);

  return [
    "以下是工具的內部摘要。除非使用者明確要求查看工具流程，否則最終回答不要提及工具名稱、server 名稱、input/output、JSON、或原始工具結果。",
    "請只抽取與使用者問題直接相關的資訊，整理成自然語句回答。",
    "",
    "觀察摘要：",
    ...observationLines
  ].join("\n");
}
