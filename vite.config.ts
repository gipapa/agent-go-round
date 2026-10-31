import { defineConfig } from "vite";

export default defineConfig({
  server: {
    host: "127.0.0.1"
  },
  test: {
    environment: "happy-dom",
    include: ["src/**/*.test.ts"]
  }
});
