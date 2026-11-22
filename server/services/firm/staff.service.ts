/**
 * One firm-staff model (W5-D, R15-03).
 *
 * "Firm staff" = users holding a firm role in the caller's firm
 * (shared/access.ts FIRM_ROLES; NR via users.firm_role, other firms via
 * firm_members). Never isAdmin. Every staff listing, assignment and workload
 * endpoint (GET /firm/staff, POST /firm/clients/:id/assign-staff,
 * POST /firm/command-center/staff/assign, GET /firm/command-center/staff/workload)
 * goes through this module.
 */
import { and, eq, inArray, ne, notInArray } from "drizzle-orm";
import { db } from "../../db";
import { DomainError } from "../../errors";
import {
  companies,
  companyUsers,
  firmCompanyGrants,
  firmMembers,
  firmStaffAssignments,
  firmTimeEntries,
  users,
} from "../../../shared/schema";
import {
  FIRM_ROLE_COMPANY_ROLE,
  firmRoleHasPermission,
  firmRoleSeesAllClients,
  isFirmRole,
  type FirmRole,
} from "../../../shared/access";
import { lockFirmMembership, requireFirmOwner } from "./ownership";
import { permissionsForRole } from "../../../shared/permissions";
import {
  accessibleClientCondition,
  accessibleClientsQuery,
  assertNoUnresolvedFirmAccess,
  canAccessFirmClient,
  grantCompanyAccess,
  isFirmClient,
  listFirmMembers,
  lockFirmClientAccess,
  lockFirmTimerUser,
  resolveFirmContext,
  revokeCompanyAccess,
  settleFirmTimersAtAccessLoss,
  type FirmContext,
} from "./scope";

export const ASSIGNMENT_ROLES = ["accountant", "reviewer", "manager", "preparer"] as const;
export type AssignmentRole = (typeof ASSIGNMENT_ROLES)[number];

export interface StaffAssignmentRow {
  companyId: string;
  companyName: string;
  companyType: string;
  role: string;
}

export interface FirmStaffRow {
  id: string;
  name: string;
  email: string;
  firmRole: FirmRole;
  lastLoginAt: Date | null;
  createdAt: Date | null;
  assignedClients: StaffAssignmentRow[];
  assignedClientCount: number;
}

/** Staff of the caller's firm with their client assignments (within the firm). */
export async function listFirmStaff(ctx: FirmContext): Promise<FirmStaffRow[]> {
  const members = await listFirmMembers(ctx.firmId, ctx.isNr);
  if (members.length === 0) return [];
  const ids = members.map((m) => m.userId);
  const [profiles, assignments] = await Promise.all([
    db
      .select({ id: users.id, lastLoginAt: users.lastLoginAt, createdAt: users.createdAt })
      .from(users)
      .where(inArray(users.id, ids)) as Promise<
      Array<{ id: string; lastLoginAt: Date | null; createdAt: Date | null }>
    >,
    db
      .select({
        userId: firmStaffAssignments.userId,
        companyId: firmStaffAssignments.companyId,
        role: firmStaffAssignments.role,
        companyName: companies.name,
        companyType: companies.companyType,
      })
      .from(firmStaffAssignments)
      .innerJoin(companies, eq(companies.id, firmStaffAssignments.companyId))
      .where(
        and(inArray(firmStaffAssignments.userId, ids), accessibleClientCondition(ctx))
      ) as Promise<Array<StaffAssignmentRow & { userId: string }>>,
  ]);
  const profileById = new Map(profiles.map((p) => [p.id, p]));
  return members.map((m) => {
    const mine = assignments
      .filter((a) => a.userId === m.userId)
      .map(({ userId: _u, ...rest }) => rest);
    return {
      id: m.userId,
      name: m.name,
      email: m.email,
      firmRole: m.role,
      lastLoginAt: profileById.get(m.userId)?.lastLoginAt ?? null,
      createdAt: profileById.get(m.userId)?.createdAt ?? null,
      assignedClients: mine,
      assignedClientCount: mine.length,
    };
  });
}

export interface StaffWorkloadInputRow {
  userId: string;
  userName: string;
  userEmail: string;
  assignments: Array<{ companyId: string; role: string }>;
}

/** Workload input for the command centre: same staff definition as listFirmStaff. */
export async function staffWorkloadInput(ctx: FirmContext): Promise<StaffWorkloadInputRow[]> {
  const staff = await listFirmStaff(ctx);
  return staff.map((s) => ({
    userId: s.id,
    userName: s.name,
    userEmail: s.email,
    assignments: s.assignedClients.map((a) => ({ companyId: a.companyId, role: a.role })),
  }));
}

export interface AssignStaffInput {
  staffUserId: string;
  companyId: string;
  action: "assign" | "unassign";
  role?: string;
}

/**
 * The one assignment service. Requires firm.staff.manage; the client must be
 * in the caller's firm and the staff member must hold a role in the same firm.
 */
export async function assignStaff(
  ctx: FirmContext,
  input: AssignStaffInput
): Promise<{
  action: "assign" | "unassign";
  companyId: string;
  staffUserId: string;
  role: string;
}> {
  if (!ctx.platformAdmin && !firmRoleHasPermission(ctx.role, "firm.staff.manage")) {
    throw new DomainError("FIRM_PERMISSION_DENIED", 403, { permission: "firm.staff.manage" });
  }
  const { staffUserId, companyId, action } = input;
  const role = input.role ?? "accountant";
  await db.transaction(async (tx) => {
    await lockFirmTimerUser(tx, staffUserId);
    await lockFirmClientAccess(tx, companyId);
    if (!(await isFirmClient(ctx, companyId, tx))) throw new DomainError("CLIENT_NOT_FOUND", 404);
    const [staffUser] = await tx
      .select({ firmRole: users.firmRole, userType: users.userType })
      .from(users)
      .where(eq(users.id, staffUserId));
    if (!staffUser) throw new DomainError("STAFF_NOT_FOUND", 404);
    const staff = await resolveFirmContext({ id: staffUserId, ...staffUser, isAdmin: false }, tx);
    if (!staff || staff.firmId !== ctx.firmId) {
      throw new DomainError("NOT_FIRM_STAFF", 400, undefined, "User is not a firm staff member");
    }

    if (action === "assign") {
      await tx
        .insert(firmStaffAssignments)
        .values({ userId: staffUserId, companyId, role })
        .onConflictDoUpdate({
          target: [firmStaffAssignments.userId, firmStaffAssignments.companyId],
          set: { role },
        });
      await grantCompanyAccess(
        { firmId: ctx.firmId, userId: staffUserId, companyId, role: staff.role },
        tx
      );
      return;
    }

    const tracking = firmRoleHasPermission(staff.role, "firm.time.track");
    const authorized = tracking && (await canAccessFirmClient(staff, companyId, tx));
    const endedAt = new Date();
    await revokeCompanyAccess(
      { firmId: ctx.firmId, isNr: ctx.isNr, companyId, userId: staffUserId },
      tx
    );
    // Unassignment can leave an independent membership or an all-client role intact.
    if (tracking && (await canAccessFirmClient(staff, companyId, tx))) return;
    await settleFirmTimersAtAccessLoss(
      tx,
      and(memberTimerScope(ctx, staffUserId), eq(firmTimeEntries.companyId, companyId))!,
      inArray(firmTimeEntries.companyId, authorized ? [companyId] : []),
      endedAt
    );
  });
  return { action, companyId, staffUserId, role };
}

// ─── Firm members ────────────────────────────────────────────────────────────

type FirmTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function lockFirmMemberChange(tx: FirmTransaction, ctx: FirmContext, userId: string) {
  await lockFirmTimerUser(tx, userId);
  await lockFirmMembership(tx, ctx.firmId);
  const current = await resolveFirmContext({ id: ctx.userId }, tx);
  if (current?.firmId !== ctx.firmId || !firmRoleHasPermission(current.role, "firm.staff.manage")) {
    throw new DomainError("FIRM_PERMISSION_DENIED", 403, { permission: "firm.staff.manage" });
  }
}

function memberTimerScope(ctx: FirmContext, userId: string) {
  return and(eq(firmTimeEntries.firmId, ctx.firmId), eq(firmTimeEntries.userId, userId))!;
}

async function lockMemberClients(tx: FirmTransaction, ctx: FirmContext, userId: string) {
  const grants = await tx
    .select({
      companyId: firmCompanyGrants.companyId,
      membershipId: firmCompanyGrants.membershipId,
    })
    .from(firmCompanyGrants)
    .where(and(eq(firmCompanyGrants.firmId, ctx.firmId), eq(firmCompanyGrants.userId, userId)));
  const assignments = await tx
    .select({ companyId: firmStaffAssignments.companyId })
    .from(firmStaffAssignments)
    .where(eq(firmStaffAssignments.userId, userId));
  const [timer] = await tx
    .select({ companyId: firmTimeEntries.companyId })
    .from(firmTimeEntries)
    .where(and(memberTimerScope(ctx, userId), eq(firmTimeEntries.status, "running")))
    .limit(1);
  const ids = [
    ...new Set(
      [...grants, ...assignments, ...(timer ? [timer] : [])].map(({ companyId }) => companyId)
    ),
  ].sort();
  for (const id of ids) await lockFirmClientAccess(tx, id);
  return { grants, assignments, timerCompanyId: timer?.companyId };
}

/** Only the existing running timer can accrue time at the role or access change. */
async function authorizedTimerClients(
  tx: FirmTransaction,
  member: FirmContext | null,
  companyId?: string
) {
  return companyId &&
    member &&
    firmRoleHasPermission(member.role, "firm.time.track") &&
    (await canAccessFirmClient(member, companyId, tx))
    ? [companyId]
    : [];
}

/** Add an existing user to the caller's firm (firm.staff.manage). */
export async function addFirmMember(
  ctx: FirmContext,
  input: { email: string; role: FirmRole }
): Promise<{ userId: string; role: FirmRole }> {
  if (!ctx.platformAdmin && !firmRoleHasPermission(ctx.role, "firm.staff.manage")) {
    throw new DomainError("FIRM_PERMISSION_DENIED", 403, { permission: "firm.staff.manage" });
  }
  const [u] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, input.email.trim().toLowerCase()))
    .limit(1);
  if (!u) throw new DomainError("USER_NOT_FOUND", 404);
  await setFirmMemberRole(ctx, u.id, input.role);
  return { userId: u.id, role: input.role };
}

async function setFirmMemberRole(
  ctx: FirmContext,
  userId: string,
  role: FirmRole,
  existingOnly = false
): Promise<void> {
  if (!isFirmRole(role)) throw new DomainError("INVALID_FIRM_ROLE", 400);
  await db.transaction(async (tx) => {
    await lockFirmMemberChange(tx, ctx, userId);
    const [user] = await tx
      .select({ role: users.firmRole, memberFirmId: firmMembers.firmId, userType: users.userType })
      .from(users)
      .leftJoin(firmMembers, eq(firmMembers.userId, users.id))
      .where(eq(users.id, userId))
      .limit(1);
    if (!user) throw new DomainError(existingOnly ? "STAFF_NOT_FOUND" : "USER_NOT_FOUND", 404);
    if (user.userType === "client_portal") throw new DomainError("FIRM_MEMBER_INELIGIBLE", 409);
    const previous = await resolveFirmContext(
      { id: userId, firmRole: user.role, isAdmin: false, userType: user.userType },
      tx
    );
    if (existingOnly && previous?.firmId !== ctx.firmId)
      throw new DomainError("STAFF_NOT_FOUND", 404);
    if (
      (previous && previous.firmId !== ctx.firmId) ||
      (user.memberFirmId && user.memberFirmId !== ctx.firmId)
    ) {
      throw new DomainError("USER_IN_OTHER_FIRM", 409);
    }
    if (previous?.role === "firm_owner" && role !== "firm_owner") {
      await requireFirmOwner(tx, ctx.firmId, userId);
    }
    const { grants, assignments, timerCompanyId } = await lockMemberClients(tx, ctx, userId);
    const companyRole = FIRM_ROLE_COMPANY_ROLE[role];
    const nextPermissions = permissionsForRole(companyRole);
    if (
      previous &&
      permissionsForRole(FIRM_ROLE_COMPANY_ROLE[previous.role]).some(
        (permission) => !nextPermissions.includes(permission)
      )
    ) {
      for (const { companyId, membershipId } of grants) {
        if (membershipId) continue;
        await assertNoUnresolvedFirmAccess(
          tx,
          companyId,
          and(eq(firmCompanyGrants.firmId, ctx.firmId), eq(firmCompanyGrants.userId, userId)),
          companyRole
        );
      }
    }
    const authorized = await authorizedTimerClients(tx, previous, timerCompanyId);
    const changedAt = new Date();
    await tx
      .insert(firmMembers)
      .values({ firmId: ctx.firmId, userId, role, invitedBy: ctx.userId })
      .onConflictDoUpdate({
        target: firmMembers.userId,
        set: { role, updatedAt: changedAt },
      });
    // NR keeps users.firm_role as the legacy source of truth.
    if (ctx.isNr) await tx.update(users).set({ firmRole: role }).where(eq(users.id, userId));

    const explicitAssignments = new Set(assignments.map(({ companyId }) => companyId));
    for (const { companyId, membershipId } of grants) {
      const implicitOwnerGrant =
        previous &&
        firmRoleSeesAllClients(previous.role) &&
        !firmRoleSeesAllClients(role) &&
        !explicitAssignments.has(companyId);
      if (implicitOwnerGrant || !(await isFirmClient(ctx, companyId, tx))) {
        await revokeCompanyAccess({ firmId: ctx.firmId, isNr: ctx.isNr, companyId, userId }, tx);
        continue;
      }
      if (!membershipId) continue;
      await tx
        .update(companyUsers)
        .set({ role: companyRole })
        .where(
          and(
            eq(companyUsers.id, membershipId),
            eq(companyUsers.companyId, companyId),
            eq(companyUsers.userId, userId),
            ne(companyUsers.role, "owner")
          )
        );
    }

    if (!previous || previous.role === role) return;
    const next: FirmContext = {
      firmId: ctx.firmId,
      isNr: ctx.isNr,
      role,
      userId,
      platformAdmin: false,
    };
    const changedScope = and(
      memberTimerScope(ctx, userId),
      firmRoleHasPermission(role, "firm.time.track")
        ? notInArray(firmTimeEntries.companyId, accessibleClientsQuery(next))
        : undefined
    )!;
    await settleFirmTimersAtAccessLoss(
      tx,
      changedScope,
      inArray(firmTimeEntries.companyId, authorized),
      changedAt
    );
  });
}

export async function updateFirmMember(
  ctx: FirmContext,
  userId: string,
  role: FirmRole
): Promise<void> {
  if (!ctx.platformAdmin && !firmRoleHasPermission(ctx.role, "firm.staff.manage")) {
    throw new DomainError("FIRM_PERMISSION_DENIED", 403, { permission: "firm.staff.manage" });
  }
  await setFirmMemberRole(ctx, userId, role, true);
}

export async function removeFirmMember(ctx: FirmContext, userId: string): Promise<void> {
  if (!ctx.platformAdmin && !firmRoleHasPermission(ctx.role, "firm.staff.manage")) {
    throw new DomainError("FIRM_PERMISSION_DENIED", 403, { permission: "firm.staff.manage" });
  }
  await db.transaction(async (tx) => {
    await lockFirmMemberChange(tx, ctx, userId);
    const target = await resolveFirmContext({ id: userId, isAdmin: false }, tx);
    if (target?.firmId !== ctx.firmId) throw new DomainError("STAFF_NOT_FOUND", 404);
    if (target.role === "firm_owner") {
      await requireFirmOwner(tx, ctx.firmId, userId);
    }
    const { grants, assignments, timerCompanyId } = await lockMemberClients(tx, ctx, userId);
    const authorized = await authorizedTimerClients(tx, target, timerCompanyId);
    const endedAt = new Date();
    const previouslyGranted = new Set(grants.map(({ companyId }) => companyId));
    const companyIds = new Set([
      ...previouslyGranted,
      ...assignments.map(({ companyId }) => companyId),
    ]);
    for (const companyId of companyIds) {
      if (previouslyGranted.has(companyId) || (await isFirmClient(ctx, companyId, tx))) {
        await revokeCompanyAccess({ firmId: ctx.firmId, isNr: ctx.isNr, companyId, userId }, tx);
      }
    }
    await tx
      .delete(firmMembers)
      .where(and(eq(firmMembers.userId, userId), eq(firmMembers.firmId, ctx.firmId)));
    if (ctx.isNr) await tx.update(users).set({ firmRole: null }).where(eq(users.id, userId));
    await settleFirmTimersAtAccessLoss(
      tx,
      memberTimerScope(ctx, userId),
      inArray(firmTimeEntries.companyId, authorized),
      endedAt
    );
  });
}
