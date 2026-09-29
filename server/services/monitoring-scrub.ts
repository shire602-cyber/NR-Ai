// Pure scrubbing helpers for anything that leaves the process towards an
// external error tracker. Nothing here does I/O. The rule is "when in doubt,
// redact": an accountant's TRN, IBAN or a customer's email must never end up in
// a third-party dashboard.

export const REDACTED = "[REDACTED]";

const SENSITIVE_KEY = /password|passwd|token|secret|authorization|cookie|iban|trn|apikey|api_key/i;
// Request/response payloads are never sent, whatever they contain.
const PAYLOAD_KEY = /^(body|requestbody|rawbody|payload|reqbody|formdata)$/i;

const JWT = /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g;
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
const IBAN = /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/g;
const TRN = /\b\d{15}\b/g;
// Drizzle / pg error messages append the bound parameters after "params:".
const SQL_PARAMS = /params:[\s\S]*$/i;

const MAX_DEPTH = 8;
const MAX_STRING = 4000;

/** Redact secrets and personal identifiers from free text. */
export function scrubString(input: string): string {
  let s = input.length > MAX_STRING ? input.slice(0, MAX_STRING) + "…[truncated]" : input;
  s = s.replace(SQL_PARAMS, `params: ${REDACTED}`);
  s = s.replace(JWT, "[REDACTED_JWT]");
  s = s.replace(BEARER, "Bearer [REDACTED]");
  s = s.replace(EMAIL, "[REDACTED_EMAIL]");
  s = s.replace(IBAN, "[REDACTED_IBAN]");
  s = s.replace(TRN, "[REDACTED_TRN]");
  return s;
}

function scrubValue(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return scrubString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "function" || typeof value === "symbol") return undefined;
  if (depth >= MAX_DEPTH) return "[MAX_DEPTH]";

  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    if (seen.has(value as object)) return "[CIRCULAR]";
    seen.add(value as object);

    if (value instanceof Error) {
      return {
        name: value.name,
        message: scrubString(value.message ?? ""),
        stack: value.stack ? scrubString(value.stack) : undefined,
      };
    }
    if (Array.isArray(value)) return value.map((v) => scrubValue(v, depth + 1, seen));

    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SENSITIVE_KEY.test(key) || PAYLOAD_KEY.test(key) ? REDACTED : scrubValue(v, depth + 1, seen);
    }
    return out;
  }
  return undefined;
}

/** Deep, non-mutating scrub of any value bound for an external monitor. */
export function scrubForMonitoring(value: unknown): unknown {
  return scrubValue(value, 0, new WeakSet());
}
