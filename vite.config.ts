import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

declare const process: { env: Record<string, string | undefined> };

function normalizeBasePath(input?: string | null) {
  if (!input) return null;
  const value = input.trim();
  if (!value) return null;
  if (value === "/") return "/";
  return `/${value.replace(/^\/+/g, "").replace(/\/+$/g, "")}/`;
}

const envBase = normalizeBasePath(process.env.BASE_PATH ?? process.env.VITE_BASE_PATH);

export default defineConfig(({ command }) => {
  const base =
    envBase ??
    (command === "build"
      ? "/agent-go-round/"
      : "/");

  return {
    plugins: [react()],
    base
  };
});
