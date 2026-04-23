# Issue 2 — MCP Client 無連線池，每次工具呼叫都新建 SSE 連線

## 嚴重度
Critical（效能 / 體驗）

## 觀察到的問題
每次需要列工具或呼叫工具時，程式碼都 `new McpSseClient(server)`、連線、執行、然後 `client.close()`。雖然有正確關閉（不是洩漏），但缺乏 **client 連線池 / 重用機制**：

- 每次操作都重跑一次 SSE handshake、heartbeat、connect timeout 等流程
- 一個 server 短時間內被多次呼叫（例如多 agent 同時執行）會打開多條 SSE 連線
- `McpSseClient` 內建的 heartbeat / health check 機制完全沒被善用（連線太短命）
- `ensureMcpToolsLoadedForServers()` 對每台 server 各開一個 client，雖然有快取 `mcpToolsByServer`，但快取 miss 後沒有保留連線

涉及到的呼叫點：
- `src/app/App.tsx:3622` — `ensureMcpToolsLoadedForServers()` 中 `new McpSseClient(server)`
- `src/app/App.tsx:4864` — `executeResolvedToolSelection()` 中 `new McpSseClient(targetServer)`
- `src/ui/McpPanel.tsx:129` — 測試連線時 `new McpSseClient(serverDraft)`
- `src/ui/McpPanel.tsx:171` — 列工具時 `new McpSseClient(serverDraft)`

## 來源檔案
- `src/mcp/sseClient.ts`
- `src/app/App.tsx`（行 3622、4864）
- `src/ui/McpPanel.tsx`（行 129、171）

## 建議做法

### 方案 A：建立 MCP client manager（推薦）
新增 `src/mcp/clientManager.ts`：

```ts
class McpClientManager {
  private clients = new Map<string, McpSseClient>();
  private idleTimers = new Map<string, number>();

  get(server: McpServerConfig): McpSseClient {
    const key = server.id;
    let client = this.clients.get(key);
    if (!client) {
      client = new McpSseClient(server);
      client.connect(...);
      this.clients.set(key, client);
    }
    this.scheduleIdleClose(key);
    return client;
  }

  private scheduleIdleClose(key: string) { /* 60s idle 後 close */ }

  closeAll() { /* unmount 時清空 */ }
}
```

然後把 `App.tsx` 與 `McpPanel.tsx` 內的所有 `new McpSseClient(...)` 改成走 manager。

### 方案 B：最小改動
- 在 `useEffect` 啟動時為每個 active server 預連線一次
- 用一個 `Map<serverId, McpSseClient>` 暫存
- App unmount 時統一 close

### 額外建議
- `McpPanel.tsx` 的「測試連線」按鈕本來就應該開新連線（即時健康檢查），不需要走 pool
- 工具呼叫路徑（`executeResolvedToolSelection`）才是最值得 pooling 的地方

## 影響
- 工具呼叫延遲（每次都要重做 SSE handshake）
- 後端 MCP server 接到大量短命連線，log noise
- 影響 multi-agent 場景的吞吐量
