# Pi 編輯器：以虛擬檔案系統為核心的下一輪規劃

日期：2026-10-31；更新：2026-11-01。F0–F5 已完成：歷史接續與最小 history／resume、IndexedDB session／workspace／events migration、VFS／檔案工具、文字 editor、AGENTS.md／skills 與來源版本紀錄、SDK Groq／production browser 的三段笑話驗收，以及 main.html／相對 CSS／SVG 主頁預覽、可恢復且共享 workspace 的 Pi popup。操作與證據見 [笑話驗收](joke-acceptance.md) 與 [主頁預覽](page-preview.md)。

本文件取代 [前一輪缺口規劃](poc-gap-plan.md) 的交付優先順序，保留其中的問題盤點。新目標是可處理檔案的純前端 Pi 編輯器：開啟 tab 先進入 `~` 的 shell，使用者可以瀏覽、建立與編輯檔案，執行 `ai` 後，agent 在同一個檔案系統中工作。

## 已確定的方向

- 先修歷史對話，再建立 VFS、shell 與檔案式 instructions / skills。
- VFS 正式儲存使用 **IndexedDB**；提供 memory adapter 做測試，不採 localStorage 檔案後端。
- 沿用現有 tabs 與 panel，在同一個 surface 切換 shell、editor、agent；不另建一個檔案管理主面板。
- Shell 指令、文字編輯器、agent tools、AGENTS.md loader 與 skill loader 共用同一個 VFS service。
- Pi 繼續擁有唯一模型／工具循環。Skill 是指示與資源檔案，不是另一套執行引擎。
- `~/main.html` 可作為承載 popup 的宿主頁面，透過預覽 runtime 呈現；agent 修改檔案後可刷新預覽。此處主頁指 popup 背後的頁面，popup 內仍使用現有 Pi UI。

IndexedDB 適合這個需求，因為它可保存結構化資料與檔案內容，提供非同步 API、索引與交易；localStorage 為同步 API。檔案、對話與其索引採 IndexedDB repositories，既有少量 UI 偏好可保留原儲存方式。資料來源：[MDN IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API)、[MDN Web Storage](https://developer.mozilla.org/en-US/docs/Web/API/Web_Storage_API)。

## v2 查核結果與沿用範圍

| v2 資產 | 查到的實作 | 新版處理 |
|---|---|---|
| `src/storage/docStore.ts` | IndexedDB 文件 CRUD，依 id 保存 title / content | 參考 async store 與錯誤處理，轉成依路徑存取 |
| `src/storage/skillStore.ts` | IndexedDB skill metadata、files、references、套件匯入匯出 | 參考路徑、內容與 metadata 設計，統一放進 VFS |
| `src/runtime/skillPackageValidation.ts` | SKILL.md frontmatter、路徑與大小驗證 | 擷取純函式與相應測試，移除舊 App types 依賴 |
| `src/runtime/harness/skillTools.ts`、`src/pi/tools/skillPiTool.ts` | catalog → skill_load → skill_read 按需載入 | 沿用 progressive loading 概念，改從 VFS 讀取 |

目前查到的 v2 實作是分開的 document / skill repositories，沒有統一的 cwd / directory / shell VFS。這次新增共用檔案抽象，不直接搬回整個 v2。特別注意 v2 的 skill reader 有「單 run 最多讀三個不同資源」限制，不能照搬，否則五個笑話的驗收必定被阻擋。

## 0. 修復歷史與 session identity

交付：重新整理、重新連接 provider、離開再進入 `ai`，仍能接續相同對話。

- 將 tab identity、session identity、provider connection 分開；provider/model/status 改為每個 session 的資料，避免全域標記與實際 runtime 不符。
- Groq reload 保留原 messages / system prompt，等待重新連線；重連補上 transport 與 credentials，不建立空 session 覆寫舊歷史。
- 先用既有 store 修正接續流程；IndexedDB 落地後將 session repository 與 workspace metadata 一起遷入。
- 明確區分畫面通知、shell output 與 agent transcript；shell 指令和啟動提示不自動加入模型歷史。
- 跨 tab 回覆保留來源，經明確加入後才成為來源 agent 的上下文，不只停留在畫面。
- Session repository 獨立於開啟中的 tabs：關 tab 不刪對話；提供最小列表／重開入口。全文搜尋與進階歷史管理後續再補。

驗收：在真實 adapter 的 request boundary 斷言多輪內容，涵蓋 reload → reconnect、重複 Connect、A/B 不同 provider、關閉重開。不可只斷言畫面存在舊文字。

## 1. IndexedDB VFS

### 共用介面與路徑

建議模組：`src/core/fs/`，公開 `VirtualFileSystem`、`MemoryFileSystem`、`IndexedDbFileSystem`。所有操作皆使用 async interface，core 不依賴 DOM 或全域資料庫。

第一輪提供 `stat`、`listDirectory`、`readFile`、`writeFile`、`mkdir`、`remove`、`rename`；`writeFile` / `rename` 支援預期 revision，避免使用者與 agent 同時修改時靜默覆蓋。

- 內部使用絕對路徑，home 固定映射為 `/home/user`，畫面顯示 `~`。
- 支援相對路徑、`~`、`.`、`..`、中文檔名與含空白名稱；normalize 後再檢查 workspace root 範圍。
- 真實目錄節點保留空目錄，清楚區分 file / directory、父目錄不存在、非空目錄與不存在檔案。
- 第一輪以 UTF-8 文字檔為主要操作目標；檔案抽象可擴充 Blob，但 PDF 解析、二進位編輯另列功能。
- 同一 workspace 的所有 app tabs 共享檔案；每個 tab 的 cwd、shell history 與 agent session 各自獨立。

### 儲存與一致性

IndexedDB database 使用新版 namespace 與明確 schema version，設置 nodes、sessions、workspace metadata 等 stores；檔案 key 包含 workspaceId / path，nodes 建 parent-path 索引。

- 檔案節點保存 kind、content、revision、createdAt、updatedAt；目錄與索引變更在同一 transaction 提交。
- 寫入／rename 的 revision 檢查也在 transaction 內完成，成功 commit 後才能向 shell / agent 回報成功。
- Editor 保存記錄讀取時 revision；衝突時保留未保存內容並提示重新讀取／比對。
- 多個 browser tabs 的 session writer ownership 需有 revision／lease 檢查；通知只用於刷新 UI，不能取代資料庫內的衝突檢查。
- 模型或工具網路等待不放在 IndexedDB transaction 裡。記錄已提交工具結果，但 reload 不自動重做 mutation。
- storage quota、transaction abort、DB upgrade blocked 與資料損壞均顯示錯誤；正式模式不靜默改成 memory 並聲稱已保存。
- 目前 localStorage workspace / sessions 透過可重入 migration 匯入，成功驗證後才寫 migration marker；保留原資料以便回復。v2 資料不自動覆寫，之後另做明確匯入。
- DB ready 且 migration 完成後才啟用指令輸入，避免啟動時的預設空 workspace 覆蓋原資料。

驗收：CRUD、中文／空白／相對路徑、空目錄、同名衝突、revision conflict、transaction failure、多 tab 共用、reload 保存，以及獨立 session 保存不被其他 running tab 阻擋。

## 2. 既有 panel 成為 shell / editor / agent

每個 tab 有 `mode = shell | editor | agent | preview`、cwd、shell history、draft 與可恢復的 session reference。首次開啟與新 tab 預設都是 shell，cwd 為 `~`。HTML 的 preview 沿用同一套 tabs。

```text
~ $ pwd
/home/user
~ $ ls
AGENTS.md  documents/  jokes/
~ $ cat AGENTS.md
即使使用者使用英文提問，也必須使用繁體中文回答。
~ $ cd jokes
~/jokes $ ls
笑話1.md  笑話2.md  笑話3.md  笑話4.md  笑話5.md
~/jokes $ ai
[同一個 panel 進入 agent，working directory = ~/jokes]
```

第一輪指令：`help`、`pwd`、`ls`、`cd`、`cat`、`mkdir`、`touch`、`edit`、`rm`、`mv`、`clear`、`ai`。採 bash 風格的內建指令解析，支援引號與空白路徑；指令只操作 VFS，不需要作業系統 shell。Pipes、程序執行、套件安裝與完整 bash 語法不在首輪範圍。

- `edit path` 在目前 panel 進入文字編輯模式，提供儲存／取消與返回 shell，顯示檔案路徑及未保存狀態。
- `ai` 首次建立 session；同 tab 已有 session 時接續，`ai --new` 明確新建，`ai --resume <sessionId>` 重開歷史。
- Agent 中 `/exit` 返回 shell，保留對話；Esc / Stop 只停止目前 run。執行中返回 shell 前先完成取消與狀態收尾。
- Session 記錄 agent cwd；重新接續時使用已保存 cwd，不默默套用另一個目錄。要在新目錄開始可用 `ai --new`。
- Agent 工具 `read`、`write`、`edit`、`grep`、`find`、`ls` 與 `skill_load` 從 `~/bin` 的 JS／manifest 載入，透過受控 API 呼叫同一 VFS；shell 另外提供 `mkdir`／`rm`。工具結果包含 canonical path、revision 與可判讀錯誤，並保存到正常 Pi transcript。
- 使用者在另一個 tab 修改檔案後，agent 下一次讀取能得到新內容；每次讀取紀錄版本，寫入使用預期版本檢查。
- 主 panel 顯示工具呼叫、讀取路徑與結果／錯誤；輸入或輸出更新不能把正在閱讀舊內容的使用者拉到底部。

驗收：新 tab 在 `~` → 建檔／編輯 → `cd` / `ls` / `cat` → `ai` 讀寫 → `/exit` → `cat` 看見實際結果 → reload 後仍存在。另一 tab 看見相同檔案，但 cwd 與對話保持獨立。

## 2.1 VFS 主頁與 popup 預覽

目標：`~/main.html` 是使用者能用 editor 或 Pi 修改的宿主頁面。預覽呈現該頁面與 popup launcher，從 popup 啟動 agent 後可再修改同一份頁面，形成「修改 → 預覽 → 繼續修改」的流程。

```text
~/
  main.html
  styles.css
  AGENTS.md
  documents/
  jokes/
  .pi/skills/
```

操作範例：

```text
~ $ edit main.html
~ $ preview main.html
[現有 tab 系統開啟主頁預覽，可使用 popup launcher]
[在 popup 的 Pi 中要求修改 ~/main.html 的標題或版面]
[儲存成功後刷新預覽，看到新版本]
```

### 呈現與連線方式

- 增加 `preview <path>`，預覽 tab 記錄 workspaceId、entry path 與已載入 revision；另外提供 page view 入口呈現主頁及 popup，workspace view 仍維持 shell 起始流程。
- Preview runtime 透過 VFS 取得 HTML；將 `./styles.css`、圖片等支援資源相對於 HTML 所在目錄解析。IndexedDB 路徑不直接視為可請求的 HTTP URL，需經資源 resolver 產生預覽用內容／URL。
- 首輪支援 HTML / CSS 與 VFS 相對資源。使用隔離 iframe 呈現頁面，外層可信任 runtime 掛載現有 popup loader；頁面腳本的完整執行能力另外驗收。
- Popup 掛載交由 runtime 管理，不要求每個 main.html 都自行複製 embed script。Main.html 保存頁面內容，page-view 設定決定 launcher 標題／位置與 popup 選項；匯出成獨立宿主頁面時再加入正式 embed loader。
- Popup 明確綁定該 preview 的 workspaceId，檔案工具透過可信任的 workspace service／bridge 讀寫；顯示 HTML 的 iframe 不直接持有 provider credentials 或取得完整資料庫操作權。
- `mount()` 已新增 workspaceId／surfaceId binding，ready handshake 回報實際 identity。各 surface 的 layout 分開持久化，同一 workspace 的檔案、歷史與 writer lease 共用；popup 對話依保存的 surface 恢復，仍套用 session revision／lease 檢查。
- File commit 後顯示「有更新／重新載入預覽」，首輪由明確刷新操作套用；刷新頁面資源不銷毀外層 popup 的 active run 或重建其 session。銷毀 preview 才釋放 iframe／資源 URL 與 widget。
- 缺少 main.html 時顯示建立入口，只在使用者選擇建立範本時寫入；已有檔案保持原內容。

### 預覽驗收

1. 用 shell 建立 main.html 與 styles.css，preview 正確呈現文字與相對樣式。
2. 從預覽的 launcher 打開 popup，agent 讀到相同 workspace 的 AGENTS.md 與檔案。
3. 要求 agent 修改 main.html，editor／cat 與預覽都能確認同一個新 revision。
4. 刷新預覽不重送模型請求、不清除 popup 對話；兩個不同 workspace 的 preview 不互相讀寫。
5. Reload 後檔案與 page entry 設定仍在，popup 依歷史規則 reconnect / resume。

IndexedDB 內容目前屬於該瀏覽器／origin 的本機工作區。供其他訪客看到同一份主頁，需要另外做 HTML／資源匯出與靜態發布；預覽功能不等於已發布網站。嵌入場景下的資料來源由 workspace bridge 明確決定，不假定不同網站能直接共享 IndexedDB。

## 3. 從 VFS 載入 AGENTS.md 與 skills

### AGENTS.md

- `ai` 啟動及每個 user run 前，沿 home 到 session cwd 的路徑收集 AGENTS.md，由上層到下層組合；同層只載入一次。
- 標準檔名為 `AGENTS.md`，也接受使用者提到的 `agents.md`；同層兩者同時存在時回報歧義，不隨機選一個。
- 將工作區規則作為具來源標記的 agent instructions 注入。普通 document / joke 檔案作為工具讀取資料，不能自動提升成工作區指示。
- 每次 run 固定 instructions snapshot，保存來源路徑與 revision；檔案改動在下一個 user run 生效，畫面可檢閱本次載入來源。
- 不因恢復 session 的舊 system prompt 而重複附加規則；組裝時替換對應來源區塊，保留原始歷史。

### Skill 結構與載入

第一版產品約定全域 skill 位置為 `~/.pi/skills/<name>/SKILL.md`；這是本產品的目錄決策，後續需要時再增加專案級 discovery。

```text
~/.pi/skills/joke-master/
  SKILL.md
  references/
    scoring.md
~/documents/document.md
~/jokes/
  笑話1.md
  笑話2.md
  笑話3.md
  笑話4.md
  笑話5.md
```

- SKILL.md 用 frontmatter 宣告 name / description，正文保存指示，相對資源路徑以 skill 目錄為基準。
- VFS-backed loader 取代只靠 `MemorySkillLoader` 的產品路徑；Memory loader 可留作獨立 SDK / 測試用途。
- 啟動時只提供 skill metadata catalog；符合任務時，模型呼叫 `skill_load` 從 VFS 讀入 SKILL.md，接著用 `read` 讀需要的 references 與工作檔案。
- 同時支援 `/skill joke-master <task>` 明確選用；明確選用先載入指示，任務仍交給同一個 Pi loop。
- `skill_load` 與 `read` 留下 path / revision / runId / toolCallId 的讀取紀錄，讀取失敗不能假裝成功。前置載入 instructions 也需留下可檢閱紀錄。
- Instructions、catalog 與讀取內容各有大小／總量限制；首輪資源預算至少支援五個笑話加評分準則，不沿用 v2 三檔限制。
- 載入 skill 不會自動執行其 scripts，也不另建 planner／verifier；需要的 document.md 由同一讀檔工具取得。

驗收：改 AGENTS.md 下一輪生效；新增／修改 SKILL.md 後 catalog 與載入版本正確；缺檔、錯誤 frontmatter、重複 skill name、超限都能明確回報。

## 4. 端到端驗收：中文規則與笑話高手

### 檔案準備

測試 workspace 透過正式 VFS 寫入規則、skill 與五個獨立笑話檔；正文不可硬編碼在模型 adapter、system prompt 或專用笑話工具中。提供可重複建立的 demo fixture，但不覆寫既有使用者檔案。

`~/AGENTS.md`：

```markdown
# 回答規則
即使使用者使用英文提問，也必須使用繁體中文回答。
```

`~/.pi/skills/joke-master/SKILL.md`：

```markdown
---
name: joke-master
description: 讀取笑話檔案，逐一評分並選出最好笑的笑話。
---
# 笑話高手
先讀取 references/scoring.md，再列出使用者指定目錄中的笑話檔案。
必須讀取每一個笑話 .md 的實際內容，不能只憑檔名或目錄清單評分。
逐一列出檔名、1–10 分與理由，最後給出最高分笑話的內容及選擇原因。
同分時說明比較理由再選出一個。缺檔或讀取失敗時明確指出。
```

`references/scoring.md` 宣告意外性、節奏與趣味性的評分準則；`~/jokes/笑話1.md` 到 `笑話5.md` 各有不同內容。

### 操作與通過條件

1. 從 `~` 用 `ls` / `cat` / `edit` 檢閱、修改上述檔案；reload 後內容仍在。
2. 在 `~` 執行 `ai`，用英文詢問：`Use the joke-master skill to read all five Markdown jokes in ~/jokes, score each one, and give me the funniest joke.`
3. 實際 request 證明 AGENTS.md 規則已載入；trace 證明讀取 SKILL.md、scoring.md 及五個笑話的完整內容，然後才給出最終評分。
4. 最終答案使用繁體中文，五個檔名各有一筆評分與理由，選出最高分之一，重現該檔案的笑話並說明原因。不固定笑話排名，分數屬模型判斷。
5. `/exit` 後編輯其中一個笑話，重新進入同一 session，英文請它重新評分；新的讀檔結果包含新 revision，不能只引用舊對話中的版本。
6. Reload → reconnect → resume 後，原對話仍在；新的模型 request 包含接續歷史。檔案內容維持獨立來源，修改後必須重新讀取。
7. 額外驗收 agent 寫檔：在另一個空目錄用英文要求先建立五個笑話 .md，再依 skill 逐檔讀回、評分與選出冠軍；返回 shell 的 `ls` / `cat` 必須證明五個檔案實際存在。

### 驗證分層

- Deterministic regression：VFS／IDB transactions、migration、revision conflict、shell mode、instructions 組裝、skill discovery、五檔讀取與失敗路徑；使用可記錄 request 與 tool call 的 scripted model。
- Browser smoke：正式 IndexedDB、既有 tabs、shell/editor/agent 切換、跨 tab 共用檔案、reload/resume；桌面與手機均操作。
- 明確觸發的 Groq live acceptance：執行上述英文任務，記錄模型、讀寫檔案、版本、工具步數、語言與評分結果。區分執行契約通過與模型是否遵循指示，不把 scripted 結果當成真實模型結果。

## 交付切分與後續順序

| 階段 | 可驗收交付 | 依賴 |
|---|---|---|
| F0 | Groq 歷史接續、每 session provider、最小歷史重開 | 現有 core / store |
| F1 | IndexedDB VFS、session/workspace repositories、migration | F0 的 identity 契約 |
| F2 | 新 tab 在 `~`、檔案指令與編輯、`ai` / `/exit`、agent 檔案工具 | F1 |
| F3 | VFS AGENTS.md、skill catalog / load / references | F1 + F2 |
| F4 | 五笑話英文問中文答、逐檔評分、agent 建檔讀回、reload 續聊 | F0–F3 |
| F5 | VFS main.html／相對資源預覽、綁定 workspace 的 popup、agent 改頁面後刷新 | F1 + F2 + F3；保留 F4 驗收 |

每階段完成相應 regression 後即交付實際操作路徑。F5 在檔案工具與基礎 skill 驗收後銜接，讓 popup 有可編輯的主頁。歷史全文搜尋、複雜檔案樹、完整 bash、遠端／本機磁碟 adapter、MCP、自動 delegation、voice 與多模態列後續。Context 預算與讀取大小限制跟隨檔案工具一起做，完整長對話 compaction 另列後續。
