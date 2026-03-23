export default function LandingPage(props: {
  onStart: () => void;
  onStartTutorial: () => void;
}) {
  return (
    <div className="landing-shell">
      <div className="landing-backdrop-shape one" aria-hidden="true" />
      <div className="landing-backdrop-shape two" aria-hidden="true" />
      <div className="landing-card">
        <div className="landing-kicker">Browser-first · Frontend-only</div>
        <h1 className="landing-title">Agent Go Round</h1>
        <p className="landing-copy">
          Manage agents, docs, MCP tools, built-in tools, skills, and chat history directly in the browser. No required backend,
          just a clean workspace for experimenting with agent workflows.
        </p>
        <p className="landing-copy zh">
          直接在瀏覽器中管理 agent、文件、MCP tools、built-in tools、skills 與對話歷史。這是一個純前端、偏實驗型的 agent playground，
          適合快速建立 workflow、驗證 use case，並部署到 GitHub Pages。
        </p>

        <div className="landing-actions">
          <button type="button" className="landing-primary-btn" onClick={props.onStart} data-tutorial-id="landing-start">
            開始使用
          </button>
          <button type="button" className="landing-secondary-btn" onClick={props.onStartTutorial} data-tutorial-id="landing-start-tutorial">
            使用案例教學
          </button>
        </div>
      </div>
    </div>
  );
}
