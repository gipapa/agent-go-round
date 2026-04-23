# Issue 9 — 測試覆蓋率嚴重不足

## 嚴重度
Medium（但會放大其他 issue 的修復風險）

## 觀察到的問題
`src/__tests__/` 目前只有 6 個測試檔：

- `app.test.tsx`
- `magi.test.ts`
- `mcpSseClient.test.ts`
- `radioRuntime.test.ts`
- `skillState.test.ts`
- `tutorialRuntime.test.ts`

對應到 `src/` 內接近 60 個檔案，**整體覆蓋率粗估 < 10%**。最關鍵的程式碼幾乎沒測：

### 完全沒測或測極少的關鍵模組
- `src/app/App.tsx`（8000+ 行 orchestration 邏輯）
- `src/adapters/openaiCompat.ts`、`custom.ts`、`chromePrompt.ts`、`base.ts`
- `src/orchestrators/oneToOne.ts`、`leaderTeam.ts`
- `src/utils/loadBalancer.ts`、`loadBalancerDiagnostics.ts`、`agentFailure.ts`
- `src/utils/runBuiltInScriptTool.ts`（動態執行 user code，最危險、最該測）
- `src/runtime/skillRuntime.ts`、`skillExecutor.ts`、`skillPlanner.ts`、`skillReferenceResolver.ts`
- `src/storage/*`（任何 schema 變動都會炸）
- `src/mcp/toolRegistry.ts`、`src/mcp/serverResolver`（若依 issue 3 抽出）
- 所有 normalize 函式（issue 5）：`normalizeToolDecision`、`normalizeSkillDecision`、`normalizeSkillStepDecision`、`normalizeSkillVerifyDecision`、`normalizeSkillBootstrapPlan`、`normalizeSkillCompletionDecision`...

### `vitest.config.ts` 也偏陽春
- 沒設 coverage reporter
- 沒設 `globals` / `environment` 統一規範
- 沒 watch / CI 模式分流

### 缺少的測試類型
- **沒有 component test**：`@testing-library/react` 沒裝（檢查 package.json）
- **沒有 integration test**：load balancer failover、tool decision 全鏈路
- **沒有 contract test**：對 MCP server 的 SSE / RPC 行為沒有 fake server 測試
- **沒有 storage migration test**

## 來源檔案
- `src/__tests__/`（6 個檔）
- `vitest.config.ts`
- `package.json`（缺 testing libs）

## 建議做法

### 1. 補齊測試工具
```bash
npm i -D @testing-library/react @testing-library/user-event @testing-library/jest-dom @vitest/coverage-v8 happy-dom
```

`vitest.config.ts`：
```ts
export default defineConfig({
  test: {
    environment: "happy-dom",
    setupFiles: ["./src/__tests__/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.d.ts", "src/__tests__/**", "src/main.tsx"]
    }
  }
});
```

### 2. 最該優先補的測試（按 ROI 排序）
1. **所有 normalize 函式**（搭配 issue 5 抽到 `src/utils/decisions.ts` 之後）
2. **`extractJsonObject` 邊界 case**（issue 5）
3. **`resolveMcpServerId`**（issue 3）
4. **`loadBalancer.ts`** failover / 輪替策略
5. **`runBuiltInScriptTool` 安全性**：禁止存取的 globals、timeout、回傳 shape
6. **storage round-trip**：每個 store 寫入 → 讀出 → 反序列化一致性
7. **adapters**：mock fetch、驗證 request shape 與 response 解析

### 3. 為 App.tsx 拆解（issue 1）做準備
- 重構前先補 high-level integration test：「給定一段使用者輸入 + agent 設定，最終 chat 應該包含 X 訊息」
- 用這層測試保護重構，避免拆 component 時破壞行為

### 4. CI 加 coverage gate（漸進）
- 第一階段：跑 coverage 但不擋 PR，先建立 baseline
- 第二階段：對「新加 / 修改的檔案」要求 80%+ coverage（用 `nyc`-style diff coverage）

### 5. 加 `npm scripts`
```json
{
  "test": "vitest run",
  "test:watch": "vitest",
  "test:coverage": "vitest run --coverage",
  "test:ui": "vitest --ui"
}
```

## 影響
- 任何 issue 1-8 的修復都缺乏測試保護，refactor 風險高
- model 輸出 / MCP 回傳格式變動沒早期警示
- 新 contributor 不敢動既有程式碼
- 上線後 regression 排查困難
