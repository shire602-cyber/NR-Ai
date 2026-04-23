import type { Express, Request, Response } from 'express';
import { authMiddleware, requireCustomer } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { storage } from '../storage';
import { detectAnomalies } from '../services/anomaly-detection.service';

const severityMap: Record<string, 'low' | 'medium' | 'high' | 'critical'> = {
  info: 'low',
  warning: 'medium',
  critical: 'critical',
};

const typeMap: Record<string, string> = {
  duplicate_amount: 'duplicate',
  large_transaction: 'unusual_amount',
  weekend_activity: 'unusual_timing',
  round_number: 'unusual_amount',
  duplicate_vendor: 'duplicate',
  expense_spike: 'unusual_amount',
};

export function registerAnomalyRoutes(app: Express) {
  /**
   * GET /api/companies/:companyId/anomalies
   * Run anomaly detection, persist new anomalies, return unresolved ones.
   */
  app.get(
    '/api/companies/:companyId/anomalies',
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = (req as any).user.id;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) return res.status(403).json({ message: 'Access denied' });

      const result = await detectAnomalies(companyId);

      // Persist new anomalies — deduplicate by relatedEntityId + type
      const existing = await storage.getAnomalyAlertsByCompanyId(companyId);
      const existingKeys = new Set(
        existing.map((a) => `${a.type}:${a.relatedEntityId}`)
      );

      for (const anomaly of result.anomalies) {
        const dbType = typeMap[anomaly.type] ?? 'unusual_amount';
        const key = `${dbType}:${anomaly.relatedId}`;
        if (!existingKeys.has(key)) {
          await storage.createAnomalyAlert({
            companyId,
            type: dbType as any,
            severity: severityMap[anomaly.severity] ?? 'medium',
            title: anomaly.type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
            description: anomaly.description,
            relatedEntityType: anomaly.relatedType as any,
            relatedEntityId: anomaly.relatedId,
            aiConfidence: 0.8,
            isResolved: false,
          });
          existingKeys.add(key);
        }
      }

      // Return unresolved alerts from DB
      const unresolved = await storage.getUnresolvedAnomalyAlerts(companyId);

      const summary = {
        total: unresolved.length,
        critical: unresolved.filter((a) => a.severity === 'critical').length,
        warning: unresolved.filter((a) => a.severity === 'medium' || a.severity === 'high').length,
        info: unresolved.filter((a) => a.severity === 'low').length,
      };

      res.json({ anomalies: unresolved, summary, scannedAt: result.scannedAt });
    })
  );

  /**
   * POST /api/companies/:companyId/anomalies/:id/dismiss
   * Resolve (dismiss) an anomaly in the DB.
   */
  app.post(
    '/api/companies/:companyId/anomalies/:id/dismiss',
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, id } = req.params;
      const userId = (req as any).user.id;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) return res.status(403).json({ message: 'Access denied' });

      const alert = await storage.getAnomalyAlertById(id);
      if (!alert || alert.companyId !== companyId) {
        return res.status(404).json({ message: 'Anomaly not found' });
      }

      await storage.resolveAnomalyAlert(id, userId, req.body.note);
      res.json({ message: 'Anomaly dismissed', id });
    })
  );

  /**
   * POST /api/companies/:companyId/anomalies/:id/resolve
   * Alias for dismiss with an optional resolution note.
   */
  app.post(
    '/api/companies/:companyId/anomalies/:id/resolve',
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, id } = req.params;
      const userId = (req as any).user.id;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) return res.status(403).json({ message: 'Access denied' });

      const alert = await storage.getAnomalyAlertById(id);
      if (!alert || alert.companyId !== companyId) {
        return res.status(404).json({ message: 'Anomaly not found' });
      }

      const resolved = await storage.resolveAnomalyAlert(id, userId, req.body.note);
      res.json(resolved);
    })
  );
}
