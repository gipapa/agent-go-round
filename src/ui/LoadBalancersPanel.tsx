import React from "react";
import { LoadBalancerConfig, LoadBalancerInstance } from "../types";
import HelpModal from "./HelpModal";
import { createLoadBalancer, createLoadBalancerInstance, describeCredentialPreset } from "../utils/loadBalancer";
import { ModelCredentialEntry } from "../storage/settingsStore";

export default function LoadBalancersPanel(props: {
  loadBalancers: LoadBalancerConfig[];
  credentials: ModelCredentialEntry[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onChange: (next: LoadBalancerConfig[]) => void;
  onLoadModels: (args: { credential: ModelCredentialEntry; credentialKeyId?: string }) => Promise<string[]>;
  draftSeed?: { token: number; draft: LoadBalancerConfig } | null;
  onDraftSeedConsumed?: () => void;
}) {
  const [showHelp, setShowHelp] = React.useState(false);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState<LoadBalancerConfig | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [isNew, setIsNew] = React.useState(false);
  const [modelOptionsByInstance, setModelOptionsByInstance] = React.useState<Record<string, string[]>>({});
  const [loadingModelsByInstance, setLoadingModelsByInstance] = React.useState<Record<string, boolean>>({});
  const [modelLoadErrors, setModelLoadErrors] = React.useState<Record<string, string | undefined>>({});

  const selected = props.loadBalancers.find((item) => item.id === props.selectedId) ?? props.loadBalancers[0] ?? null;
  const editing = props.loadBalancers.find((item) => item.id === editingId) ?? null;

  React.useEffect(() => {
    if (!selected && props.selectedId) {
      props.onSelect(null);
      return;
    }
    if (!props.selectedId && props.loadBalancers[0]) {
      props.onSelect(props.loadBalancers[0].id);
    }
  }, [props.loadBalancers, props.onSelect, props.selectedId, selected]);

  React.useEffect(() => {
    if (!props.draftSeed) return;
    const seeded = JSON.parse(JSON.stringify(props.draftSeed.draft)) as LoadBalancerConfig;
    setEditingId(seeded.id);
    setDraft(seeded);
    setIsNew(true);
    setError(null);
    setModelOptionsByInstance({});
    setLoadingModelsByInstance({});
    setModelLoadErrors({});
    props.onDraftSeedConsumed?.();
  }, [props.draftSeed, props.onDraftSeedConsumed]);

  function openEditor(loadBalancer?: LoadBalancerConfig) {
    if (loadBalancer) {
      setEditingId(loadBalancer.id);
      setDraft(JSON.parse(JSON.stringify(loadBalancer)) as LoadBalancerConfig);
      setIsNew(false);
    } else {
      const created = createLoadBalancer(`Load Balancer ${props.loadBalancers.length + 1}`);
      setEditingId(created.id);
      setDraft(created);
      setIsNew(true);
    }
    setError(null);
  }

  function closeEditor() {
    setEditingId(null);
    setDraft(null);
    setError(null);
    setIsNew(false);
    setModelOptionsByInstance({});
    setLoadingModelsByInstance({});
    setModelLoadErrors({});
  }

  function saveDraft() {
    if (!draft) return;
    if (!draft.name.trim()) {
      setError("Load balancer name is required.");
      return;
    }
    if (draft.instances.length === 0) {
      setError("At least one instance is required.");
      return;
    }
    if (draft.instances.some((instance) => !instance.credentialId || !instance.model.trim())) {
      setError("Each instance needs a credential and model.");
      return;
    }
    const nextItem: LoadBalancerConfig = {
      ...draft,
      name: draft.name.trim(),
      description: draft.description?.trim() ?? "",
      updatedAt: Date.now()
    };
    const next = isNew
      ? [nextItem, ...props.loadBalancers]
      : props.loadBalancers.map((item) => (item.id === nextItem.id ? nextItem : item));
    props.onChange(next);
    props.onSelect(nextItem.id);
    closeEditor();
  }

  function remove(id: string) {
    const next = props.loadBalancers.filter((item) => item.id !== id);
    props.onChange(next);
    if (props.selectedId === id) {
      props.onSelect(next[0]?.id ?? null);
    }
  }

  function updateDraft(patch: Partial<LoadBalancerConfig>) {
    setDraft((current) => (current ? { ...current, ...patch } : current));
  }

  function updateInstance(instanceId: string, patch: Partial<LoadBalancerInstance>) {
    setDraft((current) => {
      if (!current) return current;
      return {
        ...current,
        instances: current.instances.map((instance) =>
          instance.id === instanceId ? { ...instance, ...patch, updatedAt: Date.now() } : instance
        )
      };
    });
    if (patch.credentialId !== undefined || patch.credentialKeyId !== undefined) {
      setModelOptionsByInstance((current) => {
        const next = { ...current };
        delete next[instanceId];
        return next;
      });
      setModelLoadErrors((current) => {
        const next = { ...current };
        delete next[instanceId];
        return next;
      });
    }
  }

  function addInstance() {
    setDraft((current) => {
      if (!current) return current;
      const firstCredential = props.credentials[0];
      const firstKey = firstCredential?.keys?.[0];
      return {
        ...current,
        instances: [
          ...current.instances,
          createLoadBalancerInstance({
            credentialId: firstCredential?.id ?? "",
            credentialKeyId: firstKey?.id
          })
        ]
      };
    });
  }

  function removeInstance(instanceId: string) {
    setDraft((current) => {
      if (!current) return current;
      return {
        ...current,
        instances: current.instances.filter((instance) => instance.id !== instanceId)
      };
    });
  }

  function moveInstance(instanceId: string, direction: -1 | 1) {
    setDraft((current) => {
      if (!current) return current;
      const index = current.instances.findIndex((instance) => instance.id === instanceId);
      if (index < 0) return current;
      const targetIndex = index + direction;
      if (targetIndex < 0 || targetIndex >= current.instances.length) return current;
      const next = current.instances.slice();
      const [item] = next.splice(index, 1);
      next.splice(targetIndex, 0, item);
      return { ...current, instances: next };
    });
  }

  async function loadModelsForInstance(instance: LoadBalancerInstance) {
    const credential = props.credentials.find((entry) => entry.id === instance.credentialId) ?? null;
    if (!credential) {
      setModelLoadErrors((current) => ({ ...current, [instance.id]: "請先選擇 credential。" }));
      return;
    }

    setLoadingModelsByInstance((current) => ({ ...current, [instance.id]: true }));
    setModelLoadErrors((current) => ({ ...current, [instance.id]: undefined }));
    try {
      const models = await props.onLoadModels({ credential, credentialKeyId: instance.credentialKeyId });
      const normalized = Array.from(new Set(models.map((item) => item.trim()).filter(Boolean)));
      setModelOptionsByInstance((current) => ({ ...current, [instance.id]: normalized }));
      if (normalized.length > 0 && !normalized.includes(instance.model)) {
        updateInstance(instance.id, { model: normalized[0] });
      }
    } catch (error: any) {
      setModelLoadErrors((current) => ({ ...current, [instance.id]: String(error?.message ?? error) }));
    } finally {
      setLoadingModelsByInstance((current) => ({ ...current, [instance.id]: false }));
    }
  }

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ fontWeight: 800, fontSize: 18 }}>Load Balancer</div>
        <button type="button" onClick={() => setShowHelp(true)} style={helpBtn}>
          ?
        </button>
        <button type="button" onClick={() => openEditor()} style={{ ...btnSmall, marginLeft: "auto" }} data-tutorial-id="load-balancer-new-button">
          + New
        </button>
      </div>

      {showHelp ? (
        <HelpModal title="Load Balancer 使用說明" onClose={() => setShowHelp(false)}>
          <div style={helpText}>
            每個 agent 會綁定一個 load balancer。每次呼叫模型時，系統都會從第 1 個 instance 開始掃，跳過暫時 failure 的項目，直到找到可用的 instance。
          </div>
          <div style={{ ...helpText, marginTop: 8 }}>
            instance 會綁定：
            <br />
            1. 一筆 credential
            <br />
            2. 該 credential 裡的一把 key
            <br />
            3. 一個 model
          </div>
        </HelpModal>
      ) : null}

      <div style={{ display: "grid", gap: 8 }}>
        {props.loadBalancers.length === 0 ? <div style={{ fontSize: 12, opacity: 0.7 }}>No load balancers yet.</div> : null}
        {props.loadBalancers.map((item) => {
          const active = item.id === selected?.id;
          return (
            <div
              key={item.id}
              style={{
                padding: 12,
                borderRadius: 14,
                border: active ? "1px solid var(--primary)" : "1px solid var(--border)",
                background: active ? "rgba(91, 123, 255, 0.12)" : "var(--bg-2)"
              }}
            >
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <button type="button" onClick={() => props.onSelect(item.id)} style={rowButtonStyle}>
                  <div style={{ fontWeight: 700 }}>{item.name}</div>
                  <div style={{ fontSize: 12, opacity: 0.74, marginTop: 4 }}>{item.instances.length} instances</div>
                </button>
                {active ? (
                  <div style={{ display: "flex", gap: 8, marginLeft: "auto" }}>
                    <button type="button" onClick={() => openEditor(item)} style={btnSmall}>
                      Edit
                    </button>
                    <button type="button" onClick={() => remove(item.id)} style={btnDangerSmall}>
                      Delete
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      {editingId ? (
        <HelpModal title={`Edit Load Balancer: ${editing?.name ?? draft?.name ?? "New"}`} onClose={closeEditor} width="min(980px, calc(100vw - 48px))" footer={null}>
          <div style={{ display: "grid", gap: 12 }} data-tutorial-id="load-balancer-editor-modal">
            <div>
              <label style={label}>Name</label>
              <input value={draft?.name ?? ""} onChange={(e) => updateDraft({ name: e.target.value })} style={inp} data-tutorial-id="load-balancer-name-input" />
            </div>
            <div>
              <label style={label}>Description</label>
              <textarea value={draft?.description ?? ""} onChange={(e) => updateDraft({ description: e.target.value })} rows={3} style={{ ...inp, resize: "vertical" }} data-tutorial-id="load-balancer-description-input" />
            </div>

            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <div style={{ fontWeight: 700 }}>Instances</div>
              <button type="button" onClick={addInstance} style={{ ...btnSmall, marginLeft: "auto" }} data-tutorial-id="load-balancer-add-instance-button">
                + Instance
              </button>
            </div>

            <div style={{ display: "grid", gap: 10 }}>
              {draft?.instances.map((instance, index) => {
                const credential = props.credentials.find((entry) => entry.id === instance.credentialId) ?? null;
                const availableKeys = credential?.keys ?? [];
                const loadedModels = modelOptionsByInstance[instance.id] ?? [];
                const hasLoadedModels = loadedModels.length > 0;
                const isLoadingModels = loadingModelsByInstance[instance.id] === true;
                const modelLoadError = modelLoadErrors[instance.id];
                const modelOptions = Array.from(new Set([instance.model, ...loadedModels].filter(Boolean)));
                return (
                  <div key={instance.id} className="card" style={{ padding: 12, display: "grid", gap: 10 }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <div style={{ fontWeight: 700 }}>Instance #{index + 1}</div>
                      <button type="button" onClick={() => moveInstance(instance.id, -1)} style={btnSmall} disabled={index === 0}>
                        ↑
                      </button>
                      <button type="button" onClick={() => moveInstance(instance.id, 1)} style={btnSmall} disabled={index === (draft?.instances.length ?? 1) - 1}>
                        ↓
                      </button>
                      <button type="button" onClick={() => removeInstance(instance.id)} style={{ ...btnDangerSmall, marginLeft: "auto" }}>
                        Remove
                      </button>
                    </div>

                    <div style={grid2}>
                      <div>
                        <label style={label}>Credential</label>
                        <select
                          value={instance.credentialId}
                          onChange={(e) => {
                            const nextCredential = props.credentials.find((entry) => entry.id === e.target.value);
                            updateInstance(instance.id, {
                              credentialId: e.target.value,
                              credentialKeyId: nextCredential?.keys?.[0]?.id
                            });
                          }}
                          style={inp as React.CSSProperties}
                          data-tutorial-id={`load-balancer-instance-credential-${index}`}
                        >
                          <option value="">Select credential</option>
                          {props.credentials.map((entry) => (
                            <option key={entry.id} value={entry.id}>
                              {entry.label} · {describeCredentialPreset(entry.preset, entry.endpoint)}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label style={label}>Credential key</label>
                        <select
                          value={instance.credentialKeyId ?? ""}
                          onChange={(e) => updateInstance(instance.id, { credentialKeyId: e.target.value || undefined })}
                          style={inp as React.CSSProperties}
                          disabled={!credential || availableKeys.length === 0}
                          data-tutorial-id={`load-balancer-instance-key-${index}`}
                        >
                          <option value="">{credential?.preset === "chrome_prompt" ? "No key needed" : "Select key"}</option>
                          {availableKeys.map((key, keyIndex) => (
                            <option key={key.id} value={key.id}>
                              Key {keyIndex + 1}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div style={grid2}>
                      <div>
                        <label style={label}>Provider</label>
                        <div style={readOnlyField}>{credential ? describeCredentialPreset(credential.preset, credential.endpoint) : "—"}</div>
                      </div>
                      <div>
                        <label style={label}>Endpoint</label>
                        <div style={readOnlyField}>{credential?.endpoint || "—"}</div>
                      </div>
                    </div>

                    <div style={grid2}>
                      <div>
                        <label style={label}>Model</label>
                        {hasLoadedModels ? (
                          <select
                            value={instance.model}
                            onChange={(e) => updateInstance(instance.id, { model: e.target.value })}
                            style={inp as React.CSSProperties}
                            data-tutorial-id={`load-balancer-instance-model-${index}`}
                          >
                            <option value="">Select model</option>
                            {modelOptions.map((model) => (
                              <option key={model} value={model}>
                                {model}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            value={instance.model}
                            onChange={(e) => updateInstance(instance.id, { model: e.target.value })}
                            style={inp}
                            data-tutorial-id={`load-balancer-instance-model-${index}`}
                          />
                        )}
                        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6 }}>
                          <button type="button" onClick={() => void loadModelsForInstance(instance)} style={btnSmall} disabled={isLoadingModels || !credential}>
                            {isLoadingModels ? "Loading..." : hasLoadedModels ? "Reload models" : "Load models"}
                          </button>
                          <div style={{ fontSize: 12, opacity: 0.72 }}>
                            {hasLoadedModels ? `已載入 ${loadedModels.length} 個模型` : "按下後可改用下拉選單選模型"}
                          </div>
                        </div>
                        {modelLoadError ? <div style={errorText}>{modelLoadError}</div> : null}
                      </div>
                      <div>
                        <label style={label}>Description</label>
                        <input value={instance.description} onChange={(e) => updateInstance(instance.id, { description: e.target.value })} style={inp} data-tutorial-id={`load-balancer-instance-description-${index}`} />
                      </div>
                    </div>

                    <div style={grid3}>
                      <div>
                        <label style={label}>maxRetries</label>
                        <input type="number" min={0} max={20} value={instance.maxRetries} onChange={(e) => updateInstance(instance.id, { maxRetries: Math.max(0, Number(e.target.value) || 0) })} style={inp} data-tutorial-id={`load-balancer-instance-max-retries-${index}`} />
                      </div>
                      <div>
                        <label style={label}>delaySecond</label>
                        <input type="number" min={0} max={60} value={instance.delaySecond} onChange={(e) => updateInstance(instance.id, { delaySecond: Math.max(0, Number(e.target.value) || 0) })} style={inp} data-tutorial-id={`load-balancer-instance-delay-second-${index}`} />
                      </div>
                      <div />
                    </div>
                  </div>
                );
              })}
              {draft?.instances.length === 0 ? <div style={{ fontSize: 12, opacity: 0.7 }}>No instances yet.</div> : null}
            </div>

            {error ? <div style={errorText}>{error}</div> : null}
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 14 }}>
            <button type="button" onClick={closeEditor} style={btnSmall}>
              Close
            </button>
            <button type="button" onClick={saveDraft} style={btnPrimary} data-tutorial-id="load-balancer-save-button">
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
  margin: "6px 0 0",
  padding: "8px 10px",
  borderRadius: 12,
  border: "1px solid var(--border)",
  background: "var(--bg-2)",
  color: "var(--text)",
  boxSizing: "border-box"
};

const readOnlyField: React.CSSProperties = {
  ...inp,
  opacity: 0.75
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

const grid2: React.CSSProperties = {
  display: "grid",
  gap: 10,
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))"
};

const grid3: React.CSSProperties = {
  display: "grid",
  gap: 10,
  gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))"
};
