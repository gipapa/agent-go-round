import { BrowserObservationDigest, BrowserObservationTarget } from "../types";

const BLOCKED_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /currently unavailable|not available|功能不可用|目前無法使用|不可用/i, reason: "頁面明確表示此功能目前不可用。" },
  { pattern: /unusual traffic|security challenge|not a robot|recaptcha|安全驗證|我不是機器人/i, reason: "頁面停在安全驗證或 bot challenge。" }
];

const TARGET_NOISE = /skip to content|homepage|sign in|sign up|pricing|platform|solutions|resources|open source|enterprise|appearance settings|search or jump/i;
const CONTENT_NOISE = /skip to content|navigation menu|footer|terms|privacy|security|status|community|docs|contact|pricing|sign in|sign up|首頁|登入|服務條款|隱私權/i;

function normalizeText(text: string) {
  return String(text ?? "").replace(/\u001b\[[0-9;]*m/g, "").replace(/\r/g, "").trim();
}

function parseTargets(snapshot: string) {
  const targets: BrowserObservationTarget[] = [];
  const lines = normalizeText(snapshot).split("\n");
  const seen = new Set<string>();

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+/g, " ").trim();
    if (!line) continue;
    const match = line.match(/-\s*([A-Za-z][A-Za-z _-]*)\s+"([^"]+)"(?:.*?\[ref=([^\]]+)\])?/);
    if (!match?.[3]) continue;

    const role = match[1].trim();
    const label = match[2].trim();
    const ref = `@${match[3]}`;
    const key = `${ref}:${role}:${label}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const haystack = `${role} ${label}`.toLowerCase();
    let kind: BrowserObservationTarget["kind"] = "generic";
    let score = 0;

    if (/^[A-Za-z0-9_.-]+\s*\/\s*[A-Za-z0-9_.-]+$/.test(label) && /(link|heading)/i.test(role)) {
      kind = "repo_link";
      score += 180;
    } else if (/combobox|textbox|textarea|input/i.test(haystack)) {
      kind = "input";
      score += 140;
    } else if (/button/i.test(role)) {
      kind = "button";
      score += 40;
    } else if (/link/i.test(role)) {
      kind = "link";
      score += 30;
    }

    if (/trending|repo|repository|readme|search|搜尋|submit|send|code|view|open/i.test(haystack)) score += 80;
    if (TARGET_NOISE.test(haystack)) score -= 160;

    targets.push({ ref, role, label, kind, score });
  }

  return targets;
}

function detectBlockedReason(text: string) {
  const normalized = normalizeText(text);
  if (!normalized) return undefined;
  const matched = BLOCKED_PATTERNS.find((entry) => entry.pattern.test(normalized))?.reason;
  if (matched) return matched;

  const looksLikeLoginGate =
    /(sign in to github|log in to github|登入 github|登入以繼續|請先登入)/i.test(normalized) ||
    (/heading "sign in"|heading "登入"/i.test(normalized) && /(password|密碼|email|電子郵件|username|帳號)/i.test(normalized)) ||
    (/combobox|textbox|textarea|input/i.test(normalized) && /(password|密碼)/i.test(normalized));
  if (looksLikeLoginGate) {
    return "頁面停在登入關卡。";
  }

  const looksLikeConsentGate =
    /(before you continue|consent required|請先同意|同意並繼續)/i.test(normalized) &&
    /(consent|同意|continue|繼續)/i.test(normalized);
  if (looksLikeConsentGate) {
    return "頁面停在同意或授權關卡。";
  }

  return undefined;
}

function detectRepoName(text: string) {
  const normalized = normalizeText(text);
  const headingMatch = normalized.match(/heading "([^"]+\/[^"]+)"/i);
  if (headingMatch?.[1]) return headingMatch[1].trim();
  const linkMatch = normalized.match(/link "([^"]+\/[^"]+)"/i);
  return linkMatch?.[1]?.trim();
}

function detectPageKind(text: string, targets: BrowserObservationTarget[]) {
  const normalized = normalizeText(text);
  const rankedTargets = targets.filter((target) => target.kind === "repo_link");
  const inputTargets = targets.filter((target) => target.kind === "input");

  if ((/trending/i.test(normalized) || /trending repositories on github today/i.test(normalized)) && rankedTargets.length >= 1) {
    return "ranked_list" as const;
  }
  if (/navigation "repository"|folders and files|latest commit/i.test(normalized) || /heading "([^"]+\/[^"]+)"/i.test(normalized)) {
    return "repo_page" as const;
  }
  if (inputTargets.length) return "input_page" as const;
  return "unknown" as const;
}

function collectContentHints(text: string, limit = 8) {
  const seen = new Set<string>();
  const hints: string[] = [];
  for (const rawLine of normalizeText(text).split("\n")) {
    const line = rawLine.replace(/\s+/g, " ").trim();
    if (!line) continue;
    const textMatch =
      line.match(/StaticText "([^"]+)"/) ??
      line.match(/heading "([^"]+)"/i) ??
      line.match(/paragraph "([^"]+)"/i) ??
      line.match(/link "([^"]+)"/i);
    const value = textMatch?.[1]?.trim();
    if (!value || value.length < 6) continue;
    if (CONTENT_NOISE.test(value)) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    hints.push(value);
    if (hints.length >= limit) break;
  }
  return hints;
}

export function extractBrowserObservation(args: { toolName: string; output: unknown }): BrowserObservationDigest | null {
  const normalizedToolName = String(args.toolName ?? "").trim().toLowerCase();
  const output = args.output;
  if (!output || typeof output !== "object") return null;
  const record = output as Record<string, unknown>;
  const snapshot = typeof record.snapshot === "string" ? record.snapshot : null;
  const title = typeof record.title === "string" ? record.title : typeof record.output === "string" ? record.output : undefined;
  const url = typeof record.url === "string" ? record.url : undefined;

  if (!snapshot && !title && !url) return null;

  const snapshotText = snapshot ?? "";
  const targets = snapshot ? parseTargets(snapshot) : [];
  const rankedTargets = targets.filter((target) => target.kind === "repo_link" && target.score > 0).slice(0, 10);
  const inputTargets = targets.filter((target) => target.kind === "input").slice(0, 6);
  const actionTargets = [...targets].sort((a, b) => b.score - a.score || a.label.localeCompare(b.label)).slice(0, 12);
  const combinedText = [title, url, snapshotText].filter(Boolean).join("\n");
  const pageKind = detectPageKind(combinedText, targets);
  const blockedReason = detectBlockedReason(combinedText);
  const repoName = detectRepoName(combinedText);
  const contentHints = collectContentHints(snapshotText || combinedText);

  return {
    sourceTool: normalizedToolName,
    pageKind,
    blockedReason,
    repoName,
    url,
    title,
    rankedTargets,
    inputTargets,
    actionTargets,
    contentHints
  };
}

export function formatBrowserObservationDigest(observation: BrowserObservationDigest) {
  return [
    `pageKind=${observation.pageKind}`,
    observation.url ? `url=${observation.url}` : "",
    observation.title ? `title=${observation.title}` : "",
    observation.repoName ? `repoName=${observation.repoName}` : "",
    observation.blockedReason ? `blockedReason=${observation.blockedReason}` : "",
    observation.rankedTargets.length
      ? `rankedTargets=${observation.rankedTargets
          .slice(0, 5)
          .map((target) => `${target.ref} ${target.label}`)
          .join(" | ")}`
      : "",
    observation.inputTargets.length
      ? `inputTargets=${observation.inputTargets
          .slice(0, 3)
          .map((target) => `${target.ref} ${target.label}`)
          .join(" | ")}`
      : "",
    observation.contentHints.length ? `contentHints=${observation.contentHints.slice(0, 5).join(" | ")}` : ""
  ]
    .filter(Boolean)
    .join("\n");
}
