# Issue 12 — Storage 無 quota 處理 + 載入時 silent 吞錯（資料毀損 / 容量爆）

## 嚴重度
High

## 觀察到的問題
`src/storage/*.ts` 大量使用 `localStorage.setItem` 與 `localStorage.getItem` + `JSON.parse`，但有兩類普遍缺漏：

### 缺漏 1：`setItem()` 從不處理 `QuotaExceededError`
- `localStorage` 預設配額 5-10 MB
- 此專案會把以下大型結構塞進 localStorage：
  - chat history（含完整 message + tool output）
  - skills（含 docs、可能很大的 payload）
  - logs（如果寫進 localStorage 的話）
- 一旦超 quota，`setItem` 會丟 `QuotaExceededError` (DOMException code 22)
- 目前所有 store 都直接 `localStorage.setItem(...)`，沒 try/catch
- 後果：state 看起來改了（記憶體中），但**重新整理後消失**，使用者完全無感

涉及的呼叫點（`src/storage/`）：
- `settingsStore.ts` — UI state、credentials、load balancers、MCP 設定、prompt templates
- `agentStore.ts`、`chatStore.ts`、`skillStore.ts`、`builtInToolStore.ts`、`docStore.ts`

### 缺漏 2：`JSON.parse` 失敗 silent fallback
普遍模式：
```ts
try {
  return JSON.parse(raw);
} catch {
  return [];  // 或 return defaultXxx()
}
```
問題：
- schema 演進後（例如某欄位改名），舊資料 parse 完通過，但是 shape 不對，下游 render 出錯
- 真正的 JSON 解析失敗時，使用者**所有資料瞬間消失**，沒有任何警告
- 沒備份原始 raw 字串，事後無法復原
- 沒任何 telemetry 知道發生過

### 缺漏 3：無 schema 版本
- key 名稱有 `_v1` 後綴（例如 `agr_ui_v1`、`agr_model_credentials_v1`）
- 但**沒有任何 migration 邏輯**——如果未來改成 `_v2`，舊資料就直接被忽略，不會搬遷
- 也沒有 `__version` 欄位在 payload 內

### 缺漏 4：IndexedDB 錯誤訊息可能是 null
`src/storage/skillStore.ts` 內：
```ts
req.onerror = () => reject(req.error);  // req.error 可能是 null
tx.onerror = () => reject(tx.error);    // 同上
```
caller 拿到 `null` 當 error 來處理會崩。

## 來源檔案
- `src/storage/settingsStore.ts`（行 118, 152, 166, 186 等多處 `localStorage.setItem`）
- `src/storage/agentStore.ts`（L9 載入 fallback）
- `src/storage/chatStore.ts`（L21 載入 fallback）
- `src/storage/skillStore.ts`（L47, 211, 217, 226, 235, 281 IndexedDB 錯誤處理）
- `src/storage/builtInToolStore.ts`、`docStore.ts`

## 建議做法

### Step 1：所有 `setItem` 包 try/catch（必做、無痛）
新增 `src/storage/safeStorage.ts`：

```ts
export type StorageWriteResult =
  | { ok: true }
  | { ok: false; reason: "quota" | "denied" | "other"; error: unknown };

export function safeSetItem(key: string, value: string): StorageWriteResult {
  try {
    localStorage.setItem(key, value);
    return { ok: true };
  } catch (err) {
    if (err instanceof DOMException && (err.code === 22 || err.name === "QuotaExceededError")) {
      return { ok: false, reason: "quota", error: err };
    }
    if (err instanceof DOMException && err.name === "SecurityError") {
      return { ok: false, reason: "denied", error: err };
    }
    return { ok: false, reason: "other", error: err };
  }
}
```
所有 store 改用 `safeSetItem`，配額爆掉時：
- log 警告
- UI toast 提示「儲存空間不足，請清理 chat history / skills」
- 不要當作成功

### Step 2：載入時 Zod 驗證 + 損毀備份
```ts
import { z } from "zod";

const StoredSchema = z.object({
  __version: z.literal(1),
  data: AgentArraySchema
});

export function loadAgents(): AgentConfig[] {
  const raw = localStorage.getItem(KEY);
  if (!raw) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    backupCorruptedData(KEY, raw, "json-parse-failed");
    console.warn("[storage] agent data is not valid JSON; backed up.", err);
    return [];
  }

  const result = StoredSchema.safeParse(parsed);
  if (!result.success) {
    backupCorruptedData(KEY, raw, "schema-mismatch");
    console.warn("[storage] agent schema mismatch; backed up.", result.error);
    return [];
  }
  return result.data.data;
}

function backupCorruptedData(key: string, raw: string, reason: string) {
  const backupKey = `__backup_${key}_${Date.now()}_${reason}`;
  try {
    localStorage.setItem(backupKey, raw);
  } catch {
    // 連 backup 都存不下就放棄
  }
}
```
這樣未來可以從 `__backup_*` key 救回資料，且使用者不會「資料一夕消失沒人知道」。

### Step 3：加 schema versioning + migration pipeline
```ts
type Migration<TIn, TOut> = (data: TIn) => TOut;
const migrations: Record<number, Migration<any, any>> = {
  1: (v0) => ({ ...v0, newField: "default" }),
  2: (v1) => ({ ...v1, anotherField: 0 })
};

function migrate(data: { __version: number; payload: unknown }): unknown {
  let cur = data;
  while (cur.__version < CURRENT_VERSION) {
    const m = migrations[cur.__version + 1];
    if (!m) throw new Error(`Missing migration to v${cur.__version + 1}`);
    cur = { __version: cur.__version + 1, payload: m(cur.payload) };
  }
  return cur.payload;
}
```

### Step 4：IndexedDB 錯誤包裝
```ts
req.onerror = () => reject(new Error(`IDB error: ${req.error?.message ?? "unknown"}`));
tx.onerror = () => reject(new Error(`IDB tx error: ${tx.error?.message ?? "unknown"}`));
tx.onabort = () => reject(new Error(`IDB tx aborted: ${tx.error?.message ?? "unknown"}`));
```

### Step 5：定期 quota 檢查
- 啟動時呼叫 `navigator.storage.estimate()` 看剩餘空間
- 接近滿時主動提示使用者清理

## 與其他 issue 的關聯
- 與 Issue 7（credentials 加密）共用 storage 層改動 → BATCH4 一起做
- 與 Issue 8（型別安全）共用 Zod schema → 可重用 BATCH2 已建立的 schema
- 與 Issue 9（測試）— storage round-trip test 是基礎測試之一

## 驗收條件
- 模擬 `localStorage` 爆 quota（mock setItem throw），UI 應顯示警告而非沉默
- 故意塞壞 JSON（手動編輯 localStorage），啟動後應在 console 看到警告 + `__backup_*` key 出現
- IndexedDB 失敗時 reject 的是 Error 物件不是 null

## 影響
- 資料毀損 / 配額爆掉時使用者完全無感，造成「我設定的東西怎麼不見了」的客訴
- 未來任何 schema 演進都會直接洗掉舊使用者資料
- IndexedDB 錯誤 silent，問題回報困難
