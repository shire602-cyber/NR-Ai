import type { Request, Response } from 'express';
import { Router } from 'express';
import type { Express } from 'express';
import { z } from 'zod';

import { authMiddleware } from '../middleware/auth';
import { requireFirmRole, getAccessibleCompanyIds } from '../middleware/rbac';
import { asyncHandler } from '../middleware/errorHandler';
import { db } from '../db';
import {
  companies,
  users,
  invoices,
  vatReturns,
  engagements,
  serviceInvoices,
  firmStaffAssignments,
  firmLeads,
  companyUsers,
  receipts,
} from '../../shared/schema';
import {
  eq,
  and,
  count,
  sum,
  max,
  desc,
  inArray,
  isNull,
  gte,
  lt,
  or,
  ne,
  sql,
  notInArray,
} from 'drizzle-orm';
import { createLogger } from '../config/logger';

const logger = createLogger('firm-analytics-routes');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getClientWhereClause(accessibleIds: string[] | null) {
  if (accessibleIds === null) return eq(companies.companyType, 'client');
  if (accessibleIds.length === 0) return sql`false`;
  return and(eq(companies.companyType, 'client'), inArray(companies.id, accessibleIds));
}

// ─── Zod schemas ─────────────────────────────────────────────────────────────

const createLeadSchema = z.object({
  userId: z.string().uuid(),
  companyId: z.string().uuid().optional(),
  stage: z.enum(['prospect', 'contacted', 'interested', 'converted', 'lost']).default('prospect'),
  source: z.enum(['saas_signup', 'referral', 'manual', 'website']).default('manual'),
  notes: z.string().optional(),
  score: z.number().int().min(0).max(100).default(50),
});

const updateLeadSchema = z.object({
  stage: z.enum(['prospect', 'contacted', 'interested', 'converted', 'lost']).optional(),
  source: z.enum(['saas_signup', 'referral', 'manual', 'website']).optional(),
  notes: z.string().nullable().optional(),
  score: z.number().int().min(0).max(100).optional(),
  companyId: z.string().uuid().nullable().optional(),
});

// ─── Route registration ───────────────────────────────────────────────────────

export function registerFirmAnalyticsRoutes(app: Express): void {
  const router = Router();

  // Scope auth + firm-role guards to /firm/* so this router (mounted at /api)
  // does not short-circuit unrelated /api requests like /api/health.
  router.use('/firm', authMiddleware as any);
  router.use('/firm', requireFirmRole());

  // ─── GET /api/firm/analytics/revenue ──────────────────────────────────────
  router.get(
    '/firm/analytics/revenue',
    asyncHandler(async (req: Request, res: Response) => {
      const { id: userId, firmRole } = (req as any).user;
      const accessibleIds = await getAccessibleCompanyIds(userId, firmRole ?? '');
      const whereClause = getClientWhereClause(accessibleIds);

      // Total MRR: sum of active engagement monthly fees
      const mrrRows = await db
        .select({ totalMrr: sum(engagements.monthlyFee) })
        .from(engagements)
        .innerJoin(companies, eq(companies.id, engagements.companyId))
        .where(and(eq(engagements.status, 'active'), whereClause as any));
      const mrrRow = mrrRows[0];

      // Revenue by client (top 10)
      const revenueByClient = await db
        .select({
          companyId: serviceInvoices.companyId,
          companyName: companies.name,
          totalRevenue: sum(serviceInvoices.total),
        })
        .from(serviceInvoices)
        .innerJoin(companies, eq(companies.id, serviceInvoices.companyId))
        .where(and(eq(serviceInvoices.status, 'paid'), whereClause as any))
        .groupBy(serviceInvoices.companyId, companies.name)
        .orderBy(desc(sum(serviceInvoices.total)))
        .limit(10);

      // Total clients
      const clientCountRows = await db
        .select({ cnt: count() })
        .from(companies)
        .where(whereClause as any);
      const clientCount = Number(clientCountRows[0]?.cnt ?? 0);

      const totalRevenue = revenueByClient.reduce(
        (acc: number, r: { totalRevenue: string | null }) => acc + Number(r.totalRevenue ?? 0),
        0
      );
      const avgRevenuePerClient = clientCount > 0 ? totalRevenue / clientCount : 0;

      // Month-over-month growth
      const now = new Date();
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

      const currentMonthRows = await db
        .select({ rev: sum(serviceInvoices.total) })
        .from(serviceInvoices)
        .innerJoin(companies, eq(companies.id, serviceInvoices.companyId))
        .where(
          and(
            eq(serviceInvoices.status, 'paid'),
            gte(serviceInvoices.paidAt, thirtyDaysAgo),
            whereClause as any
          )
        );

      const priorMonthRows = await db
        .select({ rev: sum(serviceInvoices.total) })
        .from(serviceInvoices)
        .innerJoin(companies, eq(companies.id, serviceInvoices.companyId))
        .where(
          and(
            eq(serviceInvoices.status, 'paid'),
            gte(serviceInvoices.paidAt, sixtyDaysAgo),
            lt(serviceInvoices.paidAt, thirtyDaysAgo),
            whereClause as any
          )
        );

      const currentRev = Number(currentMonthRows[0]?.rev ?? 0);
      const priorRev = Number(priorMonthRows[0]?.rev ?? 0);
      const revenueGrowthPercent =
        priorRev > 0 ? Math.round(((currentRev - priorRev) / priorRev) * 100) : 0;

      res.json({
        totalMRR: Number(mrrRow?.totalMrr ?? 0),
        revenueByClient: revenueByClient.map(
          (r: { companyId: string; companyName: string; totalRevenue: string | null }) => ({
            companyId: r.companyId,
            companyName: r.companyName,
            totalRevenue: Number(r.totalRevenue ?? 0),
          })
        ),
        revenueGrowthPercent,
        avgRevenuePerClient: Math.round(avgRevenuePerClient),
      });
    })
  );

  // ─── GET /api/firm/analytics/utilization ─────────────────────────────────
  router.get(
    '/firm/analytics/utilization',
    asyncHandler(async (req: Request, res: Response) => {
      const { id: userId, firmRole } = (req as any).user;
      const accessibleIds = await getAccessibleCompanyIds(userId, firmRole ?? '');

      // Staff count
      const staffRows = await db
        .select({ cnt: count() })
        .from(users)
        .where(or(eq(users.firmRole, 'firm_owner'), eq(users.firmRole, 'firm_admin')));
      const staffCount = Number(staffRows[0]?.cnt ?? 0);

      // Client count
      const whereClause = getClientWhereClause(accessibleIds);
      const clientRows = await db
        .select({ cnt: count() })
        .from(companies)
        .where(whereClause as any);
      const clientCount = Number(clientRows[0]?.cnt ?? 0);

      // Per-admin assignment distribution
      const perAdminCounts = await db
        .select({
          userId: firmStaffAssignments.userId,
          clientCount: count(firmStaffAssignments.companyId),
        })
        .from(firmStaffAssignments)
        .groupBy(firmStaffAssignments.userId);

      const avgClientsPerAdmin =
        perAdminCounts.length > 0
          ? Math.round(
              perAdminCounts.reduce(
                (s: number, r: { clientCount: number }) => s + Number(r.clientCount),
                0
              ) / perAdminCounts.length
            )
          : 0;

      res.json({
        staffCount,
        clientsPerStaff: staffCount > 0 ? Math.round(clientCount / staffCount) : 0,
        avgClientsPerAdmin,
        totalClients: clientCount,
      });
    })
  );

  // ─── GET /api/firm/analytics/client-health-summary ───────────────────────
  router.get(
    '/firm/analytics/client-health-summary',
    asyncHandler(async (req: Request, res: Response) => {
      const { id: userId, firmRole } = (req as any).user;
      const accessibleIds = await getAccessibleCompanyIds(userId, firmRole ?? '');
      const whereClause = getClientWhereClause(accessibleIds);

      const clientList = await db
        .select({ id: companies.id })
        .from(companies)
        .where(whereClause as any);

      const clientIds = clientList.map((c: { id: string }) => c.id);

      if (clientIds.length === 0) {
        return res.json({
          healthDistribution: { healthy: 0, attention: 0, critical: 0 },
          topIssues: [],
        });
      }

      const now = new Date();

      type InvRow = { companyId: string; cnt: number; maxDue: Date | null };
      type VatRow = { companyId: string; cnt: number };

      const overdueInvoices: InvRow[] = await db
        .select({
          companyId: invoices.companyId,
          cnt: count(),
          maxDue: max(invoices.dueDate),
        })
        .from(invoices)
        .where(
          and(
            inArray(invoices.companyId, clientIds),
            or(eq(invoices.status, 'sent'), eq(invoices.status, 'partial')),
            lt(invoices.dueDate, now)
          )
        )
        .groupBy(invoices.companyId) as InvRow[];

      const overdueVat: VatRow[] = await db
        .select({
          companyId: vatReturns.companyId,
          cnt: count(),
        })
        .from(vatReturns)
        .where(
          and(
            inArray(vatReturns.companyId, clientIds),
            ne(vatReturns.status, 'filed'),
            ne(vatReturns.status, 'submitted'),
            lt(vatReturns.dueDate, now)
          )
        )
        .groupBy(vatReturns.companyId) as VatRow[];

      const overdueInvoiceMap = new Map<string, InvRow>(
        overdueInvoices.map((r: InvRow) => [r.companyId, r])
      );
      const overdueVatMap = new Map<string, VatRow>(
        overdueVat.map((r: VatRow) => [r.companyId, r])
      );

      let healthy = 0;
      let attention = 0;
      let critical = 0;

      for (const client of clientList) {
        const invRow = overdueInvoiceMap.get(client.id);
        const vatRow = overdueVatMap.get(client.id);
        const overdueInvCount = Number(invRow?.cnt ?? 0);
        const overdueVatCount = Number(vatRow?.cnt ?? 0);

        if (overdueVatCount > 0 || overdueInvCount >= 2) {
          critical++;
        } else if (overdueInvCount === 1) {
          attention++;
        } else {
          healthy++;
        }
      }

      const topIssues: { type: string; count: number; affectedClients: number }[] = [];

      const totalOverdueInvoiceClients = overdueInvoices.filter(
        (r: InvRow) => Number(r.cnt) > 0
      ).length;
      const totalOverdueVatClients = overdueVat.filter(
        (r: VatRow) => Number(r.cnt) > 0
      ).length;

      if (totalOverdueInvoiceClients > 0) {
        topIssues.push({
          type: 'overdue_invoices',
          count: overdueInvoices.reduce((s: number, r: InvRow) => s + Number(r.cnt), 0),
          affectedClients: totalOverdueInvoiceClients,
        });
      }
      if (totalOverdueVatClients > 0) {
        topIssues.push({
          type: 'overdue_vat',
          count: overdueVat.reduce((s: number, r: VatRow) => s + Number(r.cnt), 0),
          affectedClients: totalOverdueVatClients,
        });
      }

      res.json({
        healthDistribution: { healthy, attention, critical },
        topIssues,
      });
    })
  );

  // ─── GET /api/firm/pipeline ───────────────────────────────────────────────
  router.get(
    '/firm/pipeline',
    asyncHandler(async (_req: Request, res: Response) => {
      const leads = await db
        .select({
          id: firmLeads.id,
          userId: firmLeads.userId,
          companyId: firmLeads.companyId,
          stage: firmLeads.stage,
          source: firmLeads.source,
          notes: firmLeads.notes,
          score: firmLeads.score,
          convertedAt: firmLeads.convertedAt,
          createdAt: firmLeads.createdAt,
          updatedAt: firmLeads.updatedAt,
          userEmail: users.email,
          userName: users.name,
          companyName: companies.name,
        })
        .from(firmLeads)
        .leftJoin(users, eq(users.id, firmLeads.userId))
        .leftJoin(companies, eq(companies.id, firmLeads.companyId))
        .orderBy(desc(firmLeads.updatedAt));

      type LeadRow = (typeof leads)[0];
      const stages = ['prospect', 'contacted', 'interested', 'converted', 'lost'] as const;
      type Stage = typeof stages[number];

      const byStage: Record<Stage, LeadRow[]> = {
        prospect: [],
        contacted: [],
        interested: [],
        converted: [],
        lost: [],
      };
      for (const lead of leads) {
        const s = lead.stage as Stage;
        if (byStage[s]) byStage[s].push(lead);
      }

      const converted = byStage.converted.length;
      const lost = byStage.lost.length;
      const conversionRate =
        converted + lost > 0 ? Math.round((converted / (converted + lost)) * 100) : 0;

      const convertedLeads = leads.filter(
        (l: LeadRow) => l.stage === 'converted' && l.convertedAt
      );
      const avgDaysToConvert =
        convertedLeads.length > 0
          ? Math.round(
              convertedLeads.reduce((s: number, l: LeadRow) => {
                const days =
                  (new Date(l.convertedAt!).getTime() - new Date(l.createdAt).getTime()) /
                  (1000 * 60 * 60 * 24);
                return s + days;
              }, 0) / convertedLeads.length
            )
          : null;

      res.json({
        leads,
        byStage,
        stageCounts: Object.fromEntries(stages.map((s: Stage) => [s, byStage[s].length])),
        conversionRate,
        avgDaysToConvert,
        totalLeads: leads.length,
      });
    })
  );

  // ─── GET /api/firm/pipeline/leads ────────────────────────────────────────
  router.get(
    '/firm/pipeline/leads',
    asyncHandler(async (_req: Request, res: Response) => {
      const leads = await db
        .select({
          id: firmLeads.id,
          userId: firmLeads.userId,
          companyId: firmLeads.companyId,
          stage: firmLeads.stage,
          source: firmLeads.source,
          notes: firmLeads.notes,
          score: firmLeads.score,
          convertedAt: firmLeads.convertedAt,
          createdAt: firmLeads.createdAt,
          updatedAt: firmLeads.updatedAt,
          userEmail: users.email,
          userName: users.name,
          companyName: companies.name,
        })
        .from(firmLeads)
        .leftJoin(users, eq(users.id, firmLeads.userId))
        .leftJoin(companies, eq(companies.id, firmLeads.companyId))
        .orderBy(desc(firmLeads.updatedAt));

      res.json(leads);
    })
  );

  // ─── POST /api/firm/pipeline/leads ───────────────────────────────────────
  router.post(
    '/firm/pipeline/leads',
    asyncHandler(async (req: Request, res: Response) => {
      const parsed = createLeadSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: 'Validation error', errors: parsed.error.errors });
      }

      const [lead] = await db
        .insert(firmLeads)
        .values({
          userId: parsed.data.userId,
          companyId: parsed.data.companyId ?? null,
          stage: parsed.data.stage,
          source: parsed.data.source,
          notes: parsed.data.notes ?? null,
          score: parsed.data.score,
        })
        .returning();

      res.status(201).json(lead);
    })
  );

  // ─── PUT /api/firm/pipeline/leads/:id ────────────────────────────────────
  router.put(
    '/firm/pipeline/leads/:id',
    asyncHandler(async (req: Request, res: Response) => {
      const { id } = req.params;
      const parsed = updateLeadSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: 'Validation error', errors: parsed.error.errors });
      }

      const updateData: Record<string, unknown> = {
        ...parsed.data,
        updatedAt: new Date(),
      };

      if (parsed.data.stage === 'converted') {
        updateData.convertedAt = new Date();
      }

      const [updated] = await db
        .update(firmLeads)
        .set(updateData as Parameters<typeof db.update>[0])
        .where(eq(firmLeads.id, id))
        .returning();

      if (!updated) return res.status(404).json({ message: 'Lead not found' });
      res.json(updated);
    })
  );

  // ─── DELETE /api/firm/pipeline/leads/:id ─────────────────────────────────
  router.delete(
    '/firm/pipeline/leads/:id',
    asyncHandler(async (req: Request, res: Response) => {
      const { id } = req.params;
      const [deleted] = await db
        .delete(firmLeads)
        .where(eq(firmLeads.id, id))
        .returning({ id: firmLeads.id });

      if (!deleted) return res.status(404).json({ message: 'Lead not found' });
      res.json({ message: 'Lead deleted', id: deleted.id });
    })
  );

  // ─── GET /api/firm/pipeline/saas-prospects ───────────────────────────────
  router.get(
    '/firm/pipeline/saas-prospects',
    asyncHandler(async (_req: Request, res: Response) => {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      const existingLeadRows = await db
        .select({ userId: firmLeads.userId })
        .from(firmLeads);
      const existingLeadUserIds = existingLeadRows.map(
        (r: { userId: string }) => r.userId
      );

      const prospects = await db
        .select({
          userId: users.id,
          email: users.email,
          name: users.name,
          lastLogin: users.lastLoginAt,
          createdAt: users.createdAt,
          companyCount: count(companyUsers.companyId),
        })
        .from(users)
        .leftJoin(companyUsers, eq(companyUsers.userId, users.id))
        .where(
          and(
            eq(users.userType, 'customer'),
            isNull(users.firmRole),
            existingLeadUserIds.length > 0
              ? notInArray(users.id, existingLeadUserIds)
              : sql`true`
          )
        )
        .groupBy(
          users.id,
          users.email,
          users.name,
          users.lastLoginAt,
          users.createdAt
        )
        .having(sql`count(${companyUsers.companyId}) >= 1`);

      type ProspectRow = (typeof prospects)[0];

      const enriched = await Promise.all(
        prospects.map(async (p: ProspectRow) => {
          const companyRows = await db
            .select({ id: companyUsers.companyId })
            .from(companyUsers)
            .where(eq(companyUsers.userId, p.userId));
          const companyIds = companyRows.map((r: { id: string }) => r.id);

          let transactionCount = 0;
          let lastActive: Date | null = p.lastLogin ?? p.createdAt;

          if (companyIds.length > 0) {
            const invRows = await db
              .select({ cnt: count() })
              .from(invoices)
              .where(inArray(invoices.companyId, companyIds));

            const recRows = await db
              .select({ cnt: count() })
              .from(receipts)
              .where(inArray(receipts.companyId, companyIds));

            transactionCount =
              Number(invRows[0]?.cnt ?? 0) + Number(recRows[0]?.cnt ?? 0);

            const lastInvRows = await db
              .select({ d: max(invoices.createdAt) })
              .from(invoices)
              .where(inArray(invoices.companyId, companyIds));

            const lastRecRows = await db
              .select({ d: max(receipts.createdAt) })
              .from(receipts)
              .where(inArray(receipts.companyId, companyIds));

            const dates = [lastInvRows[0]?.d, lastRecRows[0]?.d, p.lastLogin].filter(
              (d): d is Date => d instanceof Date
            );
            if (dates.length > 0) {
              lastActive = dates.reduce((a: Date, b: Date) => (a > b ? a : b));
            }
          }

          const isRecentlyActive = lastActive && lastActive >= thirtyDaysAgo;
          if (transactionCount < 30 || !isRecentlyActive) return null;

          const suggestedScore = Math.min(100, Math.round((transactionCount / 200) * 100));

          return {
            userId: p.userId,
            email: p.email,
            name: p.name,
            companyCount: Number(p.companyCount),
            transactionCount,
            lastActive,
            suggestedScore,
          };
        })
      );

      res.json(enriched.filter((p): p is NonNullable<typeof p> => p !== null));
    })
  );

  app.use('/api', router);
  logger.info('Firm analytics routes registered');
}
