import React, { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCredentialController } from "../credentials/useCredentialController";

type Controller = ReturnType<typeof useCredentialController>;

let container: HTMLDivElement;
let root: Root;
let current: Controller | null;
const pushLog = vi.fn();

function Harness() {
  current = useCredentialController({ pushLog });
  return <div>{current.modelCredentials.length}</div>;
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  pushLog.mockReset();
  current = null;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
});

describe("credential controller", () => {
  it("owns credential CRUD, ordering, visibility, and persistence", async () => {
    await act(async () => root.render(<Harness />));
    await act(async () => {
      current?.addCredential("openai");
      current?.addCredential("openai");
    });

    expect(current?.modelCredentials).toHaveLength(1);
    const slot = current!.modelCredentials[0];
    const keyId = slot.keys[0].id;

    await act(async () => current?.updateCredentialKey(slot.id, keyId, "secret"));
    expect(current?.configuredCredentialCount).toBe(1);

    await act(async () => current?.toggleCredentialVisibility(keyId));
    expect(current?.visibleCredentialIds[keyId]).toBe(true);

    await act(async () => current?.addCredentialKey(slot.id));
    expect(current?.modelCredentials[0].keys).toHaveLength(2);

    const stored = JSON.parse(localStorage.getItem("agr_model_credentials_v1") ?? "{}") as { data?: unknown[] };
    expect(stored.data).toHaveLength(1);
  });

  it("records successful tests and clears stale results when the endpoint changes", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: [{ id: "model" }] }), { status: 200 })));
    await act(async () => root.render(<Harness />));
    await act(async () => current?.addCredential("openai"));
    const slot = current!.modelCredentials[0];
    const keyId = slot.keys[0].id;

    await act(async () => current?.runCredentialTest(slot, keyId));
    expect(current?.credentialTestResults[keyId]?.ok).toBe(true);
    expect(pushLog).toHaveBeenCalledWith(expect.objectContaining({ ok: true, category: "credentials" }));

    await act(async () => current?.updateCredential(slot.id, { endpoint: "https://other.example/v1" }));
    expect(current?.credentialTestResults[keyId]).toBeUndefined();
  });

  it("removes per-key UI state together with a credential", async () => {
    await act(async () => root.render(<Harness />));
    await act(async () => current?.addCredential("openai"));
    const slot = current!.modelCredentials[0];
    const keyId = slot.keys[0].id;
    await act(async () => current?.toggleCredentialVisibility(keyId));
    await act(async () => current?.removeCredential(slot.id));

    expect(current?.modelCredentials).toEqual([]);
    expect(current?.visibleCredentialIds[keyId]).toBeUndefined();
  });
});
