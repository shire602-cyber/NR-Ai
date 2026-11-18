// Explicit, opt-in grant and revoke of the platform owner role (all-tenant admin + NR
// firm_owner). Replaces the promotion that migration 0054 used to bake into every database
// that ran the chain (audit finding S-H3): no email address lives in source any more; the
// operator names the account at run time through scripts/ops/platform-owner.ts.
//
// Neither direction creates a user or touches password material. Both are idempotent, run
// in one transaction, and write a chained audit row (action platform_owner.grant / .revoke).
import { and, count, eq, ne, sql } from "drizzle-orm";
import { db } from "../db";
import { companyUsers, firmMembers, users } from "../../shared/schema";
import { NR_FIRM_ID } from "./firm/scope";
import { storage } from "../storage";

export interface PlatformOwnerState {
  userId: string;
  email: string;
  isAdmin: boolean;
  userType: string;
  firmRole: string | null;
  nrFirmMemberRole: string | null;
}

export type PlatformOwnerResult =
  | { ok: true; changed: boolean; before: PlatformOwnerState; after: PlatformOwnerState }
  | {
      ok: false;
      code: "USER_NOT_FOUND" | "AMBIGUOUS_EMAIL" | "CONFIRMATION_MISMATCH" | "MEMBER_OF_OTHER_FIRM";
    };

export interface PlatformOwnerOptions {
  /** Must repeat the email exactly (case-insensitive) so a typo cannot promote someone else. */
  confirm: string;
  /** Optional acting user recorded on the audit row. */
  actorUserId?: string | null;
}

const normalize = (email: string) => email.trim().toLowerCase();

async function loadState(email: string): Promise<PlatformOwnerState[]> {
  const rows = (await db
    .select({
      userId: users.id,
      email: users.email,
      isAdmin: users.isAdmin,
      userType: users.userType,
      firmRole: users.firmRole,
      nrFirmMemberRole: firmMembers.role,
    })
    .from(users)
    .leftJoin(
      firmMembers,
      and(eq(firmMembers.userId, users.id), eq(firmMembers.firmId, NR_FIRM_ID))
    )
    .where(sql`lower(trim(${users.email})) = ${email}`)) as PlatformOwnerState[];
  return rows;
}

function isOwner(s: PlatformOwnerState): boolean {
  return (
    s.isAdmin &&
    s.userType === "admin" &&
    s.firmRole === "firm_owner" &&
    s.nrFirmMemberRole === "firm_owner"
  );
}

function isPlain(s: PlatformOwnerState): boolean {
  return !s.isAdmin && s.userType !== "admin" && s.firmRole === null && s.nrFirmMemberRole === null;
}

async function resolve(
  rawEmail: string,
  confirm: string
): Promise<{ ok: true; state: PlatformOwnerState } | Extract<PlatformOwnerResult, { ok: false }>> {
  const email = normalize(rawEmail);
  if (!email || normalize(confirm) !== email) return { ok: false, code: "CONFIRMATION_MISMATCH" };
  const rows = await loadState(email);
  if (rows.length === 0) return { ok: false, code: "USER_NOT_FOUND" };
  if (rows.length > 1) return { ok: false, code: "AMBIGUOUS_EMAIL" };
  return { ok: true, state: rows[0] };
}

async function audit(
  action: "platform_owner.grant" | "platform_owner.revoke",
  before: PlatformOwnerState,
  after: PlatformOwnerState,
  actorUserId: string | null | undefined
) {
  await storage.createAuditLog({
    userId: actorUserId ?? null,
    companyId: null,
    action,
    resourceType: "user",
    resourceId: before.userId,
    details: JSON.stringify({ before, after, via: "scripts/ops/platform-owner.ts" }),
    ipAddress: null,
    userAgent: "ops:platform-owner",
  });
}

/** Make an EXISTING account the platform owner: is_admin, user_type admin, NR firm_owner. */
export async function grantPlatformOwner(
  email: string,
  opts: PlatformOwnerOptions
): Promise<PlatformOwnerResult> {
  const r = await resolve(email, opts.confirm);
  if (!r.ok) return r;
  const before = r.state;
  if (isOwner(before)) return { ok: true, changed: false, before, after: before };
  // A staff member of another accounting firm is never silently moved into the NR firm.
  const [otherFirm] = await db
    .select({ firmId: firmMembers.firmId })
    .from(firmMembers)
    .where(and(eq(firmMembers.userId, before.userId), ne(firmMembers.firmId, NR_FIRM_ID)))
    .limit(1);
  if (otherFirm) return { ok: false, code: "MEMBER_OF_OTHER_FIRM" };
  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ isAdmin: true, userType: "admin", firmRole: "firm_owner" })
      .where(eq(users.id, before.userId));
    await tx
      .insert(firmMembers)
      .values({ firmId: NR_FIRM_ID, userId: before.userId, role: "firm_owner" })
      .onConflictDoUpdate({ target: firmMembers.userId, set: { role: "firm_owner" } });
  });
  const [after] = await loadState(normalize(email));
  await audit("platform_owner.grant", before, after, opts.actorUserId);
  return { ok: true, changed: true, before, after };
}

/**
 * Remove platform-owner rights from an account (the reviewed replacement for
 * retired docs/proposed-migrations/revoke-shire602-admin.sql draft). Company memberships the account
 * holds are left in place and reported by the CLI: removing them is a per-tenant decision.
 */
export async function revokePlatformOwner(
  email: string,
  opts: PlatformOwnerOptions
): Promise<PlatformOwnerResult> {
  const r = await resolve(email, opts.confirm);
  if (!r.ok) return r;
  const before = r.state;
  if (isPlain(before)) return { ok: true, changed: false, before, after: before };
  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ isAdmin: false, userType: "customer", firmRole: null })
      .where(eq(users.id, before.userId));
    await tx
      .delete(firmMembers)
      .where(and(eq(firmMembers.userId, before.userId), eq(firmMembers.firmId, NR_FIRM_ID)));
  });
  const [after] = await loadState(normalize(email));
  await audit("platform_owner.revoke", before, after, opts.actorUserId);
  return { ok: true, changed: true, before, after };
}

/** Company memberships an account holds (reported, never changed, by the CLI). */
export async function countCompanyMemberships(userId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(companyUsers)
    .where(eq(companyUsers.userId, userId));
  return Number(row?.n ?? 0);
}
