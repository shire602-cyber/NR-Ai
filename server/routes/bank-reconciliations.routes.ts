import type { Express, Request, Response } from "express";
import { z } from "zod";
import { authMiddleware, requireCompanyAccess, requireCustomer } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { validate } from "../middleware/validate";
import { assertCanPostBanking } from "../services/bank-access";
import { completeReconciliation, listReconciliations, reopenReconciliation } from "../services/bank-reconciliation.service";
import { recordAudit } from "../services/audit.service";

const uuid = z.string().uuid();
const companyParams = z.object({ companyId: uuid }).passthrough();
const idParams = z.object({ companyId: uuid, id: uuid }).passthrough();

const completeSchema = z.object({
  bankAccountId: uuid,
  statementDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"),
  statementBalance: z.coerce.number().finite(),
});

export function registerBankReconciliationRoutes(app: Express) {
  app.get(
    "/api/companies/:companyId/bank-reconciliations",
    authMiddleware,
    requireCustomer,
    validate({ params: companyParams }),
    requireCompanyAccess("params"),
    asyncHandler(async (req: Request, res: Response) => {
      const bankAccountId = typeof req.query.bankAccountId === "string" && uuid.safeParse(req.query.bankAccountId).success ? req.query.bankAccountId : undefined;
      res.json(await listReconciliations(req.params.companyId, bankAccountId));
    })
  );

  // Complete a statement-vs-ledger session. The difference must be 0; the cleared bank lines are frozen until it is reopened.
  app.post(
    "/api/companies/:companyId/bank-reconciliations",
    authMiddleware,
    requireCustomer,
    validate({ params: companyParams, body: completeSchema }),
    requireCompanyAccess("params"),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = req.user!.id;
      await assertCanPostBanking(userId, companyId);
      const session = await completeReconciliation({ companyId, userId, ...req.body });
      await recordAudit({ userId, companyId, action: "bank.reconciliation_complete", entityType: "bank_reconciliation", entityId: session.id, after: { bankAccountId: req.body.bankAccountId, statementDate: req.body.statementDate, statementBalance: req.body.statementBalance }, req });
      res.status(201).json(session);
    })
  );

  app.post(
    "/api/companies/:companyId/bank-reconciliations/:id/reopen",
    authMiddleware,
    requireCustomer,
    validate({ params: idParams }),
    requireCompanyAccess("params"),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, id } = req.params;
      const userId = req.user!.id;
      await assertCanPostBanking(userId, companyId);
      const session = await reopenReconciliation({ companyId, userId, reconciliationId: id });
      await recordAudit({ userId, companyId, action: "bank.reconciliation_reopen", entityType: "bank_reconciliation", entityId: id, after: { statementDate: session.statementDate }, req });
      res.json(session);
    })
  );
}
