可以用這個方式來提供即時渲染需求
description:
```
在前端即時渲染使用者的需求
```

Input schema (JSON):
```
{
  "type": "object",
  "properties": {
    "request": {
      "type": "string",
      "description": "你想讓 LLM 產生並執行的前端 JavaScript 工具需求"
    }
  },
  "required": [
    "request"
  ]
}
```

JavaScript code:
```
if (!dashboard) {
  throw new Error("目前環境沒有提供 dashboard helper。");
}

const request = String(input?.request ?? "").trim();

if (!request) {
  throw new Error("Input must include request.");
}

const agents = JSON.parse(localStorage.getItem("agr_agents_v1") || "[]");
const credentials = JSON.parse(localStorage.getItem("agr_model_credentials_v1") || "[]");
const loadBalancers = JSON.parse(localStorage.getItem("agr_load_balancers_v1") || "[]");

const picker =
  system?.pick_best_agent_for_question ||
  (typeof pick_best_agent_for_question === "function" ? pick_best_agent_for_question : null);

if (!picker) {
  throw new Error("目前沒有可用的 pick_best_agent_for_question helper。");
}

const selectedAgentName = await picker(
  `請選擇最適合產生瀏覽器端 JavaScript code 的 agent：${request}`
);

if (!selectedAgentName) {
  throw new Error("找不到可用的 code generation agent。");
}

const agent = agents.find((item) => item.name === selectedAgentName);

if (!agent) {
  throw new Error(`Agent ${selectedAgentName} not found.`);
}

function resolveRunnableInstance(agentConfig) {
  const lb = loadBalancers.find((item) => item.id === agentConfig.loadBalancerId);

  if (!lb) {
    throw new Error(`Agent ${agentConfig.name} has no load balancer.`);
  }

  const now = Date.now();

  for (const instance of lb.instances || []) {
    if (instance?.failure && typeof instance?.nextCheckTime === "number" && now < instance.nextCheckTime) {
      continue;
    }

    const credential = credentials.find((item) => item.id === instance.credentialId);
    if (!credential) continue;
    if (credential.preset === "chrome_prompt") continue;

    const key =
      credential.keys?.find((item) => item.id === instance.credentialKeyId) ||
      credential.keys?.find((item) => String(item?.apiKey || "").trim()) ||
      null;

    const endpoint = String(credential.endpoint || "").replace(/\/+$/, "");
    const model = String(instance.model || "").trim();

    if (!endpoint || !key?.apiKey || !model) continue;

    return { endpoint, model, key };
  }

  throw new Error(`Agent ${agentConfig.name} 的 load balancer 沒有可用 instance。`);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"]/g, (ch) => {
    return {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;"
    }[ch];
  });
}

const resolved = resolveRunnableInstance(agent);

const frame = dashboard.show({
  key: "llm-generated-tool-frame",
  title: "LLM 生成工具",
  subtitle: `由 ${selectedAgentName} 產生並執行`
});

frame.root.style.width = "min(1080px, calc(100vw - 24px))";
frame.root.style.height = "min(820px, calc(100vh - 24px))";
frame.root.style.right = "12px";
frame.root.style.bottom = "12px";

frame.body.innerHTML = `
  <style>
    .agr-llm-frame {
      display: grid;
      grid-template-rows: auto 1fr;
      gap: 14px;
      height: 100%;
      color: #f5f7ff;
    }

    .agr-llm-meta {
      display: grid;
      gap: 10px;
      padding: 14px;
      border-radius: 16px;
      border: 1px solid rgba(255,255,255,0.08);
      background: rgba(255,255,255,0.04);
    }

    .agr-llm-label {
      font-size: 12px;
      opacity: 0.7;
      letter-spacing: 0.04em;
    }

    .agr-llm-value {
      font-size: 14px;
      line-height: 1.7;
      word-break: break-word;
    }

    .agr-llm-status {
      font-size: 13px;
      color: #b9c8ff;
    }

    .agr-llm-stage {
      min-height: 0;
      height: 100%;
      border-radius: 18px;
      border: 1px solid rgba(120, 144, 255, 0.18);
      background:
        linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0.02)),
        radial-gradient(circle at top left, rgba(105, 140, 255, 0.14), transparent 35%);
      overflow: hidden;
      position: relative;
      padding: 18px;
      box-sizing: border-box;
    }

    .agr-llm-canvas {
      width: 100%;
      height: 100%;
      min-height: 480px;
      border-radius: 16px;
      border: 1px dashed rgba(255,255,255,0.12);
      position: relative;
      overflow: hidden;
      background: rgba(10, 16, 30, 0.45);
    }

    .agr-llm-placeholder {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      text-align: center;
      font-size: 14px;
      opacity: 0.55;
      pointer-events: none;
    }
  </style>

  <div class="agr-llm-frame">
    <div class="agr-llm-meta">
      <div>
        <div class="agr-llm-label">需求</div>
        <div class="agr-llm-value">${escapeHtml(request)}</div>
      </div>
      <div>
        <div class="agr-llm-label">執行狀態</div>
        <div class="agr-llm-status" data-status>正在請求 LLM 產生 JavaScript code...</div>
      </div>
    </div>

    <div class="agr-llm-stage">
      <div class="agr-llm-canvas" data-canvas>
        <div class="agr-llm-placeholder" data-placeholder>LLM 生成內容會顯示在這裡</div>
      </div>
    </div>
  </div>
`;

const statusEl = frame.body.querySelector("[data-status]");
const canvas = frame.body.querySelector("[data-canvas]");
const placeholder = frame.body.querySelector("[data-placeholder]");

if (!statusEl || !canvas || !placeholder) {
  throw new Error("LLM dashboard 初始化失敗。");
}

function setStatus(text) {
  statusEl.textContent = text;
}

const systemPrompt = `
你要產生一段可直接執行的瀏覽器端 JavaScript 程式碼。

請嚴格遵守以下規則：
1. 只輸出純 JavaScript code，不要加 Markdown code fence，不要加任何說明文字。
2. 這段 code 會被包進 async function 內執行，所以可以直接使用 await。
3. 可用變數有：input、canvas、dashboard、system、window、document。
4. 你只能把畫面渲染到 canvas 裡。
5. 一開始請先執行：canvas.innerHTML = "";
6. 你的內容必須填滿整個 canvas，不要只畫在左下角或某個小區塊。
7. 若建立根節點，根節點 style 至少要有 width:100% 與 height:100%。
8. 除非需求明確要求，否則不要再呼叫 dashboard.show 開新的面板。
9. 若有 setInterval / setTimeout，請記得註冊 cleanup。
10. 最後一定要 return 一個可序列化的結果物件。
`.trim();

const userPrompt = `
請根據以下需求產生 JavaScript code，並把內容渲染到 canvas：

${request}

再次提醒：
- 只輸出純 JS code
- 不要加 \`\`\`
- 只能操作 canvas
- 先清空 canvas
- 內容要填滿整個 canvas
- 最後一定要 return 結果物件
`.trim();

const response = await fetch(`${resolved.endpoint}/chat/completions`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${resolved.key.apiKey}`
  },
  body: JSON.stringify({
    model: resolved.model,
    temperature: 0.2,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ]
  })
});

if (!response.ok) {
  throw new Error(`Provider request failed: ${response.status}`);
}

const json = await response.json();
let generatedCode = String(json?.choices?.[0]?.message?.content ?? "").trim();

generatedCode = generatedCode
  .replace(/^```(?:javascript|js)?\s*/i, "")
  .replace(/\s*```$/i, "")
  .trim();

if (!generatedCode) {
  throw new Error("LLM 沒有回傳可執行的 JavaScript code。");
}

placeholder.textContent = "LLM 已產生 code，正在執行...";
setStatus("LLM 已產生 code，正在執行...");

const runner = new Function(
  "input",
  "system",
  "dashboard",
  "canvas",
  `
    "use strict";
    return (async () => {
      ${generatedCode}
    })();
  `
);

const result = await runner(input, system, dashboard, canvas);

placeholder.remove();
setStatus("執行完成。");

return {
  selectedAgent: selectedAgentName,
  model: resolved.model,
  generatedCode,
  result
};
```