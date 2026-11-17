/**
 * Field-level messages from a failed API call (X4/J3), so forms can mark the field that failed
 * instead of showing only a generic "Validation error" toast.
 *
 * Reads both server shapes:
 *   - strictBody / zod: `{ code: "VALIDATION_ERROR", fields: { iban: ["IBAN check digits are invalid"] } }`
 *   - DomainError with field details: `{ code, details: { fields: { iban: "Another employee ..." } } }`
 * In Arabic the zod-style messages are localised; unknown English text becomes the generic
 * "invalid value" message (never raw English).
 */
import { ApiError } from "./queryClient";
import { useI18n } from "./i18n";
import { localizeServerIssue } from "./validation-messages";

export type FieldMessages = Record<string, string>;

function firstMessage(v: unknown): string {
  if (Array.isArray(v)) return String(v[0] ?? "");
  return typeof v === "string" ? v : "";
}

/** `{ field: message }` for every field the server rejected; `{}` when there are none. */
export function apiFieldErrors(
  err: unknown,
  overrides?: (code: string | undefined, field: string) => string | undefined
): FieldMessages {
  if (!(err instanceof ApiError) || !err.body) return {};
  const body = err.body as Record<string, unknown>;
  const code = typeof body.code === "string" ? body.code : undefined;
  const details = (body.details ?? null) as Record<string, unknown> | null;
  const raw = (body.fields ?? details?.fields) as Record<string, unknown> | undefined;
  if (!raw || typeof raw !== "object") return {};
  const ar = useI18n.getState().locale === "ar";
  const out: FieldMessages = {};
  for (const [name, value] of Object.entries(raw)) {
    if (name === "_root") continue;
    const field = name.split(".")[0];
    if (out[field]) continue;
    const override = overrides?.(code, field);
    const msg = firstMessage(value);
    out[field] = override ?? (ar ? localizeServerIssue(msg) : msg);
  }
  return out;
}
