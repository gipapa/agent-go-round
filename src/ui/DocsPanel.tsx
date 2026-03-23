import React from "react";
import { DocItem } from "../types";
import HelpModal from "./HelpModal";

export default function DocsPanel(props: {
  docs: DocItem[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onCreate: () => Promise<DocItem | null>;
  onSave: (d: DocItem) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [showHelp, setShowHelp] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [editingDocId, setEditingDocId] = React.useState<string | null>(null);
  const [docDraft, setDocDraft] = React.useState<DocItem | null>(null);

  const selected = props.docs.find((d) => d.id === props.selectedId) ?? props.docs[0] ?? null;
  const editingDoc = props.docs.find((d) => d.id === editingDocId) ?? null;

  React.useEffect(() => {
    if (!selected && props.selectedId) {
      props.onSelect(null);
      return;
    }
    if (!props.selectedId && props.docs[0]) {
      props.onSelect(props.docs[0].id);
    }
  }, [props.docs, props.onSelect, props.selectedId, selected]);

  function openEditor(doc: DocItem) {
    setEditingDocId(doc.id);
    setDocDraft({ ...doc });
    setError(null);
  }

  function closeEditor() {
    setEditingDocId(null);
    setDocDraft(null);
  }

  async function createDoc() {
    setError(null);
    const created = await props.onCreate();
    if (!created) return;
    props.onSelect(created.id);
    openEditor(created);
  }

  async function saveDoc() {
    if (!docDraft) return;
    if (!docDraft.title.trim()) {
      setError("Title is required.");
      return;
    }
    setError(null);
    await props.onSave({ ...docDraft, title: docDraft.title.trim() });
    closeEditor();
  }

  async function deleteDoc(id: string) {
    setError(null);
    await props.onDelete(id);
    if (props.selectedId === id) {
      const next = props.docs.find((doc) => doc.id !== id) ?? null;
      props.onSelect(next?.id ?? null);
    }
  }

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ fontWeight: 800, fontSize: 18 }}>Docs</div>
        <button type="button" onClick={() => setShowHelp(true)} title="Docs 使用說明" aria-label="Docs 使用說明" style={helpBtn}>
          ?
        </button>
        <button onClick={() => void createDoc()} style={{ ...btnSmall, marginLeft: "auto" }} data-tutorial-id="docs-new-button">
          + New
        </button>
      </div>

      {showHelp ? (
        <HelpModal title="Docs 使用說明與測試方式" onClose={() => setShowHelp(false)}>
          <div style={helpText}>
            在 `normal talking` 模式中，該 agent 被允許使用的文件內容會先被整理後注入 system context，再送給模型。
          </div>
          <div style={{ ...helpText, marginTop: 8 }}>
            這代表 Docs 目前的用途比較接近「把文件當成額外上下文提示」；它不是向量檢索，也不是 tool calling。
          </div>
          <div style={{ ...helpText, marginTop: 8 }}>
            測試方式：
            <br />
            1. 建立一份內容明確的文件，例如 `彩蛋碼是 42`
            <br />
            2. 到 `Agents` 頁讓目標 agent 取得這份文件的使用權限
            <br />
            3. 回到 `Chat`，用 `normal talking` 詢問 `根據文件，彩蛋碼是多少？`
            <br />
            4. 如果設定正確，模型就應該能根據文件內容回答
          </div>
        </HelpModal>
      ) : null}

      <div style={{ display: "grid", gap: 8 }}>
        {props.docs.length === 0 ? <div style={{ fontSize: 12, opacity: 0.7 }}>No docs yet.</div> : null}
        {props.docs.map((doc) => {
          const active = doc.id === selected?.id;
          return (
            <div
              key={doc.id}
              style={{
                padding: 12,
                borderRadius: 14,
                border: active ? "1px solid var(--primary)" : "1px solid var(--border)",
                background: active ? "rgba(91, 123, 255, 0.12)" : "var(--bg-2)",
                color: "var(--text)"
              }}
            >
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <button type="button" onClick={() => props.onSelect(doc.id)} style={rowButtonStyle}>
                  <div style={{ fontWeight: 700 }}>{doc.title}</div>
                  <div style={{ fontSize: 12, opacity: 0.74, marginTop: 4 }}>{new Date(doc.updatedAt).toLocaleString()}</div>
                </button>
                {active ? (
                  <div style={{ display: "flex", gap: 8, marginLeft: "auto", flexWrap: "wrap" }}>
                    <button type="button" onClick={() => openEditor(doc)} style={btnSmall}>
                      Edit
                    </button>
                    <button type="button" onClick={() => void deleteDoc(doc.id)} style={btnDangerSmall}>
                      Delete
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ opacity: 0.7, fontSize: 12 }}>選擇一份文件後可編輯；要讓 agent 使用哪些文件，請到 `Agents` 頁設定權限。</div>
      {error ? <div style={errorText}>{error}</div> : null}

      {editingDoc ? (
        <HelpModal title={`Edit Doc: ${editingDoc.title}`} onClose={closeEditor} width="min(820px, calc(100vw - 48px))" footer={null}>
          <div style={{ display: "grid", gap: 12 }}>
            <div>
              <label style={label}>Title</label>
              <input
                value={docDraft?.title ?? ""}
                onChange={(e) => docDraft && setDocDraft({ ...docDraft, title: e.target.value })}
                style={inp}
                data-tutorial-id="docs-title-input"
              />
            </div>
            <div>
              <label style={label}>Content</label>
              <textarea
                value={docDraft?.content ?? ""}
                onChange={(e) => docDraft && setDocDraft({ ...docDraft, content: e.target.value })}
                rows={14}
                style={{ ...inp, fontFamily: "inherit", resize: "vertical" }}
                data-tutorial-id="docs-content-input"
              />
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 14 }}>
            <button type="button" onClick={closeEditor} style={btnSmall}>
              Close
            </button>
            <button type="button" onClick={() => void saveDoc()} style={btnPrimary} data-tutorial-id="docs-save-button">
              Save
            </button>
          </div>
        </HelpModal>
      ) : null}
    </div>
  );
}

const rowButtonStyle: React.CSSProperties = {
  flex: 1,
  textAlign: "left",
  background: "transparent",
  border: "none",
  color: "inherit",
  padding: 0,
  cursor: "pointer"
};

const label: React.CSSProperties = { fontSize: 12, opacity: 0.8 };

const inp: React.CSSProperties = {
  width: "100%",
  margin: "6px 0 10px",
  padding: "8px 10px",
  borderRadius: 12,
  border: "1px solid var(--border)",
  background: "var(--bg-2)",
  color: "var(--text)",
  boxSizing: "border-box"
};

const btnSmall: React.CSSProperties = {
  padding: "10px 14px",
  borderRadius: 10,
  border: "1px solid var(--border)",
  background: "var(--bg-2)",
  color: "var(--text)",
  fontWeight: 700,
  cursor: "pointer"
};

const btnDangerSmall: React.CSSProperties = {
  ...btnSmall,
  border: "1px solid rgba(255, 107, 129, 0.4)",
  color: "#ff9aa9"
};

const btnPrimary: React.CSSProperties = {
  ...btnSmall,
  border: "1px solid rgba(91,123,255,0.45)",
  background: "rgba(91,123,255,0.14)"
};

const helpBtn: React.CSSProperties = {
  width: 28,
  height: 28,
  borderRadius: 999,
  border: "1px solid var(--border)",
  background: "rgba(91, 123, 255, 0.12)",
  color: "var(--text)",
  fontWeight: 800,
  lineHeight: 1,
  padding: 0
};

const helpText: React.CSSProperties = {
  fontSize: 12,
  lineHeight: 1.6,
  opacity: 0.82
};

const errorText: React.CSSProperties = {
  fontSize: 12,
  color: "#ff9aa9",
  lineHeight: 1.6
};
