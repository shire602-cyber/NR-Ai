/**
 * Firm ↔ client organisation links (W5-D, R15-12) and firm onboarding.
 *
 * - A client created by the firm (POST /firm/clients, import) is linked to the
 *   firm immediately (status active).
 * - An existing organisation is linked by invitation: the firm invites the
 *   owner's email, the company owner accepts for one of the companies they
 *   own, and can revoke at any time. Revocation removes the firm's grants and
 *   assignments in the same request, so access ends immediately.
 * - A new accounting firm applies (status pending) and a platform admin
 *   approves it before any practice route accepts its staff.
 */
import { randomBytes } from "node:crypto";
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { db, type AppDatabase } from "../../db";
import { DomainError } from "../../errors";
import {
  companies,
  companyUsers,
  firmClientLinks,
  firmMembers,
  firms,
  firmStaffAssignments,
  users,
  type FirmClientLink,
} from "../../../shared/schema";
import { normalizeCompanyRole } from "../../../shared/permissions";
import {
  firmPermissionsForRole,
  firmRoleHasPermission,
  firmRoleSeesAllClients,
  isFirmRole,
} from "../../../shared/access";
import { clientNameKey } from "../firm-clients.service";
import { lockFirmMembership, requireFirmOwner } from "./ownership";
import {
  activateClientLink,
  activeLinkForCompany,
  firmClientCondition,
  grantCompanyAccess,
  listAccessibleClientIds,
  listFirmMembers,
  lockFirmClientAccess,
  lockFirmTimerUser,
  resolveFirmContext,
  revokeCompanyAccess,
  settleClientTimersAtAccessLoss,
  type FirmActor,
  type FirmContext,
} from "./scope";

/** Case-insensitive duplicate within the firm's client set (R15-04). */
export async function findDuplicateClient(
  ctx: Pick<FirmContext, "firmId" | "isNr">,
  name: string,
  excludeCompanyId?: string,
  exec: Pick<AppDatabase, "select"> = db
): Promise<{ id: string; name: string } | null> {
  const key = clientNameKey(name);
  const [row] = await exec
    .select({ id: companies.id, name: companies.name })
    .from(companies)
    .where(
      and(
        firmClientCondition(ctx.firmId, ctx.isNr),
        sql`lower(regexp_replace(btrim(${companies.name}), '\\s+', ' ', 'g')) = ${key}`,
        excludeCompanyId ? ne(companies.id, excludeCompanyId) : undefined
      )
    )
    .limit(1);
  return row ?? null;
}

export type FirmClientTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Keep the caller's permission and the membership used for provisioning stable through commit. */
export async function withFirmClientProvisioning<T>(
  ctx: FirmContext,
  provision: (current: FirmContext, tx: FirmClientTransaction) => Promise<T>
): Promise<T> {
  return db.transaction(async (tx) => {
    await lockFirmTimerUser(tx, ctx.userId);
    await lockFirmMembership(tx, ctx.firmId);
    const [actor] = await tx
      .select({
        id: users.id,
        firmRole: users.firmRole,
        isAdmin: users.isAdmin,
        userType: users.userType,
      })
      .from(users)
      .where(eq(users.id, ctx.userId))
      .for("share");
    const current = await resolveFirmContext(actor, tx);
    if (
      current?.firmId !== ctx.firmId ||
      !firmRoleHasPermission(current.role, "firm.clients.create")
    ) {
      throw new DomainError("FIRM_PERMISSION_DENIED", 403);
    }
    return provision(current, tx);
  });
}

/** Link the new client and assign a non-owner creator to it. */
export async function linkNewClientToFirm(
  ctx: FirmContext,
  companyId: string,
  tx: FirmClientTransaction
): Promise<void> {
  await lockFirmClientAccess(tx, companyId);
  await activateClientLink(
    { firmId: ctx.firmId, isNr: ctx.isNr, companyId, actorId: ctx.userId },
    tx
  );
  if (ctx.platformAdmin || firmRoleSeesAllClients(ctx.role)) return;
  await tx
    .insert(firmStaffAssignments)
    .values({ userId: ctx.userId, companyId, role: "accountant" })
    .onConflictDoNothing();
  await grantCompanyAccess(
    { firmId: ctx.firmId, userId: ctx.userId, companyId, role: ctx.role },
    tx
  );
}

async function endClientLinkInTransaction(
  tx: FirmClientTransaction,
  ctx: Pick<FirmContext, "firmId" | "isNr">,
  companyId: string,
  actorId: string,
  reason: string | null,
  linkId?: string
): Promise<void> {
  await lockFirmClientAccess(tx, companyId);
  const endedAt = new Date();
  await settleClientTimersAtAccessLoss(tx, companyId, endedAt, ctx.firmId);
  const [revoked] = await tx
    .update(firmClientLinks)
    .set({
      status: "revoked",
      revokedBy: actorId,
      revokedAt: endedAt,
      revokeReason: reason,
      updatedAt: endedAt,
    })
    .where(
      and(
        eq(firmClientLinks.firmId, ctx.firmId),
        eq(firmClientLinks.companyId, companyId),
        eq(firmClientLinks.status, "active"),
        linkId ? eq(firmClientLinks.id, linkId) : undefined
      )
    )
    .returning({ id: firmClientLinks.id });
  if (linkId && !revoked) throw new DomainError("TRANSACTION_CONFLICT", 409);
  await revokeCompanyAccess({ firmId: ctx.firmId, isNr: ctx.isNr, companyId }, tx);
}

/** End the firm's active link and settle its client access in the same transaction. */
export async function endClientLink(
  ctx: Pick<FirmContext, "firmId" | "isNr">,
  companyId: string,
  actorId: string,
  reason: string | null,
  linkId?: string
): Promise<void> {
  await db.transaction((tx) =>
    endClientLinkInTransaction(tx, ctx, companyId, actorId, reason, linkId)
  );
}

// ─── Invitations (firm side) ─────────────────────────────────────────────────

export async function inviteClient(
  ctx: FirmContext,
  input: { inviteeEmail: string; message?: string | null }
): Promise<FirmClientLink> {
  const email = input.inviteeEmail.trim().toLowerCase();
  const [pending] = await db
    .select()
    .from(firmClientLinks)
    .where(
      and(
        eq(firmClientLinks.firmId, ctx.firmId),
        eq(firmClientLinks.status, "invited"),
        sql`lower(${firmClientLinks.inviteeEmail}) = ${email}`
      )
    )
    .limit(1);
  if (pending) return pending;
  const [row] = await db
    .insert(firmClientLinks)
    .values({
      firmId: ctx.firmId,
      inviteeEmail: email,
      status: "invited",
      message: input.message ?? null,
      invitedBy: ctx.userId,
    })
    .returning();
  return row;
}

/**
 * The firm's client links, scoped like the client list: a member without `firm.clients.all`
 * sees only links to clients assigned to them, and pending invitations (no company yet) only
 * with `firm.clients.link`. Names and ids of other clients never reach unassigned staff.
 */
export async function listFirmLinks(ctx: FirmContext) {
  const rows = await selectFirmLinks(ctx);
  if (ctx.platformAdmin || firmRoleSeesAllClients(ctx.role)) return rows;
  const accessible = new Set(await listAccessibleClientIds(ctx));
  const mayInvite = firmRoleHasPermission(ctx.role, "firm.clients.link");
  return rows.filter((r) => (r.companyId ? accessible.has(r.companyId) : mayInvite));
}

async function selectFirmLinks(ctx: FirmContext) {
  return db
    .select({
      id: firmClientLinks.id,
      companyId: firmClientLinks.companyId,
      companyName: companies.name,
      inviteeEmail: firmClientLinks.inviteeEmail,
      status: firmClientLinks.status,
      invitedAt: firmClientLinks.invitedAt,
      acceptedAt: firmClientLinks.acceptedAt,
      revokedAt: firmClientLinks.revokedAt,
      revokeReason: firmClientLinks.revokeReason,
    })
    .from(firmClientLinks)
    .leftJoin(companies, eq(companies.id, firmClientLinks.companyId))
    .where(eq(firmClientLinks.firmId, ctx.firmId))
    .orderBy(desc(firmClientLinks.invitedAt));
}

/** Firm withdraws a pending invitation or ends an active link. */
export async function withdrawFirmLink(
  ctx: FirmContext,
  linkId: string,
  authorizeActiveClient?: (companyId: string, tx: FirmClientTransaction) => Promise<boolean>
): Promise<boolean> {
  return db.transaction(async (tx) => {
    await lockFirmTimerUser(tx, ctx.userId);
    // Acceptance takes the same lock before assigning a company to a pending invitation.
    await lockFirmMembership(tx, ctx.firmId);
    const actor = await resolveFirmContext({ id: ctx.userId }, tx);
    if (actor?.firmId !== ctx.firmId || !firmRoleHasPermission(actor.role, "firm.clients.link")) {
      throw new DomainError("FIRM_PERMISSION_DENIED", 403);
    }
    const linkScope = and(eq(firmClientLinks.id, linkId), eq(firmClientLinks.firmId, ctx.firmId));
    const [link] = await tx
      .select({ companyId: firmClientLinks.companyId, status: firmClientLinks.status })
      .from(firmClientLinks)
      .where(linkScope)
      .limit(1);
    if (!link) throw new DomainError("LINK_NOT_FOUND", 404);
    if (link.status === "active" && link.companyId) {
      if (authorizeActiveClient && !(await authorizeActiveClient(link.companyId, tx))) return false;
      await endClientLinkInTransaction(
        tx,
        ctx,
        link.companyId,
        ctx.userId,
        "Ended by firm",
        linkId
      );
      return true;
    }
    if (link.status !== "invited") return true;
    const endedAt = new Date();
    const [withdrawn] = await tx
      .update(firmClientLinks)
      .set({
        status: "revoked",
        revokedBy: ctx.userId,
        revokedAt: endedAt,
        updatedAt: endedAt,
      })
      .where(and(linkScope, eq(firmClientLinks.status, "invited")))
      .returning({ id: firmClientLinks.id });
    if (!withdrawn) throw new DomainError("TRANSACTION_CONFLICT", 409);
    return true;
  });
}

// ─── Invitations (client owner side) ─────────────────────────────────────────

async function isCompanyOwner(
  userId: string,
  companyId: string,
  exec: Pick<AppDatabase, "select"> = db
): Promise<boolean> {
  const [m] = await exec
    .select({ role: companyUsers.role })
    .from(companyUsers)
    .where(and(eq(companyUsers.companyId, companyId), eq(companyUsers.userId, userId)))
    .limit(1);
  return !!m && normalizeCompanyRole(m.role) === "owner";
}

export async function listInvitationsForUser(user: { id: string; email: string }) {
  const invitations = await db
    .select({
      id: firmClientLinks.id,
      firmId: firmClientLinks.firmId,
      firmName: firms.name,
      message: firmClientLinks.message,
      invitedAt: firmClientLinks.invitedAt,
    })
    .from(firmClientLinks)
    .innerJoin(firms, eq(firms.id, firmClientLinks.firmId))
    .where(
      and(
        eq(firmClientLinks.status, "invited"),
        eq(firms.status, "active"),
        sql`lower(${firmClientLinks.inviteeEmail}) = ${user.email.trim().toLowerCase()}`
      )
    )
    .orderBy(desc(firmClientLinks.invitedAt));
  const owned = (await db
    .select({ id: companies.id, name: companies.name, role: companyUsers.role })
    .from(companyUsers)
    .innerJoin(companies, eq(companies.id, companyUsers.companyId))
    .where(eq(companyUsers.userId, user.id))) as Array<{ id: string; name: string; role: string }>;
  return {
    invitations,
    ownedCompanies: owned
      .filter((c) => normalizeCompanyRole(c.role) === "owner")
      .map(({ id, name }) => ({ id, name })),
  };
}

async function loadInvitation(
  user: { email: string },
  linkId: string,
  exec: Pick<AppDatabase, "select"> = db
) {
  const [link] = await exec
    .select({ link: firmClientLinks, firmIsNr: firms.isNr, firmStatus: firms.status })
    .from(firmClientLinks)
    .innerJoin(firms, eq(firms.id, firmClientLinks.firmId))
    .where(
      and(
        eq(firmClientLinks.id, linkId),
        eq(firmClientLinks.status, "invited"),
        sql`lower(${firmClientLinks.inviteeEmail}) = ${user.email.trim().toLowerCase()}`
      )
    )
    .limit(1);
  if (!link || link.firmStatus !== "active") throw new DomainError("INVITATION_NOT_FOUND", 404);
  return link;
}

export async function acceptInvitation(
  user: { id: string; email: string },
  linkId: string,
  companyId: string
): Promise<FirmClientLink> {
  const { link } = await loadInvitation(user, linkId);
  return db.transaction(async (tx) => {
    await lockFirmMembership(tx, link.firmId);
    await lockFirmClientAccess(tx, companyId);
    const { firmIsNr } = await loadInvitation(user, linkId, tx);
    if (!(await isCompanyOwner(user.id, companyId, tx))) {
      throw new DomainError(
        "COMPANY_OWNER_REQUIRED",
        403,
        undefined,
        "Only the company owner can accept"
      );
    }
    if (await activeLinkForCompany(companyId, tx)) {
      throw new DomainError(
        "COMPANY_ALREADY_LINKED",
        409,
        undefined,
        "This company is already managed by a firm; revoke that link first"
      );
    }
    const acceptedAt = new Date();
    const [updated] = await tx
      .update(firmClientLinks)
      .set({ companyId, status: "active", acceptedBy: user.id, acceptedAt, updatedAt: acceptedAt })
      .where(and(eq(firmClientLinks.id, link.id), eq(firmClientLinks.status, "invited")))
      .returning();
    if (!updated) throw new DomainError("TRANSACTION_CONFLICT", 409);
    if (!firmIsNr) {
      const owners = (await listFirmMembers(link.firmId, false, tx)).filter(
        (m) => m.role === "firm_owner"
      );
      for (const owner of owners) {
        await grantCompanyAccess(
          { firmId: link.firmId, userId: owner.userId, companyId, role: owner.role },
          tx
        );
      }
    }
    return updated;
  });
}

export async function declineInvitation(
  user: { id: string; email: string },
  linkId: string
): Promise<void> {
  const { link } = await loadInvitation(user, linkId);
  const [declined] = await db
    .update(firmClientLinks)
    .set({ status: "declined", revokedBy: user.id, revokedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(firmClientLinks.id, link.id), eq(firmClientLinks.status, "invited")))
    .returning({ id: firmClientLinks.id });
  if (!declined) throw new DomainError("TRANSACTION_CONFLICT", 409);
}

export async function listCompanyLinks(userId: string, companyId: string) {
  if (!(await isCompanyOwner(userId, companyId))) {
    throw new DomainError("COMPANY_OWNER_REQUIRED", 403);
  }
  return db
    .select({
      id: firmClientLinks.id,
      firmId: firmClientLinks.firmId,
      firmName: firms.name,
      status: firmClientLinks.status,
      acceptedAt: firmClientLinks.acceptedAt,
      revokedAt: firmClientLinks.revokedAt,
    })
    .from(firmClientLinks)
    .innerJoin(firms, eq(firms.id, firmClientLinks.firmId))
    .where(eq(firmClientLinks.companyId, companyId))
    .orderBy(desc(firmClientLinks.createdAt));
}

/** Client owner revokes the firm's access. Effective immediately. */
export async function revokeLinkByClient(
  userId: string,
  companyId: string,
  linkId: string,
  reason: string | null
): Promise<void> {
  if (!(await isCompanyOwner(userId, companyId))) {
    throw new DomainError("COMPANY_OWNER_REQUIRED", 403);
  }
  const [link] = await db
    .select({ link: firmClientLinks, isNr: firms.isNr })
    .from(firmClientLinks)
    .innerJoin(firms, eq(firms.id, firmClientLinks.firmId))
    .where(and(eq(firmClientLinks.id, linkId), eq(firmClientLinks.companyId, companyId)))
    .limit(1);
  if (!link || link.link.status !== "active") throw new DomainError("LINK_NOT_FOUND", 404);
  await endClientLink(
    { firmId: link.link.firmId, isNr: link.isNr },
    companyId,
    userId,
    reason,
    linkId
  );
}

// ─── Firm onboarding ─────────────────────────────────────────────────────────

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `${base || "firm"}-${randomBytes(3).toString("hex")}`;
}

export async function applyForFirm(
  actor: FirmActor,
  input: { name: string; trn?: string; contactEmail?: string; contactPhone?: string }
) {
  return db.transaction(async (tx) => {
    await lockFirmTimerUser(tx, actor.id);
    const [user] = await tx
      .select({ isAdmin: users.isAdmin, firmRole: users.firmRole, userType: users.userType })
      .from(users)
      .where(eq(users.id, actor.id))
      .for("update");
    if (!user) throw new DomainError("USER_NOT_FOUND", 404);
    if (user.userType === "client_portal") throw new DomainError("FIRM_MEMBER_INELIGIBLE", 409);
    const [membership] = await tx
      .select({ firmId: firmMembers.firmId })
      .from(firmMembers)
      .where(eq(firmMembers.userId, actor.id))
      .limit(1);
    if (user.isAdmin || isFirmRole(user.firmRole) || membership) {
      throw new DomainError("ALREADY_FIRM_MEMBER", 409);
    }
    const [firm] = await tx
      .insert(firms)
      .values({
        name: input.name,
        slug: slugify(input.name),
        isNr: false,
        status: "pending",
        trn: input.trn ?? null,
        contactEmail: input.contactEmail ?? null,
        contactPhone: input.contactPhone ?? null,
        createdBy: actor.id,
      })
      .returning();
    await tx.insert(firmMembers).values({ firmId: firm.id, userId: actor.id, role: "firm_owner" });
    return firm;
  });
}

/** The caller's firm (including a pending application), role and permissions. */
export async function getMyFirm(actor: FirmActor) {
  const ctx = await resolveFirmContext(actor);
  if (ctx) {
    const [firm] = await db.select().from(firms).where(eq(firms.id, ctx.firmId)).limit(1);
    return {
      firm: firm ?? null,
      role: ctx.role,
      isNr: ctx.isNr,
      platformAdmin: ctx.platformAdmin,
      permissions: firmPermissionsForRole(ctx.role),
    };
  }
  const [pending] = await db
    .select({ firm: firms, role: firmMembers.role })
    .from(firmMembers)
    .innerJoin(firms, eq(firms.id, firmMembers.firmId))
    .where(eq(firmMembers.userId, actor.id))
    .limit(1);
  if (!pending) return null;
  return {
    firm: pending.firm,
    role: pending.role,
    isNr: pending.firm.isNr,
    platformAdmin: false,
    permissions: [],
  };
}

export async function listFirmsForAdmin(status?: string) {
  return db
    .select()
    .from(firms)
    .where(status ? eq(firms.status, status) : undefined)
    .orderBy(desc(firms.createdAt));
}

export async function decideFirmApplication(
  adminId: string,
  firmId: string,
  decision: "approve" | "reject" | "suspend",
  reason?: string | null
) {
  return db.transaction(async (tx) => {
    await lockFirmMembership(tx, firmId);
    const [firm] = await tx.select().from(firms).where(eq(firms.id, firmId)).limit(1);
    if (!firm) throw new DomainError("FIRM_NOT_FOUND", 404);
    if (firm.isNr) throw new DomainError("NR_FIRM_IMMUTABLE", 409);
    if (decision === "approve") await requireFirmOwner(tx, firmId);
    const status =
      decision === "approve" ? "active" : decision === "reject" ? "rejected" : "suspended";
    const [updated] = await tx
      .update(firms)
      .set({
        status,
        approvedBy: decision === "approve" ? adminId : firm.approvedBy,
        approvedAt: decision === "approve" ? new Date() : firm.approvedAt,
        rejectionReason: decision === "approve" ? null : (reason ?? null),
        updatedAt: new Date(),
      })
      .where(eq(firms.id, firmId))
      .returning();
    return updated;
  });
}

/** Companies with an active link to any of these firms (used by tests/ops). */
export async function activeLinkCompanyIds(firmIds: string[]): Promise<string[]> {
  if (firmIds.length === 0) return [];
  const rows = (await db
    .select({ companyId: firmClientLinks.companyId })
    .from(firmClientLinks)
    .where(
      and(inArray(firmClientLinks.firmId, firmIds), eq(firmClientLinks.status, "active"))
    )) as Array<{
    companyId: string | null;
  }>;
  return rows.map((r) => r.companyId).filter((id): id is string => !!id);
}
