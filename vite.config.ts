import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";

const projectRoot = dirname(fileURLToPath(import.meta.url));
const LOCALHOST_ORIGIN = /^https?:\/\/(?:(?:[^:]+\.)?localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/;

const embedDevEntry = (): Plugin => ({
  name: "agent-go-round-embed-dev-entry",
  configureServer(server) {
    server.middlewares.use((request, response, next) => {
      if (request.url?.split("?", 1)[0] !== "/embed.js") {
        next();
        return;
      }
      response.statusCode = 200;
      response.setHeader("Vary", "Origin");
      const origin = request.headers.origin;
      if (origin && LOCALHOST_ORIGIN.test(origin)) response.setHeader("Access-Control-Allow-Origin", origin);
      response.setHeader("Content-Type", "application/javascript");
      response.end('import "/src/embed.ts";');
    });
  }
});

export default defineConfig({
  plugins: [embedDevEntry()],
  base: process.env.VITE_BASE_PATH || "/",
  server: {
    host: "127.0.0.1",
    cors: { origin: LOCALHOST_ORIGIN }
  },
  build: {
    rollupOptions: {
      input: {
        app: resolve(projectRoot, "index.html"),
        embed: resolve(projectRoot, "src/embed.ts")
      },
      output: {
        entryFileNames: (chunk) => chunk.name === "embed" ? "embed.js" : "assets/[name]-[hash].js"
      }
    }
  },
  test: {
    environment: "happy-dom",
    environmentOptions: { happyDOM: { settings: { navigation: { disableChildFrameNavigation: true }, disableCSSFileLoading: true } } },
    include: ["src/**/*.test.ts"],
    exclude: process.env.AGENT_GO_ROUND_RUN_GROQ === "1" || process.env.AGENT_GO_ROUND_RUN_JOKES === "1" ? [] : ["src/acceptance/*-live.test.ts"]
  }
});
