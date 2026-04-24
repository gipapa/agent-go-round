# Issue 7 — Credentials / API Keys 加密儲存（vault wiring 未完成）

## 嚴重度
High（安全）

## 現況（2026-04 更新）

### 已完成（BATCH4）
- ✅ Credentials 已從 settings 物件分離到單獨 key：`agr_model_credentials_v1`（`src/storage/settingsStore.ts:29`）
- ✅ `runBuiltInScriptTool` helpers 不再暴露任何讀取 credential 的 API（`src/utils/runBuiltInScriptTool.ts` 全檔已 grep 確認無 credential 字樣）
- ✅ `src/storage/credentialVault.ts` 已實作（Web Crypto AES-GCM + PBKDF2-SHA256，210k iterations）
- ✅ `src/__tests__/credentialVault.test.ts` 加 / 解密 round-trip 測試完成

### **仍未完成（核心問題還在）**
- ❌ **vault 完全沒被 wire 進 App**。`grep credentialVault src/` 只出現在 vault 自己與其 test，**App.tsx / settingsStore / Credentials Modal 都還沒呼叫**
- ❌ 沒有「設定主密碼 / 解鎖」UI
- ❌ 沒有舊 `agr_model_credentials_v1`（明文）→ 加密 vault 的 migration
- ❌ 沒有 session-only 模式（記憶體保存）
- ❌ Credentials Modal 還沒加警示 banner

→ 結果：`localStorage` 內 credentials 仍然是明文，跟 BATCH4 之前狀態實質相同。

## 來源檔案
- `src/storage/credentialVault.ts`（已寫好但未使用）
- `src/storage/settingsStore.ts`（讀 / 寫 credentials 的地方）
- `src/app/App.tsx`（Credentials Modal 與所有讀 credential 的呼叫點）

## 待辦

### Step 1 — Credentials Modal 加警示 banner（半天，可獨立 PR）
- 「API keys 以明文存於本機 localStorage；勿在公用電腦或不信任的瀏覽器擴充環境使用。設定主密碼後可加密保護。」

### Step 2 — Vault wiring + 主密碼流程（重頭戲）
1. 啟動時偵測 `agr_credential_vault_v1`：
   - 存在 → 跳「輸入主密碼解鎖」UI（密碼錯誤 → 重試 / 重設）
   - 不存在 → 跳「設定主密碼（可選 / 跳過）」UI
2. 解鎖後把明文 `ModelCredentials` 載入記憶體 store；任何寫入時用 `encryptCredentials()` 落地
3. 提供「鎖定」按鈕：清空記憶體 + 強制重新解鎖
4. 「session-only」模式：vault 不寫 storage，重整就要重新貼 key
5. Migration：偵測到舊 `agr_model_credentials_v1` 明文 + 使用者啟用 vault → 提示「將舊 credentials 加密遷移」→ 成功後 `localStorage.removeItem` 舊 key

### Step 3 — 替代方案文件
- AGENT.md / README 標示：「browser-first 設計下無法做到後端代理層級的隔離；想要更高安全性的部署請考慮自建 proxy」

## 驗收條件
- 啟用 vault 後，`localStorage` raw dump 內找不到 raw API key
- 主密碼錯誤時 vault 拒絕解鎖且不破壞既有資料
- 舊明文 credentials 能一鍵遷移進 vault；遷移後舊 key 被清掉
- session-only 模式下重整瀏覽器，credentials 消失

## 不要做的事
- 主密碼 UI 不要做太花俏（一個密碼欄、一個解鎖按鈕就好）
- 不要把 vault 解密 promise 散到各 component；統一在一處解鎖後用 context 提供明文
- 不要為了相容把舊明文 key 永久保留

## 關聯
- 屬於 [BATCH6](BATCH6.md)
- 與 [issue 1](issue1.md) 抽 `AgentContext` 同步做最划算（vault 解鎖狀態天然屬於 AgentContext）
