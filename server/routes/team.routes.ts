import type { Express, Request, Response } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { authMiddleware } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { recordAudit } from "../services/audit.service";

export const COMPANY_TEAM_ROLES = ["owner", "accountant", "cfo", "employee"] as const;

const memberParamsSchema = z.object({
  companyId: z.string().uuid(),
  memberId: z.string().uuid(),
});

const roleUpdateSchema = z.object({
  role: z.enum(COMPANY_TEAM_ROLES),
});

/**
 * Resolve a membership row that belongs to `companyId`. Returns undefined when
 * the row does not exist OR belongs to a different company — both are
 * reported to the caller as 404 so a guessed id leaks nothing.
 */
async function findMemberInCompany(companyId: string, memberId: string) {
  const members = await storage.getCompanyUsersByCompanyId(companyId);
  return members.find((member) => member.id === memberId);
}

async function countOwners(companyId: string): Promise<number> {
  const members = await storage.getCompanyUsersByCompanyId(companyId);
  return members.filter((member) => member.role === "owner").length;
}

export function registerTeamRoutes(app: Express) {
  // =====================================
  // TEAM MANAGEMENT
  // =====================================

  // Get team members for a company
  app.get(
    "/api/companies/:companyId/team",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const userId = (req as any).user?.id;
      const { companyId } = req.params;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      const teamMembers = await storage.getCompanyUserWithUser(companyId);
      res.json(teamMembers);
    })
  );

  // Invite team member
  app.post(
    "/api/companies/:companyId/team/invite",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const userId = (req as any).user?.id;
      const { companyId } = req.params;
      const { email, role } = req.body;

      const userRole = await storage.getUserRole(companyId, userId);
      if (!userRole || userRole.role !== "owner") {
        return res.status(403).json({ message: "Only company owners can invite team members" });
      }

      // Check if user exists
      let invitedUser = await storage.getUserByEmail(email);
      if (!invitedUser) {
        // Create a placeholder user that will be activated when they sign up
        invitedUser = await storage.createUser({
          email,
          name: email.split("@")[0],
          passwordHash: "", // Empty password - needs to be set on registration
        } as any);
      }

      // Check if already a member
      const existingAccess = await storage.hasCompanyAccess(invitedUser.id, companyId);
      if (existingAccess) {
        return res.status(400).json({ message: "User is already a team member" });
      }

      // Add to company
      const companyUser = await storage.createCompanyUser({
        companyId,
        userId: invitedUser.id,
        role: role || "employee",
      });

      res.status(201).json(companyUser);
    })
  );

  // Update team member role
  app.put(
    "/api/companies/:companyId/team/:memberId",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const userId = (req as any).user?.id;
      const params = memberParamsSchema.safeParse(req.params);
      if (!params.success) {
        return res.status(400).json({ message: "Invalid company or member id" });
      }
      const { companyId, memberId } = params.data;

      const body = roleUpdateSchema.safeParse(req.body);
      if (!body.success) {
        return res.status(400).json({
          message: `role must be one of: ${COMPANY_TEAM_ROLES.join(", ")}`,
        });
      }
      const { role } = body.data;

      const userRole = await storage.getUserRole(companyId, userId);
      if (!userRole || userRole.role !== "owner") {
        return res.status(403).json({ message: "Only company owners can update roles" });
      }

      // The member must belong to THIS company. A valid memberId from another
      // company is indistinguishable from a non-existent one.
      const member = await findMemberInCompany(companyId, memberId);
      if (!member) {
        return res.status(404).json({ message: "Team member not found" });
      }

      // Demoting the last owner would orphan the company.
      if (member.role === "owner" && role !== "owner" && (await countOwners(companyId)) <= 1) {
        return res.status(422).json({
          message: "A company must keep at least one owner",
          code: "LAST_OWNER",
        });
      }

      const companyUser = await storage.updateCompanyUser(memberId, companyId, { role });
      if (!companyUser) {
        return res.status(404).json({ message: "Team member not found" });
      }

      await recordAudit({
        userId,
        companyId,
        action: "team.role_change",
        entityType: "company_user",
        entityId: memberId,
        before: { userId: member.userId, role: member.role },
        after: { userId: companyUser.userId, role: companyUser.role },
        req,
      });

      res.json(companyUser);
    })
  );

  // Remove team member
  app.delete(
    "/api/companies/:companyId/team/:memberId",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const userId = (req as any).user?.id;
      const params = memberParamsSchema.safeParse(req.params);
      if (!params.success) {
        return res.status(400).json({ message: "Invalid company or member id" });
      }
      const { companyId, memberId } = params.data;

      const userRole = await storage.getUserRole(companyId, userId);
      if (!userRole || userRole.role !== "owner") {
        return res.status(403).json({ message: "Only company owners can remove team members" });
      }

      const member = await findMemberInCompany(companyId, memberId);
      if (!member) {
        return res.status(404).json({ message: "Team member not found" });
      }

      if (member.role === "owner" && (await countOwners(companyId)) <= 1) {
        return res.status(422).json({
          message: "A company must keep at least one owner",
          code: "LAST_OWNER",
        });
      }

      const removed = await storage.deleteCompanyUser(memberId, companyId);
      if (!removed) {
        return res.status(404).json({ message: "Team member not found" });
      }

      await recordAudit({
        userId,
        companyId,
        action: "team.remove",
        entityType: "company_user",
        entityId: memberId,
        before: { userId: member.userId, role: member.role },
        after: null,
        req,
      });

      res.status(204).send();
    })
  );
}
