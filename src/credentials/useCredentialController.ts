import { useEffect, useMemo, useState } from "react";
import {
  loadModelCredentials,
  ModelCredentialEntry,
  ModelCredentialPreset,
  saveModelCredentials
} from "../storage/settingsStore";
import { PendingLogEntry } from "../runtime/logging";
import { createCredentialEntry, createCredentialKeyEntry } from "../utils/loadBalancer";
import { errorMessage } from "../utils/errors";
import { CredentialTestState, testCredentialConnection } from "./runtime";

type UseCredentialControllerArgs = {
  pushLog: (entry: PendingLogEntry) => void;
};

export function useCredentialController({ pushLog }: UseCredentialControllerArgs) {
  const [modelCredentials, setModelCredentials] = useState<ModelCredentialEntry[]>(() => loadModelCredentials());
  const [visibleCredentialIds, setVisibleCredentialIds] = useState<Record<string, boolean>>({});
  const [credentialTestResults, setCredentialTestResults] = useState<Record<string, CredentialTestState | undefined>>({});
  const [testingCredentialIds, setTestingCredentialIds] = useState<Record<string, boolean>>({});

  useEffect(() => {
    saveModelCredentials(modelCredentials);
  }, [modelCredentials]);

  const credentialSlots = useMemo(
    () => modelCredentials.slice().sort((a, b) => a.label.localeCompare(b.label)),
    [modelCredentials]
  );
  const configuredCredentialCount = useMemo(
    () => credentialSlots.filter((slot) => slot.preset === "chrome_prompt" || slot.keys.some((key) => key.apiKey.trim())).length,
    [credentialSlots]
  );

  function addCredential(preset: ModelCredentialPreset) {
    setModelCredentials((prev) => {
      if (preset !== "custom" && prev.some((entry) => entry.preset === preset)) return prev;
      const customCount = prev.filter((entry) => entry.preset === "custom").length;
      return [...prev, createCredentialEntry(preset, customCount + 1)];
    });
  }

  function updateCredential(id: string, patch: Partial<ModelCredentialEntry>) {
    const keyIds = modelCredentials.find((entry) => entry.id === id)?.keys.map((key) => key.id) ?? [];
    setModelCredentials((prev) => prev.map((entry) => entry.id === id
      ? { ...entry, ...patch, updatedAt: Date.now() }
      : entry));
    if (patch.endpoint !== undefined) {
      setCredentialTestResults((prev) => omitKeys(prev, keyIds));
    }
  }

  function removeCredential(id: string) {
    const keyIds = modelCredentials.find((entry) => entry.id === id)?.keys.map((key) => key.id) ?? [];
    setModelCredentials((prev) => prev.filter((entry) => entry.id !== id));
    setVisibleCredentialIds((prev) => omitKeys(prev, keyIds));
    setCredentialTestResults((prev) => omitKeys(prev, keyIds));
    setTestingCredentialIds((prev) => omitKeys(prev, keyIds));
  }

  function addCredentialKey(credentialId: string) {
    setModelCredentials((prev) => prev.map((entry) => entry.id === credentialId
      ? { ...entry, keys: [...entry.keys, createCredentialKeyEntry("")], updatedAt: Date.now() }
      : entry));
  }

  function updateCredentialKey(credentialId: string, keyId: string, apiKey: string) {
    setModelCredentials((prev) => prev.map((entry) => entry.id === credentialId
      ? {
          ...entry,
          keys: entry.keys.map((key) => key.id === keyId ? { ...key, apiKey, updatedAt: Date.now() } : key),
          updatedAt: Date.now()
        }
      : entry));
    setCredentialTestResults((prev) => omitKeys(prev, [keyId]));
  }

  function removeCredentialKey(credentialId: string, keyId: string) {
    setModelCredentials((prev) => prev.map((entry) => entry.id === credentialId
      ? { ...entry, keys: entry.keys.filter((key) => key.id !== keyId), updatedAt: Date.now() }
      : entry));
    setVisibleCredentialIds((prev) => omitKeys(prev, [keyId]));
    setCredentialTestResults((prev) => omitKeys(prev, [keyId]));
    setTestingCredentialIds((prev) => omitKeys(prev, [keyId]));
  }

  function toggleCredentialVisibility(keyId: string) {
    setVisibleCredentialIds((prev) => ({ ...prev, [keyId]: !prev[keyId] }));
  }

  async function runCredentialTest(slot: ModelCredentialEntry, keyId: string) {
    const key = slot.keys.find((entry) => entry.id === keyId);
    if (!key) return;
    setTestingCredentialIds((prev) => ({ ...prev, [key.id]: true }));
    setCredentialTestResults((prev) => ({ ...prev, [key.id]: undefined }));
    try {
      const result = await testCredentialConnection(slot, key.apiKey);
      setCredentialTestResults((prev) => ({ ...prev, [key.id]: result }));
      pushLog({
        category: "credentials",
        agent: slot.label,
        ok: true,
        message: "Credential test passed",
        details: `${slot.endpoint}\nKey ${slot.keys.findIndex((entry) => entry.id === keyId) + 1}\n${result.message}`
      });
    } catch (error) {
      const message = errorMessage(error);
      setCredentialTestResults((prev) => ({ ...prev, [key.id]: { ok: false, message } }));
      pushLog({
        category: "credentials",
        agent: slot.label,
        ok: false,
        message: "Credential test failed",
        details: `${slot.endpoint}\nKey ${slot.keys.findIndex((entry) => entry.id === keyId) + 1}\n${message}`
      });
    } finally {
      setTestingCredentialIds((prev) => ({ ...prev, [key.id]: false }));
    }
  }

  return {
    modelCredentials,
    setModelCredentials,
    credentialSlots,
    configuredCredentialCount,
    visibleCredentialIds,
    credentialTestResults,
    testingCredentialIds,
    addCredential,
    updateCredential,
    removeCredential,
    addCredentialKey,
    updateCredentialKey,
    removeCredentialKey,
    toggleCredentialVisibility,
    runCredentialTest
  };
}

function omitKeys<T>(source: Record<string, T>, keys: string[]) {
  if (!keys.some((key) => key in source)) return source;
  const next = { ...source };
  keys.forEach((key) => delete next[key]);
  return next;
}
