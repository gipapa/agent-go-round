import { BuiltInToolConfig } from "../types";

const KEY = "agr_built_in_tools_v1";

export function loadBuiltInTools(): BuiltInToolConfig[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as BuiltInToolConfig[];
    return Array.isArray(parsed)
      ? parsed
          .filter((item) => item && typeof item.id === "string" && typeof item.name === "string" && typeof item.code === "string")
          .sort((a, b) => b.updatedAt - a.updatedAt)
      : [];
  } catch {
    return [];
  }
}

export function saveBuiltInTools(tools: BuiltInToolConfig[]) {
  localStorage.setItem(KEY, JSON.stringify(tools));
}
