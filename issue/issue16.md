# Issue 16 — MAGI VISUAL BOARD 在 chat bubble 內排版崩潰、互相重疊

## 嚴重度
Medium（功能仍可用，但 MAGI 模式進行中畫面幾乎無法閱讀）

## 觀察到的問題
S.C. MAGI 模式啟動後，三賢人 unit card / 中央 `MAGI 討論中` core / 左側「提訴」/ 右側「情報」面板會**互相重疊堆疊**，使用者看不到誰在思考、看不到目前 round 數、也看不到中央決議框。

實際畫面（使用者回報）：
- 中央 `MAGI / 討論中 / 三賢人同時表決 / <user question>` 卡片直接蓋在某個 unit card 上方
- `情報 / THREE SYSTEMS THINKING / ROUND 1` 跟頂部 unit card 互疊
- 上方 `Waiting for all three systems` 文字被裁掉
- 三個 unit card 沒有清楚的三角排列

## 根因
`src/app/styles.css:1644-1810` 的 `.magi-grid` 排版完全靠 **absolute positioning + 固定 px 寬高**：

```css
.magi-grid             { min-height: 620px; position: relative; }
.magi-side-left        { position: absolute; left: 16px;  top: 16px; width: 170px; }
.magi-side-right       { position: absolute; right: 16px; top: 16px; width: 190px; }
.magi-unit             { width: 300px; height: 208px; }
.magi-unit.top         { position: absolute; left: 50%; top: 18px; transform: translateX(-50%); }
.magi-unit.left        { position: absolute; left: 44px;  bottom: 28px; }
.magi-unit.right       { position: absolute; right: 44px; bottom: 28px; }
.magi-center-core      { position: absolute; left: 50%; top: 50%; transform: translateX(-50%); width: 210px; }
```

問題：
1. **三角排列假設容器寬 ≥ ~720px**：top unit (300px) 置中 + left/right unit 各 300px @ left/right 44px → 至少要 `300 + 44 + 300 + 44 + 300 ≈ 988px` 才不疊（理想 720px+ 才勉強）。
2. **Responsive breakpoint 用 viewport `max-width: 880px`**（styles.css:2022），但 MAGI panel 是渲染在 **chat bubble 容器**內。chat bubble 寬度上限 `min(780px, 100%)`，且 chat panel 兩側有 padding / sidebar — 桌機 viewport 1440px 時，chat bubble 寬度可能只有 ~520px。 **viewport > 880px 但 panel 容器 < 720px** 就直接掉進排版地獄。
3. **`min-height: 620px` 寫死**：手機版 fallback 用 grid stack 後，固定高度沒拿掉（雖然 styles.css:2024 有 `min-height: auto`，但仍會在中等寬度 stuck）。
4. **`.magi-center-core` `top: 50%` translate 置中**：當容器內所有 absolute item 都疊到同一區，core 還是會再蓋一層 z-index: 1 上去。

## 來源檔案
- `src/app/styles.css:1644-1810`、`2022-2050`（MAGI 排版）
- `src/ui/ChatPanel.tsx:322-420`（`MagiPanel` component，排版 markup 來自此）

## 建議做法

### 短期（半天，CSS-only 即可）
1. **改用 container-aware breakpoint**：把 `@media (max-width: 880px)` 改成 `@container (max-width: 880px)` 並對 `.magi-panel` 加 `container-type: inline-size`。
2. **拿掉 `min-height: 620px`**：`.magi-grid` 高度由內容決定，避免大空白。
3. **預設改 CSS Grid 排列**，把 absolute positioning 改成 grid template areas：

```css
.magi-grid {
  display: grid;
  grid-template-columns: minmax(140px, 1fr) minmax(220px, 2fr) minmax(140px, 1fr);
  grid-template-rows: auto auto auto;
  grid-template-areas:
    "left   top    right"
    "left   center right"
    "casper center melchior";
  gap: 12px;
  padding: 14px;
}
.magi-side-left  { grid-area: left;  }
.magi-side-right { grid-area: right; }
.magi-unit.top      { grid-area: top;     }
.magi-unit.left     { grid-area: casper;  }
.magi-unit.right    { grid-area: melchior;}
.magi-center-core   { grid-area: center; position: static; transform: none; }
.magi-unit { width: 100%; height: auto; min-height: 200px; }
```

4. **窄容器（< 720px）改單欄堆疊**：

```css
@container (max-width: 720px) {
  .magi-grid {
    grid-template-columns: 1fr;
    grid-template-areas:
      "left"
      "top"
      "center"
      "casper"
      "melchior"
      "right";
  }
}
```

5. **clip-path 改 border-radius**：`.magi-unit-card` 的六角形 `clip-path` 在窄寬度切到內容（`-webkit-line-clamp: 5` 已經會吃字），可考慮 ≤ 720px 時改回普通圓角避免雙重裁切。

### 中期
- 把 MAGI panel 抽到獨立 component 檔（`src/ui/MagiPanel.tsx`），目前 ~120 行排版 markup 在 ChatPanel 裡很難維護。
- 加 storybook-style fixture：`scripts/dev-magi-fixtures.tsx` 用 mock state 跑 4 種寬度（mobile / tablet / chat-bubble / desktop）截圖比對。
- 加 visual regression test（例如 Playwright + percy / loki）。

## 驗收條件
- 桌機 viewport 1440px、chat bubble 寬度 ~520px 時：三 unit card + 中央 core + 左右側欄不重疊
- 手機 viewport 375px 時：所有元素垂直堆疊，無水平 overflow
- `MAGI / 討論中` 中央 card 不會蓋在 unit card 上
- transcript / summary 區塊不被遮擋
- `npm run lint`、`npm test`、`npm run build` 仍綠

## 不要做的事
- 不要為了修這個 bug 順手把 MAGI panel 內容刪減（資訊密度本來就高，這是設計）
- 不要把責任丟給 viewport breakpoint — chat bubble 容器才是真實寬度來源
- 不要硬寫 `width: 100%` 把所有東西塞滿，會破壞桌機原本的三角觀感

## 關聯
- 屬於 [BATCH7](BATCH7.md)
- 與 [issue 1](issue1.md)（拆 App.tsx）正交但相關 — 中期建議的「抽 MagiPanel.tsx」可以併入 issue 1 的 Phase A.2「抽超大 inline UI 區塊」一起做
