import type { Express, Request, Response } from "express";
import { isOwnCompanyOwner } from "../services/year-end.service";
import { authMiddleware, requireCustomer } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { storage } from "../storage";
import {
  getCloseChecklist,
  generateClosingEntries,
  lockPeriod,
  unlockPeriod,
  listLockedPeriods,
  aiValidation,
  getCloseHistory,
  vatItemStatus,
} from "../services/month-end.service";
import { findFiledVatReturnsCoveringMonth } from "../services/vat-filing.service";

/** A reason of at least this many characters is mandatory to unlock a month covered by a filed VAT return. */
const UNLOCK_REASON_MIN_LENGTH = 10;

/**
 * Derive periodStart and periodEnd from a YYYY-MM query parameter.
 */
function parsePeriod(period: string): { periodStart: string; periodEnd: string } {
  const [year, month] = period.split("-").map(Number);
  if (!year || !month || month < 1 || month > 12) {
    throw new Error("Invalid period format. Use YYYY-MM.");
  }
  const periodStart = `${year}-${String(month).padStart(2, "0")}-01`;
  // Last day of the month
  const lastDay = new Date(year, month, 0).getDate();
  const periodEnd = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
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
    "/api/companies/:companyId/month-end/checklist",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = req.user!.id;
      const period = req.query.period as string;

      if (!period || !/^\d{4}-\d{2}$/.test(period)) {
        return res.status(400).json({ message: "period query parameter required (YYYY-MM)" });
      }

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      const { periodStart, periodEnd } = parsePeriod(period);
      const checklist = await getCloseChecklist(companyId, periodStart, periodEnd);
      res.json({ period, periodStart, periodEnd, checklist });
    })
  );

  /**
   * POST /api/companies/:companyId/month-end/generate-closing-entries
   * A month-end close posts NO closing entries (the year-end does, once, for its own year): answers 200 with posted: false.
   * Body: { periodStart: string, periodEnd: string }
   */
  app.post(
    "/api/companies/:companyId/month-end/generate-closing-entries",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = req.user!.id;
      const { periodStart, periodEnd } = req.body;

      if (!periodStart || !periodEnd) {
        return res.status(400).json({ message: "periodStart and periodEnd are required" });
      }

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      // A month close posts no closing entries (month-end.service.ts): nothing can touch a locked period here.
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
    "/api/companies/:companyId/month-end/lock-period",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = req.user!.id;
      const { periodEnd } = req.body;

      if (!periodEnd) {
        return res.status(400).json({ message: "periodEnd is required" });
      }

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      // Locking a month whose VAT return is not prepared yet needs an explicit, written override (audit-logged). Preparing, computing
      // and filing the return never hit the period lock, so the usual order is: prepare the return, then lock.
      const monthStart = `${String(periodEnd).slice(0, 7)}-01`;
      const vat = await vatItemStatus(companyId, monthStart, String(periodEnd));
      const overrideReason = typeof req.body?.overrideReason === "string" ? req.body.overrideReason.trim() : "";
      const overridden = vat.open && req.body?.overrideVatCheck === true;
      if (vat.open && !overridden) {
        return res.status(409).json({
          message: "The VAT return for this period is not prepared yet. Prepare it (a locked month does not stop that), or lock anyway with an override and a reason.",
          code: "VAT_RETURN_OPEN",
          details: { periodEnd, reason: vat.reason },
        });
      }
      if (overridden && overrideReason.length < 10) {
        return res.status(400).json({ message: "A reason of at least 10 characters is required to lock without the VAT return.", code: "VAT_OVERRIDE_REASON_REQUIRED" });
      }

      const record = await lockPeriod(companyId, periodEnd, userId);

      const { recordAudit } = await import("../services/audit.service");
      await recordAudit({
        userId,
        companyId,
        action: "period.lock",
        entityType: "period",
        entityId: periodEnd,
        before: null,
        after: { periodEnd, lockedBy: userId, vatReturnOverride: overridden },
        extra: overridden ? { vatOverrideReason: overrideReason } : undefined,
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
    "/api/companies/:companyId/month-end/ai-validation",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = req.user!.id;
      const period = req.query.period as string;

      if (!period || !/^\d{4}-\d{2}$/.test(period)) {
        return res.status(400).json({ message: "period query parameter required (YYYY-MM)" });
      }

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
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
    "/api/companies/:companyId/month-end/history",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = req.user!.id;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      const history = await getCloseHistory(companyId);
      res.json(history);
    })
  );

  // =====================================
  // Period Lock Routes
  // =====================================

  /**
   * POST /api/period-lock/unlock
   * Unlock a previously-closed period. firm_owner only — unlocking re-opens
   * a closed month for editing and is a sensitive accounting action.
   * Body: { companyId: string, period: string (YYYY-MM), reason?: string }
   * A `reason` is mandatory when the month is covered by a VAT return that was
   * recorded as filed; it is written to the audit log with the filed returns.
   */
  const unlockHandler = async (req: Request, res: Response, source: { companyId?: unknown; period?: unknown; reason?: unknown }) => {
      const userId = req.user!.id;
      const { companyId, period, reason } = source;

      if (!companyId || typeof companyId !== "string") {
        return res.status(400).json({ message: "companyId is required" });
      }
      if (!period || typeof period !== "string" || !/^\d{4}-\d{2}$/.test(period)) {
        return res.status(400).json({ message: "period (YYYY-MM) is required" });
      }

      // firm_owner only — admins also allowed for support, but firm_admin is not
      // sufficient. This mirrors the elevated-permission pattern used for
      // financial-control actions elsewhere.
      // The company's own owner may unlock a company that is not firm-managed, with a stated reason.
      const ownOwner = await isOwnCompanyOwner(userId, companyId);
      if (!req.user!.isAdmin && req.user!.firmRole !== "firm_owner" && !ownOwner) {
        return res.status(403).json({ message: "Only the company owner (or a firm owner for a firm-managed company) can unlock periods" });
      }
      if (ownOwner && !req.user!.isAdmin && req.user!.firmRole !== "firm_owner" && (typeof reason !== "string" || reason.trim().length < UNLOCK_REASON_MIN_LENGTH)) {
        return res.status(400).json({ message: `A reason of at least ${UNLOCK_REASON_MIN_LENGTH} characters is required to unlock a period.`, code: "UNLOCK_REASON_REQUIRED" });
      }

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      const { periodEnd } = parsePeriod(period);

      // Unlocking a month a filed VAT return covers changes the books behind a
      // return that is already with the FTA: it needs a stated reason.
      const filedReturns = await findFiledVatReturnsCoveringMonth(companyId, periodEnd);
      const unlockReason = typeof reason === "string" ? reason.trim() : "";
      if (filedReturns.length > 0 && unlockReason.length < UNLOCK_REASON_MIN_LENGTH) {
        return res.status(400).json({
          message: `This month is covered by a VAT return recorded as filed (FTA reference ${filedReturns[0].referenceNumber}). A reason of at least ${UNLOCK_REASON_MIN_LENGTH} characters is required to unlock it.`,
          code: "UNLOCK_REASON_REQUIRED",
        });
      }

      const record = await unlockPeriod(companyId, periodEnd);
      if (!record) {
        return res.status(404).json({ message: "No locked period found for that month" });
      }

      const { recordAudit } = await import("../services/audit.service");
      await recordAudit({
        userId,
        companyId,
        action: "period.unlock",
        entityType: "period",
        entityId: periodEnd,
        before: { periodEnd, status: "locked" },
        after: { periodEnd, status: "open", unlockedBy: userId },
        extra: { reason: unlockReason || null, filedVatReturns: filedReturns },
        req,
      });

      res.json(record);
  };

  app.post(
    "/api/period-lock/unlock",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => unlockHandler(req, res, req.body ?? {}))
  );

  /**
   * POST /api/companies/:companyId/month-end/unlock-period  (the screen's "Reopen month")
   * The same unlock with the company in the path. Body: { period: "YYYY-MM" | periodEnd: "YYYY-MM-DD", reason }.
   * Only the company's owner (or a firm owner / admin) may reopen a month; the reason (at least 10 characters) is mandatory and
   * is written to the audit log (action period.unlock) together with any filed VAT return the month belongs to.
   */
  app.post(
    "/api/companies/:companyId/month-end/unlock-period",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const body = req.body ?? {};
      const period = typeof body.period === "string" ? body.period : typeof body.periodEnd === "string" ? String(body.periodEnd).slice(0, 7) : undefined;
      const reason = typeof body.reason === "string" ? body.reason : "";
      if (reason.trim().length < UNLOCK_REASON_MIN_LENGTH) {
        return res.status(400).json({ message: `A reason of at least ${UNLOCK_REASON_MIN_LENGTH} characters is required to reopen a month.`, code: "UNLOCK_REASON_REQUIRED" });
      }
      return unlockHandler(req, res, { companyId: req.params.companyId, period, reason });
    })
  );

  /**
   * GET /api/period-lock/list?companyId=...
   * List all currently-locked periods for a company.
   */
  app.get(
    "/api/period-lock/list",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const userId = req.user!.id;
      const companyId = req.query.companyId as string | undefined;

      if (!companyId) {
        return res.status(400).json({ message: "companyId query parameter is required" });
      }

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      const periods = await listLockedPeriods(companyId);
      res.json(periods);
    })
  );
}
