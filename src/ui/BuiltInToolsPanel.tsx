import React, { useMemo, useState } from "react";
import { BuiltInToolConfig } from "../types";
import { loadUiState } from "../storage/settingsStore";
import { generateId } from "../utils/id";
import { runBuiltInScriptTool } from "../utils/runBuiltInScriptTool";
import { pickBestSavedAgentForQuestion } from "../utils/agentDirectoryTool";
import { createToolDashboardHelpers } from "../utils/toolDashboard";
import { TUTORIAL_CLOCK_TOOL_CODE } from "../onboarding/tutorialBuiltInToolTemplate";
import HelpModal from "./HelpModal";

function emptyTool(index: number): BuiltInToolConfig {
  return {
    id: generateId(),
    name: `browser_tool_${index + 1}`,
    description: "Describe what this browser-side JS tool does for the agent.",
    code: 'const joke = "冷知識：CSS 最會的不是排版，是讓人懷疑人生。";\nalert(joke);\nreturn {\n  joke,\n  source: "built-in tool"\n};',
    inputSchema: {},
    requireConfirmation: false,
    updatedAt: Date.now(),
    source: "custom"
  };
}

function stringifyAny(value: any) {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export default function BuiltInToolsPanel(props: {
  systemTools: BuiltInToolConfig[];
  tools: BuiltInToolConfig[];
  onChange: (next: BuiltInToolConfig[]) => void;
}) {
  const allTools = useMemo(() => [...props.systemTools, ...props.tools], [props.systemTools, props.tools]);
  const [selectedId, setSelectedId] = useState<string | null>(() => props.systemTools[0]?.id ?? props.tools[0]?.id ?? null);
  const [showHelp, setShowHelp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingToolId, setEditingToolId] = useState<string | null>(null);
  const [toolDraft, setToolDraft] = useState<BuiltInToolConfig | null>(null);
  const [schemaDraft, setSchemaDraft] = useState("{}");
  const [schemaError, setSchemaError] = useState<string | null>(null);
  const [testInputDraft, setTestInputDraft] = useState("{}");
  const [testError, setTestError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState("");
  const [isRunningTest, setIsRunningTest] = useState(false);
  const [isNewTool, setIsNewTool] = useState(false);

  const editingTool = useMemo(() => (toolDraft?.id === editingToolId ? toolDraft : allTools.find((tool) => tool.id === editingToolId) ?? null), [allTools, editingToolId, toolDraft]);
  const duplicateName = useMemo(() => {
    if (!toolDraft || toolDraft.source === "system") return false;
    const name = toolDraft.name.trim();
    if (!name) return false;
    return allTools.some((tool) => tool.id !== toolDraft.id && tool.name.trim() === name);
  }, [allTools, toolDraft]);
  const reservedName = useMemo(() => {
    if (!toolDraft || toolDraft.source === "system") return false;
    return props.systemTools.some((tool) => tool.name === toolDraft.name.trim());
  }, [props.systemTools, toolDraft]);

  React.useEffect(() => {
    if (selectedId && allTools.some((tool) => tool.id === selectedId)) return;
    setSelectedId(props.systemTools[0]?.id ?? props.tools[0]?.id ?? null);
  }, [allTools, props.systemTools, props.tools, selectedId]);

  function openEditor(tool: BuiltInToolConfig, nextIsNew = false) {
    setEditingToolId(tool.id);
    setToolDraft({ ...tool, inputSchema: tool.inputSchema ?? {} });
    setSchemaDraft(JSON.stringify(tool.inputSchema ?? {}, null, 2));
    setSchemaError(null);
    setTestInputDraft("{}");
    setTestError(null);
    setTestResult("");
    setIsNewTool(nextIsNew);
  }

  function closeEditor() {
    setEditingToolId(null);
    setToolDraft(null);
    setSchemaDraft("{}");
    setSchemaError(null);
    setTestInputDraft("{}");
    setTestError(null);
    setTestResult("");
    setIsNewTool(false);
  }

  function addTool() {
    const tool = emptyTool(props.tools.length);
    setSelectedId(tool.id);
    openEditor(tool, true);
  }

  function deleteTool(id: string) {
    props.onChange(props.tools.filter((tool) => tool.id !== id));
    if (selectedId === id) {
      setSelectedId(props.systemTools[0]?.id ?? props.tools.find((tool) => tool.id !== id)?.id ?? null);
    }
  }

  async function runTest() {
    if (!toolDraft) return;
    setIsRunningTest(true);
    setTestError(null);
    try {
      if (toolDraft.requireConfirmation) {
        const allowed = window.confirm(`允許執行工具「${toolDraft.displayLabel ?? toolDraft.name}」測試嗎？`);
        if (!allowed) {
          throw new Error("User blocked tool execution.");
        }
      }
      const input = JSON.parse(testInputDraft || "{}");
      const output = await runBuiltInScriptTool(toolDraft, input, {
        system: {
          get_user_profile: () => {
            const state = loadUiState();
            return {
              name: state.userName ?? "You",
              description: state.userDescription ?? "",
              hasAvatar: !!state.userAvatarUrl
            };
          },
          pick_best_agent_for_question: pickBestSavedAgentForQuestion,
          request_user_confirmation: async (message: string) => {
            const confirmed = window.confirm(String(message ?? "").trim() || "是否繼續？");
            return { confirmed };
          }
        },
        ui: {
          dashboard: createToolDashboardHelpers()
        }
      });
      setTestResult(stringifyAny(output));
    } catch (error: any) {
      setTestResult("");
      setTestError(String(error?.message ?? error));
    } finally {
      setIsRunningTest(false);
    }
  }

  function onSchemaChange(next: string) {
    setSchemaDraft(next);
    if (!toolDraft || toolDraft.source === "system") return;
    try {
      const parsed = JSON.parse(next || "{}");
      setToolDraft({ ...toolDraft, inputSchema: parsed });
      setSchemaError(null);
    } catch (error: any) {
      setSchemaError(error?.message ?? "Invalid JSON");
    }
  }

  function saveTool() {
    if (!toolDraft || toolDraft.source === "system") {
      closeEditor();
      return;
    }
    if (!toolDraft.name.trim()) {
      setError("Tool name is required.");
      return;
    }
    if (duplicateName) {
      setError("Tool name must be unique.");
      return;
    }
    if (reservedName) {
      setError("System tool names are reserved.");
      return;
    }
    if (schemaError) {
      setError(schemaError);
      return;
    }

    const nextTool: BuiltInToolConfig = {
      ...toolDraft,
      name: toolDraft.name.trim(),
      description: toolDraft.description.trim(),
      updatedAt: Date.now(),
      source: "custom"
    };

    const nextTools = isNewTool
      ? [nextTool, ...props.tools]
      : props.tools.map((tool) => (tool.id === nextTool.id ? nextTool : tool));
    props.onChange(nextTools);
    setSelectedId(nextTool.id);
    setError(null);
    closeEditor();
  }

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ fontSize: 12, opacity: 0.8, lineHeight: 1.7 }}>
          Register browser-side JavaScript tools for agents. Tool code runs in the same page context, so it can call globals
          such as <code>alert</code>, <code>window</code>, and <code>document</code>. You can also use the injected
          <code>dashboard</code> helper to create a live floating panel. Return a value if you want the model to receive
          structured tool output.
        </div>
        <button
          type="button"
          onClick={() => setShowHelp(true)}
          title="Built-in Tools 使用說明"
          aria-label="Built-in Tools 使用說明"
          style={helpBtn}
          data-tutorial-id="built-in-tools-help-button"
        >
          ?
        </button>
      </div>

      {showHelp && (
        <HelpModal title="Built-in Tools 使用說明" onClose={() => setShowHelp(false)} width="min(760px, 96vw)">
          <div style={helpText}>
            Built-in Tools 是在瀏覽器端執行的 JavaScript 工具。當 agent 決定呼叫它們時，系統會在目前頁面執行你寫的 JS，
            再把 <code>return</code> 的結果當成 tool output 帶回對話流程。
          </div>
          <div style={{ ...helpText, marginTop: 8 }}>
            使用方式：
            <br />
            1. 建立一個名稱唯一、描述清楚的工具
            <br />
            2. 如果模型需要傳參數給工具，可以定義 `Input schema (JSON)`
            <br />
            3. 撰寫 JavaScript 程式，若希望 agent 取得結構化結果，請記得 `return` 一個值
            <br />
            4. 到 `Agents` 頁面開啟該 agent 對此 built-in tool 的使用權限
          </div>
          <div style={{ ...helpText, marginTop: 8 }}>
            這些程式碼會直接跑在瀏覽器中，因此可以使用 <code>alert</code>、<code>window</code>、<code>document</code> 等全域物件。
            系統也會注入 <code>dashboard</code> helper，讓你建立可重用的浮動 dashboard。
            目前沒有 sandbox，請只使用你信任的程式碼。
          </div>
          <div style={{ ...helpText, marginTop: 8 }}>
            補充：
            <br />
            1. 如果程式沒有 `return`，工具結果通常會是 `undefined`
            <br />
            2. 如果程式 throw error，系統會把錯誤當成 tool failure 記錄並帶回對話
          </div>
          <div style={{ ...helpText, marginTop: 8 }}>
            <div style={exampleTitle}>範例：彈出視窗工具</div>
            這個工具會在頁面上直接跳出提示視窗，並把顯示的內容一併回傳給 agent。
            <br />
            Input schema：
            <pre style={exampleBlock}>{`{}`}</pre>
            JavaScript code：
            <pre style={exampleBlock}>{`const joke = "冷知識：CSS 最會的不是排版，是讓人懷疑人生。";
alert(joke);
return {
  joke,
  source: "built-in tool"
};`}</pre>
          </div>
          <hr style={divider} />
          <div style={{ ...helpText, marginTop: 8 }}>
            <div style={exampleTitle}>範例：取得目前時間</div>
            這個工具會讀取目前瀏覽器時間與時區，適合回答現在幾點、目前時區等問題。
            <br />
            Input schema：
            <pre style={exampleBlock}>{`{}`}</pre>
            JavaScript code：
            <pre style={exampleBlock}>{`const now = new Date().toISOString();
return {
  now,
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
};`}</pre>
          </div>
          <hr style={divider} />
          <div style={{ ...helpText, marginTop: 8 }}>
            <div style={exampleTitle}>範例：浮動時鐘 dashboard</div>
            這個工具會在頁面右下角開一個可持續更新的時鐘，適合做 dashboard 類工具。
            <br />
            Input schema：
            <pre style={exampleBlock}>{`{}`}</pre>
            JavaScript code：
            <pre style={exampleBlock}>{TUTORIAL_CLOCK_TOOL_CODE}</pre>
          </div>
          <hr style={divider} />
          <div style={{ ...helpText, marginTop: 8 }}>
            <div style={exampleTitle}>範例：幫使用者做簡單數學</div>
            例如工具描述可以寫成「幫助使用者計算兩個數字相加」，
            並讓模型傳入 <code>{`{"a":1,"b":1}`}</code> 這類 input。
            <br />
            Input schema：
            <pre style={exampleBlock}>{`{
  "type": "object",
  "properties": {
    "a": { "type": "number", "description": "第一個數字" },
    "b": { "type": "number", "description": "第二個數字" }
  },
  "required": ["a", "b"]
}`}</pre>
            JavaScript code：
            <pre style={exampleBlock}>{`const a = Number(input?.a ?? 0);
const b = Number(input?.b ?? 0);

if (!Number.isFinite(a) || !Number.isFinite(b)) {
  throw new Error("Input must contain numeric a and b.");
}

return {
  a,
  b,
  result: a + b
};`}</pre>
          </div>
          <hr style={divider} />
          <div style={{ ...helpText, marginTop: 8 }}>
            <div style={exampleTitle}>範例：呼叫已儲存的 AI provider endpoint</div>
            這種做法適合你想把任何一個已儲存 agent 當成工具來呼叫。
            例如工具描述可以寫成「依照需求使用指定 agent 回答問題」。
            下例會根據 <code>input.agentName</code> 找到對應的 agent，再使用 <code>input.prompt</code>
            當成要送給該 agent 的使用者問題。
            <br />
            Input schema：
            <pre style={exampleBlock}>{`{
  "type": "object",
  "properties": {
    "agentName": { "type": "string", "description": "要使用的已儲存 agent 名稱" },
    "prompt": { "type": "string", "description": "要交給該 agent 回答的問題" }
  },
  "required": ["agentName", "prompt"]
}`}</pre>
            JavaScript code：
            <pre style={exampleBlock}>{`const agents = JSON.parse(localStorage.getItem("agr_agents_v1") || "[]");
const credentials = JSON.parse(localStorage.getItem("agr_model_credentials_v1") || "[]");
const loadBalancers = JSON.parse(localStorage.getItem("agr_load_balancers_v1") || "[]");
const agentName = String(input?.agentName ?? "").trim();
const prompt = String(input?.prompt ?? "").trim();

if (!agentName) {
  throw new Error("Input must include agentName.");
}

if (!prompt) {
  throw new Error("Input must include prompt.");
}

const agent = agents.find((item) => item.name === agentName);

if (!agent) {
  throw new Error(\`Agent \${agentName} not found.\`);
}

const loadBalancer = loadBalancers.find((item) => item.id === agent.loadBalancerId);
const instance = loadBalancer?.instances?.[0];
const credential = credentials.find((item) => item.id === instance?.credentialId);
const key = credential?.keys?.find((item) => item.id === instance?.credentialKeyId) || credential?.keys?.[0];
const endpoint = String(credential?.endpoint || "").replace(/\\/$/, "");
const model = String(instance?.model || "").trim();

if (!endpoint || !key?.apiKey || !model) {
  throw new Error(\`Load balancer for \${agentName} is not ready.\`);
}

const response = await fetch(\`\${endpoint}/chat/completions\`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: \`Bearer \${key.apiKey}\`
  },
  body: JSON.stringify({
    model,
    messages: [{ role: "user", content: prompt }]
  })
});

if (!response.ok) {
  throw new Error(\`Provider request failed: \${response.status}\`);
}

const json = await response.json();
return {
  text: json.choices?.[0]?.message?.content ?? "",
  agent: agentName,
  model
};`}</pre>
          </div>
          <hr style={divider} />
          <div style={{ ...helpText, marginTop: 8 }}>
            <div style={exampleTitle}>範例：自動選擇適合的 Agent 來回覆問題</div>
            這個工具會先呼叫內建 helper <code>system.pick_best_agent_for_question</code>，
            從已儲存的 agent 清單中挑出最適合處理問題的 agent，然後再代替使用者呼叫該 agent。
            <br />
            Input schema：
            <pre style={exampleBlock}>{`{
  "type": "object",
  "properties": {
    "question": { "type": "string", "description": "使用者原始問題" }
  },
  "required": ["question"]
}`}</pre>
            JavaScript code：
            <pre style={exampleBlock}>{`const agents = JSON.parse(localStorage.getItem("agr_agents_v1") || "[]");
const credentials = JSON.parse(localStorage.getItem("agr_model_credentials_v1") || "[]");
const loadBalancers = JSON.parse(localStorage.getItem("agr_load_balancers_v1") || "[]");
const question = String(input?.question ?? "").trim();

if (!question) {
  throw new Error("Input must include question.");
}

const agentName = await system.pick_best_agent_for_question(question);
const agent = agents.find((item) => item.name === agentName);

if (!agent) {
  throw new Error(\`Agent \${agentName} not found.\`);
}

const loadBalancer = loadBalancers.find((item) => item.id === agent.loadBalancerId);
const instance = loadBalancer?.instances?.[0];
const credential = credentials.find((item) => item.id === instance?.credentialId);
const key = credential?.keys?.find((item) => item.id === instance?.credentialKeyId) || credential?.keys?.[0];
const endpoint = String(credential?.endpoint || "").replace(/\\/$/, "");
const model = String(instance?.model || "").trim();

if (!endpoint || !key?.apiKey || !model) {
  throw new Error(\`Load balancer for \${agentName} is not ready.\`);
}

const response = await fetch(\`\${endpoint}/chat/completions\`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: \`Bearer \${key.apiKey}\`
  },
  body: JSON.stringify({
    model,
    messages: [{ role: "user", content: question }]
  })
});

if (!response.ok) {
  throw new Error(\`Provider request failed: \${response.status}\`);
}

const json = await response.json();
return {
  selectedAgent: agentName,
  answer: json.choices?.[0]?.message?.content ?? ""
};`}</pre>
          </div>
        </HelpModal>
      )}

      <div style={{ display: "grid", gap: 8 }}>
        <div style={{ fontWeight: 800 }}>系統工具</div>
        {props.systemTools.map((tool) => {
          const active = tool.id === selectedId;
          return (
            <div
              key={tool.id}
              style={{
                padding: 12,
                borderRadius: 14,
                border: active ? "1px solid var(--primary)" : "1px solid var(--border)",
                background: active ? "rgba(91, 123, 255, 0.12)" : "var(--bg-2)",
                color: "var(--text)"
              }}
            >
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <button
                  type="button"
                  onClick={() => setSelectedId(tool.id)}
                  style={rowButtonStyle}
                >
                  <div style={{ fontWeight: 700 }}>{tool.displayLabel ?? tool.name}</div>
                  <div style={{ fontSize: 12, opacity: 0.74, marginTop: 4 }}>{tool.description}</div>
                </button>
                {active ? (
                  <div style={{ display: "flex", gap: 8, marginLeft: "auto" }}>
                    <button type="button" onClick={() => openEditor(tool)} style={btnSmall}>
                      Edit
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ fontWeight: 800 }}>使用者自訂工具</div>
        <button type="button" onClick={addTool} style={btnSmall} data-tutorial-id="built-in-tools-add-button">
          + Add JS Tool
        </button>
      </div>

      <div style={{ display: "grid", gap: 8 }}>
        {props.tools.length === 0 ? <div style={{ fontSize: 12, opacity: 0.7 }}>No built-in JS tools yet.</div> : null}
        {props.tools.map((tool) => {
          const active = tool.id === selectedId;
          return (
            <div
              key={tool.id}
              style={{
                padding: 12,
                borderRadius: 14,
                border: active ? "1px solid var(--primary)" : "1px solid var(--border)",
                background: active ? "rgba(91, 123, 255, 0.12)" : "var(--bg-2)",
                color: "var(--text)"
              }}
            >
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <button
                  type="button"
                  onClick={() => setSelectedId(tool.id)}
                  style={rowButtonStyle}
                >
                  <div style={{ fontWeight: 700 }}>{tool.name}</div>
                  <div style={{ fontSize: 12, opacity: 0.74, marginTop: 4 }}>{tool.description || "No description yet."}</div>
                </button>
                {active ? (
                  <div style={{ display: "flex", gap: 8, marginLeft: "auto", flexWrap: "wrap" }}>
                    <button type="button" onClick={() => openEditor(tool)} style={btnSmall}>
                      Edit
                    </button>
                    <button type="button" onClick={() => deleteTool(tool.id)} style={btnDangerSmall}>
                      Delete
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      {error ? <div style={errorText}>{error}</div> : null}

      {editingTool ? (
        <HelpModal
          title={`${editingTool.source === "system" ? "View Tool" : "Edit Tool"}: ${editingTool.displayLabel ?? editingTool.name}`}
          onClose={closeEditor}
          width="min(860px, calc(100vw - 48px))"
          footer={null}
        >
          <div style={{ display: "grid", gap: 12 }} data-tutorial-id="built-in-tools-modal">
            <div>
              <label style={label}>Tool name</label>
              <input
                value={toolDraft?.name ?? ""}
                onChange={(e) => toolDraft && setToolDraft({ ...toolDraft, name: e.target.value })}
                style={inp}
                disabled={editingTool.source === "system"}
                data-tutorial-id="built-in-tool-name-input"
              />
              {duplicateName ? <div style={errorText}>Tool name must be unique.</div> : null}
              {reservedName ? <div style={errorText}>System tool names are reserved.</div> : null}
            </div>

            <div>
              <label style={label}>Description</label>
              <textarea
                value={toolDraft?.description ?? ""}
                onChange={(e) => toolDraft && setToolDraft({ ...toolDraft, description: e.target.value })}
                rows={3}
                style={{ ...inp, fontFamily: "inherit" }}
                disabled={editingTool.source === "system"}
                data-tutorial-id="built-in-tool-description-input"
              />
            </div>

            <label style={{ ...checkRow, marginTop: -2 }}>
              <input
                type="checkbox"
                checked={!!toolDraft?.requireConfirmation}
                onChange={(e) => toolDraft && setToolDraft({ ...toolDraft, requireConfirmation: e.target.checked })}
                disabled={editingTool.source === "system"}
              />
              <span>使用工具前需使用者確認</span>
            </label>

            <div>
              <label style={label}>Input schema (JSON)</label>
              <textarea
                value={schemaDraft}
                onChange={(e) => onSchemaChange(e.target.value)}
                rows={6}
                style={{ ...inp, fontFamily: 'Consolas, "SFMono-Regular", monospace' }}
                disabled={editingTool.source === "system"}
                data-tutorial-id="built-in-tool-schema-input"
              />
              {schemaError ? <div style={errorText}>{schemaError}</div> : null}
            </div>

            <div>
              <label style={label}>JavaScript code</label>
              <textarea
                value={toolDraft?.code ?? ""}
                onChange={(e) => toolDraft && setToolDraft({ ...toolDraft, code: e.target.value })}
                rows={12}
                style={{ ...inp, fontFamily: 'Consolas, "SFMono-Regular", monospace' }}
                disabled={editingTool.source === "system"}
                data-tutorial-id="built-in-tool-code-input"
              />
            </div>

            {editingTool.source !== "system" ? (
              <div className="card" style={{ padding: 12, display: "grid", gap: 10, background: "rgba(255,255,255,0.02)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <div style={{ fontWeight: 700 }}>Test Runner</div>
                  <button type="button" onClick={runTest} style={btnSmall} disabled={isRunningTest || !toolDraft}>
                    {isRunningTest ? "Testing..." : "Test Tool"}
                  </button>
                </div>
                <div>
                  <label style={label}>Test input (JSON)</label>
                  <textarea
                    value={testInputDraft}
                    onChange={(e) => {
                      setTestInputDraft(e.target.value);
                      setTestError(null);
                    }}
                    rows={4}
                    style={{ ...inp, fontFamily: 'Consolas, "SFMono-Regular", monospace' }}
                  />
                </div>
                {testError ? <div style={errorText}>Test failed: {testError}</div> : null}
                {testResult ? (
                  <div>
                    <label style={label}>Test result</label>
                    <pre style={outputBlock}>{testResult}</pre>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 14 }}>
            <button type="button" onClick={closeEditor} style={btnSmall}>
              Close
            </button>
            {editingTool.source !== "system" ? (
              <button type="button" onClick={saveTool} style={btnPrimary} data-tutorial-id="built-in-tool-save-button">
                Save
              </button>
            ) : null}
          </div>
        </HelpModal>
      ) : null}
    </div>
  );
}

const rowButtonStyle: React.CSSProperties = {
  flex: 1,
  textAlign: "left",
  background: "transparent",
  border: "none",
  color: "inherit",
  padding: 0,
  cursor: "pointer"
};

const label: React.CSSProperties = { fontSize: 12, opacity: 0.8 };

const checkRow: React.CSSProperties = {
  display: "flex",
  gap: 8,
  alignItems: "center",
  fontSize: 13
};

const inp: React.CSSProperties = {
  width: "100%",
  marginTop: 6,
  padding: "8px 10px",
  borderRadius: 12,
  border: "1px solid var(--border)",
  background: "var(--bg-2)",
  color: "var(--text)",
  boxSizing: "border-box"
};

const btnSmall: React.CSSProperties = {
  padding: "8px 12px",
  borderRadius: 12,
  border: "1px solid var(--border)",
  background: "var(--panel-2)",
  color: "var(--text)"
};

const btnPrimary: React.CSSProperties = {
  ...btnSmall,
  border: "1px solid rgba(91,123,255,0.45)",
  background: "rgba(91,123,255,0.14)"
};

const btnDangerSmall: React.CSSProperties = {
  ...btnSmall,
  border: "1px solid #4a2026",
  background: "#1d1014"
};

const errorText: React.CSSProperties = {
  fontSize: 12,
  color: "#ffb3b3",
  marginTop: 6,
  lineHeight: 1.5
};

const helpBtn: React.CSSProperties = {
  width: 32,
  height: 32,
  borderRadius: 999,
  border: "1px solid rgba(91, 123, 255, 0.45)",
  background: "rgba(91, 123, 255, 0.14)",
  color: "var(--text)",
  fontWeight: 800,
  cursor: "pointer"
};

const divider: React.CSSProperties = {
  border: "none",
  borderTop: "1px solid rgba(255,255,255,0.12)",
  margin: "12px 0"
};

const exampleTitle: React.CSSProperties = {
  fontSize: 17,
  fontWeight: 800,
  marginBottom: 6
};

const helpText: React.CSSProperties = {
  fontSize: 13,
  opacity: 0.88,
  lineHeight: 1.75
};

const exampleBlock: React.CSSProperties = {
  margin: "8px 0 0",
  whiteSpace: "pre-wrap",
  padding: 12,
  borderRadius: 12,
  border: "1px solid var(--border)",
  background: "var(--bg-2)",
  fontFamily: 'Consolas, "SFMono-Regular", monospace',
  fontSize: 12,
  lineHeight: 1.6
};

const outputBlock: React.CSSProperties = {
  margin: "6px 0 0",
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  padding: 12,
  borderRadius: 12,
  border: "1px solid var(--border)",
  background: "var(--bg-2)",
  fontFamily: 'Consolas, "SFMono-Regular", monospace',
  fontSize: 12,
  lineHeight: 1.6
};
