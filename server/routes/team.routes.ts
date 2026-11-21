import type { Express, Request, Response } from "express";
import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";
import { z } from "zod";
import { storage, normalizeEmail } from "../storage";
import { authMiddleware, optionalAuthUser } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import {
  requirePermission,
  requireScopedCompanyPermission,
  scopedCompanyPermissionFailure,
  getCompanyRole,
  companyHasSingleMember,
} from "../middleware/companyRolePolicy";
import { strictBody } from "../http/strict-body";
import { recordAudit } from "../services/audit.service";
import { hashToken } from "../services/auth-tokens.service";
import { hasEmailProvider, sendEmail } from "../services/email.service";
import { getEnv } from "../config/env";
import { createLogger } from "../config/logger";
import { isPlaceholderPasswordHash, passwordPolicySchema } from "../auth";
import { issueAuthTokens } from "./auth.routes";
import { zEmail, zText } from "../../shared/validators/primitives";
import {
  COMPANY_ROLES,
  grantableRoles,
  normalizeCompanyRole,
  permissionsForRole,
  type CompanyRole,
} from "../../shared/permissions";
import {
  companies,
  companyInvitations,
  companyUsers,
  firmCompanyGrants,
  firmMembers,
  users,
  type CompanyInvitation,
  type User,
} from "../../shared/schema";
import { and, eq, gt, inArray, or, sql, exists, isNull } from "drizzle-orm";
import { databaseUtcNow } from "../config/database-time";
import { db, type AppDatabase } from "../db";
import { DomainError } from "../errors";
import { isScopedIdPair } from "../tenancy";
import {
  canAuthorizeDirectCompanyInvite,
  hasFirmCreatedCompanyMembership,
  markCompanyMembershipDirect,
  reconcileCompanyMembershipOrigin,
  resolveFirmContext,
} from "../services/firm/scope";
import { isFirmRole } from "../../shared/access";
import { zCompanyRole } from "../../shared/validators/company-role";

const log = createLogger("team");

export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const invitationDeadline = sql`${databaseUtcNow} + (${INVITATION_TTL_MS}::int * interval '1 millisecond')`;

const inviteBodySchema = z.object({
  email: zEmail,
  role: zCompanyRole.default("employee"),
});
const roleBodySchema = z.object({ role: zCompanyRole });
const acceptBodySchema = z.object({
  name: zText(100, { min: 1 }).optional(),
  password: passwordPolicySchema.optional(),
});

function publicInvitation(inv: CompanyInvitation & { expired?: boolean }) {
  const expired = inv.status === "pending" && inv.expired;
  return {
    id: inv.id,
    companyId: inv.companyId,
    email: inv.email,
    role: inv.role,
    status: expired ? "expired" : inv.status,
    expiresAt: inv.expiresAt,
    createdAt: inv.createdAt,
    lastSentAt: inv.lastSentAt,
    sendCount: inv.sendCount,
    invitedBy: inv.invitedBy,
  };
}

function appBaseUrl(): string {
  const env = getEnv();
  return (env.FRONTEND_URL || env.AUTH_PUBLIC_URL || "").replace(/\/+$/, "");
}

function inviteUrlFor(rawToken: string): string {
  return `${appBaseUrl()}/register?teamInvite=${rawToken}`;
}

/**
 * Email the invite link. Degrades honestly: without an email provider (or
 * when sending fails) the link is returned to the inviter to share.
 */
async function deliverInvitation(
  inv: CompanyInvitation,
  rawToken: string,
  companyName: string
): Promise<{ delivery: "email" | "link"; inviteUrl?: string; reason?: string }> {
  const inviteUrl = inviteUrlFor(rawToken);
  if (!hasEmailProvider()) {
    return { delivery: "link", inviteUrl, reason: "EMAIL_PROVIDER_NOT_CONFIGURED" };
  }
  const result = await sendEmail(
    inv.email,
    `You're invited to ${companyName} on Muhasib`,
    `You have been invited to join ${companyName} as ${inv.role}.\n\nAccept the invitation: ${inviteUrl}\n\nThis link expires on ${inv.expiresAt.toUTCString()}.`
  ).catch((err: Error) => ({ sent: false, error: err.message }));
  if (result.sent) return { delivery: "email" };
  log.warn({ invitationId: inv.id }, "Invitation email failed; returning link to inviter");
  return { delivery: "link", inviteUrl, reason: "EMAIL_SEND_FAILED" };
}

function newToken() {
  const raw = randomBytes(32).toString("hex");
  return { raw, hash: hashToken(raw) };
}

async function canManageCompanyOwnership(
  companyId: string,
  actor: Pick<User, "id" | "userType" | "firmRole" | "isAdmin"> | undefined,
  conn: Pick<AppDatabase, "select"> = db
) {
  if (!actor || actor.userType === "client_portal") return false;
  return (
    (await canAuthorizeDirectCompanyInvite(companyId, actor.id, "owner", conn)) ||
    (await resolveFirmContext(actor, conn))?.platformAdmin === true
  );
}

function normalizedInvitationEmail(email: string) {
  return sql`lower(btrim(${users.email})) = ${normalizeEmail(email)}`;
}

async function getUniqueInvitationRecipient(email: string): Promise<User | undefined> {
  const [recipient, duplicate] = await db
    .select()
    .from(users)
    .where(normalizedInvitationEmail(email))
    .limit(2);
  if (duplicate) throw new DomainError("INVITATION_EMAIL_AMBIGUOUS", 409);
  return recipient;
}

async function lockTeamCompany(
  companyId: string,
  conn: Pick<AppDatabase, "select">,
  lock: "share" | "no key update"
) {
  const [company] = await conn
    .select({ id: companies.id })
    .from(companies)
    .where(and(eq(companies.id, companyId), isNull(companies.deletedAt)))
    .for(lock);
  if (!company) throw new DomainError("COMPANY_NOT_FOUND", 404);
}

async function assertTeamInviteAuthority(
  companyId: string,
  actor: Pick<User, "id" | "userType" | "firmRole" | "isAdmin"> | undefined,
  invitee: Pick<User, "id" | "firmRole" | "isAdmin"> | undefined,
  role: string,
  conn: Pick<AppDatabase, "select"> = db,
  lock?: "share"
) {
  if (await canAuthorizeDirectCompanyInvite(companyId, actor?.id ?? null, role, conn)) return;
  if (role === "owner" && !(await canManageCompanyOwnership(companyId, actor, conn))) {
    throw new DomainError("ROLE_NOT_GRANTABLE", 403);
  }
  const deny = () => {
    throw new DomainError("PERMISSION_DENIED", 403, { permission: "team.manage" });
  };
  if (!actor) return deny();
  if (await scopedCompanyPermissionFailure(actor, companyId, "team.manage", conn, lock))
    return deny();

  // A firm can onboard a new customer into a managed company. It cannot turn an existing
  // company membership or someone's firm authority into independently durable access.
  if (invitee) {
    if (invitee.isAdmin || isFirmRole(invitee.firmRole)) return deny();
    const [existing] = await conn
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.id, invitee.id),
          or(
            exists(
              conn
                .select({ id: firmMembers.userId })
                .from(firmMembers)
                .where(eq(firmMembers.userId, invitee.id))
            ),
            exists(
              conn
                .select({ id: companyUsers.userId })
                .from(companyUsers)
                .where(
                  and(eq(companyUsers.companyId, companyId), eq(companyUsers.userId, invitee.id))
                )
            ),
            exists(
              conn
                .select({ id: firmCompanyGrants.userId })
                .from(firmCompanyGrants)
                .where(
                  and(
                    eq(firmCompanyGrants.companyId, companyId),
                    eq(firmCompanyGrants.userId, invitee.id)
                  )
                )
            )
          )
        )
      );
    if (existing) return deny();
  }
  const [membership] = await conn
    .select({ role: companyUsers.role })
    .from(companyUsers)
    .where(and(eq(companyUsers.companyId, companyId), eq(companyUsers.userId, actor.id)));
  if (
    membership &&
    (!grantableRoles(membership.role).includes(normalizeCompanyRole(role)) ||
      (await hasFirmCreatedCompanyMembership(companyId, actor.id, conn)))
  )
    return deny();
}

async function mutateTeamMember(req: Request, nextRole: CompanyRole | null) {
  const { companyId, memberId } = req.params;
  const actorId = req.user!.id;
  if (!isScopedIdPair(companyId, memberId)) throw new DomainError("NOT_FOUND", 404);
  return db.transaction(async (tx) => {
    // This company lock serializes owner checks across different target users. Acquire it
    // before actor locks, matching invitation acceptance and outbound dispatch lock order.
    await lockTeamCompany(companyId, tx, "no key update");
    const scope = and(eq(companyUsers.companyId, companyId), eq(companyUsers.id, memberId));
    const [target] = await tx
      .select({ userId: companyUsers.userId })
      .from(companyUsers)
      .where(scope);
    if (!target) throw new DomainError("NOT_FOUND", 404, undefined, "Team member not found");
    const actors = await tx
      .select({
        id: users.id,
        firmRole: users.firmRole,
        isAdmin: users.isAdmin,
        userType: users.userType,
      })
      .from(users)
      .where(inArray(users.id, [actorId, target.userId]))
      .orderBy(users.id)
      .for("update");
    const actor = actors.find((candidate) => candidate.id === actorId);
    if (!actor) throw new DomainError("AUTH_REQUIRED", 401);
    const denied = await scopedCompanyPermissionFailure(
      actor,
      companyId,
      "team.manage",
      tx,
      "share"
    );
    if (denied)
      throw new DomainError(denied.code, 403, {
        companyId,
        permission: "team.manage",
        role: "role" in denied ? denied.role : null,
      });
    await reconcileCompanyMembershipOrigin(companyId, target.userId, tx);
    const [member] = await tx.select().from(companyUsers).where(scope);
    if (!member) throw new DomainError("NOT_FOUND", 404, undefined, "Team member not found");
    const currentRole = normalizeCompanyRole(member.role);
    if (
      (currentRole === "owner" || nextRole === "owner") &&
      !(await canManageCompanyOwnership(companyId, actor, tx))
    ) {
      throw new DomainError(
        "ROLE_NOT_GRANTABLE",
        403,
        undefined,
        nextRole === null ? "Only owners can remove an owner" : "Only owners can change owner roles"
      );
    }
    if (currentRole === "owner" && nextRole !== "owner") {
      const owners = await tx
        .select({ id: companyUsers.id })
        .from(companyUsers)
        .where(and(eq(companyUsers.companyId, companyId), eq(companyUsers.role, "owner")))
        .limit(2);
      if (owners.length < 2)
        throw new DomainError(
          "LAST_OWNER",
          409,
          undefined,
          "A company must keep at least one owner"
        );
    }
    const updated =
      nextRole === null
        ? undefined
        : await storage.updateCompanyUser(companyId, memberId, { role: nextRole }, tx);
    const changed =
      nextRole === null ? await storage.deleteCompanyUser(companyId, memberId, tx) : !!updated;
    if (!changed) throw new DomainError("NOT_FOUND", 404, undefined, "Team member not found");
    await recordAudit({
      userId: actorId,
      companyId,
      action: nextRole === null ? "team.remove" : "team.role_change",
      entityType: "company_user",
      entityId: memberId,
      before: { userId: member.userId, role: currentRole },
      after: updated ? { userId: updated.userId, role: updated.role } : null,
      req,
      tx,
    });
    return updated;
  });
}

async function invitationStateChanged(companyId: string, invitationId: string): Promise<never> {
  const invitation = await storage.getCompanyInvitation(companyId, invitationId);
  if (!invitation) throw new DomainError("INVITATION_NOT_FOUND", 404);
  throw new DomainError(`INVITATION_${invitation.status.toUpperCase()}`, 409);
}

async function resolveInvitationToken(
  token: string
): Promise<
  | { ok: true; invitation: CompanyInvitation }
  | { ok: false; status: number; code: string; message: string }
> {
  if (!/^[0-9a-f]{64}$/i.test(token)) {
    return {
      ok: false,
      status: 404,
      code: "INVITATION_NOT_FOUND",
      message: "Invitation not found",
    };
  }
  const invitation = await storage.getCompanyInvitationByTokenHash(hashToken(token.toLowerCase()));
  if (!invitation) {
    return {
      ok: false,
      status: 404,
      code: "INVITATION_NOT_FOUND",
      message: "Invitation not found",
    };
  }
  if (invitation.status === "pending" && invitation.expired) {
    const expired = await storage.updateCompanyInvitation(
      invitation.companyId,
      invitation.id,
      { status: "expired" },
      invitation
    );
    if (!expired) return resolveInvitationToken(token);
    return {
      ok: false,
      status: 410,
      code: "INVITATION_EXPIRED",
      message: "Invitation has expired",
    };
  }
  if (invitation.status !== "pending") {
    return {
      ok: false,
      status: 410,
      code: `INVITATION_${invitation.status.toUpperCase()}`,
      message: `Invitation has been ${invitation.status}`,
    };
  }
  return { ok: true, invitation };
}

export function registerTeamRoutes(app: Express) {
  // =====================================
  // TEAM MANAGEMENT
  // =====================================

  // Get team members for a company (no password hashes or tokens leave the server)
  app.get(
    "/api/companies/:companyId/team",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const userId = req.user!.id;
      const { companyId } = req.params;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied", code: "COMPANY_ACCESS_DENIED" });
      }

      const teamMembers = await storage.getCompanyUserWithUser(companyId);
      res.json(
        teamMembers.map((m) => ({
          id: m.id,
          userId: m.userId,
          companyId: m.companyId,
          role: normalizeCompanyRole(m.role),
          createdAt: m.createdAt,
          user: { id: m.user.id, email: m.user.email, name: m.user.name },
        }))
      );
    })
  );

  // The caller's own role and permissions (client UI gating).
  app.get(
    "/api/companies/:companyId/team/me",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const role = await getCompanyRole(req.user!.id, companyId).catch(() => null);
      if (!role) {
        const hasAccess = await storage.hasCompanyAccess(req.user!.id, companyId);
        if (!hasAccess)
          return res.status(403).json({ message: "Access denied", code: "COMPANY_ACCESS_DENIED" });
        // NR firm staff / platform admins act with full rights via their own gates.
        return res.json({
          role: null,
          viaFirmAccess: true,
          permissions: permissionsForRole("owner"),
          grantableRoles: COMPANY_ROLES.filter((r) => r !== "owner"),
        });
      }
      res.json({
        role,
        viaFirmAccess: false,
        permissions: permissionsForRole(role),
        grantableRoles: grantableRoles(role),
        // E2 (J3-r2): maker-checker is waived for a one-member company (assertDifferentActor), so
        // the UI disables "approve your own item" only when someone else could approve it.
        userId: req.user!.id,
        soleMember: await companyHasSingleMember(companyId),
      });
    })
  );

  // Invite a person by email (R01-04/R01-15): creates a pending invitation;
  // the invitee sets their own password when accepting.
  app.post(
    "/api/companies/:companyId/team/invite",
    authMiddleware,
    requirePermission("team.manage"),
    requireScopedCompanyPermission("team.manage"),
    strictBody(inviteBodySchema),
    asyncHandler(async (req: Request, res: Response) => {
      const userId = req.user!.id;
      const { companyId } = req.params;
      const { email, role } = req.body as z.output<typeof inviteBodySchema>;
      const actorRole = req.companyRole ?? (await getCompanyRole(userId, companyId));

      if (role !== "owner" && actorRole && !grantableRoles(actorRole).includes(role)) {
        return res.status(403).json({
          message: "Only owners can invite another owner",
          code: "ROLE_NOT_GRANTABLE",
        });
      }

      const company = await storage.getCompany(companyId);
      if (!company)
        return res.status(404).json({ message: "Company not found", code: "COMPANY_NOT_FOUND" });

      const existingUser = await getUniqueInvitationRecipient(email);
      await assertTeamInviteAuthority(companyId, req.user, existingUser, role);
      const existingRole = existingUser
        ? await storage.getUserRole(companyId, existingUser.id)
        : null;
      if (
        existingUser &&
        existingRole &&
        (existingRole.role === "owner" ||
          !(await hasFirmCreatedCompanyMembership(companyId, existingUser.id)))
      ) {
        return res
          .status(409)
          .json({ message: "User is already a team member", code: "ALREADY_MEMBER" });
      }
      const pending = await storage.getPendingCompanyInvitationByEmail(companyId, email);
      if (pending && !pending.expired) {
        return res.status(409).json({
          message: "An invitation is already pending for this email; resend it instead",
          code: "INVITATION_PENDING",
          details: { invitationId: pending.id },
        });
      }
      if (pending) {
        const expired = await storage.updateCompanyInvitation(
          companyId,
          pending.id,
          { status: "expired" },
          pending
        );
        if (!expired) return invitationStateChanged(companyId, pending.id);
      }

      const token = newToken();
      const invitation = await storage.createCompanyInvitation({
        companyId,
        email,
        role,
        tokenHash: token.hash,
        invitedBy: userId,
        status: "pending",
        expiresAt: invitationDeadline,
        lastSentAt: databaseUtcNow,
        sendCount: 1,
      });
      const delivery = await deliverInvitation(invitation, token.raw, company.name);

      await recordAudit({
        userId,
        companyId,
        action: "team.invite",
        entityType: "company_invitation",
        entityId: invitation.id,
        before: null,
        after: { email, role, delivery: delivery.delivery },
        req,
      });

      res.status(201).json({ invitation: publicInvitation(invitation), ...delivery });
    })
  );

  app.get(
    "/api/companies/:companyId/team/invitations",
    authMiddleware,
    requirePermission("team.manage"),
    requireScopedCompanyPermission("team.manage"),
    asyncHandler(async (req: Request, res: Response) => {
      const rows = await storage.listCompanyInvitations(req.params.companyId);
      res.json(rows.map(publicInvitation));
    })
  );

  app.post(
    "/api/companies/:companyId/team/invitations/:invitationId/resend",
    authMiddleware,
    requirePermission("team.manage"),
    requireScopedCompanyPermission("team.manage"),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, invitationId } = req.params;
      const current = await storage.getCompanyInvitation(companyId, invitationId);
      if (!current)
        return res.status(404).json({ message: "Invitation not found", code: "NOT_FOUND" });
      if (current.status === "accepted" || current.status === "revoked") {
        return res.status(409).json({
          message: `Invitation has been ${current.status}`,
          code: `INVITATION_${current.status.toUpperCase()}`,
        });
      }
      await assertTeamInviteAuthority(
        companyId,
        req.user,
        await getUniqueInvitationRecipient(current.email),
        current.role
      );
      const company = await storage.getCompany(companyId);
      if (!company)
        return res.status(404).json({ message: "Company not found", code: "COMPANY_NOT_FOUND" });
      const token = newToken();
      const updated = await storage.updateCompanyInvitation(
        companyId,
        invitationId,
        {
          tokenHash: token.hash,
          status: "pending",
          expiresAt: invitationDeadline,
          lastSentAt: databaseUtcNow,
          sendCount: (current.sendCount ?? 0) + 1,
          invitedBy: req.user!.id,
        },
        current
      );
      if (!updated) return invitationStateChanged(companyId, invitationId);
      const delivery = await deliverInvitation(updated, token.raw, company.name);
      await recordAudit({
        userId: req.user!.id,
        companyId,
        action: "team.invite_resend",
        entityType: "company_invitation",
        entityId: invitationId,
        before: null,
        after: { delivery: delivery.delivery },
        req,
      });
      res.json({ invitation: publicInvitation(updated), ...delivery });
    })
  );

  app.delete(
    "/api/companies/:companyId/team/invitations/:invitationId",
    authMiddleware,
    requirePermission("team.manage"),
    requireScopedCompanyPermission("team.manage"),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, invitationId } = req.params;
      const current = await storage.getCompanyInvitation(companyId, invitationId);
      if (!current)
        return res.status(404).json({ message: "Invitation not found", code: "NOT_FOUND" });
      if (current.status === "accepted") {
        return res
          .status(409)
          .json({ message: "Invitation was already accepted", code: "INVITATION_ACCEPTED" });
      }
      const updated = await storage.updateCompanyInvitation(
        companyId,
        invitationId,
        { status: "revoked", revokedAt: databaseUtcNow },
        current
      );
      if (!updated) return invitationStateChanged(companyId, invitationId);
      await recordAudit({
        userId: req.user!.id,
        companyId,
        action: "team.invite_revoke",
        entityType: "company_invitation",
        entityId: invitationId,
        before: { status: current.status },
        after: { status: "revoked" },
        req,
      });
      res.json({ invitation: publicInvitation(updated) });
    })
  );

  // Update team member role. R01-01: the membership is loaded and updated by
  // (memberId, companyId); another company's membership is a 404.
  app.put(
    "/api/companies/:companyId/team/:memberId",
    authMiddleware,
    requirePermission("team.manage"),
    requireScopedCompanyPermission("team.manage"),
    strictBody(roleBodySchema),
    asyncHandler(async (req: Request, res: Response) => {
      const { role } = req.body as z.output<typeof roleBodySchema>;
      res.json(await mutateTeamMember(req, role));
    })
  );

  // Remove team member (scoped by company, R01-01)
  app.delete(
    "/api/companies/:companyId/team/:memberId",
    authMiddleware,
    requirePermission("team.manage"),
    requireScopedCompanyPermission("team.manage"),
    asyncHandler(async (req: Request, res: Response) => {
      await mutateTeamMember(req, null);
      res.status(204).send();
    })
  );

  // =====================================
  // INVITATION ACCEPTANCE (public; token in the link)
  // =====================================

  app.get(
    "/api/team-invitations/:token",
    asyncHandler(async (req: Request, res: Response) => {
      const resolved = await resolveInvitationToken(req.params.token);
      if (!resolved.ok) {
        return res.status(resolved.status).json({ message: resolved.message, code: resolved.code });
      }
      const inv = resolved.invitation;
      const company = await storage.getCompany(inv.companyId);
      const existing = await getUniqueInvitationRecipient(inv.email);
      res.json({
        email: inv.email,
        role: inv.role,
        expiresAt: inv.expiresAt,
        company: company ? { id: company.id, name: company.name } : null,
        accountExists: !!existing && !isPlaceholderPasswordHash(existing.passwordHash),
      });
    })
  );

  app.post(
    "/api/team-invitations/:token/accept",
    strictBody(acceptBodySchema),
    asyncHandler(async (req: Request, res: Response) => {
      const resolved = await resolveInvitationToken(req.params.token);
      if (!resolved.ok) {
        return res.status(resolved.status).json({ message: resolved.message, code: resolved.code });
      }
      const inv = resolved.invitation;
      const { ...body } = req.body as z.output<typeof acceptBodySchema>;
      const signedIn = await optionalAuthUser(req);
      const email = normalizeEmail(inv.email);
      const passwordHash =
        !signedIn && body.name && body.password ? await bcrypt.hash(body.password, 10) : null;

      const {
        user: acceptedUser,
        role,
        createdUser,
      } = await db.transaction(async (tx) => {
        await lockTeamCompany(inv.companyId, tx, "share");
        // Serialize with assignment, company roles, and a competing invitation or account claim.
        const accounts = await tx
          .select()
          .from(users)
          .where(
            or(
              normalizedInvitationEmail(email),
              signedIn ? eq(users.id, signedIn.id) : undefined,
              inv.invitedBy ? eq(users.id, inv.invitedBy) : undefined
            )
          )
          .orderBy(users.id)
          .for("update");
        const recipients = accounts.filter((account) => normalizeEmail(account.email) === email);
        if (signedIn && !recipients.some((recipient) => recipient.id === signedIn.id)) {
          throw new DomainError("INVITATION_EMAIL_MISMATCH", 403);
        }
        if (recipients.length > 1) throw new DomainError("INVITATION_EMAIL_AMBIGUOUS", 409);
        let [user] = recipients;
        if (!signedIn && user && !isPlaceholderPasswordHash(user.passwordHash)) {
          throw new DomainError("LOGIN_REQUIRED", 409);
        }
        if (!signedIn && (!passwordHash || !body.name)) {
          z.object({ name: zText(100, { min: 1 }), password: passwordPolicySchema }).parse(body);
        }
        const claimPlaceholder = !signedIn && !!user;
        const grantor = accounts.find((account) => account.id === inv.invitedBy);
        await assertTeamInviteAuthority(inv.companyId, grantor, user, inv.role, tx, "share");
        if (!user) {
          [user] = await tx
            .insert(users)
            .values({
              name: body.name!,
              email,
              passwordHash: passwordHash!,
              userType: "customer",
              isAdmin: false,
            })
            .onConflictDoNothing()
            .returning();
          if (!user) throw new DomainError("LOGIN_REQUIRED", 409);
        }
        const [accepted] = await tx
          .update(companyInvitations)
          .set({ status: "accepted", acceptedAt: databaseUtcNow, acceptedUserId: user.id })
          .where(
            and(
              eq(companyInvitations.id, inv.id),
              eq(companyInvitations.companyId, inv.companyId),
              eq(companyInvitations.tokenHash, inv.tokenHash),
              eq(companyInvitations.status, "pending"),
              gt(companyInvitations.expiresAt, databaseUtcNow)
            )
          )
          .returning();
        if (!accepted) {
          const [current] = await tx
            .select({ status: companyInvitations.status })
            .from(companyInvitations)
            .where(eq(companyInvitations.tokenHash, inv.tokenHash));
          if (!current) throw new DomainError("INVITATION_NOT_FOUND", 404);
          const status = current.status === "pending" ? "expired" : current.status;
          throw new DomainError(`INVITATION_${status.toUpperCase()}`, 410);
        }

        // Placeholder credentials and portal conversion are committed with the invitation and role.
        if (claimPlaceholder || user.userType === "client_portal") {
          [user] = await tx
            .update(users)
            .set({
              ...(claimPlaceholder
                ? {
                    passwordHash: passwordHash!,
                    name: body.name!,
                    passwordChangedAt: databaseUtcNow,
                  }
                : {}),
              ...(user.userType === "client_portal" ? { userType: "customer" } : {}),
            })
            .where(eq(users.id, user.id))
            .returning();
        }
        const [membership] = await tx
          .select({ id: companyUsers.id, role: companyUsers.role })
          .from(companyUsers)
          .where(and(eq(companyUsers.companyId, inv.companyId), eq(companyUsers.userId, user.id)))
          .for("update");
        const generated = await hasFirmCreatedCompanyMembership(inv.companyId, user.id, tx);
        const directRole =
          membership && (!generated || membership.role === "owner")
            ? normalizeCompanyRole(membership.role)
            : normalizeCompanyRole(accepted.role);
        let membershipId = membership?.id;
        if (!membership || generated) {
          const [saved] = await tx
            .insert(companyUsers)
            .values({ companyId: inv.companyId, userId: user.id, role: directRole })
            .onConflictDoUpdate({
              target: [companyUsers.companyId, companyUsers.userId],
              set: { role: directRole },
            })
            .returning({ id: companyUsers.id });
          membershipId = saved.id;
        }
        if (generated) await markCompanyMembershipDirect(inv.companyId, user.id, tx);
        await recordAudit({
          userId: user.id,
          companyId: inv.companyId,
          action: "team.invite_accept",
          entityType: "company_invitation",
          entityId: inv.id,
          before: null,
          after: {
            role: directRole,
            createdUser: !signedIn,
            directCompanyGrant: true,
            membershipId,
          },
          req,
          tx,
        });
        return { user, role: directRole, createdUser: !signedIn };
      });
      const company = await storage.getCompany(inv.companyId);
      const payload: Record<string, unknown> = {
        companyId: inv.companyId,
        company: company ? { id: company.id, name: company.name } : null,
        role,
      };
      if (createdUser) {
        const tokens = await issueAuthTokens(req, res, acceptedUser);
        Object.assign(payload, tokens, {
          user: {
            id: acceptedUser.id,
            email: acceptedUser.email,
            name: acceptedUser.name,
            userType: acceptedUser.userType,
          },
        });
      }
      res.json(payload);
    })
  );
}
