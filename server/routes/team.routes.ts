import type { Express, Request, Response } from "express";
import { storage } from "../storage";
import { authMiddleware } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";

export function registerTeamRoutes(app: Express) {
  // =====================================
  // TEAM MANAGEMENT
  // =====================================

  // Get team members for a company
  app.get("/api/companies/:companyId/team", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    const { companyId } = req.params;

    const hasAccess = await storage.hasCompanyAccess(userId, companyId);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const teamMembers = await storage.getCompanyUserWithUser(companyId);
    res.json(teamMembers);
  }));

  // Invite team member
  app.post("/api/companies/:companyId/team/invite", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    const { companyId } = req.params;
    const { email, role } = req.body;

    const userRole = await storage.getUserRole(companyId, userId);
    if (!userRole || userRole.role !== 'owner') {
      return res.status(403).json({ message: 'Only company owners can invite team members' });
    }

    // Check if user exists
    let invitedUser = await storage.getUserByEmail(email);
    if (!invitedUser) {
      // Create a placeholder user that will be activated when they sign up
      invitedUser = await storage.createUser({
        email,
        name: email.split('@')[0],
        passwordHash: '', // Empty password - needs to be set on registration
      } as any);
    }

    // Check if already a member
    const existingAccess = await storage.hasCompanyAccess(invitedUser.id, companyId);
    if (existingAccess) {
      return res.status(400).json({ message: 'User is already a team member' });
    }

    // Add to company
    const companyUser = await storage.createCompanyUser({
      companyId,
      userId: invitedUser.id,
      role: role || 'employee',
    });

    res.status(201).json(companyUser);
  }));

  // Update team member role
  app.put("/api/companies/:companyId/team/:memberId", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    const { companyId, memberId } = req.params;
    const { role } = req.body;

    const userRole = await storage.getUserRole(companyId, userId);
    if (!userRole || userRole.role !== 'owner') {
      return res.status(403).json({ message: 'Only company owners can update roles' });
    }

    const companyUser = await storage.updateCompanyUser(memberId, { role });
    res.json(companyUser);
  }));

  // Remove team member
  app.delete("/api/companies/:companyId/team/:memberId", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    const { companyId, memberId } = req.params;

    const userRole = await storage.getUserRole(companyId, userId);
    if (!userRole || userRole.role !== 'owner') {
      return res.status(403).json({ message: 'Only company owners can remove team members' });
    }

    await storage.deleteCompanyUser(memberId);
    res.status(204).send();
  }));
}
