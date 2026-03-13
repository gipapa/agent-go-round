import React, { useMemo, useState } from "react";
import { BuiltInToolConfig } from "../types";
import { generateId } from "../utils/id";
import { runBuiltInScriptTool } from "../utils/runBuiltInScriptTool";
import HelpModal from "./HelpModal";

function emptyTool(index: number): BuiltInToolConfig {
  return {
    id: generateId(),
    name: `browser_tool_${index + 1}`,
    description: "Describe what this browser-side JS tool does for the agent.",
    code: 'const joke = "冷知識：CSS 最會的不是排版，是讓人懷疑人生。";\nalert(joke);\nreturn {\n  joke,\n  source: "built-in tool"\n};',
    inputSchema: {},
    updatedAt: Date.now()
  };
}

export default function BuiltInToolsPanel(props: {
  tools: BuiltInToolConfig[];
  onChange: (next: BuiltInToolConfig[]) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(props.tools[0]?.id ?? null);
  const [schemaDraft, setSchemaDraft] = useState("{}");
  const [schemaError, setSchemaError] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [testInputDraft, setTestInputDraft] = useState("{}");
  const [testError, setTestError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<string>("");
  const [isRunningTest, setIsRunningTest] = useState(false);

  const selectedTool = useMemo(() => props.tools.find((tool) => tool.id === selectedId) ?? null, [props.tools, selectedId]);
  const duplicateName = useMemo(() => {
    if (!selectedTool) return false;
    const name = selectedTool.name.trim();
    if (!name) return false;
    return props.tools.some((tool) => tool.id !== selectedTool.id && tool.name.trim() === name);
  }, [props.tools, selectedTool]);
  const reservedName = selectedTool?.name.trim() === "get_user_profile";

  React.useEffect(() => {
    if (selectedId && props.tools.some((tool) => tool.id === selectedId)) return;
    setSelectedId(props.tools[0]?.id ?? null);
  }, [props.tools, selectedId]);

  React.useEffect(() => {
    if (!selectedTool) {
      setSchemaDraft("{}");
      setSchemaError(null);
      setTestInputDraft("{}");
      setTestError(null);
      setTestResult("");
      return;
    }
    setSchemaDraft(JSON.stringify(selectedTool.inputSchema ?? {}, null, 2));
    setSchemaError(null);
    setTestInputDraft("{}");
    setTestError(null);
    setTestResult("");
  }, [selectedTool?.id, selectedTool?.updatedAt]);

  function updateTool(id: string, patch: Partial<BuiltInToolConfig>) {
    props.onChange(
      props.tools.map((tool) =>
        tool.id === id
          ? {
              ...tool,
              ...patch,
              updatedAt: Date.now()
            }
          : tool
      )
    );
  }

  function addTool() {
    const tool = emptyTool(props.tools.length);
    props.onChange([tool, ...props.tools]);
    setSelectedId(tool.id);
  }

  function deleteTool(id: string) {
    props.onChange(props.tools.filter((tool) => tool.id !== id));
  }

  async function runTest() {
    if (!selectedTool) return;
    setIsRunningTest(true);
    setTestError(null);
    try {
      const input = JSON.parse(testInputDraft || "{}");
      const output = await runBuiltInScriptTool(selectedTool, input);
      setTestResult(typeof output === "string" ? output : JSON.stringify(output, null, 2));
    } catch (error: any) {
      setTestResult("");
      setTestError(String(error?.message ?? error));
    } finally {
      setIsRunningTest(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button type="button" onClick={() => setShowHelp(true)} title="Built-in Tools 使用說明" aria-label="Built-in Tools 使用說明" style={helpBtn}>
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
            範例：
            <pre style={exampleBlock}>{`const joke = "冷知識：CSS 最會的不是排版，是讓人懷疑人生。";
alert(joke);
return {
  joke,
  source: "built-in tool"
};`}</pre>
          </div>
        </HelpModal>
      )}

      <div style={{ fontSize: 12, opacity: 0.8, lineHeight: 1.7 }}>
        Register browser-side JavaScript tools for agents. Tool code runs in the same page context, so it can call globals
        such as <code>alert</code>, <code>window</code>, and <code>document</code>. Return a value if you want the model to
        receive structured tool output.
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ fontWeight: 800 }}>Registered Tools</div>
        <button type="button" onClick={addTool} style={btnSmall}>
          + Add JS Tool
        </button>
      </div>

      <div style={{ display: "grid", gap: 8 }}>
        {props.tools.length === 0 ? <div style={{ fontSize: 12, opacity: 0.7 }}>No built-in JS tools yet.</div> : null}
        {props.tools.map((tool) => {
          const active = tool.id === selectedId;
          return (
            <button
              key={tool.id}
              type="button"
              onClick={() => setSelectedId(tool.id)}
              style={{
                textAlign: "left",
                padding: 12,
                borderRadius: 14,
                border: active ? "1px solid var(--primary)" : "1px solid var(--border)",
                background: active ? "rgba(91, 123, 255, 0.12)" : "var(--bg-2)",
                color: "var(--text)",
                cursor: "pointer"
              }}
            >
              <div style={{ fontWeight: 700 }}>{tool.name}</div>
              <div style={{ fontSize: 12, opacity: 0.74, marginTop: 4 }}>{tool.description || "No description yet."}</div>
            </button>
          );
        })}
      </div>

      {selectedTool ? (
        <div className="card" style={{ padding: 14, display: "grid", gap: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ fontWeight: 800 }}>Tool Editor</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="button" onClick={runTest} style={btnSmall} disabled={isRunningTest}>
                {isRunningTest ? "Testing..." : "Test Tool"}
              </button>
              <button type="button" onClick={() => deleteTool(selectedTool.id)} style={btnDangerSmall}>
                Delete Tool
              </button>
            </div>
          </div>

          <div>
            <label style={label}>Tool name</label>
            <input value={selectedTool.name} onChange={(e) => updateTool(selectedTool.id, { name: e.target.value })} style={inp} />
            {duplicateName ? <div style={errorText}>Tool name must be unique.</div> : null}
            {reservedName ? <div style={errorText}>`get_user_profile` is reserved for the built-in profile tool.</div> : null}
          </div>

          <div>
            <label style={label}>Description</label>
            <textarea
              value={selectedTool.description}
              onChange={(e) => updateTool(selectedTool.id, { description: e.target.value })}
              rows={3}
              style={{ ...inp, fontFamily: "inherit" }}
            />
          </div>

          <div>
            <label style={label}>Input schema (JSON)</label>
            <textarea
              value={schemaDraft}
              onChange={(e) => {
                const next = e.target.value;
                setSchemaDraft(next);
                try {
                  const parsed = JSON.parse(next || "{}");
                  updateTool(selectedTool.id, { inputSchema: parsed });
                  setSchemaError(null);
                } catch (error: any) {
                  setSchemaError(error?.message ?? "Invalid JSON");
                }
              }}
              rows={6}
              style={{ ...inp, fontFamily: 'Consolas, "SFMono-Regular", monospace' }}
            />
            {schemaError ? <div style={errorText}>{schemaError}</div> : null}
          </div>

          <div>
            <label style={label}>JavaScript code</label>
            <textarea
              value={selectedTool.code}
              onChange={(e) => updateTool(selectedTool.id, { code: e.target.value })}
              rows={12}
              style={{ ...inp, fontFamily: 'Consolas, "SFMono-Regular", monospace' }}
            />
          </div>

          <div className="card" style={{ padding: 12, display: "grid", gap: 10, background: "rgba(255,255,255,0.02)" }}>
            <div style={{ fontWeight: 700 }}>Test Runner</div>
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
        </div>
      ) : null}
    </div>
  );
}

const label: React.CSSProperties = { fontSize: 12, opacity: 0.8 };

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
