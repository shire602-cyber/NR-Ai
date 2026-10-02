/**
 * v1 API keys: `muh_<8>_<32>`, shown once, SHA-256 at rest, found by the
 * (unique) 8-character prefix and compared in constant time.
 */
import crypto from "node:crypto";

export const KEY_PREFIX_LENGTH = 8;
export const KEY_SECRET_LENGTH = 32;
const KEY_RE = /^muh_([a-z0-9]{8})_([a-z0-9]{32})$/;
const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

export const DEFAULT_RATE_PER_MINUTE = 60;
export const DEFAULT_RATE_PER_DAY = 5000;
export const MAX_RATE_PER_MINUTE = 600;
export const MAX_RATE_PER_DAY = 200_000;
export const MAX_KEY_EXPIRY_DAYS = 730;

/** Roles whose members may hold and use a key. The key never exceeds its creator's role. */
export const KEY_HOLDER_ROLES = ["owner", "accountant", "cfo"] as const;

export const SCOPE_RESOURCES = ["contacts", "items", "invoices", "bills", "payments", "journals"] as const;
export const ALL_SCOPES: readonly string[] = [
  ...SCOPE_RESOURCES.flatMap((r) => [`read:${r}`, `write:${r}`]),
  "read:reports",
  "read:accounts",
];

function randomChars(n: number): string {
  const bytes = crypto.randomBytes(n);
  let out = "";
  for (let i = 0; i < n; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

export function hashApiKey(key: string): string {
  return crypto.createHash("sha256").update(key).digest("hex");
}

export function generateApiKey(): { key: string; prefix: string; hash: string } {
  const prefix = randomChars(KEY_PREFIX_LENGTH);
  const key = `muh_${prefix}_${randomChars(KEY_SECRET_LENGTH)}`;
  return { key, prefix, hash: hashApiKey(key) };
}

/** Returns the lookup prefix when `presented` has the key shape, else null. */
export function parseApiKey(presented: string | undefined | null): { prefix: string } | null {
  if (!presented) return null;
  const m = KEY_RE.exec(presented);
  return m ? { prefix: m[1] } : null;
}

export function keyMatches(presented: string, storedHash: string): boolean {
  const a = Buffer.from(hashApiKey(presented), "hex");
  const b = Buffer.from(storedHash, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Scopes live in a text column, space separated. */
export function parseScopes(text: string | null | undefined): string[] {
  return (text ?? "").split(/\s+/).filter(Boolean);
}
export function serializeScopes(scopes: readonly string[]): string {
  return Array.from(new Set(scopes)).join(" ");
}
export function isKnownScope(scope: string): boolean {
  return ALL_SCOPES.includes(scope);
}
export function hasScope(granted: readonly string[], needed: string): boolean {
  return granted.includes(needed);
}
