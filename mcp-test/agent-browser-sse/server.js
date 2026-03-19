const express = require("express");
const cors = require("cors");
const { spawn } = require("node:child_process");
const os = require("node:os");
const path = require("node:path");

const app = express();
const PORT = Number(process.env.PORT || 3334);
const HOST = "0.0.0.0";
const DEFAULT_SESSION = process.env.AGENT_BROWSER_SESSION || "agr_agent_browser";
const AGENT_BROWSER_BIN =
  process.env.AGENT_BROWSER_BIN ||
  path.join(__dirname, "node_modules", ".bin", process.platform === "win32" ? "agent-browser.cmd" : "agent-browser");

app.use(cors());
app.use(express.json({ limit: "1mb" }));

const clients = new Set();

const tools = [
  {
    name: "browser_open",
    description: "Open a URL in a persistent agent-browser session.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "The URL to open." },
        headed: { type: "boolean", description: "Launch a visible browser window for debugging." },
        session: { type: "string", description: "Optional custom agent-browser session name." }
      },
      required: ["url"]
    }
  },
  {
    name: "browser_snapshot",
    description: "Capture an accessibility snapshot with @e* element refs.",
    inputSchema: {
      type: "object",
      properties: {
        session: { type: "string", description: "Optional custom agent-browser session name." }
      }
    }
  },
  {
    name: "browser_click",
    description: "Click an element by selector or @e* ref.",
    inputSchema: {
      type: "object",
      properties: {
        selector: { type: "string", description: "Selector or @e* ref to click." },
        session: { type: "string", description: "Optional custom agent-browser session name." }
      },
      required: ["selector"]
    }
  },
  {
    name: "browser_fill",
    description: "Clear and fill an input by selector or @e* ref.",
    inputSchema: {
      type: "object",
      properties: {
        selector: { type: "string", description: "Selector or @e* ref to fill." },
        text: { type: "string", description: "Text to enter." },
        session: { type: "string", description: "Optional custom agent-browser session name." }
      },
      required: ["selector", "text"]
    }
  },
  {
    name: "browser_wait",
    description: "Wait for an element selector or a number of milliseconds.",
    inputSchema: {
      type: "object",
      properties: {
        target: { type: "string", description: "Element selector, @e* ref, or millisecond string." },
        session: { type: "string", description: "Optional custom agent-browser session name." }
      },
      required: ["target"]
    }
  },
  {
    name: "browser_get_text",
    description: "Read visible text from a selector or @e* ref.",
    inputSchema: {
      type: "object",
      properties: {
        selector: { type: "string", description: "Selector or @e* ref." },
        session: { type: "string", description: "Optional custom agent-browser session name." }
      },
      required: ["selector"]
    }
  },
  {
    name: "browser_get_url",
    description: "Get the current page URL from the session.",
    inputSchema: {
      type: "object",
      properties: {
        session: { type: "string", description: "Optional custom agent-browser session name." }
      }
    }
  },
  {
    name: "browser_screenshot",
    description: "Capture a screenshot to the given file path.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Output file path, e.g. /tmp/page.png" },
        session: { type: "string", description: "Optional custom agent-browser session name." }
      },
      required: ["path"]
    }
  },
  {
    name: "browser_close",
    description: "Close the current browser session.",
    inputSchema: {
      type: "object",
      properties: {
        session: { type: "string", description: "Optional custom agent-browser session name." }
      }
    }
  }
];

app.get("/mcp/sse", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  clients.add(res);
  const heartbeat = setInterval(() => {
    res.write(": keepalive\n\n");
  }, 15000);

  req.on("close", () => {
    clearInterval(heartbeat);
    clients.delete(res);
  });
});

function pushEvent(obj) {
  const data = `data: ${JSON.stringify(obj)}\n\n`;
  for (const res of clients) {
    res.write(data);
  }
}

function resolveSession(input) {
  const session = typeof input?.session === "string" ? input.session.trim() : "";
  return session || DEFAULT_SESSION;
}

function withSession(session, args) {
  return ["--session", session, ...args];
}

function runAgentBrowser(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(AGENT_BROWSER_BIN, args, {
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout.trim());
        return;
      }
      reject(new Error(stderr.trim() || stdout.trim() || `agent-browser exited with code ${code}`));
    });
  });
}

async function callBrowserTool(name, input = {}) {
  const session = resolveSession(input);

  switch (name) {
    case "browser_open": {
      const url = String(input?.url ?? "").trim();
      if (!url) throw new Error("Input must include url.");
      const headed = input?.headed === true;
      const args = headed ? ["--headed", ...withSession(session, ["open", url])] : withSession(session, ["open", url]);
      const output = await runAgentBrowser(args);
      return {
        session,
        url,
        output: output || `Opened ${url}`
      };
    }
    case "browser_snapshot": {
      const snapshot = await runAgentBrowser(withSession(session, ["snapshot"]));
      return { session, snapshot };
    }
    case "browser_click": {
      const selector = String(input?.selector ?? "").trim();
      if (!selector) throw new Error("Input must include selector.");
      const output = await runAgentBrowser(withSession(session, ["click", selector]));
      return { session, selector, output: output || `Clicked ${selector}` };
    }
    case "browser_fill": {
      const selector = String(input?.selector ?? "").trim();
      const text = String(input?.text ?? "");
      if (!selector) throw new Error("Input must include selector.");
      const output = await runAgentBrowser(withSession(session, ["fill", selector, text]));
      return { session, selector, text, output: output || `Filled ${selector}` };
    }
    case "browser_wait": {
      const target = String(input?.target ?? "").trim();
      if (!target) throw new Error("Input must include target.");
      const output = await runAgentBrowser(withSession(session, ["wait", target]));
      return { session, target, output: output || `Waited for ${target}` };
    }
    case "browser_get_text": {
      const selector = String(input?.selector ?? "").trim();
      if (!selector) throw new Error("Input must include selector.");
      const text = await runAgentBrowser(withSession(session, ["get", "text", selector]));
      return { session, selector, text };
    }
    case "browser_get_url": {
      const url = await runAgentBrowser(withSession(session, ["get", "url"]));
      return { session, url };
    }
    case "browser_screenshot": {
      const path = String(input?.path ?? "").trim();
      if (!path) throw new Error("Input must include path.");
      const output = await runAgentBrowser(withSession(session, ["screenshot", path]));
      return { session, path, output: output || `Screenshot saved to ${path}` };
    }
    case "browser_close": {
      const output = await runAgentBrowser(withSession(session, ["close"]));
      return { session, output: output || `Closed session ${session}` };
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

app.post("/mcp/rpc", async (req, res) => {
  const { id, method, params } = req.body || {};

  try {
    if (method === "tools/list") {
      return res.json({
        id,
        result: {
          tools
        }
      });
    }

    if (method === "tools/call") {
      const name = params?.name;
      const input = params?.input ?? {};
      const result = await callBrowserTool(name, input);
      pushEvent({ type: "tool_result", tool: name, session: resolveSession(input) });
      return res.json({
        id,
        result
      });
    }

    return res.json({ id, error: "Unknown method" });
  } catch (error) {
    const message = String(error?.message ?? error);
    pushEvent({ type: "tool_error", message });
    return res.json({
      id,
      error: message
    });
  }
});

function getWslIp() {
  const values = Object.values(os.networkInterfaces()).flat().filter(Boolean);
  return values.find((item) => item.family === "IPv4" && !item.internal)?.address || null;
}

app.listen(PORT, HOST, () => {
  const localhostBase = `http://127.0.0.1:${PORT}`;
  const wslIp = getWslIp();
  console.log(`[agent-browser-sse] SSE endpoint: ${localhostBase}/mcp/sse`);
  console.log(`[agent-browser-sse] RPC endpoint: ${localhostBase}/mcp/rpc`);
  if (wslIp) {
    console.log(`[agent-browser-sse] SSE endpoint (WSL IP): http://${wslIp}:${PORT}/mcp/sse`);
    console.log(`[agent-browser-sse] RPC endpoint (WSL IP): http://${wslIp}:${PORT}/mcp/rpc`);
  }
  console.log(`[agent-browser-sse] Default session: ${DEFAULT_SESSION}`);
  console.log(`[agent-browser-sse] Tools:`);
  for (const tool of tools) {
    console.log(`- ${tool.name}${tool.description ? `: ${tool.description}` : ""}`);
  }
});
