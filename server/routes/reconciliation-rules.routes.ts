import type { Express, Request, Response } from "express";
import { z } from "zod";
import { authMiddleware, requireCompanyAccess, requireCustomer } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { requireFeature } from "../middleware/featureGate";
import { validate } from "../middleware/validate";
import { db } from "../db";
import { bankTransactions } from "../../shared/schema";
import { and, eq } from "drizzle-orm";
import { storage } from "../storage";
import { AppError } from "../errors";
import { createLogger } from "../config/logger";
import { assertCanPostBanking } from "../services/bank-access";
import { ruleMatches } from "../services/bank-rule-split";
import { ruleColumns, ruleInputSchema, validateRuleBusiness } from "../services/bank-rules.service";

const logger = createLogger("reconciliation-rules-routes");

const uuid = z.string().uuid();
const companyParams = z.object({ companyId: uuid }).passthrough();
const ruleParams = z.object({ id: uuid }).passthrough();

/** Partial update: every field optional, validated as a whole against the merged rule. */
const ruleUpdateSchema = ruleInputSchema.partial();

export function registerReconciliationRuleRoutes(app: Express) {
  const companyGuard = [authMiddleware, requireCustomer, requireFeature("bankImport"), validate({ params: companyParams }), requireCompanyAccess("params")];

  async function loadRule(req: Request) {
    const rule = await storage.getReconciliationRule(req.params.id);
    // a rule of another company is indistinguishable from a missing one
    if (!rule || !(await storage.hasCompanyAccess(req.user!.id, rule.companyId))) {
      throw new AppError({ message: "Reconciliation rule not found", statusCode: 404, code: "RULE_NOT_FOUND" });
    }
    return rule;
  }

  app.get(
    "/api/companies/:companyId/reconciliation-rules",
    ...companyGuard,
    asyncHandler(async (req: Request, res: Response) => {
      res.json(await storage.getReconciliationRulesByCompanyId(req.params.companyId));
    })
  );

  app.post(
    "/api/companies/:companyId/reconciliation-rules",
    ...companyGuard,
    validate({ body: ruleInputSchema }),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      await assertCanPostBanking(req.user!.id, companyId);
      await validateRuleBusiness(companyId, req.body);
      const rule = await storage.createReconciliationRule({ ...ruleColumns(req.body), companyId } as any);
      logger.info({ ruleId: rule.id, companyId }, "Reconciliation rule created");
      res.status(201).json(rule);
    })
  );

  app.put(
    "/api/reconciliation-rules/:id",
    authMiddleware,
    requireCustomer,
    requireFeature("bankImport"),
    validate({ params: ruleParams, body: ruleUpdateSchema }),
    asyncHandler(async (req: Request, res: Response) => {
      const existing = await loadRule(req);
      await assertCanPostBanking(req.user!.id, existing.companyId);
      // merge onto the stored rule so the whole result is validated (split sums, VAT with direction, accounts)
      const merged = ruleInputSchema.parse({
        name: existing.name,
        matchField: existing.matchField,
        matchType: existing.matchType,
        matchValue: existing.matchValue,
        direction: existing.direction,
        bankAccountId: existing.bankAccountId,
        amountMin: existing.amountMin,
        amountMax: existing.amountMax,
        splitLines: existing.splitLines,
        vatRate: Number(existing.vatRate),
        priority: existing.priority,
        isActive: existing.isActive,
        category: existing.category,
        memo: existing.memo,
        ...req.body,
      });
      await validateRuleBusiness(existing.companyId, merged);
      const updated = await storage.updateReconciliationRule(existing.id, ruleColumns(merged) as any);
      res.json(updated);
    })
  );

  app.delete(
    "/api/reconciliation-rules/:id",
    authMiddleware,
    requireCustomer,
    requireFeature("bankImport"),
    validate({ params: ruleParams }),
    asyncHandler(async (req: Request, res: Response) => {
      const existing = await loadRule(req);
      await assertCanPostBanking(req.user!.id, existing.companyId);
      await storage.deleteReconciliationRule(existing.id);
      res.json({ message: "Reconciliation rule deleted" });
    })
  );

  // Suggest only: mark the open bank lines a rule fits as `suggested`. Nothing is posted here.
  // POST /bank-statements/apply-rules (or /:tid/apply-rule) posts, after the preview has been seen.
  app.post(
    "/api/companies/:companyId/reconciliation-rules/auto-match",
    ...companyGuard,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const unreconciled = (await storage.getUnreconciledBankTransactions(companyId)).filter((t) => t.matchStatus !== "matched");
      const rules = (await storage.getReconciliationRulesByCompanyId(companyId)).filter((r) => r.isActive);

      let matched = 0;
      for (const txn of unreconciled) {
        // a category-only rule (no split lines) still suggests and tags; only posting needs the split
        const rule = rules.find((r) => ruleMatches(r as any, { description: txn.description, reference: txn.reference, amount: Number(txn.amount), bankStatementAccountId: txn.bankStatementAccountId }));
        if (!rule) continue;
        await db
          .update(bankTransactions)
          .set({ matchStatus: "suggested", suggestedRuleId: rule.id, category: rule.category ?? txn.category })
          .where(and(eq(bankTransactions.id, txn.id), eq(bankTransactions.companyId, companyId)));
        matched++;
      }
      logger.info({ companyId, matched }, "Reconciliation rule suggestions completed");
      res.json({ matched, suggested: matched, posted: 0, totalUnreconciled: unreconciled.length, rulesEvaluated: rules.length });
    })
  );
}


