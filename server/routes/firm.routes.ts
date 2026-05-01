import type { Request, Response } from 'express';
import { Router } from 'express';
import type { Express } from 'express';
import { z } from 'zod';

import { storage } from '../storage';
import { authMiddleware } from '../middleware/auth';
import { requireFirmRole, getAccessibleCompanyIds } from '../middleware/rbac';
import { asyncHandler } from '../middleware/errorHandler';
import { createLogger } from '../config/logger';
import { createDefaultAccountsForCompany } from '../defaultChartOfAccounts';
import { mapImportRow, validateImportedClient } from '../services/firm-clients.service';
import { parseSpreadsheetBuffer } from '../utils/spreadsheet';
import { db } from '../db';
import { eq, and, count, sum, max, or, desc, inArray, sql, lt, gte, ne, lte } from 'drizzle-orm';
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

const importPayloadSchema = z.object({
  rows: z.array(z.record(z.any())).min(1).max(500),
});

export function registerFirmRoutes(app: Express): void {
  const router = Router();

  // Scope to /firm prefix so unrelated /api/* paths don't get 403
  router.use('/firm', authMiddleware as any);
  router.use('/firm', requireFirmRole());

  // ─── GET /api/firm/clients ─────────────────────────────────────────────────
  router.get(
    '/firm/clients',
    asyncHandler(async (req: Request, res: Response) => {
      const { id: userId, firmRole } = (req as any).user;
      const accessibleIds = await getAccessibleCompanyIds(userId, firmRole ?? '');

      let clientCompanies: Awaited<ReturnType<typeof storage.getClientCompanies>>;
      if (accessibleIds === null) {
        clientCompanies = await storage.getClientCompanies();
      } else if (accessibleIds.length === 0) {
        clientCompanies = [];
      } else {
        clientCompanies = await db
          .select()
          .from(companies)
          .where(and(eq(companies.companyType, 'client'), inArray(companies.id, accessibleIds)));
      }

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
      const { id: userId, firmRole } = (req as any).user;

      const accessibleIds = await getAccessibleCompanyIds(userId, firmRole ?? '');
      if (accessibleIds !== null && !accessibleIds.includes(companyId)) {
        return res.status(403).json({ message: 'Access denied to this client' });
      }

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
      const { id: userId, firmRole } = (req as any).user;
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

      // Auto-assign firm_admin who created the client so they retain access.
      // firm_owner already has implicit access to all client companies via firmRole.
      if (firmRole === 'firm_admin') {
        await db
          .insert(companyUsers)
          .values({ companyId: company.id, userId, role: 'accountant' })
          .onConflictDoNothing();
      }

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
      const { id: userId, firmRole } = (req as any).user;
      const validated = updateClientSchema.parse(req.body);

      const accessibleIds = await getAccessibleCompanyIds(userId, firmRole ?? '');
      if (accessibleIds !== null && !accessibleIds.includes(companyId)) {
        return res.status(403).json({ message: 'Access denied to this client' });
      }

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
  // Only firm_owner may assign or unassign staff. Without this restriction a
  // firm_admin could call this endpoint with any companyId — there is no
  // per-company access check inside the handler — and self-assign onto an
  // unrelated client (or even a customer-type self-signup company), gaining
  // full read/write access via the company_users → hasCompanyAccess path.
  router.post(
    '/firm/clients/:companyId/assign-staff',
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const requestingUserId = (req as any).user.id;
      const requestingFirmRole = (req as any).user.firmRole as string | null;

      if (requestingFirmRole !== 'firm_owner') {
        return res.status(403).json({ message: 'Only firm owners may assign staff' });
      }

      const { staffUserId, action, role } = assignStaffSchema.parse(req.body);

      const company = await storage.getCompany(companyId);
      if (!company) {
        return res.status(404).json({ message: 'Client not found' });
      }
      if (company.companyType !== 'client' || company.deletedAt) {
        return res.status(400).json({ message: 'Company is not an active NRA client' });
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

  // ─── GET /api/firm/health ─────────────────────────────────────────────────
  router.get(
    '/firm/health',
    asyncHandler(async (req: Request, res: Response) => {
      const { id: userId, firmRole } = (req as any).user;
      const accessibleIds = await getAccessibleCompanyIds(userId, firmRole ?? '');

      let clientList: { id: string; name: string }[];
      if (accessibleIds === null) {
        clientList = await db
          .select({ id: companies.id, name: companies.name })
          .from(companies)
          .where(eq(companies.companyType, 'client'));
      } else if (accessibleIds.length === 0) {
        return res.json([]);
      } else {
        clientList = await db
          .select({ id: companies.id, name: companies.name })
          .from(companies)
          .where(and(eq(companies.companyType, 'client'), inArray(companies.id, accessibleIds)));
      }

      const clientIds = clientList.map((c: { id: string }) => c.id);
      if (clientIds.length === 0) return res.json([]);

      const now = new Date();
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

      // Latest VAT return per company (subquery join)
      const latestVatSub = db
        .select({
          companyId: vatReturns.companyId,
          maxPeriodEnd: max(vatReturns.periodEnd).as('max_period_end'),
        })
        .from(vatReturns)
        .where(inArray(vatReturns.companyId, clientIds))
        .groupBy(vatReturns.companyId)
        .as('latest_vat');

      const vatRows = await db
        .select({
          companyId: vatReturns.companyId,
          status: vatReturns.status,
          dueDate: vatReturns.dueDate,
          periodEnd: vatReturns.periodEnd,
        })
        .from(vatReturns)
        .innerJoin(
          latestVatSub,
          and(
            eq(vatReturns.companyId, latestVatSub.companyId),
            eq(vatReturns.periodEnd, latestVatSub.maxPeriodEnd)
          )
        );

      // AR aging buckets per company (overdue invoices only)
      type ArBucketRow = { companyId: string; days0_30: string | null; days31_60: string | null; days61plus: string | null };
      const arRows: ArBucketRow[] = await db
        .select({
          companyId: invoices.companyId,
          days0_30: sql<string>`sum(case when ${invoices.dueDate} >= ${thirtyDaysAgo} then ${invoices.total} else 0 end)`,
          days31_60: sql<string>`sum(case when ${invoices.dueDate} >= ${sixtyDaysAgo} and ${invoices.dueDate} < ${thirtyDaysAgo} then ${invoices.total} else 0 end)`,
          days61plus: sql<string>`sum(case when ${invoices.dueDate} < ${sixtyDaysAgo} then ${invoices.total} else 0 end)`,
        })
        .from(invoices)
        .where(
          and(
            inArray(invoices.companyId, clientIds),
            or(eq(invoices.status, 'sent'), eq(invoices.status, 'partial')),
            lt(invoices.dueDate, now)
          )
        )
        .groupBy(invoices.companyId) as ArBucketRow[];

      // Bank reconciliation % per company
      type BankRow = { companyId: string; total: number; reconciled: string | null };
      const bankRows: BankRow[] = await db
        .select({
          companyId: bankTransactions.companyId,
          total: count(),
          reconciled: sql<string>`sum(case when ${bankTransactions.isReconciled} then 1 else 0 end)`,
        })
        .from(bankTransactions)
        .where(inArray(bankTransactions.companyId, clientIds))
        .groupBy(bankTransactions.companyId) as BankRow[];

      // Build lookup maps
      type VatRow = { companyId: string; status: string; dueDate: Date; periodEnd: Date };
      const vatMap = new Map<string, VatRow>(vatRows.map((r: VatRow) => [r.companyId, r]));
      const arMap = new Map<string, ArBucketRow>(arRows.map((r: ArBucketRow) => [r.companyId, r]));
      const bankMap = new Map<string, BankRow>(bankRows.map((r: BankRow) => [r.companyId, r]));

      const result = clientList.map((company: { id: string; name: string }) => {
        const vat = vatMap.get(company.id);
        const ar = arMap.get(company.id);
        const bank = bankMap.get(company.id);

        const totalBank = Number(bank?.total ?? 0);
        const reconciledBank = Number(bank?.reconciled ?? 0);

        return {
          companyId: company.id,
          companyName: company.name,
          vatFiling: vat
            ? {
                status: vat.status,
                dueDate: vat.dueDate,
                periodEnd: vat.periodEnd,
                isOverdue:
                  vat.status !== 'filed' &&
                  vat.status !== 'submitted' &&
                  new Date(vat.dueDate) < now,
              }
            : null,
          arAging: {
            days0_30: Number(ar?.days0_30 ?? 0),
            days31_60: Number(ar?.days31_60 ?? 0),
            days61plus: Number(ar?.days61plus ?? 0),
            totalOverdue:
              Number(ar?.days0_30 ?? 0) +
              Number(ar?.days31_60 ?? 0) +
              Number(ar?.days61plus ?? 0),
          },
          bankReconciliationPct:
            totalBank > 0 ? Math.round((reconciledBank / totalBank) * 100) : null,
          trialBalanceStatus: 'unknown',
        };
      });

      res.json(result);
    })
  );

  // ─── GET /api/firm/health/deadlines ──────────────────────────────────────
  router.get(
    '/firm/health/deadlines',
    asyncHandler(async (req: Request, res: Response) => {
      const { id: userId, firmRole } = (req as any).user;
      const accessibleIds = await getAccessibleCompanyIds(userId, firmRole ?? '');

      if (accessibleIds !== null && accessibleIds.length === 0) {
        return res.json([]);
      }

      const now = new Date();
      const ninetyDaysOut = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);

      const whereClause = and(
        ne(vatReturns.status, 'filed'),
        ne(vatReturns.status, 'submitted'),
        lte(vatReturns.dueDate, ninetyDaysOut),
        ...(accessibleIds !== null ? [inArray(vatReturns.companyId, accessibleIds)] : [])
      );

      type DeadlineRow = {
        companyId: string;
        companyName: string;
        vatReturnId: string;
        status: string;
        dueDate: Date;
        periodEnd: Date;
        isOverdue: boolean;
        daysUntilDue: number;
      };

      const rows = await db
        .select({
          companyId: vatReturns.companyId,
          companyName: companies.name,
          vatReturnId: vatReturns.id,
          status: vatReturns.status,
          dueDate: vatReturns.dueDate,
          periodEnd: vatReturns.periodEnd,
        })
        .from(vatReturns)
        .innerJoin(companies, eq(companies.id, vatReturns.companyId))
        .where(whereClause)
        .orderBy(vatReturns.dueDate);

      const deadlines: DeadlineRow[] = rows.map(
        (r: {
          companyId: string;
          companyName: string;
          vatReturnId: string;
          status: string;
          dueDate: Date;
          periodEnd: Date;
        }) => ({
          ...r,
          isOverdue: new Date(r.dueDate) < now,
          daysUntilDue: Math.round(
            (new Date(r.dueDate).getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
          ),
        })
      );

      res.json(deadlines);
    })
  );

  // ─── POST /api/firm/clients/:companyId/switch ──────────────────────────────
  // Switch the firm staff member's active workspace to this client's company.
  // The frontend persists the selection client-side; this endpoint validates
  // access and returns the company so the UI can update immediately.
  router.post(
    '/firm/clients/:companyId/switch',
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const { id: userId, firmRole } = (req as any).user;

      const accessibleIds = await getAccessibleCompanyIds(userId, firmRole ?? '');
      if (accessibleIds !== null && !accessibleIds.includes(companyId)) {
        return res.status(403).json({ message: 'Access denied to this client' });
      }

      const company = await storage.getCompany(companyId);
      if (!company) {
        return res.status(404).json({ message: 'Client not found' });
      }
      if (company.companyType !== 'client') {
        return res.status(400).json({ message: 'Company is not an NRA client' });
      }

      await storage.createActivityLog({
        userId,
        companyId,
        action: 'view',
        entityType: 'company',
        entityId: companyId,
        description: `NRA staff switched into ${company.name}`,
      });

      res.json({ company });
    })
  );

  // ─── DELETE /api/firm/clients/:companyId ───────────────────────────────────
  // Soft-delete a client (FTA 5-year retention rules require we never hard-
  // delete). The company is hidden from listings via deletedAt.
  router.delete(
    '/firm/clients/:companyId',
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const { id: userId, firmRole } = (req as any).user;

      // Only firm_owner may archive a client.
      if (firmRole !== 'firm_owner') {
        return res.status(403).json({ message: 'Only firm owners may archive clients' });
      }

      const company = await storage.getCompany(companyId);
      if (!company) {
        return res.status(404).json({ message: 'Client not found' });
      }
      if (company.companyType !== 'client') {
        return res.status(400).json({ message: 'Company is not an NRA client' });
      }

      await db
        .update(companies)
        .set({ deletedAt: new Date(), isActive: false })
        .where(eq(companies.id, companyId));

      await storage.createActivityLog({
        userId,
        companyId,
        action: 'delete',
        entityType: 'company',
        entityId: companyId,
        description: `NRA firm archived client: ${company.name}`,
      });

      res.json({ success: true, archivedAt: new Date().toISOString() });
    })
  );

  // ─── POST /api/firm/clients/import ─────────────────────────────────────────
  // Bulk-create clients from a parsed CSV/Excel payload. Each row becomes a
  // company entity (companyType=client) plus a seeded chart of accounts. Rows
  // with missing names or duplicate company names are returned as errors so
  // the user can correct and resubmit. Supports two input forms:
  //   - { rows: [{...}, {...}] }      already-parsed JSON rows
  //   - { fileData: <base64 CSV/XLSX> } raw file (server-parsed)
  router.post(
    '/firm/clients/import',
    asyncHandler(async (req: Request, res: Response) => {
      const { id: userId, firmRole } = (req as any).user;

      // firm_admin is allowed to import (their imports are auto-assigned to them);
      // firm_owner can import freely.
      if (firmRole !== 'firm_owner' && firmRole !== 'firm_admin') {
        return res.status(403).json({ message: 'Firm role required' });
      }

      // Accept either pre-parsed rows or a base64-encoded file.
      let rows: Record<string, any>[];
      if (req.body?.fileData) {
        try {
          const buffer = Buffer.from(req.body.fileData, 'base64');
          rows = (await parseSpreadsheetBuffer(buffer, req.body.fileName)).rows;
        } catch (err: any) {
          return res.status(400).json({ message: `Could not parse file: ${err.message}` });
        }
      } else {
        const parsed = importPayloadSchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({ message: 'Invalid payload', errors: parsed.error.errors });
        }
        rows = parsed.data.rows;
      }

      if (!rows || rows.length === 0) {
        return res.status(400).json({ message: 'No rows to import' });
      }
      if (rows.length > 500) {
        return res.status(400).json({ message: 'Imports limited to 500 rows per call' });
      }

      const results = {
        created: [] as { id: string; name: string }[],
        errors: [] as { row: number; name: string; error: string }[],
      };

      for (let i = 0; i < rows.length; i++) {
        const raw = rows[i];
        const mapped = mapImportRow(raw);
        if ('error' in mapped) {
          results.errors.push({ row: i + 1, name: '', error: mapped.error });
          continue;
        }

        const validated = validateImportedClient(mapped);
        if (!validated.ok) {
          results.errors.push({
            row: i + 1,
            name: mapped.name,
            error: validated.error,
          });
          continue;
        }

        try {
          const existing = await storage.getCompanyByName(validated.value.name);
          if (existing) {
            results.errors.push({
              row: i + 1,
              name: validated.value.name,
              error: 'A company with this name already exists',
            });
            continue;
          }

          const company = await storage.createCompany({
            name: validated.value.name,
            baseCurrency: 'AED',
            locale: 'en',
            companyType: 'client',
            trnVatNumber: validated.value.trnVatNumber || undefined,
            industry: validated.value.industry || undefined,
            legalStructure: validated.value.legalStructure || undefined,
            contactEmail: validated.value.contactEmail || undefined,
            contactPhone: validated.value.contactPhone || undefined,
            businessAddress: validated.value.businessAddress || undefined,
            emirate: validated.value.emirate || 'dubai',
            vatFilingFrequency: validated.value.vatFilingFrequency || 'quarterly',
            registrationNumber: validated.value.registrationNumber || undefined,
            websiteUrl: validated.value.websiteUrl || undefined,
          });

          await seedChartOfAccounts(company.id);

          // firm_admin who runs the import becomes auto-assigned so they can
          // continue to manage what they imported.
          if (firmRole === 'firm_admin') {
            await db
              .insert(companyUsers)
              .values({ companyId: company.id, userId, role: 'accountant' })
              .onConflictDoNothing();
          }

          await storage.createActivityLog({
            userId,
            companyId: company.id,
            action: 'create',
            entityType: 'company',
            entityId: company.id,
            description: `Bulk-imported NRA client: ${company.name}`,
          });

          results.created.push({ id: company.id, name: company.name });
        } catch (err: any) {
          results.errors.push({
            row: i + 1,
            name: validated.value.name,
            error: err.message ?? 'Unknown error',
          });
        }
      }

      res.json({
        message: `Imported ${results.created.length} clients (${results.errors.length} errors)`,
        ...results,
      });
    })
  );

  // ─── GET /api/firm/overview ────────────────────────────────────────────────
  // Top-level summary cards for the firm dashboard: total clients, VAT
  // returns due in next 30 days, total overdue receivables, attention count.
  router.get(
    '/firm/overview',
    asyncHandler(async (req: Request, res: Response) => {
      const { id: userId, firmRole } = (req as any).user;
      const accessibleIds = await getAccessibleCompanyIds(userId, firmRole ?? '');

      let clientIds: string[];
      if (accessibleIds === null) {
        const all = await db
          .select({ id: companies.id })
          .from(companies)
          .where(and(eq(companies.companyType, 'client'), sql`${companies.deletedAt} IS NULL`));
        clientIds = all.map((c: { id: string }) => c.id);
      } else {
        clientIds = accessibleIds;
      }

      if (clientIds.length === 0) {
        return res.json({
          totalClients: 0,
          vatDueThisMonth: 0,
          overdueAr: 0,
          needsAttention: 0,
          missingDocuments: 0,
        });
      }

      const now = new Date();
      const monthAhead = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

      const [vatDueRow, arRow, missingDocsRow] = await Promise.all([
        db
          .select({ cnt: count() })
          .from(vatReturns)
          .where(
            and(
              inArray(vatReturns.companyId, clientIds),
              ne(vatReturns.status, 'filed'),
              ne(vatReturns.status, 'submitted'),
              lte(vatReturns.dueDate, monthAhead),
            ),
          )
          .then((r: { cnt: number }[]) => r[0]),
        db
          .select({ total: sum(invoices.total) })
          .from(invoices)
          .where(
            and(
              inArray(invoices.companyId, clientIds),
              or(eq(invoices.status, 'sent'), eq(invoices.status, 'partial')),
              lt(invoices.dueDate, now),
            ),
          )
          .then((r: { total: string | null }[]) => r[0]),
        // Clients without ANY invoices yet — proxy for "missing docs"
        db
          .select({ companyId: invoices.companyId })
          .from(invoices)
          .where(inArray(invoices.companyId, clientIds))
          .groupBy(invoices.companyId)
          .then((rows: { companyId: string }[]) => rows.map(r => r.companyId)),
      ]);

      const clientsWithInvoices = new Set(missingDocsRow as string[]);
      const missingDocuments = clientIds.filter(id => !clientsWithInvoices.has(id)).length;

      const overdueAr = Number(arRow?.total ?? 0);
      const vatDueThisMonth = Number(vatDueRow?.cnt ?? 0);

      // "Needs attention" combines overdue VAT + clients with overdue AR
      const overdueArCompanies = await db
        .select({ companyId: invoices.companyId })
        .from(invoices)
        .where(
          and(
            inArray(invoices.companyId, clientIds),
            or(eq(invoices.status, 'sent'), eq(invoices.status, 'partial')),
            lt(invoices.dueDate, now),
          ),
        )
        .groupBy(invoices.companyId);

      const overdueVatCompanies = await db
        .select({ companyId: vatReturns.companyId })
        .from(vatReturns)
        .where(
          and(
            inArray(vatReturns.companyId, clientIds),
            ne(vatReturns.status, 'filed'),
            ne(vatReturns.status, 'submitted'),
            lt(vatReturns.dueDate, now),
          ),
        )
        .groupBy(vatReturns.companyId);

      const attention = new Set<string>();
      for (const r of overdueArCompanies as { companyId: string }[]) attention.add(r.companyId);
      for (const r of overdueVatCompanies as { companyId: string }[]) attention.add(r.companyId);

      res.json({
        totalClients: clientIds.length,
        vatDueThisMonth,
        overdueAr,
        needsAttention: attention.size,
        missingDocuments,
      });
    })
  );

  app.use('/api', router);
  logger.info('Firm routes registered at /api/firm/*');
}
