import type { Express, Request, Response } from 'express';
import { authMiddleware, requireCustomer } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { storage } from '../storage';
import { autoReconcileTransactions, applyReconcileMatches } from '../services/auto-reconcile.service';

export function registerAutoReconcileRoutes(app: Express) {
  // =====================================
  // Auto-Reconciliation Routes
  // =====================================

  /**
   * POST /api/companies/:companyId/auto-reconcile
   * Run AI auto-reconciliation on unreconciled bank transactions.
   * Returns suggested matches with confidence scores.
   */
  app.post(
    '/api/companies/:companyId/auto-reconcile',
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

      const result = await autoReconcileTransactions(companyId);
      res.json(result);
    })
  );

  /**
   * POST /api/companies/:companyId/auto-reconcile/apply
   * Apply suggested matches — reconcile bank transactions with matched records.
   * Body: { matches: [{ bankTransactionId, matchedType, matchedId }] }
   */
  app.post(
    '/api/companies/:companyId/auto-reconcile/apply',
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = (req as any).user.id;
      const { matches } = req.body;

      // Check if user has access to this company
      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: 'Access denied' });
      }

      if (!matches || !Array.isArray(matches) || matches.length === 0) {
        return res.status(400).json({ message: 'No matches provided to apply' });
      }

      // Validate each match has required fields
      for (const match of matches) {
        if (!match.bankTransactionId || !match.matchedType || !match.matchedId) {
          return res.status(400).json({
            message: 'Each match must have bankTransactionId, matchedType, and matchedId',
          });
        }
        if (!['journal', 'receipt', 'invoice', 'journal_entry'].includes(match.matchedType)) {
          return res.status(400).json({
            message: `Invalid matchedType: ${match.matchedType}. Must be journal, receipt, or invoice.`,
          });
        }
      }

      // Normalize matchedType for the storage layer
      const normalizedMatches = matches.map((m: any) => ({
        ...m,
        matchedType: m.matchedType === 'journal_entry' ? 'journal' : m.matchedType,
      }));

      const result = await applyReconcileMatches(companyId, normalizedMatches);
      res.json({
        message: `Successfully reconciled ${result.applied} transaction(s)`,
        applied: result.applied,
        errors: result.errors,
      });
    })
  );
}
