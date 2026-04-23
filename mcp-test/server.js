const express = require("express");
const cors = require("cors");
const os = require("node:os");

const app = express();
const PORT = 3333;
const HOST = "0.0.0.0";
app.use(cors());
app.use(express.json());
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && "body" in err) {
    return res.status(400).json({ error: "Invalid JSON body" });
  }
  return next(err);
});

/**
 * 存活的 SSE client
 */
const clients = new Set();

/**
 * SSE endpoint
 */
app.get("/mcp/sse", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  clients.add(res);

  req.on("error", (err) => {
    clients.delete(res);
    console.error("[mcp-test] SSE request error:", err);
  });

  req.on("close", () => {
    clients.delete(res);
  });
});

/**
 * Helper: push SSE message
 */
function pushEvent(obj) {
  const data = `data: ${JSON.stringify(obj)}\n\n`;
  for (const res of clients) {
    try {
      res.write(data);
    } catch (err) {
      clients.delete(res);
      console.error("[mcp-test] SSE write failed:", err);
    }
  }
}

const tools = [
  {
    name: "echo",
    description: "Echo input text",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string" }
      },
      required: ["text"]
    }
  },
  {
    name: "time",
    description: "Get current server time"
  }
];

/**
 * RPC endpoint
 */
app.post("/mcp/rpc", (req, res) => {
  const body = req.body;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return res.status(400).json({ error: "body must be a JSON object" });
  }

  const { id, method, params } = body;
  if (typeof id !== "string" || !id.trim()) {
    return res.status(400).json({ error: "id must be a non-empty string" });
  }
  if (typeof method !== "string" || !method.trim()) {
    return res.status(400).json({ id, error: "method must be a non-empty string" });
  }

  try {
    // tools/list
    if (method === "tools/list") {
      return res.json({
        id,
        result: {
          tools
        }
      });
    }

    // tools/call
    if (method === "tools/call") {
      const callParams = params && typeof params === "object" && !Array.isArray(params) ? params : {};
      const { name, input } = callParams;
      if (typeof name !== "string" || !name.trim()) {
        return res.status(400).json({ id, error: "params.name must be a non-empty string" });
      }

      let result;
      if (name === "echo") {
        if (!input || typeof input !== "object" || Array.isArray(input)) {
          return res.status(400).json({ id, error: "params.input must be an object for echo" });
        }
        result = { text: typeof input.text === "string" ? input.text : "" };
      } else if (name === "time") {
        result = { now: new Date().toISOString() };
      } else {
        return res.json({ id, error: `Unknown tool: ${name}` });
      }

      // 你可以選擇「立刻回 HTTP」
      return res.json({
        id,
        result
      });

      // 或者：不回 HTTP，改用 SSE（AgentGoRound 也支援）
      // pushEvent({ id, result });
      // return res.status(202).end();
    }

    return res.json({ id, error: `Unknown method: ${method}` });
  } catch (err) {
    const message = err?.message ?? String(err);
    console.error("[mcp-test] RPC handler failed:", err);
    return res.status(500).json({ id, error: message });
  }
});

app.use((err, req, res, next) => {
  console.error("[mcp-test] unhandled error:", err);
  if (res.headersSent) return next(err);
  return res.status(500).json({ error: String(err?.message ?? err) });
});

function getWslIp() {
  const values = Object.values(os.networkInterfaces()).flat().filter(Boolean);
  return values.find((item) => item.family === "IPv4" && !item.internal)?.address || null;
}

app.listen(PORT, HOST, () => {
  const localhostBase = `http://127.0.0.1:${PORT}`;
  const wslIp = getWslIp();
  console.log(`MCP SSE endpoint: ${localhostBase}/mcp/sse`);
  console.log(`MCP RPC endpoint: ${localhostBase}/mcp/rpc`);
  if (wslIp) {
    console.log(`MCP SSE endpoint (WSL IP): http://${wslIp}:${PORT}/mcp/sse`);
    console.log(`MCP RPC endpoint (WSL IP): http://${wslIp}:${PORT}/mcp/rpc`);
  }
  console.log("Tools:");
  for (const tool of tools) {
    console.log(`- ${tool.name}${tool.description ? `: ${tool.description}` : ""}`);
  }
});
