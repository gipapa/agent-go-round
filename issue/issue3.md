# Issue 3 — MCP `serverId` 解析的 fallback 不嚴謹

## 嚴重度
High

## 觀察到的問題
`normalizeToolDecisionAgainstAvailableTools()`（`src/app/App.tsx:281`）中的 `resolveMcpServerId` 邏輯如下：

1. 先用 `decision.serverId` 去 `availableMcpServers` 找 exact match（id 或 name）
2. 找不到就 lowercase 做 fuzzy match
3. 還找不到就看「有沒有恰好只有一台 server 有這個 tool」，有就用那台
4. **以上全部失敗時，直接回傳原始的 `decision.serverId`**（很可能是個無效的字串）

問題：

- 第 4 步把 model 隨便給的字串原封不動傳下去，後續 `executeResolvedToolSelection()` 拿這個假 id 去找 server 找不到，路徑會走到「Tool decision selected unavailable tool」的錯誤處理，浪費一輪呼叫
- 多 server 都暴露同名 tool 的情況（例如兩台 server 都有 `browser_open`），如果 model 給錯 serverId，會直接 fallthrough，但無 telemetry / log 提示問題出在 routing
- `resolveMcpServerId(toolName, preferredServerId)` 在 `src/app/App.tsx:5066`（skill executor 內）有另一份「相似但不同」的實作，邏輯會分歧

對照另一處實作差異：
- `App.tsx:281` 版本：`normalize` 內的 fuzzy / fallback 邏輯
- `App.tsx:5066` 版本：純粹按 `preferredServerId` 優先，否則拿第一個 match

## 來源檔案
- `src/app/App.tsx:281-340`（`normalizeToolDecisionAgainstAvailableTools` / `resolveMcpServerId`）
- `src/app/App.tsx:5066-5076`（skill executor 內另一個 `resolveMcpServerId`）
- `src/app/App.tsx:1347`（`resolveMcpServerId` 介面定義在 `executeResolvedToolSelection` 的 args）

## 建議做法

### 1. 統一 server resolution 邏輯
把兩處 `resolveMcpServerId` 抽成 `src/mcp/serverResolver.ts`：

```ts
export function resolveMcpServerId(args: {
  requestedServerId?: string | null;
  toolName: string;
  availableMcpTools: Array<{ server: McpServerConfig; tools: McpTool[] }>;
}): { serverId: string; matchedBy: "exact-id" | "exact-name" | "fuzzy" | "single-tool-match" } | { serverId: null; reason: "ambiguous" | "no-match" }
```

回傳結構化結果，方便 caller 寫對應的錯誤訊息或 log。

### 2. 不再回傳「原始無效字串」
第 4 步應該回傳 `null` + 原因，由 caller 決定：
- 把錯誤訊息加進 assistant message（讓 model 自我修正）
- 寫 log，標 `stage: "mcp_routing_fallback"`

### 3. 多 match 時加警告
如果 `matchingServers.length > 1` 且沒有給 `serverId`，目前直接放棄；應該至少 log 出「同一個 tool 有 N 台 server 有，但模型沒指定 serverId」並選 default。

### 4. 補 unit test
針對 `resolveMcpServerId` 的下列 case 補測：
- exact id match
- exact name match
- fuzzy（大小寫）match
- 單一 server 有此 tool（無 serverId）
- 多 server 有此 tool（無 serverId）
- model 給垃圾 serverId

## 影響
- 多 server 場景下工具會被丟去錯的 server，回應失敗，浪費 token
- 同樣的邏輯在兩處實作不同，未來 refactor 容易漏改
