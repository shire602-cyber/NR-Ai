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
import { and, eq, inArray, isNull, or, sql, type SQL, type SQLWrapper } from "drizzle-orm";
import { databaseUtcNow } from "../../config/database-time";
import { db } from "../../db";
import { DomainError } from "../../errors";
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
  firmRoleHasPermission,
  firmRoleSeesAllClients,
  isFirmRole,
  type FirmPermission,
  type FirmRole,
} from "../../../shared/access";
import { COMPANY_ROLES, normalizeCompanyRole } from "../../../shared/permissions";

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
  actor: FirmActor | null | undefined,
  conn: Pick<Executor, "select"> = db
): Promise<FirmContext | null> {
  if (!actor?.id) return null;
  let firmRole = actor.firmRole;
  if (firmRole === undefined) {
    const [u] = await conn
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
  const [row] = await conn
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

/** Re-read middleware's firm context while holding the actor and selected firm membership. */
export async function lockFirmLinkAuthority(
  expected: Pick<FirmContext, "firmId" | "userId" | "isNr">,
  permission: FirmPermission,
  tx: Pick<Executor, "select">
): Promise<FirmContext> {
  await tx.select({ id: users.id }).from(users).where(eq(users.id, expected.userId)).for("share");
  await tx
    .select({ id: firmMembers.id })
    .from(firmMembers)
    .where(eq(firmMembers.userId, expected.userId))
    .for("share");
  const [firm] = await tx
    .select({ status: firms.status })
    .from(firms)
    .where(eq(firms.id, expected.firmId))
    .for("share");
  const current = await resolveFirmContext({ id: expected.userId }, tx);
  if (
    !current ||
    current.firmId !== expected.firmId ||
    current.isNr !== expected.isNr ||
    firm?.status !== "active" ||
    (!current.platformAdmin && !firmRoleHasPermission(current.role, permission))
  ) {
    throw new DomainError("FIRM_PERMISSION_DENIED", 403, { permission });
  }
  return current;
}

/** Serialize company-scoped link changes with Team membership writes. */
export async function lockClientCompany(companyId: string, tx: Pick<Executor, "select">) {
  const [company] = await tx
    .select({ id: companies.id })
    .from(companies)
    .where(and(eq(companies.id, companyId), isNull(companies.deletedAt)))
    .for("no key update");
  if (!company) throw new DomainError("CLIENT_NOT_FOUND", 404);
}

export async function assertClientOwner(
  userId: string,
  companyId: string,
  tx: Pick<Executor, "select">
) {
  const [account] = await tx
    .select({ userType: users.userType })
    .from(users)
    .where(eq(users.id, userId))
    .for("share");
  const [membership] = await tx
    .select({ role: companyUsers.role })
    .from(companyUsers)
    .where(and(eq(companyUsers.companyId, companyId), eq(companyUsers.userId, userId)))
    .for("share");
  if (
    !account ||
    account.userType === "client_portal" ||
    normalizeCompanyRole(membership?.role) !== "owner"
  ) {
    throw new DomainError("COMPANY_OWNER_REQUIRED", 403);
  }
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

type SqlValue = string | SQLWrapper;

function auditDetails(details: SQL) {
  return sql`((case when ${details} is json object then ${details} else '{}' end)::jsonb)`;
}

function legacyTeamRoleSave(companyId: SqlValue, userId: SqlValue, createdAt: SqlValue) {
  const details = auditDetails(sql`change.details`);
  return sql`exists (select 1 from company_users edited
    join audit_logs change on change.company_id = edited.company_id and change.resource_id = edited.id::text
    where edited.company_id = ${companyId} and edited.user_id = ${userId}
      and edited.created_at = ${createdAt} and edited.role <> 'owner'
      and change.resource_type = 'company_user' and change.action = 'team.role_change'
      and change.created_at >= edited.created_at
      and ${details} #>> '{after,userId}' = edited.user_id::text
      and ${details} #>> '{before,userId}' = edited.user_id::text
      and ${details} #>> '{after,role}' in ('admin', 'accountant', 'bookkeeper', 'viewer')
      and ${details} #>> '{before,role}' in ('accountant', 'bookkeeper', 'viewer'))`;
}

function recordedCompanyAcceptance(companyId: SqlValue, userId: SqlValue) {
  return sql`exists (select 1 from company_invitations invite
    where invite.company_id = ${companyId} and invite.accepted_user_id = ${userId}
      and invite.status = 'accepted')`;
}

function acceptanceMatchesMembership(
  details: SQL,
  memberId: SQL,
  memberCreatedAt: SQL,
  acceptedAt: SQL,
  auditCreatedAt: SQL,
  directCreationEvidence = sql`false`
) {
  const recordedId = sql`(${details} #>> '{after,membershipId}')`;
  // An explicit ID identifies the membership lifetime. Older receipts require both clocks to
  // agree, except when an audited direct creation establishes the same database transaction.
  return sql`(${recordedId} = ${memberId}::text or (
    ${recordedId} is null and (
      (${memberCreatedAt} <= ${acceptedAt} and ${memberCreatedAt} <= ${auditCreatedAt})
      or ${directCreationEvidence}
    )
  ))`;
}

function verifiedDirectAcceptance(companyId: SqlValue, userId: SqlValue) {
  const details = auditDetails(sql`acceptance.details`);
  return sql`exists (select 1 from company_invitations confirmed
    join company_users direct_member on direct_member.company_id = confirmed.company_id and direct_member.user_id = confirmed.accepted_user_id
    join audit_logs acceptance on acceptance.company_id = confirmed.company_id and acceptance.resource_id = confirmed.id::text
    where confirmed.company_id = ${companyId} and confirmed.accepted_user_id = ${userId}
      and confirmed.status = 'accepted' and confirmed.accepted_at is not null
      and acceptance.user_id = confirmed.accepted_user_id and acceptance.action = 'team.invite_accept'
      and acceptance.resource_type = 'company_invitation'
      and ${details} #>> '{after,directCompanyGrant}' = 'true'
      and ${acceptanceMatchesMembership(
        details,
        sql`direct_member.id`,
        sql`direct_member.created_at`,
        sql`confirmed.accepted_at`,
        sql`acceptance.created_at`,
        sql`
        date_trunc('milliseconds', direct_member.created_at) = acceptance.created_at
        and not exists (select 1 from firm_company_grants current_grant
          where current_grant.company_id = confirmed.company_id
            and current_grant.user_id = confirmed.accepted_user_id and current_grant.created_membership)
      `
      )})`;
}

function directInviteGrantor(companyId: SqlValue, actorId: SqlValue, role: SqlValue) {
  return sql`exists (
    select 1 from company_users grantor
    join users grantor_user on grantor_user.id = grantor.user_id
    where grantor.company_id = ${companyId} and grantor.user_id = ${actorId}
      and grantor_user.user_type <> 'client_portal'
      and (grantor.role = 'owner' or (grantor.role = 'admin' and ${role} <> 'owner'))
      and not exists (select 1 from firm_company_grants origin
        where origin.company_id = grantor.company_id and origin.user_id = grantor.user_id
          and (origin.created_membership or (
            ${legacyTeamRoleSave(sql`origin.company_id`, sql`origin.user_id`, sql`origin.created_at`)}
            and not (${verifiedDirectAcceptance(sql`origin.company_id`, sql`origin.user_id`)})
          )))
  )`;
}

export async function canAuthorizeDirectCompanyInvite(
  companyId: string,
  actorId: string | null,
  role: string,
  conn: Pick<Executor, "select"> = db
): Promise<boolean> {
  if (!actorId) return false;
  const [company] = await conn
    .select({ id: companies.id })
    .from(companies)
    .where(
      and(
        eq(companies.id, companyId),
        isNull(companies.deletedAt),
        directInviteGrantor(companyId, actorId, role)
      )
    );
  return !!company;
}

/** The column pair is ordered within an audit chain even for events in the same millisecond. */
function eventAfterAcceptance(eventTime: SQL, eventSequence: SQL): SQL {
  return sql`(case when ${eventSequence} is not null and accepted.seq is not null
    then ${eventSequence} > accepted.seq else ${eventTime} > accepted.created_at end)`;
}

/**
 * Reconstruct the inviter's authority on the exact membership at consent. A later edit's
 * previous role is evidence about the acceptance, while today's role only applies if the
 * lifetime has no later edit. A removed member needs a pre-acceptance audit naming its ID.
 * This query runs inside the accepted invitation's company audit chain.
 */
function historicalInviteGrantor() {
  const changed = auditDetails(sql`changed.details`);
  const retired = auditDetails(sql`retired.details`);
  const known = auditDetails(sql`known.details`);
  return sql`exists (
    select 1 from (
      select member.id::text as id, member.created_at as started_at, member.role as last_role,
        true as current_lifetime
      from company_users member
      where member.company_id = ci.company_id and member.user_id = ci.invited_by
        and member.created_at <= ci.accepted_at and member.created_at <= accepted.created_at
      union all
      select retired.resource_id, null, ${retired} #>> '{before,role}', false
      from audit_logs retired
      where retired.company_id = ci.company_id and retired.resource_type = 'company_user'
        and retired.action = 'team.remove' and ${retired} #>> '{before,userId}' = ci.invited_by::text
        and ${eventAfterAcceptance(sql`retired.created_at`, sql`retired.seq`)}
        and (exists (select 1 from audit_logs known
          where known.company_id = ci.company_id and known.resource_type = 'company_user'
            and known.resource_id = retired.resource_id and known.action = 'team.role_change'
            and ${known} #>> '{after,userId}' = ci.invited_by::text
            and not ${eventAfterAcceptance(sql`known.created_at`, sql`known.seq`)}
        ) or exists (select 1 from company_invitations own_invite
          join audit_logs own_accept on own_accept.company_id = own_invite.company_id
            and own_accept.resource_id = own_invite.id::text
          where own_invite.company_id = ci.company_id and own_invite.status = 'accepted'
            and own_invite.accepted_user_id = ci.invited_by
            and own_accept.user_id = ci.invited_by
            and own_accept.resource_type = 'company_invitation'
            and own_accept.action = 'team.invite_accept'
            and ${auditDetails(sql`own_accept.details`)} #>> '{after,membershipId}' = retired.resource_id
            and ${auditDetails(sql`own_accept.details`)} #>> '{after,directCompanyGrant}' = 'true'
            and not ${eventAfterAcceptance(sql`own_accept.created_at`, sql`own_accept.seq`)}
        ))
    ) grantor
    join users account on account.id = ci.invited_by and account.user_type <> 'client_portal'
    left join lateral (
      select ${changed} #>> '{before,role}' as before_role
      from audit_logs changed
      where changed.company_id = ci.company_id and changed.resource_type = 'company_user'
        and changed.resource_id = grantor.id and changed.action = 'team.role_change'
        and ${changed} #>> '{before,userId}' = ci.invited_by::text
        and ${eventAfterAcceptance(sql`changed.created_at`, sql`changed.seq`)}
      order by (case when accepted.seq is not null then changed.seq end) nulls last, changed.created_at
      limit 1
    ) next_change on true
    where (coalesce(next_change.before_role, grantor.last_role) = 'owner' or (
      coalesce(next_change.before_role, grantor.last_role) = 'admin' and ci.role <> 'owner'
    ))
    and not exists (select 1 from firm_company_grants origin
      where origin.company_id = ci.company_id and origin.user_id = ci.invited_by
        and origin.created_at <= ci.accepted_at
        and (not grantor.current_lifetime or origin.created_at >= grantor.started_at)
        and (origin.created_membership or ${legacyTeamRoleSave(sql`origin.company_id`, sql`origin.user_id`, sql`origin.created_at`)})
    )
  )`;
}

function provenCompanyInvite(companyId: SqlValue, userId: SqlValue) {
  const details = auditDetails(sql`accepted.details`);
  return sql`select ci.role from company_invitations ci
    join company_users target on target.company_id = ci.company_id and target.user_id = ci.accepted_user_id
    join users invitee on invitee.id = target.user_id
    join audit_logs accepted on accepted.company_id = ci.company_id and accepted.resource_id = ci.id::text
      and accepted.resource_type = 'company_invitation' and accepted.user_id = ci.accepted_user_id
      and accepted.action = 'team.invite_accept'
    where ci.company_id = ${companyId} and ci.accepted_user_id = ${userId}
      and ci.status = 'accepted' and ci.accepted_at is not null and ci.accepted_user_id <> ci.invited_by
      and ci.role in (${sql.join(
        COMPANY_ROLES.map((role) => sql`${role}`),
        sql`, `
      )})
      and lower(invitee.email) = lower(ci.email)
      and ${details} #>> '{after,role}' = ci.role
      and ${acceptanceMatchesMembership(details, sql`target.id`, sql`target.created_at`, sql`ci.accepted_at`, sql`accepted.created_at`)}
      and ${historicalInviteGrantor()}
      and exists (select 1 from audit_logs issued
        where issued.company_id = ci.company_id and issued.resource_id = ci.id::text
          and issued.resource_type = 'company_invitation' and issued.user_id = ci.invited_by
          and issued.action in ('team.invite', 'team.invite_resend')
          and issued.created_at between ci.created_at and accepted.created_at)
    order by accepted.created_at desc, ci.id desc limit 1`;
}

/** Only a proven acceptance on this membership counts as legacy independent authority. */
export function acceptedCompanyInvite(companyId: SqlValue, userId: SqlValue) {
  return sql`(${verifiedDirectAcceptance(companyId, userId)} or exists (${provenCompanyInvite(companyId, userId)}))`;
}

export async function historicDirectCompanyRole(
  companyId: string,
  userId: string,
  conn: Pick<Executor, "select"> = db
): Promise<string | null> {
  const [match] = await conn
    .select({ role: sql<string | null>`(${provenCompanyInvite(companyId, userId)})` })
    .from(companyUsers)
    .where(and(eq(companyUsers.companyId, companyId), eq(companyUsers.userId, userId)));
  return match?.role ?? null;
}

/** A short-lived Team role-save path flipped generated grants to false. Repair only exact proof. */
export function firmCreatedMembership(
  companyId: SqlValue,
  userId: SqlValue,
  createdMembership: SqlValue,
  grantCreatedAt: SqlValue
) {
  return sql`(${createdMembership} or (
    ${legacyTeamRoleSave(companyId, userId, grantCreatedAt)}
    and not (${acceptedCompanyInvite(companyId, userId)})
  ))`;
}

export function recordedFirmOrigin() {
  return firmCreatedMembership(
    firmCompanyGrants.companyId,
    firmCompanyGrants.userId,
    firmCompanyGrants.createdMembership,
    firmCompanyGrants.createdAt
  );
}

function assignedCondition(ctx: FirmContext): SQL {
  const grants = sql`select 1 from firm_company_grants fcg where fcg.company_id = ${companies.id} and fcg.user_id = ${ctx.userId}`;
  const assignment = sql`exists (select 1 from firm_staff_assignments fsa where fsa.company_id = ${companies.id} and fsa.user_id = ${ctx.userId})`;
  const verifiedAssignment = and(
    assignment,
    sql`(not exists (${grants}) or exists (${grants} and fcg.firm_id = ${ctx.firmId}))`,
    sql`not exists (${grants} and ${firmCreatedMembership(sql`fcg.company_id`, sql`fcg.user_id`, sql`fcg.created_membership`, sql`fcg.created_at`)} and fcg.firm_id <> ${ctx.firmId})`
  );
  if (!ctx.isNr) return verifiedAssignment as SQL;
  // Accepted invitations suppress implicit legacy scope even if old mixed-clock dates
  // leave too little evidence to treat this particular membership as an independent grant.
  return or(
    verifiedAssignment,
    and(
      sql`not (${recordedCompanyAcceptance(companies.id, ctx.userId)})`,
      or(
        sql`not exists (${grants})`,
        sql`exists (${grants} and fcg.created_membership and fcg.firm_id = ${ctx.firmId})`
      ),
      sql`exists (select 1 from company_users cu where cu.company_id = ${companies.id} and cu.user_id = ${ctx.userId})`
    )
  ) as SQL;
}

/** Clients this user may see: all of the firm's for firm_owner, else assigned ones. */
export function accessibleClientCondition(ctx: FirmContext): SQL {
  const base = firmClientCondition(ctx.firmId, ctx.isNr);
  if (ctx.platformAdmin || firmRoleSeesAllClients(ctx.role)) return base;
  return and(base, assignedCondition(ctx)) as SQL;
}

export async function listAccessibleClientIds(ctx: FirmContext): Promise<string[]> {
  const rows = (await db
    .select({ id: companies.id })
    .from(companies)
    .where(accessibleClientCondition(ctx))) as Array<{ id: string }>;
  return rows.map((r) => r.id);
}

export async function canAccessFirmClient(
  ctx: FirmContext,
  companyId: string,
  conn: Pick<typeof db, "select"> = db,
  lock?: "share"
): Promise<boolean> {
  if (!isUuid(companyId)) return false;
  if (lock) {
    await conn
      .select({ companyId: firmClientLinks.companyId })
      .from(firmClientLinks)
      .where(eq(firmClientLinks.companyId, companyId))
      .for(lock);
    if (!firmRoleSeesAllClients(ctx.role)) {
      await conn
        .select({ userId: firmStaffAssignments.userId })
        .from(firmStaffAssignments)
        .where(
          and(
            eq(firmStaffAssignments.companyId, companyId),
            eq(firmStaffAssignments.userId, ctx.userId)
          )
        )
        .for(lock);
      await conn
        .select({ userId: companyUsers.userId })
        .from(companyUsers)
        .where(and(eq(companyUsers.companyId, companyId), eq(companyUsers.userId, ctx.userId)))
        .for(lock);
    }
  }
  const [row] = await conn
    .select({ id: companies.id })
    .from(companies)
    .where(and(eq(companies.id, companyId), accessibleClientCondition(ctx)))
    .limit(1);
  return !!row;
}

/** Is the company in the firm's client set at all (regardless of assignment)? */
export async function isFirmClient(
  ctx: Pick<FirmContext, "firmId" | "isNr">,
  companyId: string,
  conn: Pick<Executor, "select"> = db,
  lock?: "share"
): Promise<boolean> {
  if (!isUuid(companyId)) return false;
  if (lock) {
    await conn
      .select({ companyId: firmClientLinks.companyId })
      .from(firmClientLinks)
      .where(eq(firmClientLinks.companyId, companyId))
      .for(lock);
  }
  const [row] = await conn
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
export async function listFirmMembers(
  firmId: string,
  isNr: boolean,
  conn: Pick<Executor, "select"> = db
): Promise<FirmMemberRow[]> {
  const byMembership = (await conn
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
    const legacy = (await conn
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

export async function listFirmMemberIds(
  firmId: string,
  isNr: boolean,
  conn: Pick<Executor, "select"> = db
): Promise<string[]> {
  return (await listFirmMembers(firmId, isNr, conn)).map((m) => m.userId);
}

/** The firm role a user holds in `firmId`, or null when not a member there. */
export async function firmRoleOf(userId: string, firmId: string): Promise<FirmRole | null> {
  const ctx = await resolveFirmContext({ id: userId });
  if (!ctx || ctx.platformAdmin || ctx.firmId !== firmId) return null;
  return ctx.role;
}

// ─── Company access grants ───────────────────────────────────────────────────

export async function hasFirmCreatedCompanyMembership(
  companyId: string,
  userId: string,
  exec: Pick<Executor, "select"> = db
): Promise<boolean> {
  const [grant] = await exec
    .select({ id: firmCompanyGrants.id })
    .from(firmCompanyGrants)
    .where(
      and(
        eq(firmCompanyGrants.companyId, companyId),
        eq(firmCompanyGrants.userId, userId),
        recordedFirmOrigin()
      )
    )
    .limit(1);
  return !!grant;
}

/** Adopt the role directly while holding the actor lock in the membership transaction. */
export async function markCompanyMembershipDirect(
  companyId: string,
  userId: string,
  exec: Pick<Executor, "update">
): Promise<void> {
  await exec
    .update(firmCompanyGrants)
    .set({ createdMembership: false })
    .where(
      and(
        eq(firmCompanyGrants.companyId, companyId),
        eq(firmCompanyGrants.userId, userId),
        eq(firmCompanyGrants.createdMembership, true)
      )
    );
}

/** Repair historical origin with the member locked, before a firm mutates the grant. */
export async function reconcileCompanyMembershipOrigin(
  companyId: string,
  userId: string,
  exec: Pick<Executor, "select" | "update">
) {
  if (!(await hasFirmCreatedCompanyMembership(companyId, userId, exec))) return;
  const [direct] = await exec
    .select({ id: companyUsers.id })
    .from(companyUsers)
    .where(
      and(
        eq(companyUsers.companyId, companyId),
        eq(companyUsers.userId, userId),
        verifiedDirectAcceptance(companyId, userId)
      )
    );
  if (direct) {
    await markCompanyMembershipDirect(companyId, userId, exec);
    return;
  }
  const role = await historicDirectCompanyRole(companyId, userId, exec);
  if (role) {
    await exec
      .update(companyUsers)
      .set({ role })
      .where(
        and(
          eq(companyUsers.companyId, companyId),
          eq(companyUsers.userId, userId),
          sql`${companyUsers.role} <> 'owner'`
        )
      );
    await markCompanyMembershipDirect(companyId, userId, exec);
    return;
  }
  await exec
    .update(firmCompanyGrants)
    .set({ createdMembership: true })
    .where(
      and(
        eq(firmCompanyGrants.companyId, companyId),
        eq(firmCompanyGrants.userId, userId),
        eq(firmCompanyGrants.createdMembership, false),
        recordedFirmOrigin()
      )
    );
}

/**
 * Give a firm member a company_users row in a client's books (the core company
 * RBAC then governs what they may do there). Records whether the row was
 * created by the firm so revocation removes exactly what the firm added.
 */
export async function grantCompanyAccess(
  input: { firmId: string; userId: string; companyId: string; role: FirmRole },
  exec?: Executor
): Promise<void> {
  // Commit the membership and its provenance together. A concurrent preexisting membership
  // must never be marked as firm-created merely because our insert lost the unique-key race.
  if (!exec) return db.transaction((tx) => grantCompanyAccess(input, tx));
  await exec.select({ id: users.id }).from(users).where(eq(users.id, input.userId)).for("update");
  const [created] = await exec
    .insert(companyUsers)
    .values({
      companyId: input.companyId,
      userId: input.userId,
      role: FIRM_ROLE_COMPANY_ROLE[input.role],
    })
    .onConflictDoNothing()
    .returning({ id: companyUsers.id });
  const grant = exec.insert(firmCompanyGrants).values({
    firmId: input.firmId,
    userId: input.userId,
    companyId: input.companyId,
    createdMembership: !!created,
  });
  if (created) {
    await grant.onConflictDoUpdate({
      target: [firmCompanyGrants.firmId, firmCompanyGrants.userId, firmCompanyGrants.companyId],
      set: { createdMembership: true, createdAt: sql`excluded.created_at` },
    });
  } else {
    await grant.onConflictDoNothing();
    await reconcileCompanyMembershipOrigin(input.companyId, input.userId, exec);
  }
}

/**
 * Remove the access a firm granted in a company: the company_users rows it
 * created and its staff assignments. With `userId`, only that member. Records confirming
 * independent origin remain so repeated revocations can distinguish those company roles.
 */
export async function revokeCompanyAccess(
  input: {
    firmId: string;
    isNr: boolean;
    companyId: string;
    userId?: string;
    disconnect?: {
      linkId?: string;
      actorId: string;
      reason: string | null;
      authority: "client_owner" | "firm.clients.link" | "firm.clients.archive";
    };
  },
  exec?: Executor
): Promise<{ removedMemberships: number }> {
  if (!exec) return db.transaction((tx) => revokeCompanyAccess(input, tx));
  if (input.disconnect) await lockClientCompany(input.companyId, exec);
  const grantWhere = and(
    eq(firmCompanyGrants.firmId, input.firmId),
    eq(firmCompanyGrants.companyId, input.companyId),
    input.userId ? eq(firmCompanyGrants.userId, input.userId) : undefined
  );
  const memberIds = input.userId
    ? [input.userId]
    : await listFirmMemberIds(input.firmId, input.isNr, exec);
  const recorded = await exec
    .select({ userId: firmCompanyGrants.userId })
    .from(firmCompanyGrants)
    .where(grantWhere);
  const affected = new Set([...memberIds, ...recorded.map((row) => row.userId)]);
  if (input.disconnect) affected.add(input.disconnect.actorId);
  if (affected.size) {
    await exec
      .select({ id: users.id })
      .from(users)
      .where(inArray(users.id, [...affected]))
      .orderBy(users.id)
      .for("update");
  }
  if (input.disconnect) {
    // Staff assignment locks the user before the link. Keep this order while committing the
    // link change, grants and assignments together.
    const { linkId, actorId, reason, authority } = input.disconnect;
    if (authority === "client_owner") {
      await assertClientOwner(actorId, input.companyId, exec);
    } else {
      await lockFirmLinkAuthority(
        { firmId: input.firmId, isNr: input.isNr, userId: actorId },
        authority,
        exec
      );
    }
    const [link] = await exec
      .update(firmClientLinks)
      .set({
        status: "revoked",
        revokedBy: actorId,
        revokedAt: databaseUtcNow,
        updatedAt: databaseUtcNow,
        revokeReason: reason,
      })
      .where(
        and(
          eq(firmClientLinks.firmId, input.firmId),
          eq(firmClientLinks.companyId, input.companyId),
          eq(firmClientLinks.status, "active"),
          linkId ? eq(firmClientLinks.id, linkId) : undefined
        )
      )
      .returning({ id: firmClientLinks.id });
    if (linkId && !link) throw new DomainError("LINK_NOT_FOUND", 404);
  }
  const grants = await exec
    .select({ userId: firmCompanyGrants.userId })
    .from(firmCompanyGrants)
    .where(and(grantWhere, recordedFirmOrigin()));
  for (const { userId } of grants) {
    await reconcileCompanyMembershipOrigin(input.companyId, userId, exec);
  }
  const generated = await exec
    .select({ userId: firmCompanyGrants.userId })
    .from(firmCompanyGrants)
    .where(and(grantWhere, eq(firmCompanyGrants.createdMembership, true)));
  const toRemove = new Set(generated.map((g) => g.userId));
  // An NR assignment predating provenance can still identify a legacy generated row.
  if (input.isNr && memberIds.length) {
    const assignments = await exec
      .select({ userId: firmStaffAssignments.userId })
      .from(firmStaffAssignments)
      .where(
        and(
          eq(firmStaffAssignments.companyId, input.companyId),
          inArray(firmStaffAssignments.userId, memberIds),
          // A receipt from an earlier membership cannot preserve a later firm assignment.
          sql`not (${acceptedCompanyInvite(input.companyId, firmStaffAssignments.userId)})`,
          sql`not exists (select 1 from firm_company_grants fcg where fcg.company_id = ${input.companyId} and fcg.user_id = ${firmStaffAssignments.userId})`
        )
      );
    for (const { userId } of assignments) toRemove.add(userId);
  }
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
  await exec
    .delete(firmCompanyGrants)
    .where(and(grantWhere, eq(firmCompanyGrants.createdMembership, true)));
  if (memberIds.length > 0) {
    await exec
      .delete(firmStaffAssignments)
      .where(
        and(
          eq(firmStaffAssignments.companyId, input.companyId),
          inArray(firmStaffAssignments.userId, memberIds),
          sql`not exists (select 1 from firm_client_links fcl where fcl.company_id = ${input.companyId} and fcl.status = 'active' and fcl.firm_id <> ${input.firmId})`
        )
      );
  }
  return { removedMemberships: removed };
}

/** Active link of a company (any firm), if any. */
export async function activeLinkForCompany(companyId: string, conn: Pick<Executor, "select"> = db) {
  const [row] = await conn
    .select()
    .from(firmClientLinks)
    .where(and(eq(firmClientLinks.companyId, companyId), eq(firmClientLinks.status, "active")))
    .limit(1);
  return row ?? null;
}

/** Link a company to a firm as an active client (used for firm-created clients). */
export async function activateClientLink(
  input: { firmId: string; isNr: boolean; companyId: string; actorId: string },
  exec?: Executor
): Promise<void> {
  if (!exec) return db.transaction((tx) => activateClientLink(input, tx));
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
    const owners = (await listFirmMembers(input.firmId, false, exec))
      .filter((m) => m.role === "firm_owner")
      .sort((a, b) => a.userId.localeCompare(b.userId));
    for (const o of owners) {
      await grantCompanyAccess(
        { firmId: input.firmId, userId: o.userId, companyId: input.companyId, role: o.role },
        exec
      );
    }
  }
}
