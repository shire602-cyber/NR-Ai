/**
 * VAT Return Autopilot routes (Phase 3).
 *
 * All routes are companyId-scoped through `storage.hasCompanyAccess`. Firm
 * users hit the `/due-dates` endpoint to see deadlines across every client
 * they have access to in a single view.
 */

import type { Express, Request, Response } from 'express';
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
  type VatPeriodStatus,
  type VatPeriod,
} from '../services/vat-autopilot.service';

function userId(req: Request): string {
  return (req as any).user?.id;
}

function parsePeriod(body: any): VatPeriod | undefined {
  if (!body || !body.periodStart || !body.periodEnd) return undefined;
  const start = new Date(body.periodStart);
  const end = new Date(body.periodEnd);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return undefined;
  if (end <= start) return undefined;
  // Due date defaults to FTA-mandated period_end + 28 days, but allow override.
  const due = body.dueDate ? new Date(body.dueDate) : new Date(end.getTime() + 28 * 24 * 60 * 60 * 1000);
  return {
    start,
    end,
    dueDate: due,
    frequency: body.frequency === 'monthly' ? 'monthly' : 'quarterly',
  };
}

export function registerVATAutopilotRoutes(app: Express) {
  // ─── Auto-calculate the current (or specified) period ─────────────────────
  app.get('/api/vat/autopilot/calculate/:companyId', authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const { companyId } = req.params;
    const uid = userId(req);
    const hasAccess = await storage.hasCompanyAccess(uid, companyId);
    if (!hasAccess) return res.status(403).json({ message: 'Access denied' });

    // Optional period override via query string for historical calculations.
    const period = parsePeriod({
      periodStart: req.query.periodStart,
      periodEnd: req.query.periodEnd,
      frequency: req.query.frequency,
    });

    try {
      const calc = await calculateVatReturn(companyId, period);
      // Persist the snapshot so the periods listing reflects it.
      const persist = String(req.query.persist ?? 'true').toLowerCase() !== 'false';
      let periodId: string | null = null;
      if (persist) {
        periodId = await upsertCalculatedPeriod(calc);
      }
      res.json({ ...calc, periodId });
    } catch (err: any) {
      const message = err?.message || 'Failed to calculate VAT return';
      const code = message.includes('TRN') ? 'NO_TRN' : 'CALCULATION_FAILED';
      res.status(400).json({ message, code });
    }
  }));

  // ─── List all periods (with status, calculation snapshot, deadline) ───────
  app.get('/api/vat/autopilot/periods/:companyId', authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const { companyId } = req.params;
    const uid = userId(req);
    const hasAccess = await storage.hasCompanyAccess(uid, companyId);
    if (!hasAccess) return res.status(403).json({ message: 'Access denied' });
    const periods = await listPeriodsForCompany(companyId);
    res.json(periods);
  }));

  // ─── Single period detail (with adjustments) ──────────────────────────────
  app.get('/api/vat/autopilot/periods/:companyId/:periodId', authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const { companyId, periodId } = req.params;
    const uid = userId(req);
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
    const uid = userId(req);
    const { periodId, box, amount, reason, companyId } = req.body || {};
    if (!periodId || !box || typeof amount !== 'number' || !reason || !companyId) {
      return res.status(400).json({
        message: 'periodId, box, amount, reason, and companyId are required',
      });
    }
    const hasAccess = await storage.hasCompanyAccess(uid, companyId);
    if (!hasAccess) return res.status(403).json({ message: 'Access denied' });

    // Verify the period belongs to the claimed company before mutating it.
    const ownership = await pool.query(
      `SELECT company_id FROM vat_return_periods WHERE id = $1`,
      [periodId],
    );
    if (ownership.rows.length === 0 || String(ownership.rows[0].company_id) !== companyId) {
      return res.status(404).json({ message: 'Period not found' });
    }

    try {
      const adjustment = await addAdjustment({
        periodId, box, amount, reason, userId: uid,
      });
      res.status(201).json(adjustment);
    } catch (err: any) {
      res.status(400).json({ message: err?.message || 'Could not add adjustment' });
    }
  }));

  // ─── Update period filing status ──────────────────────────────────────────
  app.patch('/api/vat/autopilot/periods/:periodId/status', authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const uid = userId(req);
    const { periodId } = req.params;
    const { status, companyId, ftaReferenceNumber } = req.body || {};
    const allowed: VatPeriodStatus[] = ['draft', 'ready', 'submitted', 'accepted'];
    if (!allowed.includes(status)) {
      return res.status(400).json({ message: `status must be one of ${allowed.join(', ')}` });
    }
    if (!companyId) return res.status(400).json({ message: 'companyId is required' });
    const hasAccess = await storage.hasCompanyAccess(uid, companyId);
    if (!hasAccess) return res.status(403).json({ message: 'Access denied' });

    const ownership = await pool.query(
      `SELECT company_id FROM vat_return_periods WHERE id = $1`,
      [periodId],
    );
    if (ownership.rows.length === 0 || String(ownership.rows[0].company_id) !== companyId) {
      return res.status(404).json({ message: 'Period not found' });
    }

    try {
      const summary = await updatePeriodStatus({
        periodId,
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
    // Resolve every company the caller can access (firm role widens this set
    // to all assigned clients; ordinary users see only their own companies).
    const companies = await storage.getCompaniesByUserId(uid);
    const accessibleIds = companies.map(c => c.id);
    if (accessibleIds.length === 0) return res.json([]);
    const dueDates = await listDueDates(accessibleIds);
    res.json(dueDates);
  }));
}
