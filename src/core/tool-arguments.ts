import { validateToolArguments, type Tool } from "@earendil-works/pi-ai";

type ArgumentSchema = {
  required?: string[];
  anyOf?: ArgumentSchema[];
  oneOf?: ArgumentSchema[];
  properties?: Record<string, { items?: ArgumentSchema }>;
};

export function requiredArgumentsGuidance(tool: Pick<Tool, "parameters">): string {
  const schema = tool.parameters as ArgumentSchema;
  const hints: string[] = [];
  if (schema.required?.length) hints.push(`Required arguments in every call: ${JSON.stringify(schema.required)}.`);
  const alternatives = schema.anyOf ?? schema.oneOf;
  if (alternatives?.length && alternatives.every(option => option.required?.length)) {
    hints.push(`Required argument alternatives: ${alternatives.map(option => JSON.stringify(option.required)).join(" OR ")}.`);
  }
  for (const [name, property] of Object.entries(schema.properties ?? {})) {
    if (property.items?.required?.length) hints.push(`Each ${JSON.stringify(name)} item requires ${JSON.stringify(property.items.required)}.`);
  }
  return hints.length ? `${hints.join(" ")} ` : "";
}

export function validateArgumentsWithGuidance(tool: Tool, args: unknown, toolCallId = tool.name) {
  try {
    return validateToolArguments(tool, { type: "toolCall", id: toolCallId, name: tool.name, arguments: args as Record<string, unknown> });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${message}\n\nTool was not executed. ${requiredArgumentsGuidance(tool)}Send one complete arguments object, preserving the fields that were already correct and fixing all validation errors. Each call is independent; arguments from earlier calls are not retained. Inspect the tool's JSON schema before retrying if unsure.`, { cause: error });
  }
}
