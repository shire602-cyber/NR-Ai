/**
 * Customer portal identity, tokens and throttling (W4-D: R16-04/05/06/07/16).
 *
 * - Portal access is bound to a customer contact id (never a name string).
 * - Tokens are random 256-bit values shown once; only their SHA-256 hash is stored
 *   (portal_access_tokens). Links last 90 days by default; OTP sessions 12 hours. Links can be
 *   revoked and regenerated (regenerating revokes the previous links).
 * - Every public portal/share request is throttled per IP and per token, and logged to
 *   portal_access_log. Repeated bad tokens from one IP get 429.
 * - Customers can also sign in with a one-time code sent to the contact's email address.
 */
import crypto from "crypto";
import type { Request } from "express";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import {
  customerContacts,
  customerPortalAccounts,
  portalAccessLog,
  portalAccessTokens,
  portalLoginCodes,
  type CustomerContact,
  type PortalAccessToken,
} from "../../shared/schema";
import { createLogger } from "../config/logger";

const log = createLogger("portal-access");

import { PORTAL_LINK_TTL_DAYS } from "../../shared/validators/portal";
export { PORTAL_LINK_TTL_DAYS };
export const PORTAL_SESSION_TTL_HOURS = 12;
export const LOGIN_CODE_TTL_MINUTES = 10;
export const LOGIN_CODE_MAX_ATTEMPTS = 5;

export function hashPortalToken(raw: string): string {
  return crypto.createHash("sha256").update(raw, "utf8").digest("hex");
}

function newRawToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

export async function issuePortalLink(args: {
  companyId: string;
  contactId: string;
  createdBy?: string | null;
  ttlDays?: number;
  revokeExisting?: boolean;
}): Promise<{ id: string; token: string; expiresAt: Date }> {
  const token = newRawToken();
  const expiresAt = new Date(Date.now() + (args.ttlDays ?? PORTAL_LINK_TTL_DAYS) * 86_400_000);
  const id = await db.transaction(async (tx: typeof db) => {
    if (args.revokeExisting !== false) {
      await tx
        .update(portalAccessTokens)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(portalAccessTokens.contactId, args.contactId),
            eq(portalAccessTokens.companyId, args.companyId),
            eq(portalAccessTokens.kind, "link"),
            isNull(portalAccessTokens.revokedAt)
          )
        );
    }
    const [row] = await tx
      .insert(portalAccessTokens)
      .values({
        companyId: args.companyId,
        contactId: args.contactId,
        tokenHash: hashPortalToken(token),
        kind: "link",
        expiresAt,
        createdBy: args.createdBy ?? null,
      })
      .returning({ id: portalAccessTokens.id });
    return row.id as string;
  });
  return { id, token, expiresAt };
}

export async function issuePortalSession(args: {
  companyId: string;
  contactId: string;
}): Promise<{ token: string; expiresAt: Date }> {
  const token = newRawToken();
  const expiresAt = new Date(Date.now() + PORTAL_SESSION_TTL_HOURS * 3_600_000);
  await db.insert(portalAccessTokens).values({
    companyId: args.companyId,
    contactId: args.contactId,
    tokenHash: hashPortalToken(token),
    kind: "session",
    expiresAt,
  });
  return { token, expiresAt };
}

export async function revokePortalLinks(companyId: string, contactId: string): Promise<number> {
  const rows = await db
    .update(portalAccessTokens)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(portalAccessTokens.companyId, companyId),
        eq(portalAccessTokens.contactId, contactId),
        isNull(portalAccessTokens.revokedAt)
      )
    )
    .returning({ id: portalAccessTokens.id });
  return rows.length;
}

/** Metadata about a contact's links (never the token or its hash). */
export async function listPortalLinks(companyId: string, contactId: string) {
  return db
    .select({
      id: portalAccessTokens.id,
      kind: portalAccessTokens.kind,
      expiresAt: portalAccessTokens.expiresAt,
      revokedAt: portalAccessTokens.revokedAt,
      lastUsedAt: portalAccessTokens.lastUsedAt,
      createdAt: portalAccessTokens.createdAt,
    })
    .from(portalAccessTokens)
    .where(
      and(eq(portalAccessTokens.companyId, companyId), eq(portalAccessTokens.contactId, contactId))
    )
    .orderBy(desc(portalAccessTokens.createdAt))
    .limit(50);
}

export type PortalTokenResolution =
  | { status: "ok"; token: PortalAccessToken; contact: CustomerContact }
  | { status: "invalid" | "expired" | "revoked"; token?: PortalAccessToken };

export async function resolvePortalToken(raw: string): Promise<PortalTokenResolution> {
  if (typeof raw !== "string" || !/^[0-9a-f]{64}$/i.test(raw)) return { status: "invalid" };
  const [token] = await db
    .select()
    .from(portalAccessTokens)
    .where(eq(portalAccessTokens.tokenHash, hashPortalToken(raw.toLowerCase())));
  if (!token) return { status: "invalid" };
  if (token.revokedAt) return { status: "revoked", token };
  if (new Date(token.expiresAt).getTime() < Date.now()) return { status: "expired", token };
  const [contact] = await db
    .select()
    .from(customerContacts)
    .where(
      and(eq(customerContacts.id, token.contactId), eq(customerContacts.companyId, token.companyId))
    );
  if (!contact || !contact.isActive) return { status: "revoked", token };
  await db
    .update(portalAccessTokens)
    .set({ lastUsedAt: new Date() })
    .where(eq(portalAccessTokens.id, token.id));
  return { status: "ok", token, contact };
}

// ─── Throttling ──────────────────────────────────────────────────────────────

interface Window {
  count: number;
  resetAt: number;
}

export const PORTAL_LIMITS = {
  /** Any public portal/share request per IP per minute. */
  ipPerMinute: 120,
  /** Bad/expired/revoked token answers per IP per 10 minutes. */
  ipFailuresPer10Min: 20,
  /** Requests per token per minute. */
  tokenPerMinute: 60,
  /** Login code requests per email per hour. */
  codeRequestsPerHour: 5,
};

const windows = new Map<string, Window>();

function hit(key: string, windowMs: number): number {
  const now = Date.now();
  const w = windows.get(key);
  if (!w || w.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return 1;
  }
  w.count += 1;
  return w.count;
}

function peek(key: string): number {
  const w = windows.get(key);
  return w && w.resetAt > Date.now() ? w.count : 0;
}

let sweepAt = 0;
function sweep(): void {
  const now = Date.now();
  if (now < sweepAt) return;
  sweepAt = now + 60_000;
  for (const [k, w] of windows) if (w.resetAt <= now) windows.delete(k);
}

/** Tests only. */
export function resetPortalThrottle(): void {
  windows.clear();
}

export function clientIp(req: Request): string {
  return (req.ip || req.socket?.remoteAddress || "unknown").replace(/^::ffff:/, "");
}

/** Throttle check for a public request. Returns the reason when it must get a 429. */
export function checkPortalThrottle(ip: string, tokenKey?: string | null): string | null {
  sweep();
  if (peek(`fail:${ip}`) >= PORTAL_LIMITS.ipFailuresPer10Min) return "too_many_failures";
  if (hit(`ip:${ip}`, 60_000) > PORTAL_LIMITS.ipPerMinute) return "ip_rate";
  if (tokenKey && hit(`tok:${tokenKey}`, 60_000) > PORTAL_LIMITS.tokenPerMinute) {
    return "token_rate";
  }
  return null;
}

export function recordPortalFailure(ip: string): void {
  hit(`fail:${ip}`, 10 * 60_000);
}

export function allowCodeRequest(email: string): boolean {
  return hit(`code:${email.toLowerCase()}`, 3_600_000) <= PORTAL_LIMITS.codeRequestsPerHour;
}

export async function logPortalAccess(entry: {
  req: Request;
  outcome: string;
  companyId?: string | null;
  contactId?: string | null;
  tokenId?: string | null;
}): Promise<void> {
  try {
    await db.insert(portalAccessLog).values({
      companyId: entry.companyId ?? null,
      contactId: entry.contactId ?? null,
      tokenId: entry.tokenId ?? null,
      ip: clientIp(entry.req),
      method: entry.req.method,
      // Never log the token itself.
      path: entry.req.path.replace(/[0-9a-f]{32,}/gi, ":token").slice(0, 300),
      outcome: entry.outcome,
    });
  } catch (err) {
    log.warn({ err: (err as Error)?.message }, "portal access log write failed");
  }
}

export async function listPortalAccessLog(companyId: string, contactId?: string) {
  const conds = [eq(portalAccessLog.companyId, companyId)];
  if (contactId) conds.push(eq(portalAccessLog.contactId, contactId));
  return db
    .select()
    .from(portalAccessLog)
    .where(and(...conds))
    .orderBy(desc(portalAccessLog.createdAt))
    .limit(200);
}

// ─── One-time-code login ─────────────────────────────────────────────────────

function hashCode(id: string, code: string): string {
  return crypto.createHash("sha256").update(`${id}:${code}`).digest("hex");
}

/**
 * Create a login code for the single active contact of `companyId` with this email.
 * Returns null (and creates nothing) when there is no unambiguous match.
 */
export async function createLoginCode(
  companyId: string,
  email: string
): Promise<{ code: string; contact: CustomerContact } | null> {
  const normalized = email.trim().toLowerCase();
  const contacts = await db
    .select()
    .from(customerContacts)
    .where(
      and(
        eq(customerContacts.companyId, companyId),
        eq(customerContacts.isActive, true),
        sql`lower(trim(${customerContacts.email})) = ${normalized}`
      )
    );
  if (contacts.length !== 1) return null;
  const contact = contacts[0] as CustomerContact;
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
  const id = crypto.randomUUID();
  await db.insert(portalLoginCodes).values({
    id,
    companyId,
    contactId: contact.id,
    email: normalized,
    codeHash: hashCode(id, code),
    expiresAt: new Date(Date.now() + LOGIN_CODE_TTL_MINUTES * 60_000),
  });
  return { code, contact };
}

/** Verify the latest unconsumed code for (company, email). Issues a session on success. */
export async function verifyLoginCode(
  companyId: string,
  email: string,
  code: string
): Promise<{ token: string; expiresAt: Date; contactId: string } | null> {
  const normalized = email.trim().toLowerCase();
  const [row] = await db
    .select()
    .from(portalLoginCodes)
    .where(
      and(
        eq(portalLoginCodes.companyId, companyId),
        eq(portalLoginCodes.email, normalized),
        isNull(portalLoginCodes.consumedAt),
        gt(portalLoginCodes.expiresAt, new Date())
      )
    )
    .orderBy(desc(portalLoginCodes.createdAt))
    .limit(1);
  if (!row || row.attempts >= LOGIN_CODE_MAX_ATTEMPTS) return null;
  const want = Buffer.from(row.codeHash, "hex");
  const got = Buffer.from(hashCode(row.id, String(code).trim()), "hex");
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) {
    await db
      .update(portalLoginCodes)
      .set({ attempts: sql`${portalLoginCodes.attempts} + 1` })
      .where(eq(portalLoginCodes.id, row.id));
    return null;
  }
  const [consumed] = await db
    .update(portalLoginCodes)
    .set({ consumedAt: new Date() })
    .where(and(eq(portalLoginCodes.id, row.id), isNull(portalLoginCodes.consumedAt)))
    .returning({ id: portalLoginCodes.id });
  if (!consumed) return null;
  const session = await issuePortalSession({ companyId, contactId: row.contactId });
  return { ...session, contactId: row.contactId };
}

// ─── Authenticated client-portal users ───────────────────────────────────────

export interface PortalBinding {
  id: string;
  companyId: string;
  contactId: string;
}

/**
 * Every active binding of a user (newest first). Portal access comes ONLY from these rows: a
 * portal customer is never a company member (company_users).
 */
export async function portalAccountsForUser(userId: string): Promise<PortalBinding[]> {
  return db
    .select({
      id: customerPortalAccounts.id,
      companyId: customerPortalAccounts.companyId,
      contactId: customerPortalAccounts.contactId,
    })
    .from(customerPortalAccounts)
    .where(and(eq(customerPortalAccounts.userId, userId), isNull(customerPortalAccounts.revokedAt)))
    .orderBy(desc(customerPortalAccounts.createdAt));
}

/**
 * Resolve the exact binding when one was requested. An unscoped first visit can use the newest
 * binding until access has been removed, at which point the customer must choose a supplier.
 */
export async function portalAccountForUser(
  userId: string,
  preferredAccountId?: string | null
): Promise<PortalBinding | null> {
  const bindings = await db
    .select({
      id: customerPortalAccounts.id,
      companyId: customerPortalAccounts.companyId,
      contactId: customerPortalAccounts.contactId,
      revokedAt: customerPortalAccounts.revokedAt,
      active: customerContacts.isActive,
    })
    .from(customerPortalAccounts)
    .innerJoin(
      customerContacts,
      and(
        eq(customerContacts.id, customerPortalAccounts.contactId),
        eq(customerContacts.companyId, customerPortalAccounts.companyId)
      )
    )
    .where(
      and(
        eq(customerPortalAccounts.userId, userId),
        preferredAccountId ? eq(customerPortalAccounts.id, preferredAccountId) : undefined
      )
    )
    .orderBy(desc(customerPortalAccounts.createdAt));
  if (bindings.some((binding) => binding.revokedAt || !binding.active)) return null;
  return bindings[0] ?? null;
}

/** Remember the last portal request (at most once every 5 minutes per binding). */
export async function touchPortalAccount(id: string): Promise<void> {
  try {
    await db
      .update(customerPortalAccounts)
      .set({ lastSeenAt: new Date() })
      .where(
        and(
          eq(customerPortalAccounts.id, id),
          sql`(${customerPortalAccounts.lastSeenAt} IS NULL OR ${customerPortalAccounts.lastSeenAt} < now() - interval '5 minutes')`
        )
      );
  } catch (err) {
    log.warn({ err: (err as Error)?.message }, "portal last-seen update failed");
  }
}

/**
 * Bind a user to a contact. One active binding per (company, user): an older binding of the same
 * user in the same company is revoked first. Runs inside the caller's transaction when given.
 */
export async function bindPortalUser(
  args: {
    companyId: string;
    contactId: string;
    userId: string;
    createdBy: string | null;
    invitationId?: string | null;
  },
  executor: typeof db = db
): Promise<string> {
  const run = async (tx: typeof db) => {
    await tx
      .update(customerPortalAccounts)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(customerPortalAccounts.companyId, args.companyId),
          eq(customerPortalAccounts.userId, args.userId),
          isNull(customerPortalAccounts.revokedAt)
        )
      );
    const [row] = await tx
      .insert(customerPortalAccounts)
      .values({
        companyId: args.companyId,
        contactId: args.contactId,
        userId: args.userId,
        createdBy: args.createdBy,
        invitationId: args.invitationId ?? null,
      })
      .returning({ id: customerPortalAccounts.id });
    return row.id as string;
  };
  return executor === db ? db.transaction(run) : run(executor);
}
