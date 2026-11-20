import type { Express, Request, Response } from "express";
import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";
import { z } from "zod";
import { storage, normalizeEmail } from "../storage";
import { authMiddleware, optionalAuthUser } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import {
  requirePermission,
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
import { users, type CompanyInvitation } from "../../shared/schema";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { zCompanyRole } from "../../shared/validators/company-role";

const log = createLogger("team");

export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const inviteBodySchema = z.object({
  email: zEmail,
  role: zCompanyRole.default("employee"),
});
const roleBodySchema = z.object({ role: zCompanyRole });
const acceptBodySchema = z.object({
  name: zText(100, { min: 1 }).optional(),
  password: passwordPolicySchema.optional(),
});

function publicInvitation(inv: CompanyInvitation) {
  const expired = inv.status === "pending" && inv.expiresAt.getTime() <= Date.now();
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

async function countOwners(companyId: string): Promise<number> {
  const members = await storage.getCompanyUsersByCompanyId(companyId);
  return members.filter((m) => normalizeCompanyRole(m.role) === "owner").length;
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
  if (invitation.status === "pending" && invitation.expiresAt.getTime() <= Date.now()) {
    await storage.updateCompanyInvitation(invitation.companyId, invitation.id, {
      status: "expired",
    });
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
    strictBody(inviteBodySchema),
    asyncHandler(async (req: Request, res: Response) => {
      const userId = req.user!.id;
      const { companyId } = req.params;
      const { email, role } = req.body as z.output<typeof inviteBodySchema>;
      const actorRole = (req.companyRole as CompanyRole | undefined) ?? null;

      if (actorRole && !grantableRoles(actorRole).includes(role)) {
        return res.status(403).json({
          message: "Only owners can invite another owner",
          code: "ROLE_NOT_GRANTABLE",
        });
      }

      const company = await storage.getCompany(companyId);
      if (!company)
        return res.status(404).json({ message: "Company not found", code: "COMPANY_NOT_FOUND" });

      const existingUser = await storage.getUserByEmail(email);
      if (existingUser && (await storage.getUserRole(companyId, existingUser.id))) {
        return res
          .status(409)
          .json({ message: "User is already a team member", code: "ALREADY_MEMBER" });
      }
      const pending = await storage.getPendingCompanyInvitationByEmail(companyId, email);
      if (pending && pending.expiresAt.getTime() > Date.now()) {
        return res.status(409).json({
          message: "An invitation is already pending for this email; resend it instead",
          code: "INVITATION_PENDING",
          details: { invitationId: pending.id },
        });
      }
      if (pending) {
        await storage.updateCompanyInvitation(companyId, pending.id, { status: "expired" });
      }

      const token = newToken();
      const invitation = await storage.createCompanyInvitation({
        companyId,
        email,
        role,
        tokenHash: token.hash,
        invitedBy: userId,
        status: "pending",
        expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
        lastSentAt: new Date(),
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
    asyncHandler(async (req: Request, res: Response) => {
      const rows = await storage.listCompanyInvitations(req.params.companyId);
      res.json(rows.map(publicInvitation));
    })
  );

  app.post(
    "/api/companies/:companyId/team/invitations/:invitationId/resend",
    authMiddleware,
    requirePermission("team.manage"),
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
      const company = await storage.getCompany(companyId);
      if (!company)
        return res.status(404).json({ message: "Company not found", code: "COMPANY_NOT_FOUND" });
      const token = newToken();
      const updated = await storage.updateCompanyInvitation(companyId, invitationId, {
        tokenHash: token.hash,
        status: "pending",
        expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
        lastSentAt: new Date(),
        sendCount: (current.sendCount ?? 0) + 1,
      });
      const delivery = await deliverInvitation(updated!, token.raw, company.name);
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
      res.json({ invitation: publicInvitation(updated!), ...delivery });
    })
  );

  app.delete(
    "/api/companies/:companyId/team/invitations/:invitationId",
    authMiddleware,
    requirePermission("team.manage"),
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
      const updated = await storage.updateCompanyInvitation(companyId, invitationId, {
        status: "revoked",
        revokedAt: new Date(),
      });
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
      res.json({ invitation: publicInvitation(updated!) });
    })
  );

  // Update team member role. R01-01: the membership is loaded and updated by
  // (memberId, companyId); another company's membership is a 404.
  app.put(
    "/api/companies/:companyId/team/:memberId",
    authMiddleware,
    requirePermission("team.manage"),
    strictBody(roleBodySchema),
    asyncHandler(async (req: Request, res: Response) => {
      const userId = req.user!.id;
      const { companyId, memberId } = req.params;
      const { role } = req.body as z.output<typeof roleBodySchema>;
      const actorRole = (req.companyRole as CompanyRole | undefined) ?? null;

      const member = await storage.getCompanyUser(companyId, memberId);
      if (!member) {
        return res.status(404).json({ message: "Team member not found", code: "NOT_FOUND" });
      }
      const currentRole = normalizeCompanyRole(member.role);
      if (actorRole && actorRole !== "owner" && (role === "owner" || currentRole === "owner")) {
        return res
          .status(403)
          .json({ message: "Only owners can change owner roles", code: "ROLE_NOT_GRANTABLE" });
      }
      if (currentRole === "owner" && role !== "owner" && (await countOwners(companyId)) <= 1) {
        return res
          .status(409)
          .json({ message: "A company must keep at least one owner", code: "LAST_OWNER" });
      }

      const companyUser = await storage.updateCompanyUser(companyId, memberId, { role });
      if (!companyUser) {
        return res.status(404).json({ message: "Team member not found", code: "NOT_FOUND" });
      }

      await recordAudit({
        userId,
        companyId,
        action: "team.role_change",
        entityType: "company_user",
        entityId: memberId,
        before: { userId: member.userId, role: currentRole },
        after: { userId: companyUser.userId, role: companyUser.role },
        req,
      });

      res.json(companyUser);
    })
  );

  // Remove team member (scoped by company, R01-01)
  app.delete(
    "/api/companies/:companyId/team/:memberId",
    authMiddleware,
    requirePermission("team.manage"),
    asyncHandler(async (req: Request, res: Response) => {
      const userId = req.user!.id;
      const { companyId, memberId } = req.params;
      const actorRole = (req.companyRole as CompanyRole | undefined) ?? null;

      const member = await storage.getCompanyUser(companyId, memberId);
      if (!member) {
        return res.status(404).json({ message: "Team member not found", code: "NOT_FOUND" });
      }
      const currentRole = normalizeCompanyRole(member.role);
      if (currentRole === "owner") {
        if (actorRole && actorRole !== "owner") {
          return res
            .status(403)
            .json({ message: "Only owners can remove an owner", code: "ROLE_NOT_GRANTABLE" });
        }
        if ((await countOwners(companyId)) <= 1) {
          return res
            .status(409)
            .json({ message: "A company must keep at least one owner", code: "LAST_OWNER" });
        }
      }

      const removed = await storage.deleteCompanyUser(companyId, memberId);
      if (!removed) {
        return res.status(404).json({ message: "Team member not found", code: "NOT_FOUND" });
      }

      await recordAudit({
        userId,
        companyId,
        action: "team.remove",
        entityType: "company_user",
        entityId: memberId,
        before: { userId: member.userId, role: currentRole },
        after: null,
        req,
      });

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
      const existing = await storage.getUserByEmail(inv.email);
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
      const role = normalizeCompanyRole(inv.role);

      const signedIn = await optionalAuthUser(req);
      const existing = await storage.getUserByEmail(inv.email);
      const claimable = !!existing && isPlaceholderPasswordHash(existing.passwordHash);

      let userId: string;
      let createdUser = false;
      if (signedIn) {
        if (normalizeEmail(signedIn.email) !== normalizeEmail(inv.email)) {
          return res.status(403).json({
            message: "This invitation was sent to a different email address",
            code: "INVITATION_EMAIL_MISMATCH",
          });
        }
        userId = signedIn.id;
      } else if (existing && !claimable) {
        return res.status(409).json({
          message: "An account already exists for this email. Sign in, then accept the invitation.",
          code: "LOGIN_REQUIRED",
        });
      } else {
        if (!body.name || !body.password) {
          return res.status(400).json({
            message: "Name and password are required to create your account",
            code: "VALIDATION_ERROR",
            fields: {
              ...(body.name ? {} : { name: ["Required"] }),
              ...(body.password ? {} : { password: ["Required"] }),
            },
          });
        }
        const passwordHash = await bcrypt.hash(body.password, 10);
        if (claimable && existing) {
          await storage.updateUserPassword(existing.id, passwordHash);
          await storage.updateUser(existing.id, { name: body.name });
          userId = existing.id;
        } else {
          const user = await storage.createUser({
            name: body.name,
            email: inv.email,
            userType: "customer",
            isAdmin: false,
            passwordHash,
          });
          userId = user.id;
        }
        createdUser = true;
      }

      // A portal customer who becomes a team member is a real company user from now on; their
      // portal bindings stay (they act through customer_portal_accounts, not membership).
      if (signedIn && signedIn.userType === "client_portal") {
        await db.update(users).set({ userType: "customer" }).where(eq(users.id, userId));
      }
      if (!(await storage.getUserRole(inv.companyId, userId))) {
        await storage.createCompanyUser({ companyId: inv.companyId, userId, role });
      }
      await storage.updateCompanyInvitation(inv.companyId, inv.id, {
        status: "accepted",
        acceptedAt: new Date(),
        acceptedUserId: userId,
      });
      await recordAudit({
        userId,
        companyId: inv.companyId,
        action: "team.invite_accept",
        entityType: "company_invitation",
        entityId: inv.id,
        before: null,
        after: { role, createdUser },
        req,
      });

      const company = await storage.getCompany(inv.companyId);
      const payload: Record<string, unknown> = {
        companyId: inv.companyId,
        company: company ? { id: company.id, name: company.name } : null,
        role,
      };
      if (createdUser) {
        const user = (await storage.getUser(userId))!;
        const tokens = await issueAuthTokens(req, res, user);
        Object.assign(payload, tokens, {
          user: { id: user.id, email: user.email, name: user.name, userType: user.userType },
        });
      }
      res.json(payload);
    })
  );
}
