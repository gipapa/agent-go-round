import { McpServerConfig, McpTool } from "../types";

export type McpServerResolution =
  | {
      ok: true;
      serverId: string;
      matchedBy: "exact-id" | "exact-name" | "fuzzy" | "single-tool-match";
    }
  | {
      ok: false;
      reason: "ambiguous" | "no-match" | "invalid-input";
      candidates?: string[];
    };

type McpToolEntry = {
  server: McpServerConfig;
  tools: McpTool[];
};

function normalizeToken(value: string) {
  return value.trim().toLowerCase();
}

function uniqueEntries(entries: McpToolEntry[]) {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    if (seen.has(entry.server.id)) return false;
    seen.add(entry.server.id);
    return true;
  });
}

function formatCandidate(entry: McpToolEntry) {
  return `${entry.server.name} (${entry.server.id})`;
}

function resolveSingleServerMatch(
  entries: McpToolEntry[],
  matchedBy: Extract<McpServerResolution, { ok: true }>["matchedBy"]
): McpServerResolution | null {
  const unique = uniqueEntries(entries);
  if (unique.length === 1) {
    return {
      ok: true,
      serverId: unique[0].server.id,
      matchedBy
    };
  }
  if (unique.length > 1) {
    return {
      ok: false,
      reason: "ambiguous",
      candidates: unique.map(formatCandidate)
    };
  }
  return null;
}

export function resolveMcpServerId(args: {
  requestedServerId?: string | null;
  toolName: string;
  availableMcpTools: McpToolEntry[];
}): McpServerResolution {
  const toolName = String(args.toolName ?? "").trim();
  if (!toolName) {
    return { ok: false, reason: "invalid-input" };
  }

  const availableEntries = uniqueEntries(args.availableMcpTools);
  if (!availableEntries.length) {
    return { ok: false, reason: "no-match" };
  }

  const requestedServerId = String(args.requestedServerId ?? "").trim();
  if (requestedServerId) {
    const exactId = resolveSingleServerMatch(
      availableEntries.filter((entry) => entry.server.id === requestedServerId),
      "exact-id"
    );
    if (exactId) return exactId;

    const exactName = resolveSingleServerMatch(
      availableEntries.filter((entry) => entry.server.name === requestedServerId),
      "exact-name"
    );
    if (exactName) return exactName;

    const normalizedRequest = normalizeToken(requestedServerId);
    const fuzzy = resolveSingleServerMatch(
      availableEntries.filter(
        (entry) => normalizeToken(entry.server.id) === normalizedRequest || normalizeToken(entry.server.name) === normalizedRequest
      ),
      "fuzzy"
    );
    if (fuzzy) return fuzzy;
  }

  const matchingToolServers = availableEntries.filter((entry) => entry.tools.some((tool) => tool.name === toolName));
  const singleToolMatch = resolveSingleServerMatch(matchingToolServers, "single-tool-match");
  if (singleToolMatch) return singleToolMatch;

  return {
    ok: false,
    reason: "no-match",
    candidates: availableEntries.map(formatCandidate)
  };
}

export function formatMcpServerResolutionFailure(resolution: Extract<McpServerResolution, { ok: false }>) {
  const candidateText = resolution.candidates?.length ? ` candidates=${resolution.candidates.join(", ")}` : "";
  return `reason=${resolution.reason}${candidateText}`;
}
