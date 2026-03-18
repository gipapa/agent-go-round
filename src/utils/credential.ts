export function normalizeCredentialUrl(url?: string) {
  return (url ?? "").trim().replace(/\/$/, "");
}
