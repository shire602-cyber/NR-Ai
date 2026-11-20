import crypto from "node:crypto";
import { and, desc, eq, gt, isNull, lt, sql } from "drizzle-orm";
import jwt from "jsonwebtoken";

import { db } from "../db";
import {
  tokenBlacklist,
  passwordResetTokens,
  emailVerificationTokens,
  refreshSessions,
  users,
} from "../../shared/schema";
import { createLogger } from "../config/logger";

const log = createLogger("auth-tokens");

const RESET_TOKEN_TTL_HOURS = 24;
const VERIFY_TOKEN_TTL_HOURS = 24 * 7;

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function generateRandomToken(byteLength = 32): string {
  return crypto.randomBytes(byteLength).toString("hex");
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
  await db.insert(tokenBlacklist).values({ tokenHash, expiresAt }).onConflictDoNothing();
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
    const result = await db.delete(tokenBlacklist).where(lt(tokenBlacklist.expiresAt, new Date()));
    const count = (result?.rowCount as number | undefined) ?? 0;
    return count;
  } catch (err) {
    log.error({ err }, "Failed to purge expired blacklist entries");
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

export async function consumePasswordResetToken(token: string): Promise<string | null> {
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
    const result = await db
      .delete(passwordResetTokens)
      .where(lt(passwordResetTokens.expiresAt, new Date()));
    return (result?.rowCount as number | undefined) ?? 0;
  } catch (err) {
    log.error({ err }, "Failed to purge expired password reset tokens");
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

export async function consumeEmailVerificationToken(token: string): Promise<string | null> {
  const tokenHash = hashToken(token);
  const [row] = await db
    .select()
    .from(emailVerificationTokens)
    .where(eq(emailVerificationTokens.tokenHash, tokenHash));
  if (!row) return null;
  if (row.expiresAt.getTime() < Date.now()) {
    await db.delete(emailVerificationTokens).where(eq(emailVerificationTokens.id, row.id));
    return null;
  }
  await db.delete(emailVerificationTokens).where(eq(emailVerificationTokens.id, row.id));
  return row.userId;
}

export async function purgeExpiredEmailVerificationTokens(): Promise<number> {
  try {
    const result = await db
      .delete(emailVerificationTokens)
      .where(lt(emailVerificationTokens.expiresAt, new Date()));
    return (result?.rowCount as number | undefined) ?? 0;
  } catch (err) {
    log.error({ err }, "Failed to purge expired email verification tokens");
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

// ─────────────────────── Refresh sessions (R01-06, R01-13) ───────────────────────
//
// Every sign-in creates one refresh_sessions row. Its id travels in both JWTs
// as `sid`; the row stores only SHA-256 digests of the current refresh token
// (token_hash) and of the one it replaced (replaced_by_token_hash, i.e. the
// previous token). Revoking the row signs that device out: authMiddleware
// refuses access tokens whose session is revoked, and refresh refuses to
// rotate it. Presenting the previous refresh token again is treated as theft
// (refresh-token reuse) and revokes the session.

export interface SessionMeta {
  userAgent?: string | null;
  ipAddress?: string | null;
}

export interface PublicSession {
  id: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  expiresAt: Date;
  userAgent: string | null;
  ipAddress: string | null;
}

export async function createRefreshSession(
  userId: string,
  refreshToken: string,
  expiresAt: Date,
  meta: SessionMeta,
  sessionId?: string
): Promise<string> {
  const [row] = await db
    .insert(refreshSessions)
    .values({
      ...(sessionId ? { id: sessionId } : {}),
      userId,
      tokenHash: hashToken(refreshToken),
      expiresAt,
      userAgent: meta.userAgent?.slice(0, 512) ?? null,
      ipAddress: meta.ipAddress ?? null,
      lastUsedAt: new Date(),
    })
    .returning({ id: refreshSessions.id });
  return row.id;
}

export async function getRefreshSession(sessionId: string) {
  const [row] = await db.select().from(refreshSessions).where(eq(refreshSessions.id, sessionId));
  return row;
}

/** Active = not revoked and not expired. */
export async function isSessionActive(sessionId: string): Promise<boolean> {
  const [row] = await db
    .select({ revokedAt: refreshSessions.revokedAt, expiresAt: refreshSessions.expiresAt })
    .from(refreshSessions)
    .where(eq(refreshSessions.id, sessionId));
  return !!row && !row.revokedAt && row.expiresAt.getTime() > Date.now();
}

export async function rotateRefreshSession(
  sessionId: string,
  previousToken: string,
  nextToken: string,
  expiresAt: Date,
  meta: SessionMeta
): Promise<void> {
  await db
    .update(refreshSessions)
    .set({
      tokenHash: hashToken(nextToken),
      replacedByTokenHash: hashToken(previousToken),
      expiresAt,
      lastUsedAt: new Date(),
      userAgent: meta.userAgent?.slice(0, 512) ?? null,
      ipAddress: meta.ipAddress ?? null,
    })
    .where(eq(refreshSessions.id, sessionId));
}

export async function revokeRefreshSession(
  sessionId: string,
  opts: { userId?: string; reuse?: boolean } = {}
): Promise<boolean> {
  const now = new Date();
  const where = opts.userId
    ? and(eq(refreshSessions.id, sessionId), eq(refreshSessions.userId, opts.userId))
    : eq(refreshSessions.id, sessionId);
  const rows = await db
    .update(refreshSessions)
    .set({ revokedAt: now, ...(opts.reuse ? { reuseDetectedAt: now } : {}) })
    .where(and(where, isNull(refreshSessions.revokedAt)))
    .returning({ id: refreshSessions.id });
  return rows.length > 0;
}

export async function revokeAllRefreshSessions(userId: string): Promise<number> {
  const rows = await db
    .update(refreshSessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(refreshSessions.userId, userId), isNull(refreshSessions.revokedAt)))
    .returning({ id: refreshSessions.id });
  return rows.length;
}

export async function listActiveSessions(userId: string): Promise<PublicSession[]> {
  const rows = await db
    .select({
      id: refreshSessions.id,
      createdAt: refreshSessions.createdAt,
      lastUsedAt: refreshSessions.lastUsedAt,
      expiresAt: refreshSessions.expiresAt,
      userAgent: refreshSessions.userAgent,
      ipAddress: refreshSessions.ipAddress,
    })
    .from(refreshSessions)
    .where(
      and(
        eq(refreshSessions.userId, userId),
        isNull(refreshSessions.revokedAt),
        gt(refreshSessions.expiresAt, new Date())
      )
    )
    .orderBy(desc(refreshSessions.lastUsedAt));
  return rows;
}

/**
 * Invalidate every outstanding access and refresh token for a user: bump
 * users.token_version (JWTs carry `tv`) and revoke all refresh sessions.
 * Returns the new token version.
 */
export async function revokeAllUserTokens(userId: string): Promise<number> {
  const [row] = await db
    .update(users)
    .set({ tokenVersion: sql`${users.tokenVersion} + 1` })
    .where(eq(users.id, userId))
    .returning({ tokenVersion: users.tokenVersion });
  await revokeAllRefreshSessions(userId);
  return row?.tokenVersion ?? 0;
}
