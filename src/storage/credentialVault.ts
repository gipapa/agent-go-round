import type { ModelCredentials } from "./settingsStore";

export type EncryptedCredentialVault = {
  __version: 1;
  kdf: "PBKDF2-SHA256";
  iterations: number;
  salt: string;
  iv: string;
  data: string;
};

const VAULT_ITERATIONS = 210_000;

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function getCrypto() {
  if (!globalThis.crypto?.subtle) {
    throw new Error("Web Crypto is not available in this environment.");
  }
  return globalThis.crypto;
}

function toArrayBuffer(bytes: Uint8Array) {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

async function deriveAesKey(masterPassword: string, salt: Uint8Array, iterations = VAULT_ITERATIONS) {
  if (!masterPassword) throw new Error("Master password is required.");
  const crypto = getCrypto();
  const passwordBytes = new TextEncoder().encode(masterPassword);
  const baseKey = await crypto.subtle.importKey("raw", passwordBytes, "PBKDF2", false, ["deriveKey"]);
  return await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: toArrayBuffer(salt),
      iterations
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function encryptCredentials(
  credentials: ModelCredentials,
  masterPassword: string,
  options?: { iterations?: number }
): Promise<EncryptedCredentialVault> {
  const crypto = getCrypto();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const iterations = Math.max(100_000, Math.round(options?.iterations ?? VAULT_ITERATIONS));
  const key = await deriveAesKey(masterPassword, salt, iterations);
  const payload = new TextEncoder().encode(JSON.stringify(credentials));
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: toArrayBuffer(iv) }, key, payload));
  return {
    __version: 1,
    kdf: "PBKDF2-SHA256",
    iterations,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    data: bytesToBase64(encrypted)
  };
}

export async function decryptCredentials(vault: EncryptedCredentialVault, masterPassword: string): Promise<ModelCredentials> {
  if (vault.__version !== 1) throw new Error(`Unsupported credential vault version: ${vault.__version}`);
  if (vault.kdf !== "PBKDF2-SHA256") throw new Error(`Unsupported credential vault KDF: ${vault.kdf}`);
  const crypto = getCrypto();
  const salt = base64ToBytes(vault.salt);
  const iv = base64ToBytes(vault.iv);
  const data = base64ToBytes(vault.data);
  const key = await deriveAesKey(masterPassword, salt, vault.iterations);
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: toArrayBuffer(iv) }, key, toArrayBuffer(data));
  const parsed = JSON.parse(new TextDecoder().decode(decrypted)) as unknown;
  if (!Array.isArray(parsed)) throw new Error("Credential vault payload is not an array.");
  return parsed as ModelCredentials;
}
