import { BuiltInToolConfig } from "../types";
import { readJsonStorage, writeJsonStorage } from "./safeStorage";

const KEY = "agr_built_in_tools_v1";

function isBuiltInToolArray(value: unknown): value is BuiltInToolConfig[] {
  return Array.isArray(value);
}

export function loadBuiltInTools(): BuiltInToolConfig[] {
  return readJsonStorage(KEY, {
    defaultValue: [],
    validate: isBuiltInToolArray
  })
    .filter((item) => item && typeof item.id === "string" && typeof item.name === "string" && typeof item.code === "string")
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export function saveBuiltInTools(tools: BuiltInToolConfig[]) {
  writeJsonStorage(KEY, tools);
}
