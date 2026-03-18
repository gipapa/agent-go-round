# agent-go-round Skill Runtime 設計稿

## 1. 目的

這份文件定義 `agent-go-round` 下一版 `skill runtime` 的目標架構，讓 skills 不再只是「被選中後把 `SKILL.md` 直接塞進 prompt」，而是更接近：

- Claude Code / Anthropic Agent Skills 的 `SKILL.md + references + scripts + assets`
- OpenCode 的顯式 `skill` 載入
- OpenClaw 的 `eligibility / filtering / runtime snapshot`

本文件用於後續實作規劃，不代表本次已全部完成。

## 2. 設計目標

### 2.1 核心目標

1. `skill` 是高階 workflow layer，不是單次 tool action。
2. `skill` 有獨立的 runtime 狀態，不只是一段 prompt。
3. `references/` 必須支援按需載入，而不是全部注入。
4. `scripts/` 先只存檔，不執行。
5. `skill` 的可用範圍必須受 `agent` 權限限制。
6. `skill` 的 UI、儲存、執行 trace 必須可以被使用者理解與檢查。

### 2.2 非目標

第一版不做：

1. skill 內直接執行 Python / Bash / JavaScript scripts
2. 一回合同時命中多個 skills
3. tool 反向再啟動 skill
4. skill 自動修改 agent 設定
5. skill 間彼此互相調用

## 3. 參考來源與抽象化結論

### 3.1 Claude Code / Agent Skills

抽象重點：

1. `SKILL.md` 是唯一必要檔案。
2. `YAML frontmatter` 的 `name` / `description` 主要用來判斷何時觸發。
3. `SKILL.md` 正文只在 skill 被選中後才載入。
4. `references/`、`scripts/`、`assets/` 是 progressive disclosure，不是預設全載入。
5. `SKILL.md` 應保持精簡，把細節放到 `references/`。

### 3.2 OpenCode

抽象重點：

1. skill 是顯式載入，而不是隱式塞 prompt。
2. agent 先拿到 `available_skills` 清單。
3. 真的需要 skill 時，會呼叫一個內部 `skill` 能力來載入完整 skill。
4. skill 的使用權限可以做到 `allow / deny / ask`。

### 3.3 OpenClaw

抽象重點：

1. skills 載入前有 eligibility/filtering。
2. session 會有自己的 skill snapshot。
3. skill 不只是靜態文件，而是 runtime capability package。

### 3.4 對 agent-go-round 的結論

`agent-go-round` 應採用：

1. `Anthropic-style package format`
2. `OpenCode-style explicit skill load`
3. `OpenClaw-style session snapshot + eligibility filter`

## 4. 概念模型

### 4.1 名詞定義

- `Tool`
  - 單次動作
  - 例如 `get_user_profile`、`time`、自訂 JS tool

- `Skill`
  - 一段可重用 workflow
  - 例如「先選適合的 agent，再根據 references 回答」

- `Skill Registry`
  - 已安裝 skills 的靜態資料庫

- `Skill Session Snapshot`
  - 某次聊天 session 開始時可用的 skills 快照

- `Skill Runtime`
  - 某一回合中 skill 被選中後的執行狀態

## 5. Skill Package 規格

沿用下列結構：

```text
skill-name/
├── SKILL.md
├── scripts/
├── references/
└── assets/
```

### 5.1 `SKILL.md`

必要內容：

1. YAML frontmatter
2. Markdown body

建議前言：

```md
---
name: pua
description: 讓你的 AI 不敢擺爛，適合在反覆失敗、被動等待、缺乏主動性時使用
license: MIT
---
```

前端 runtime 至少讀：

- `name`
- `description`
- `license` 可選

正文則作為：

- skill instructions
- resource navigation
- workflow hint

### 5.2 `references/`

用途：

- 可載入上下文的參考文件
- 不應預設全部塞進 prompt

第一版規則：

1. 只有 `SKILL.md` 明確提到 `references/...` 路徑時，才允許載入
2. 只讀取被選中的 reference 檔案
3. 多份 references 時，優先由 skill runtime 決定讀哪些

### 5.3 `scripts/`

用途：

- 未來可能由 built-in tools 或 sandbox runner 接手執行

第一版：

1. 匯入
2. 儲存
3. 匯出
4. 顯示 metadata
5. 不執行

### 5.4 `assets/`

用途：

- 模板
- 靜態文字資產
- 未來可擴充成圖片或其他檔案

第一版：

1. 只支援純文字 assets
2. 不注入模型上下文
3. 只有 skill runtime 或 UI 明確要求時才取用

## 6. 資料結構設計

### 6.1 Registry 層

建議保留 IndexedDB abstraction layer，並延伸現有 `skillStore.ts`。

#### `SkillRegistryEntry`

```ts
type SkillRegistryEntry = {
  id: string;
  rootPath: string;
  name: string;
  description: string;
  license?: string;
  version: string;
  skillMarkdown: string;
  updatedAt: number;
  sourcePackageName?: string;
  fileCount: number;
  docCount: number;
  scriptCount: number;
  assetCount: number;
};
```

#### `SkillFileEntry`

```ts
type SkillFileEntry = {
  id: string;
  skillId: string;
  path: string;
  kind: "skill" | "reference" | "script" | "asset" | "other";
  content: string;
  updatedAt: number;
};
```

### 6.2 Session Snapshot 層

新增一個 runtime-only 結構，不一定需要持久化：

```ts
type SkillAvailability = {
  skillId: string;
  name: string;
  description: string;
  allowed: boolean;
  reason?: string;
};

type SkillSessionSnapshot = {
  sessionId: string;
  agentId: string;
  createdAt: number;
  availableSkills: SkillAvailability[];
};
```

### 6.3 Loaded Skill Runtime 層

```ts
type LoadedSkillRuntime = {
  skillId: string;
  name: string;
  instructions: string;
  referencedPaths: string[];
  loadedReferences: Array<{ path: string; content: string }>;
  allowedMcpServerIds?: string[];
  allowedBuiltInToolIds?: string[];
  allowMcp: boolean;
  allowBuiltInTools: boolean;
};
```

## 7. Agent 權限模型

現有：

- `enableSkills`
- `allowedSkillIds`

建議擴充成更完整的策略，但分兩階段：

### 7.1 第一階段

沿用現有欄位：

- `enableSkills: boolean`
- `allowedSkillIds?: string[]`

語意：

- `enableSkills === false` -> 完全禁用
- `allowedSkillIds === undefined` -> 全部可用
- `allowedSkillIds = [] | [..]` -> 僅允許指定 skills

### 7.2 第二階段

可以升級成：

```ts
type AgentSkillPolicy = "deny" | "ask" | "allow";
```

讓 skill 的 `load` 可以在執行前要求使用者確認。

## 8. Runtime 執行流程

### 8.1 全域順序

建議最終順序：

1. 建立 `Skill Session Snapshot`
2. `Skill decision`
3. `Skill load`
4. `Skill resource read`
5. `Tool decision`
6. `Final answer`

### 8.2 詳細流程

#### Step 1. Build Session Snapshot

輸入：

- active agent
- installed skills
- agent skill permissions

輸出：

- `availableSkills`

責任：

- 只生成可被該 agent 使用的 skill 清單
- 記錄被排除的原因

#### Step 2. Skill Decision

模型只看精簡 metadata：

```json
[
  {
    "id": "pua",
    "name": "pua",
    "description": "讓你的 AI 不敢擺爛..."
  }
]
```

要求模型只回：

```json
{"type":"no_skill"}
```

或

```json
{"type":"skill_call","skillId":"pua","input":{}}
```

#### Step 3. Skill Load

選中 skill 後，不直接把整份 registry entry 全塞進 prompt。

而是：

1. 解析 frontmatter
2. 取 `SKILL.md` 正文
3. 掃描 `references/...` 路徑引用
4. 建立 `LoadedSkillRuntime`

#### Step 4. Skill Resource Read

若 `SKILL.md` 有引用：

```md
需要時請查看 references/policies.md
```

runtime 才會讀：

- `references/policies.md`

若沒有引用，第一版不要自動把全部 references 載進去。

#### Step 5. Tool Decision

在 skill 已載入後，tool decision 不再看整個 agent 全域工具，而是看 skill scope：

- MCP：`agent allowed ∩ skill allowed`
- Built-in Tools：`agent allowed ∩ skill allowed`

#### Step 6. Final Answer

final answer 的 system/context 來自：

1. agent docs context
2. loaded skill instructions
3. loaded references
4. tool result

## 9. 需要新增的內部抽象層

### 9.1 `skillRuntime.ts`

建議新增：

`src/runtime/skillRuntime.ts`

責任：

1. build snapshot
2. normalize skill metadata
3. load selected skill
4. parse referenced files
5. build loaded runtime object

建議介面：

```ts
export async function buildSkillSessionSnapshot(args): Promise<SkillSessionSnapshot>
export async function runSkillDecision(args): Promise<SkillDecision | null>
export async function loadSkillRuntime(args): Promise<LoadedSkillRuntime>
export async function loadSkillReferences(args): Promise<Array<{ path: string; content: string }>>
```

### 9.2 `skillReferenceResolver.ts`

責任：

1. 從 `SKILL.md` 抽出 references 路徑
2. 過濾可用 references
3. 之後可擴充成更智慧的 `grep / search / semantic lookup`

## 10. UI 設計

### 10.1 Skills Panel

保留：

- Upload Skill Zip
- Create Empty Skill
- Edit / Export / Delete

新增建議：

1. 顯示 `frontmatter` 摘要
2. 顯示 `SKILL.md 引用了哪些 references`
3. 顯示 `scripts` / `assets` 是否存在
4. 顯示 `compatibility warnings`

### 10.2 Chat Skill Trace

skill trace 應分成：

1. `Skill decision`
2. `Skill load`
3. `Skill references`
4. `Skill tool scope`
5. `Skill tools used`

其中：

- `Skill instructions` 不應直接把整個正文完整攤開
- trace 只顯示摘要
- 若要看全文，應該是 `view full skill content`

### 10.3 Agent Edit

`Skills` block 應保留在 `Access Control` 第一項，並維持目前規則：

- 勾選 skills 時，Docs / MCP / Built-in Tools 強制全開

但之後可考慮改成：

- skills 開啟時預設全開
- 使用者可選「跟隨 skill scope」

## 11. 安全與權限

### 11.1 必須遵守

1. skill 不能繞過 agent 權限
2. 未來就算支援 scripts，也不能直接在主頁面執行
3. references 只讀取被允許的 skill 範圍
4. tool 不能反向再載入 skill

### 11.2 建議新增

1. `ask before loading skill`
2. `ask before reading references`
3. `skill load blocked` trace

## 12. 與現有程式碼的對應關係

### 12.1 現有可沿用

- [skillStore.ts](/home/gipapa/work/agent-go-round/src/storage/skillStore.ts)
- [App.tsx](/home/gipapa/work/agent-go-round/src/app/App.tsx)
- [SkillsPanel.tsx](/home/gipapa/work/agent-go-round/src/ui/SkillsPanel.tsx)
- [types.ts](/home/gipapa/work/agent-go-round/src/types.ts)

### 12.2 建議拆出

1. `src/runtime/skillRuntime.ts`
2. `src/runtime/skillReferenceResolver.ts`
3. `src/runtime/skillSnapshot.ts`

### 12.3 建議從 `App.tsx` 拆出的職責

目前 `App.tsx` 已經同時負責：

1. skill decision
2. skill load
3. skill reference read
4. tool decision
5. final answer composition

後續應拆出成：

- `App.tsx`
  - UI state orchestration
- `skillRuntime.ts`
  - skill runtime execution
- `toolRuntime.ts`
  - tool decision and execution

## 13. 分階段落地計畫

### Phase 1

目標：把現在的 skill 從 `prompt injection style` 提升成 `explicit load style`

工作項目：

1. 引入 `SkillSessionSnapshot`
2. skill decision 只看 metadata
3. skill load 後再讀 `SKILL.md` 正文
4. trace 改成明確顯示：
   - skill selected
   - skill loaded
   - references loaded

### Phase 2

目標：做真正的按需 references 載入

工作項目：

1. 抽 `skillReferenceResolver`
2. 支援 `SKILL.md` 明確引用 path
3. skill runtime 可分批載入 references

### Phase 3

目標：做 skill 權限與 approval

工作項目：

1. `allow / ask / deny`
2. skill load confirmation
3. skill resource read confirmation

### Phase 4

目標：為未來 scripts 執行預留能力

工作項目：

1. skill script metadata
2. script runner abstraction
3. 透過 built-in tools bridge 執行

## 14. 驗收標準

以下情境成立，才算 skill runtime 第一版合理：

1. agent 未開 skills 時，完全不會跑 skill decision
2. agent 開了 skills，但沒有可用 skill 時，trace 會清楚顯示 skipped
3. skill decision 選中 skill 時，會先建立 loaded runtime，而不是直接把 registry metadata 塞進 prompt
4. `SKILL.md` 的 frontmatter 不會被當成 instructions
5. `references/` 沒被引用時，不會自動全部讀進上下文
6. skill 內工具使用範圍受 agent 權限交集限制
7. chat trace 可以清楚還原這回合：
   - 為何選中 skill
   - 載入了哪個 skill
   - 讀了哪些 references
   - 使用了哪些工具

## 15. 建議下一步

若要開始實作，建議按這個順序：

1. 先把 `App.tsx` 內 skill runtime 抽到 `src/runtime/skillRuntime.ts`
2. 再補 `SkillSessionSnapshot`
3. 再補 `skillReferenceResolver.ts`
4. 最後才做 approval 與更細的 trace

## 16. 參考連結

- Anthropic Agent Skills: https://github.com/anthropics/skills
- OpenCode Skills: https://opencode.ai/docs/skills
- OpenClaw Skills: https://docs.openclaw.ai/tools/skills
- Claude Code Skills 實作說明文章: https://kaochenlong.com/claude-code-skills
