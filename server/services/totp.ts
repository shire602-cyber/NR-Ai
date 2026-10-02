/**
 * RFC 6238 TOTP (SHA-1, 6 digits, 30 s) and recovery-code primitives, built on
 * node:crypto only. Pure functions: persistence and replay protection live in
 * two-factor.ts.
 */
import crypto from "node:crypto";

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;
export const TOTP_WINDOW = 1;
export const RECOVERY_CODE_COUNT = 10;
const RECOVERY_CODE_LENGTH = 10;

export function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.replace(/=+$/, "").replace(/\s+/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx < 0) throw new Error("Invalid base32 character");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** 160-bit secret, base32 encoded. */
export function generateTotpSecret(): string {
  return base32Encode(crypto.randomBytes(20));
}

export function totpCodeAt(secretB32: string, step: number): string {
  const key = base32Decode(secretB32);
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = crypto.createHmac("sha1", key).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const bin =
    ((hmac[offset] & 0x7f) << 24) |
    (hmac[offset + 1] << 16) |
    (hmac[offset + 2] << 8) |
    hmac[offset + 3];
  return String(bin % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, "0");
}

export function currentStep(nowMs: number = Date.now()): number {
  return Math.floor(nowMs / 1000 / TOTP_STEP_SECONDS);
}

/**
 * Check a submitted code against steps current-1..current+1 (constant-time
 * compare). Returns the matched step (needed for the replay guard) or null.
 */
export function verifyTotp(secretB32: string, code: string, atStep: number = currentStep()): number | null {
  if (typeof code !== "string" || !/^\d{6}$/.test(code)) return null;
  let matched: number | null = null;
  for (let delta = -TOTP_WINDOW; delta <= TOTP_WINDOW; delta++) {
    const step = atStep + delta;
    if (step < 0) continue;
    const expected = Buffer.from(totpCodeAt(secretB32, step));
    const given = Buffer.from(code);
    if (crypto.timingSafeEqual(expected, given) && matched === null) matched = step;
  }
  return matched;
}

export function buildOtpauthUrl(opts: { secret: string; account: string; issuer: string }): string {
  const issuer = encodeURIComponent(opts.issuer);
  const label = `${issuer}:${encodeURIComponent(opts.account)}`;
  return `otpauth://totp/${label}?secret=${opts.secret}&issuer=${issuer}&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_STEP_SECONDS}`;
}

// ───────────────────────── Recovery codes ─────────────────────────

/** 10 codes of 10 base32 characters (50 bits each), formatted without separators. */
export function generateRecoveryCodes(count: number = RECOVERY_CODE_COUNT): string[] {
  const codes = new Set<string>();
  while (codes.size < count) {
    let code = "";
    const bytes = crypto.randomBytes(RECOVERY_CODE_LENGTH);
    for (const b of bytes) code += B32[b & 31];
    codes.add(code);
  }
  return Array.from(codes);
}

export function normalizeRecoveryCode(input: string): string {
  return String(input ?? "")
    .toUpperCase()
    .replace(/[\s-]+/g, "");
}

let recoveryKey: Buffer | null = null;
function recoveryHmacKey(): Buffer {
  if (recoveryKey) return recoveryKey;
  const source = process.env.JWT_SECRET || process.env.SESSION_SECRET;
  if (!source) throw new Error("JWT_SECRET is required to hash recovery codes");
  recoveryKey = Buffer.from(
    crypto.hkdfSync("sha256", source, Buffer.alloc(0), "muhasib-recovery-code-v1", 32) as ArrayBuffer
  );
  return recoveryKey;
}

/** HMAC-SHA256 under a key derived from JWT_SECRET; high-entropy codes need one indexed lookup. */
export function hashRecoveryCode(code: string): string {
  return crypto.createHmac("sha256", recoveryHmacKey()).update(normalizeRecoveryCode(code)).digest("hex");
}
