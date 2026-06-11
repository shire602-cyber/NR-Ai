import type { Express, Request, Response } from "express";
import { authMiddleware, requireCustomer } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { requireFeature } from "../middleware/featureGate";
import { storage } from "../storage";
import { createLogger } from "../config/logger";

const logger = createLogger("reconciliation-rules-routes");

export function registerReconciliationRuleRoutes(app: Express) {
  // =====================================
  // Reconciliation Rules Routes
  // =====================================

  // List all reconciliation rules for a company
  app.get(
    "/api/companies/:companyId/reconciliation-rules",
    authMiddleware,
    requireCustomer,
    requireFeature("bankImport"),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = (req as any).user.id;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      const rules = await storage.getReconciliationRulesByCompanyId(companyId);
      res.json(rules);
    })
  );

  // Create a new reconciliation rule
  app.post(
    "/api/companies/:companyId/reconciliation-rules",
    authMiddleware,
    requireCustomer,
    requireFeature("bankImport"),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = (req as any).user.id;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      const rule = await storage.createReconciliationRule({ ...req.body, companyId });
      logger.info({ ruleId: rule.id, companyId }, "Reconciliation rule created");
      res.status(201).json(rule);
    })
  );

  // Update a reconciliation rule
  app.put(
    "/api/reconciliation-rules/:id",
    authMiddleware,
    requireCustomer,
    requireFeature("bankImport"),
    asyncHandler(async (req: Request, res: Response) => {
      const { id } = req.params;
      const userId = (req as any).user.id;

      const existing = await storage.getReconciliationRule(id);
      if (!existing) {
        return res.status(404).json({ message: "Reconciliation rule not found" });
      }

      const hasAccess = await storage.hasCompanyAccess(userId, existing.companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      const updated = await storage.updateReconciliationRule(id, req.body);
      res.json(updated);
    })
  );

  // Delete a reconciliation rule
  app.delete(
    "/api/reconciliation-rules/:id",
    authMiddleware,
    requireCustomer,
    requireFeature("bankImport"),
    asyncHandler(async (req: Request, res: Response) => {
      const { id } = req.params;
      const userId = (req as any).user.id;

      const existing = await storage.getReconciliationRule(id);
      if (!existing) {
        return res.status(404).json({ message: "Reconciliation rule not found" });
      }

      const hasAccess = await storage.hasCompanyAccess(userId, existing.companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      await storage.deleteReconciliationRule(id);
      res.json({ message: "Reconciliation rule deleted" });
    })
  );

  // Run auto-matching against unreconciled bank transactions
  app.post(
    "/api/companies/:companyId/reconciliation-rules/auto-match",
    authMiddleware,
    requireCustomer,
    requireFeature("bankImport"),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = (req as any).user.id;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      // Get all bank transactions and filter to unreconciled
      const allTransactions = await storage.getBankTransactionsByCompanyId(companyId);
      const unreconciledTransactions = allTransactions.filter((tx) => !tx.isReconciled);

      // Get all active rules ordered by priority
      const allRules = await storage.getReconciliationRulesByCompanyId(companyId);
      const activeRules = allRules.filter((rule) => rule.isActive);

      let matchCount = 0;

      for (const transaction of unreconciledTransactions) {
        for (const rule of activeRules) {
          const fieldValue = getFieldValue(transaction, rule.matchField);
          if (fieldValue === null || fieldValue === undefined) continue;

          const isMatch = testMatch(String(fieldValue), rule.matchType, rule.matchValue);

          if (isMatch) {
            // Update the transaction: set matchedJournalEntryId to the rule's target account and mark reconciled
            await storage.updateBankTransaction(transaction.id, companyId, {
              isReconciled: true,
              category: rule.category || transaction.category,
            });

            // Increment the rule's applied counter
            await storage.incrementRuleAppliedCount(rule.id);

            matchCount++;
            break; // Move to next transaction after first matching rule
          }
        }
      }

      logger.info({ companyId, matchCount }, "Reconciliation auto-match completed");
      res.json({
        matched: matchCount,
        totalUnreconciled: unreconciledTransactions.length,
        rulesEvaluated: activeRules.length,
      });
    })
  );
}

/**
 * Extract the field value from a bank transaction based on the match field name.
 */
function getFieldValue(
  transaction: { description: string; reference: string | null; amount: number },
  matchField: string
): string | number | null {
  switch (matchField) {
    case "description":
      return transaction.description;
    case "reference":
      return transaction.reference;
    case "amount":
      return transaction.amount;
    default:
      return null;
  }
}

/**
 * Test whether a field value matches a rule's match criteria.
 */
function testMatch(fieldValue: string, matchType: string, matchValue: string): boolean {
  const normalizedField = fieldValue.toLowerCase();
  const normalizedMatch = matchValue.toLowerCase();

  switch (matchType) {
    case "contains":
      return normalizedField.includes(normalizedMatch);
    case "exact":
      return normalizedField === normalizedMatch;
    case "starts_with":
      return normalizedField.startsWith(normalizedMatch);
    case "regex":
      try {
        const regex = new RegExp(matchValue, "i");
        return regex.test(fieldValue);
      } catch {
        return false;
      }
    default:
      return false;
  }
}
