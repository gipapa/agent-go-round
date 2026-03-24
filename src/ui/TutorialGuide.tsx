import { TutorialScenarioDefinition, TutorialStepEvaluation } from "../onboarding/types";

export default function TutorialGuide(props: {
  scenario: TutorialScenarioDefinition;
  currentStepIndex: number;
  evaluations: TutorialStepEvaluation[];
  activeAgentName: string;
  lockedAgentLabel?: string | null;
  activeAgentWarning?: string | null;
  onAdvance: () => void;
  onSkip: () => void;
  onExit: () => void;
}) {
  const step = props.scenario.steps[props.currentStepIndex];
  const evaluation = props.evaluations[props.currentStepIndex];

  return (
    <aside className="tutorial-sidebar" data-onboarding-surface="sidebar">
      <div className="tutorial-sidebar-topline">
        <div className="tutorial-sidebar-kicker">案例教學</div>
        <div className="tutorial-agent-chip" data-onboarding-surface="agent">
          <span className="tutorial-agent-chip-label">Active Agent</span>
          <span className="tutorial-agent-chip-name">{props.activeAgentName}</span>
        </div>
      </div>
      <div className="tutorial-sidebar-title">{props.scenario.title}</div>
      <div className="tutorial-sidebar-copy">{props.scenario.description}</div>
      {props.lockedAgentLabel || props.activeAgentWarning ? (
        <div className="tutorial-agent-inline-note">
          {props.lockedAgentLabel ? <span>{props.lockedAgentLabel}</span> : null}
          {props.activeAgentWarning ? <span className="tutorial-agent-inline-warning">{props.activeAgentWarning}</span> : null}
        </div>
      ) : null}

      <div className="tutorial-checklist" data-onboarding-surface="checklist">
        {props.scenario.steps.map((item, index) => {
          const itemEvaluation = props.evaluations[index];
          const locked = index > props.currentStepIndex;
          const current = index === props.currentStepIndex;
          return (
            <div
              key={item.id}
              className={`tutorial-check-item ${itemEvaluation?.completed ? "done" : ""} ${current ? "current" : ""} ${locked ? "locked" : ""}`}
              data-onboarding-step={item.id}
            >
              <div className="tutorial-check-badge">{itemEvaluation?.completed ? "✓" : index + 1}</div>
              <div className="tutorial-check-content">
                <div className="tutorial-check-title">{item.checklistLabel}</div>
                <div className="tutorial-check-status">
                  {itemEvaluation?.completed ? "已完成" : current ? "進行中" : locked ? "尚未開始" : "待處理"}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <section className="tutorial-prompt-inline" data-onboarding-surface="prompt">
        <div className="tutorial-prompt-step">Step {props.currentStepIndex + 1}</div>
        <div className="tutorial-prompt-title compact">{step.instructionTitle}</div>
        <div className="tutorial-prompt-body compact tutorial-prompt-body-pre">{step.instructionBody}</div>
        {evaluation?.statusText ? <div className="tutorial-prompt-status">{evaluation.statusText}</div> : null}
        <div className="tutorial-prompt-actions compact">
          <button type="button" className="tutorial-next-btn" onClick={props.onAdvance} disabled={!evaluation?.canContinue} data-tutorial-id="tutorial-next">
            {step.actionLabel ?? (evaluation?.completed ? "下一步" : "等待完成")}
          </button>
        </div>
      </section>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button type="button" className="tutorial-exit-btn" onClick={props.onExit} data-tutorial-id="tutorial-exit">
          離開教學
        </button>
        <button type="button" className="tutorial-exit-btn" onClick={props.onSkip} data-tutorial-id="tutorial-skip-case">
          略過案例
        </button>
      </div>
    </aside>
  );
}
