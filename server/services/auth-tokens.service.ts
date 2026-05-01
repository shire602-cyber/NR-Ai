import crypto from 'node:crypto';
import { and, eq, isNull, lt, sql } from 'drizzle-orm';
import jwt from 'jsonwebtoken';

import { db } from '../db';
import {
  tokenBlacklist,
  refreshSessions,
  passwordResetTokens,
  emailVerificationTokens,
} from '../../shared/schema';
import { createLogger } from '../config/logger';

const log = createLogger('auth-tokens');

const RESET_TOKEN_TTL_HOURS = 24;
const VERIFY_TOKEN_TTL_HOURS = 24 * 7;
const REFRESH_TOKEN_TTL_DAYS = 7;

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

// ─────────────────────── Refresh sessions ───────────────────────

export interface RefreshSessionMeta {
  userAgent?: string | null;
  ipAddress?: string | null;
}

export interface IssuedRefreshSession {
  token: string;
  tokenHash: string;
  expiresAt: Date;
}

export type RotateRefreshSessionResult =
  | { ok: true; userId: string; token: string; tokenHash: string; expiresAt: Date }
  | { ok: false; reason: 'invalid' | 'expired' | 'revoked' | 'reused' };

function refreshExpiresAt(): Date {
  return new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
}

export async function createRefreshSession(
  userId: string,
  meta: RefreshSessionMeta = {},
): Promise<IssuedRefreshSession> {
  const token = generateRandomToken(48);
  const tokenHash = hashToken(token);
  const expiresAt = refreshExpiresAt();

  await db.insert(refreshSessions).values({
    userId,
    tokenHash,
    expiresAt,
    userAgent: meta.userAgent ?? null,
    ipAddress: meta.ipAddress ?? null,
  });

  return { token, tokenHash, expiresAt };
}

export async function revokeRefreshSession(token: string | null | undefined): Promise<void> {
  if (!token) return;
  await db
    .update(refreshSessions)
    .set({ revokedAt: new Date() })
    .where(eq(refreshSessions.tokenHash, hashToken(token)));
}

export async function revokeUserRefreshSessions(userId: string): Promise<void> {
  await db
    .update(refreshSessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(refreshSessions.userId, userId), isNull(refreshSessions.revokedAt)));
}

export async function rotateRefreshSession(
  token: string,
  meta: RefreshSessionMeta = {},
): Promise<RotateRefreshSessionResult> {
  const tokenHash = hashToken(token);
  const now = new Date();

  return db.transaction(async (tx: any) => {
    const result: any = await tx.execute(sql`
      SELECT
        id,
        user_id AS "userId",
        token_hash AS "tokenHash",
        replaced_by_token_hash AS "replacedByTokenHash",
        expires_at AS "expiresAt",
        revoked_at AS "revokedAt",
        reuse_detected_at AS "reuseDetectedAt",
        user_agent AS "userAgent",
        ip_address AS "ipAddress"
      FROM refresh_sessions
      WHERE token_hash = ${tokenHash}
      FOR UPDATE
    `);
    const rows = (result?.rows ?? result) as any[];
    const [row] = rows;

    if (!row) {
      return { ok: false as const, reason: 'invalid' as const };
    }

    if (row.revokedAt) {
      await tx
        .update(refreshSessions)
        .set({ reuseDetectedAt: row.reuseDetectedAt ?? now })
        .where(eq(refreshSessions.id, row.id));
      await tx
        .update(refreshSessions)
        .set({ revokedAt: now })
        .where(and(eq(refreshSessions.userId, row.userId), isNull(refreshSessions.revokedAt)));
      return { ok: false as const, reason: row.replacedByTokenHash ? 'reused' as const : 'revoked' as const };
    }

    if (row.expiresAt.getTime() <= now.getTime()) {
      await tx
        .update(refreshSessions)
        .set({ revokedAt: now })
        .where(eq(refreshSessions.id, row.id));
      return { ok: false as const, reason: 'expired' as const };
    }

    const nextToken = generateRandomToken(48);
    const nextTokenHash = hashToken(nextToken);
    const expiresAt = refreshExpiresAt();

    await tx.insert(refreshSessions).values({
      userId: row.userId,
      tokenHash: nextTokenHash,
      expiresAt,
      userAgent: meta.userAgent ?? row.userAgent ?? null,
      ipAddress: meta.ipAddress ?? row.ipAddress ?? null,
    });

    await tx
      .update(refreshSessions)
      .set({
        revokedAt: now,
        replacedByTokenHash: nextTokenHash,
        lastUsedAt: now,
      })
      .where(eq(refreshSessions.id, row.id));

    return {
      ok: true as const,
      userId: row.userId,
      token: nextToken,
      tokenHash: nextTokenHash,
      expiresAt,
    };
  });
}

export async function purgeExpiredRefreshSessions(): Promise<number> {
  try {
    const result: any = await db
      .delete(refreshSessions)
      .where(lt(refreshSessions.expiresAt, new Date(Date.now() - 24 * 60 * 60 * 1000)));
    return (result?.rowCount as number | undefined) ?? 0;
  } catch (err) {
    log.error({ err }, 'Failed to purge expired refresh sessions');
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
  refreshSessions: number;
  passwordReset: number;
  emailVerification: number;
}> {
  const [blacklist, refreshSessionCount, passwordReset, emailVerification] = await Promise.all([
    purgeExpiredBlacklistEntries(),
    purgeExpiredRefreshSessions(),
    purgeExpiredPasswordResetTokens(),
    purgeExpiredEmailVerificationTokens(),
  ]);
  return { blacklist, refreshSessions: refreshSessionCount, passwordReset, emailVerification };
}
