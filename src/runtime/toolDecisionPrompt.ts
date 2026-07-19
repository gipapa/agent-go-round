import type { ToolEntry } from "./toolDecision";

const PROMPT_JSON_PLACEHOLDERS = {
  noToolJson: '{"type":"no_tool"}',
  userProfileJson: '{"type":"builtin_tool_call","tool":"get_user_profile","input":{}}',
  builtinToolJson: '{"type":"builtin_tool_call","tool":"your_tool_name","input":{}}',
  mcpCallJson: '{"type":"mcp_call","serverId":"...","tool":"...","input":{}}'
} as const;

export function buildToolDecisionPrompt(template: string, fallbackTemplate: string, userInput: string, toolListJson: string) {
  const baseTemplate = template.trim() || fallbackTemplate;
  const replacements: Record<string, string> = {
    "{{userInput}}": userInput,
    "{{toolListJson}}": toolListJson,
    "{{noToolJson}}": PROMPT_JSON_PLACEHOLDERS.noToolJson,
    "{{userProfileJson}}": PROMPT_JSON_PLACEHOLDERS.userProfileJson,
    "{{builtinToolJson}}": PROMPT_JSON_PLACEHOLDERS.builtinToolJson,
    "{{mcpCallJson}}": PROMPT_JSON_PLACEHOLDERS.mcpCallJson
  };

  let prompt = baseTemplate;
  Object.entries(replacements).forEach(([placeholder, value]) => {
    prompt = prompt.split(placeholder).join(value);
  });

  if (!baseTemplate.includes("{{userInput}}")) {
    prompt += `\n\nUser request:\n${userInput}`;
  }
  if (!baseTemplate.includes("{{toolListJson}}")) {
    prompt += `\n\nAvailable tools:\n${toolListJson}`;
  }
  if (!baseTemplate.includes("{{noToolJson}}")) {
    prompt += `\n\nIf no tool is needed, return:\n${PROMPT_JSON_PLACEHOLDERS.noToolJson}`;
  }
  if (!baseTemplate.includes("{{userProfileJson}}")) {
    prompt += `\n\nIf the user profile tool is needed, return:\n${PROMPT_JSON_PLACEHOLDERS.userProfileJson}`;
  }
  if (!baseTemplate.includes("{{builtinToolJson}}")) {
    prompt += `\n\nIf a built-in browser tool is needed, return:\n${PROMPT_JSON_PLACEHOLDERS.builtinToolJson}`;
  }
  if (!baseTemplate.includes("{{mcpCallJson}}")) {
    prompt += `\n\nIf an MCP tool is needed, return:\n${PROMPT_JSON_PLACEHOLDERS.mcpCallJson}`;
  }

  return prompt;
}

function compactDecisionCatalogText(value: string | undefined, maxChars: number) {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  return normalized.length <= maxChars ? normalized : `${normalized.slice(0, Math.max(0, maxChars - 1))}…`;
}

export function buildToolDecisionCatalog(toolEntries: ToolEntry[]) {
  return toolEntries.map((entry) =>
    entry.kind === "mcp"
      ? {
          kind: "mcp",
          server: entry.server.name,
          tool: entry.tool.name,
          summary: compactDecisionCatalogText(entry.tool.description ?? "", 180)
        }
      : {
          kind: "builtin",
          tool: entry.tool.name,
          summary: compactDecisionCatalogText(entry.tool.description ?? "", 180)
        }
  );
}
