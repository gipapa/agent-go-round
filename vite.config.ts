import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

declare const process: { env: Record<string, string | undefined> };

/**
 * GitHub Pages base path:
 *   https://<username>.github.io/<repo>/
 * Override BASE_PATH (or VITE_BASE_PATH) to deploy to a custom domain/root.
 */
function normalizeBasePath(input?: string | null) {
  if (!input) return null;
  const value = input.trim();
  if (!value) return null;
  if (value === "/") return "/";
  return `/${value.replace(/^\/+/g, "").replace(/\/+$/g, "")}/`;
}

const repoName = process.env.GITHUB_REPOSITORY?.split("/")[1] ?? "agent-go-round";
const envBase = normalizeBasePath(process.env.BASE_PATH ?? process.env.VITE_BASE_PATH);
const base = envBase ?? `/${repoName}/`;

export default defineConfig({
  plugins: [react()],
  base
});
