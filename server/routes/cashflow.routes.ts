import type { Express, Request, Response } from 'express';
import { authMiddleware, requireCustomer } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { storage } from '../storage';
import { generateCashFlowForecast, getCashFlowHistory } from '../services/cashflow-forecast.service';

export function registerCashFlowRoutes(app: Express) {
  // =====================================
  // Cash Flow Forecast Routes
  // =====================================

  /**
   * GET /api/companies/:companyId/cashflow/forecast
   * Generate AI-powered cash flow forecast for the next N days.
   * Query params: days (default 90)
   */
  app.get(
    '/api/companies/:companyId/cashflow/forecast',
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = (req as any).user.id;
      const days = Math.min(Math.max(parseInt(req.query.days as string) || 90, 7), 365);

      // Check if user has access to this company
      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: 'Access denied' });
      }

      const forecast = await generateCashFlowForecast(companyId, days);
      res.json(forecast);
    })
  );

  /**
   * GET /api/companies/:companyId/cashflow/history
   * Get actual monthly cash in/out history for the last N months.
   * Query params: months (default 6)
   */
  app.get(
    '/api/companies/:companyId/cashflow/history',
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = (req as any).user.id;
      const months = Math.min(Math.max(parseInt(req.query.months as string) || 6, 1), 24);

      // Check if user has access to this company
      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: 'Access denied' });
      }

      const history = await getCashFlowHistory(companyId, months);
      res.json(history);
    })
  );
}
