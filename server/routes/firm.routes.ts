import type { Request, Response } from 'express';
import { Router } from 'express';
import type { Express } from 'express';
import { z } from 'zod';

import { storage } from '../storage';
import { authMiddleware } from '../middleware/auth';
import { requireFirmRole } from '../middleware/rbac';
import { asyncHandler } from '../middleware/errorHandler';
import { createLogger } from '../config/logger';
import { createDefaultAccountsForCompany } from '../defaultChartOfAccounts';
import { db } from '../db';
import { eq, and, count, sum, max, or, desc, inArray, sql } from 'drizzle-orm';
import {
  companies,
  companyUsers,
  users,
  invoices,
  receipts,
  vatReturns,
  bankTransactions,
} from '../../shared/schema';

const logger = createLogger('firm-routes');

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function seedChartOfAccounts(companyId: string): Promise<void> {
  const hasAccounts = await storage.companyHasAccounts(companyId);
  if (hasAccounts) return;
  const defaultAccounts = createDefaultAccountsForCompany(companyId);
  await storage.createBulkAccounts(defaultAccounts as any);
}

async function getClientStats(companyId: string) {
  const [
    invoiceStats,
    arStats,
    lastReceipt,
    lastBankTx,
    latestVatReturn,
    staffRows,
  ] = await Promise.all([
    // Total invoices: count + sum
    db
      .select({ cnt: count(), total: sum(invoices.total) })
      .from(invoices)
      .where(eq(invoices.companyId, companyId))
      .then((r: { cnt: number; total: string | null }[]) => r[0]),

    // Outstanding AR: sum of totals for sent/partial invoices
    db
      .select({ ar: sum(invoices.total) })
      .from(invoices)
      .where(
        and(
          eq(invoices.companyId, companyId),
          or(eq(invoices.status, 'sent'), eq(invoices.status, 'partial'))
        )
      )
      .then((r: { ar: string | null }[]) => r[0]),

    // Last receipt uploaded
    db
      .select({ lastDate: max(receipts.createdAt) })
      .from(receipts)
      .where(eq(receipts.companyId, companyId))
      .then((r: { lastDate: Date | null }[]) => r[0]),

    // Last bank transaction (proxy for last reconciliation activity)
    db
      .select({ lastDate: max(bankTransactions.transactionDate) })
      .from(bankTransactions)
      .where(eq(bankTransactions.companyId, companyId))
      .then((r: { lastDate: Date | null }[]) => r[0]),

    // Latest VAT return
    db
      .select({
        status: vatReturns.status,
        dueDate: vatReturns.dueDate,
        periodEnd: vatReturns.periodEnd,
      })
      .from(vatReturns)
      .where(eq(vatReturns.companyId, companyId))
      .orderBy(desc(vatReturns.periodEnd))
      .limit(1)
      .then((r: { status: string; dueDate: Date; periodEnd: Date }[]) => r[0] || null),

    // Assigned staff: users linked to this company who are admins
    db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        role: companyUsers.role,
      })
      .from(companyUsers)
      .innerJoin(users, eq(users.id, companyUsers.userId))
      .where(and(eq(companyUsers.companyId, companyId), eq(users.isAdmin, true))),
  ]);

  return {
    invoiceCount: Number(invoiceStats?.cnt ?? 0),
    invoiceTotal: Number(invoiceStats?.total ?? 0),
    outstandingAr: Number(arStats?.ar ?? 0),
    lastReceiptDate: lastReceipt?.lastDate ?? null,
    lastBankActivityDate: lastBankTx?.lastDate ?? null,
    vatStatus: latestVatReturn
      ? {
          status: latestVatReturn.status,
          dueDate: latestVatReturn.dueDate,
          periodEnd: latestVatReturn.periodEnd,
        }
      : null,
    assignedStaff: staffRows,
  };
}

// ─── Route registration ───────────────────────────────────────────────────────

const createClientSchema = z.object({
  name: z.string().min(1),
  trnVatNumber: z.string().optional(),
  legalStructure: z.string().optional(),
  industry: z.string().optional(),
  registrationNumber: z.string().optional(),
  businessAddress: z.string().optional(),
  contactPhone: z.string().optional(),
  contactEmail: z.string().email().optional().or(z.literal('')),
  websiteUrl: z.string().optional(),
  emirate: z.string().optional(),
  vatFilingFrequency: z.string().optional(),
  taxRegistrationType: z.string().optional(),
  corporateTaxId: z.string().optional(),
});

const updateClientSchema = createClientSchema.partial();

const assignStaffSchema = z.object({
  staffUserId: z.string().uuid(),
  action: z.enum(['assign', 'unassign']),
  role: z.string().default('accountant'),
});

export function registerFirmRoutes(app: Express): void {
  const router = Router();

  router.use(authMiddleware as any);
  router.use(requireFirmRole());

  // ─── GET /api/firm/clients ─────────────────────────────────────────────────
  router.get(
    '/firm/clients',
    asyncHandler(async (_req: Request, res: Response) => {
      const clientCompanies = await storage.getClientCompanies();

      const clientsWithStats = await Promise.all(
        clientCompanies.map(async company => {
          const stats = await getClientStats(company.id);
          return { ...company, ...stats };
        })
      );

      res.json(clientsWithStats);
    })
  );

  // ─── GET /api/firm/clients/:companyId/summary ──────────────────────────────
  router.get(
    '/firm/clients/:companyId/summary',
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const company = await storage.getCompany(companyId);

      if (!company) {
        return res.status(404).json({ message: 'Client not found' });
      }
      if (company.companyType !== 'client') {
        return res.status(400).json({ message: 'Company is not an NRA client' });
      }

      const [stats, companyUserList, recentInvoices, recentReceipts] = await Promise.all([
        getClientStats(companyId),
        storage.getCompanyUserWithUser(companyId),
        db
          .select()
          .from(invoices)
          .where(eq(invoices.companyId, companyId))
          .orderBy(desc(invoices.createdAt))
          .limit(10),
        db
          .select()
          .from(receipts)
          .where(eq(receipts.companyId, companyId))
          .orderBy(desc(receipts.createdAt))
          .limit(10),
      ]);

      res.json({
        company,
        stats,
        companyUsers: companyUserList,
        recentInvoices,
        recentReceipts,
      });
    })
  );

  // ─── POST /api/firm/clients ────────────────────────────────────────────────
  router.post(
    '/firm/clients',
    asyncHandler(async (req: Request, res: Response) => {
      const userId = (req as any).user.id;
      const validated = createClientSchema.parse(req.body);

      const existing = await storage.getCompanyByName(validated.name);
      if (existing) {
        return res.status(400).json({ message: 'Company name already exists' });
      }

      const company = await storage.createCompany({
        name: validated.name,
        baseCurrency: 'AED',
        locale: 'en',
        companyType: 'client',
        trnVatNumber: validated.trnVatNumber,
        legalStructure: validated.legalStructure,
        industry: validated.industry,
        registrationNumber: validated.registrationNumber,
        businessAddress: validated.businessAddress,
        contactPhone: validated.contactPhone,
        contactEmail: validated.contactEmail || undefined,
        websiteUrl: validated.websiteUrl,
        emirate: validated.emirate || 'dubai',
        vatFilingFrequency: validated.vatFilingFrequency || 'quarterly',
        taxRegistrationType: validated.taxRegistrationType,
        corporateTaxId: validated.corporateTaxId,
      });

      await seedChartOfAccounts(company.id);

      await storage.createActivityLog({
        userId,
        companyId: company.id,
        action: 'create',
        entityType: 'company',
        entityId: company.id,
        description: `NRA firm created client: ${company.name}`,
      });

      res.status(201).json(company);
    })
  );

  // ─── PUT /api/firm/clients/:companyId ──────────────────────────────────────
  router.put(
    '/firm/clients/:companyId',
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = (req as any).user.id;
      const validated = updateClientSchema.parse(req.body);

      const company = await storage.getCompany(companyId);
      if (!company) {
        return res.status(404).json({ message: 'Client not found' });
      }

      const updated = await storage.updateCompany(companyId, validated as any);

      await storage.createActivityLog({
        userId,
        companyId,
        action: 'update',
        entityType: 'company',
        entityId: companyId,
        description: `NRA firm updated client: ${updated.name}`,
      });

      res.json(updated);
    })
  );

  // ─── POST /api/firm/clients/:companyId/assign-staff ───────────────────────
  router.post(
    '/firm/clients/:companyId/assign-staff',
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const requestingUserId = (req as any).user.id;
      const { staffUserId, action, role } = assignStaffSchema.parse(req.body);

      const company = await storage.getCompany(companyId);
      if (!company) {
        return res.status(404).json({ message: 'Client not found' });
      }

      const staffUser = await storage.getUser(staffUserId);
      if (!staffUser) {
        return res.status(404).json({ message: 'Staff user not found' });
      }
      if (!staffUser.isAdmin) {
        return res.status(400).json({ message: 'User is not a firm staff member' });
      }

      if (action === 'assign') {
        const existing = await storage.getUserRole(companyId, staffUserId);
        if (!existing) {
          await storage.createCompanyUser({
            companyId,
            userId: staffUserId,
            role,
          });
        }
        await storage.createActivityLog({
          userId: requestingUserId,
          companyId,
          action: 'create',
          entityType: 'company_user',
          entityId: staffUserId,
          description: `Assigned ${staffUser.name} to ${company.name}`,
        });
      } else {
        // Unassign: remove from companyUsers
        await db
          .delete(companyUsers)
          .where(
            and(
              eq(companyUsers.companyId, companyId),
              eq(companyUsers.userId, staffUserId)
            )
          );
        await storage.createActivityLog({
          userId: requestingUserId,
          companyId,
          action: 'delete',
          entityType: 'company_user',
          entityId: staffUserId,
          description: `Unassigned ${staffUser.name} from ${company.name}`,
        });
      }

      res.json({ success: true, action, companyId, staffUserId });
    })
  );

  // ─── GET /api/firm/staff ───────────────────────────────────────────────────
  router.get(
    '/firm/staff',
    asyncHandler(async (_req: Request, res: Response) => {
      const allUsers = await storage.getAllUsers();
      const firmStaff = allUsers.filter(u => u.isAdmin);

      const staffWithAssignments = await Promise.all(
        firmStaff.map(async staff => {
          const assignments = await db
            .select({
              companyId: companyUsers.companyId,
              role: companyUsers.role,
              companyName: companies.name,
              companyType: companies.companyType,
            })
            .from(companyUsers)
            .innerJoin(companies, eq(companies.id, companyUsers.companyId))
            .where(
              and(
                eq(companyUsers.userId, staff.id),
                eq(companies.companyType, 'client')
              )
            );

          const { passwordHash: _ph, ...safeStaff } = staff;
          return {
            ...safeStaff,
            assignedClients: assignments,
            assignedClientCount: assignments.length,
          };
        })
      );

      res.json(staffWithAssignments);
    })
  );

  app.use('/api', router);
  logger.info('Firm routes registered at /api/firm/*');
}
