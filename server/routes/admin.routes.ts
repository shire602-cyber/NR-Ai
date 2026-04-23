import type { Request, Response } from 'express';
import { Router } from 'express';
import type { Express } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import * as XLSX from 'xlsx';
import crypto from 'crypto';

import { storage } from '../storage';
import { authMiddleware, adminMiddleware } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { createLogger } from '../config/logger';
import { createDefaultAccountsForCompany } from '../defaultChartOfAccounts';

const logger = createLogger('admin-routes');

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
    console.log(`[Seed COA] Company ${companyId} already has accounts, skipping seed`);
    return { created: 0, alreadyExisted: true };
  }

  const defaultAccounts = createDefaultAccountsForCompany(companyId);

  try {
    const createdAccounts = await storage.createBulkAccounts(defaultAccounts as any);
    console.log(`[Seed COA] Created ${createdAccounts.length} accounts for company ${companyId}`);
    return { created: createdAccounts.length, alreadyExisted: false };
  } catch (error: any) {
    if (error.message?.includes('PARTIAL_INSERT')) {
      console.error(
        `[Seed COA] Partial insert detected for company ${companyId}: ${error.message}`
      );
      throw new Error(
        'PARTIAL_CHART: Chart of Accounts partially created due to race condition. Please contact support.'
      );
    }
    throw error;
  }
}

// =============================================
// Route registration
// =============================================

export function registerAdminRoutes(app: Express): void {
  const router = Router();

  // Apply auth + admin middleware to all admin routes
  router.use(authMiddleware as any);
  router.use(adminMiddleware as any);

  // =====================================
  // ADMIN SETTINGS
  // =====================================

  // Get admin settings
  router.get(
    '/admin/settings',
    asyncHandler(async (req: Request, res: Response) => {
      const settings = await storage.getAdminSettings();
      res.json(settings);
    })
  );

  // Update admin setting
  router.put(
    '/admin/settings',
    asyncHandler(async (req: Request, res: Response) => {
      const { key, value } = req.body;
      if (!key || value === undefined) {
        return res.status(400).json({ message: 'Key and value required' });
      }

      const existing = await storage.getAdminSettingByKey(key);
      if (existing) {
        const setting = await storage.updateAdminSetting(key, value);
        res.json(setting);
      } else {
        const setting = await storage.createAdminSetting({
          key,
          value,
          category: 'system',
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
    '/admin/plans',
    asyncHandler(async (req: Request, res: Response) => {
      const plans = await storage.getSubscriptionPlans();
      res.json(plans);
    })
  );

  // Create subscription plan
  router.post(
    '/admin/plans',
    asyncHandler(async (req: Request, res: Response) => {
      const plan = await storage.createSubscriptionPlan(req.body);
      res.status(201).json(plan);
    })
  );

  // Update subscription plan
  router.put(
    '/admin/plans/:id',
    asyncHandler(async (req: Request, res: Response) => {
      const { id } = req.params;
      const plan = await storage.updateSubscriptionPlan(id, req.body);
      res.json(plan);
    })
  );

  // Delete subscription plan
  router.delete(
    '/admin/plans/:id',
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
    '/admin/companies',
    asyncHandler(async (req: Request, res: Response) => {
      const companies = await storage.getAllCompanies();
      res.json(companies);
    })
  );

  // Update company (admin)
  router.patch(
    '/admin/companies/:companyId',
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const updates = req.body;

      const company = await storage.getCompany(companyId);
      if (!company) {
        return res.status(404).json({ message: 'Company not found' });
      }

      const updatedCompany = await storage.updateCompany(companyId, updates);
      res.json(updatedCompany);
    })
  );

  // =====================================
  // AUDIT LOGS
  // =====================================

  // Get audit logs
  router.get(
    '/admin/audit-logs',
    asyncHandler(async (req: Request, res: Response) => {
      const limit = parseInt(req.query.limit as string) || 100;
      const logs = await storage.getAuditLogs(limit);
      res.json(logs);
    })
  );

  // =====================================
  // ADMIN PANEL - DASHBOARD & STATS
  // =====================================

  // Get admin dashboard stats (later/more complete version)
  router.get(
    '/admin/stats',
    asyncHandler(async (req: Request, res: Response) => {
      const users = await storage.getAllUsers();
      const companies = await storage.getAllCompanies();
      const invitations = await storage.getInvitations();
      const activityLogs = await storage.getActivityLogs(10);

      const pendingInvitations = invitations.filter(i => i.status === 'pending').length;
      const activeClients = companies.length;
      const totalUsers = users.length;
      const adminUsers = users.filter(u => u.isAdmin).length;

      res.json({
        totalClients: activeClients,
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
    '/admin/clients',
    asyncHandler(async (req: Request, res: Response) => {
      const { type } = req.query; // 'client' | 'customer' | undefined (all)

      let companies;
      if (type === 'client') {
        companies = await storage.getClientCompanies();
      } else if (type === 'customer') {
        companies = await storage.getCustomerCompanies();
      } else {
        companies = await storage.getAllCompanies();
      }

      // Get user counts per company
      const clientsWithStats = await Promise.all(
        companies.map(async (company) => {
          const companyUsers = await storage.getCompanyUsersByCompanyId(company.id);
          const documents = await storage.getDocuments(company.id);
          const invoices = await storage.getInvoicesByCompanyId(company.id);

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
    '/admin/clients/:clientId',
    asyncHandler(async (req: Request, res: Response) => {
      const { clientId } = req.params;
      const company = await storage.getCompany(clientId);

      if (!company) {
        return res.status(404).json({ message: "Client not found" });
      }

      const companyUsers = await storage.getCompanyUserWithUser(clientId);
      const documents = await storage.getDocuments(clientId);
      const invoices = await storage.getInvoicesByCompanyId(clientId);
      const receipts = await storage.getReceiptsByCompanyId(clientId);
      const journalEntries = await storage.getJournalEntriesByCompanyId(clientId);
      const complianceTasks = await storage.getComplianceTasks(clientId);
      const clientNotes = await storage.getClientNotes(clientId);
      const activityLogs = await storage.getActivityLogsByCompany(clientId, 50);

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
    '/admin/clients',
    asyncHandler(async (req: Request, res: Response) => {
      const userId = (req as any).user.id;

      const company = await storage.createCompany({
        name: req.body.name,
        baseCurrency: req.body.baseCurrency || "AED",
        locale: req.body.locale || "en",
        companyType: req.body.companyType || "client", // 'client' for NR-managed, 'customer' for SaaS
        legalStructure: req.body.legalStructure,
        industry: req.body.industry,
        registrationNumber: req.body.registrationNumber,
        businessAddress: req.body.businessAddress,
        contactPhone: req.body.contactPhone,
        contactEmail: req.body.contactEmail,
        websiteUrl: req.body.websiteUrl,
        logoUrl: req.body.logoUrl,
        trnVatNumber: req.body.trnVatNumber,
        taxRegistrationType: req.body.taxRegistrationType,
        vatFilingFrequency: req.body.vatFilingFrequency,
        corporateTaxId: req.body.corporateTaxId,
      });

      // Seed chart of accounts for the new company
      await seedChartOfAccounts(company.id);

      // Log activity
      await storage.createActivityLog({
        userId,
        companyId: company.id,
        action: 'create',
        entityType: 'company',
        entityId: company.id,
        description: `Created new client: ${company.name}`,
      });

      res.status(201).json(company);
    })
  );

  // Update client (company) - Admin only
  router.patch(
    '/admin/clients/:clientId',
    asyncHandler(async (req: Request, res: Response) => {
      const { clientId } = req.params;
      const userId = (req as any).user.id;

      const company = await storage.updateCompany(clientId, req.body);

      // Log activity
      await storage.createActivityLog({
        userId,
        companyId: clientId,
        action: 'update',
        entityType: 'company',
        entityId: clientId,
        description: `Updated client: ${company.name}`,
      });

      res.json(company);
    })
  );

  // Delete client (company) - Admin only
  router.delete(
    '/admin/clients/:clientId',
    asyncHandler(async (req: Request, res: Response) => {
      const { clientId } = req.params;
      const userId = (req as any).user.id;

      const company = await storage.getCompany(clientId);
      if (!company) {
        return res.status(404).json({ message: "Client not found" });
      }

      await storage.deleteCompany(clientId);

      // Log activity
      await storage.createActivityLog({
        userId,
        action: 'delete',
        entityType: 'company',
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
    '/admin/users',
    asyncHandler(async (req: Request, res: Response) => {
      const users = await storage.getAllUsers();

      // Return users without password hashes
      const safeUsers = users.map(({ passwordHash, ...user }) => user);
      res.json(safeUsers);
    })
  );

  // Update user (admin can promote to admin, change details) - Admin only
  router.patch(
    '/admin/users/:userId',
    asyncHandler(async (req: Request, res: Response) => {
      const { userId: targetUserId } = req.params;
      const adminUserId = (req as any).user.id;

      const updates: any = {};
      if (req.body.name) updates.name = req.body.name;
      if (req.body.email) updates.email = req.body.email;
      if (typeof req.body.isAdmin === 'boolean') updates.isAdmin = req.body.isAdmin;

      const user = await storage.updateUser(targetUserId, updates);

      // Log activity
      await storage.createActivityLog({
        userId: adminUserId,
        action: 'update',
        entityType: 'user',
        entityId: targetUserId,
        description: `Updated user: ${user.email}`,
        metadata: JSON.stringify({ changes: Object.keys(updates) }),
      });

      const { passwordHash, ...safeUser } = user;
      res.json(safeUser);
    })
  );

  // Delete user - Admin only
  router.delete(
    '/admin/users/:userId',
    asyncHandler(async (req: Request, res: Response) => {
      const { userId: targetUserId } = req.params;
      const adminUserId = (req as any).user.id;

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
        action: 'delete',
        entityType: 'user',
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
    '/admin/invitations',
    asyncHandler(async (req: Request, res: Response) => {
      const invitations = await storage.getInvitations();
      res.json(invitations);
    })
  );

  // Create invitation - Admin only
  router.post(
    '/admin/invitations',
    asyncHandler(async (req: Request, res: Response) => {
      const adminUserId = (req as any).user.id;

      // Check if email already has pending invitation
      const existing = await storage.getInvitationByEmail(req.body.email);
      if (existing && existing.status === 'pending') {
        return res.status(400).json({ message: "Pending invitation already exists for this email" });
      }

      // Generate secure token
      const token = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7); // 7 days expiry

      const invitation = await storage.createInvitation({
        email: req.body.email,
        companyId: req.body.companyId || null,
        role: req.body.role || 'client',
        userType: req.body.userType || 'client', // admin | client | customer
        token,
        invitedBy: adminUserId,
        status: 'pending',
        expiresAt,
      });

      // Log activity
      await storage.createActivityLog({
        userId: adminUserId,
        companyId: req.body.companyId || null,
        action: 'invite',
        entityType: 'invitation',
        entityId: invitation.id,
        description: `Sent invitation to ${req.body.email}`,
      });

      res.status(201).json(invitation);
    })
  );

  // Revoke invitation - Admin only
  router.patch(
    '/admin/invitations/:invitationId/revoke',
    asyncHandler(async (req: Request, res: Response) => {
      const { invitationId } = req.params;
      const adminUserId = (req as any).user.id;

      const invitation = await storage.updateInvitation(invitationId, { status: 'revoked' });

      // Log activity
      await storage.createActivityLog({
        userId: adminUserId,
        action: 'update',
        entityType: 'invitation',
        entityId: invitationId,
        description: `Revoked invitation for ${invitation.email}`,
      });

      res.json(invitation);
    })
  );

  // Resend invitation - Admin only
  router.post(
    '/admin/invitations/:invitationId/resend',
    asyncHandler(async (req: Request, res: Response) => {
      const { invitationId } = req.params;
      const adminUserId = (req as any).user.id;

      // Generate new token and extend expiry
      const token = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7);

      const invitation = await storage.updateInvitation(invitationId, {
        token,
        expiresAt,
        status: 'pending',
      });

      // Log activity
      await storage.createActivityLog({
        userId: adminUserId,
        action: 'update',
        entityType: 'invitation',
        entityId: invitationId,
        description: `Resent invitation to ${invitation.email}`,
      });

      res.json(invitation);
    })
  );

  // Delete invitation - Admin only
  router.delete(
    '/admin/invitations/:invitationId',
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
    '/admin/activity-logs',
    asyncHandler(async (req: Request, res: Response) => {
      const limit = parseInt(req.query.limit as string) || 100;
      const logs = await storage.getActivityLogs(limit);
      res.json(logs);
    })
  );

  // Get activity logs for specific company - Admin only
  router.get(
    '/admin/clients/:clientId/activity-logs',
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
    '/admin/clients/:clientId/notes',
    asyncHandler(async (req: Request, res: Response) => {
      const { clientId } = req.params;
      const notes = await storage.getClientNotes(clientId);
      res.json(notes);
    })
  );

  // Create note for a client - Admin only
  router.post(
    '/admin/clients/:clientId/notes',
    asyncHandler(async (req: Request, res: Response) => {
      const { clientId } = req.params;
      const authorId = (req as any).user.id;

      const note = await storage.createClientNote({
        companyId: clientId,
        authorId,
        content: req.body.content,
        isPinned: req.body.isPinned || false,
      });

      res.status(201).json(note);
    })
  );

  // Update note - Admin only
  router.patch(
    '/admin/notes/:noteId',
    asyncHandler(async (req: Request, res: Response) => {
      const { noteId } = req.params;
      const note = await storage.updateClientNote(noteId, req.body);
      res.json(note);
    })
  );

  // Delete note - Admin only
  router.delete(
    '/admin/notes/:noteId',
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
    '/admin/import/clients',
    asyncHandler(async (req: Request, res: Response) => {
      const { data, createInvitations, sendEmails } = req.body;

      if (!data || !Array.isArray(data)) {
        return res.status(400).json({ message: "Invalid data format. Expected array of client records." });
      }

      const userId = (req as any).user.id;
      const results = {
        success: [] as any[],
        errors: [] as any[],
        invitations: [] as any[],
      };

      for (const row of data) {
        try {
          // Validate required fields
          if (!row.name || row.name.trim() === '') {
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
            action: 'create',
            entityType: 'company',
            entityId: company.id,
            description: `Imported client company: ${company.name}`,
          });

          // Create invitation if email is provided and createInvitations is true
          if (createInvitations && row.email) {
            try {
              const token = crypto.randomBytes(32).toString('hex');
              const expiresAt = new Date();
              expiresAt.setDate(expiresAt.getDate() + 7); // 7 days expiry

              const invitation = await storage.createInvitation({
                email: row.email.trim(),
                companyId: company.id,
                role: 'client',
                userType: 'client',
                token,
                expiresAt,
                invitedBy: userId,
                status: 'pending',
              });

              results.invitations.push({
                email: row.email,
                companyName: company.name,
                inviteLink: `/register?invite=${token}`,
              });
            } catch (invErr: any) {
              // Don't fail the whole import if invitation fails
              console.error(`Failed to create invitation for ${row.email}:`, invErr.message);
            }
          }

        } catch (rowError: any) {
          results.errors.push({ row, error: rowError.message });
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
    '/admin/import/preview',
    asyncHandler(async (req: Request, res: Response) => {
      const { fileData, fileName } = req.body;

      if (!fileData) {
        return res.status(400).json({ message: "No file data provided" });
      }

      // Convert base64 to buffer
      const buffer = Buffer.from(fileData, 'base64');

      // Parse Excel file
      const workbook = XLSX.read(buffer, { type: 'buffer' });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];

      // Convert to JSON with headers
      const jsonData = XLSX.utils.sheet_to_json(worksheet, { defval: '' });

      // Get column headers
      const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');
      const headers: string[] = [];
      for (let col = range.s.c; col <= range.e.c; col++) {
        const cellAddress = XLSX.utils.encode_cell({ r: range.s.r, c: col });
        const cell = worksheet[cellAddress];
        headers.push(cell ? String(cell.v) : `Column ${col + 1}`);
      }

      // Map data to expected format based on column headers
      const mappedData = jsonData.map((row: any) => {
        // Try to intelligently map columns
        const mapped: any = {};

        // Name mapping (look for various name columns)
        mapped.name = row['Company Name'] || row['Name'] || row['Client Name'] ||
                      row['company_name'] || row['name'] || row['client'] ||
                      row['Company'] || row['Business Name'] || '';

        // Email mapping
        mapped.email = row['Email'] || row['email'] || row['Contact Email'] ||
                       row['contact_email'] || row['E-mail'] || '';

        // Phone mapping
        mapped.phone = row['Phone'] || row['phone'] || row['Contact Phone'] ||
                       row['contact_phone'] || row['Tel'] || row['Telephone'] || '';

        // TRN/Registration mapping
        mapped.trn = row['TRN'] || row['trn'] || row['Tax Registration Number'] ||
                     row['VAT Number'] || row['Registration Number'] || row['registration_number'] || '';

        // Address mapping
        mapped.address = row['Address'] || row['address'] || row['Business Address'] ||
                         row['business_address'] || row['Location'] || '';

        // Industry mapping
        mapped.industry = row['Industry'] || row['industry'] || row['Sector'] ||
                          row['Business Type'] || '';

        // Website mapping
        mapped.website = row['Website'] || row['website'] || row['URL'] || row['Web'] || '';

        // Legal structure mapping
        mapped.legalStructure = row['Legal Structure'] || row['legal_structure'] ||
                                row['Business Structure'] || row['Type'] || '';

        // Currency (default to AED)
        mapped.currency = row['Currency'] || row['currency'] || 'AED';

        // Locale (default to en)
        mapped.locale = row['Locale'] || row['locale'] || row['Language'] || 'en';

        // Keep original row for reference
        mapped._original = row;

        return mapped;
      });

      res.json({
        fileName,
        sheetName: firstSheetName,
        headers,
        totalRows: jsonData.length,
        preview: mappedData.slice(0, 10), // First 10 rows for preview
        allData: mappedData,
      });
    })
  );

  // Download sample import template - Admin only
  router.get(
    '/admin/import/template',
    asyncHandler(async (req: Request, res: Response) => {
      // Create sample data
      const sampleData = [
        {
          'Company Name': 'Example Company LLC',
          'Email': 'contact@example.com',
          'Phone': '+971 50 123 4567',
          'TRN': '100000000000003',
          'Address': 'Dubai, UAE',
          'Industry': 'Technology',
          'Website': 'www.example.com',
          'Legal Structure': 'LLC',
        },
        {
          'Company Name': 'Sample Trading Est.',
          'Email': 'info@sample.ae',
          'Phone': '+971 4 123 4567',
          'TRN': '100000000000004',
          'Address': 'Abu Dhabi, UAE',
          'Industry': 'Trading',
          'Website': '',
          'Legal Structure': 'Sole Proprietorship',
        },
      ];

      // Create workbook
      const workbook = XLSX.utils.book_new();
      const worksheet = XLSX.utils.json_to_sheet(sampleData);

      // Set column widths
      worksheet['!cols'] = [
        { wch: 25 }, // Company Name
        { wch: 25 }, // Email
        { wch: 18 }, // Phone
        { wch: 18 }, // TRN
        { wch: 30 }, // Address
        { wch: 15 }, // Industry
        { wch: 20 }, // Website
        { wch: 18 }, // Legal Structure
      ];

      XLSX.utils.book_append_sheet(workbook, worksheet, 'Clients');

      // Generate buffer
      const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename=client_import_template.xlsx');
      res.send(buffer);
    })
  );

  // =====================================
  // ADMIN PANEL - MANAGE DOCUMENTS FOR CLIENTS
  // =====================================

  // Admin upload document for client
  router.post(
    '/admin/clients/:clientId/documents',
    asyncHandler(async (req: Request, res: Response) => {
      const { clientId } = req.params;
      const userId = (req as any).user.id;

      const documentData = {
        companyId: clientId,
        name: req.body.name,
        nameAr: req.body.nameAr || null,
        category: req.body.category,
        description: req.body.description || null,
        fileUrl: req.body.fileUrl || '/uploads/placeholder.pdf',
        fileName: req.body.fileName || 'document.pdf',
        fileSize: req.body.fileSize || null,
        mimeType: req.body.mimeType || 'application/pdf',
        expiryDate: req.body.expiryDate ? new Date(req.body.expiryDate) : null,
        reminderDays: req.body.reminderDays || 30,
        reminderSent: false,
        tags: req.body.tags || null,
        isArchived: false,
        uploadedBy: userId,
      };

      const document = await storage.createDocument(documentData);

      // Log activity
      await storage.createActivityLog({
        userId,
        companyId: clientId,
        action: 'create',
        entityType: 'document',
        entityId: document.id,
        description: `Admin uploaded document: ${document.name}`,
      });

      res.status(201).json(document);
    })
  );

  // Mount all admin routes under /api
  app.use('/api', router);
}
