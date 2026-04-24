import { describe, expect, it } from "vitest";
import { decryptCredentials, encryptCredentials } from "../storage/credentialVault";
import type { ModelCredentials } from "../storage/settingsStore";

describe("credentialVault", () => {
  it("encrypts credentials without leaving plaintext in the vault payload", async () => {
    const credentials: ModelCredentials = [
      {
        id: "cred-1",
        preset: "openai",
        label: "OpenAI",
        endpoint: "https://api.openai.com/v1",
        keys: [{ id: "key-1", apiKey: "sk-secret-value", createdAt: 1, updatedAt: 1 }],
        createdAt: 1,
        updatedAt: 1
      }
    ];

    const vault = await encryptCredentials(credentials, "correct horse battery staple", { iterations: 100_000 });

    expect(JSON.stringify(vault)).not.toContain("sk-secret-value");
    await expect(decryptCredentials(vault, "correct horse battery staple")).resolves.toEqual(credentials);
  });

  it("rejects a wrong master password", async () => {
    const vault = await encryptCredentials([], "right password", { iterations: 100_000 });

    await expect(decryptCredentials(vault, "wrong password")).rejects.toThrow();
  });
});
