/**
 * Firm tenancy and client scope (W5-D, R15-12 / R15-13).
 *
 * One place answers "which firm is this user acting for, with which role, and
 * which client companies may they see". Every firm route, the command centre,
 * the VAT workspace (through resolveAccessibleClientIds) and storage's
 * hasCompanyAccess() delegate here.
 *
 * - NR staff: users.firm_role (any FIRM_ROLES value) → the NR firm. No DB hit.
 * - Staff of other firms: firm_members row in an *active* firm.
 * - Platform admins without a firm role act as NR firm_owner (support).
 *
 * Client set of a firm = non-deleted companies with an ACTIVE firm_client_links
 * row for the firm. For NR only, legacy `company_type = 'client'` companies
 * that have no link row at all also count (so pre-0108 rows and clients
 * created by other code paths keep working). A revoked link, or a link to
 * another firm, always removes the company from NR's set.
 */
import { and, eq, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { db } from "../../db";
import {
  companies,
  companyUsers,
  firmClientLinks,
  firmCompanyGrants,
  firmMembers,
  firmStaffAssignments,
  firms,
  users,
} from "../../../shared/schema";
import {
  FIRM_ROLE_COMPANY_ROLE,
  FIRM_ROLES,
  firmRoleSeesAllClients,
  isFirmRole,
  type FirmRole,
} from "../../../shared/access";

/** Seeded by migration 0108. */
export const NR_FIRM_ID = "00000000-0000-4000-8000-000000000001";

export interface FirmActor {
  id: string;
  isAdmin?: boolean | null;
  firmRole?: string | null;
}

export interface FirmContext {
  firmId: string;
  isNr: boolean;
  role: FirmRole;
  userId: string;
  /** Platform admin acting without a firm role of their own. */
  platformAdmin: boolean;
}

type Executor = Pick<typeof db, "select" | "insert" | "update" | "delete" | "execute">;

/** Resolve the firm the user acts for, or null when they are not firm staff. */
export async function resolveFirmContext(
  actor: FirmActor | null | undefined
): Promise<FirmContext | null> {
  if (!actor?.id) return null;
  let firmRole = actor.firmRole;
  if (firmRole === undefined) {
    const [u] = await db
      .select({ firmRole: users.firmRole, isAdmin: users.isAdmin })
      .from(users)
      .where(eq(users.id, actor.id))
      .limit(1);
    firmRole = u?.firmRole ?? null;
    if (actor.isAdmin === undefined) actor = { ...actor, isAdmin: u?.isAdmin === true };
  }
  if (isFirmRole(firmRole)) {
    return {
      firmId: NR_FIRM_ID,
      isNr: true,
      role: firmRole,
      userId: actor.id,
      platformAdmin: false,
    };
  }
  if (actor.isAdmin === true) {
    return {
      firmId: NR_FIRM_ID,
      isNr: true,
      role: "firm_owner",
      userId: actor.id,
      platformAdmin: true,
    };
  }
  const [row] = await db
    .select({
      firmId: firmMembers.firmId,
      role: firmMembers.role,
      status: firms.status,
      isNr: firms.isNr,
    })
    .from(firmMembers)
    .innerJoin(firms, eq(firms.id, firmMembers.firmId))
    .where(eq(firmMembers.userId, actor.id))
    .limit(1);
  if (row && row.status === "active" && isFirmRole(row.role)) {
    return {
      firmId: row.firmId,
      isNr: row.isNr,
      role: row.role,
      userId: actor.id,
      platformAdmin: false,
    };
  }
  return null;
}

/** SQL predicate on `companies`: the company belongs to the firm's client set. */
export function firmClientCondition(firmId: string, isNr: boolean): SQL {
  const activeLink = sql`exists (select 1 from firm_client_links fcl where fcl.company_id = ${companies.id} and fcl.firm_id = ${firmId} and fcl.status = 'active')`;
  if (!isNr) return and(isNull(companies.deletedAt), activeLink) as SQL;
  const legacy = sql`(${companies.companyType} = 'client' and not exists (select 1 from firm_client_links fcl2 where fcl2.company_id = ${companies.id}))`;
  return and(isNull(companies.deletedAt), or(activeLink, legacy)) as SQL;
}

/** Every client company of the firm (ignores assignments). */
export async function listFirmClientIds(ctx: Pick<FirmContext, "firmId" | "isNr">) {
  const rows = (await db
    .select({ id: companies.id })
    .from(companies)
    .where(firmClientCondition(ctx.firmId, ctx.isNr))) as Array<{ id: string }>;
  return rows.map((r) => r.id);
}

function assignedCondition(userId: string): SQL {
  return or(
    sql`exists (select 1 from firm_staff_assignments fsa where fsa.company_id = ${companies.id} and fsa.user_id = ${userId})`,
    sql`exists (select 1 from company_users cu where cu.company_id = ${companies.id} and cu.user_id = ${userId})`
  ) as SQL;
}

/** Clients this user may see: all of the firm's for firm_owner, else assigned ones. */
export function accessibleClientCondition(ctx: FirmContext): SQL {
  const base = firmClientCondition(ctx.firmId, ctx.isNr);
  if (ctx.platformAdmin || firmRoleSeesAllClients(ctx.role)) return base;
  return and(base, assignedCondition(ctx.userId)) as SQL;
}

export async function listAccessibleClientIds(ctx: FirmContext): Promise<string[]> {
  const rows = (await db
    .select({ id: companies.id })
    .from(companies)
    .where(accessibleClientCondition(ctx))) as Array<{ id: string }>;
  return rows.map((r) => r.id);
}

export async function canAccessFirmClient(ctx: FirmContext, companyId: string): Promise<boolean> {
  if (!isUuid(companyId)) return false;
  const [row] = await db
    .select({ id: companies.id })
    .from(companies)
    .where(and(eq(companies.id, companyId), accessibleClientCondition(ctx)))
    .limit(1);
  return !!row;
}

/** Is the company in the firm's client set at all (regardless of assignment)? */
export async function isFirmClient(
  ctx: Pick<FirmContext, "firmId" | "isNr">,
  companyId: string
): Promise<boolean> {
  if (!isUuid(companyId)) return false;
  const [row] = await db
    .select({ id: companies.id })
    .from(companies)
    .where(and(eq(companies.id, companyId), firmClientCondition(ctx.firmId, ctx.isNr)))
    .limit(1);
  return !!row;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

// ─── Firm membership ─────────────────────────────────────────────────────────

export interface FirmMemberRow {
  userId: string;
  name: string;
  email: string;
  role: FirmRole;
}

/**
 * The firm's staff (R15-03): every user with a firm role in this firm. For NR
 * that is users.firm_role (legacy) plus any NR firm_members rows.
 */
export async function listFirmMembers(firmId: string, isNr: boolean): Promise<FirmMemberRow[]> {
  const byMembership = (await db
    .select({ userId: users.id, name: users.name, email: users.email, role: firmMembers.role })
    .from(firmMembers)
    .innerJoin(users, eq(users.id, firmMembers.userId))
    .where(eq(firmMembers.firmId, firmId))) as Array<{
    userId: string;
    name: string;
    email: string;
    role: string;
  }>;
  const out = new Map<string, FirmMemberRow>();
  if (isNr) {
    const legacy = (await db
      .select({ userId: users.id, name: users.name, email: users.email, role: users.firmRole })
      .from(users)
      .where(inArray(users.firmRole, [...FIRM_ROLES]))) as Array<{
      userId: string;
      name: string;
      email: string;
      role: string | null;
    }>;
    for (const r of legacy) {
      if (isFirmRole(r.role)) out.set(r.userId, { ...r, role: r.role });
    }
  }
  for (const r of byMembership) {
    // For NR, users.firm_role stays authoritative when both exist.
    if (isFirmRole(r.role) && !out.has(r.userId)) out.set(r.userId, { ...r, role: r.role });
  }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export async function listFirmMemberIds(firmId: string, isNr: boolean): Promise<string[]> {
  return (await listFirmMembers(firmId, isNr)).map((m) => m.userId);
}

/** The firm role a user holds in `firmId`, or null when not a member there. */
export async function firmRoleOf(userId: string, firmId: string): Promise<FirmRole | null> {
  const ctx = await resolveFirmContext({ id: userId });
  if (!ctx || ctx.platformAdmin || ctx.firmId !== firmId) return null;
  return ctx.role;
}

// ─── Company access grants ───────────────────────────────────────────────────

/**
 * Give a firm member a company_users row in a client's books (the core company
 * RBAC then governs what they may do there). Records whether the row was
 * created by the firm so revocation removes exactly what the firm added.
 */
export async function grantCompanyAccess(
  input: { firmId: string; userId: string; companyId: string; role: FirmRole },
  exec: Executor = db
): Promise<void> {
  const [existing] = await exec
    .select({ id: companyUsers.id })
    .from(companyUsers)
    .where(and(eq(companyUsers.companyId, input.companyId), eq(companyUsers.userId, input.userId)))
    .limit(1);
  let created = false;
  if (!existing) {
    await exec
      .insert(companyUsers)
      .values({
        companyId: input.companyId,
        userId: input.userId,
        role: FIRM_ROLE_COMPANY_ROLE[input.role],
      })
      .onConflictDoNothing();
    created = true;
  }
  await exec
    .insert(firmCompanyGrants)
    .values({
      firmId: input.firmId,
      userId: input.userId,
      companyId: input.companyId,
      createdMembership: created,
    })
    .onConflictDoNothing();
}

/**
 * Remove the access a firm granted in a company: the company_users rows it
 * created, its grant records and its staff assignments. With `userId`, only
 * that member. A company_users row that predates the firm grant is kept.
 */
export async function revokeCompanyAccess(
  input: { firmId: string; isNr: boolean; companyId: string; userId?: string },
  exec: Executor = db
): Promise<{ removedMemberships: number }> {
  const grantWhere = and(
    eq(firmCompanyGrants.firmId, input.firmId),
    eq(firmCompanyGrants.companyId, input.companyId),
    input.userId ? eq(firmCompanyGrants.userId, input.userId) : undefined
  );
  const grants = (await exec
    .select({ userId: firmCompanyGrants.userId, created: firmCompanyGrants.createdMembership })
    .from(firmCompanyGrants)
    .where(grantWhere)) as Array<{ userId: string; created: boolean }>;
  const memberIds = input.userId
    ? [input.userId]
    : await listFirmMemberIds(input.firmId, input.isNr);
  const grantedUsers = new Set(grants.map((g) => g.userId));
  const toRemove = new Set(grants.filter((g) => g.created).map((g) => g.userId));
  // Legacy rows (no grant record) of firm staff on this client: the firm added them.
  for (const id of memberIds) if (!grantedUsers.has(id)) toRemove.add(id);
  let removed = 0;
  if (toRemove.size > 0) {
    const del = (await exec
      .delete(companyUsers)
      .where(
        and(
          eq(companyUsers.companyId, input.companyId),
          inArray(companyUsers.userId, [...toRemove]),
          sql`${companyUsers.role} <> 'owner'`
        )
      )
      .returning({ id: companyUsers.id })) as Array<{ id: string }>;
    removed = del.length;
  }
  await exec.delete(firmCompanyGrants).where(grantWhere);
  if (memberIds.length > 0) {
    await exec
      .delete(firmStaffAssignments)
      .where(
        and(
          eq(firmStaffAssignments.companyId, input.companyId),
          inArray(firmStaffAssignments.userId, memberIds)
        )
      );
  }
  return { removedMemberships: removed };
}

/** Active link of a company (any firm), if any. */
export async function activeLinkForCompany(companyId: string) {
  const [row] = await db
    .select()
    .from(firmClientLinks)
    .where(and(eq(firmClientLinks.companyId, companyId), eq(firmClientLinks.status, "active")))
    .limit(1);
  return row ?? null;
}

/** Link a company to a firm as an active client (used for firm-created clients). */
export async function activateClientLink(
  input: { firmId: string; isNr: boolean; companyId: string; actorId: string },
  exec: Executor = db
): Promise<void> {
  await exec.insert(firmClientLinks).values({
    firmId: input.firmId,
    companyId: input.companyId,
    status: "active",
    invitedBy: input.actorId,
    acceptedBy: input.actorId,
    acceptedAt: new Date(),
  });
  if (!input.isNr) {
    // Non-NR owners have no legacy bypass: give each a membership in the books.
    const owners = (await listFirmMembers(input.firmId, false)).filter(
      (m) => m.role === "firm_owner"
    );
    for (const o of owners) {
      await grantCompanyAccess(
        { firmId: input.firmId, userId: o.userId, companyId: input.companyId, role: o.role },
        exec
      );
    }
  }
}
