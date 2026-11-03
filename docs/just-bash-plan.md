# 接入 just-bash 與 VFS 調整計畫

建立：2026-11-03；更新：2026-11-04。狀態：P0–P5 已完成，單元／production／瀏覽器 gates 通過；外部模型 smoke 本輪未執行，新版未發布。[目前程式與驗證紀錄](just-bash-progress.md)。

## 目標與範圍

以 just-bash 取代目前自行實作的 shell。VFS 是核心：shell、agent、skills、預覽與後續 editor 應直接操作同一個 workspace，並在重新整理後保留檔案。

依使用者決定，現有 shell 的 parser、內建指令、JSON 命令形式、大小寫寬鬆處理及人類 editor 均不列為相容要求。VFS 的介面與儲存格式可為 just-bash 調整。先交付可靠的 shell／VFS／agent 路徑，再重做人類 editor 等特殊操作。

目前專案的模型循環實際使用 Pi 套件；這次保留模型、對話恢復、AGENTS.md／skills 與跨 tab agent 能力。Pi-like／Herdr-like 操作設計的行為參考，與實際依賴授權分別記錄於 [CREDITS.md](../CREDITS.md)。

## 已確認的上游條件

- npm 查得候選版本為 `just-bash@3.6.0`，授權為 Apache-2.0；整合時固定完整版本與 lockfile。
- 套件提供 `just-bash/browser` 入口，支援自訂 `IFileSystem` 與 commands。[package.json](https://github.com/vercel-labs/just-bash/blob/main/packages/just-bash/package.json)、[browser 入口](https://github.com/vercel-labs/just-bash/blob/main/packages/just-bash/src/browser.ts)
- filesystem 介面除了讀寫與目錄，還包含 append、copy、move、bytes、mode、mtime、links 等；現有 VFS 不能僅靠名稱對應就完整接上。[介面](https://github.com/vercel-labs/just-bash/blob/main/packages/just-bash/src/fs/interface.ts)
- `exec()` 預設隔離每次呼叫的 shell 狀態；同一個 Bash instance 不代表互動 shell 狀態會自動延續。[執行行為](https://github.com/vercel-labs/just-bash/blob/main/packages/just-bash/README.md#quick-start)
- 上游 browser 入口對壓縮指令另有 Node API 限制註解。因此 browser 指令支援表以固定版本的實際 build／執行驗證為準，不直接沿用 Node 功能清單。
- 已讀取 npm 3.6.0 tarball 的型別與檔案清單：含 `package/LICENSE`，未找到名稱為 NOTICE 的檔案。正式採用時再次核對發行包與實際納入的相依套件。

## 架構決定

```text
人類 shell 輸入 ──┐
                 ├─ ShellRuntime → just-bash（隔離 Worker）
AI 的 bash tool ─┘                       │ filesystem RPC
                                        ▼
                            同一份 Workspace VFS
                          IndexedDB、revision、交易
                                        ▲
                     read／write／skills／preview／未來 editor
```

每個 app tab 擁有自己的 runtime 與 cwd，同 workspace 的檔案共用。AI 執行使用 run-bound context，不與人類 shell 共用可變的執行狀態。跨瀏覽器頁面／popup 以 IndexedDB 為真實資料來源；不建立另一份記憶體檔案樹再於指令結束後同步回去。

just-bash 的 filesystem adapter 負責格式與錯誤轉換；交易、revision、配額與原子操作放在 VFS，讓所有呼叫端有一致行為。現有文字工具可以透過 UTF-8 facade 讀寫新的 byte storage。

## 執行順序與交付條件

### P0：固定版本與瀏覽器概念驗證

1. 在獨立驗證入口安裝固定版本，確認 Vite production build、Worker、GitHub Pages base path 與 embed 載入。
2. 先使用上游 InMemoryFs 跑引號、Unicode、pipe、redirect、glob、heredoc、條件與迴圈；再以最小 IndexedDB adapter 跑 create／read／append／reload。
3. 檢查 constructor 的 filesystem 初始化、必要系統目錄、實際呼叫的方法、browser 不支援的命令與 bundle 大小。
4. 驗證取消、輸出／步數／時間上限；記錄 `exec()` 回傳 env 與 cwd 取得方式，不假設 `getCwd()` 就是最後一次指令的位置。

完成條件：真實瀏覽器能用 just-bash 寫檔並重載讀回；確認正式 adapter 與狀態管理所需接口。這一步完成後校正其餘估時。

### P1：調整 VFS 儲存與交易

1. 檔案內容改為 bytes，可保存 `Uint8Array`；另提供明確 UTF-8 文字讀寫給 tools、AGENTS.md、skills 與預覽。二進位內容不可靜默轉成損壞文字。
2. 保留 metadata／contents 分開儲存、workspace 隔離、精確 key／目錄 index、revision、配額與交易回滾。size 依實際 bytes 計算，stat／list 不讀正文。
3. 補原子 `append`、exclusive create、copy 與符合 shell 用途的 replace／rename；append 的讀取與寫回在同一個儲存交易完成，避免兩個 tabs 互相覆蓋。
4. 補 mode 與 mtime 的儲存／更新，定義 mkdir、touch、cp、mv、rm 的檔案與目錄邊界。mode 為虛擬 metadata；第一版不建置多使用者／owner 系統。
5. schema 變更明列新的版本與開發資料處理方式。沿用本專案不維護舊格式 migration 的方向，使用明確的新 workspace／storage namespace；不在啟動時偷偷清空既有工作區。

完成條件：bytes 往返正確、並行 append 無遺失、revision 衝突可辨識、超額整筆回滾；小檔覆寫不掃其他檔案正文。

### P2：實作 just-bash filesystem adapter

| 介面範圍 | 決定 |
|---|---|
| `readFile`／`readFileBuffer`／`writeFile`／`appendFile` | 接 VFS bytes 與 encoding；維持 metadata、配額及 revision |
| `stat`／`lstat`／`readdir`／`exists` | 轉換 VFS metadata 與 ENOENT、EEXIST、ENOTDIR 等錯誤 |
| `mkdir`／`rm`／`cp`／`mv` | 優先呼叫 VFS 原子操作；不在 adapter 複製整份 workspace |
| `chmod`／`utimes` | 更新真實保存的虛擬 metadata |
| `symlink`／`readlink`／`realpath` | 第一版納入 symbolic links；限制循環／深度，解析各層路徑 |
| `link` | hard links 延後，明確回報不支援；不以 copy 假裝相容 |
| `createExclusive` | 對接原子建立，供 mktemp 等用途 |
| `getAllPaths()` | 注意此方法為同步例外；P0 確認熱路徑是否依賴。若需索引，只快取路徑 metadata，跨 instance 變更須失效／刷新，不能同步讀 IndexedDB |

路徑模型採 workspace 內的虛擬 `/`，預設 cwd／HOME 保持 `/home/user`。目前「所有路徑必須在 home 下」的限制需要改寫；`/` 永遠是工作區根，不能接到宿主磁碟。`/bin`、`/usr/bin` 的命令 stub 與 `/tmp` 暫存由 runtime 管理；優先使用上游 MountableFs，P0 確認初始化及跨 mount 操作行為。一般工作檔案由持久化 VFS 負責。

skills／rules 的搜尋仍有明確工作區範圍，不能因 cwd 在 `/tmp` 就遺失 home 規則，也不能沿路讀到其他 workspace。預覽繼續限制在其允許的工作檔案範圍。

完成條件：上表支援項目有整合案例；未支援項目明確失敗；相對／絕對路徑、`..`、symlink、跨 mount 與 reload 的結果一致。

### P3：接入 ShellRuntime 與終端

1. 新增 shell runtime／Worker／VFS RPC，直接將使用者整段輸入交給 just-bash。移除舊 parser 的前置處理；命令與變數大小寫採上游規則。
2. Worker 不持有 provider key 或宿主 DOM；VFS RPC 綁定 workspace、tab／run identity、取消與配額。沿用現有隔離執行的原則，重新驗證 bundle 載入方式與 CSP。
3. 結果分別呈現 stdout、stderr、exitCode。Stop 能終止 Worker，late RPC 不再接受；已開始提交的寫入仍可能成功，結果不確定時讀回確認。
4. 第一版每次送出視為一段獨立 script：該段內支援上游變數、函式與控制流程；跨次輸入僅保留已驗證取得的 cwd。變數、函式、alias、shell options 與 `$?` 不承諾跨送出延續。這項限制直接寫進 help。
5. tab 的 cwd 隨 workspace layout 保存，reload 還原 cwd；不還原執行中的程式。完整互動 shell session 可另訂下一階段，不靠存取上游 private state 實作。
6. 保留最小 shell／AI 切換入口，可用 UI 操作；不要求重建舊 `ai --new`、`history` 或 editor CLI。對話歷史操作留在 app 層，避免與 shell 的同名 builtins 衝突。

完成條件：兩個 tabs 共用檔案而 cwd 分離；手機／popup 可輸入、看錯誤與 Stop；無限迴圈可中止，reload 保存檔案與 cwd。

### P4：讓 AI 使用相同 shell 與 VFS

1. 註冊 `bash` 工具，參數為 script 及受限執行選項，回傳 stdout／stderr／exitCode；使用同一 adapter 與限制。
2. 先保留 AI 的結構化 read／write／edit、skill_load、agents、read_host_page；更新其 VFS 型別。它們不需要延續舊 shell 的同名 CLI 行為。
3. 讓 bash 的實際讀寫也留下路徑與 revision 紀錄。讀取檔案不等於模型看到了全文；搜尋、head、pipe 產生的輸出不能錯標成完整 read。
4. 更新 system prompt、工具 help、取消與副作用處理；shell 的 `read`／`help` 採上游定義，不再轉去舊 JSON 工具。
5. `~/bin` 可編輯 JS 工具若暫留，仍經既有 sandbox／capabilities 執行；不能直接把使用者 JS 當作 trusted custom command 放入宿主。CLI bridge 及人類特殊工具的重做另排。

完成條件：AI 用 bash 建檔／搜尋／修改，結構化工具可立即讀到；反向亦同。Stop／重連／恢復不會重播寫入；跨 tab agents 與宿主讀取維持原有來源身份。

### P5：移除舊實作、驗收與發布文件

1. 移除舊 `shell.ts`、`shell-command.ts` 的解析／執行邏輯，以及過時 command definitions、help、大小寫與 JSON CLI 相容測試。共用能力依用途移至新模組，不保留雙引擎 fallback。
2. 人類 editor 與相關入口可退出本階段；清掉失效 UI、未使用程式與說明。預覽、對話與 skills 等仍使用的 VFS 呼叫端一起調整。
3. 更新 README、bin 文件、主計畫、SDK exports 與瀏覽器 runner；將 editor 重做列為後續項目。
4. 在 production app、embed／popup 驗證 IndexedDB 真實交易、Worker、reload 與 workspace 隔離；不只依賴 MemoryFileSystem／fake-indexeddb。
5. `npm test`、typecheck、build、verify:dist 通過；模型 smoke 另列實際成功／失敗／未執行，不將 quota 失敗列為通過。

完成條件：只有 just-bash shell 路徑，VFS／AI 主路徑可用，沒有舊入口指向已移除功能。

## 必須通過的代表案例

```sh
mkdir -p ~/docs && cd ~/docs
printf 'hello\n世界\n' > notes.txt
cat notes.txt | grep hello > matches.txt
printf 'more\n' >> notes.txt
cat *.txt | wc -l
test -f matches.txt && echo ok
cat <<'EOF' > literal.txt
$HOME is literal here
EOF
for f in *.txt; do echo "$f"; done
```

另外驗證：Unicode bytes／二進位往返、兩 tab 同檔 append、重新開啟後讀回、shell 與 AI 交叉讀寫、skill 引用檔、symbolic link／循環、超額回滾、取消時已提交檔案，以及 stat／list 不讀正文。小範圍語法案例可與本機 Bash／sh 對照，只比較宣告支援的行為。

## 授權與行為參考的交付

just-bash 的 [LICENSE](https://github.com/vercel-labs/just-bash/blob/main/packages/just-bash/LICENSE) 是 Apache-2.0。接入時提供完整授權副本、保留適用聲明；有修改上游檔案時標明修改，發行包若有 NOTICE 則保留適用內容。這些文件要隨 production dist／GitHub Pages 一起交付，不能只有 repo README 的連結。[條款第 4 節](https://www.apache.org/licenses/LICENSE-2.0.txt)

實作時新增 `public/licenses/` 與第三方聲明索引，記錄固定版本、來源與實際發行依賴；dist 檢查確認這些檔案存在。專案自有程式沿用現有 MIT LICENSE；第三方保留各自授權。

Pi-like／Herdr-like 的操作模式依使用者說明列為行為參考，致謝不表示使用了其全部產品程式。現有 `@earendil-works/pi-agent-core` 與 `@earendil-works/pi-ai` 0.84.4 是實際 MIT 依賴，須另附其版權與授權聲明；不能只列為靈感。以 [Pi v0.84.4 LICENSE](https://github.com/earendil-works/pi/blob/v0.84.4/LICENSE) 為來源。

## 粗估與後續

P0 約半天至一天；P1–P2 的 VFS／adapter 約三至五天；P3–P5 的 runtime、AI、移除舊程式及驗收約二至四天。完整交付先抓 **6–10 個工程天**，P0 後再校正。這比最早只補最小 shell 的估算大，新增工作主要是 bytes 儲存、原子操作、路徑模型與隔離 runtime。

本階段延後：人類 editor 重做、完整跨輸入 shell session、hard links、多使用者權限、Node／Python 執行、網路指令及任意系統 binary。這些不阻擋 just-bash 與持久化 VFS 的第一版整合。
