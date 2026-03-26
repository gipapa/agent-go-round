export const AGENT_GO_ROUND_LOCAL_STORAGE_KEYS = [
  "agr_ui_v1",
  "agr_mcp_v1",
  "agr_mcp_aliases_v1",
  "agr_mcp_prompt_templates_v1",
  "agr_model_credentials_v1",
  "agr_load_balancers_v1",
  "agr_agents_v1",
  "agr_built_in_tools_v1"
];

export const AGENT_GO_ROUND_INDEXED_DB_TARGETS: Array<{ name: string; stores: string[] }> = [
  { name: "agr_chat_db", stores: ["chat_state"] },
  { name: "agr_docs_db", stores: ["docs"] },
  { name: "agr_skills_db", stores: ["skills_meta", "skills_docs", "skills_files"] }
];

function clearDbStores(dbName: string, stores: string[]) {
  return new Promise<void>((resolve, reject) => {
    const req = indexedDB.open(dbName);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const db = req.result;
      const targets = stores.filter((store) => db.objectStoreNames.contains(store));
      if (targets.length === 0) {
        db.close();
        resolve();
        return;
      }

      const tx = db.transaction(targets, "readwrite");
      targets.forEach((store) => tx.objectStore(store).clear());
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    };
  });
}

export async function resetAgentGoRoundStorage() {
  AGENT_GO_ROUND_LOCAL_STORAGE_KEYS.forEach((key) => localStorage.removeItem(key));
  await Promise.all(AGENT_GO_ROUND_INDEXED_DB_TARGETS.map((target) => clearDbStores(target.name, target.stores)));
}
