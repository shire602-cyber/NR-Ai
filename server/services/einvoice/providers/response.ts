export function providerString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function providerObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Read and redact a provider response before it can become an audit entry or diagnostic. */
export async function readProviderResponse(
  response: Response,
  credentials: string[],
  preserveOriginalText = false
) {
  // Response.text() removes a UTF-8 BOM. Source downloads retain it for exact comparison.
  const raw = preserveOriginalText
    ? new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
        await response.arrayBuffer()
      )
    : await response.text();
  const values = [...new Set(credentials.filter(Boolean))].sort((a, b) => b.length - a.length);
  const redact = (value: string) =>
    values.reduce((safe, credential) => safe.replaceAll(credential, "[REDACTED]"), value);
  const sanitise = (value: unknown): unknown => {
    if (typeof value === "string") return redact(value);
    if (Array.isArray(value)) return value.map(sanitise);
    const object = providerObject(value);
    return object
      ? Object.fromEntries(
          Object.entries(object).map(([key, item]) => [redact(key), sanitise(item)])
        )
      : value;
  };

  let json: unknown = null;
  try {
    json = raw ? sanitise(JSON.parse(raw)) : null;
  } catch {
    // Some responses are XML or plain text.
  }
  return {
    json,
    text: json === null ? redact(raw) : JSON.stringify(json),
    originalText: preserveOriginalText ? raw : undefined,
  };
}
