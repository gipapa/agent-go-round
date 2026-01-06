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
// Default to "/" so dev and ad-hoc hosting (e.g., localhost, static file server) work.
// For GitHub Pages or any subpath deploy, set BASE_PATH or VITE_BASE_PATH (e.g., "/agent-go-round/").
const base = envBase ?? "/";

export default defineConfig({
  plugins: [react()],
  base
});
