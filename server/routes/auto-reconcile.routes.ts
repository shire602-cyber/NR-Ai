import type { Express, Request, Response } from "express";
import { z } from "zod";
import { authMiddleware, requireCustomer } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { requirePermission } from "../middleware/companyRolePolicy";
import { strictBody } from "../http/strict-body";
import { parsedBody } from "../http/parsed-body";
import { DomainError } from "../errors";
import { storage } from "../storage";
import {
  autoReconcileTransactions,
  applyReconcileMatches,
} from "../services/auto-reconcile.service";
import {
  autoReconcileApplyBody,
  type AutoReconcileApplyBody,
} from "../../shared/validators/banking";

function actor(req: Request): string {
  return (req as Request & { user: { id: string } }).user.id;
}

async function assertAccess(req: Request, companyId: string): Promise<void> {
  if (!(await storage.hasCompanyAccess(actor(req), companyId)))
    throw new DomainError("COMPANY_ACCESS_DENIED", 403, undefined, "Access denied");
}

export function registerAutoReconcileRoutes(app: Express) {
  /**
   * POST /api/companies/:companyId/auto-reconcile
   * Score unreconciled bank lines against cash-side entries, open invoices / bills and receipts.
   * Read-only: returns suggestions with confidence scores.
   */
  app.post(
    "/api/companies/:companyId/auto-reconcile",
    authMiddleware,
    requireCustomer,
    strictBody(z.object({}).strict()),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      await assertAccess(req, companyId);
      res.json(await autoReconcileTransactions(companyId));
    })
  );

  /**
   * POST /api/companies/:companyId/auto-reconcile/apply
   * Apply suggestions through the bank match service (R06-05). Already reconciled lines are
   * skipped (applying twice is a no-op); errors carry codes, never SQL (R06-16).
   */
  app.post(
    "/api/companies/:companyId/auto-reconcile/apply",
    authMiddleware,
    requireCustomer,
    requirePermission("ledger.post"),
    strictBody(autoReconcileApplyBody),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      await assertAccess(req, companyId);
      const body = parsedBody<AutoReconcileApplyBody>(req);
      const result = await applyReconcileMatches(
        companyId,
        body.matches.map((m) => ({
          bankTransactionId: m.bankTransactionId,
          matchedType: m.matchedType,
          matchedId: m.matchedId,
        })),
        actor(req),
        req
      );
      res.json({
        message: `Reconciled ${result.applied} transaction(s)`,
        applied: result.applied,
        skipped: result.skipped,
        errors: result.errors,
        results: result.results,
      });
    })
  );
}
