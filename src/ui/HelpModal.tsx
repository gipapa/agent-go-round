import React from "react";

export default function HelpModal(props: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="help-modal-backdrop" role="presentation">
      <div className="help-modal-shell" role="dialog" aria-modal="true" aria-label={props.title}>
        <div className="help-modal-card">
          <div className="help-modal-title">{props.title}</div>
          <div className="help-modal-body">{props.children}</div>
          <div className="help-modal-actions">
            <button type="button" onClick={props.onClose} className="help-modal-close-btn">
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
