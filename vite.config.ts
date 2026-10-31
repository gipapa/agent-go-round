import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";

const projectRoot = dirname(fileURLToPath(import.meta.url));

const embedDevEntry = (): Plugin => ({
  name: "agent-go-round-embed-dev-entry",
  configureServer(server) {
    server.middlewares.use((request, response, next) => {
      if (request.url?.split("?", 1)[0] !== "/embed.js") {
        next();
        return;
      }
      response.statusCode = 200;
      response.setHeader("Access-Control-Allow-Origin", request.headers.origin ?? "*");
      response.setHeader("Vary", "Origin");
      response.setHeader("Content-Type", "application/javascript");
      response.end('import "/src/embed.ts";');
    });
  }
});

export default defineConfig({
  plugins: [embedDevEntry()],
  base: process.env.VITE_BASE_PATH || "/",
  server: {
    host: "127.0.0.1"
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
    include: ["src/**/*.test.ts"],
    exclude: process.env.AGENT_GO_ROUND_RUN_GROQ === "1" ? [] : ["src/acceptance/groq-live.test.ts"]
  }
});
