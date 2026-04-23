# Issue 10 — `runBuiltInScriptTool` 無 timeout / 無 sandbox 隔離

## 嚴重度
Critical

## 觀察到的問題
`src/utils/runBuiltInScriptTool.ts` 用 `new Function(...)` 動態執行使用者定義的 JavaScript，但**完全沒有任何資源限制或隔離**：

```ts
export async function runBuiltInScriptTool(tool, input, helpers = {}) {
  const runner = new Function(
    "input", "helpers",
    `"use strict";
     // ... 解構 helpers ...
     return (async () => { ${tool.code} })();`
  );
  return await runner(input, helpers);
}
```

### 缺漏 1：無 timeout / 無迴圈防護
- user 寫 `while (true) {}` 會把整個 main thread 卡死，整個 app 凍住（含 UI、其他 tool、tutorial）
- 沒有 `Promise.race` + timeout，async 操作可以無限等下去
- 對一個主推「browser-first agentic playground」的專案來說，這等於**任何一個社群分享的 skill / built-in tool 都能 DoS 你**

### 缺漏 2：globals 完全暴露
`new Function` 雖然不能存取定義時的閉包變數，但**所有全域物件都可以拿**：
- `fetch`、`XMLHttpRequest` → 任意外連
- `localStorage`、`indexedDB` → 直接讀 API key（與 Issue 7 串成完整攻擊鏈）
- `navigator`、`document`、`window` → 偷 cookie、植入 script
- `WebSocket`、`Worker` → 持續通訊

`"use strict"` 只擋住隱式 global，沒擋顯式存取。

### 缺漏 3：helpers 暴露 sensitive API
目前 helpers 包含：
- `system.pick_best_agent_for_question(question)` — user code 可以列舉 agent 名稱
- `system.get_user_profile()` — 可以拿到使用者資料
- `system.request_user_confirmation(message)` — 可以彈無限多次假確認框做 phishing
- `ui.dashboard` — 暴露 UI 操作面

### 缺漏 4：無錯誤隔離
搭配 Issue 6（無 Error Boundary）：user code 拋錯會冒泡到 caller，可能炸掉整個 chat。

### 缺漏 5：無記憶體限制
user code 可以 `const arr = []; while(true) arr.push(new Array(1e6))` 撐爆 tab 記憶體。

## 來源檔案
- `src/utils/runBuiltInScriptTool.ts`（整檔）
- `src/types.ts:262, 271, 290, 301`（`BuiltInToolConfig` 型別定義）
- 相關呼叫點：`src/app/App.tsx`、`src/runtime/skillExecutor.ts` 等

## 建議做法

### Step 1：加 wall-clock timeout（必做）
```ts
export async function runBuiltInScriptTool(
  tool: Pick<BuiltInToolConfig, "code">,
  input: unknown,
  helpers: BuiltInToolHelpers = {},
  options: { timeoutMs?: number } = {}
) {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const runner = new Function(...);

  let timer: number | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = window.setTimeout(
      () => reject(new Error(`Built-in tool execution timed out after ${timeoutMs}ms`)),
      timeoutMs
    );
  });

  try {
    return await Promise.race([runner(input, helpers), timeout]);
  } finally {
    if (timer !== undefined) window.clearTimeout(timer);
  }
}
```
注意：JS 單線程下 `Promise.race` 無法中斷同步 `while(true)`。要真正中斷只能用 Worker。

### Step 2：搬到 Web Worker（強烈建議）
- 把 `new Function(code)` 移進 Worker（dynamic worker 用 Blob URL）
- 同步 infinite loop 卡住 Worker 但不影響主線程
- timeout 到了直接 `worker.terminate()`，乾淨利落
- 透過 `postMessage` 傳 input / 收 output
- helpers 透過 message protocol 代理（worker 內呼叫 `system.foo(...)` → postMessage 給主線程 → 回傳結果）

範例骨架：
```ts
// src/utils/sandbox/builtInToolWorker.ts
const workerSrc = `
  self.onmessage = async (e) => {
    const { code, input } = e.data;
    try {
      const fn = new Function("input", "helpers", \`return (async () => { \${code} })();\`);
      const helpers = createProxyHelpers(); // 透過 postMessage 代理
      const result = await fn(input, helpers);
      self.postMessage({ ok: true, result });
    } catch (err) {
      self.postMessage({ ok: false, error: String(err?.message ?? err) });
    }
  };
`;
```

### Step 3：明確的 helpers 白名單
- 在文件中明列「user code 可用 / 不可用」清單
- helpers 內每個 method 加 input validation + rate limit
- `request_user_confirmation` 加 throttle，避免 phishing spam

### Step 4：CSP 加固（可選但建議）
- 若有部署到正式網域，CSP 設 `script-src 'self'`，禁掉 `unsafe-eval`
- 但 `new Function` 需要 `unsafe-eval`，所以這個跟 Step 2 二選一（推 Step 2）

### Step 5：UI 警示
- 載入 user-defined built-in tool 時跳警告：「此工具會執行任意 JavaScript 程式碼，請確認來源可信」
- 顯示 code preview，user 確認後才啟用

## 影響
- **DoS**：任一 user-defined tool 可凍結整個 app
- **資料外洩**：搭配 Issue 7，可在 user code 內 `localStorage.getItem("agr_model_credentials_v1")` 偷光所有 API key
- **XSS-like**：user code 可操作 DOM、植入 phishing
- 是整個專案最容易被惡意 skill 利用的攻擊面
