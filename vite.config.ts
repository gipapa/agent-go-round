import { defineConfig } from "vite";
import type { Plugin } from "vite";
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

const MCP_RELAY_PATH = "/__agr_mcp_proxy";
const FORWARDED_REQUEST_HEADERS = [
  "accept",
  "authorization",
  "content-type",
  "default_parameters",
  "last-event-id",
  "mcp-method",
  "mcp-name",
  "mcp-protocol-version",
  "mcp-session-id"
];

function localMcpRelayPlugin(): Plugin {
  return {
    name: "agent-go-round-local-mcp-relay",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const requestUrl = new URL(req.url ?? "/", "http://localhost");
        if (requestUrl.pathname !== MCP_RELAY_PATH) {
          next();
          return;
        }

        try {
          if (req.method !== "POST") {
            res.statusCode = 405;
            res.end("Method not allowed");
            return;
          }
          const target = new URL(requestUrl.searchParams.get("url") ?? "");
          if (target.protocol !== "https:") {
            res.statusCode = 400;
            res.end("Local MCP relay only allows HTTPS targets");
            return;
          }

          let body = "";
          req.setEncoding("utf8");
          for await (const chunk of req) body += String(chunk);

          const headers = new Headers();
          for (const name of FORWARDED_REQUEST_HEADERS) {
            const value = req.headers[name];
            if (typeof value === "string") headers.set(name, value);
          }
          const upstream = await fetch(target, { method: "POST", headers, body });
          res.statusCode = upstream.status;
          for (const name of ["content-type", "mcp-session-id", "mcp-protocol-version", "retry-after"]) {
            const value = upstream.headers.get(name);
            if (value) res.setHeader(name, value);
          }
          res.end(new Uint8Array(await upstream.arrayBuffer()));
        } catch (error) {
          res.statusCode = 502;
          res.setHeader("content-type", "text/plain; charset=utf-8");
          res.end(error instanceof Error ? error.message : String(error));
        }
      });
    }
  };
}

export default defineConfig(({ command }) => {
  const base =
    envBase ??
    (command === "build"
      ? "/agent-go-round/"
      : "/");

  return {
    plugins: [react(), localMcpRelayPlugin()],
    base
  };
});
