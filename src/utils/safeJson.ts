const MAX_JSON_SOURCE_LENGTH = 200_000;

function stripCodeFence(text: string) {
  const trimmed = text.trim();
  const match = trimmed.match(/^```(?:json|JSON)?\s*\n?([\s\S]*?)\n?```$/);
  return match ? match[1].trim() : trimmed;
}

function sanitizeJsonText(text: string): string {
  return text
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, '"')
    .replace(/,\s*([}\]])/g, "$1");
}

function tryParseJsonObject(candidate: string): unknown | null {
  try {
    return JSON.parse(candidate);
  } catch {
    try {
      return JSON.parse(sanitizeJsonText(candidate));
    } catch {
      return null;
    }
  }
}

export function extractJsonObject(text: string): unknown | null {
  if (typeof text !== "string") return null;
  if (!text || text.length > MAX_JSON_SOURCE_LENGTH) return null;
  const source = stripCodeFence(text);
  if (!source || source.length > MAX_JSON_SOURCE_LENGTH) return null;

  for (let start = source.indexOf("{"); start >= 0; start = source.indexOf("{", start + 1)) {
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = start; i < source.length; i += 1) {
      const char = source[i];
      if (inString) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (char === "\\") {
          escaped = true;
          continue;
        }
        if (char === '"') {
          inString = false;
        }
        continue;
      }

      if (char === '"') {
        inString = true;
        continue;
      }
      if (char === "{") {
        depth += 1;
        continue;
      }
      if (char !== "}") continue;

      depth -= 1;
      if (depth !== 0) continue;

      const parsed = tryParseJsonObject(source.slice(start, i + 1));
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed;
      }
      break;
    }
  }

  return null;
}
