import Ajv, { type ValidateFunction } from "ajv";
import type { JSONSchema7, JSONSchema7Definition } from "json-schema";
import type {
  HarnessToolCall,
  HarnessToolDefinition,
  HarnessToolIdempotency,
  HarnessToolIntent,
  HarnessToolCancellation,
  HarnessToolExecutionKind
} from "./types";

export type ToolRegistryDiagnostic = {
  toolId?: string;
  code:
    | "invalid_id"
    | "duplicate_id"
    | "schema_too_large"
    | "schema_too_deep"
    | "schema_too_complex"
    | "schema_remote_ref"
    | "schema_invalid"
    | "input_too_large"
    | "input_unserializable"
    | "legacy_inline_unavailable";
  message: string;
};

export type HarnessToolDefinitionInput = Partial<HarnessToolDefinition> & {
  id: string;
  description?: string;
  inputSchema?: JSONSchema7;
};

export type ToolPreflightResult =
  | { ok: true; definition: HarnessToolDefinition }
  | { ok: false; errorCode: string; message: string };

const SCHEMA_LIMITS = {
  maxSerializedChars: 32_000,
  maxDepth: 8,
  maxProperties: 100,
  maxCombinators: 20
};

const MAX_TOOL_DESCRIPTION_CHARS = 4_000;
export const MAX_TOOL_ID_CHARS = 512;
export const MAX_TOOL_INPUT_CHARS = 32_000;

function serializeToolInput(input: unknown) {
  try {
    const serialized = JSON.stringify(input, (_key, value: unknown) => {
      if (
        value === undefined ||
        typeof value === "function" ||
        typeof value === "symbol" ||
        typeof value === "bigint" ||
        (typeof value === "number" && !Number.isFinite(value))
      ) {
        throw new Error("non-JSON value");
      }
      return value;
    });
    return typeof serialized === "string" ? serialized : null;
  } catch {
    return null;
  }
}

function cloneAndFreeze<T>(value: T, seen = new WeakMap<object, unknown>()): T {
  if (!value || typeof value !== "object") return value;
  if (value instanceof Uint8Array) return value.slice() as T;
  const existing = seen.get(value);
  if (existing) return existing as T;
  if (Array.isArray(value)) {
    const clone: unknown[] = [];
    seen.set(value, clone);
    value.forEach((entry) => clone.push(cloneAndFreeze(entry, seen)));
    return Object.freeze(clone) as T;
  }
  const clone: Record<string, unknown> = {};
  seen.set(value, clone);
  Object.entries(value as Record<string, unknown>).forEach(([key, entry]) => {
    clone[key] = cloneAndFreeze(entry, seen);
  });
  return Object.freeze(clone) as T;
}

function schemaRecord(value: JSONSchema7Definition): JSONSchema7 | null {
  return typeof value === "boolean" ? null : value;
}

function inspectSchema(schema: JSONSchema7) {
  let depth = 0;
  let properties = 0;
  let combinators = 0;
  let hasRemoteRef = false;

  const visit = (value: JSONSchema7Definition, currentDepth: number) => {
    depth = Math.max(depth, currentDepth);
    const record = schemaRecord(value);
    if (!record) return;
    const extended = record as JSONSchema7 & Record<string, unknown>;
    if (typeof record.$ref === "string" && record.$ref.trim() && !record.$ref.trim().startsWith("#")) hasRemoteRef = true;
    properties += Object.keys(record.properties ?? {}).length;
    properties += Object.keys(record.patternProperties ?? {}).length;
    combinators += (record.anyOf?.length ?? 0) + (record.oneOf?.length ?? 0) + (record.allOf?.length ?? 0);
    Object.values(record.properties ?? {}).forEach((child) => visit(child, currentDepth + 1));
    Object.values(record.patternProperties ?? {}).forEach((child) => visit(child, currentDepth + 1));
    if (Array.isArray(record.items)) record.items.forEach((child) => visit(child, currentDepth + 1));
    else if (record.items) visit(record.items, currentDepth + 1);
    [...(record.anyOf ?? []), ...(record.oneOf ?? []), ...(record.allOf ?? [])].forEach((child) => visit(child, currentDepth + 1));
    if (record.not) visit(record.not, currentDepth + 1);
    if (record.additionalProperties && typeof record.additionalProperties === "object") visit(record.additionalProperties, currentDepth + 1);
    if (record.additionalItems && typeof record.additionalItems === "object") visit(record.additionalItems, currentDepth + 1);
    if (record.contains) visit(record.contains, currentDepth + 1);
    if (record.propertyNames) visit(record.propertyNames, currentDepth + 1);
    if (record.if) visit(record.if, currentDepth + 1);
    if (record.then) visit(record.then, currentDepth + 1);
    if (record.else) visit(record.else, currentDepth + 1);
    if (extended.unevaluatedProperties && typeof extended.unevaluatedProperties === "object") visit(extended.unevaluatedProperties as JSONSchema7Definition, currentDepth + 1);
    if (extended.unevaluatedItems && typeof extended.unevaluatedItems === "object") visit(extended.unevaluatedItems as JSONSchema7Definition, currentDepth + 1);
    const dependencies = extended.dependencies;
    if (dependencies && typeof dependencies === "object" && !Array.isArray(dependencies)) {
      Object.values(dependencies as Record<string, JSONSchema7Definition | string[]>).forEach((child) => {
        if (!Array.isArray(child)) visit(child, currentDepth + 1);
      });
    }
    if (extended.contentSchema && typeof extended.contentSchema === "object") {
      visit(extended.contentSchema as JSONSchema7Definition, currentDepth + 1);
    }
    for (const key of ["$defs", "definitions", "dependentSchemas"]) {
      const schemaMap = (record as Record<string, unknown>)[key];
      if (schemaMap && typeof schemaMap === "object" && !Array.isArray(schemaMap)) {
        Object.values(schemaMap as Record<string, JSONSchema7Definition>).forEach((child) => visit(child, currentDepth + 1));
      }
    }
  };

  visit(schema, 0);
  return { depth, properties, combinators, hasRemoteRef };
}

const schemaCompiler = new Ajv({ allErrors: true, strict: false, validateFormats: false });

function compileSchema(schema: JSONSchema7): ValidateFunction | null {
  try {
    return schemaCompiler.compile(schema);
  } catch {
    return null;
  }
}

export function validateSchemaComplexity(schema: JSONSchema7): ToolRegistryDiagnostic | null {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    return { code: "schema_invalid", message: "Tool input schema is invalid." };
  }
  let serialized = "";
  try {
    const encoded = JSON.stringify(schema);
    if (typeof encoded !== "string") return { code: "schema_invalid", message: "Tool input schema is not serializable." };
    serialized = encoded;
  } catch {
    return { code: "schema_invalid", message: "Tool input schema is not serializable." };
  }
  if (serialized.length > SCHEMA_LIMITS.maxSerializedChars) {
    return { code: "schema_too_large", message: `Tool input schema exceeds ${SCHEMA_LIMITS.maxSerializedChars} chars.` };
  }
  let inspected: ReturnType<typeof inspectSchema>;
  try {
    inspected = inspectSchema(schema);
  } catch {
    // Schema metadata is external input. A hostile getter/proxy must fail
    // closed instead of escaping the registry preflight.
    return { code: "schema_invalid", message: "Tool input schema is invalid." };
  }
  if (inspected.hasRemoteRef) return { code: "schema_remote_ref", message: "Remote $ref is not allowed in a tool schema." };
  if (inspected.depth > SCHEMA_LIMITS.maxDepth) return { code: "schema_too_deep", message: `Tool input schema exceeds depth ${SCHEMA_LIMITS.maxDepth}.` };
  if (inspected.properties > SCHEMA_LIMITS.maxProperties || inspected.combinators > SCHEMA_LIMITS.maxCombinators) {
    return { code: "schema_too_complex", message: "Tool input schema is too complex for the stable registry." };
  }
  if (!compileSchema(schema)) return { code: "schema_invalid", message: "Tool input schema is invalid." };
  return null;
}

export function validateHarnessToolInput(input: unknown, schema: JSONSchema7) {
  const serialized = serializeToolInput(input);
  if (serialized === null) return { ok: false, errors: ["Tool input is not JSON-serializable."] };
  if (serialized.length > MAX_TOOL_INPUT_CHARS) return { ok: false, errors: [`Tool input exceeds ${MAX_TOOL_INPUT_CHARS} chars.`] };
  const validator = compileSchema(schema);
  if (!validator) return { ok: false, errors: ["Tool input schema is invalid."] };
  if (validator(input)) return { ok: true, errors: [] };
  const errors = (validator.errors ?? []).map((error) => `${error.instancePath || "$"} ${error.message ?? "is invalid"}`);
  return { ok: false, errors };
}

function normalizeDefinition(input: unknown): HarnessToolDefinition {
  const source = input && typeof input === "object" && !Array.isArray(input)
    ? input as Partial<HarnessToolDefinitionInput>
    : {};
  const intent: HarnessToolIntent = source.intent === "observe" || source.intent === "mutate" || source.intent === "control" || source.intent === "context"
    ? source.intent
    : "control";
  const idempotency: HarnessToolIdempotency = source.idempotency === "idempotent" || source.idempotency === "non_idempotent" || source.idempotency === "unknown"
    ? source.idempotency
    : "unknown";
  const cancellation: HarnessToolCancellation = source.cancellation === "terminable" || source.cancellation === "cooperative" || source.cancellation === "none"
    ? source.cancellation
    : "none";
  const executionKind: HarnessToolExecutionKind = source.executionKind === "internal" || source.executionKind === "worker" || source.executionKind === "trusted_local" || source.executionKind === "mcp" || source.executionKind === "legacy_inline"
    ? source.executionKind
    : "legacy_inline";
  const id = typeof source.id === "string" ? source.id.trim() : "";
  const description = typeof source.description === "string" ? source.description.trim() : "";
  const inputSchema = source.inputSchema === undefined ? {} : source.inputSchema;
  return {
    id,
    description: (description || "No tool description provided.").slice(0, MAX_TOOL_DESCRIPTION_CHARS),
    inputSchema,
    intent,
    idempotency,
    cancellation,
    // Only the literal false can opt out of confirmation. Runtime metadata is
    // external input, so malformed truthy/falsy values stay conservative.
    requireConfirmation: source.requireConfirmation === false ? false : true,
    executionKind
  };
}

export function createHarnessToolRegistry(inputs: HarnessToolDefinitionInput[], options?: { includeLegacyInline?: boolean }) {
  const definitions: HarnessToolDefinition[] = [];
  const validators = new Map<string, ValidateFunction>();
  const diagnostics: ToolRegistryDiagnostic[] = [];
  const seen = new Set<string>();
  for (const input of Array.isArray(inputs) ? inputs : []) {
    let definition: HarnessToolDefinition;
    try {
      definition = normalizeDefinition(input);
    } catch {
      diagnostics.push({ code: "schema_invalid", message: "Tool definition is invalid." });
      continue;
    }
    if (definition.id.length > MAX_TOOL_ID_CHARS || !/^[^\s:]+(?::[^\s:]+)*$/.test(definition.id)) {
      diagnostics.push({ toolId: definition.id, code: "invalid_id", message: "Tool id must be a non-empty canonical id." });
      continue;
    }
    if (seen.has(definition.id)) {
      diagnostics.push({ toolId: definition.id, code: "duplicate_id", message: "Duplicate canonical tool id." });
      continue;
    }
    seen.add(definition.id);
    const complexity = validateSchemaComplexity(definition.inputSchema);
    if (complexity) {
      diagnostics.push({ toolId: definition.id, ...complexity });
      continue;
    }
    if (definition.executionKind === "legacy_inline" && options?.includeLegacyInline !== true) {
      diagnostics.push({ toolId: definition.id, code: "legacy_inline_unavailable", message: "Arbitrary inline tools are unavailable in the stable registry." });
      continue;
    }
    const validator = compileSchema(definition.inputSchema);
    if (!validator) {
      diagnostics.push({ toolId: definition.id, code: "schema_invalid", message: "Tool input schema is invalid." });
      continue;
    }
    try {
      definitions.push(Object.freeze({ ...definition, inputSchema: cloneAndFreeze(definition.inputSchema) }));
      validators.set(definition.id, validator);
    } catch {
      diagnostics.push({ toolId: definition.id, code: "schema_invalid", message: "Tool input schema is invalid." });
    }
  }

  const byId = new Map(definitions.map((definition) => [definition.id, definition]));
  return {
    definitions: Object.freeze(definitions.slice()),
    diagnostics: Object.freeze(diagnostics.slice()),
    preflight(call: Pick<HarnessToolCall, "toolId" | "input">): ToolPreflightResult {
      const definition = byId.get(call.toolId);
      if (!definition) return { ok: false, errorCode: "tool_unavailable", message: `Tool ${call.toolId} is unavailable.` };
      const serializedInput = serializeToolInput(call.input);
      if (serializedInput === null) return { ok: false, errorCode: "input_unserializable", message: "Tool input must be JSON-serializable." };
      if (serializedInput.length > MAX_TOOL_INPUT_CHARS) {
        return { ok: false, errorCode: "input_too_large", message: `Tool input exceeds ${MAX_TOOL_INPUT_CHARS} chars.` };
      }
      const validator = validators.get(definition.id);
      if (!validator || !validator(call.input)) {
        const errors = (validator?.errors ?? []).map((error) => `${error.instancePath || "$"} ${error.message ?? "is invalid"}`);
        return { ok: false, errorCode: "invalid_arguments", message: errors.join("; ") || "Tool arguments are invalid." };
      }
      return { ok: true, definition };
    }
  };
}
