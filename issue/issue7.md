# Issue 7 — Credentials / API Keys 以明文存在 localStorage

## 嚴重度
High（安全）

## 觀察到的問題
所有 model provider 的 API keys（OpenAI / Groq / Gemini / Custom endpoint）都透過 `src/storage/settingsStore.ts` 存進 `localStorage`，**完全明文**：

- 任何 XSS（不論來自第三方 script、瀏覽器擴充功能、或誤渲染未消毒內容）都能 `localStorage.getItem(...)` 一次撈走所有 key
- localStorage 沒有 cookie 的 `HttpOnly`、`Secure`、`SameSite` 等保護
- 同一台機器其他使用者（或惡意 browser extension）能讀到
- 專案有大量「動態執行 user-supplied JS」的功能（built-in tools 用 `new Function(...)` 執行使用者 script），更放大風險

放大此問題的相關設計：

- `src/utils/runBuiltInScriptTool.ts:31` 用 `new Function(input, helpers)` 執行任意 user-defined code
  - 若 helpers 暴露了 fetch 或 settings 存取，user-defined tool code 可以直接讀 localStorage 偷 key
- 工具輸出顯示沒看到統一的 sanitize（見 issue 5 / 6 相關 prompt injection 風險）

## 來源檔案
- `src/storage/settingsStore.ts`（credential 儲存）
- `src/utils/credential.ts`
- `src/utils/runBuiltInScriptTool.ts`（動態執行 user code）
- `src/app/App.tsx`（credentials modal 處理）

## 建議做法

### 短期（必做）
1. **明顯警告**：在 Credentials modal 上方放警示 banner：「API keys 以明文存於本機 localStorage；勿在公用電腦或不信任的瀏覽器擴充環境使用。」
2. **分離 sensitive key 到單獨 storage key**：把 API key 抽出 settings 物件，讓 `localStorage.getItem("settings")` 不會順便撈到 key
3. **防止 built-in tool 直接讀 key**：
   - `runBuiltInScriptTool()` 的 helpers 不要暴露任何讀取 credentials 的 API
   - 工具若需要呼叫 model，應透過受控的 wrapper（例如 `helpers.callModel(...)`），而非直接 fetch

### 中期
4. **改放 IndexedDB + 加密層**
   - 用 Web Crypto (`crypto.subtle`) 對 key 做對稱加密
   - 加密金鑰由使用者輸入的「主密碼」派生（PBKDF2 / Argon2）
   - 第一次設定時跳一個「設定主密碼」流程
5. **session-only 模式**：提供「不持久化」選項，使用 `sessionStorage` 或純記憶體，重整就要重新貼 key
6. **支援匯出 / 匯入 credentials**（加密）
   - 讓使用者可以離開時手動帶走，避免長期殘留

### 長期 / 替代方案
7. **走代理**：建議大型部署改用後端代理保管 key，前端只拿短效 token
   - 這跟 README「browser-first / no backend」的設計目標衝突，需在文件明確標示

### 程式碼示意（中期方案 4）
```ts
// src/storage/credentialVault.ts
export async function saveCredentials(plaintext: object, masterKey: CryptoKey) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(JSON.stringify(plaintext));
  const enc = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, masterKey, data);
  await idb.set("credentials.v2", { iv: Array.from(iv), data: Array.from(new Uint8Array(enc)) });
}
```

## 影響
- XSS / 惡意 extension / 公用電腦上 → API key 外洩
- 對於熟悉 web 安全的使用者來說會降低對專案的信任感
- 即使不馬上實作加密，至少要 (1) 警告使用者 (2) 隔離 storage key (3) 防止 user-defined script 偷 key
