/**
 * Phase 6: Firm-Wide Command Center routes.
 *
 * All endpoints sit under /api/firm/command-center/* and require firm staff
 * access. Read endpoints accept firm_owner OR firm_admin (requireFirmAdmin);
 * batch / mutation endpoints require firm_owner specifically (requireFirmOwner).
 */

import type { Express, Request, Response } from 'express';
import { Router } from 'express';
import { z } from 'zod';
import { and, eq, gte, inArray, lt, sql, sum } from 'drizzle-orm';

import { authMiddleware } from '../middleware/auth';
import { requireFirmAdmin, requireFirmOwner } from '../middleware/rbac';
import { asyncHandler } from '../middleware/errorHandler';
import { createLogger } from '../config/logger';
import { db } from '../db';
import { companies, invoices, receipts } from '../../shared/schema';
import {
  buildClientSnapshots,
  buildFirmDashboard,
  calculateHealthScore,
  calculatePeriodComparison,
  fetchPeriodMetric,
  fetchStaffWorkload,
  generateAlertsForClient,
  listFirmAlerts,
  markAlertRead,
  persistAlertCandidates,
  previousPeriodRange,
  rankClients,
  refreshFirmAlerts,
  resolveAccessibleClientIds,
  resolveAlert,
  scopeBatchToAccessible,
  assignStaffToCompany,
  type ClientHealthScore,
  type ClientRankBy,
  type ClientSnapshot,
  type SortDir,
} from '../services/firm-command-center.service';

const logger = createLogger('firm-command-center-routes');

// ─── Schemas ──────────────────────────────────────────────────────────────────

const alertFilterSchema = z.object({
  severity: z.enum(['critical', 'warning', 'info']).optional(),
  isRead: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .optional()
    .transform((v) => (typeof v === 'string' ? v === 'true' : v)),
});

const rankSchema = z.object({
  by: z.enum(['health', 'revenue', 'overdue', 'compliance']).default('health'),
  dir: z.enum(['asc', 'desc']).default('desc'),
});

const periodSchema = z.object({
  granularity: z.enum(['month', 'quarter']).default('month'),
});

const batchCompanyIdsSchema = z.object({
  companyIds: z.array(z.string().uuid()).min(1).max(500),
});

const assignStaffSchema = z.object({
  userId: z.string().uuid(),
  companyId: z.string().uuid(),
  role: z.enum(['accountant', 'reviewer', 'manager']).default('accountant'),
});

// Path-param schemas. Drizzle parameterizes queries, but invalid UUIDs reach
// Postgres and surface as 500s with 22P02. Validate at the edge to return 400.
const uuidParamSchema = z.object({ id: z.string().uuid() });
const companyIdParamSchema = z.object({ companyId: z.string().uuid() });

// ─── Range helpers ────────────────────────────────────────────────────────────

function currentPeriodRange(granularity: 'month' | 'quarter', now: Date = new Date()) {
  if (granularity === 'month') {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    return { start, end };
  }
  const quarter = Math.floor(now.getMonth() / 3);
  const start = new Date(now.getFullYear(), quarter * 3, 1);
  const end = new Date(now.getFullYear(), quarter * 3 + 3, 1);
  return { start, end };
}

// ─── Local helpers ────────────────────────────────────────────────────────────

// Snapshot → health-score input projection. Reused by /clients/health and
// /clients/:companyId/health so the field list stays in sync.
function snapshotToHealthScore(snap: ClientSnapshot): ClientHealthScore {
  return calculateHealthScore({
    companyId: snap.companyId,
    companyName: snap.companyName,
    missingDocuments: snap.missingDocuments,
    overdueBalance: snap.overdueBalance,
    overdueInvoiceCount: snap.overdueInvoiceCount,
    vatStatus: snap.vatStatus,
    vatDueDate: snap.vatDueDate,
    receiptBacklog: snap.receiptBacklog,
    lastActivityAt: snap.lastActivityAt,
    onboardingCompleted: snap.onboardingCompleted,
  });
}

// Resolve the requested companyIds against the caller's accessible set. On
// total denial (none accessible) writes a 403 and returns null so callers can
// early-return; otherwise returns the allowed/rejected split.
async function resolveBatchScope(
  req: Request,
  res: Response,
  requested: string[],
): Promise<{ allowed: string[]; rejected: string[] } | null> {
  const { id: userId, firmRole } = (req as { user?: { id: string; firmRole?: string | null } }).user ?? {};
  if (!userId) {
    res.status(401).json({ message: 'Authentication required' });
    return null;
  }
  const accessible = await resolveAccessibleClientIds(userId, firmRole ?? null);
  const { allowedCompanyIds, rejectedCompanyIds } = scopeBatchToAccessible(requested, accessible);
  if (allowedCompanyIds.length === 0) {
    res.status(403).json({
      message: 'None of the requested companies are accessible',
      rejectedCompanyIds,
    });
    return null;
  }
  return { allowed: allowedCompanyIds, rejected: rejectedCompanyIds };
}

// ─── Registration ─────────────────────────────────────────────────────────────

export function registerFirmCommandCenterRoutes(app: Express): void {
  const router = Router();

  router.use(authMiddleware as any);
  // requireFirmAdmin allows both firm_owner and firm_admin. Specific batch
  // endpoints further narrow down to firm_owner via requireFirmOwner.
  router.use(requireFirmAdmin());

  // ─── GET /dashboard ─────────────────────────────────────────────────────
  router.get(
    '/dashboard',
    asyncHandler(async (req: Request, res: Response) => {
      const { id: userId, firmRole } = (req as any).user;
      const skipCache = req.query.skipCache === 'true';
      const result = await buildFirmDashboard(userId, firmRole ?? null, { skipCache });
      res.json(result);
    })
  );

  // ─── GET /clients/health ────────────────────────────────────────────────
  router.get(
    '/clients/health',
    asyncHandler(async (req: Request, res: Response) => {
      const { id: userId, firmRole } = (req as any).user;
      const { by, dir } = rankSchema.parse({
        by: req.query.by ?? 'health',
        dir: req.query.dir ?? 'desc',
      });

      const companyIds = await resolveAccessibleClientIds(userId, firmRole ?? null);
      if (companyIds.length === 0) {
        // firm_admin with no assigned clients — return empty list instead of
        // running aggregations that hit Postgres with `IN ()` or a placeholder
        // non-UUID value.
        return res.json([]);
      }
      const snapshots = await buildClientSnapshots(companyIds);

      // Per-client revenue + overdue for ranking
      const revenueRows = (await db
        .select({ companyId: invoices.companyId, total: sum(invoices.total) })
        .from(invoices)
        .where(
          and(inArray(invoices.companyId, companyIds), eq(invoices.status, 'paid'))
        )
        .groupBy(invoices.companyId)) as Array<{ companyId: string; total: string | null }>;
      const revenueMap = new Map(revenueRows.map((r) => [r.companyId, Number(r.total ?? 0)]));

      const ranked = snapshots.map((s) => {
        const health = snapshotToHealthScore(s);
        return {
          ...health,
          healthScore: health.score,
          revenue: revenueMap.get(s.companyId) ?? 0,
          overdueBalance: s.overdueBalance,
          // Compliance score = 100 - (vatOverdue penalty + missingDocs penalty).
          // Used for the 'compliance' ranking key.
          complianceScore:
            100 -
            (health.factors.vatOverdue ? 40 : 0) -
            Math.min(health.factors.missingDocuments * 5, 20),
        };
      });

      const sorted = rankClients<typeof ranked[number]>(
        ranked,
        by as ClientRankBy,
        dir as SortDir
      );
      res.json(sorted);
    })
  );

  // ─── GET /clients/:companyId/health ─────────────────────────────────────
  router.get(
    '/clients/:companyId/health',
    asyncHandler(async (req: Request, res: Response) => {
      const { id: userId, firmRole } = (req as any).user;
      const parsed = companyIdParamSchema.safeParse(req.params);
      if (!parsed.success) {
        return res.status(400).json({ message: 'Invalid companyId' });
      }
      const { companyId } = parsed.data;

      const accessible = await resolveAccessibleClientIds(userId, firmRole ?? null);
      if (!accessible.includes(companyId)) {
        return res.status(403).json({ message: 'Access denied to this client' });
      }

      const snapshots = await buildClientSnapshots([companyId]);
      const snap = snapshots[0];
      if (!snap) return res.status(404).json({ message: 'Client not found' });

      const health = snapshotToHealthScore(snap);
      const alerts = generateAlertsForClient(snap);

      res.json({ snapshot: snap, health, alerts });
    })
  );

  // ─── GET /alerts ─────────────────────────────────────────────────────────
  router.get(
    '/alerts',
    asyncHandler(async (req: Request, res: Response) => {
      const { id: userId } = (req as any).user;
      const filters = alertFilterSchema.parse(req.query);
      const alerts = await listFirmAlerts(userId, filters);
      res.json(alerts);
    })
  );

  // ─── POST /alerts/refresh ───────────────────────────────────────────────
  // Recompute alert candidates for accessible clients and persist new ones.
  // Dedupe + insert run inside a transaction with a per-firm advisory lock so
  // concurrent refreshes for the same firm cannot both pass the dedupe check
  // and create duplicate rows.
  router.post(
    '/alerts/refresh',
    requireFirmOwner(),
    asyncHandler(async (req: Request, res: Response) => {
      const { id: userId, firmRole } = (req as any).user;
      const companyIds = await resolveAccessibleClientIds(userId, firmRole ?? null);
      const snapshots = await buildClientSnapshots(companyIds);
      const candidates = snapshots.flatMap((s) => generateAlertsForClient(s));

      const { generated, created } = await refreshFirmAlerts(userId, candidates);
      res.json({ generated, created: created.length, alerts: created });
    })
  );

  // ─── PATCH /alerts/:id/read ─────────────────────────────────────────────
  // Mutates alert state; per project RBAC convention, mutations on firm-wide
  // resources are gated to firm_owner. firm_admin reads alerts but can't toggle
  // read/resolved state.
  router.patch(
    '/alerts/:id/read',
    requireFirmOwner(),
    asyncHandler(async (req: Request, res: Response) => {
      const { id: userId } = (req as any).user;
      const parsed = uuidParamSchema.safeParse(req.params);
      if (!parsed.success) {
        return res.status(400).json({ message: 'Invalid alert id' });
      }
      const updated = await markAlertRead(userId, parsed.data.id);
      if (!updated) return res.status(404).json({ message: 'Alert not found' });
      res.json(updated);
    })
  );

  // ─── PATCH /alerts/:id/resolve ──────────────────────────────────────────
  router.patch(
    '/alerts/:id/resolve',
    requireFirmOwner(),
    asyncHandler(async (req: Request, res: Response) => {
      const { id: userId } = (req as any).user;
      const parsed = uuidParamSchema.safeParse(req.params);
      if (!parsed.success) {
        return res.status(400).json({ message: 'Invalid alert id' });
      }
      const updated = await resolveAlert(userId, parsed.data.id);
      if (!updated) return res.status(404).json({ message: 'Alert not found' });
      res.json(updated);
    })
  );

  // ─── GET /staff/workload ────────────────────────────────────────────────
  router.get(
    '/staff/workload',
    asyncHandler(async (_req: Request, res: Response) => {
      const workload = await fetchStaffWorkload();
      res.json(workload);
    })
  );

  // ─── POST /staff/assign ─────────────────────────────────────────────────
  // The service throws NotFoundError (404) / ValidationError (400) for known
  // failure modes; asyncHandler routes these to the global error handler with
  // the correct status. Unknown DB errors surface as 500 (default), not 400.
  router.post(
    '/staff/assign',
    requireFirmOwner(),
    asyncHandler(async (req: Request, res: Response) => {
      const { userId, companyId, role } = assignStaffSchema.parse(req.body);
      await assignStaffToCompany(userId, companyId, role);
      res.json({ success: true, userId, companyId, role });
    })
  );

  // ─── GET /metrics/comparison ────────────────────────────────────────────
  router.get(
    '/metrics/comparison',
    asyncHandler(async (req: Request, res: Response) => {
      const { id: userId, firmRole } = (req as any).user;
      const { granularity } = periodSchema.parse({
        granularity: req.query.granularity ?? 'month',
      });
      const companyIds = await resolveAccessibleClientIds(userId, firmRole ?? null);
      const currentRange = currentPeriodRange(granularity);
      const previousRange = previousPeriodRange(currentRange);

      const [current, previous] = await Promise.all([
        fetchPeriodMetric(companyIds, currentRange),
        fetchPeriodMetric(companyIds, previousRange),
      ]);

      const comparison = calculatePeriodComparison(currentRange, current, previousRange, previous);
      res.json({ granularity, ...comparison });
    })
  );

  // ─── POST /batch/vat-calculate ──────────────────────────────────────────
  router.post(
    '/batch/vat-calculate',
    requireFirmOwner(),
    asyncHandler(async (req: Request, res: Response) => {
      const { id: userId } = (req as any).user;
      const { companyIds } = batchCompanyIdsSchema.parse(req.body);
      const scope = await resolveBatchScope(req, res, companyIds);
      if (!scope) return;
      const { allowed: allowedCompanyIds, rejected: rejectedCompanyIds } = scope;

      const now = new Date();
      const quarter = Math.floor(now.getMonth() / 3);
      const periodStart = new Date(now.getFullYear(), quarter * 3, 1);
      const periodEnd = new Date(now.getFullYear(), quarter * 3 + 3, 1);

      // Per-client VAT computation (output VAT − input VAT) for the active quarter.
      const salesRows = (await db
        .select({
          companyId: invoices.companyId,
          subtotal: sum(invoices.subtotal),
          vat: sum(invoices.vatAmount),
        })
        .from(invoices)
        .where(
          and(
            inArray(invoices.companyId, allowedCompanyIds),
            eq(invoices.status, 'paid'),
            gte(invoices.createdAt, periodStart),
            lt(invoices.createdAt, periodEnd)
          )
        )
        .groupBy(invoices.companyId)) as Array<{
        companyId: string;
        subtotal: string | null;
        vat: string | null;
      }>;
      const salesMap = new Map(salesRows.map((r) => [r.companyId, r]));

      const purchasesRows = (await db
        .select({
          companyId: receipts.companyId,
          amount: sum(receipts.amount),
          vat: sum(receipts.vatAmount),
        })
        .from(receipts)
        .where(
          and(
            inArray(receipts.companyId, allowedCompanyIds),
            eq(receipts.posted, true),
            gte(receipts.createdAt, periodStart),
            lt(receipts.createdAt, periodEnd)
          )
        )
        .groupBy(receipts.companyId)) as Array<{
        companyId: string;
        amount: string | null;
        vat: string | null;
      }>;
      const purchasesMap = new Map(purchasesRows.map((r) => [r.companyId, r]));

      const companyMeta = (await db
        .select({ id: companies.id, name: companies.name, trn: companies.trnVatNumber })
        .from(companies)
        .where(inArray(companies.id, allowedCompanyIds))) as Array<{
        id: string;
        name: string;
        trn: string | null;
      }>;

      const results = companyMeta.map((c) => {
        const sales = salesMap.get(c.id);
        const purchases = purchasesMap.get(c.id);
        const outputVat = Number(sales?.vat ?? 0);
        const inputVat = Number(purchases?.vat ?? 0);
        return {
          companyId: c.id,
          companyName: c.name,
          trn: c.trn,
          outputVat,
          inputVat,
          netPayable: Math.max(0, outputVat - inputVat),
        };
      });

      logger.info(
        { firmId: userId, count: results.length },
        'Phase 6 batch VAT calc completed'
      );
      res.json({
        period: { start: periodStart, end: periodEnd },
        results,
        rejectedCompanyIds,
      });
    })
  );

  // ─── POST /batch/chase-payments ─────────────────────────────────────────
  router.post(
    '/batch/chase-payments',
    requireFirmOwner(),
    asyncHandler(async (req: Request, res: Response) => {
      const { id: userId } = (req as any).user;
      const { companyIds } = batchCompanyIdsSchema.parse(req.body);
      const scope = await resolveBatchScope(req, res, companyIds);
      if (!scope) return;
      const { allowed: allowedCompanyIds, rejected: rejectedCompanyIds } = scope;

      const now = new Date();
      // Surface overdue invoices for chasing — actual reminder dispatch lives
      // in the existing reminders pipeline (Phase 4).
      const overdueRows = (await db
        .select({
          id: invoices.id,
          companyId: invoices.companyId,
          number: invoices.number,
          customerName: invoices.customerName,
          total: invoices.total,
          dueDate: invoices.dueDate,
          reminderCount: invoices.reminderCount,
        })
        .from(invoices)
        .where(
          and(
            inArray(invoices.companyId, allowedCompanyIds),
            inArray(invoices.status, ['sent', 'partial']),
            lt(invoices.dueDate, now)
          )
        )) as Array<{
        id: string;
        companyId: string;
        number: string;
        customerName: string;
        total: number;
        dueDate: Date | null;
        reminderCount: number;
      }>;

      // Mark each as queued for chase (increment reminderCount + lastReminderSentAt).
      // The actual email/WhatsApp dispatch is handled by the reminders worker.
      if (overdueRows.length > 0) {
        await db
          .update(invoices)
          .set({
            reminderCount: sql`${invoices.reminderCount} + 1`,
            lastReminderSentAt: now,
          })
          .where(
            inArray(
              invoices.id,
              overdueRows.map((r) => r.id)
            )
          );
      }

      logger.info(
        { firmId: userId, count: overdueRows.length },
        'Phase 6 batch payment chase queued'
      );
      res.json({
        chasedInvoiceCount: overdueRows.length,
        invoices: overdueRows,
        rejectedCompanyIds,
      });
    })
  );

  // ─── POST /batch/chase-documents ────────────────────────────────────────
  router.post(
    '/batch/chase-documents',
    requireFirmOwner(),
    asyncHandler(async (req: Request, res: Response) => {
      const { id: userId } = (req as any).user;
      const { companyIds } = batchCompanyIdsSchema.parse(req.body);
      const scope = await resolveBatchScope(req, res, companyIds);
      if (!scope) return;
      const { allowed: allowedCompanyIds, rejected: rejectedCompanyIds } = scope;

      // Phase 6 records the chase intent as info alerts. The Phase 5 chase
      // worker reads these and dispatches reminders to the client portal.
      const candidates = allowedCompanyIds.map((id) => ({
        companyId: id,
        alertType: 'document_missing' as const,
        severity: 'info' as const,
        message: `Document chase requested by firm`,
      }));
      const created = await persistAlertCandidates(userId, candidates);

      logger.info(
        { firmId: userId, count: created.length },
        'Phase 6 batch document chase queued'
      );
      res.json({ chasedClientCount: created.length, rejectedCompanyIds });
    })
  );

  app.use('/api/firm/command-center', router);
  logger.info('Firm command center routes registered at /api/firm/command-center/*');
}
