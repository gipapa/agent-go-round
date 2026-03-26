import fs from "node:fs/promises";
import path from "node:path";
import { spawn, execFile as execFileCallback, ChildProcessWithoutNullStreams } from "node:child_process";
import { promisify } from "node:util";
import { setTimeout as sleep } from "node:timers/promises";
import { parseTutorialScenario } from "../src/onboarding/catalogCore";
import type { TutorialScenarioDefinition, TutorialStepDefinition } from "../src/onboarding/types";
import { AGENT_GO_ROUND_INDEXED_DB_TARGETS, AGENT_GO_ROUND_LOCAL_STORAGE_KEYS } from "../src/utils/resetAppStorage";
import { normalizeCredentialUrl } from "../src/utils/credential";

const ROOT = path.resolve(import.meta.dirname, "..");
const MCP_ROOT = path.join(ROOT, "mcp-test");
const CONFIG_PATH = path.join(ROOT, ".tutorial-test.local.json");
const TUTORIAL_DIR = path.join(ROOT, "src/onboarding/tutorials");
const TUTORIAL_FILES = [
  "first-agent-chat.yaml",
  "docs-persona-chat.yaml",
  "built-in-tools-chat.yaml",
  "sequential-skill-chat.yaml",
  "agent-browser-mcp-chat.yaml",
  "chatgpt-browser-skill.yaml"
];

const APP_URL = "http://127.0.0.1:5566/";
const MCP_SSE_URL = "http://127.0.0.1:3334/mcp/sse";
const MCP_RPC_URL = "http://127.0.0.1:3334/mcp/rpc";
const AGENT_BROWSER_SESSION = `agr_real_tutorial_${Date.now()}`;
const LOCALHOST_GROQ_ENDPOINT = "https://api.groq.com/openai/v1";
const MODEL_COOLDOWN_MS = 12000;
const TUTORIAL_PRIMARY_LB_NAME = "教學用Load Balancer 1";
const TUTORIAL_SECONDARY_LB_NAME = "教學用Load Balancer 2";
const execFile = promisify(execFileCallback);
const REAL_TUTORIAL_ONLY = process.env.REAL_TUTORIAL_ONLY?.trim() || "";
const REAL_TUTORIAL_PROMPT_OVERRIDE = process.env.REAL_TUTORIAL_PROMPT_OVERRIDE?.trim() || "";

type RealTutorialConfig = {
  provider: string;
  apiKeys: string[];
  endpoint: string;
  model: string;
};

type ManagedProcess = {
  name: string;
  proc: ChildProcessWithoutNullStreams;
  stdout: string[];
  stderr: string[];
};

async function readRealTutorialConfig(): Promise<RealTutorialConfig> {
  const raw = await fs.readFile(CONFIG_PATH, "utf8");
  const parsed = JSON.parse(raw) as Partial<RealTutorialConfig>;
  const provider = String(parsed.provider ?? "").trim();
  const apiKeys = Array.isArray(parsed.apiKey)
    ? parsed.apiKey.map((entry) => String(entry ?? "").trim()).filter(Boolean)
    : typeof parsed.apiKey === "string" && parsed.apiKey.trim()
    ? [parsed.apiKey.trim()]
    : [];
  const endpoint = normalizeCredentialUrl(parsed.endpoint);
  const model = String(parsed.model ?? "").trim();

  if (!provider || apiKeys.length === 0 || !endpoint || !model) {
    throw new Error(".tutorial-test.local.json 缺少必要欄位：provider / apiKey / endpoint / model");
  }

  if (normalizeCredentialUrl(endpoint) !== LOCALHOST_GROQ_ENDPOINT) {
    throw new Error(`目前教學案例 1 走的是 Groq 路線，.tutorial-test.local.json 的 endpoint 必須是 ${LOCALHOST_GROQ_ENDPOINT}`);
  }

  if (provider !== "groq") {
    throw new Error('目前教學案例 1 需要 provider 設定為 "groq"。');
  }

  return { provider, apiKeys, endpoint, model };
}

async function loadScenarios(): Promise<TutorialScenarioDefinition[]> {
  return Promise.all(
    TUTORIAL_FILES.map(async (file) => parseTutorialScenario(await fs.readFile(path.join(TUTORIAL_DIR, file), "utf8")))
  );
}

function startManagedProcess(name: string, cwd: string, command: string) {
  const proc = spawn("bash", ["-lc", command], {
    cwd,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: true
  });
  const state: ManagedProcess = {
    name,
    proc,
    stdout: [],
    stderr: []
  };

  proc.stdout.on("data", (chunk) => {
    const text = chunk.toString();
    state.stdout.push(text);
    if (state.stdout.length > 400) state.stdout.shift();
  });
  proc.stderr.on("data", (chunk) => {
    const text = chunk.toString();
    state.stderr.push(text);
    if (state.stderr.length > 400) state.stderr.shift();
  });

  return state;
}

async function stopManagedProcess(proc: ManagedProcess | null) {
  if (!proc || proc.proc.exitCode !== null || proc.proc.killed) return;
  try {
    process.kill(-proc.proc.pid!, "SIGTERM");
  } catch {
    try {
      proc.proc.kill("SIGTERM");
    } catch {
      return;
    }
  }
  const deadline = Date.now() + 5000;
  while (proc.proc.exitCode === null && Date.now() < deadline) {
    await sleep(100);
  }
  if (proc.proc.exitCode === null) {
    try {
      process.kill(-proc.proc.pid!, "SIGKILL");
    } catch {
      try {
        proc.proc.kill("SIGKILL");
      } catch {
        // ignore
      }
    }
  }
}

function dumpProcessLogs(proc: ManagedProcess | null) {
  if (!proc) return;
  const stdout = proc.stdout.join("");
  const stderr = proc.stderr.join("");
  if (stdout.trim()) {
    console.error(`\n[${proc.name}] stdout\n${stdout.slice(-8000)}`);
  }
  if (stderr.trim()) {
    console.error(`\n[${proc.name}] stderr\n${stderr.slice(-8000)}`);
  }
}

async function waitFor(
  check: () => Promise<boolean>,
  timeoutMs: number,
  label: string,
  onTick?: (elapsedMs: number) => Promise<void> | void,
  tickIntervalMs = 30000
) {
  const started = Date.now();
  let lastError: string | null = null;
  let lastTick = 0;
  while (Date.now() - started < timeoutMs) {
    try {
      if (await check()) return;
      lastError = null;
    } catch (error: any) {
      lastError = String(error?.message ?? error);
    }
    const elapsed = Date.now() - started;
    if (onTick && elapsed - lastTick >= tickIntervalMs) {
      lastTick = elapsed;
      await onTick(elapsed);
    }
    await sleep(500);
  }
  throw new Error(lastError ? `${label} 逾時：${lastError}` : `${label} 逾時`);
}

async function waitForHttp(url: string, timeoutMs: number) {
  await waitFor(async () => {
    const res = await fetch(url, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  }, timeoutMs, `等待 ${url}`);
}

async function isHttpReady(url: string) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(1200) });
    return res.ok;
  } catch {
    return false;
  }
}

async function waitForMcpServer(timeoutMs: number) {
  await waitFor(async () => {
    const res = await fetch(MCP_RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "real-tutorial-check", method: "tools/list", params: {} }),
      signal: AbortSignal.timeout(3000)
    });
    if (!res.ok) return false;
    const json = await res.json();
    const tools = Array.isArray(json?.result?.tools) ? json.result.tools : [];
    return tools.some((tool: any) => tool?.name === "browser_open") && tools.some((tool: any) => tool?.name === "browser_snapshot");
  }, timeoutMs, "等待 agent-browser MCP SSE 服務");
}

async function isMcpServerReady() {
  try {
    const res = await fetch(MCP_RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "real-tutorial-check", method: "tools/list", params: {} }),
      signal: AbortSignal.timeout(1500)
    });
    if (!res.ok) return false;
    const json = await res.json();
    const tools = Array.isArray(json?.result?.tools) ? json.result.tools : [];
    return tools.some((tool: any) => tool?.name === "browser_open") && tools.some((tool: any) => tool?.name === "browser_snapshot");
  } catch {
    return false;
  }
}

async function runShell(command: string) {
  await execFile("bash", ["-lc", command], { cwd: ROOT });
}

async function waitForRestartedHttp(url: string, timeoutMs: number, hadServerBefore: boolean) {
  if (hadServerBefore) {
    await waitFor(async () => !(await isHttpReady(url)), Math.min(timeoutMs, 15000), `等待 ${url} 舊服務關閉`);
  }
  await waitForHttp(url, timeoutMs);
}

async function browserCommand(args: string[], stdin?: string) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const proc = spawn("agent-browser", ["--session", AGENT_BROWSER_SESSION, ...args], {
      cwd: ROOT,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(stderr.trim() || stdout.trim() || `agent-browser exited with code ${code}`));
    });

    if (stdin) {
      proc.stdin.write(stdin);
    }
    proc.stdin.end();
  });
}

async function browserOpen(url: string) {
  await browserCommand(["open", url]);
}

async function browserClose() {
  try {
    await Promise.race([
      browserCommand(["close"]),
      sleep(5000).then(() => {
        throw new Error("agent-browser close timeout");
      })
    ]);
  } catch {
    // ignore cleanup failure
  }
}

async function browserEval<T>(script: string): Promise<T> {
  const { stdout } = await browserCommand(["eval", "--json", "--stdin"], script);
  const parsed = JSON.parse(stdout);
  if (!parsed?.success) {
    throw new Error(parsed?.error ?? "agent-browser eval failed");
  }
  return parsed?.data?.result as T;
}

function literal(value: unknown) {
  return JSON.stringify(value);
}

async function waitForSelector(selector: string, timeoutMs: number) {
  await waitFor(
    () =>
      browserEval<boolean>(`
        !!document.querySelector(${literal(selector)})
      `),
    timeoutMs,
    `等待 selector: ${selector}`
  );
}

async function waitForText(text: string, timeoutMs: number) {
  await waitFor(
    () =>
      browserEval<boolean>(`
        (document.body?.innerText || "").includes(${literal(text)})
      `),
    timeoutMs,
    `等待文字: ${text}`
  );
}

async function clickByTutorialId(id: string) {
  const ok = await browserEval<boolean>(`
    (() => {
      const el = document.querySelector(${literal(`[data-tutorial-id="${id}"]`)});
      if (!el) return false;
      el.scrollIntoView({ block: "center", inline: "center" });
      el.click();
      return true;
    })()
  `);
  if (!ok) throw new Error(`找不到 data-tutorial-id="${id}"`);
}

async function clickTopTab(labelText: string) {
  const ok = await browserEval<boolean>(`
    (() => {
      const normalize = (value) => String(value || "").replace(/\\s+/g, " ").trim();
      const wanted = normalize(${literal(labelText)});
      const buttons = Array.from(document.querySelectorAll(".tab-btn"));
      const target = buttons.find((button) => normalize(button.textContent).includes(wanted));
      if (!(target instanceof HTMLElement)) return false;
      target.click();
      return true;
    })()
  `);
  if (!ok) throw new Error(`找不到 tab：${labelText}`);
}

async function setValueByTutorialId(id: string, value: string) {
  const ok = await browserEval<boolean>(`
    (() => {
      const el = document.querySelector(${literal(`[data-tutorial-id="${id}"]`)});
      if (!el) return false;
      const proto =
        el instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : el instanceof HTMLInputElement
          ? HTMLInputElement.prototype
          : null;
      const setter = proto ? Object.getOwnPropertyDescriptor(proto, "value")?.set : null;
      if (!setter) return false;
      setter.call(el, ${literal(value)});
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    })()
  `);
  if (!ok) throw new Error(`無法設定欄位 ${id}`);
}

async function selectOptionByTutorialId(id: string, text: string) {
  const ok = await browserEval<boolean>(`
    (() => {
      const normalize = (value) => String(value || "").replace(/\\s+/g, " ").trim();
      const el = document.querySelector(${literal(`[data-tutorial-id="${id}"]`)});
      if (!(el instanceof HTMLSelectElement)) return false;
      const option = Array.from(el.options).find((item) => normalize(item.textContent).includes(normalize(${literal(text)})));
      if (!option) return false;
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
      if (!setter) return false;
      setter.call(el, option.value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    })()
  `);
  if (!ok) throw new Error(`找不到 select ${id} 的選項：${text}`);
}

async function setCheckboxByTutorialId(id: string, checked: boolean) {
  const changed = await browserEval<boolean>(`
    (() => {
      const el = document.querySelector(${literal(`[data-tutorial-id="${id}"]`)});
      if (!(el instanceof HTMLInputElement)) return false;
      if (el.checked === ${checked ? "true" : "false"}) return true;
      el.click();
      return true;
    })()
  `);
  if (!changed) throw new Error(`找不到 checkbox ${id}`);
}

async function createLoadBalancerByTutorialUi(args: {
  name: string;
  description?: string;
  instances: Array<{
    credentialLabel: string;
    keyLabel?: string;
    model: string;
    description?: string;
    maxRetries?: number;
    delaySecond?: number;
  }>;
}) {
  await clickByTutorialId("chat-config-load-balancer-card");
  await waitForSelector('[data-tutorial-id="load-balancer-new-button"]', 10000);
  await clickByTutorialId("load-balancer-new-button");
  await waitForSelector('[data-tutorial-id="load-balancer-editor-modal"]', 10000);
  await setValueByTutorialId("load-balancer-name-input", args.name);
  if (args.description) {
    await setValueByTutorialId("load-balancer-description-input", args.description);
  }
  for (let index = 0; index < args.instances.length; index += 1) {
    const instance = args.instances[index];
    await clickByTutorialId("load-balancer-add-instance-button");
    await waitForSelector(`[data-tutorial-id="load-balancer-instance-credential-${index}"]`, 10000);
    await selectOptionByTutorialId(`load-balancer-instance-credential-${index}`, instance.credentialLabel);
    if (instance.keyLabel) {
      await selectOptionByTutorialId(`load-balancer-instance-key-${index}`, instance.keyLabel);
    }
    await setValueByTutorialId(`load-balancer-instance-model-${index}`, instance.model);
    if (instance.description) {
      await setValueByTutorialId(`load-balancer-instance-description-${index}`, instance.description);
    }
    if (typeof instance.maxRetries === "number") {
      await setValueByTutorialId(`load-balancer-instance-max-retries-${index}`, String(instance.maxRetries));
    }
    if (typeof instance.delaySecond === "number") {
      await setValueByTutorialId(`load-balancer-instance-delay-second-${index}`, String(instance.delaySecond));
    }
  }
  await clickByTutorialId("load-balancer-save-button");
}

async function hasLoadBalancer(name: string) {
  return browserEval<boolean>(`
    (() => {
      try {
        const raw = localStorage.getItem("agr_load_balancers_v1");
        if (!raw) return false;
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return false;
        return parsed.some((entry) => String(entry?.name || "").trim() === ${literal(name)});
      } catch {
        return false;
      }
    })()
  `);
}

async function hasCredentialKeyRow(rowIndex: number) {
  return browserEval<boolean>(`
    !!document.querySelector(${literal(`[data-tutorial-id="credential-groq-api-key-${rowIndex}"]`)})
  `);
}

async function clickLabelContaining(scopeSelector: string, labelText: string) {
  const ok = await browserEval<boolean>(`
    (() => {
      const normalize = (value) => String(value || "").replace(/\\s+/g, " ").trim();
      const scope = document.querySelector(${literal(scopeSelector)});
      if (!scope) return false;
      const wanted = normalize(${literal(labelText)});
      const labels = Array.from(scope.querySelectorAll("label"));
      const target = labels.find((label) => normalize(label.textContent).includes(wanted));
      if (!target) return false;
      target.scrollIntoView({ block: "center", inline: "nearest" });
      target.click();
      return true;
    })()
  `);
  if (!ok) throw new Error(`在 ${scopeSelector} 中找不到標籤：${labelText}`);
}

async function clickLastSummary(text: string) {
  const ok = await browserEval<boolean>(`
    (() => {
      const normalize = (value) => String(value || "").replace(/\\s+/g, " ").trim();
      const summaries = Array.from(document.querySelectorAll("details > summary"));
      const matches = summaries.filter((item) => normalize(item.textContent).includes(normalize(${literal(text)})));
      const target = matches.at(-1);
      if (!target) return false;
      const details = target.parentElement;
      if (!(details instanceof HTMLDetailsElement)) return false;
      details.scrollIntoView({ block: "center", inline: "nearest" });
      if (!details.open) {
        details.open = true;
        details.dispatchEvent(new Event("toggle", { bubbles: false }));
      }
      return true;
    })()
  `);
  if (!ok) throw new Error(`找不到 summary：${text}`);
}

async function getTutorialNextState() {
  return browserEval<{ disabled: boolean; label: string }>(`
    (() => {
      const button = document.querySelector(${literal('[data-tutorial-id="tutorial-next"]')});
      return {
        disabled: !(button instanceof HTMLButtonElement) || button.disabled,
        label: button ? String(button.textContent || "").trim() : ""
      };
    })()
  `);
}

async function waitForTutorialNextEnabled(timeoutMs: number, step: TutorialStepDefinition) {
  try {
    await waitFor(
      async () => {
        const next = await getTutorialNextState();
        return !next.disabled;
      },
      timeoutMs,
      `等待步驟完成：${step.id}`,
      step.automation?.skillExecutionMode === "multi_turn"
        ? async (elapsedMs) => {
            const statusText = await getPromptStatusText().catch(() => "");
            const assistant = await getLatestAssistantText().catch(() => "");
            const todo = await getLatestSkillTodoText().catch(() => "");
            console.log(
              `[wait:${step.id}] ${Math.round(elapsedMs / 1000)}s status=${statusText || "(empty)"} assistant=${truncateForLog(
                assistant
              )} todo=${truncateForLog(todo)}`
            );
          }
        : undefined
    );
  } catch (error: any) {
    const statusText = await getPromptStatusText().catch(() => "");
    throw new Error(`${String(error?.message ?? error)}${statusText ? `；目前畫面狀態：${statusText}` : ""}`);
  }
}

async function getCurrentStepId() {
  return browserEval<string | null>(`
    (() => {
      const el = document.querySelector(".tutorial-check-item.current[data-onboarding-step]");
      return el ? el.getAttribute("data-onboarding-step") : null;
    })()
  `);
}

async function waitForCurrentStep(stepId: string, timeoutMs: number) {
  await waitFor(async () => (await getCurrentStepId()) === stepId, timeoutMs, `等待目前步驟切到 ${stepId}`);
}

async function getPromptStatusText() {
  return browserEval<string>(`
    (() => {
      const el = document.querySelector(".tutorial-prompt-status");
      return el ? String(el.textContent || "").trim() : "";
    })()
  `);
}

async function getScenarioTitle() {
  return browserEval<string>(`
    (() => {
      const el = document.querySelector(".tutorial-sidebar-title");
      return el ? String(el.textContent || "").trim() : "";
    })()
  `);
}

async function getLatestAssistantText() {
  return browserEval<string>(`
    (() => {
      const items = Array.from(document.querySelectorAll(".chat-row.from-agent .chat-bubble.assistant"));
      const target = items.at(-1);
      return target ? String(target.textContent || "").trim() : "";
    })()
  `);
}

async function getLatestSkillTodoText() {
  return browserEval<string>(`
    (() => {
      const items = Array.from(document.querySelectorAll(".chat-skill-todo"));
      const target = items.at(-1);
      return target ? String(target.textContent || "").replace(/\\s+/g, " ").trim() : "";
    })()
  `);
}

async function getLatestSkillTraceText() {
  return browserEval<string>(`
    (() => {
      const items = Array.from(document.querySelectorAll(".chat-tool-details"));
      const target = items.findLast((item) => String(item.textContent || "").includes("查看 skill 流程紀錄"));
      if (!(target instanceof HTMLDetailsElement)) return "";
      if (!target.open) {
        target.open = true;
        target.dispatchEvent(new Event("toggle", { bubbles: false }));
      }
      return String(target.textContent || "").replace(/\\s+/g, " ").trim();
    })()
  `);
}

async function getLatestLogText(limit = 12) {
  return browserEval<string>(`
    (() => {
      const rows = Array.from(document.querySelectorAll(".log-entry"));
      return rows
        .slice(0, ${limit})
        .map((row) => String(row.textContent || "").replace(/\\s+/g, " ").trim())
        .filter(Boolean)
        .join("\\n");
    })()
  `);
}

async function getToolResultSummaryCount() {
  return browserEval<number>(`
    (() => {
      const summaries = Array.from(document.querySelectorAll("details > summary"));
      return summaries.filter((item) => String(item.textContent || "").includes("查看 tool result")).length;
    })()
  `);
}

async function getLatestToolResultText() {
  return browserEval<string>(`
    (() => {
      const details = Array.from(document.querySelectorAll("details.chat-tool-details"));
      const target = details.findLast((item) => String(item.textContent || "").includes("查看 tool result"));
      if (!(target instanceof HTMLDetailsElement)) return "";
      if (!target.open) {
        target.open = true;
        target.dispatchEvent(new Event("toggle", { bubbles: false }));
      }
      return String(target.textContent || "").replace(/\\s+/g, " ").trim();
    })()
  `);
}

async function clearAppStorageInBrowser() {
  await browserEval<boolean>(`
    (() => new Promise((resolve, reject) => {
      const localKeys = ${literal(AGENT_GO_ROUND_LOCAL_STORAGE_KEYS)};
      const dbTargets = ${literal(AGENT_GO_ROUND_INDEXED_DB_TARGETS)};

      function clearDbStores(dbName, stores) {
        return new Promise((innerResolve, innerReject) => {
          const req = indexedDB.open(dbName);
          req.onerror = () => innerReject(req.error);
          req.onsuccess = () => {
            const db = req.result;
            const targets = stores.filter((store) => db.objectStoreNames.contains(store));
            if (targets.length === 0) {
              db.close();
              innerResolve();
              return;
            }
            const tx = db.transaction(targets, "readwrite");
            targets.forEach((store) => tx.objectStore(store).clear());
            tx.oncomplete = () => {
              db.close();
              innerResolve();
            };
            tx.onerror = () => {
              db.close();
              innerReject(tx.error);
            };
          };
        });
      }

      localKeys.forEach((key) => localStorage.removeItem(key));
      Promise.all(dbTargets.map((target) => clearDbStores(target.name, target.stores)))
        .then(() => resolve(true))
        .catch(reject);
    }))()
  `);
}

async function reloadPage() {
  await browserEval(`window.location.reload()`);
}

function truncateForLog(text: string, max = 180) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  return normalized.length <= max ? normalized : `${normalized.slice(0, Math.max(0, max - 1))}…`;
}

async function waitForChatReply(timeoutMs: number, step?: TutorialStepDefinition) {
  await waitFor(
    async () => {
      const text = await getLatestAssistantText();
      const normalized = text.trim();
      return normalized.length > 0 && normalized !== "...";
    },
    timeoutMs,
    "等待 assistant 回覆",
    step?.automation?.skillExecutionMode === "multi_turn"
      ? async (elapsedMs) => {
          const statusText = await getPromptStatusText().catch(() => "");
          const assistant = await getLatestAssistantText().catch(() => "");
          const todo = await getLatestSkillTodoText().catch(() => "");
          const trace = await getLatestSkillTraceText().catch(() => "");
          const logs = await getLatestLogText(6).catch(() => "");
          const toolResults = await getLatestToolResultText().catch(() => "");
          console.log(
            `[reply:${step.id}] ${Math.round(elapsedMs / 1000)}s status=${statusText || "(empty)"} assistant=${truncateForLog(
              assistant
            )} todo=${truncateForLog(todo, 360)} trace=${truncateForLog(trace, 2200)} tool=${truncateForLog(toolResults, 1200)} logs=${truncateForLog(logs, 800)}`
          );
        }
      : undefined
  );
}

async function clickTutorialNext() {
  const next = await getTutorialNextState();
  if (next.disabled) {
    const statusText = await getPromptStatusText();
    throw new Error(`目前無法前往下一步：${statusText || "教學步驟尚未完成"}`);
  }
  await clickByTutorialId("tutorial-next");
}

async function clickTutorialSkipCase() {
  await clickByTutorialId("tutorial-skip-case");
}

async function performStepAction(step: TutorialStepDefinition, config: RealTutorialConfig) {
  switch (step.behavior) {
    case "manual_info":
      return;
    case "setup_groq_credential":
      await clickByTutorialId("chat-config-credentials-card");
      await waitForSelector('[data-tutorial-id="credentials-modal"]', 10000);
      await clickByTutorialId("credential-add-groq");
      await waitForSelector('[data-tutorial-id="credential-groq-card"]', 10000);
      await setValueByTutorialId("credential-groq-label-input", "Groq");
      await setValueByTutorialId("credential-groq-api-key", config.apiKeys[0]);
      for (let index = 1; index < config.apiKeys.length; index += 1) {
        await clickByTutorialId("credential-groq-add-key");
        await waitForSelector(`[data-tutorial-id="credential-groq-api-key-${index + 1}"]`, 10000);
        await setValueByTutorialId(`credential-groq-api-key-${index + 1}`, config.apiKeys[index]);
      }
      await clickByTutorialId("credential-groq-test");
      await waitForText("測試成功", 30000);
      return;
    case "create_single_load_balancer":
      try {
        await waitFor(() => hasLoadBalancer(TUTORIAL_PRIMARY_LB_NAME), 5000, "等待案例自動建立第一個 Load Balancer");
      } catch {
        await createLoadBalancerByTutorialUi({
          name: TUTORIAL_PRIMARY_LB_NAME,
          description: "教學用單一 instance Load Balancer",
          instances: [
            {
              credentialLabel: "Groq",
              keyLabel: "Key 1",
              model: config.model,
              description: "Primary tutorial instance",
              maxRetries: 4,
              delaySecond: 5
            }
          ]
        });
      }
      return;
    case "create_groq_agent":
      await clickByTutorialId("agents-add-button");
      await waitForSelector('[data-tutorial-id="agent-edit-modal"]', 10000);
      await setValueByTutorialId("agent-name-input", "教學測試 Agent");
      await selectOptionByTutorialId("agent-load-balancer-select", TUTORIAL_PRIMARY_LB_NAME);
      await clickByTutorialId("agent-save-button");
      return;
    case "create_multi_load_balancer": {
      await clickByTutorialId("chat-config-credentials-card");
      await waitForSelector('[data-tutorial-id="credentials-modal"]', 10000);
      const hasSecondKey = await hasCredentialKeyRow(2);
      if (!hasSecondKey) {
        await clickByTutorialId("credential-groq-add-key");
        await waitForSelector('[data-tutorial-id="credential-groq-api-key-2"]', 10000);
      }
      await setValueByTutorialId("credential-groq-api-key-2", config.apiKeys[1] ?? config.apiKeys[0]);
      await waitFor(() => hasLoadBalancer(TUTORIAL_SECONDARY_LB_NAME), 10000, "等待案例自動建立第二個 Load Balancer");
      return;
    }
    case "switch_tutorial_agent_to_multi_load_balancer":
      await clickByTutorialId("agents-edit-active-button");
      await waitForSelector('[data-tutorial-id="agent-edit-modal"]', 10000);
      await selectOptionByTutorialId("agent-load-balancer-select", TUTORIAL_SECONDARY_LB_NAME);
      await clickByTutorialId("agent-save-button");
      return;
    case "create_tutorial_doc":
      await clickByTutorialId("chat-config-docs-card");
      await waitForSelector('[data-tutorial-id="docs-new-button"]', 10000);
      await clickByTutorialId("docs-new-button");
      await waitForSelector('[data-tutorial-id="docs-title-input"]', 10000);
      await setValueByTutorialId("docs-title-input", "教學用DOC");
      await setValueByTutorialId("docs-content-input", "你是個說話結尾都會喵喵叫的助手。每次回答的結尾都要補上一句喵。");
      await clickByTutorialId("docs-save-button");
      return;
    case "enable_tutorial_doc_access":
      await clickByTutorialId("agents-edit-active-button");
      await waitForSelector('[data-tutorial-id="agent-edit-modal"]', 10000);
      await setCheckboxByTutorialId("agent-access-docs-toggle", true);
      await clickByTutorialId("agent-save-button");
      return;
    case "create_tutorial_time_tool":
      await clickByTutorialId("chat-config-tools-card");
      await waitForSelector('[data-tutorial-id="built-in-tools-add-button"]', 10000);
      await clickByTutorialId("built-in-tools-add-button");
      await waitForSelector('[data-tutorial-id="built-in-tools-modal"]', 10000);
      await setValueByTutorialId("built-in-tool-name-input", "教學用時間工具");
      await setValueByTutorialId("built-in-tool-description-input", "取得目前瀏覽器時間與時區，適合回答現在幾點或目前時區等問題。");
      await setValueByTutorialId("built-in-tool-schema-input", "{}");
      await setValueByTutorialId(
        "built-in-tool-code-input",
        `const now = new Date();

return {
  isoTime: now.toISOString(),
  localeTime: now.toLocaleString(),
  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
};`
      );
      await clickByTutorialId("built-in-tool-save-button");
      return;
    case "set_history_limit_to_one":
      await clickByTutorialId("chat-config-history-card");
      await waitForSelector('[data-tutorial-id="history-limit-input"]', 10000);
      await setValueByTutorialId("history-limit-input", "1");
      return;
    case "fill_tutorial_user_profile":
      await clickByTutorialId("tab-profile");
      await setValueByTutorialId("profile-name-input", "教學測試使用者");
      await setValueByTutorialId("profile-description-input", "我是一位正在驗證 AgentGoRound built-in tool 與 skill 功能的使用者。");
      return;
    case "enable_tutorial_builtin_tool_access":
      await clickByTutorialId("agents-edit-active-button");
      await waitForSelector('[data-tutorial-id="agent-edit-modal"]', 10000);
      await setCheckboxByTutorialId("agent-access-builtins-toggle", true);
      await clickByTutorialId("agent-access-builtins-custom");
      await clickLabelContaining('[data-tutorial-id="agent-access-builtins-section"]', "教學用時間工具");
      await clickLabelContaining('[data-tutorial-id="agent-access-builtins-section"]', "[系統工具]允許存取使用者資訊(get_user_profile)");
      await clickByTutorialId("agent-save-button");
      return;
    case "ensure_tutorial_sequential_skill":
      return;
    case "ensure_tutorial_chatgpt_browser_skill":
      return;
    case "enable_tutorial_skill_access":
      await clickByTutorialId("agents-edit-active-button");
      await waitForSelector('[data-tutorial-id="agent-edit-modal"]', 10000);
      await setCheckboxByTutorialId("agent-access-skills-toggle", true);
      await clickByTutorialId("agent-access-skills-custom");
      try {
        await clickLabelContaining('[data-tutorial-id="agent-access-skills-section"]', "sequential-thinking");
      } catch {
        await clickLabelContaining('[data-tutorial-id="agent-access-skills-section"]', "Sequential Thinking Tutorial Skill");
      }
      await clickByTutorialId("agent-save-button");
      return;
    case "enable_tutorial_chatgpt_browser_skill_access":
      await clickByTutorialId("agents-edit-active-button");
      await waitForSelector('[data-tutorial-id="agent-edit-modal"]', 10000);
      await setCheckboxByTutorialId("agent-access-skills-toggle", true);
      await clickByTutorialId("agent-access-skills-all");
      await clickByTutorialId("agent-save-button");
      return;
    case "register_tutorial_agent_browser_mcp":
      await clickByTutorialId("chat-config-mcp-card");
      await waitForSelector('[data-tutorial-id="mcp-add-button"]', 10000);
      await clickByTutorialId("mcp-add-button");
      await waitForSelector('[data-tutorial-id="mcp-editor-modal"]', 10000);
      await setValueByTutorialId("mcp-name-input", "教學用MCP");
      await setValueByTutorialId("mcp-sse-url-input", MCP_SSE_URL);
      await clickByTutorialId("mcp-connect-list-tools");
      await waitForText("browser_open", 60000);
      await waitForText("browser_snapshot", 60000);
      await waitFor(
        () =>
          browserEval<boolean>(`
            (() => {
              const button = document.querySelector(${literal('[data-tutorial-id="mcp-save-button"]')});
              return button instanceof HTMLButtonElement && !button.disabled;
            })()
          `),
        60000,
        "等待 MCP Save 按鈕可用"
      );
      await clickByTutorialId("mcp-save-button");
      return;
    case "enable_tutorial_mcp_access":
      await clickByTutorialId("agents-edit-active-button");
      await waitForSelector('[data-tutorial-id="agent-edit-modal"]', 10000);
      await setCheckboxByTutorialId("agent-access-mcp-toggle", true);
      await clickByTutorialId("agent-save-button");
      return;
    case "first_chat_joke":
    case "first_chat_doc_persona":
    case "first_chat_time_tool":
    case "first_chat_user_profile_tool":
    case "first_chat_skill_tone":
    case "first_chat_skill_user_profile":
    case "first_chat_skill_references":
    case "first_chat_skill_asset_template":
    case "first_chat_skill_chatgpt_ask":
    case "first_chat_mcp_browser_open":
    case "first_chat_mcp_browser_snapshot": {
      const isMultiTurn = step.automation?.skillExecutionMode === "multi_turn";
      const replyTimeout = isMultiTurn ? 600000 : 180000;
      const toolSummaryTimeout = isMultiTurn ? 180000 : 30000;
      await clickByTutorialId("tab-chat");
      const prompt =
        REAL_TUTORIAL_PROMPT_OVERRIDE && step.behavior === "first_chat_skill_chatgpt_ask"
          ? REAL_TUTORIAL_PROMPT_OVERRIDE
          : step.automation?.composerSeed ?? "";
      const previousToolResultCount = step.automation?.expect?.requireOpenedToolResult ? await getToolResultSummaryCount() : 0;
      if (prompt) {
        if (REAL_TUTORIAL_PROMPT_OVERRIDE && step.behavior === "first_chat_skill_chatgpt_ask") {
          await setValueByTutorialId("chat-input", prompt);
        }
        await waitFor(
          () =>
            browserEval<boolean>(`
              (() => {
                const input = document.querySelector(${literal('[data-tutorial-id="chat-input"]')});
                return !!input && String(input.value || "").trim() === ${literal(prompt.trim())};
              })()
            `),
          10000,
          `等待 chat input 預填：${step.id}`
        );
      }
      await clickByTutorialId("chat-send");
      await waitForChatReply(replyTimeout, step);
      if (step.automation?.expect?.requireOpenedToolResult) {
        await waitFor(
          () =>
            browserEval<boolean>(`
              (() => {
                const summaries = Array.from(document.querySelectorAll("details > summary"));
                const count = summaries.filter((item) => String(item.textContent || "").includes("查看 tool result")).length;
                return count > ${previousToolResultCount};
              })()
            `),
          toolSummaryTimeout,
          "等待 tool result summary"
        );
        await clickLastSummary("查看 tool result");
      }
      return;
    }
    default:
      throw new Error(`尚未支援這個 real tutorial 行為：${step.behavior}`);
  }
}

async function executeScenario(scenario: TutorialScenarioDefinition, isLastScenario: boolean) {
  console.log(`\n=== ${scenario.title} ===`);
  const sidebarTitle = await getScenarioTitle();
  if (sidebarTitle && sidebarTitle !== scenario.title) {
    throw new Error(`目前教學案例與預期不符。預期：${scenario.title}，實際：${sidebarTitle}`);
  }

  for (let index = 0; index < scenario.steps.length; index += 1) {
    const step = scenario.steps[index];
    const isLastStep = index === scenario.steps.length - 1;
    await waitForCurrentStep(step.id, 20000);
    console.log(`[>] ${scenario.title} / ${step.checklistLabel}`);

    if (step.behavior !== "manual_info") {
      await performStepAction(step, realConfig);
    }

    const nextTimeout = step.automation?.skillExecutionMode === "multi_turn" ? 600000 : 180000;
    await waitForTutorialNextEnabled(nextTimeout, step);

    let assistantReply = "";
    let skillTodoText = "";
    let skillTraceText = "";
    if (step.automation?.expect?.requireAssistant) {
      assistantReply = await getLatestAssistantText();
    }
    if (step.automation?.expect?.requireSkillTodo) {
      skillTodoText = await getLatestSkillTodoText();
      skillTraceText = await getLatestSkillTraceText();
    }

    console.log(`[o] ${scenario.title} / ${step.checklistLabel}`);
    if (assistantReply) {
      console.log(`    回覆：\n${indentBlock(assistantReply, "    ")}`);
    }
    if (skillTodoText) {
      console.log(`    Todo：\n${indentBlock(skillTodoText, "    ")}`);
    }
    if (skillTraceText) {
      console.log(`    Skill trace：\n${indentBlock(skillTraceText, "    ")}`);
    }

    if (step.automation?.expect?.requireAssistant) {
      console.log(`    [cooldown] 等待 ${Math.round(MODEL_COOLDOWN_MS / 1000)} 秒，避免免費模型 TPM 過載`);
      await sleep(MODEL_COOLDOWN_MS);
    }

    if (!isLastStep) {
      await clickTutorialNext();
      continue;
    }

    if (!isLastScenario) {
      await clickTutorialNext();
    }
  }
}

async function bootstrapScenarioOnly(targetScenarioId: string) {
  if (targetScenarioId === "first-agent-chat") return;
  console.log(`[bootstrap] 為案例 ${targetScenarioId} 建立最小前置資源 ...`);
  await clickTutorialNext();
  await waitForCurrentStep("setup-credentials", 10000);
  await performStepAction({ id: "bootstrap-credential", behavior: "setup_groq_credential", checklistLabel: "", title: "" } as TutorialStepDefinition, realConfig);
  await clickTopTab("Chat Config");
  await performStepAction({ id: "bootstrap-load-balancer", behavior: "create_single_load_balancer", checklistLabel: "", title: "" } as TutorialStepDefinition, realConfig);
  await clickTopTab("Agents");
  await performStepAction({ id: "bootstrap-agent", behavior: "create_groq_agent", checklistLabel: "", title: "" } as TutorialStepDefinition, realConfig);
  if (targetScenarioId === "agent-browser-mcp-chat" || targetScenarioId === "chatgpt-browser-skill") {
    await clickTopTab("Chat Config");
    await performStepAction({ id: "bootstrap-mcp", behavior: "register_tutorial_agent_browser_mcp", checklistLabel: "", title: "" } as TutorialStepDefinition, realConfig);
  }
  console.log(`[bootstrap] ${targetScenarioId} 前置資源已建立。`);
}

function indentBlock(text: string, prefix: string) {
  return text
    .split(/\r?\n/)
    .map((line) => `${prefix}${line}`)
    .join("\n");
}

let realConfig: RealTutorialConfig;

async function main() {
  realConfig = await readRealTutorialConfig();
  const scenarios = await loadScenarios();

  let devProc: ManagedProcess | null = null;
  let mcpProc: ManagedProcess | null = null;

  try {
    const hadDevBefore = await isHttpReady(APP_URL);
    await runShell("fuser -k 3334/tcp 2>/dev/null || true");

    devProc = startManagedProcess("dev", ROOT, "./run.sh -dev");
    mcpProc = startManagedProcess("mcp-agent-browser", MCP_ROOT, "./run.sh -agent_browser");

    await waitForRestartedHttp(APP_URL, 120000, hadDevBefore);
    await waitForMcpServer(600000);

    await browserOpen(APP_URL);
    await waitForSelector('[data-tutorial-id="landing-start-tutorial"]', 30000);
    await clearAppStorageInBrowser();
    await reloadPage();
    await waitForSelector('[data-tutorial-id="landing-start-tutorial"]', 30000);

    await clickByTutorialId("landing-start-tutorial");

    if (REAL_TUTORIAL_ONLY) {
      await bootstrapScenarioOnly(REAL_TUTORIAL_ONLY);
      const targetIndex = scenarios.findIndex((scenario) => scenario.id === REAL_TUTORIAL_ONLY);
      if (targetIndex < 0) {
        throw new Error(`找不到指定案例：${REAL_TUTORIAL_ONLY}`);
      }
      for (let i = 0; i < targetIndex; i += 1) {
        await clickTutorialSkipCase();
        await sleep(250);
      }
      await executeScenario(scenarios[targetIndex], true);
    } else {
      for (let i = 0; i < scenarios.length; i += 1) {
        await executeScenario(scenarios[i], i === scenarios.length - 1);
      }
    }

    console.log("\n[o] 所有案例皆已完成。開始清除測試資料 ...");
    await clearAppStorageInBrowser();
    console.log("[o] 已清除本網站 localStorage 與 IndexedDB 測試資料。");
  } catch (error: any) {
    console.error(`\n[x] real tutorial 測試失敗：${String(error?.message ?? error)}`);
    try {
      const stepId = await getCurrentStepId();
      const statusText = await getPromptStatusText();
      const assistantText = await getLatestAssistantText();
      const skillTodoText = await getLatestSkillTodoText();
      const skillTraceText = await getLatestSkillTraceText();
      const logText = await getLatestLogText();
      console.error("\n[real-tutorial] browser diagnostics");
      if (stepId) console.error(`current step: ${stepId}`);
      if (statusText) console.error(`prompt status: ${statusText}`);
      if (assistantText) console.error(`latest assistant:\n${assistantText}`);
      if (skillTodoText) console.error(`latest todo:\n${skillTodoText}`);
      if (skillTraceText) console.error(`latest skill trace:\n${skillTraceText}`);
      if (logText) console.error(`latest log rows:\n${logText}`);
    } catch (diagnosticError: any) {
      console.error(`\n[real-tutorial] failed to collect browser diagnostics: ${String(diagnosticError?.message ?? diagnosticError)}`);
    }
    dumpProcessLogs(devProc);
    dumpProcessLogs(mcpProc);
    throw error;
  } finally {
    await browserClose();
    await stopManagedProcess(mcpProc);
    await stopManagedProcess(devProc);
  }
}

await main();
