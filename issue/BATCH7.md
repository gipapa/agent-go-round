# Batch 7 — UI Layout Fixes（半天 ~ 1 天）

## 包含 Issues
- **Issue 16** — MAGI VISUAL BOARD 在 chat bubble 容器內排版崩潰、元素互相重疊

## 為何單獨成 batch
這是純 CSS / 小範圍 component 排版問題，跟 BATCH6（拆 App.tsx + vault wiring + integration tests）完全正交：
- 不需要拆 component 邊界
- 不動 storage / runtime / orchestrator
- 不需要 integration test 護欄
- 影響使用者「立即看得到」的核心模式（MAGI）

跟 BATCH6 綁在一起會被卡住。獨立小 PR 即可上線。

## 工作量
半天 ~ 1 天（含視覺手動驗證 4 種寬度）

## 風險
低 — 只動 `src/app/styles.css` 的 `.magi-*` 區塊與 `MagiPanel` markup 局部，沒動邏輯。但要小心：
- 不要影響到非 MAGI 模式的 chat bubble 排版
- 桌機原本的三角形觀感盡量保留

## 前置依賴
無。獨立可做。

## 執行步驟

### Step 1 — CSS Grid 重寫 `.magi-grid`（半天）
照 issue 16 的建議：
1. `.magi-panel` 加 `container-type: inline-size`
2. `.magi-grid` 改 CSS Grid + grid-template-areas，拿掉 absolute positioning 與 `min-height: 620px`
3. `.magi-center-core` 改 `position: static`、`transform: none`
4. `.magi-unit { width: 100%; height: auto; min-height: 200px }`
5. 加 `@container (max-width: 720px)` 改單欄堆疊
6. 視窄版需要決定要不要在 ≤ 720px 拿掉 `clip-path` 六角形

### Step 2 — 手動驗證 4 種寬度
- viewport 1920×1080，chat bubble 寬約 720px → 三角排列正常
- viewport 1440×900，chat bubble 寬約 520px → 進入容器 breakpoint，單欄
- viewport 768×1024（iPad），chat bubble 寬約 700px → 桌機排列或剛好切換
- viewport 375×812（iPhone），chat bubble 寬約 320px → 完全單欄、無水平 overflow

### Step 3 — 抓四張截圖貼到 PR description
方便未來 visual regression。

## 驗收條件（同 issue 16）
- 1440px viewport / chat bubble 520px：三 unit card + 中央 core + 左右側欄不重疊
- 375px viewport：所有元素垂直堆疊、無水平 overflow
- `MAGI / 討論中` 中央 card 不再蓋在 unit card 上
- `npm run lint`、`npm test`、`npm run build` 仍綠

## 不要做的事
- 不要在這個 batch 同時抽 `MagiPanel.tsx`（那是 issue 1 / BATCH6 範圍）
- 不要動 `MagiRenderState` / orchestrator 訊號（純 view 層問題）
- 不要為了修排版加 viewport-based breakpoint，要用 container query
