import type { Express, Request, Response } from 'express';
import { authMiddleware, requireCustomer } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { storage } from '../storage';
import { pool } from '../db';
import {
  scanAndClassifyTransactions,
  autoPostHighConfidence,
  processUserFeedback,
  getAIGLStats,
} from '../services/autonomous-gl.service';
import { createLogger } from '../config/logger';

const log = createLogger('ai-gl-routes');

export function registerAIGLRoutes(app: Express) {
  // =====================================
  // AI GL Queue — List items
  // =====================================

  /**
   * GET /api/companies/:companyId/ai-gl/queue?status=pending_review
   * List queue items with account names joined.
   */
  app.get(
    '/api/companies/:companyId/ai-gl/queue',
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = (req as any).user.id;
      const status = req.query.status as string | undefined;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: 'Access denied' });
      }

      let query = `
        SELECT
          q.*,
          sa.name_en as suggested_account_name,
          sa.code as suggested_account_code,
          sa.type as suggested_account_type,
          ua.name_en as user_account_name,
          ua.code as user_account_code
        FROM ai_gl_queue q
        LEFT JOIN accounts sa ON sa.id = q.suggested_account_id
        LEFT JOIN accounts ua ON ua.id = q.user_selected_account_id
        WHERE q.company_id = $1
      `;
      const params: any[] = [companyId];

      if (status) {
        params.push(status);
        query += ` AND q.status = $${params.length}`;
      }

      query += ' ORDER BY q.created_at DESC';

      const { rows } = await pool.query(query, params);
      res.json(rows);
    })
  );

  // =====================================
  // AI GL Queue — Accept suggestion
  // =====================================

  /**
   * POST /api/companies/:companyId/ai-gl/queue/:id/accept
   */
  app.post(
    '/api/companies/:companyId/ai-gl/queue/:id/accept',
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, id } = req.params;
      const userId = (req as any).user.id;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: 'Access denied' });
      }

      const result = await processUserFeedback(id, 'accept', userId);
      if (!result.success) {
        return res.status(400).json({ message: result.message });
      }

      res.json({ message: result.message });
    })
  );

  // =====================================
  // AI GL Queue — Reject suggestion
  // =====================================

  /**
   * POST /api/companies/:companyId/ai-gl/queue/:id/reject
   */
  app.post(
    '/api/companies/:companyId/ai-gl/queue/:id/reject',
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, id } = req.params;
      const userId = (req as any).user.id;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: 'Access denied' });
      }

      const result = await processUserFeedback(id, 'reject', userId);
      if (!result.success) {
        return res.status(400).json({ message: result.message });
      }

      res.json({ message: result.message });
    })
  );

  // =====================================
  // AI GL Queue — Correct with user's account
  // =====================================

  /**
   * POST /api/companies/:companyId/ai-gl/queue/:id/correct
   * Body: { accountId: string }
   */
  app.post(
    '/api/companies/:companyId/ai-gl/queue/:id/correct',
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, id } = req.params;
      const userId = (req as any).user.id;
      const { accountId } = req.body;

      if (!accountId) {
        return res.status(400).json({ message: 'accountId is required' });
      }

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: 'Access denied' });
      }

      const result = await processUserFeedback(id, 'correct', userId, accountId);
      if (!result.success) {
        return res.status(400).json({ message: result.message });
      }

      res.json({ message: result.message });
    })
  );

  // =====================================
  // AI GL Scan — Manually trigger scanning
  // =====================================

  /**
   * POST /api/companies/:companyId/ai-gl/scan
   * Manually trigger a scan of unreconciled transactions.
   */
  app.post(
    '/api/companies/:companyId/ai-gl/scan',
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = (req as any).user.id;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: 'Access denied' });
      }

      log.info({ companyId, userId }, 'Manual AI GL scan triggered');

      // Step 1: Scan and classify
      const scanResult = await scanAndClassifyTransactions(companyId);

      // Step 2: Auto-post high confidence items
      const postResult = await autoPostHighConfidence(companyId);

      res.json({
        message: `Scanned ${scanResult.scanned} transactions. Classified ${scanResult.classified} (${scanResult.ruleMatched} by rules, ${scanResult.aiClassified} by AI). Drafted ${postResult.posted} for review.`,
        scan: scanResult,
        autoPost: postResult,
      });
    })
  );

  // =====================================
  // AI GL Stats
  // =====================================

  /**
   * GET /api/companies/:companyId/ai-gl/stats
   */
  app.get(
    '/api/companies/:companyId/ai-gl/stats',
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = (req as any).user.id;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: 'Access denied' });
      }

      const stats = await getAIGLStats(companyId);
      res.json(stats);
    })
  );

  // =====================================
  // AI GL Settings — Update confidence threshold
  // =====================================

  /**
   * PUT /api/companies/:companyId/ai-gl/settings
   * Body: { confidenceThreshold: number }
   * Stores in admin_settings table.
   */
  app.put(
    '/api/companies/:companyId/ai-gl/settings',
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = (req as any).user.id;
      const { confidenceThreshold } = req.body;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: 'Access denied' });
      }

      if (
        confidenceThreshold === undefined ||
        confidenceThreshold < 0.5 ||
        confidenceThreshold > 1.0
      ) {
        return res.status(400).json({
          message: 'confidenceThreshold must be between 0.5 and 1.0',
        });
      }

      // Upsert into admin_settings
      await pool.query(
        `INSERT INTO admin_settings (key, value)
         VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET value = $2`,
        [
          `ai_gl_confidence_threshold_${companyId}`,
          String(confidenceThreshold),
        ]
      );

      log.info({ companyId, confidenceThreshold }, 'AI GL confidence threshold updated');
      res.json({
        message: 'Settings updated',
        confidenceThreshold,
      });
    })
  );
}
