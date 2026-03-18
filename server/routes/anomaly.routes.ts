import type { Express, Request, Response } from 'express';
import { authMiddleware, requireCustomer } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { storage } from '../storage';
import { detectAnomalies } from '../services/anomaly-detection.service';

// In-memory dismissed anomaly IDs per company (resets on server restart)
const dismissedAnomalies = new Map<string, Set<string>>();

export function registerAnomalyRoutes(app: Express) {
  // =====================================
  // Anomaly Detection Routes
  // =====================================

  /**
   * GET /api/companies/:companyId/anomalies
   * Run AI anomaly detection and return results.
   * Filters out previously dismissed anomalies.
   */
  app.get(
    '/api/companies/:companyId/anomalies',
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = (req as any).user.id;

      // Check if user has access to this company
      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: 'Access denied' });
      }

      const result = await detectAnomalies(companyId);

      // Filter out dismissed anomalies
      const dismissed = dismissedAnomalies.get(companyId) || new Set();
      const filteredAnomalies = result.anomalies.filter(
        (a) => !dismissed.has(a.id)
      );

      // Recalculate summary after filtering
      const summary = {
        total: filteredAnomalies.length,
        critical: filteredAnomalies.filter((a) => a.severity === 'critical').length,
        warning: filteredAnomalies.filter((a) => a.severity === 'warning').length,
        info: filteredAnomalies.filter((a) => a.severity === 'info').length,
      };

      res.json({
        anomalies: filteredAnomalies,
        summary,
        scannedAt: result.scannedAt,
      });
    })
  );

  /**
   * POST /api/companies/:companyId/anomalies/:id/dismiss
   * Dismiss an anomaly so it no longer appears in future scans.
   */
  app.post(
    '/api/companies/:companyId/anomalies/:id/dismiss',
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, id } = req.params;
      const userId = (req as any).user.id;

      // Check if user has access to this company
      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: 'Access denied' });
      }

      // Add to dismissed set
      if (!dismissedAnomalies.has(companyId)) {
        dismissedAnomalies.set(companyId, new Set());
      }
      dismissedAnomalies.get(companyId)!.add(id);

      res.json({ message: 'Anomaly dismissed', id });
    })
  );
}
