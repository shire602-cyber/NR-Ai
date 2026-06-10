import crypto from 'node:crypto';
import { and, eq, lt } from 'drizzle-orm';
import jwt from 'jsonwebtoken';

import { db } from '../db';
import {
  tokenBlacklist,
  passwordResetTokens,
  emailVerificationTokens,
} from '../../shared/schema';
import { createLogger } from '../config/logger';

const log = createLogger('auth-tokens');

const RESET_TOKEN_TTL_HOURS = 24;
const VERIFY_TOKEN_TTL_HOURS = 24 * 7;

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function generateRandomToken(byteLength = 32): string {
  return crypto.randomBytes(byteLength).toString('hex');
}

// ───────────────────────── JWT blacklist ─────────────────────────

/**
 * Decode the token's `exp` claim without verifying the signature. We only
 * need the expiry to bound how long the blacklist entry must live; signature
 * verification has already happened in authMiddleware before we ever blacklist.
 */
function getTokenExpiry(token: string): Date {
  const decoded = jwt.decode(token) as { exp?: number } | null;
  if (decoded?.exp) {
    return new Date(decoded.exp * 1000);
  }
  // Unknown/invalid expiry — keep blacklisted for the access-token lifetime.
  return new Date(Date.now() + 24 * 60 * 60 * 1000);
}

export async function blacklistToken(token: string): Promise<void> {
  const tokenHash = hashToken(token);
  const expiresAt = getTokenExpiry(token);
  await db
    .insert(tokenBlacklist)
    .values({ tokenHash, expiresAt })
    .onConflictDoNothing();
}

export async function isTokenBlacklisted(token: string): Promise<boolean> {
  const tokenHash = hashToken(token);
  const [row] = await db
    .select()
    .from(tokenBlacklist)
    .where(eq(tokenBlacklist.tokenHash, tokenHash));
  return !!row;
}

export async function purgeExpiredBlacklistEntries(): Promise<number> {
  try {
    const result: any = await db
      .delete(tokenBlacklist)
      .where(lt(tokenBlacklist.expiresAt, new Date()));
    const count = (result?.rowCount as number | undefined) ?? 0;
    return count;
  } catch (err) {
    log.error({ err }, 'Failed to purge expired blacklist entries');
    return 0;
  }
}

// ─────────────────────── Password reset tokens ───────────────────────

export async function createPasswordResetToken(userId: string): Promise<string> {
  const token = generateRandomToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_HOURS * 60 * 60 * 1000);
  await db.insert(passwordResetTokens).values({ userId, tokenHash, expiresAt });
  return token;
}

export async function consumePasswordResetToken(
  token: string,
): Promise<string | null> {
  const tokenHash = hashToken(token);
  const [row] = await db
    .select()
    .from(passwordResetTokens)
    .where(eq(passwordResetTokens.tokenHash, tokenHash));
  if (!row) return null;
  if (row.expiresAt.getTime() < Date.now()) {
    await db.delete(passwordResetTokens).where(eq(passwordResetTokens.id, row.id));
    return null;
  }
  // Single-use: delete on consumption.
  await db.delete(passwordResetTokens).where(eq(passwordResetTokens.id, row.id));
  return row.userId;
}

export async function purgeExpiredPasswordResetTokens(): Promise<number> {
  try {
    const result: any = await db
      .delete(passwordResetTokens)
      .where(lt(passwordResetTokens.expiresAt, new Date()));
    return (result?.rowCount as number | undefined) ?? 0;
  } catch (err) {
    log.error({ err }, 'Failed to purge expired password reset tokens');
    return 0;
  }
}

// ─────────────────────── Email verification tokens ───────────────────────

export async function createEmailVerificationToken(userId: string): Promise<string> {
  const token = generateRandomToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + VERIFY_TOKEN_TTL_HOURS * 60 * 60 * 1000);
  await db.insert(emailVerificationTokens).values({ userId, tokenHash, expiresAt });
  return token;
}

export async function consumeEmailVerificationToken(
  token: string,
): Promise<string | null> {
  const tokenHash = hashToken(token);
  const [row] = await db
    .select()
    .from(emailVerificationTokens)
    .where(eq(emailVerificationTokens.tokenHash, tokenHash));
  if (!row) return null;
  if (row.expiresAt.getTime() < Date.now()) {
    await db
      .delete(emailVerificationTokens)
      .where(eq(emailVerificationTokens.id, row.id));
    return null;
  }
  await db
    .delete(emailVerificationTokens)
    .where(eq(emailVerificationTokens.id, row.id));
  return row.userId;
}

export async function purgeExpiredEmailVerificationTokens(): Promise<number> {
  try {
    const result: any = await db
      .delete(emailVerificationTokens)
      .where(lt(emailVerificationTokens.expiresAt, new Date()));
    return (result?.rowCount as number | undefined) ?? 0;
  } catch (err) {
    log.error({ err }, 'Failed to purge expired email verification tokens');
    return 0;
  }
}

// ─────────────────────── Combined sweep ───────────────────────

export async function purgeExpiredAuthTokens(): Promise<{
  blacklist: number;
  passwordReset: number;
  emailVerification: number;
}> {
  const [blacklist, passwordReset, emailVerification] = await Promise.all([
    purgeExpiredBlacklistEntries(),
    purgeExpiredPasswordResetTokens(),
    purgeExpiredEmailVerificationTokens(),
  ]);
  return { blacklist, passwordReset, emailVerification };
}
