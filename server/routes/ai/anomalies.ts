// AI anomaly handlers: detect anomalies, list and resolve anomaly alerts.
// Handlers moved from ai.routes.ts (R20-09); the route registrations (paths and
// middleware order) stay in ai.routes.ts.
import { DATA_BLOCK_INSTRUCTION, wrapUserData } from "../../services/ai/data-blocks";
import type { Request, Response } from "express";
import { aiErrorBody } from "../../services/ai/usage-meter";
import { errorMessage, errorStatus, errorStatusCode } from "../../errors";
import { resolveModel } from "../../services/ai/model-router";
import { storage } from "../../storage";
import { AiHandlerContext, UUID_RE, log } from "./shared";

/** POST /api/ai/detect-anomalies */
export function handlePostAiDetectAnomalies({ getAI }: Pick<AiHandlerContext, "getAI">) {
  return async (req: Request, res: Response) => {
    try {
      const { companyId } = req.body;
      const userId = req.user!.id;

      if (!companyId) {
        return res.status(400).json({ message: "Company ID required" });
      }

      // Verify company access
      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      const invoices = await storage.getInvoicesByCompanyId(companyId);
      const receipts = await storage.getReceiptsByCompanyId(companyId);
      const _entries = await storage.getJournalEntriesByCompanyId(companyId);

      // Prepare transaction data for analysis
      const transactionData = {
        invoices: invoices.map((i) => ({
          id: i.id,
          type: "invoice",
          customerName: i.customerName,
          amount: i.total,
          date: i.date,
          number: i.number,
        })),
        expenses: receipts.map((r) => ({
          id: r.id,
          type: "receipt",
          merchant: r.merchant,
          amount: r.amount,
          date: r.date,
          category: r.category,
        })),
      };

      const completion = await getAI(req, "advisory").chat.completions.create({
        model: resolveModel("advisory"),
        messages: [
          {
            role: "system",
            content: `You are an AI fraud detection and anomaly detection system for UAE business accounting.

Analyze transactions for:
1. **Duplicates**: Same amount + similar date + same vendor/customer
2. **Unusual amounts**: Transactions significantly higher/lower than typical patterns
3. **Timing anomalies**: Transactions at unusual times or frequencies
4. **Category mismatches**: Expenses that don't match their category
5. **Potential fraud indicators**: Round numbers, weekend transactions, etc.

Respond with JSON:
{
  "anomalies": [
    {
      "type": "duplicate|unusual_amount|timing|category_mismatch|potential_fraud",
      "severity": "low|medium|high|critical",
      "title": "Brief title",
      "description": "Detailed explanation",
      "entityType": "invoice|receipt",
      "entityId": "uuid",
      "duplicateOfId": "uuid if duplicate",
      "confidence": 0.85
    }
  ],
  "summary": {
    "totalAnomalies": 5,
    "criticalCount": 1,
    "potentialDuplicates": 2,
    "unusualTransactions": 2
  }
}

${DATA_BLOCK_INSTRUCTION}`,
          },
          {
            role: "user",
            content: `Analyze these transactions for anomalies:\n${wrapUserData("transactions", JSON.stringify(transactionData, null, 2), 60000)}`,
          },
        ],
        response_format: { type: "json_object" },
        temperature: 0.1,
      });

      const aiResponse = JSON.parse(completion.choices[0].message.content || "{}");

      // Store detected anomalies. AI-returned UUIDs (entityId, duplicateOfId)
      // are NOT trusted: a hallucinated or prompt-injected UUID could reference
      // another tenant's record, producing cross-tenant pollution. We validate
      // each ID belongs to the calling company before persisting; on mismatch
      // we drop the field so the alert remains useful but not poisoned.
      const validateBelongsToCompany = async (
        entityType: string | undefined,
        entityId: string | undefined
      ): Promise<string | undefined> => {
        if (!entityId || typeof entityId !== "string") return undefined;
        if (!UUID_RE.test(entityId)) return undefined;
        try {
          // Storage getters are tenant-scoped: passing companyId means a
          // hit also proves the record belongs to the tenant — no need to
          // re-check r.companyId === companyId.
          if (entityType === "invoice") {
            return (await storage.getInvoice(entityId, companyId)) ? entityId : undefined;
          }
          if (entityType === "receipt") {
            return (await storage.getReceipt(entityId, companyId)) ? entityId : undefined;
          }
          if (entityType === "journal_entry") {
            return (await storage.getJournalEntry(entityId, companyId)) ? entityId : undefined;
          }
        } catch (err) {
          log.warn({ err, entityType, entityId }, "AI anomaly entity validation failed");
          return undefined;
        }
        return undefined;
      };

      for (const anomaly of aiResponse.anomalies || []) {
        const safeRelatedId = await validateBelongsToCompany(anomaly.entityType, anomaly.entityId);
        // duplicateOfId must reference the same entity type as the anomaly
        // (a "duplicate invoice" alert points at another invoice).
        const safeDuplicateId = await validateBelongsToCompany(
          anomaly.entityType,
          anomaly.duplicateOfId
        );

        if (anomaly.entityId && !safeRelatedId) {
          log.warn(
            { companyId, entityType: anomaly.entityType, aiReturnedId: anomaly.entityId },
            "AI returned entityId not owned by tenant — dropping field"
          );
        }
        if (anomaly.duplicateOfId && !safeDuplicateId) {
          log.warn(
            { companyId, entityType: anomaly.entityType, aiReturnedId: anomaly.duplicateOfId },
            "AI returned duplicateOfId not owned by tenant — dropping field"
          );
        }

        await storage.createAnomalyAlert({
          companyId,
          type: anomaly.type,
          severity: anomaly.severity,
          title: anomaly.title,
          description: anomaly.description,
          relatedEntityType: anomaly.entityType,
          relatedEntityId: safeRelatedId,
          duplicateOfId: safeDuplicateId,
          aiConfidence: anomaly.confidence,
        });
      }

      res.json(aiResponse);
    } catch (error: unknown) {
      log.error({ err: error }, "Anomaly detection error");
      res.status(errorStatus(error) || errorStatusCode(error) || 500).json({
        message: errorMessage(error) || "Anomaly detection failed",
        ...aiErrorBody(error),
      });
    }
  };
}

/** GET /api/companies/:companyId/anomaly-alerts */
export const handleGetCompaniesAnomalyAlerts = async (req: Request, res: Response) => {
  try {
    const { companyId } = req.params;
    const { resolved } = req.query;
    const userId = req.user!.id;

    // Verify company access
    const hasAccess = await storage.hasCompanyAccess(userId, companyId);
    if (!hasAccess) {
      return res.status(403).json({ message: "Access denied" });
    }

    let alerts;
    if (resolved === "false") {
      alerts = await storage.getUnresolvedAnomalyAlerts(companyId);
    } else {
      alerts = await storage.getAnomalyAlertsByCompanyId(companyId);
    }

    res.json(alerts);
  } catch (error: unknown) {
    res
      .status(errorStatus(error) || errorStatusCode(error) || 500)
      .json({ message: errorMessage(error), ...aiErrorBody(error) });
  }
};

/** POST /api/anomaly-alerts/:id/resolve */
export const handlePostAnomalyAlertsResolve = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { note } = req.body;
    const userId = req.user!.id;

    // Get alert to verify company access
    const alert = await storage.getAnomalyAlertById(id);
    if (!alert) {
      return res.status(404).json({ message: "Alert not found" });
    }

    const hasAccess = await storage.hasCompanyAccess(userId, alert.companyId);
    if (!hasAccess) {
      return res.status(403).json({ message: "Access denied" });
    }

    const resolvedAlert = await storage.resolveAnomalyAlert(id, userId, note);
    res.json(resolvedAlert);
  } catch (error: unknown) {
    res
      .status(errorStatus(error) || errorStatusCode(error) || 500)
      .json({ message: errorMessage(error), ...aiErrorBody(error) });
  }
};
