/**
 * VAT Return Autopilot routes (Phase 3).
 *
 * All routes are companyId-scoped through `storage.hasCompanyAccess`. Firm
 * users hit the `/due-dates` endpoint to see deadlines across every client
 * they have access to in a single view.
 */

import type { Express, Request, Response } from 'express';
import { z } from 'zod';
import { storage } from '../storage';
import { authMiddleware } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { pool } from '../db';
import {
  calculateVatReturn,
  upsertCalculatedPeriod,
  listPeriodsForCompany,
  addAdjustment,
  updatePeriodStatus,
  listDueDates,
  computeDueDate,
  isValidVat201BoxKey,
  type VatPeriod,
} from '../services/vat-autopilot.service';

function userId(req: Request): string | undefined {
  return (req as any).user?.id;
}

// ─── Zod schemas ─────────────────────────────────────────────────────────────

const isoDate = z.string().refine(
  v => !Number.isNaN(new Date(v).getTime()),
  { message: 'Invalid ISO date' },
);

const calculateQuerySchema = z.object({
  periodStart: isoDate.optional(),
  periodEnd: isoDate.optional(),
  frequency: z.enum(['monthly', 'quarterly']).optional(),
  persist: z.union([z.literal('true'), z.literal('false')]).optional(),
});

// `amount` is bounded to ±1 trillion AED so a malicious or fat-fingered value
// can't blow up downstream numeric columns. NaN/Infinity are rejected by the
// `.finite()` clause.
const adjustmentBodySchema = z.object({
  companyId: z.string().uuid(),
  periodId: z.string().uuid(),
  box: z.string().refine(isValidVat201BoxKey, { message: 'Unknown VAT 201 box key' }),
  amount: z.number().finite().min(-1e12).max(1e12),
  reason: z.string().min(1).max(2000),
});

const statusBodySchema = z.object({
  companyId: z.string().uuid(),
  status: z.enum(['draft', 'ready', 'submitted', 'accepted']),
  ftaReferenceNumber: z.string().min(1).max(100).optional(),
});

const companyIdParamSchema = z.object({ companyId: z.string().uuid() });

function parsePeriod(parsed: z.infer<typeof calculateQuerySchema>): VatPeriod | undefined {
  if (!parsed.periodStart || !parsed.periodEnd) return undefined;
  const start = new Date(parsed.periodStart);
  const end = new Date(parsed.periodEnd);
  if (end <= start) return undefined;
  return {
    start,
    end,
    // FTA-mandated: due 28 days after period end (normalised to UTC midnight
    // by computeDueDate so it matches what the service produces for
    // auto-detected periods). Override is intentionally not accepted from the
    // request body — the deadline is statutory, not user data.
    dueDate: computeDueDate(end),
    frequency: parsed.frequency === 'monthly' ? 'monthly' : 'quarterly',
  };
}

function badRequest(res: Response, err: z.ZodError) {
  return res.status(400).json({
    message: 'Invalid request',
    issues: err.issues.map(i => ({ path: i.path, message: i.message })),
  });
}

/**
 * Map service-thrown errors onto HTTP responses. Known validation failures
 * produce 4xx; anything else (DB outage, code bug) must propagate as 500 so
 * it isn't silently masked as a generic "calculation failed" 400.
 */
function mapCalculationError(err: unknown): { status: number; code: string; message: string } {
  const message = (err as { message?: string })?.message || 'Failed to calculate VAT return';
  if (/TRN/.test(message)) return { status: 400, code: 'NO_TRN', message };
  if (/not found/i.test(message)) return { status: 404, code: 'NOT_FOUND', message };
  return { status: 500, code: 'CALCULATION_FAILED', message };
}

export function registerVATAutopilotRoutes(app: Express) {
  // ─── Auto-calculate the current (or specified) period ─────────────────────
  app.get('/api/vat/autopilot/calculate/:companyId', authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const params = companyIdParamSchema.safeParse(req.params);
    if (!params.success) return badRequest(res, params.error);
    const query = calculateQuerySchema.safeParse(req.query);
    if (!query.success) return badRequest(res, query.error);

    const { companyId } = params.data;
    const uid = userId(req);
    if (!uid) return res.status(401).json({ message: 'Unauthenticated' });
    const hasAccess = await storage.hasCompanyAccess(uid, companyId);
    if (!hasAccess) return res.status(403).json({ message: 'Access denied' });

    // Optional period override via query string for historical calculations.
    const period = parsePeriod(query.data);

    try {
      const calc = await calculateVatReturn(companyId, period);
      // Persist the snapshot so the periods listing reflects it.
      const persist = query.data.persist !== 'false';
      let periodId: string | null = null;
      if (persist) {
        periodId = await upsertCalculatedPeriod(calc);
      }
      res.json({ ...calc, periodId });
    } catch (err) {
      const mapped = mapCalculationError(err);
      res.status(mapped.status).json({ message: mapped.message, code: mapped.code });
    }
  }));

  // ─── List all periods (with status, calculation snapshot, deadline) ───────
  app.get('/api/vat/autopilot/periods/:companyId', authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const params = companyIdParamSchema.safeParse(req.params);
    if (!params.success) return badRequest(res, params.error);

    const { companyId } = params.data;
    const uid = userId(req);
    if (!uid) return res.status(401).json({ message: 'Unauthenticated' });
    const hasAccess = await storage.hasCompanyAccess(uid, companyId);
    if (!hasAccess) return res.status(403).json({ message: 'Access denied' });
    const periods = await listPeriodsForCompany(companyId);
    res.json(periods);
  }));

  // ─── Single period detail (with adjustments) ──────────────────────────────
  app.get('/api/vat/autopilot/periods/:companyId/:periodId', authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const params = z.object({
      companyId: z.string().uuid(),
      periodId: z.string().uuid(),
    }).safeParse(req.params);
    if (!params.success) return badRequest(res, params.error);

    const { companyId, periodId } = params.data;
    const uid = userId(req);
    if (!uid) return res.status(401).json({ message: 'Unauthenticated' });
    const hasAccess = await storage.hasCompanyAccess(uid, companyId);
    if (!hasAccess) return res.status(403).json({ message: 'Access denied' });

    const result = await pool.query(
      `SELECT * FROM vat_return_periods WHERE id = $1 AND company_id = $2`,
      [periodId, companyId],
    );
    if (result.rows.length === 0) return res.status(404).json({ message: 'Period not found' });
    res.json(result.rows[0]);
  }));

  // ─── Add a manual adjustment to a period ──────────────────────────────────
  app.post('/api/vat/autopilot/adjustments', authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const body = adjustmentBodySchema.safeParse(req.body);
    if (!body.success) return badRequest(res, body.error);

    const { companyId, periodId, box, amount, reason } = body.data;
    const uid = userId(req);
    if (!uid) return res.status(401).json({ message: 'Unauthenticated' });
    const hasAccess = await storage.hasCompanyAccess(uid, companyId);
    if (!hasAccess) return res.status(403).json({ message: 'Access denied' });

    // Service-layer also filters by company_id on the UPDATE — that's the
    // authoritative gate. The pre-check here only exists so we can surface a
    // 404 distinct from "period belongs to another tenant" without leaking it.
    try {
      const adjustment = await addAdjustment({
        periodId, companyId, box, amount, reason, userId: uid,
      });
      res.status(201).json(adjustment);
    } catch (err: any) {
      res.status(400).json({ message: err?.message || 'Could not add adjustment' });
    }
  }));

  // ─── Update period filing status ──────────────────────────────────────────
  app.patch('/api/vat/autopilot/periods/:periodId/status', authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const params = z.object({ periodId: z.string().uuid() }).safeParse(req.params);
    if (!params.success) return badRequest(res, params.error);
    const body = statusBodySchema.safeParse(req.body);
    if (!body.success) return badRequest(res, body.error);

    const { periodId } = params.data;
    const { companyId, status, ftaReferenceNumber } = body.data;
    const uid = userId(req);
    if (!uid) return res.status(401).json({ message: 'Unauthenticated' });
    const hasAccess = await storage.hasCompanyAccess(uid, companyId);
    if (!hasAccess) return res.status(403).json({ message: 'Access denied' });

    try {
      const summary = await updatePeriodStatus({
        periodId,
        companyId,
        newStatus: status,
        userId: uid,
        ftaReferenceNumber,
      });
      if (!summary) return res.status(404).json({ message: 'Period not found' });
      res.json(summary);
    } catch (err: any) {
      res.status(400).json({ message: err?.message || 'Could not update status' });
    }
  }));

  // ─── Firm-wide upcoming deadlines ─────────────────────────────────────────
  app.get('/api/vat/autopilot/due-dates', authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const uid = userId(req);
    if (!uid) return res.status(401).json({ message: 'Unauthenticated' });
    // Resolve every company the caller has direct membership in. Firm staff
    // see all assigned clients via the same companyUsers join; ordinary users
    // see only their own companies. Either way the SQL is server-side
    // filtered to the caller — no client-supplied company list is trusted.
    const companies = await storage.getCompaniesByUserId(uid);
    const accessibleIds = companies.map(c => c.id);
    if (accessibleIds.length === 0) return res.json([]);
    const dueDates = await listDueDates(accessibleIds);
    res.json(dueDates);
  }));
}
