import React from "react";
import { createPortal } from "react-dom";

export default function HelpModal(props: {
  title?: string;
  onClose: () => void;
  children: React.ReactNode;
  width?: string;
  height?: string;
  hideTitle?: boolean;
  footer?: React.ReactNode | null;
  padless?: boolean;
}) {
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") props.onClose();
    };

    document.body.classList.add("help-modal-open");
    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.classList.remove("help-modal-open");
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [props.onClose]);

  return createPortal(
    <div className="help-modal-backdrop" role="presentation" style={backdropStyle}>
      <div
        className="help-modal-shell"
        role="dialog"
        aria-modal="true"
        aria-label={props.title ?? "Modal"}
        style={{ ...shellStyle, width: props.width ?? shellStyle.width }}
      >
        <div
          className="help-modal-card"
          style={{
            ...cardStyle,
            ...(props.height ? { height: props.height, maxHeight: props.height } : null),
            ...(props.padless ? { padding: 0, overflow: "hidden" } : null)
          }}
        >
          {!props.hideTitle && props.title ? (
            <div className="help-modal-title" style={titleStyle}>
              {props.title}
            </div>
          ) : null}
          <div
            className="help-modal-body"
            style={{
              ...bodyStyle,
              ...(props.padless
                ? {
                    paddingRight: 0,
                    fontSize: "inherit",
                    lineHeight: "inherit",
                    display: "flex",
                    flex: 1
                  }
                : null)
            }}
          >
            {props.children}
          </div>
          {props.footer === null ? null : (
            <div className="help-modal-actions" style={actionsStyle}>
              {props.footer ?? (
                <button type="button" onClick={props.onClose} className="help-modal-close-btn" style={closeBtnStyle}>
                  Close
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

const backdropStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 24,
  background: "rgba(4, 8, 16, 0.76)",
  backdropFilter: "blur(8px) saturate(0.8)",
  WebkitBackdropFilter: "blur(8px) saturate(0.8)",
  zIndex: 9999
};

const shellStyle: React.CSSProperties = {
  width: "min(460px, calc(100vw - 36px))"
};

const cardStyle: React.CSSProperties = {
  width: "100%",
  maxHeight: "calc(100vh - 48px)",
  padding: "18px 18px 16px",
  borderRadius: 18,
  border: "1px solid rgba(91, 123, 255, 0.22)",
  background: "linear-gradient(145deg, rgba(15, 19, 32, 0.98), rgba(17, 22, 36, 0.96))",
  boxShadow: "0 22px 60px rgba(0, 0, 0, 0.44), 0 0 0 1px rgba(255, 255, 255, 0.04) inset",
  color: "var(--text)",
  display: "flex",
  flexDirection: "column"
};

const titleStyle: React.CSSProperties = {
  fontSize: 16,
  fontWeight: 900,
  marginBottom: 10
};

const bodyStyle: React.CSSProperties = {
  fontSize: 12,
  lineHeight: 1.6,
  overflowY: "auto",
  minHeight: 0,
  paddingRight: 6
};

const actionsStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  marginTop: 14
};

const closeBtnStyle: React.CSSProperties = {
  padding: "8px 12px",
  borderRadius: 12,
  border: "1px solid var(--border)",
  background: "var(--panel-2)",
  color: "var(--text)"
};
