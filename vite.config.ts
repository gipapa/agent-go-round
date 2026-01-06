import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * GitHub Pages base path:
 *   https://<username>.github.io/<repo>/
 * For this project, repo is expected to be: agent-go-round
 */
const repoName = "agent-go-round";

export default defineConfig({
  plugins: [react()],
  base: `/${repoName}/`
});
