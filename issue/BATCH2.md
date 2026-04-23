# Batch 2 — Type Safety + 安全 JSON 解析（2-3 天）

## 包含 Issues
- **Issue 5** — `extractJsonObject()` 用 regex 解析 + normalize 函式重複
- **Issue 8** — 散落各處的 `any` 型別

## 為何整合
兩個 issue **本質是同一件事的兩面**：

- Issue 5 列出的 `normalizeXxxDecision(obj: any)` × 10+ 函式，**正是 Issue 8 統計的 `any` 主要來源**
- 解法相同：引入 Zod，把 `any` → `unknown` → schema → 型別安全 + runtime 驗證
- 一起做可以**只抽一次** `src/utils/safeJson.ts` + `src/schemas/decisions.ts`，避免做兩遍 import / refactor

如果分開做，Issue 8 會發現「咦，這些 normalize 函式不就是 Issue 5 要重寫的嗎？」於是兩邊都要改 import。

## 工作量
2-3 天

## 風險
中 — normalize 函式被多處呼叫，需要有測試保護（這個 batch 內順便補關鍵 normalize 的 unit test）

## 前置依賴
無（建議在 Batch 1 之後做，但獨立也可）

## 執行順序建議

### Step 1：建立統一安全 JSON 解析器（Issue 5 核心）
- 新增 `src/utils/safeJson.ts`：
  - `extractJsonObject(text: string): unknown | null`
  - 用 brace counting 取代 regex
  - 設長度上限（例如 200KB）
  - 支援去除 markdown code fence 包裹
- 補 unit test：多個 JSON、含 `}` 的 string、code fence 包裹、超長輸入、空字串
- 替換 `src/app/App.tsx:404` 與 `src/orchestrators/leaderTeam.ts:48` 兩處重複實作 → import 統一版本

### Step 2：引入 Zod
```bash
npm i zod
```
- 新增 `src/schemas/decisions.ts`，定義：
  - `ToolDecisionSchema`
  - `SkillDecisionSchema`
  - `SkillStepDecisionSchema`
  - `SkillVerifyDecisionSchema`
  - `SkillBootstrapPlanSchema`
  - `SkillCompletionDecisionSchema`
  - `McpActionSchema`
- 改寫 `App.tsx` 內所有 `normalizeXxxDecision` 為一行：`Schema.safeParse(obj).success ? data : null`
- 同步替換 `src/orchestrators/leaderTeam.ts` 的 `normalizeAction` / `normalizeVerify` / `normalizePlan`

### Step 3：核心型別 `any` → `unknown` / 具體型別（Issue 8）
依下列順序處理：
1. `src/types.ts` — `inputSchema?: any` → `JSONSchema7`（裝 `@types/json-schema`）；`input?: any` → `Record<string, unknown>`
2. `src/mcp/sseClient.ts` — RPC req/res 用 generic：`type RpcReq<P = unknown>`、`type RpcRes<R = unknown>`
3. `src/adapters/openaiCompat.ts` / `custom.ts` / `chromePrompt.ts` — `catch (e: any)` 全改 `catch (e)` + 用新 helper
4. `src/utils/runBuiltInScriptTool.ts` — `input: any` → `unknown`，使用前用 type guard

### Step 4：統一 catch 處理
- 新增 `src/utils/errors.ts`：`errorMessage(e: unknown): string`
- 全工程 grep `catch (e: any)` / `catch (error: any)`，全部改用 `errorMessage()`

### Step 5：加 ESLint config（必做，避免 `any` 回潮）
專案目前根本沒有 `eslint.config.js`，所以 Issue 8 修完馬上會有人寫回 `any`。**這個 batch 必須順手把 ESLint 建起來**，否則前面的努力白費。

- 新增 `eslint.config.js`（flat config）
- 加既有 deps：`eslint`、`@typescript-eslint/parser`、`@typescript-eslint/eslint-plugin`、`eslint-plugin-react-hooks`、`eslint-plugin-react-refresh`
- 規則：
  - `@typescript-eslint/no-explicit-any: "error"`
  - `@typescript-eslint/no-unsafe-assignment: "warn"`
  - `@typescript-eslint/no-unsafe-member-access: "warn"`
  - `react-hooks/rules-of-hooks: "error"`
  - `react-hooks/exhaustive-deps: "warn"`
- 加 `npm script`：`"lint": "eslint src --max-warnings 0"`
- 對「目前還改不動」的違反處用 `eslint-disable-next-line` + 註解理由（之後 Batch 4 拆 App.tsx 時再清）

## 驗收條件
- `grep -r ": any" src/` 數量大幅下降（剩下的應該都有 eslint-disable 註解 + 理由）
- `extractJsonObject` 通過所有邊界 case test
- normalize 函式行數降為 1-3 行（透過 Zod safeParse）
- `npm run build` / `tsc --noEmit` 通過

## 後續鋪墊
- Batch 3 會動 `src/mcp/sseClient.ts`，本 batch 已先把 RPC 型別清乾淨
- Batch 4 拆 App.tsx 時，schema 抽出來會讓 context / reducer 的 action 型別更明確
- **Batch 4 的 Issue 12（storage Zod 驗證）會直接重用本 batch 建立的 schema 與 `safeJson` helper**——所以本 batch 抽 schema 時，可以順手把 `AgentConfigSchema`、`SkillSchema`、`CredentialsSchema` 這類 storage 型別也定義好（雖然 Batch 2 不接 storage，但 schema 先放著）

## 不要做的事
- 不要在這個 batch 內動 storage 載入 / 寫入邏輯（留給 Batch 4）
- 不要試圖把 `JSONSchema7` 換成自己定義的型別（直接用社群套件）
- 不要把 normalize 函式搬位置（只改實作，不改檔案位置，避免 PR 太雜）
