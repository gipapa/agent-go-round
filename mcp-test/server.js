const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

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
    res.write(data);
  }
}

/**
 * RPC endpoint
 */
app.post("/mcp/rpc", (req, res) => {
  const { id, method, params } = req.body;

  // tools/list
  if (method === "tools/list") {
    return res.json({
      id,
      result: {
        tools: [
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
        ]
      }
    });
  }

  // tools/call
  if (method === "tools/call") {
    const { name, input } = params || {};

    let result;
    if (name === "echo") {
      result = { text: input?.text ?? "" };
    } else if (name === "time") {
      result = { now: new Date().toISOString() };
    } else {
      result = { error: "Unknown tool" };
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

  res.json({ id, error: "Unknown method" });
});

app.listen(3333, () => {
  console.log("MCP SSE server running at http://localhost:3333");
});

