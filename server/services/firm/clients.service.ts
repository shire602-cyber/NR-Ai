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
import { db } from "../../db";
import { DomainError } from "../../errors";
import {
  companies,
  companyUsers,
  firmClientLinks,
  firmMembers,
  firms,
  firmStaffAssignments,
  firmTimeEntries,
  type FirmClientLink,
} from "../../../shared/schema";
import { normalizeCompanyRole } from "../../../shared/permissions";
import {
  firmPermissionsForRole,
  firmRoleHasPermission,
  firmRoleSeesAllClients,
} from "../../../shared/access";
import { clientNameKey } from "../firm-clients.service";
import {
  activateClientLink,
  activeLinkForCompany,
  canAccessFirmClient,
  firmClientCondition,
  grantCompanyAccess,
  listAccessibleClientIds,
  listFirmMembers,
  lockFirmClientAccess,
  lockFirmTimerUser,
  resolveFirmContext,
  revokeCompanyAccess,
  settleFirmTimersAtAccessLoss,
  type FirmActor,
  type FirmContext,
} from "./scope";

/** Case-insensitive duplicate within the firm's client set (R15-04). */
export async function findDuplicateClient(
  ctx: Pick<FirmContext, "firmId" | "isNr">,
  name: string,
  excludeCompanyId?: string
): Promise<{ id: string; name: string } | null> {
  const key = clientNameKey(name);
  const [row] = await db
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

/**
 * Link a client the firm just created and keep the creator's access: a
 * non-owner creator (firm_admin) is assigned to it, as before W5-D.
 */
export async function linkNewClientToFirm(ctx: FirmContext, companyId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await lockFirmTimerUser(tx, ctx.userId);
    await lockFirmClientAccess(tx, companyId);
    const current = await resolveFirmContext({ id: ctx.userId }, tx);
    if (
      current?.firmId !== ctx.firmId ||
      !firmRoleHasPermission(current.role, "firm.clients.create")
    ) {
      throw new DomainError("FIRM_PERMISSION_DENIED", 403);
    }
    await activateClientLink(
      {
        firmId: ctx.firmId,
        isNr: ctx.isNr,
        companyId,
        actorId: ctx.userId,
      },
      tx
    );
    if (current.platformAdmin || firmRoleSeesAllClients(current.role)) return;
    await tx
      .insert(firmStaffAssignments)
      .values({ userId: ctx.userId, companyId, role: "accountant" })
      .onConflictDoNothing();
    await grantCompanyAccess(
      { firmId: ctx.firmId, userId: ctx.userId, companyId, role: current.role },
      tx
    );
  });
}

/** Firm side: end the firm's active link to a company. */
export async function endClientLink(
  ctx: Pick<FirmContext, "firmId" | "isNr">,
  companyId: string,
  actorId: string,
  reason: string | null,
  linkId?: string
): Promise<void> {
  await db.transaction(async (tx) => {
    await lockFirmClientAccess(tx, companyId);
    const timerScope = and(
      eq(firmTimeEntries.firmId, ctx.firmId),
      eq(firmTimeEntries.companyId, companyId)
    )!;
    const running = await tx
      .select({ id: firmTimeEntries.id, userId: firmTimeEntries.userId })
      .from(firmTimeEntries)
      .where(and(timerScope, eq(firmTimeEntries.status, "running")));
    const authorized = [];
    for (const timer of running) {
      const member = await resolveFirmContext({ id: timer.userId }, tx);
      if (
        member?.firmId === ctx.firmId &&
        firmRoleHasPermission(member.role, "firm.time.track") &&
        (await canAccessFirmClient(member, companyId, tx))
      )
        authorized.push(timer.id);
    }
    const endedAt = new Date();
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
    await settleFirmTimersAtAccessLoss(
      tx,
      timerScope,
      inArray(firmTimeEntries.id, authorized),
      endedAt
    );
  });
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
export async function withdrawFirmLink(ctx: FirmContext, linkId: string): Promise<void> {
  const [link] = await db
    .select()
    .from(firmClientLinks)
    .where(and(eq(firmClientLinks.id, linkId), eq(firmClientLinks.firmId, ctx.firmId)))
    .limit(1);
  if (!link) throw new DomainError("LINK_NOT_FOUND", 404);
  if (link.status === "active" && link.companyId) {
    await endClientLink(ctx, link.companyId, ctx.userId, "Ended by firm", link.id);
    return;
  }
  if (link.status === "invited") {
    await db
      .update(firmClientLinks)
      .set({
        status: "revoked",
        revokedBy: ctx.userId,
        revokedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(firmClientLinks.id, linkId));
  }
}

// ─── Invitations (client owner side) ─────────────────────────────────────────

async function isCompanyOwner(userId: string, companyId: string): Promise<boolean> {
  const [m] = await db
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

async function loadInvitation(user: { email: string }, linkId: string) {
  const [link] = await db
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
  const { link, firmIsNr } = await loadInvitation(user, linkId);
  if (!(await isCompanyOwner(user.id, companyId))) {
    throw new DomainError(
      "COMPANY_OWNER_REQUIRED",
      403,
      undefined,
      "Only the company owner can accept"
    );
  }
  const existing = await activeLinkForCompany(companyId);
  if (existing) {
    throw new DomainError(
      "COMPANY_ALREADY_LINKED",
      409,
      undefined,
      "This company is already managed by a firm; revoke that link first"
    );
  }
  const [updated] = await db
    .update(firmClientLinks)
    .set({
      companyId,
      status: "active",
      acceptedBy: user.id,
      acceptedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(firmClientLinks.id, link.id))
    .returning();
  if (!firmIsNr) {
    const owners = (await listFirmMembers(link.firmId, false)).filter(
      (m) => m.role === "firm_owner"
    );
    for (const o of owners) {
      await grantCompanyAccess({ firmId: link.firmId, userId: o.userId, companyId, role: o.role });
    }
  }
  return updated;
}

export async function declineInvitation(
  user: { id: string; email: string },
  linkId: string
): Promise<void> {
  const { link } = await loadInvitation(user, linkId);
  await db
    .update(firmClientLinks)
    .set({ status: "declined", revokedBy: user.id, revokedAt: new Date(), updatedAt: new Date() })
    .where(eq(firmClientLinks.id, link.id));
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
  if (actor.isAdmin === true || (await resolveFirmContext({ ...actor, isAdmin: false }))) {
    throw new DomainError("ALREADY_FIRM_MEMBER", 409);
  }
  const [pending] = await db
    .select({ firmId: firmMembers.firmId })
    .from(firmMembers)
    .where(eq(firmMembers.userId, actor.id))
    .limit(1);
  if (pending) throw new DomainError("ALREADY_FIRM_MEMBER", 409);
  return db.transaction(async (tx: typeof db) => {
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
  const [firm] = await db.select().from(firms).where(eq(firms.id, firmId)).limit(1);
  if (!firm) throw new DomainError("FIRM_NOT_FOUND", 404);
  if (firm.isNr) throw new DomainError("NR_FIRM_IMMUTABLE", 409);
  const status =
    decision === "approve" ? "active" : decision === "reject" ? "rejected" : "suspended";
  const [updated] = await db
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
