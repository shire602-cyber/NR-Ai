/**
 * Real session rows over `refresh_sessions` (D5, migration 0118).
 *
 * One row = one logical login. The row id is the `sid` claim carried by both
 * the access and the refresh JWT, so revoking the row kills the access token
 * (authMiddleware looks the sid up) as well as the refresh token.
 */
import crypto from "node:crypto";
import type { Request } from "express";
import { and, desc, eq, gt, isNull, ne, sql } from "drizzle-orm";

import { db } from "../db";
import { refreshSessions } from "../../shared/schema";
import { createLogger } from "../config/logger";
import { hashToken } from "./auth-tokens.service";
import { REFRESH_TOKEN_TTL_DAYS } from "./auth-cookies.service";

const log = createLogger("sessions");

const NEW_DEVICE_WINDOW_DAYS = 180;

export function newSessionId(): string {
  return crypto.randomUUID();
}

function sessionExpiry(): Date {
  return new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
}

// ───────────────────────── Device fingerprint ─────────────────────────

export function parseUserAgent(ua: string | undefined | null): { browser: string; os: string } {
  const s = ua ?? "";
  let browser = "other";
  const pick = (re: RegExp, name: string) => {
    const m = s.match(re);
    return m ? `${name}${m[1] ?? ""}` : null;
  };
  browser =
    pick(/Edg\/(\d+)/, "edge") ||
    pick(/OPR\/(\d+)/, "opera") ||
    pick(/Chrome\/(\d+)/, "chrome") ||
    pick(/Firefox\/(\d+)/, "firefox") ||
    pick(/Version\/(\d+)[^)]*Safari/, "safari") ||
    "other";
  let os = "other";
  if (/Windows/i.test(s)) os = "windows";
  else if (/Android/i.test(s)) os = "android";
  else if (/iPhone|iPad|iOS/i.test(s)) os = "ios";
  else if (/Mac OS X|Macintosh/i.test(s)) os = "macos";
  else if (/Linux/i.test(s)) os = "linux";
  return { browser, os };
}

/** IPv4 -> /24, IPv6 -> /48. Unknown input collapses to "unknown". */
export function networkPrefix(ip: string | undefined | null): string {
  if (!ip) return "unknown";
  const clean = ip.replace(/^::ffff:/i, "");
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(clean)) return clean.split(".").slice(0, 3).join(".") + ".0/24";
  if (clean.includes(":")) {
    const [head, tail = ""] = clean.split("::");
    const headParts = head ? head.split(":") : [];
    const tailParts = tail ? tail.split(":") : [];
    const full = [...headParts, ...Array(Math.max(0, 8 - headParts.length - tailParts.length)).fill("0"), ...tailParts];
    return full.slice(0, 3).map((g) => g.toLowerCase().replace(/^0+(?=.)/, "")).join(":") + "::/48";
  }
  return "unknown";
}

export function computeDeviceHash(userId: string, userAgent: string | undefined | null, ip: string | undefined | null): string {
  const { browser, os } = parseUserAgent(userAgent);
  return crypto.createHash("sha256").update(`${userId}|${browser}|${os}|${networkPrefix(ip)}`).digest("hex");
}

function requestMeta(req: Request | undefined) {
  const userAgent = (req?.headers["user-agent"] as string | undefined)?.slice(0, 500) ?? null;
  const ip = req?.ip || req?.socket?.remoteAddress || null;
  return { userAgent, ip };
}

// ───────────────────────── Lifecycle ─────────────────────────

export interface CreatedSession {
  sid: string;
  isNewDevice: boolean;
}

/** Insert the row for tokens that were just minted. `sid` must already be in the JWTs. */
export async function createSession(opts: {
  sid: string;
  userId: string;
  refreshToken: string;
  req?: Request;
}): Promise<CreatedSession> {
  const { userAgent, ip } = requestMeta(opts.req);
  const deviceHash = computeDeviceHash(opts.userId, userAgent, ip);

  const cutoff = new Date(Date.now() - NEW_DEVICE_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const [{ earlier, sameDevice }] = (await db
    .select({
      earlier: sql<number>`count(*)::int`,
      sameDevice: sql<number>`count(*) filter (where ${refreshSessions.deviceHash} = ${deviceHash} and coalesce(${refreshSessions.lastUsedAt}, ${refreshSessions.createdAt}) > ${cutoff})::int`,
    })
    .from(refreshSessions)
    .where(eq(refreshSessions.userId, opts.userId))) as Array<{ earlier: number; sameDevice: number }>;

  await db.insert(refreshSessions).values({
    id: opts.sid,
    userId: opts.userId,
    tokenHash: hashToken(opts.refreshToken),
    expiresAt: sessionExpiry(),
    lastUsedAt: new Date(),
    userAgent,
    ipAddress: ip,
    deviceHash,
  });

  return { sid: opts.sid, isNewDevice: earlier > 0 && sameDevice === 0 };
}

export type RotateResult =
  | { ok: true; grace?: boolean }
  | { ok: false; reason: "missing" | "revoked" | "expired" | "reuse" };

/** A token just rotated away is still honoured this long, for the other half of a parallel refresh. */
export const ROTATION_GRACE_MS = 60_000;

/**
 * Atomic rotation: the holder of a current token wins. Several tokens can be current at once while
 * parallel refreshes settle: token_hash plus alt_token_hashes, the latter honoured for 60 s after
 * rotated_at. A token rotated away less than 60 s ago gets a fresh token on the same session
 * instead of a revocation; anything older that comes back is theft and kills the session.
 */
export async function rotateSession(opts: {
  sid: string;
  oldRefreshToken: string;
  newRefreshToken: string;
  req?: Request;
}): Promise<RotateResult> {
  const oldHash = hashToken(opts.oldRefreshToken);
  const newHash = hashToken(opts.newRefreshToken);
  const { userAgent, ip } = requestMeta(opts.req);
  const cutoff = new Date(Date.now() - ROTATION_GRACE_MS);
  const live = and(eq(refreshSessions.id, opts.sid), isNull(refreshSessions.revokedAt), gt(refreshSessions.expiresAt, new Date()));
  const meta = { lastUsedAt: new Date(), expiresAt: sessionExpiry(), ...(userAgent ? { userAgent } : {}), ...(ip ? { ipAddress: ip } : {}) };
  // drizzle's gt() writes the Date the way the column stores it (UTC wall time); a bare Date in sql`` would not.
  const fresh = gt(refreshSessions.rotatedAt, cutoff);

  // 1. The presenter holds a current token (the latest, or one still inside the settle window).
  const rotated = await db
    .update(refreshSessions)
    .set({
      tokenHash: newHash,
      replacedByTokenHash: newHash,
      previousTokenHash: oldHash,
      // what was valid and is not the presented token stays valid for the settle window (max 5)
      altTokenHashes: sql`(CASE WHEN ${fresh} THEN array_remove(array_append(${refreshSessions.altTokenHashes}, ${refreshSessions.tokenHash}), ${oldHash}) ELSE array_remove(ARRAY[${refreshSessions.tokenHash}]::text[], ${oldHash}) END)[1:5]`,
      rotatedAt: new Date(),
      ...meta,
    })
    .where(and(live, sql`(${refreshSessions.tokenHash} = ${oldHash} OR (${oldHash} = ANY(${refreshSessions.altTokenHashes}) AND ${fresh}))`))
    .returning({ id: refreshSessions.id });
  if (rotated.length) return { ok: true };

  // 2. Rotated away moments ago: hand out another valid token; the ones already out stay valid beside it.
  const graced = await db
    .update(refreshSessions)
    .set({
      tokenHash: newHash,
      replacedByTokenHash: newHash,
      altTokenHashes: sql`(array_append(${refreshSessions.altTokenHashes}, ${refreshSessions.tokenHash}))[1:5]`,
      ...meta,
    })
    .where(and(live, eq(refreshSessions.previousTokenHash, oldHash), fresh))
    .returning({ id: refreshSessions.id });
  if (graced.length) return { ok: true, grace: true };

  const [row] = await db.select().from(refreshSessions).where(eq(refreshSessions.id, opts.sid));
  if (!row) return { ok: false, reason: "missing" };
  if (row.revokedAt) return { ok: false, reason: "revoked" };
  if (row.expiresAt.getTime() <= Date.now()) return { ok: false, reason: "expired" };
  await db
    .update(refreshSessions)
    .set({ revokedAt: new Date(), revokedReason: "reuse", reuseDetectedAt: new Date() })
    .where(and(eq(refreshSessions.id, opts.sid), isNull(refreshSessions.revokedAt)));
  log.warn({ sid: opts.sid, userId: row.userId }, "Refresh token reuse detected; session revoked");
  return { ok: false, reason: "reuse" };
}

/** Tokens minted before sessions existed carry no sid; a legacy refresh creates its row here. */
export async function adoptLegacySession(opts: {
  sid: string;
  userId: string;
  refreshToken: string;
  req?: Request;
}): Promise<void> {
  await createSession(opts);
}

export async function isSessionActive(sid: string): Promise<boolean> {
  const [row] = await db
    .select({ revokedAt: refreshSessions.revokedAt, expiresAt: refreshSessions.expiresAt })
    .from(refreshSessions)
    .where(eq(refreshSessions.id, sid));
  return !!row && !row.revokedAt && row.expiresAt.getTime() > Date.now();
}

export interface SessionView {
  id: string;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: Date;
  lastUsedAt: Date | null;
  current: boolean;
}

export async function listSessions(userId: string, currentSid: string | null | undefined): Promise<SessionView[]> {
  const rows = await db
    .select()
    .from(refreshSessions)
    .where(
      and(eq(refreshSessions.userId, userId), isNull(refreshSessions.revokedAt), gt(refreshSessions.expiresAt, new Date()))
    )
    .orderBy(desc(refreshSessions.lastUsedAt));
  return rows.map((r: any) => ({
    id: r.id,
    userAgent: r.userAgent,
    ipAddress: r.ipAddress,
    createdAt: r.createdAt,
    lastUsedAt: r.lastUsedAt,
    current: !!currentSid && r.id === currentSid,
  }));
}

export async function revokeSession(userId: string, sid: string, reason: string): Promise<boolean> {
  const rows = await db
    .update(refreshSessions)
    .set({ revokedAt: new Date(), revokedReason: reason })
    .where(and(eq(refreshSessions.id, sid), eq(refreshSessions.userId, userId), isNull(refreshSessions.revokedAt)))
    .returning({ id: refreshSessions.id });
  return rows.length > 0;
}

/** Revoke every live session of the user except `exceptSid` (omit to revoke all). */
export async function revokeUserSessions(userId: string, reason: string, exceptSid?: string | null): Promise<number> {
  const rows = await db
    .update(refreshSessions)
    .set({ revokedAt: new Date(), revokedReason: reason })
    .where(
      and(
        eq(refreshSessions.userId, userId),
        isNull(refreshSessions.revokedAt),
        exceptSid ? ne(refreshSessions.id, exceptSid) : undefined
      )
    )
    .returning({ id: refreshSessions.id });
  return rows.length;
}

/** Housekeeping: drop sessions that have been dead for more than 30 days. */
export async function purgeDeadSessions(): Promise<number> {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const res: any = await db.execute(
    sql`DELETE FROM refresh_sessions WHERE (revoked_at IS NOT NULL AND revoked_at < ${cutoff}) OR expires_at < ${cutoff}`
  );
  return (res?.rowCount as number | undefined) ?? 0;
}
