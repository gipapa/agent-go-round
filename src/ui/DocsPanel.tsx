import React, { useMemo, useState } from "react";
import { DocItem } from "../types";
import HelpModal from "./HelpModal";

export default function DocsPanel(props: {
  docs: DocItem[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onCreate: () => Promise<void>;
  onSave: (d: DocItem) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const selected = useMemo(() => props.docs.find((d) => d.id === props.selectedId) ?? null, [props.docs, props.selectedId]);
  const [edit, setEdit] = useState<DocItem | null>(null);
  const [showHelp, setShowHelp] = useState(false);

  React.useEffect(() => setEdit(selected ? { ...selected } : null), [selected?.id]);

  return (
    <div>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <div style={{ fontWeight: 800 }}>Docs</div>
        <button
          type="button"
          onClick={() => setShowHelp((v) => !v)}
          title="Docs 使用說明"
          aria-label="Docs 使用說明"
          style={helpBtn}
        >
          ?
        </button>
        <button onClick={props.onCreate} style={{ ...btnSmall, marginLeft: "auto" }}>
          + New
        </button>
      </div>

      {showHelp && (
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
      )}

      <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
        {props.docs.map((d) => (
          <button
            key={d.id}
            onClick={() => props.onSelect(d.id)}
            style={{
              textAlign: "left",
              padding: 10,
              borderRadius: 12,
              border: d.id === props.selectedId ? "1px solid #5b6bff" : "1px solid #222636",
              background: "#0f1118",
              color: "white"
            }}
          >
            <div style={{ fontWeight: 650 }}>{d.title}</div>
            <div style={{ fontSize: 12, opacity: 0.7 }}>{new Date(d.updatedAt).toLocaleString()}</div>
          </button>
        ))}
      </div>

      <hr style={{ margin: "12px 0" }} />

      {!edit ? (
        <div style={{ opacity: 0.7, fontSize: 12 }}>
          選擇一份文件後即可編輯；要讓 agent 使用哪些文件，請到 `Agents` 頁設定權限。
        </div>
      ) : (
        <div className="card" style={{ padding: 10 }}>
          <label style={label}>Title</label>
          <input value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} style={inp} />
          <label style={label}>Content</label>
          <textarea value={edit.content} onChange={(e) => setEdit({ ...edit, content: e.target.value })} rows={10} style={inp} />
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => props.onDelete(edit.id)} style={btnDanger}>
              Delete
            </button>
            <button onClick={() => props.onSave(edit)} style={btnPrimary}>
              Save
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const label: React.CSSProperties = { fontSize: 12, opacity: 0.8 };

const inp: React.CSSProperties = {
  width: "100%",
  margin: "6px 0 10px",
  padding: "8px 10px",
  borderRadius: 12,
  border: "1px solid var(--border)",
  background: "var(--bg-2)",
  color: "var(--text)"
};

const btnSmall: React.CSSProperties = {
  padding: "7px 11px",
  borderRadius: 12,
  border: "1px solid var(--border)",
  background: "var(--panel-2)",
  color: "var(--text)"
};

const btnPrimary: React.CSSProperties = {
  padding: "8px 10px",
  borderRadius: 12,
  border: "1px solid var(--primary)",
  background: "var(--primary)",
  color: "#0b0e14",
  width: "100%"
};

const btnDanger: React.CSSProperties = {
  padding: "8px 10px",
  borderRadius: 12,
  border: "1px solid #4a2026",
  background: "#1d1014",
  color: "white",
  width: "100%"
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
