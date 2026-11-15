/**
 * TOTP multi-factor authentication (R01-11, R17-19).
 *
 * - Enrolment: a pending secret is generated, encrypted with the secret vault and shown
 *   once as an otpauth:// URI + QR code; it only becomes active after the user proves
 *   possession with a valid code.
 * - Codes are RFC 6238 TOTP (SHA-1, 6 digits, 30 s, ±1 step tolerance) and single-use:
 *   users.mfa_last_used_step only moves forward, so a code (or an older one) cannot be
 *   replayed.
 * - Ten recovery codes are issued on enrolment, stored as SHA-256 digests and consumed
 *   atomically (UPDATE ... WHERE used_at IS NULL).
 */
import { createHash, randomBytes } from "node:crypto";
import { generateSecret, generateURI, verifySync } from "otplib";
import QRCode from "qrcode";
import { sql } from "./security/sql";
import { decryptSecret, encryptSecret } from "./secret-vault";

export const MFA_ISSUER = "Muhasib.ai";
export const RECOVERY_CODE_COUNT = 10;
const TOTP_TOLERANCE_SECONDS = 30;

export interface MfaUserRow {
  id: string;
  email: string;
  mfa_enabled: boolean;
  mfa_secret_enc: string | null;
  mfa_pending_secret_enc: string | null;
  mfa_enrolled_at: Date | null;
  mfa_last_used_step: number | null;
}

export async function loadMfaUser(userId: string): Promise<MfaUserRow | null> {
  const { rows } = await sql<MfaUserRow>(
    `SELECT id, email, mfa_enabled, mfa_secret_enc, mfa_pending_secret_enc, mfa_enrolled_at,
            mfa_last_used_step
       FROM users WHERE id = $1`,
    [userId]
  );
  return rows[0] ?? null;
}

export async function isMfaEnabled(userId: string): Promise<boolean> {
  const row = await loadMfaUser(userId);
  return !!row?.mfa_enabled && !!row.mfa_secret_enc;
}

export function normalizeTotp(code: string): string {
  return code.replace(/[\s-]/g, "");
}

export function isTotpShaped(code: string): boolean {
  return /^\d{6}$/.test(normalizeTotp(code));
}

/** Pure TOTP check; returns the matched time step or null. */
export function matchTotp(secret: string, code: string, epochSeconds?: number): number | null {
  const token = normalizeTotp(code);
  if (!/^\d{6}$/.test(token)) return null;
  try {
    const result = verifySync({
      secret,
      token,
      epochTolerance: TOTP_TOLERANCE_SECONDS,
      ...(epochSeconds !== undefined ? { epoch: epochSeconds } : {}),
    }) as { valid: boolean; timeStep?: number };
    return result.valid && typeof result.timeStep === "number" ? result.timeStep : null;
  } catch {
    return null;
  }
}

// ─── Enrolment ─────────────────────────────────────────────────────────────

export interface EnrollmentStart {
  secret: string;
  otpauthUrl: string;
  qrDataUrl: string;
}

export async function beginEnrollment(userId: string, email: string): Promise<EnrollmentStart> {
  const secret = generateSecret();
  await sql(`UPDATE users SET mfa_pending_secret_enc = $2 WHERE id = $1`, [
    userId,
    encryptSecret(secret),
  ]);
  const otpauthUrl = generateURI({ issuer: MFA_ISSUER, label: email, secret });
  const qrDataUrl = await QRCode.toDataURL(otpauthUrl, { margin: 1, width: 220 });
  return { secret, otpauthUrl, qrDataUrl };
}

export type ConfirmResult =
  | { ok: true; recoveryCodes: string[] }
  | { ok: false; code: "MFA_NOT_PENDING" | "MFA_CODE_INVALID" | "MFA_ALREADY_ENABLED" };

export async function confirmEnrollment(userId: string, code: string): Promise<ConfirmResult> {
  const row = await loadMfaUser(userId);
  if (!row) return { ok: false, code: "MFA_NOT_PENDING" };
  if (row.mfa_enabled) return { ok: false, code: "MFA_ALREADY_ENABLED" };
  const pending = decryptSecret(row.mfa_pending_secret_enc);
  if (!pending) return { ok: false, code: "MFA_NOT_PENDING" };
  const step = matchTotp(pending, code);
  if (step === null) return { ok: false, code: "MFA_CODE_INVALID" };
  await sql(
    `UPDATE users SET mfa_enabled = true, mfa_secret_enc = mfa_pending_secret_enc,
            mfa_pending_secret_enc = NULL, mfa_enrolled_at = now(), mfa_last_used_step = $2
      WHERE id = $1`,
    [userId, step]
  );
  const recoveryCodes = await regenerateRecoveryCodes(userId);
  return { ok: true, recoveryCodes };
}

export async function disableMfa(userId: string): Promise<void> {
  await sql(
    `UPDATE users SET mfa_enabled = false, mfa_secret_enc = NULL, mfa_pending_secret_enc = NULL,
            mfa_enrolled_at = NULL, mfa_last_used_step = NULL
      WHERE id = $1`,
    [userId]
  );
  await sql(`DELETE FROM user_mfa_recovery_codes WHERE user_id = $1`, [userId]);
}

// ─── Recovery codes ────────────────────────────────────────────────────────

const RECOVERY_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"; // no 0/o/1/l/i

function newRecoveryCode(): string {
  const bytes = randomBytes(10);
  let out = "";
  for (let i = 0; i < 10; i++) out += RECOVERY_ALPHABET[bytes[i] % RECOVERY_ALPHABET.length];
  return `${out.slice(0, 5)}-${out.slice(5)}`;
}

export function normalizeRecoveryCode(code: string): string {
  return code.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function hashRecoveryCode(code: string): string {
  return createHash("sha256").update(`mfa-recovery:${normalizeRecoveryCode(code)}`).digest("hex");
}

export async function regenerateRecoveryCodes(userId: string): Promise<string[]> {
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, newRecoveryCode);
  // One statement: the old set is replaced atomically.
  await sql(
    `WITH removed AS (DELETE FROM user_mfa_recovery_codes WHERE user_id = $1)
     INSERT INTO user_mfa_recovery_codes (user_id, code_hash)
     SELECT $1, unnest($2::text[])`,
    [userId, codes.map(hashRecoveryCode)]
  );
  return codes;
}

export async function recoveryCodesRemaining(userId: string): Promise<number> {
  const { rows } = await sql<{ n: string }>(
    `SELECT count(*)::text AS n FROM user_mfa_recovery_codes WHERE user_id = $1 AND used_at IS NULL`,
    [userId]
  );
  return Number(rows[0]?.n ?? 0);
}

async function consumeRecoveryCode(userId: string, code: string): Promise<boolean> {
  if (normalizeRecoveryCode(code).length !== 10) return false;
  const { rowCount } = await sql(
    `UPDATE user_mfa_recovery_codes SET used_at = now()
      WHERE user_id = $1 AND code_hash = $2 AND used_at IS NULL`,
    [userId, hashRecoveryCode(code)]
  );
  return (rowCount ?? 0) > 0;
}

// ─── Verification ──────────────────────────────────────────────────────────

export type SecondFactorResult =
  | { ok: true; method: "totp" | "recovery_code"; recoveryCodesRemaining?: number }
  | { ok: false; code: "MFA_NOT_ENABLED" | "MFA_CODE_INVALID" | "MFA_CODE_REUSED" };

/** Verify a TOTP code (single-use) or a recovery code (consumed). */
export async function verifySecondFactor(
  userId: string,
  code: string
): Promise<SecondFactorResult> {
  const row = await loadMfaUser(userId);
  if (!row?.mfa_enabled || !row.mfa_secret_enc) return { ok: false, code: "MFA_NOT_ENABLED" };
  if (isTotpShaped(code)) {
    const secret = decryptSecret(row.mfa_secret_enc);
    const step = secret ? matchTotp(secret, code) : null;
    if (step === null) return { ok: false, code: "MFA_CODE_INVALID" };
    // Single use: the step must be newer than the last accepted one (atomic).
    const { rowCount } = await sql(
      `UPDATE users SET mfa_last_used_step = $2
        WHERE id = $1 AND (mfa_last_used_step IS NULL OR mfa_last_used_step < $2)`,
      [userId, step]
    );
    if (!rowCount) return { ok: false, code: "MFA_CODE_REUSED" };
    return { ok: true, method: "totp" };
  }
  if (await consumeRecoveryCode(userId, code)) {
    return {
      ok: true,
      method: "recovery_code",
      recoveryCodesRemaining: await recoveryCodesRemaining(userId),
    };
  }
  return { ok: false, code: "MFA_CODE_INVALID" };
}

export interface MfaStatus {
  enabled: boolean;
  enrolledAt: string | null;
  pendingEnrollment: boolean;
  recoveryCodesRemaining: number;
}

export async function mfaStatus(userId: string): Promise<MfaStatus> {
  const row = await loadMfaUser(userId);
  return {
    enabled: !!row?.mfa_enabled,
    enrolledAt: row?.mfa_enrolled_at ? new Date(row.mfa_enrolled_at).toISOString() : null,
    pendingEnrollment: !row?.mfa_enabled && !!row?.mfa_pending_secret_enc,
    recoveryCodesRemaining: row?.mfa_enabled ? await recoveryCodesRemaining(userId) : 0,
  };
}
