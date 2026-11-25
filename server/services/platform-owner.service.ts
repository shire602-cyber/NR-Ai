// Explicit, opt-in grant and revoke of the platform owner role (all-tenant admin + NR
// firm_owner). Replaces the promotion that migration 0054 used to bake into every database
// that ran the chain (audit finding S-H3): no email address lives in source any more; the
// operator names the account at run time through scripts/ops/platform-owner.ts.
//
// Neither direction creates a user or touches password material. Both are idempotent, run
// in one transaction, and write a chained audit row (action platform_owner.grant / .revoke).
import { and, count, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "../db";
import { firmRoleHasPermission, isFirmRole } from "../../shared/access";
import { auditLogs, companyUsers, firmMembers, firmTimeEntries, users } from "../../shared/schema";
import { sealAuditChainWaiting } from "./audit-chain.service";
import { firmHasOwner, lockFirmMembership } from "./firm/ownership";
import {
  canAccessFirmClient,
  lockFirmClientAccess,
  lockFirmTimerUser,
  NR_FIRM_ID,
  resolveFirmContext,
  settleFirmTimersAtAccessLoss,
} from "./firm/scope";

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
      code:
        | "USER_NOT_FOUND"
        | "AMBIGUOUS_EMAIL"
        | "CONFIRMATION_MISMATCH"
        | "FIRM_MEMBER_INELIGIBLE"
        | "MEMBER_OF_OTHER_FIRM"
        | "LAST_FIRM_OWNER";
    };

export interface PlatformOwnerOptions {
  /** Must repeat the email exactly (case-insensitive) so a typo cannot promote someone else. */
  confirm: string;
  /** Optional acting user recorded on the audit row. */
  actorUserId?: string | null;
}

const normalize = (email: string) => email.trim().toLowerCase();

async function loadState(
  email: string,
  exec: Pick<typeof db, "select">,
  lockUser = false
): Promise<PlatformOwnerState[]> {
  const query = exec
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
    .where(sql`lower(trim(${users.email})) = ${email}`);
  return (await (lockUser ? query.for("update", { of: users }) : query)) as PlatformOwnerState[];
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
  confirm: string,
  exec: Pick<typeof db, "select"> = db,
  lockUser = false
): Promise<{ ok: true; state: PlatformOwnerState } | Extract<PlatformOwnerResult, { ok: false }>> {
  const email = normalize(rawEmail);
  if (!email || normalize(confirm) !== email) return { ok: false, code: "CONFIRMATION_MISMATCH" };
  const rows = await loadState(email, exec, lockUser);
  if (rows.length === 0) return { ok: false, code: "USER_NOT_FOUND" };
  if (rows.length > 1) return { ok: false, code: "AMBIGUOUS_EMAIL" };
  return { ok: true, state: rows[0] };
}

type FirmTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function insertOwnerAudit(
  tx: FirmTransaction,
  action: "platform_owner.grant" | "platform_owner.revoke",
  before: PlatformOwnerState,
  after: PlatformOwnerState,
  actorUserId: string | null | undefined,
  changedAt: Date
) {
  const [log] = await tx
    .insert(auditLogs)
    .values({
      userId: actorUserId ?? null,
      companyId: null,
      action,
      resourceType: "user",
      resourceId: before.userId,
      details: JSON.stringify({ before, after, via: "scripts/ops/platform-owner.ts" }),
      ipAddress: null,
      userAgent: "ops:platform-owner",
      createdAt: changedAt,
    })
    .returning({ seq: auditLogs.seq, chainKey: auditLogs.chainKey });
  return log.seq === null ? log.chainKey : null;
}

async function settleRevokedOwnerTimer(tx: FirmTransaction, before: PlatformOwnerState) {
  const scope = and(
    eq(firmTimeEntries.firmId, NR_FIRM_ID),
    eq(firmTimeEntries.userId, before.userId)
  )!;
  const [timer] = await tx
    .select({ companyId: firmTimeEntries.companyId })
    .from(firmTimeEntries)
    .where(and(scope, eq(firmTimeEntries.status, "running")))
    .limit(1);
  if (!timer) return new Date();

  await lockFirmClientAccess(tx, timer.companyId);
  const endedAt = new Date();
  const prior = await resolveFirmContext({ id: before.userId, ...before }, tx);
  const authorized =
    prior?.firmId === NR_FIRM_ID &&
    firmRoleHasPermission(prior.role, "firm.time.track") &&
    (await canAccessFirmClient(prior, timer.companyId, tx));
  await settleFirmTimersAtAccessLoss(
    tx,
    scope,
    inArray(firmTimeEntries.companyId, authorized ? [timer.companyId] : []),
    endedAt
  );
  return endedAt;
}

async function changePlatformOwner(
  operation: "grant" | "revoke",
  email: string,
  opts: PlatformOwnerOptions
): Promise<PlatformOwnerResult> {
  const r = await resolve(email, opts.confirm);
  if (!r.ok) return r;
  let pendingChain: string | null = null;
  const result = await db.transaction<PlatformOwnerResult>(async (tx) => {
    await lockFirmTimerUser(tx, r.state.userId);
    await lockFirmMembership(tx, NR_FIRM_ID);
    const resolved = await resolve(email, opts.confirm, tx, true);
    if (!resolved.ok) return resolved;
    const before = resolved.state;
    if (before.userId !== r.state.userId) return { ok: false, code: "USER_NOT_FOUND" };

    let changedAt: Date;
    if (operation === "grant") {
      if (before.userType === "client_portal") return { ok: false, code: "FIRM_MEMBER_INELIGIBLE" };
      if (isOwner(before)) return { ok: true, changed: false, before, after: before };
      const [otherFirm] = await tx
        .select({ firmId: firmMembers.firmId })
        .from(firmMembers)
        .where(and(eq(firmMembers.userId, before.userId), ne(firmMembers.firmId, NR_FIRM_ID)))
        .limit(1);
      if (otherFirm) return { ok: false, code: "MEMBER_OF_OTHER_FIRM" };
      changedAt = new Date();
      await tx
        .update(users)
        .set({ isAdmin: true, userType: "admin", firmRole: "firm_owner" })
        .where(eq(users.id, before.userId));
      await tx
        .insert(firmMembers)
        .values({ firmId: NR_FIRM_ID, userId: before.userId, role: "firm_owner" })
        .onConflictDoUpdate({ target: firmMembers.userId, set: { role: "firm_owner" } });
    } else {
      if (isPlain(before)) return { ok: true, changed: false, before, after: before };
      const removesOwner =
        before.userType !== "client_portal" &&
        (before.firmRole === "firm_owner" ||
          (!isFirmRole(before.firmRole) && before.nrFirmMemberRole === "firm_owner"));
      if (removesOwner && !(await firmHasOwner(tx, NR_FIRM_ID, before.userId))) {
        return { ok: false, code: "LAST_FIRM_OWNER" };
      }
      changedAt = await settleRevokedOwnerTimer(tx, before);
      await tx
        .update(users)
        .set({
          isAdmin: false,
          userType: before.userType === "client_portal" ? "client_portal" : "customer",
          firmRole: null,
        })
        .where(eq(users.id, before.userId));
      await tx
        .delete(firmMembers)
        .where(and(eq(firmMembers.userId, before.userId), eq(firmMembers.firmId, NR_FIRM_ID)));
    }
    const [after] = await loadState(normalize(email), tx);
    pendingChain = await insertOwnerAudit(
      tx,
      `platform_owner.${operation}`,
      before,
      after,
      opts.actorUserId,
      changedAt
    );
    return { ok: true, changed: true, before, after };
  });
  if (pendingChain) await sealAuditChainWaiting(pendingChain);
  return result;
}

/** Make an EXISTING account the platform owner: is_admin, user_type admin, NR firm_owner. */
export async function grantPlatformOwner(
  email: string,
  opts: PlatformOwnerOptions
): Promise<PlatformOwnerResult> {
  return changePlatformOwner("grant", email, opts);
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
  return changePlatformOwner("revoke", email, opts);
}

/** Company memberships an account holds (reported, never changed, by the CLI). */
export async function countCompanyMemberships(userId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(companyUsers)
    .where(eq(companyUsers.userId, userId));
  return Number(row?.n ?? 0);
}
