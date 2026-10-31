export const EMBED_BRIDGE_VERSION = 2 as const;
export const EMBED_SDK_VERSION = "0.2.0" as const;

/** Wire compatibility is deliberately explicit: unsupported versions fail closed. */
export function isSupportedEmbedBridgeVersion(value: unknown): value is typeof EMBED_BRIDGE_VERSION {
  return value === EMBED_BRIDGE_VERSION;
}

export function isSupportedEmbedSdkVersion(value: unknown): value is typeof EMBED_SDK_VERSION {
  return value === EMBED_SDK_VERSION;
}

export type HostToolSpec = {
  name: string;
  label: string;
  description: string;
  parameters: unknown;
  requiresApproval?: boolean;
  timeoutMs?: number;
};

export type HostToolRequest = {
  instanceId: string;
  requestId: string;
  sessionId: string;
  toolCallId: string;
  toolName: string;
  args: unknown;
  signal: AbortSignal;
};

export type HostToolHandler = (request: HostToolRequest) => unknown | Promise<unknown>;

export type HostToolApprovalRequest = Omit<HostToolRequest, "signal"> & {
  runId: string;
  toolCallId: string;
  signal?: AbortSignal;
};

export type HostToolApprovalHandler = (request: HostToolApprovalRequest) => boolean | Promise<boolean>;

export type HostToolCall = {
  version: typeof EMBED_BRIDGE_VERSION;
  instanceId: string;
  requestId: string;
  sessionId: string;
  toolCallId: string;
  toolName: string;
  args: unknown;
  approvalToken?: string;
};

export type HostToolApprovalDecision = {
  approved: boolean;
  approvalToken?: string;
  reason?: string;
};

export type HostToolResult = {
  version: typeof EMBED_BRIDGE_VERSION;
  instanceId: string;
  requestId: string;
  status: "success" | "error" | "aborted" | "outcome_unknown";
  result?: unknown;
  error?: string;
};

export type HostToolRegistration = {
  spec: HostToolSpec;
  handler: HostToolHandler;
  approval?: HostToolApprovalHandler;
};

export class HostToolBridgeError extends Error {
  readonly code = "host_tool_bridge_error" as const;

  constructor(message: string) {
    super(message);
    this.name = "HostToolBridgeError";
  }
}

type RegisteredTool = HostToolRegistration & { spec: HostToolSpec };

type ApprovalGrant = {
  instanceId: string;
  sessionId: string;
  toolCallId: string;
  toolName: string;
  argsFingerprint: string;
  expiresAt: number;
};

const APPROVAL_TOKEN_TTL_MS = 60_000;

function makeId(prefix: string): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return uuid ? `${prefix}-${uuid}` : `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  const objectValue = value as Record<string, unknown>;
  return Object.fromEntries(Object.keys(objectValue).sort().map((key) => [key, canonicalize(objectValue[key])]));
}

function argsFingerprint(value: unknown): string {
  try {
    return JSON.stringify(canonicalize(value)) ?? String(value);
  } catch {
    return String(value);
  }
}

function normalizeSpec(spec: HostToolSpec): HostToolSpec {
  const name = spec.name.trim();
  if (!/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(name)) throw new HostToolBridgeError("Host tool name is invalid");
  if (!spec.label.trim() || !spec.description.trim()) throw new HostToolBridgeError(`Host tool ${name} needs a label and description`);
  if (spec.timeoutMs !== undefined && (!Number.isInteger(spec.timeoutMs) || spec.timeoutMs <= 0)) {
    throw new HostToolBridgeError(`Host tool ${name} timeoutMs must be a positive integer`);
  }
  return {
    ...spec,
    name,
    label: spec.label.trim(),
    description: spec.description.trim(),
    parameters: spec.parameters ?? { type: "object", additionalProperties: true }
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isUnknownOutcome(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "outcome_unknown";
}

function validateJsonSchema(schema: unknown, value: unknown, path = "$"): string | undefined {
  if (!schema || typeof schema !== "object") return undefined;
  const definition = schema as {
    type?: string;
    enum?: unknown[];
    const?: unknown;
    anyOf?: unknown[];
    oneOf?: unknown[];
    required?: string[];
    properties?: Record<string, unknown>;
    additionalProperties?: boolean;
    items?: unknown;
    minLength?: number;
    maxLength?: number;
    minItems?: number;
    maxItems?: number;
    minimum?: number;
    maximum?: number;
  };
  if (definition.const !== undefined && !Object.is(value, definition.const)) return `${path} must equal the configured constant`;
  if (definition.enum && !definition.enum.some((candidate) => Object.is(candidate, value))) return `${path} must be one of the configured values`;
  const alternatives = definition.anyOf ?? definition.oneOf;
  if (alternatives && !alternatives.some((candidate) => validateJsonSchema(candidate, value, path) === undefined)) return `${path} does not match an allowed schema`;
  if (!definition.type) return undefined;
  if (definition.type === "null" && value !== null) return `${path} must be null`;
  if (definition.type === "string") {
    if (typeof value !== "string") return `${path} must be a string`;
    if (definition.minLength !== undefined && value.length < definition.minLength) return `${path} is shorter than minLength`;
    if (definition.maxLength !== undefined && value.length > definition.maxLength) return `${path} is longer than maxLength`;
    return undefined;
  }
  if (definition.type === "number" || definition.type === "integer") {
    if (typeof value !== "number" || !Number.isFinite(value) || (definition.type === "integer" && !Number.isInteger(value))) return `${path} must be a ${definition.type}`;
    if (definition.minimum !== undefined && value < definition.minimum) return `${path} is below minimum`;
    if (definition.maximum !== undefined && value > definition.maximum) return `${path} is above maximum`;
    return undefined;
  }
  if (definition.type === "boolean") return typeof value === "boolean" ? undefined : `${path} must be a boolean`;
  if (definition.type === "array") {
    if (!Array.isArray(value)) return `${path} must be an array`;
    if (definition.minItems !== undefined && value.length < definition.minItems) return `${path} has fewer than minItems`;
    if (definition.maxItems !== undefined && value.length > definition.maxItems) return `${path} has more than maxItems`;
    if (definition.items) {
      for (let index = 0; index < value.length; index += 1) {
        const error = validateJsonSchema(definition.items, value[index], `${path}[${index}]`);
        if (error) return error;
      }
    }
    return undefined;
  }
  if (definition.type === "object") {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return `${path} must be an object`;
    const objectValue = value as Record<string, unknown>;
    for (const required of definition.required ?? []) if (!(required in objectValue)) return `${path}.${required} is required`;
    for (const [key, propertySchema] of Object.entries(definition.properties ?? {})) {
      if (key in objectValue) {
        const error = validateJsonSchema(propertySchema, objectValue[key], `${path}.${key}`);
        if (error) return error;
      }
    }
    if (definition.additionalProperties === false) {
      const allowed = new Set(Object.keys(definition.properties ?? {}));
      const unexpected = Object.keys(objectValue).find((key) => !allowed.has(key));
      if (unexpected) return `${path}.${unexpected} is not allowed`;
    }
  }
  return undefined;
}

function validateRegisteredArguments(spec: HostToolSpec, _requestId: string, args: unknown): string | undefined {
  const error = validateJsonSchema(spec.parameters, args);
  return error ? `Host tool ${spec.name} argument validation failed: ${error}` : undefined;
}

/**
 * Host-side registry for tools exposed to an embedded iframe.
 * The registry is deliberately independent of DOM and postMessage so the
 * allow-list, cancellation and timeout semantics remain deterministic.
 */
export class HostToolBridge {
  private readonly tools = new Map<string, RegisteredTool>();
  private readonly pending = new Map<string, AbortController>();
  private readonly pendingApprovals = new Map<string, AbortController>();
  private readonly approvalGrants = new Map<string, ApprovalGrant>();

  constructor(readonly instanceId: string) {
    if (!instanceId.trim()) throw new HostToolBridgeError("Host tool bridge instanceId is required");
  }

  register(spec: HostToolSpec, handler: HostToolHandler): () => void {
    return this.registerWithApproval(spec, handler);
  }

  registerWithApproval(spec: HostToolSpec, handler: HostToolHandler, approval?: HostToolApprovalHandler): () => void {
    const normalized = normalizeSpec(spec);
    if (this.tools.has(normalized.name)) throw new HostToolBridgeError(`Host tool ${normalized.name} is already registered`);
    this.tools.set(normalized.name, { spec: normalized, handler, approval });
    return () => {
      if (this.tools.get(normalized.name)?.handler === handler) this.tools.delete(normalized.name);
    };
  }

  list(): readonly HostToolSpec[] {
    return [...this.tools.values()].map(({ spec }) => ({ ...spec }));
  }

  cancel(requestId: string): boolean {
    const controller = this.pending.get(requestId);
    if (!controller) return false;
    controller.abort(new Error("Host tool request cancelled"));
    return true;
  }

  cancelApproval(requestId: string): boolean {
    const controller = this.pendingApprovals.get(requestId);
    if (!controller) return false;
    controller.abort(new Error("Host tool approval cancelled"));
    return true;
  }

  async approve(request: HostToolApprovalRequest): Promise<HostToolApprovalDecision> {
    if (request.instanceId !== this.instanceId) return { approved: false, reason: "Host tool bridge identity mismatch" };
    if (!request.requestId.trim() || !request.sessionId.trim() || !request.runId.trim() || !request.toolCallId.trim() || !request.toolName.trim()) {
      return { approved: false, reason: "Host tool approval request is missing identity" };
    }
    const tool = this.tools.get(request.toolName);
    if (!tool) return { approved: false, reason: `Host tool ${request.toolName} is not allowed` };
    const validationError = validateRegisteredArguments(tool.spec, request.requestId, request.args);
    if (validationError) return { approved: false, reason: validationError };
    if (!tool.spec.requiresApproval) return { approved: true };
    const approval = tool.approval;
    if (!approval) return { approved: false, reason: "Host tool approval is not configured" };
    if (this.pendingApprovals.has(request.requestId)) return { approved: false, reason: "Host tool approval requestId is already active" };
    const controller = new AbortController();
    this.pendingApprovals.set(request.requestId, controller);
    try {
      const approved = await Promise.race([
        Promise.resolve().then(() => approval({ ...request, signal: controller.signal })),
        new Promise<boolean>((resolve) => controller.signal.addEventListener("abort", () => resolve(false), { once: true }))
      ]);
      if (!approved) return { approved: false, reason: "Host tool approval denied" };
      const approvalToken = makeId("host-approval");
      this.approvalGrants.set(approvalToken, {
        instanceId: this.instanceId,
        sessionId: request.sessionId,
        toolCallId: request.toolCallId,
        toolName: request.toolName,
        argsFingerprint: argsFingerprint(request.args),
        expiresAt: Date.now() + APPROVAL_TOKEN_TTL_MS
      });
      return { approved: true, approvalToken };
    } catch (error) {
      return { approved: false, reason: errorMessage(error) };
    } finally {
      this.pendingApprovals.delete(request.requestId);
    }
  }

  async execute(call: HostToolCall): Promise<HostToolResult> {
    const base = { version: EMBED_BRIDGE_VERSION, instanceId: this.instanceId, requestId: call.requestId } as const;
    if (!isSupportedEmbedBridgeVersion(call.version) || call.instanceId !== this.instanceId) {
      return { ...base, status: "error", error: "Host tool bridge identity mismatch" };
    }
    if (!call.requestId.trim() || !call.sessionId.trim() || !call.toolCallId.trim() || !call.toolName.trim()) {
      return { ...base, status: "error", error: "Host tool request is missing identity" };
    }
    const tool = this.tools.get(call.toolName);
    if (!tool) return { ...base, status: "error", error: `Host tool ${call.toolName} is not allowed` };
    if (this.pending.has(call.requestId)) return { ...base, status: "error", error: "Host tool requestId is already active" };
    const validationError = validateRegisteredArguments(tool.spec, call.requestId, call.args);
    if (validationError) return { ...base, status: "error", error: validationError };

    if (tool.spec.requiresApproval) {
      const approvalToken = call.approvalToken;
      if (!approvalToken) return { ...base, status: "error", error: `Host tool ${call.toolName} requires approval` };
      const grant = this.approvalGrants.get(approvalToken);
      if (!grant) return { ...base, status: "error", error: `Host tool ${call.toolName} requires approval` };
      this.approvalGrants.delete(approvalToken);
      if (grant.expiresAt <= Date.now()) return { ...base, status: "error", error: "Host tool approval has expired" };
      if (grant.instanceId !== this.instanceId || grant.sessionId !== call.sessionId || grant.toolCallId !== call.toolCallId || grant.toolName !== call.toolName || grant.argsFingerprint !== argsFingerprint(call.args)) {
        return { ...base, status: "error", error: "Host tool approval does not match request" };
      }
    }

    const controller = new AbortController();
    this.pending.set(call.requestId, controller);
    let timedOut = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let interruptCleanup = (): void => undefined;
    const interrupted = new Promise<HostToolResult>((resolve) => {
      const onAbort = (): void => resolve({ ...base, status: timedOut ? "outcome_unknown" : "aborted", error: controller.signal.reason instanceof Error ? controller.signal.reason.message : "Host tool request aborted" });
      controller.signal.addEventListener("abort", onAbort, { once: true });
      interruptCleanup = () => controller.signal.removeEventListener("abort", onAbort);
      if (tool.spec.timeoutMs !== undefined) {
        timeout = setTimeout(() => {
          timedOut = true;
          controller.abort(new Error(`Host tool ${call.toolName} timed out`));
        }, tool.spec.timeoutMs);
      }
    });
    try {
      const result = await Promise.race([
        Promise.resolve().then(() => tool.handler({
          instanceId: this.instanceId,
          requestId: call.requestId,
          sessionId: call.sessionId,
          toolCallId: call.toolCallId,
          toolName: call.toolName,
          args: call.args,
          signal: controller.signal
        })).then((value) => ({ ...base, status: "success" as const, result: value })),
        interrupted
      ]);
      return result;
    } catch (error) {
      if (timedOut) return { ...base, status: "outcome_unknown", error: errorMessage(error) };
      if (controller.signal.aborted) return { ...base, status: "aborted", error: errorMessage(error) };
      return { ...base, status: isUnknownOutcome(error) ? "outcome_unknown" : "error", error: errorMessage(error) };
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
      interruptCleanup();
      this.pending.delete(call.requestId);
    }
  }
}
