import type { Request, Response } from "express";
import { Router } from "express";
import type { Express } from "express";
import crypto from "crypto";

import { storage } from "../storage";
import { authMiddleware, adminMiddleware } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { createLogger } from "../config/logger";
import { createDefaultAccountsForCompany } from "../defaultChartOfAccounts";
import { db } from "../db";
import { eq, and, desc, gte, lte, sql, type SQL } from "drizzle-orm";
import { activityLogs } from "../../shared/schema";
import { createSpreadsheetBuffer, parseSpreadsheet } from "../services/spreadsheet.service";
import { errorMessage } from "../errors";
import { z } from "zod";
import { strictBody } from "../http/strict-body";
import { adminIntegrationStatus } from "../services/admin-integrations";
import * as googleSheets from "../integrations/googleSheets";
import { parsedBody } from "../http/parsed-body";
import {
  adminCreateClientBody,
  adminCreateClientDocumentBody,
  adminCreateInvitationBody,
  adminImportClientsBody,
  adminImportPreviewBody,
  adminUpdateCompanyBody,
  adminUpdateUserBody,
  createClientNoteBody,
  createSubscriptionPlanBody,
  updateClientNoteBody,
  updateSubscriptionPlanBody,
  upsertAdminSettingBody,
  type AdminCreateClientBody,
  type AdminCreateClientDocumentBody,
  type AdminCreateInvitationBody,
  type AdminImportClientsBody,
  type AdminImportPreviewBody,
  type AdminUpdateCompanyBody,
  type AdminUpdateUserBody,
  type CreateClientNoteBody,
  type CreateSubscriptionPlanBody,
  type UpdateClientNoteBody,
  type UpdateSubscriptionPlanBody,
  type UpsertAdminSettingBody,
} from "../../shared/validators/admin";

const logger = createLogger("admin-routes");

// =============================================
// Helpers (migrated from monolith routes.ts)
// =============================================

/**
 * Seed Chart of Accounts for a newly created company.
 */
async function seedChartOfAccounts(
  companyId: string
): Promise<{ created: number; alreadyExisted: boolean }> {
  const hasAccounts = await storage.companyHasAccounts(companyId);
  if (hasAccounts) {
    logger.info({ companyId }, "Company already has accounts, skipping seed");
    return { created: 0, alreadyExisted: true };
  }

  const defaultAccounts = createDefaultAccountsForCompany(companyId);

  try {
    const createdAccounts = await storage.createBulkAccounts(defaultAccounts);
    logger.info({ companyId, count: createdAccounts.length }, "Created chart of accounts");
    return { created: createdAccounts.length, alreadyExisted: false };
  } catch (error: unknown) {
    if (errorMessage(error)?.includes("PARTIAL_INSERT")) {
      logger.error(
        { companyId, err: errorMessage(error) },
        "Partial insert detected during COA seed"
      );
      throw new Error(
        "PARTIAL_CHART: Chart of Accounts partially created due to race condition. Please contact support."
      );
    }
    throw error;
  }
}

/** Defined, storable company fields from a parsed admin body (drops the legacy no-op flag). */
function companyUpdates(body: AdminUpdateCompanyBody): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    if (value !== undefined && key !== "vatRegistered") out[key] = value;
  }
  return out;
}

// =============================================
// Route registration
// =============================================

export function registerAdminRoutes(app: Express): void {
  const router = Router();

  // Apply auth + admin middleware only to /admin/* paths (not all /api/*)
  router.use("/admin", authMiddleware);
  router.use("/admin", adminMiddleware);

  // =====================================
  // ADMIN SETTINGS
  // =====================================

  // Get admin settings
  router.get(
    "/admin/settings",
    asyncHandler(async (req: Request, res: Response) => {
      const settings = await storage.getAdminSettings();
      res.json(settings);
    })
  );

  // Update admin setting
  router.put(
    "/admin/settings",
    strictBody(upsertAdminSettingBody),
    asyncHandler(async (req: Request, res: Response) => {
      const { key, value } = parsedBody<UpsertAdminSettingBody>(req);

      const existing = await storage.getAdminSettingByKey(key);
      if (existing) {
        const setting = await storage.updateAdminSetting(key, value);
        res.json(setting);
      } else {
        const setting = await storage.createAdminSetting({
          key,
          value,
          category: "system",
        });
        res.json(setting);
      }
    })
  );

  // =====================================
  // SUBSCRIPTION PLANS
  // =====================================

  // Get subscription plans
  router.get(
    "/admin/plans",
    asyncHandler(async (req: Request, res: Response) => {
      const plans = await storage.getSubscriptionPlans();
      res.json(plans);
    })
  );

  // Create subscription plan
  router.post(
    "/admin/plans",
    strictBody(createSubscriptionPlanBody),
    asyncHandler(async (req: Request, res: Response) => {
      const plan = await storage.createSubscriptionPlan(
        parsedBody<CreateSubscriptionPlanBody>(req)
      );
      res.status(201).json(plan);
    })
  );

  // Update subscription plan
  router.put(
    "/admin/plans/:id",
    strictBody(updateSubscriptionPlanBody),
    asyncHandler(async (req: Request, res: Response) => {
      const { id } = req.params;
      const plan = await storage.updateSubscriptionPlan(
        id,
        parsedBody<UpdateSubscriptionPlanBody>(req)
      );
      if (!plan) return res.status(404).json({ message: "Plan not found" });
      res.json(plan);
    })
  );

  // Delete subscription plan
  router.delete(
    "/admin/plans/:id",
    asyncHandler(async (req: Request, res: Response) => {
      const { id } = req.params;
      await storage.deleteSubscriptionPlan(id);
      res.status(204).send();
    })
  );

  // =====================================
  // COMPANIES
  // =====================================

  // Get all companies (admin)
  router.get(
    "/admin/companies",
    asyncHandler(async (req: Request, res: Response) => {
      const companies = await storage.getAllCompanies();
      res.json(companies);
    })
  );

  // Update company (admin)
  router.patch(
    "/admin/companies/:companyId",
    strictBody(adminUpdateCompanyBody),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const updates = companyUpdates(parsedBody<AdminUpdateCompanyBody>(req));

      const company = await storage.getCompany(companyId);
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }
      if (Object.keys(updates).length === 0) return res.json(company);

      const updatedCompany = await storage.updateCompany(companyId, updates);
      res.json(updatedCompany);
    })
  );

  // =====================================
  // AUDIT LOGS
  // =====================================

  // Get audit logs
  router.get(
    "/admin/audit-logs",
    asyncHandler(async (req: Request, res: Response) => {
      const limit = parseInt(req.query.limit as string) || 100;
      const logs = await storage.getAuditLogs(limit);
      res.json(logs);
    })
  );

  // =====================================
  // ADMIN PANEL - INTEGRATIONS (STEP1 F6)
  // =====================================

  // Which platform credentials are configured. Secrets live in the server environment and are
  // never entered through the UI.
  router.get(
    "/admin/integrations/status",
    asyncHandler(async (_req: Request, res: Response) => {
      res.json(adminIntegrationStatus());
    })
  );

  // Real Google Sheets connectivity check (creates and removes a scratch spreadsheet).
  router.post(
    "/admin/integrations/google-sheets/test",
    strictBody(z.object({}).strict()),
    asyncHandler(async (_req: Request, res: Response) => {
      if (!adminIntegrationStatus().googleSheets.configured) {
        return res.json({ ok: false, code: "not_configured" });
      }
      const ok = await googleSheets.isGoogleSheetsConnected();
      res.json({ ok, code: ok ? "connected" : "failed" });
    })
  );

  // =====================================
  // ADMIN PANEL - DASHBOARD & STATS
  // =====================================

  // Get admin dashboard stats (later/more complete version)
  router.get(
    "/admin/stats",
    asyncHandler(async (req: Request, res: Response) => {
      const users = await storage.getAllUsers();
      const companies = await storage.getAllCompanies();
      const invitations = await storage.getInvitations();
      const activityLogs = await storage.getActivityLogs(10);

      const pendingInvitations = invitations.filter((i) => i.status === "pending").length;
      const activeClients = companies.length;
      const totalUsers = users.length;
      const adminUsers = users.filter((u) => u.isAdmin).length;

      // AI calls this calendar month (the "AI credits used" tile; one metered call is one credit).
      const aiUsed = await db.execute(
        sql`SELECT count(*)::int AS n FROM ai_usage_events WHERE created_at >= date_trunc('month', now())`
      );
      const aiCreditsUsed = Number((aiUsed.rows[0] as { n?: number } | undefined)?.n ?? 0);

      res.json({
        totalClients: activeClients,
        totalCompanies: companies.length,
        aiCreditsUsed,
        totalUsers,
        adminUsers,
        clientUsers: totalUsers - adminUsers,
        pendingInvitations,
        recentActivity: activityLogs,
      });
    })
  );

  // =====================================
  // ADMIN PANEL - CLIENT (COMPANY) MANAGEMENT
  // =====================================

  // Get all clients (companies) - Admin only
  // Get all companies with stats (supports filtering by companyType)
  router.get(
    "/admin/clients",
    asyncHandler(async (req: Request, res: Response) => {
      const { type } = req.query; // 'client' | 'customer' | undefined (all)

      let companies;
      if (type === "client") {
        companies = await storage.getClientCompanies();
      } else if (type === "customer") {
        companies = await storage.getCustomerCompanies();
      } else {
        companies = await storage.getAllCompanies();
      }

      // Per-company stats fan out in parallel within each row, instead of
      // sequential awaits that triple round-trip count for big tenant lists.
      const clientsWithStats = await Promise.all(
        companies.map(async (company) => {
          const [companyUsers, documents, invoices] = await Promise.all([
            storage.getCompanyUsersByCompanyId(company.id),
            storage.getDocuments(company.id),
            storage.getInvoicesByCompanyId(company.id),
          ]);

          return {
            ...company,
            userCount: companyUsers.length,
            documentCount: documents.length,
            invoiceCount: invoices.length,
          };
        })
      );

      res.json(clientsWithStats);
    })
  );

  // Get specific client details with all related data - Admin only
  router.get(
    "/admin/clients/:clientId",
    asyncHandler(async (req: Request, res: Response) => {
      const { clientId } = req.params;
      const company = await storage.getCompany(clientId);

      if (!company) {
        return res.status(404).json({ message: "Client not found" });
      }

      const [
        companyUsers,
        documents,
        invoices,
        receipts,
        journalEntries,
        complianceTasks,
        clientNotes,
        activityLogs,
      ] = await Promise.all([
        storage.getCompanyUserWithUser(clientId),
        storage.getDocuments(clientId),
        storage.getInvoicesByCompanyId(clientId),
        storage.getReceiptsByCompanyId(clientId),
        storage.getJournalEntriesByCompanyId(clientId),
        storage.getComplianceTasks(clientId),
        storage.getClientNotes(clientId),
        storage.getActivityLogsByCompany(clientId, 50),
      ]);

      res.json({
        company,
        users: companyUsers,
        documents,
        invoices,
        receipts,
        journalEntries,
        complianceTasks,
        clientNotes,
        activityLogs,
      });
    })
  );

  // Create new client (company) - Admin only
  router.post(
    "/admin/clients",
    strictBody(adminCreateClientBody),
    asyncHandler(async (req: Request, res: Response) => {
      const userId = req.user!.id;
      const body = parsedBody<AdminCreateClientBody>(req);

      const company = await storage.createCompany({
        name: body.name,
        baseCurrency: body.baseCurrency || "AED",
        locale: body.locale || "en",
        companyType: body.companyType || "client", // 'client' for NR-managed, 'customer' for SaaS
        legalStructure: body.legalStructure,
        industry: body.industry,
        registrationNumber: body.registrationNumber,
        businessAddress: body.businessAddress,
        contactPhone: body.contactPhone,
        contactEmail: body.contactEmail,
        websiteUrl: body.websiteUrl,
        logoUrl: body.logoUrl,
        trnVatNumber: body.trnVatNumber,
        taxRegistrationType: body.taxRegistrationType,
        vatFilingFrequency: body.vatFilingFrequency,
        corporateTaxId: body.corporateTaxId,
      });

      // Seed chart of accounts for the new company
      await seedChartOfAccounts(company.id);

      // Log activity
      await storage.createActivityLog({
        userId,
        companyId: company.id,
        action: "create",
        entityType: "company",
        entityId: company.id,
        description: `Created new client: ${company.name}`,
      });

      res.status(201).json(company);
    })
  );

  // Update client (company) - Admin only
  router.patch(
    "/admin/clients/:clientId",
    strictBody(adminUpdateCompanyBody),
    asyncHandler(async (req: Request, res: Response) => {
      const { clientId } = req.params;
      const userId = req.user!.id;
      const updates = companyUpdates(parsedBody<AdminUpdateCompanyBody>(req));

      const existing = await storage.getCompany(clientId);
      if (!existing) return res.status(404).json({ message: "Client not found" });
      if (Object.keys(updates).length === 0) return res.json(existing);
      const company = await storage.updateCompany(clientId, updates);

      // Log activity
      await storage.createActivityLog({
        userId,
        companyId: clientId,
        action: "update",
        entityType: "company",
        entityId: clientId,
        description: `Updated client: ${company.name}`,
      });

      res.json(company);
    })
  );

  // Delete client (company) - Admin only
  router.delete(
    "/admin/clients/:clientId",
    asyncHandler(async (req: Request, res: Response) => {
      const { clientId } = req.params;
      const userId = req.user!.id;

      const company = await storage.getCompany(clientId);
      if (!company) {
        return res.status(404).json({ message: "Client not found" });
      }

      await storage.deleteCompany(clientId);

      // Log activity
      await storage.createActivityLog({
        userId,
        action: "delete",
        entityType: "company",
        entityId: clientId,
        description: `Deleted client: ${company.name}`,
      });

      res.json({ success: true });
    })
  );

  // =====================================
  // ADMIN PANEL - USER MANAGEMENT
  // =====================================

  // Get all users - Admin only (later/more complete version)
  router.get(
    "/admin/users",
    asyncHandler(async (req: Request, res: Response) => {
      const users = await storage.getAllUsers();

      // Return users without password hashes
      const safeUsers = users.map(({ passwordHash: _passwordHash, ...user }) => user);
      res.json(safeUsers);
    })
  );

  // Update user (admin can promote to admin, change details) - Admin only
  router.patch(
    "/admin/users/:userId",
    strictBody(adminUpdateUserBody),
    asyncHandler(async (req: Request, res: Response) => {
      const { userId: targetUserId } = req.params;
      const adminUserId = req.user!.id;
      const body = parsedBody<AdminUpdateUserBody>(req);

      const updates: { name?: string; email?: string; isAdmin?: boolean } = {};
      if (body.name) updates.name = body.name;
      if (body.email) updates.email = body.email;
      if (typeof body.isAdmin === "boolean") updates.isAdmin = body.isAdmin;

      const user = await storage.updateUser(targetUserId, updates);

      // Log activity
      await storage.createActivityLog({
        userId: adminUserId,
        action: "update",
        entityType: "user",
        entityId: targetUserId,
        description: `Updated user: ${user.email}`,
        metadata: JSON.stringify({ changes: Object.keys(updates) }),
      });

      const { passwordHash: _passwordHash, ...safeUser } = user;
      res.json(safeUser);
    })
  );

  // Delete user - Admin only
  router.delete(
    "/admin/users/:userId",
    asyncHandler(async (req: Request, res: Response) => {
      const { userId: targetUserId } = req.params;
      const adminUserId = req.user!.id;

      // Prevent admin from deleting themselves
      if (targetUserId === adminUserId) {
        return res.status(400).json({ message: "Cannot delete your own account" });
      }

      const user = await storage.getUser(targetUserId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      await storage.deleteUser(targetUserId);

      // Log activity
      await storage.createActivityLog({
        userId: adminUserId,
        action: "delete",
        entityType: "user",
        entityId: targetUserId,
        description: `Deleted user: ${user.email}`,
      });

      res.json({ success: true });
    })
  );

  // =====================================
  // ADMIN PANEL - CLIENT INVITATIONS
  // =====================================

  // Get all invitations - Admin only
  router.get(
    "/admin/invitations",
    asyncHandler(async (req: Request, res: Response) => {
      const invitations = await storage.getInvitations();
      res.json(invitations);
    })
  );

  // Create invitation - Admin only
  router.post(
    "/admin/invitations",
    strictBody(adminCreateInvitationBody, { allowServerOwned: ["companyId"] }),
    asyncHandler(async (req: Request, res: Response) => {
      const adminUserId = req.user!.id;
      const body = parsedBody<AdminCreateInvitationBody>(req);

      // Check if email already has pending invitation
      const existing = await storage.getInvitationByEmail(body.email);
      if (existing && existing.status === "pending") {
        return res
          .status(400)
          .json({ message: "Pending invitation already exists for this email" });
      }

      // Generate secure token
      const token = crypto.randomBytes(32).toString("hex");
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7); // 7 days expiry

      const invitation = await storage.createInvitation({
        email: body.email,
        companyId: body.companyId || null,
        role: body.role || "client",
        userType: body.userType || "client", // admin | client | customer
        token,
        invitedBy: adminUserId,
        status: "pending",
        expiresAt,
      });

      // Log activity
      await storage.createActivityLog({
        userId: adminUserId,
        companyId: body.companyId || null,
        action: "invite",
        entityType: "invitation",
        entityId: invitation.id,
        description: `Sent invitation to ${body.email}`,
      });

      res.status(201).json(invitation);
    })
  );

  // Revoke invitation - Admin only
  router.patch(
    "/admin/invitations/:invitationId/revoke",
    asyncHandler(async (req: Request, res: Response) => {
      const { invitationId } = req.params;
      const adminUserId = req.user!.id;

      const invitation = await storage.updateInvitation(invitationId, { status: "revoked" });

      // Log activity
      await storage.createActivityLog({
        userId: adminUserId,
        action: "update",
        entityType: "invitation",
        entityId: invitationId,
        description: `Revoked invitation for ${invitation.email}`,
      });

      res.json(invitation);
    })
  );

  // Resend invitation - Admin only
  router.post(
    "/admin/invitations/:invitationId/resend",
    asyncHandler(async (req: Request, res: Response) => {
      const { invitationId } = req.params;
      const adminUserId = req.user!.id;

      // Generate new token and extend expiry
      const token = crypto.randomBytes(32).toString("hex");
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7);

      const invitation = await storage.updateInvitation(invitationId, {
        token,
        expiresAt,
        status: "pending",
      });

      // Log activity
      await storage.createActivityLog({
        userId: adminUserId,
        action: "update",
        entityType: "invitation",
        entityId: invitationId,
        description: `Resent invitation to ${invitation.email}`,
      });

      res.json(invitation);
    })
  );

  // Delete invitation - Admin only
  router.delete(
    "/admin/invitations/:invitationId",
    asyncHandler(async (req: Request, res: Response) => {
      const { invitationId } = req.params;
      await storage.deleteInvitation(invitationId);
      res.json({ success: true });
    })
  );

  // =====================================
  // ADMIN PANEL - ACTIVITY LOGS
  // =====================================

  // Get all activity logs - Admin only
  router.get(
    "/admin/activity-logs",
    asyncHandler(async (req: Request, res: Response) => {
      const limit = parseInt(req.query.limit as string) || 100;
      const logs = await storage.getActivityLogs(limit);
      res.json(logs);
    })
  );

  // Get activity logs for specific company - Admin only
  router.get(
    "/admin/clients/:clientId/activity-logs",
    asyncHandler(async (req: Request, res: Response) => {
      const { clientId } = req.params;
      const limit = parseInt(req.query.limit as string) || 100;
      const logs = await storage.getActivityLogsByCompany(clientId, limit);
      res.json(logs);
    })
  );

  // =====================================
  // ADMIN PANEL - CLIENT NOTES (Internal)
  // =====================================

  // Get notes for a client - Admin only
  router.get(
    "/admin/clients/:clientId/notes",
    asyncHandler(async (req: Request, res: Response) => {
      const { clientId } = req.params;
      const notes = await storage.getClientNotes(clientId);
      res.json(notes);
    })
  );

  // Create note for a client - Admin only
  router.post(
    "/admin/clients/:clientId/notes",
    strictBody(createClientNoteBody),
    asyncHandler(async (req: Request, res: Response) => {
      const { clientId } = req.params;
      const authorId = req.user!.id;
      const body = parsedBody<CreateClientNoteBody>(req);

      const note = await storage.createClientNote({
        companyId: clientId,
        authorId,
        content: body.content,
        isPinned: body.isPinned || false,
      });

      res.status(201).json(note);
    })
  );

  // Update note - Admin only
  router.patch(
    "/admin/notes/:noteId",
    strictBody(updateClientNoteBody),
    asyncHandler(async (req: Request, res: Response) => {
      const { noteId } = req.params;
      const note = await storage.updateClientNote(noteId, parsedBody<UpdateClientNoteBody>(req));
      if (!note) return res.status(404).json({ message: "Note not found" });
      res.json(note);
    })
  );

  // Delete note - Admin only
  router.delete(
    "/admin/notes/:noteId",
    asyncHandler(async (req: Request, res: Response) => {
      const { noteId } = req.params;
      await storage.deleteClientNote(noteId);
      res.json({ success: true });
    })
  );

  // =====================================
  // ADMIN PANEL - EXCEL IMPORT FOR CLIENTS
  // =====================================

  // Import clients from Excel - Admin only
  router.post(
    "/admin/import/clients",
    strictBody(adminImportClientsBody),
    asyncHandler(async (req: Request, res: Response) => {
      const { createInvitations } = parsedBody<AdminImportClientsBody>(req);
      // Spreadsheet rows are free-form records; the loop below reads the known columns defensively.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = parsedBody<AdminImportClientsBody>(req).data as any[];

      if (!data || !Array.isArray(data)) {
        return res
          .status(400)
          .json({ message: "Invalid data format. Expected array of client records." });
      }

      const userId = req.user!.id;
      const results = {
        success: [] as Array<Record<string, unknown>>,
        errors: [] as Array<Record<string, unknown>>,
        invitations: [] as Array<Record<string, unknown>>,
      };

      for (const row of data) {
        try {
          // Validate required fields
          if (!row.name || row.name.trim() === "") {
            results.errors.push({ row, error: "Company name is required" });
            continue;
          }

          // Check if company already exists
          const existingCompany = await storage.getCompanyByName(row.name.trim());
          if (existingCompany) {
            results.errors.push({ row, error: `Company "${row.name}" already exists` });
            continue;
          }

          // Create the company as a client type
          const company = await storage.createCompany({
            name: row.name.trim(),
            baseCurrency: row.currency || "AED",
            locale: row.locale || "en",
            companyType: "client", // All imported companies are NR-managed clients
            legalStructure: row.legalStructure || null,
            industry: row.industry || null,
            registrationNumber: row.registrationNumber || row.trn || null,
            businessAddress: row.address || null,
            contactPhone: row.phone || null,
            contactEmail: row.email || null,
            websiteUrl: row.website || null,
            trnVatNumber: row.trn || null,
          });

          results.success.push({
            id: company.id,
            name: company.name,
            email: row.email,
          });

          // Log activity
          await storage.createActivityLog({
            userId,
            companyId: company.id,
            action: "create",
            entityType: "company",
            entityId: company.id,
            description: `Imported client company: ${company.name}`,
          });

          // Create invitation if email is provided and createInvitations is true
          if (createInvitations && row.email) {
            try {
              const token = crypto.randomBytes(32).toString("hex");
              const expiresAt = new Date();
              expiresAt.setDate(expiresAt.getDate() + 7); // 7 days expiry

              const _invitation = await storage.createInvitation({
                email: row.email.trim(),
                companyId: company.id,
                role: "client",
                userType: "client",
                token,
                expiresAt,
                invitedBy: userId,
                status: "pending",
              });

              results.invitations.push({
                email: row.email,
                companyName: company.name,
                inviteLink: `/register?invite=${token}`,
              });
            } catch (invErr: unknown) {
              // Don't fail the whole import if invitation fails
              logger.error(
                { email: row.email, err: errorMessage(invErr) },
                "Failed to create invitation"
              );
            }
          }
        } catch (rowError: unknown) {
          results.errors.push({ row, error: errorMessage(rowError) });
        }
      }

      res.json({
        message: `Import completed. ${results.success.length} clients created, ${results.errors.length} errors.`,
        results,
      });
    })
  );

  // Parse Excel file and return preview - Admin only
  router.post(
    "/admin/import/preview",
    strictBody(adminImportPreviewBody),
    asyncHandler(async (req: Request, res: Response) => {
      const { fileData, fileName } = parsedBody<AdminImportPreviewBody>(req);

      if (!fileData) {
        return res.status(400).json({ message: "No file data provided" });
      }

      // Convert base64 to buffer
      const buffer = Buffer.from(fileData, "base64");

      let parsed;
      try {
        parsed = await parseSpreadsheet(buffer, fileName);
      } catch (err: unknown) {
        return res.status(400).json({ message: `Could not parse file: ${errorMessage(err)}` });
      }
      const jsonData = parsed.rows;
      const headers = parsed.headers;

      // Map data to expected format based on column headers
      const mappedData = jsonData.map((row) => {
        // Try to intelligently map columns
        const mapped: Record<string, unknown> = {};

        // Name mapping (look for various name columns)
        mapped.name =
          row["Company Name"] ||
          row["Name"] ||
          row["Client Name"] ||
          row["company_name"] ||
          row["name"] ||
          row["client"] ||
          row["Company"] ||
          row["Business Name"] ||
          "";

        // Email mapping
        mapped.email =
          row["Email"] ||
          row["email"] ||
          row["Contact Email"] ||
          row["contact_email"] ||
          row["E-mail"] ||
          "";

        // Phone mapping
        mapped.phone =
          row["Phone"] ||
          row["phone"] ||
          row["Contact Phone"] ||
          row["contact_phone"] ||
          row["Tel"] ||
          row["Telephone"] ||
          "";

        // TRN/Registration mapping
        mapped.trn =
          row["TRN"] ||
          row["trn"] ||
          row["Tax Registration Number"] ||
          row["VAT Number"] ||
          row["Registration Number"] ||
          row["registration_number"] ||
          "";

        // Address mapping
        mapped.address =
          row["Address"] ||
          row["address"] ||
          row["Business Address"] ||
          row["business_address"] ||
          row["Location"] ||
          "";

        // Industry mapping
        mapped.industry =
          row["Industry"] || row["industry"] || row["Sector"] || row["Business Type"] || "";

        // Website mapping
        mapped.website = row["Website"] || row["website"] || row["URL"] || row["Web"] || "";

        // Legal structure mapping
        mapped.legalStructure =
          row["Legal Structure"] ||
          row["legal_structure"] ||
          row["Business Structure"] ||
          row["Type"] ||
          "";

        // Currency (default to AED)
        mapped.currency = row["Currency"] || row["currency"] || "AED";

        // Locale (default to en)
        mapped.locale = row["Locale"] || row["locale"] || row["Language"] || "en";

        // Keep original row for reference
        mapped._original = row;

        return mapped;
      });

      res.json({
        fileName,
        sheetName: parsed.sheetName,
        headers,
        totalRows: jsonData.length,
        preview: mappedData.slice(0, 10), // First 10 rows for preview
        allData: mappedData,
      });
    })
  );

  // Download sample import template - Admin only
  router.get(
    "/admin/import/template",
    asyncHandler(async (req: Request, res: Response) => {
      // Create sample data
      const sampleData = [
        {
          "Company Name": "Example Company LLC",
          Email: "contact@example.com",
          Phone: "+971 50 123 4567",
          TRN: "100000000000003",
          Address: "Dubai, UAE",
          Industry: "Technology",
          Website: "www.example.com",
          "Legal Structure": "LLC",
        },
        {
          "Company Name": "Sample Trading Est.",
          Email: "info@sample.ae",
          Phone: "+971 4 123 4567",
          TRN: "100000000000004",
          Address: "Abu Dhabi, UAE",
          Industry: "Trading",
          Website: "",
          "Legal Structure": "Sole Proprietorship",
        },
      ];

      const buffer = await createSpreadsheetBuffer({
        sheetName: "Clients",
        columns: [
          { header: "Company Name", key: "Company Name", width: 25 },
          { header: "Email", key: "Email", width: 25 },
          { header: "Phone", key: "Phone", width: 18 },
          { header: "TRN", key: "TRN", width: 18 },
          { header: "Address", key: "Address", width: 30 },
          { header: "Industry", key: "Industry", width: 15 },
          { header: "Website", key: "Website", width: 20 },
          { header: "Legal Structure", key: "Legal Structure", width: 18 },
        ],
        rows: sampleData,
      });

      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      res.setHeader("Content-Disposition", "attachment; filename=client_import_template.xlsx");
      res.send(buffer);
    })
  );

  // =====================================
  // ADMIN PANEL - MANAGE DOCUMENTS FOR CLIENTS
  // =====================================

  // Admin upload document for client
  router.post(
    "/admin/clients/:clientId/documents",
    strictBody(adminCreateClientDocumentBody),
    asyncHandler(async (req: Request, res: Response) => {
      const { clientId } = req.params;
      const userId = req.user!.id;
      const body = parsedBody<AdminCreateClientDocumentBody>(req);

      const documentData = {
        companyId: clientId,
        name: body.name,
        nameAr: body.nameAr || null,
        category: body.category,
        description: body.description || null,
        fileUrl: body.fileUrl || "/uploads/placeholder.pdf",
        fileName: body.fileName || "document.pdf",
        fileSize: body.fileSize || null,
        mimeType: body.mimeType || "application/pdf",
        expiryDate: body.expiryDate ? new Date(body.expiryDate) : null,
        reminderDays: body.reminderDays || 30,
        reminderSent: false,
        tags: body.tags || null,
        isArchived: false,
        uploadedBy: userId,
      };

      const document = await storage.createDocument(documentData);

      // Log activity
      await storage.createActivityLog({
        userId,
        companyId: clientId,
        action: "create",
        entityType: "document",
        entityId: document.id,
        description: `Admin uploaded document: ${document.name}`,
      });

      res.status(201).json(document);
    })
  );

  // =====================================
  // ENHANCED AUDIT LOG (with filters + pagination)
  // =====================================

  router.get(
    "/admin/audit-log",
    asyncHandler(async (req: Request, res: Response) => {
      const {
        userId: filterUserId,
        action,
        entityType,
        from,
        to,
        page,
        limit: limitParam,
      } = req.query as Record<string, string | undefined>;

      const limit = Math.min(parseInt(limitParam ?? "50", 10), 500);
      const offset = (Math.max(parseInt(page ?? "1", 10), 1) - 1) * limit;

      const conditions: SQL[] = [];
      if (filterUserId) conditions.push(eq(activityLogs.userId, filterUserId));
      if (action) conditions.push(eq(activityLogs.action, action));
      if (entityType) conditions.push(eq(activityLogs.entityType, entityType));
      if (from) conditions.push(gte(activityLogs.createdAt, new Date(from)));
      if (to) conditions.push(lte(activityLogs.createdAt, new Date(to)));

      const query = db
        .select()
        .from(activityLogs)
        .orderBy(desc(activityLogs.createdAt))
        .limit(limit)
        .offset(offset);

      const logs = conditions.length > 0 ? await query.where(and(...conditions)) : await query;

      res.json({ logs, page: parseInt(page ?? "1", 10), limit });
    })
  );

  // Mount all admin routes under /api
  app.use("/api", router);
}
