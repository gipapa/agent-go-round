# Issue 5 — `extractJsonObject()` 用 regex 解析，且重複實作

## 嚴重度
High

## 觀察到的問題
專案內有兩份相同的 `extractJsonObject()` 實作，都用同樣有缺陷的 regex：

```ts
function extractJsonObject(text: string): any | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]);
  } catch {
    return null;
  }
}
```

### 缺陷
1. **Regex 是 greedy 的 `\{[\s\S]*\}`** — 會吃到最後一個 `}`。如果模型輸出包含多個 JSON 物件（例如一段 reasoning + 一段 JSON + 一段尾註），會抓到「第一個 `{` 到最後一個 `}` 之間的所有東西」，JSON.parse 必然失敗
2. **不能處理巢狀結構** — 如果 model 在 prose 中提到 `{...}` 範例再給真正的 JSON，會抓錯片段
3. **沒有長度上限** — 超大 model 回應（例如惡意或意外）會讓 regex 與 JSON.parse 都耗 CPU
4. **沒有 schema 驗證** — 解出來的物件直接給 `normalizeToolDecision(obj: any)`、`normalizeSkillDecision(obj: any)` 等十幾個 normalize 函式，全是 `any` 進、loose check 出
5. **重複實作** — 兩份程式碼會分歧，未來修一邊忘另一邊

### 重複位置
- `src/app/App.tsx:404` — 主版本
- `src/orchestrators/leaderTeam.ts:48` — 完全相同的拷貝

### 被呼叫的地方（App.tsx 內）
至少 10 處：行 484, 1778, 1821, 1888, 1920, 1967, 2003, 4170, 4251, 4327, 4439, 4525

每一處都搭配對應的 `normalizeXxxDecision()` 函式（10+ 個 normalize 函式，邏輯類似但獨立實作）。

## 來源檔案
- `src/app/App.tsx`（行 404 + 多處 caller）
- `src/orchestrators/leaderTeam.ts:48`
- 相關 normalize 函式：`src/app/App.tsx:428`（toolDecision）、`:487`（skillDecision）等

## 建議做法

### 1. 建立統一的安全 JSON 解析器
新增 `src/utils/safeJson.ts`：

```ts
const MAX_INPUT_LEN = 200_000; // 上限

export function extractJsonObject(text: string): unknown | null {
  if (typeof text !== "string" || text.length === 0 || text.length > MAX_INPUT_LEN) return null;

  // 從第一個 { 開始，用 brace counting 找配對的 }
  const start = text.indexOf("{");
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escape) { escape = false; continue; }
      if (ch === "\\") { escape = true; continue; }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}
```

並把兩個重複的 `extractJsonObject` 改 import 自此處。

### 2. 用 Zod 重寫 `normalizeXxxDecision`
```ts
import { z } from "zod";

const ToolDecisionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("no_tool") }),
  z.object({ type: z.literal("builtin_tool_call"), tool: z.string(), input: z.unknown().optional() }),
  z.object({ type: z.literal("mcp_call"), tool: z.string(), serverId: z.string().optional(), input: z.unknown().optional() }),
]);

export function normalizeToolDecision(obj: unknown): ToolDecision | null {
  const r = ToolDecisionSchema.safeParse(obj);
  return r.success ? r.data : null;
}
```

可以一次抽掉 10 多個 normalize 函式的重複 boilerplate，且把 `any` 換成 `unknown`。

### 3. 加 unit test
針對下列邊界 case：
- 多個 JSON 物件
- JSON 內含 `}` 字元（在 string 裡）
- markdown code fence 包裹（` ```json {...} ``` `）
- 超長輸入
- 空字串 / null

## 影響
- model 輸出格式稍微飄就會 normalize 失敗，user 看到「Tool decision parse failed」但其實 JSON 是好的
- 兩份程式碼分歧風險
- 是 prompt-injection 的潛在切入點（model 故意輸出 `{...}` 形狀的內容騙過 parse）
