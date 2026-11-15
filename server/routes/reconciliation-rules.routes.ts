import type { Express, Request, Response } from "express";
import { authMiddleware, requireCustomer } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { requireFeature } from "../middleware/featureGate";
import { requirePermission } from "../middleware/companyRolePolicy";
import { strictBody } from "../http/strict-body";
import { parsedBody } from "../http/parsed-body";
import { DomainError } from "../errors";
import { storage } from "../storage";
import { createLogger } from "../config/logger";
import {
  reconciliationRuleCreateBody,
  reconciliationRuleUpdateBody,
  type ReconciliationRuleCreateBody,
  type ReconciliationRuleUpdateBody,
} from "../../shared/validators/banking";
import {
  runReconciliationRules,
  suggestRulesFromHistory,
} from "../services/bank-reconciliation.service";
import { z } from "zod";

const logger = createLogger("reconciliation-rules-routes");

function actor(req: Request): string {
  return (req as Request & { user: { id: string } }).user.id;
}

async function assertAccess(req: Request, companyId: string): Promise<void> {
  if (!(await storage.hasCompanyAccess(actor(req), companyId)))
    throw new DomainError("COMPANY_ACCESS_DENIED", 403, undefined, "Access denied");
}

/** A rule posts to a real, active GL account of the same company (R06-04). */
async function assertRuleAccount(companyId: string, accountId: string): Promise<void> {
  const account = await storage.getAccount(accountId, companyId);
  if (!account) throw new DomainError("ACCOUNT_NOT_FOUND", 404, undefined, "GL account not found");
  if (!account.isActive || account.isArchived)
    throw new DomainError("ACCOUNT_INACTIVE", 422, undefined, "GL account is inactive");
  if (account.type === "asset" && account.subType === "bank")
    throw new DomainError(
      "RULE_ACCOUNT_IS_BANK",
      422,
      undefined,
      "Choose a contra account, not a bank account"
    );
}

/** Another tenant's rule id answers 404 (never 403). */
async function ownedRule(req: Request, id: string) {
  const rule = /^[0-9a-f-]{36}$/i.test(id) ? await storage.getReconciliationRule(id) : undefined;
  if (!rule || !(await storage.hasCompanyAccess(actor(req), rule.companyId)))
    throw new DomainError("RULE_NOT_FOUND", 404, undefined, "Reconciliation rule not found");
  return rule;
}

export function registerReconciliationRuleRoutes(app: Express) {
  app.get(
    "/api/companies/:companyId/reconciliation-rules",
    authMiddleware,
    requireCustomer,
    requireFeature("bankImport"),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      await assertAccess(req, companyId);
      res.json(await storage.getReconciliationRulesByCompanyId(companyId));
    })
  );

  /** Payee memory: rules suggested from lines already coded to the same account (R06-21). */
  app.get(
    "/api/companies/:companyId/reconciliation-rules/suggestions",
    authMiddleware,
    requireCustomer,
    requireFeature("bankImport"),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      await assertAccess(req, companyId);
      res.json(await suggestRulesFromHistory(companyId));
    })
  );

  app.post(
    "/api/companies/:companyId/reconciliation-rules",
    authMiddleware,
    requireCustomer,
    requireFeature("bankImport"),
    strictBody(reconciliationRuleCreateBody),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      await assertAccess(req, companyId);
      const body = parsedBody<ReconciliationRuleCreateBody>(req);
      await assertRuleAccount(companyId, body.accountId);
      const rule = await storage.createReconciliationRule({
        companyId,
        name: body.name,
        matchField: body.matchField ?? "description",
        matchType: body.matchType,
        matchValue: body.matchValue,
        accountId: body.accountId,
        vatTreatment: body.vatTreatment,
        requireReview: body.requireReview ?? false,
        direction: body.direction ?? "any",
        category: body.category ?? null,
        memo: body.memo ?? null,
        priority: body.priority ?? 0,
        isActive: body.isActive ?? true,
        createdBy: actor(req),
      });
      logger.info({ ruleId: rule.id, companyId }, "Reconciliation rule created");
      res.status(201).json(rule);
    })
  );

  app.put(
    "/api/reconciliation-rules/:id",
    authMiddleware,
    requireCustomer,
    requireFeature("bankImport"),
    strictBody(reconciliationRuleUpdateBody),
    asyncHandler(async (req: Request, res: Response) => {
      const existing = await ownedRule(req, req.params.id);
      const body = parsedBody<ReconciliationRuleUpdateBody>(req);
      if (body.accountId) await assertRuleAccount(existing.companyId, body.accountId);
      // A regex value is validated against the effective type.
      const effectiveType = body.matchType ?? existing.matchType;
      if (body.matchValue !== undefined || body.matchType !== undefined) {
        const check = reconciliationRuleUpdateBody.safeParse({
          matchType: effectiveType,
          matchValue: body.matchValue ?? existing.matchValue,
        });
        if (!check.success) throw check.error;
      }
      if ((body.isActive ?? existing.isActive) && !(body.accountId ?? existing.accountId))
        throw new DomainError(
          "RULE_ACCOUNT_REQUIRED",
          422,
          undefined,
          "An active rule needs a GL account"
        );
      const updated = await storage.updateReconciliationRule(existing.id, {
        ...body,
        updatedAt: new Date(),
      } as Parameters<typeof storage.updateReconciliationRule>[1]);
      res.json(updated);
    })
  );

  app.delete(
    "/api/reconciliation-rules/:id",
    authMiddleware,
    requireCustomer,
    requireFeature("bankImport"),
    asyncHandler(async (req: Request, res: Response) => {
      const existing = await ownedRule(req, req.params.id);
      await storage.deleteReconciliationRule(existing.id);
      res.json({ message: "Reconciliation rule deleted" });
    })
  );

  /**
   * Run active rules over unreconciled lines (R06-04): every hit creates a real journal entry
   * (or a draft for review when the rule requires it) through the bank match service.
   */
  app.post(
    "/api/companies/:companyId/reconciliation-rules/auto-match",
    authMiddleware,
    requireCustomer,
    requireFeature("bankImport"),
    requirePermission("ledger.post"),
    strictBody(z.object({}).strict()),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      await assertAccess(req, companyId);
      const result = await runReconciliationRules({ companyId, actorId: actor(req), req });
      logger.info({ companyId, matched: result.matched }, "Reconciliation auto-match completed");
      res.json(result);
    })
  );
}
