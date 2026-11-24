import type { Express, Request, Response } from "express";
import { parsedBody } from "../http/parsed-body";
import { strictBody } from "../http/strict-body";
import { aiGlCorrectBody } from "../../shared/validators/route-bodies";
import { authMiddleware, requireCustomer } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { storage } from "../storage";
import { AI_QUEUE_STILL_OPEN_SQL } from "../services/ai-gl-queue-sql";
import { pool } from "../db";
import {
  scanAndClassifyTransactions,
  autoPostHighConfidence,
  processUserFeedback,
  getAIGLStats,
} from "../services/autonomous-gl.service";
import { createLogger } from "../config/logger";
import { buildLimiter, limiterProfiles } from "../middleware/rateLimit";
import { aiErrorBody } from "../services/ai/usage-meter";
import { errorCode, errorMessage } from "../errors";
import { describeCategorisationReason } from "../../shared/server-copy";

const log = createLogger("ai-gl-routes");

export function registerAIGLRoutes(app: Express) {
  const aiLimiter = buildLimiter("ai-gl-routes", limiterProfiles.ai);

  // =====================================
  // AI GL Queue — List items
  // =====================================

  /**
   * GET /api/companies/:companyId/ai-gl/queue?status=pending_review
   * List queue items with account names joined.
   */
  app.get(
    "/api/companies/:companyId/ai-gl/queue",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = req.user!.id;
      const status = req.query.status as string | undefined;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ code: "COMPANY_ACCESS_DENIED", message: "Access denied" });
      }

      let query = `
        SELECT
          q.*,
          sa.name_en as suggested_account_name,
          sa.name_ar as suggested_account_name_ar,
          sa.code as suggested_account_code,
          sa.type as suggested_account_type,
          ua.name_en as user_account_name,
          ua.code as user_account_code
        FROM ai_gl_queue q
        LEFT JOIN accounts sa ON sa.id = q.suggested_account_id
        LEFT JOIN accounts ua ON ua.id = q.user_selected_account_id
        WHERE q.company_id = $1
      `;
      const params: unknown[] = [companyId];

      if (status) {
        params.push(status);
        query += ` AND q.status = $${params.length}`;
      }
      // X5 (J1 D6): a suggestion for a bank line already reconciled is not pending review.
      if (status === "pending_review") query += ` AND ${AI_QUEUE_STILL_OPEN_SQL}`;

      query += " ORDER BY q.created_at DESC";

      const { rows } = await pool.query(query, params);
      // `ai_reason` keeps the stored English sentence; `ai_reason_message` is the same sentence as
      // key + params for the rule-matched and operator notes (null for the model's own text).
      res.json(
        rows.map((row: { ai_reason: string | null }) => ({
          ...row,
          ai_reason_message: describeCategorisationReason(row.ai_reason),
        }))
      );
    })
  );

  // =====================================
  // AI GL Queue — Accept suggestion
  // =====================================

  /**
   * POST /api/companies/:companyId/ai-gl/queue/:id/accept
   */
  app.post(
    "/api/companies/:companyId/ai-gl/queue/:id/accept",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, id } = req.params;
      const userId = req.user!.id;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ code: "COMPANY_ACCESS_DENIED", message: "Access denied" });
      }

      const result = await processUserFeedback(id, "accept", userId, undefined, companyId);
      if (!result.success) {
        return res.status(400).json({ code: result.code, message: result.message });
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
    "/api/companies/:companyId/ai-gl/queue/:id/reject",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, id } = req.params;
      const userId = req.user!.id;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ code: "COMPANY_ACCESS_DENIED", message: "Access denied" });
      }

      const result = await processUserFeedback(id, "reject", userId, undefined, companyId);
      if (!result.success) {
        return res.status(400).json({ code: result.code, message: result.message });
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
    "/api/companies/:companyId/ai-gl/queue/:id/correct",
    authMiddleware,
    requireCustomer,
    strictBody(aiGlCorrectBody),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, id } = req.params;
      const userId = req.user!.id;
      const { accountId } = parsedBody<{ accountId: string }>(req);

      if (!accountId) {
        return res
          .status(400)
          .json({ code: "ACCOUNT_ID_REQUIRED", message: "accountId is required" });
      }

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ code: "COMPANY_ACCESS_DENIED", message: "Access denied" });
      }

      const result = await processUserFeedback(id, "correct", userId, accountId, companyId);
      if (!result.success) {
        return res.status(400).json({ code: result.code, message: result.message });
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
    "/api/companies/:companyId/ai-gl/scan",
    authMiddleware,
    aiLimiter,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = req.user!.id;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ code: "COMPANY_ACCESS_DENIED", message: "Access denied" });
      }

      log.info({ companyId, userId }, "Manual AI GL scan triggered");

      // Step 1: Scan and classify
      let scanResult;
      try {
        scanResult = await scanAndClassifyTransactions(companyId);
      } catch (err: unknown) {
        if (errorCode(err) === "AI_QUOTA_EXCEEDED") {
          return res.status(429).json({ message: errorMessage(err), ...aiErrorBody(err) });
        }
        throw err;
      }

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
    "/api/companies/:companyId/ai-gl/stats",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = req.user!.id;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ code: "COMPANY_ACCESS_DENIED", message: "Access denied" });
      }

      const stats = await getAIGLStats(companyId);
      res.json(stats);
    })
  );
}
