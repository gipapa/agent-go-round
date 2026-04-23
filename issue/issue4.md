# Issue 4 — `mcp-test/server.js` 缺輸入驗證，會 crash

## 嚴重度
High（測試 server，但會誤導開發體驗）

## 觀察到的問題
測試用的 MCP server `mcp-test/server.js` 對 `/mcp/rpc` 的 POST body 完全沒做驗證：

```js
app.post("/mcp/rpc", (req, res) => {
  const { id, method, params } = req.body;
  // ...
  if (method === "tools/call") {
    const { name, input } = params || {};
    // ...
  }
  res.json({ id, error: "Unknown method" });
});
```

具體缺漏：

1. `req.body` 可能是 `undefined`（沒 Content-Type 或非 JSON），會在解構時拋 `TypeError`
2. `id` 可能不是 string，但 client 端假設一定是 string
3. `method` 缺失時走到最後 `res.json({ id, error: "Unknown method" })`，但 `id` 會是 `undefined`，造成 client 收不到對應 response 而 timeout
4. `tools/call` 的 `name` 缺失或非 string 時，會走到「Unknown tool」分支，但沒檢查型別
5. 沒有任何 try/catch wrapper，express 預設 error handler 會把 stack trace 丟出去
6. `params.input` 假設 input 是 object，但 model 偶爾會丟 string；`input?.text` 在 string 上是 `undefined`，回傳「空 echo」會誤導 debug

## 來源檔案
- `mcp-test/server.js`（整檔，特別是行 60-100 的 `/mcp/rpc` handler）

## 建議做法

### 加 schema validation
最小可行：

```js
app.post("/mcp/rpc", (req, res) => {
  const body = req.body;
  if (!body || typeof body !== "object") {
    return res.status(400).json({ error: "body must be JSON object" });
  }
  const { id, method, params } = body;
  if (typeof id !== "string" || !id) {
    return res.status(400).json({ error: "id must be non-empty string" });
  }
  if (typeof method !== "string" || !method) {
    return res.status(400).json({ id, error: "method must be non-empty string" });
  }

  try {
    if (method === "tools/list") {
      return res.json({ id, result: { tools } });
    }
    if (method === "tools/call") {
      const name = typeof params?.name === "string" ? params.name : null;
      const input = params?.input ?? {};
      if (!name) {
        return res.json({ id, error: "params.name required" });
      }
      // ... 既有 echo / time 邏輯
    }
    return res.json({ id, error: `Unknown method: ${method}` });
  } catch (err) {
    return res.status(500).json({ id, error: String(err?.message ?? err) });
  }
});
```

### 加 global error handler
```js
app.use((err, req, res, next) => {
  console.error("[mcp-test] unhandled error:", err);
  res.status(500).json({ error: String(err?.message ?? err) });
});
```

### 進階建議
- 引入 Zod 或 Ajv 做 JSON schema 驗證，與 `tools[i].inputSchema` 對齊
- SSE handler `/mcp/sse` 對 `req.on("error")` 加 listener，避免 client 異常斷線時 crash
- 加上 request log（`method`、`id`、耗時），方便 debug

## 影響
- 測試 server 偶發 crash，會讓開發者誤判是 client 端 bug
- malformed request 沒回應，會把 client 卡到 timeout（30s），開發效率差
