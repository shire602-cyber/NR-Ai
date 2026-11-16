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
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../../db";
import { DomainError } from "../../errors";
import {
  companies,
  companyUsers,
  firmMembers,
  firmStaffAssignments,
  users,
} from "../../../shared/schema";
import { firmRoleHasPermission, isFirmRole, type FirmRole } from "../../../shared/access";
import {
  grantCompanyAccess,
  isFirmClient,
  listFirmMembers,
  resolveFirmContext,
  revokeCompanyAccess,
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
      .where(inArray(firmStaffAssignments.userId, ids)) as Promise<
      Array<StaffAssignmentRow & { userId: string }>
    >,
  ]);
  const profileById = new Map(profiles.map((p) => [p.id, p]));
  // Only assignments on this firm's clients are reported.
  const clientIds = new Set<string>();
  for (const a of assignments) {
    if (!clientIds.has(a.companyId) && (await isFirmClient(ctx, a.companyId))) {
      clientIds.add(a.companyId);
    }
  }
  return members.map((m) => {
    const mine = assignments
      .filter((a) => a.userId === m.userId && clientIds.has(a.companyId))
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
  const [company] = await db
    .select({ id: companies.id, name: companies.name })
    .from(companies)
    .where(eq(companies.id, input.companyId))
    .limit(1);
  if (!company || !(await isFirmClient(ctx, input.companyId))) {
    throw new DomainError("CLIENT_NOT_FOUND", 404);
  }
  const [staffUser] = await db
    .select({ id: users.id, firmRole: users.firmRole, isAdmin: users.isAdmin })
    .from(users)
    .where(eq(users.id, input.staffUserId))
    .limit(1);
  if (!staffUser) throw new DomainError("STAFF_NOT_FOUND", 404);
  const staffCtx = await resolveFirmContext({
    id: staffUser.id,
    firmRole: staffUser.firmRole,
    isAdmin: false,
  });
  if (!staffCtx || staffCtx.firmId !== ctx.firmId) {
    throw new DomainError("NOT_FIRM_STAFF", 400, undefined, "User is not a firm staff member");
  }
  const role = input.role ?? "accountant";
  if (input.action === "assign") {
    await db
      .insert(firmStaffAssignments)
      .values({ userId: staffUser.id, companyId: input.companyId, role })
      .onConflictDoUpdate({
        target: [firmStaffAssignments.userId, firmStaffAssignments.companyId],
        set: { role },
      });
    await grantCompanyAccess({
      firmId: ctx.firmId,
      userId: staffUser.id,
      companyId: input.companyId,
      role: staffCtx.role,
    });
  } else {
    await revokeCompanyAccess({
      firmId: ctx.firmId,
      isNr: ctx.isNr,
      companyId: input.companyId,
      userId: staffUser.id,
    });
  }
  return { action: input.action, companyId: input.companyId, staffUserId: staffUser.id, role };
}

// ─── Firm members ────────────────────────────────────────────────────────────

/** Add an existing user to the caller's firm (firm.staff.manage). */
export async function addFirmMember(
  ctx: FirmContext,
  input: { email: string; role: FirmRole }
): Promise<{ userId: string; role: FirmRole }> {
  if (!ctx.platformAdmin && !firmRoleHasPermission(ctx.role, "firm.staff.manage")) {
    throw new DomainError("FIRM_PERMISSION_DENIED", 403, { permission: "firm.staff.manage" });
  }
  const [u] = await db
    .select({ id: users.id, firmRole: users.firmRole, isAdmin: users.isAdmin })
    .from(users)
    .where(eq(users.email, input.email.trim().toLowerCase()))
    .limit(1);
  if (!u) throw new DomainError("USER_NOT_FOUND", 404);
  const existing = await resolveFirmContext({ id: u.id, firmRole: u.firmRole, isAdmin: false });
  if (existing && existing.firmId !== ctx.firmId) {
    throw new DomainError("USER_IN_OTHER_FIRM", 409);
  }
  await setFirmMemberRole(ctx, u.id, input.role);
  return { userId: u.id, role: input.role };
}

export async function setFirmMemberRole(
  ctx: FirmContext,
  userId: string,
  role: FirmRole
): Promise<void> {
  if (!isFirmRole(role)) throw new DomainError("INVALID_FIRM_ROLE", 400);
  await db
    .insert(firmMembers)
    .values({ firmId: ctx.firmId, userId, role, invitedBy: ctx.userId })
    .onConflictDoUpdate({
      target: firmMembers.userId,
      set: { role, firmId: ctx.firmId, updatedAt: new Date() },
    });
  // NR keeps users.firm_role as the legacy source of truth.
  if (ctx.isNr) await db.update(users).set({ firmRole: role }).where(eq(users.id, userId));
}

export async function updateFirmMember(
  ctx: FirmContext,
  userId: string,
  role: FirmRole
): Promise<void> {
  if (!ctx.platformAdmin && !firmRoleHasPermission(ctx.role, "firm.staff.manage")) {
    throw new DomainError("FIRM_PERMISSION_DENIED", 403, { permission: "firm.staff.manage" });
  }
  const members = await listFirmMembers(ctx.firmId, ctx.isNr);
  if (!members.some((m) => m.userId === userId)) throw new DomainError("STAFF_NOT_FOUND", 404);
  if (userId === ctx.userId && role !== "firm_owner" && ctx.role === "firm_owner") {
    const owners = members.filter((m) => m.role === "firm_owner");
    if (owners.length <= 1) throw new DomainError("LAST_FIRM_OWNER", 409);
  }
  await setFirmMemberRole(ctx, userId, role);
}

export async function removeFirmMember(ctx: FirmContext, userId: string): Promise<void> {
  if (!ctx.platformAdmin && !firmRoleHasPermission(ctx.role, "firm.staff.manage")) {
    throw new DomainError("FIRM_PERMISSION_DENIED", 403, { permission: "firm.staff.manage" });
  }
  const members = await listFirmMembers(ctx.firmId, ctx.isNr);
  const target = members.find((m) => m.userId === userId);
  if (!target) throw new DomainError("STAFF_NOT_FOUND", 404);
  if (target.role === "firm_owner" && members.filter((m) => m.role === "firm_owner").length <= 1) {
    throw new DomainError("LAST_FIRM_OWNER", 409);
  }
  // Remove every client grant the firm gave this member.
  const assigned = (await db
    .select({ companyId: firmStaffAssignments.companyId })
    .from(firmStaffAssignments)
    .where(eq(firmStaffAssignments.userId, userId))) as Array<{ companyId: string }>;
  const granted = (await db
    .select({ companyId: companyUsers.companyId })
    .from(companyUsers)
    .where(eq(companyUsers.userId, userId))) as Array<{ companyId: string }>;
  for (const companyId of new Set([...assigned, ...granted].map((r) => r.companyId))) {
    if (await isFirmClient(ctx, companyId)) {
      await revokeCompanyAccess({ firmId: ctx.firmId, isNr: ctx.isNr, companyId, userId });
    }
  }
  await db
    .delete(firmMembers)
    .where(and(eq(firmMembers.userId, userId), eq(firmMembers.firmId, ctx.firmId)));
  if (ctx.isNr) await db.update(users).set({ firmRole: null }).where(eq(users.id, userId));
}
