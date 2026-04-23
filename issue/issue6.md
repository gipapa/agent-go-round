# Issue 6 — 整個 App 沒有 React Error Boundary

## 嚴重度
High

## 觀察到的問題
搜尋整個 `src/` 找不到任何 `ErrorBoundary` 或 `componentDidCatch` 實作：

- `src/main.tsx` 直接 `<App />` 包進 `<React.StrictMode>`，無錯誤邊界
- 任何子 component / modal / panel 內未捕獲的 render 錯誤，會把整個 React tree 拆掉，使用者看到白畫面
- 對一個重度依賴 model 動態輸出、tool runtime 動態執行 user-defined script 的 app 來說，runtime exception 機率很高：
  - `runBuiltInScriptTool()` 用 `new Function(...)` 執行使用者 JS，丟錯會冒泡
  - skill / tutorial 內的 step.expect 解析錯誤
  - MCP server 回傳 unexpected shape 觸發 normalize → render 出乎意料的物件
  - localStorage / IndexedDB 反序列化壞資料

## 來源檔案
- `src/main.tsx`（root mount）
- `src/app/App.tsx`（root component）
- 整個 `src/ui/` 內的 panel / modal 都沒包

## 建議做法

### 1. 新增 `src/ui/ErrorBoundary.tsx`
```tsx
import { Component, ReactNode } from "react";

type Props = { children: ReactNode; fallback?: (err: Error, reset: () => void) => ReactNode; onError?: (err: Error, info: { componentStack: string }) => void };
type State = { error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    this.props.onError?.(error, info);
    // 可串到 logger / settings store
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  reset = () => this.setState({ error: null });

  render() {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback(this.state.error, this.reset);
      return (
        <div style={{ padding: 24, color: "var(--danger)" }}>
          <h2>Something went wrong.</h2>
          <pre style={{ whiteSpace: "pre-wrap", fontSize: 12 }}>{String(this.state.error?.stack ?? this.state.error)}</pre>
          <button onClick={this.reset}>Try again</button>
        </div>
      );
    }
    return this.props.children;
  }
}
```

### 2. 在 `main.tsx` 包 root
```tsx
<ErrorBoundary>
  <App />
</ErrorBoundary>
```

### 3. 在 risky 區塊額外包一層
重點區塊建議獨立保護，避免一個 modal 的 bug 把整個 chat 也拆掉：
- 每個 `HelpModal` 內容
- `ChatPanel`、`SkillsPanel`、`McpPanel`
- `runBuiltInScriptTool()` 的執行結果 render

例如：
```tsx
<ErrorBoundary fallback={(err, reset) => <ToolErrorView error={err} onRetry={reset} />}>
  <ToolOutputView output={toolOutput} />
</ErrorBoundary>
```

### 4. 把錯誤接到既有 log 系統
把 `componentDidCatch` 的 error 透過已存在的 `logNow({ category: "render_error", ... })` 寫入，方便事後檢查。

### 5. （可選）加一個全域 `window.onerror` / `unhandledrejection` 監聽
async exception 不會被 ErrorBoundary 抓到，需要另外處理：

```ts
window.addEventListener("unhandledrejection", (ev) => {
  console.error("[unhandledrejection]", ev.reason);
  // log 起來
});
```

## 影響
- 任何子元件 render error 都會白畫面，使用者完全沒救援路徑
- 對 user-defined built-in tool / skill 這類動態程式碼特別致命
- 上線後 debug 困難，沒有錯誤快照
