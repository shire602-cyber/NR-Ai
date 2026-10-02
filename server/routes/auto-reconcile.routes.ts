import type { Express, Request, Response } from "express";
import { z } from "zod";
import { authMiddleware, requireCompanyAccess, requireCustomer } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { validate } from "../middleware/validate";
import { autoReconcileTransactions, applyReconcileMatches } from "../services/auto-reconcile.service";
import { assertCanPostBanking } from "../services/bank-access";

const uuid = z.string().uuid();
const companyParams = z.object({ companyId: uuid }).passthrough();

const applySchema = z.object({
  matches: z
    .array(
      z.object({
        bankTransactionId: uuid,
        matchedType: z.enum(["journal", "receipt", "invoice", "bill", "journal_entry"]),
        matchedId: uuid,
      })
    )
    .min(1, "No matches provided to apply")
    .max(200),
});

export function registerAutoReconcileRoutes(app: Express) {
  // Suggestions only (nothing is posted). The bank screen's bulk accept uses GET /bank-statements/suggestions.
  app.post(
    "/api/companies/:companyId/auto-reconcile",
    authMiddleware,
    requireCustomer,
    validate({ params: companyParams }),
    requireCompanyAccess("params"),
    asyncHandler(async (req: Request, res: Response) => {
      res.json(await autoReconcileTransactions(req.params.companyId));
    })
  );

  // Applies through bulk-match: the batch is validated as a whole and posts through the document services.
  app.post(
    "/api/companies/:companyId/auto-reconcile/apply",
    authMiddleware,
    requireCustomer,
    validate({ params: companyParams, body: applySchema }),
    requireCompanyAccess("params"),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = req.user!.id;
      await assertCanPostBanking(userId, companyId);
      const result = await applyReconcileMatches(companyId, req.body.matches, userId);
      res.json({
        message: `Successfully reconciled ${result.applied} transaction(s)`,
        applied: result.applied,
        errors: result.errors,
      });
    })
  );
}
