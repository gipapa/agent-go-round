import { Component, type ErrorInfo, type ReactNode } from "react";

type ErrorBoundaryProps = {
  children: ReactNode;
  fallback?: (error: Error, reset: () => void) => ReactNode;
  onError?: (error: Error, info: ErrorInfo) => void;
};

type ErrorBoundaryState = {
  error: Error | null;
};

export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.props.onError?.(error, info);
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  private reset = () => {
    this.setState({ error: null });
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    if (this.props.fallback) {
      return this.props.fallback(error, this.reset);
    }

    return (
      <div
        role="alert"
        style={{
          display: "grid",
          gap: 12,
          padding: 24,
          borderRadius: 18,
          border: "1px solid rgba(255,140,155,0.36)",
          background: "rgba(255,140,155,0.08)",
          color: "var(--text)"
        }}
      >
        <div style={{ fontWeight: 800, color: "var(--danger)" }}>Render failed</div>
        <div style={{ fontSize: 13, lineHeight: 1.6, opacity: 0.82 }}>
          This section crashed while rendering. The rest of the app is still available.
        </div>
        <pre
          style={{
            margin: 0,
            maxHeight: 220,
            overflow: "auto",
            whiteSpace: "pre-wrap",
            fontSize: 12,
            lineHeight: 1.5
          }}
        >
          {String(error.stack ?? error.message ?? error)}
        </pre>
        <button type="button" onClick={this.reset} style={{ justifySelf: "start" }}>
          Try again
        </button>
      </div>
    );
  }
}
