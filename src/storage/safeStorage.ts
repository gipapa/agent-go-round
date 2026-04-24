export type StorageWriteResult =
  | { ok: true }
  | { ok: false; reason: "quota" | "denied" | "other"; error: unknown };

export type StorageReadOptions<T> = {
  defaultValue: T;
  version?: number;
  validate?: (value: unknown) => value is T;
  migrate?: (value: unknown, version: number | null) => T;
};

type StoredEnvelope = {
  __version: number;
  data: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isQuotaError(error: unknown) {
  const maybe = error as { code?: number; name?: string } | null;
  return maybe?.name === "QuotaExceededError" || maybe?.name === "NS_ERROR_DOM_QUOTA_REACHED" || maybe?.code === 22 || maybe?.code === 1014;
}

function isDeniedError(error: unknown) {
  const maybe = error as { name?: string } | null;
  return maybe?.name === "SecurityError";
}

function classifyWriteError(error: unknown): Extract<StorageWriteResult, { ok: false }> {
  if (isQuotaError(error)) return { ok: false, reason: "quota", error };
  if (isDeniedError(error)) return { ok: false, reason: "denied", error };
  return { ok: false, reason: "other", error };
}

function warn(message: string, detail?: unknown) {
  if (typeof console === "undefined") return;
  console.warn(message, detail);
}

export function safeSetItem(key: string, value: string): StorageWriteResult {
  try {
    localStorage.setItem(key, value);
    return { ok: true };
  } catch (error) {
    const result = classifyWriteError(error);
    warn(`[storage] failed to write ${key}: ${result.reason}`, error);
    return result;
  }
}

export function backupCorruptedData(key: string, raw: string, reason: string) {
  const safeReason = reason.replace(/[^\w.-]+/g, "_").slice(0, 60) || "unknown";
  const backupKey = `__backup_${key}_${Date.now()}_${safeReason}`;
  const result = safeSetItem(backupKey, raw);
  if (!result.ok) {
    warn(`[storage] failed to back up corrupted ${key}: ${result.reason}`, result.error);
  }
  return backupKey;
}

function unwrapEnvelope(parsed: unknown): { data: unknown; version: number | null } {
  if (
    isRecord(parsed) &&
    typeof parsed.__version === "number" &&
    Number.isFinite(parsed.__version) &&
    Object.prototype.hasOwnProperty.call(parsed, "data")
  ) {
    return { data: (parsed as StoredEnvelope).data, version: Math.round(parsed.__version) };
  }
  return { data: parsed, version: null };
}

export function readJsonStorage<T>(key: string, options: StorageReadOptions<T>): T {
  const raw = localStorage.getItem(key);
  if (!raw) return options.defaultValue;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (error) {
    backupCorruptedData(key, raw, "json_parse_failed");
    warn(`[storage] ${key} is not valid JSON; backed up corrupted payload.`, error);
    return options.defaultValue;
  }

  const { data, version } = unwrapEnvelope(parsed);
  let migrated = data;
  if (options.migrate) {
    try {
      migrated = options.migrate(data, version);
    } catch (error) {
      backupCorruptedData(key, raw, "migration_failed");
      warn(`[storage] ${key} migration failed; backed up payload.`, error);
      return options.defaultValue;
    }
  }

  if (options.validate && !options.validate(migrated)) {
    backupCorruptedData(key, raw, "schema_mismatch");
    warn(`[storage] ${key} schema mismatch; backed up payload.`);
    return options.defaultValue;
  }

  return migrated as T;
}

export function writeJsonStorage<T>(key: string, data: T, version = 1): StorageWriteResult {
  return safeSetItem(
    key,
    JSON.stringify({
      __version: version,
      data
    })
  );
}
