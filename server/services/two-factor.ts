/**
 * TOTP persistence, replay protection, recovery codes and the login challenge
 * (D5, migration 0118). Pure crypto lives in totp.ts.
 */
import jwt from "jsonwebtoken";
import QRCode from "qrcode";
import { randomUUID } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";

import { db } from "../db";
import { getEnv } from "../config/env";
import { userTotp, userRecoveryCodes } from "../../shared/schema";
import { encryptSecret, decryptSecret } from "./secret-vault";
import {
  buildOtpauthUrl,
  currentStep,
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  normalizeRecoveryCode,
  verifyTotp,
} from "./totp";
import { blacklistToken, isTokenBlacklisted } from "./auth-tokens.service";
import { createLogger } from "../config/logger";

const log = createLogger("two-factor");

/**
 * The stored secret, or null when it cannot be decrypted (the encryption key changed). A user in
 * that state gets "invalid code" rather than a 500, and the operator gets an error to act on:
 * set TOKEN_ENCRYPTION_KEY once and never rotate it without re-enrolling users.
 */
function readSecret(stored: string, userId: string): string | null {
  try {
    return decryptSecret(stored);
  } catch (err) {
    log.error({ err, userId }, "Cannot decrypt a stored TOTP secret; was the encryption key rotated?");
    return null;
  }
}

export const TOTP_ISSUER = "Muhasib.ai";
export const CHALLENGE_TTL_SECONDS = 5 * 60;
export const CHALLENGE_COOKIE = "muhasib-2fa-challenge";

export type TotpFailure = "TOTP_INVALID" | "TOTP_REPLAYED";

// ───────────────────────── State ─────────────────────────

export async function getTotpRow(userId: string) {
  const [row] = await db.select().from(userTotp).where(eq(userTotp.userId, userId));
  return row as typeof userTotp.$inferSelect | undefined;
}

export async function isTwoFactorEnabled(userId: string): Promise<boolean> {
  const row = await getTotpRow(userId);
  return !!row?.enabledAt;
}

export async function recoveryCodesRemaining(userId: string): Promise<number> {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(userRecoveryCodes)
    .where(and(eq(userRecoveryCodes.userId, userId), isNull(userRecoveryCodes.usedAt)));
  return r?.n ?? 0;
}

/** Companies that demand 2FA from this user (owner/accountant/cfo of a live company with the flag on). */
export async function companiesRequiringTwoFactor(userId: string): Promise<Array<{ id: string; name: string }>> {
  const res: any = await db.execute(sql`
    SELECT c.id, c.name
      FROM company_users cu
      JOIN companies c ON c.id = cu.company_id
     WHERE cu.user_id = ${userId}
       AND cu.role IN ('owner','accountant','cfo')
       AND c.require_two_factor = true
       AND c.deleted_at IS NULL
  `);
  return (res.rows ?? res) as Array<{ id: string; name: string }>;
}

/** True when a company requires 2FA from the user and they have not enabled it. */
export async function needsTwoFactorEnrolment(userId: string): Promise<boolean> {
  if ((await companiesRequiringTwoFactor(userId)).length === 0) return false;
  return !(await isTwoFactorEnabled(userId));
}

// ───────────────────────── Enrolment ─────────────────────────

export class TwoFactorAlreadyEnabledError extends Error {
  code = "TOTP_ALREADY_ENABLED";
}

export async function beginEnrolment(user: { id: string; email: string }) {
  const existing = await getTotpRow(user.id);
  if (existing?.enabledAt) throw new TwoFactorAlreadyEnabledError("Two-factor authentication is already enabled");
  const secret = generateTotpSecret();
  const secretEnc = encryptSecret(secret)!;
  await db
    .insert(userTotp)
    .values({ userId: user.id, secretEnc, enabledAt: null, lastUsedStep: null })
    .onConflictDoUpdate({ target: userTotp.userId, set: { secretEnc, enabledAt: null, lastUsedStep: null, createdAt: new Date() } });
  const otpauthUrl = buildOtpauthUrl({ secret, account: user.email, issuer: TOTP_ISSUER });
  const qrDataUrl = await QRCode.toDataURL(otpauthUrl, { margin: 1, width: 240 });
  return { secret, otpauthUrl, qrDataUrl };
}

async function replaceRecoveryCodes(userId: string): Promise<string[]> {
  const codes = generateRecoveryCodes();
  await db.transaction(async (tx: any) => {
    await tx.delete(userRecoveryCodes).where(eq(userRecoveryCodes.userId, userId));
    await tx.insert(userRecoveryCodes).values(codes.map((c) => ({ userId, codeHash: hashRecoveryCode(c) })));
  });
  return codes;
}

export type EnrolResult =
  | { ok: true; recoveryCodes: string[] }
  | { ok: false; code: TotpFailure | "NO_PENDING_ENROLMENT" };

export async function confirmEnrolment(userId: string, code: string): Promise<EnrolResult> {
  const row = await getTotpRow(userId);
  if (!row || row.enabledAt) return { ok: false, code: "NO_PENDING_ENROLMENT" };
  const secret = readSecret(row.secretEnc, userId);
  if (!secret) return { ok: false, code: "TOTP_INVALID" };
  const step = verifyTotp(secret, code, currentStep());
  if (step === null) return { ok: false, code: "TOTP_INVALID" };
  // Atomic: only one concurrent confirmation can flip pending -> enabled.
  const flipped = await db
    .update(userTotp)
    .set({ enabledAt: new Date(), lastUsedStep: step })
    .where(and(eq(userTotp.userId, userId), isNull(userTotp.enabledAt)))
    .returning({ userId: userTotp.userId });
  if (!flipped.length) return { ok: false, code: "NO_PENDING_ENROLMENT" };
  return { ok: true, recoveryCodes: await replaceRecoveryCodes(userId) };
}

export async function disableTwoFactor(userId: string): Promise<void> {
  await db.transaction(async (tx: any) => {
    await tx.delete(userRecoveryCodes).where(eq(userRecoveryCodes.userId, userId));
    await tx.delete(userTotp).where(eq(userTotp.userId, userId));
  });
}

export async function regenerateRecoveryCodes(userId: string): Promise<string[]> {
  return replaceRecoveryCodes(userId);
}

// ───────────────────────── Verification ─────────────────────────

/**
 * Check a 6-digit code for an ENABLED user. The replay guard is one atomic
 * UPDATE: only a step strictly newer than the last accepted one wins, so
 * concurrent submissions of the same code yield exactly one success.
 */
export async function verifyTotpCode(userId: string, code: string): Promise<{ ok: true } | { ok: false; code: TotpFailure }> {
  const row = await getTotpRow(userId);
  if (!row?.enabledAt) return { ok: false, code: "TOTP_INVALID" };
  const secret = readSecret(row.secretEnc, userId);
  if (!secret) return { ok: false, code: "TOTP_INVALID" };
  const step = verifyTotp(secret, code, currentStep());
  if (step === null) return { ok: false, code: "TOTP_INVALID" };
  const won = await db
    .update(userTotp)
    .set({ lastUsedStep: step })
    .where(
      and(
        eq(userTotp.userId, userId),
        sql`${userTotp.enabledAt} IS NOT NULL`,
        sql`(${userTotp.lastUsedStep} IS NULL OR ${userTotp.lastUsedStep} < ${step})`
      )
    )
    .returning({ userId: userTotp.userId });
  return won.length ? { ok: true } : { ok: false, code: "TOTP_REPLAYED" };
}

export async function consumeRecoveryCode(userId: string, code: string): Promise<boolean> {
  if (normalizeRecoveryCode(code).length !== 10) return false;
  const used = await db
    .update(userRecoveryCodes)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(userRecoveryCodes.userId, userId),
        eq(userRecoveryCodes.codeHash, hashRecoveryCode(code)),
        isNull(userRecoveryCodes.usedAt)
      )
    )
    .returning({ id: userRecoveryCodes.id });
  return used.length > 0;
}

// ───────────────────────── Login challenge ─────────────────────────

export function signChallengeToken(userId: string): string {
  return jwt.sign({ type: "2fa_challenge", userId, jti: randomUUID() }, getEnv().JWT_SECRET, {
    expiresIn: CHALLENGE_TTL_SECONDS,
  });
}

/** Signature + type check only (no denylist); used by the rate-limit key too. */
export function readChallengeToken(token: string | undefined | null): { userId: string; jti: string } | null {
  if (!token || typeof token !== "string") return null;
  try {
    const d = jwt.verify(token, getEnv().JWT_SECRET) as { type?: string; userId?: string; jti?: string };
    if (d.type !== "2fa_challenge" || !d.userId || !d.jti) return null;
    return { userId: d.userId, jti: d.jti };
  } catch {
    return null;
  }
}

export async function verifyChallengeToken(token: string | undefined | null): Promise<{ userId: string } | null> {
  const parsed = readChallengeToken(token);
  if (!parsed) return null;
  if (await isTokenBlacklisted(token as string)) return null;
  return { userId: parsed.userId };
}

export async function consumeChallengeToken(token: string): Promise<void> {
  await blacklistToken(token);
}
