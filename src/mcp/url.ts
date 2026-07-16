const SENSITIVE_QUERY_PARAMETER = /(token|key|secret|password|authorization)/i;

export function redactMcpUrl(value: string) {
  try {
    const url = new URL(value);
    for (const name of Array.from(url.searchParams.keys())) {
      if (SENSITIVE_QUERY_PARAMETER.test(name)) url.searchParams.set(name, "[redacted]");
    }
    return url.toString();
  } catch {
    return value;
  }
}
