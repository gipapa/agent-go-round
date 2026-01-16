import React, { useMemo, useState } from "react";
import { DocItem } from "../types";

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
  const [collapsed, setCollapsed] = useState(false);

  React.useEffect(() => setEdit(selected ? { ...selected } : null), [selected?.id]);

  return (
    <div>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <div style={{ fontWeight: 800 }}>Docs</div>
        <button onClick={() => setCollapsed((c) => !c)} style={{ ...btnSmall, marginLeft: "auto" }}>
          {collapsed ? "Expand" : "Collapse"}
        </button>
        <button onClick={props.onCreate} style={{ ...btnSmall, marginLeft: 0 }}>
          + New
        </button>
      </div>

      {!collapsed && (
        <>
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
              Select a doc to edit. The active chat doc is chosen in the Chat tab.
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
        </>
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
