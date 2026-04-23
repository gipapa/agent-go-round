# Issue 8 — 散落各處的 `any` 型別，破壞型別安全

## 嚴重度
Medium

## 觀察到的問題
專案 `tsconfig` 已開 strict，但程式碼中仍大量使用 `any`、`as any`，主要集中在：

### 核心型別定義
- `src/types.ts:262, 271, 290, 301, 339` — `inputSchema?: any`、`input?: any`
  - 這是 MCP / built-in tool 的 schema 與 input，是整個系統最頻繁被傳遞的物件
  - 應改為 `Record<string, unknown>` 或 Zod schema

### Adapters
- `src/adapters/openaiCompat.ts:26, 37, 63` — `catch (e: any)`、`const messages: any[] = []`
- `src/adapters/custom.ts:8, 12, 16, 19` — `function getByPath(obj: any, ...)`、`let cur: any = obj`
- `src/adapters/chromePrompt.ts:5` — `ai?: any`（Chrome built-in AI）

### MCP 層
- `src/mcp/sseClient.ts:4, 5, 205, 243, 253` — RPC req/res 全是 `any`
- `src/mcp/toolRegistry.ts:10` — `callTool(client, name, input: any)`

### Orchestrators / App
- `src/app/App.tsx` — `extractJsonObject(text): any | null`、所有 `normalizeXxxDecision(obj: any)`
- `src/orchestrators/leaderTeam.ts:48, 62, 83, 95, 99` — `normalizeAction(obj: any)`、`normalizeVerify(obj: any)`、`normalizePlan(obj: any)`
- `src/orchestrators/magi.ts:162` — `catch (error: any)`

### Onboarding / utils
- `src/onboarding/catalogCore.ts:8, 61, 85` — `normalizeAutomation(input: any)`、`normalizeStep(input: any)`、`normalizeScenario(input: any)`
- `src/onboarding/catalog.ts:20` — `catch (error: any)`
- `src/utils/runBuiltInScriptTool.ts:15, 31` — `input: any`、`Promise<any>`
- `src/storage/skillStore.ts:20` — `inputSchema?: any`

### 共同模式
1. `catch (e: any)` × 多處 — 應改為 `catch (e: unknown)` 並用 type guard
2. `normalizeXxx(obj: any)` × 10+ 處 — 應接收 `unknown`（既有的「我不知道型別」語意），用 Zod 或 type guard 縮窄
3. `inputSchema?: any` — JSON Schema 結構，可用 `JSONSchema7` 型別（`@types/json-schema`）

## 來源檔案
（見上方分組列表）

## 建議做法

### 1. 把 `any` 換成 `unknown`，再用 type guard 縮窄
最低成本的修法：

```ts
// before
function normalizeAction(obj: any): Action | null { ... }

// after
function normalizeAction(obj: unknown): Action | null {
  if (!obj || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;
  if (typeof o.type !== "string") return null;
  // ...
}
```

### 2. 引入 Zod（推薦，與 issue 5 共用）
所有 `normalizeXxxDecision` / `normalizeXxx` 改用 `z.object(...).safeParse(...)`，一次解決：
- 型別安全
- runtime 驗證
- 邊界錯誤訊息

### 3. `inputSchema?: any` 改用 JSONSchema7 型別
```ts
import type { JSONSchema7 } from "json-schema";
inputSchema?: JSONSchema7;
```

### 4. RPC 型別
`src/mcp/sseClient.ts`：
```ts
type RpcReq<P = unknown> = { id: string; method: string; params?: P };
type RpcRes<R = unknown> = { id: string; result?: R; error?: { code?: number; message: string } | string };
```

### 5. 加 lint rule 防回潮
在 `eslint.config.js`（如果還沒有就建立）開：
- `@typescript-eslint/no-explicit-any: "error"`
- `@typescript-eslint/no-unsafe-assignment: "warn"`
- `@typescript-eslint/no-unsafe-member-access: "warn"`

### 6. 對 `catch` 統一處理
新增 `src/utils/errors.ts`：
```ts
export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  try { return JSON.stringify(e); } catch { return String(e); }
}
```
然後把 `catch (e: any) { ... e.message ... }` 換成 `catch (e) { errorMessage(e) }`。

## 影響
- TypeScript 對外部資料（model 輸出、MCP 回傳、user-import skill）完全沒幫忙檢查，必須靠 runtime 防呆
- 一旦 model 或 MCP 回傳 shape 飄，會在執行期才爆，且錯誤訊息散亂
- refactor App.tsx 時，型別輔助薄弱，會增加重構風險
