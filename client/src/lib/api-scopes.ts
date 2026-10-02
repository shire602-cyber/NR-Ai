/**
 * The API key scope model, mirrored from server/api-v1/keys.ts (a unit test
 * keeps the two lists identical). Scopes are `read:<resource>` / `write:<resource>`
 * plus the read-only `read:reports`.
 */

export const SCOPE_RESOURCES = ["contacts", "items", "invoices", "bills", "payments", "journals"] as const;
export type ScopeResource = (typeof SCOPE_RESOURCES)[number];

export const ALL_SCOPES: readonly string[] = [
  ...SCOPE_RESOURCES.flatMap((r) => [`read:${r}`, `write:${r}`]),
  "read:reports",
  "read:accounts",
];

export const READ_SCOPES: readonly string[] = ALL_SCOPES.filter((s) => s.startsWith("read:"));

export const SCOPE_PRESETS = {
  readOnly: READ_SCOPES,
  invoicing: ["read:contacts", "write:contacts", "read:items", "write:items", "read:invoices", "write:invoices", "read:payments", "write:payments"],
  fullAccess: ALL_SCOPES,
} as const;

export type ScopePreset = keyof typeof SCOPE_PRESETS;

export const EXPIRY_CHOICES = [0, 30, 90, 365, 730] as const;
export const DEFAULT_RATE_PER_MINUTE = 60;
export const DEFAULT_RATE_PER_DAY = 5000;
export const MAX_RATE_PER_MINUTE = 600;
export const MAX_RATE_PER_DAY = 200_000;

/** Add or remove one scope. Granting `write:x` also grants `read:x` (a writer must be able to read back). Returns a new list. */
export function toggleScope(selected: readonly string[], scope: string, on: boolean): string[] {
  const next = new Set(selected);
  if (on) {
    next.add(scope);
    if (scope.startsWith("write:")) next.add(`read:${scope.slice("write:".length)}`);
  } else {
    next.delete(scope);
    // Removing read removes the write that depended on it.
    if (scope.startsWith("read:")) next.delete(`write:${scope.slice("read:".length)}`);
  }
  return ALL_SCOPES.filter((s) => next.has(s));
}

export function scopesEqual(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((s) => b.includes(s));
}

/** Which preset (if any) the selection exactly equals. */
export function matchingPreset(selected: readonly string[]): ScopePreset | null {
  for (const key of Object.keys(SCOPE_PRESETS) as ScopePreset[]) {
    if (scopesEqual(selected, SCOPE_PRESETS[key])) return key;
  }
  return null;
}

export interface KeyFormInput {
  name: string;
  scopes: readonly string[];
  expiresInDays: number;
  ratePerMinute: number;
  ratePerDay: number;
}

export type KeyFormError = "name" | "scopes" | "perMinute" | "perDay";

export function validateKeyForm(input: KeyFormInput): KeyFormError[] {
  const errors: KeyFormError[] = [];
  if (!input.name.trim() || input.name.trim().length > 100) errors.push("name");
  if (input.scopes.length === 0) errors.push("scopes");
  if (!Number.isInteger(input.ratePerMinute) || input.ratePerMinute < 1 || input.ratePerMinute > MAX_RATE_PER_MINUTE) errors.push("perMinute");
  if (!Number.isInteger(input.ratePerDay) || input.ratePerDay < 1 || input.ratePerDay > MAX_RATE_PER_DAY) errors.push("perDay");
  return errors;
}

/** The body for POST /api/companies/:id/api-keys (expiry omitted for "never"). */
export function buildCreateKeyBody(input: KeyFormInput) {
  return {
    name: input.name.trim(),
    scopes: ALL_SCOPES.filter((s) => input.scopes.includes(s)),
    ratePerMinute: input.ratePerMinute,
    ratePerDay: input.ratePerDay,
    ...(input.expiresInDays > 0 ? { expiresInDays: input.expiresInDays } : {}),
  };
}

/** muh_abcd1234... -> keep as is; the server already masks the secret. */
export function maskKeyForDisplay(prefix: string): string {
  return prefix.endsWith("...") ? `${prefix}${"•".repeat(8)}` : prefix;
}
