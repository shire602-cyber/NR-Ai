import type { Express, Request, Response } from 'express';
import { authMiddleware, requireCustomer } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { storage } from '../storage';
import {
  getCloseChecklist,
  generateClosingEntries,
  lockPeriod,
  aiValidation,
  getCloseHistory,
} from '../services/month-end.service';

/**
 * Derive periodStart and periodEnd from a YYYY-MM query parameter.
 */
function parsePeriod(period: string): { periodStart: string; periodEnd: string } {
  const [year, month] = period.split('-').map(Number);
  if (!year || !month || month < 1 || month > 12) {
    throw new Error('Invalid period format. Use YYYY-MM.');
  }
  const periodStart = `${year}-${String(month).padStart(2, '0')}-01`;
  // Last day of the month
  const lastDay = new Date(year, month, 0).getDate();
  const periodEnd = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  return { periodStart, periodEnd };
}

export function registerMonthEndRoutes(app: Express) {
  // =====================================
  // Month-End Close Routes
  // =====================================

  /**
   * GET /api/companies/:companyId/month-end/checklist?period=YYYY-MM
   * Returns the 7-item close checklist with completion status.
   */
  app.get(
    '/api/companies/:companyId/month-end/checklist',
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = req.user!.id;
      const period = req.query.period as string;

      if (!period || !/^\d{4}-\d{2}$/.test(period)) {
        return res.status(400).json({ message: 'period query parameter required (YYYY-MM)' });
      }

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: 'Access denied' });
      }

      const { periodStart, periodEnd } = parsePeriod(period);
      const checklist = await getCloseChecklist(companyId, periodStart, periodEnd);
      res.json({ period, periodStart, periodEnd, checklist });
    })
  );

  /**
   * POST /api/companies/:companyId/month-end/generate-closing-entries
   * Generate and post closing journal entries for the period.
   * Body: { periodStart: string, periodEnd: string }
   */
  app.post(
    '/api/companies/:companyId/month-end/generate-closing-entries',
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = req.user!.id;
      const { periodStart, periodEnd } = req.body;

      if (!periodStart || !periodEnd) {
        return res.status(400).json({ message: 'periodStart and periodEnd are required' });
      }

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: 'Access denied' });
      }

      const entry = await generateClosingEntries(companyId, periodStart, periodEnd, userId);
      res.json(entry);
    })
  );

  /**
   * POST /api/companies/:companyId/month-end/lock-period
   * Lock the period to prevent further modifications.
   * Body: { periodEnd: string }
   */
  app.post(
    '/api/companies/:companyId/month-end/lock-period',
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = req.user!.id;
      const { periodEnd } = req.body;

      if (!periodEnd) {
        return res.status(400).json({ message: 'periodEnd is required' });
      }

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: 'Access denied' });
      }

      const record = await lockPeriod(companyId, periodEnd, userId);

      const { recordAudit } = await import('../services/audit.service');
      await recordAudit({
        userId,
        companyId,
        action: 'period.lock',
        entityType: 'period',
        entityId: periodEnd,
        before: null,
        after: { periodEnd, lockedBy: userId },
        req,
      });

      res.json(record);
    })
  );

  /**
   * GET /api/companies/:companyId/month-end/ai-validation?period=YYYY-MM
   * AI-powered readiness check for month-end close.
   */
  app.get(
    '/api/companies/:companyId/month-end/ai-validation',
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = req.user!.id;
      const period = req.query.period as string;

      if (!period || !/^\d{4}-\d{2}$/.test(period)) {
        return res.status(400).json({ message: 'period query parameter required (YYYY-MM)' });
      }

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: 'Access denied' });
      }

      const { periodStart, periodEnd } = parsePeriod(period);
      const validation = await aiValidation(companyId, periodStart, periodEnd);
      res.json({ period, ...validation });
    })
  );

  /**
   * GET /api/companies/:companyId/month-end/history
   * List all month_end_close records for the company.
   */
  app.get(
    '/api/companies/:companyId/month-end/history',
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = req.user!.id;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: 'Access denied' });
      }

      const history = await getCloseHistory(companyId);
      res.json(history);
    })
  );
}
