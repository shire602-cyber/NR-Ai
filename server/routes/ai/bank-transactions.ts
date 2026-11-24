// AI reconciliation and bank-transaction handlers: reconcile, list, manual entry and statement import.
// Handlers moved from ai.routes.ts (R20-09); the route registrations (paths and
// middleware order) stay in ai.routes.ts.
import { DATA_BLOCK_INSTRUCTION, wrapUserData } from "../../services/ai/data-blocks";
import { DomainError, errorMessage, errorStatus, errorStatusCode } from "../../errors";
import type { Request, Response } from "express";
import { aiErrorBody } from "../../services/ai/usage-meter";
import { aiRowsToParsedRows, importStatementRows } from "../../services/bank-import.service";
import { createHash } from "node:crypto";
import { parsedBody } from "../../http/parsed-body";
import { resolveModel } from "../../services/ai/model-router";
import { storage } from "../../storage";
import { AiHandlerContext, type ManualBankTransactionBody, log } from "./shared";

/** POST /api/ai/reconcile */
export function handlePostAiReconcile({ getAI }: Pick<AiHandlerContext, "getAI">) {
  return async (req: Request, res: Response) => {
    try {
      const { companyId } = req.body;
      const userId = req.user!.id;

      if (!companyId) {
        return res
          .status(400)
          .json({ code: "COMPANY_ID_REQUIRED", message: "Company ID required" });
      }

      // Verify company access
      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ code: "COMPANY_ACCESS_DENIED", message: "Access denied" });
      }

      const bankTransactions = await storage.getUnreconciledBankTransactions(companyId);
      const invoices = await storage.getInvoicesByCompanyId(companyId);
      const receipts = await storage.getReceiptsByCompanyId(companyId);
      const _journalEntries = await storage.getJournalEntriesByCompanyId(companyId);

      if (bankTransactions.length === 0) {
        return res.json({ matches: [], message: "No unreconciled transactions" });
      }

      // Prepare data for AI matching
      const bankData = bankTransactions.map((t) => ({
        id: t.id,
        date: t.transactionDate,
        description: t.description,
        amount: t.amount,
        reference: t.reference,
      }));

      const ledgerData = {
        invoices: invoices
          .filter((i) => i.status === "sent" || i.status === "paid")
          .map((i) => ({
            id: i.id,
            type: "invoice",
            customerName: i.customerName,
            amount: i.total,
            date: i.date,
            number: i.number,
          })),
        expenses: receipts
          .filter((r) => !r.posted)
          .map((r) => ({
            id: r.id,
            type: "receipt",
            merchant: r.merchant,
            amount: r.amount,
            date: r.date,
          })),
      };

      const completion = await getAI(req, "categorize").chat.completions.create({
        model: resolveModel("categorize"),
        messages: [
          {
            role: "system",
            content: `You are an AI bank reconciliation assistant for UAE businesses.

Match bank transactions to ledger records based on:
1. Amount matching (exact or within AED 1 tolerance for fees)
2. Date proximity (within 3 business days)
3. Description/reference matching
4. Customer/vendor name matching

For each match, provide:
- Confidence score (0-1)
- Match reason
- Suggested action

Respond with JSON:
{
  "matches": [
    {
      "bankTransactionId": "uuid",
      "matchedEntityId": "uuid",
      "matchType": "invoice|receipt|journal",
      "confidence": 0.95,
      "reason": "Exact amount match with customer name",
      "suggestedAction": "Auto-reconcile" | "Manual review needed"
    }
  ],
  "unmatched": [
    {
      "bankTransactionId": "uuid",
      "suggestedCategory": "expense category",
      "reason": "No matching ledger entry found"
    }
  ]
}

${DATA_BLOCK_INSTRUCTION}`,
          },
          {
            role: "user",
            content: `Match these bank transactions to ledger entries:

${wrapUserData("bank_transactions", JSON.stringify(bankData, null, 2), 40000)}

${wrapUserData("ledger_records", JSON.stringify(ledgerData, null, 2), 40000)}`,
          },
        ],
        response_format: { type: "json_object" },
        temperature: 0.1,
      });

      const aiResponse = JSON.parse(completion.choices[0].message.content || "{}");
      res.json(aiResponse);
    } catch (error: unknown) {
      log.error({ err: error }, "Reconciliation error");
      res
        .status(errorStatus(error) || errorStatusCode(error) || 500)
        .json({ message: errorMessage(error) || "Reconciliation failed", ...aiErrorBody(error) });
    }
  };
}

/** GET /api/companies/:companyId/bank-transactions */
export const handleGetCompaniesBankTransactions = async (req: Request, res: Response) => {
  try {
    const { companyId } = req.params;
    const userId = req.user!.id;

    // Verify company access
    const hasAccess = await storage.hasCompanyAccess(userId, companyId);
    if (!hasAccess) {
      return res.status(403).json({ code: "COMPANY_ACCESS_DENIED", message: "Access denied" });
    }

    const transactions = await storage.getBankTransactionsByCompanyId(companyId);
    res.json(transactions);
  } catch (error: unknown) {
    res
      .status(errorStatus(error) || errorStatusCode(error) || 500)
      .json({ message: errorMessage(error), ...aiErrorBody(error) });
  }
};

/** POST /api/companies/:companyId/bank-transactions */
export const handlePostCompaniesBankTransactions = async (req: Request, res: Response) => {
  const { companyId } = req.params;
  const userId = req.user!.id as string;
  if (!(await storage.hasCompanyAccess(userId, companyId))) {
    return res.status(403).json({ message: "Access denied", code: "COMPANY_ACCESS_DENIED" });
  }
  const body = parsedBody<ManualBankTransactionBody>(req);
  const [row] = aiRowsToParsedRows([
    {
      date: body.transactionDate,
      description: body.description,
      amount: body.amount,
      reference: body.reference ?? null,
      balance: body.balance ?? null,
    },
  ]);
  if (row.errors.length > 0) {
    throw new DomainError(
      "INVALID_BANK_TRANSACTION",
      400,
      { errors: row.errors },
      row.errors.join("; ")
    );
  }
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify([
        body.bankAccountId,
        row.date?.toISOString() ?? "",
        row.description,
        row.amount,
        row.reference,
      ])
    )
    .digest("hex");
  const result = await importStatementRows({
    companyId,
    bankAccountId: body.bankAccountId,
    rows: [row],
    kind: "csv",
    fileFingerprint: fingerprint,
    importSource: `manual:${fingerprint.slice(0, 16)}`,
    source: "manual",
    fileName: null,
    format: "manual",
    actorId: userId,
    allowDuplicates: body.allowDuplicates,
  });
  const [created] = result.imported;
  if (!created) {
    const skipped = result.plan.skipped[0];
    throw new DomainError(
      "DUPLICATE_BANK_TRANSACTION",
      409,
      { reason: skipped?.reason ?? "duplicate", detail: skipped?.detail ?? null },
      "This bank line already exists on the account. Send allowDuplicates: true to add it again."
    );
  }
  res.status(201).json({
    ...created,
    batchId: result.batchId,
    continuityWarning: result.continuityWarning,
  });
};

/** POST /api/companies/:companyId/bank-transactions/import */
export const handlePostCompaniesBankTransactionsImport = async (req: Request, res: Response) => {
  const { companyId } = req.params;
  const userId = req.user!.id as string;
  if (!(await storage.hasCompanyAccess(userId, companyId))) {
    return res.status(403).json({ message: "Access denied", code: "COMPANY_ACCESS_DENIED" });
  }
  res.status(410).json({
    code: "STATEMENT_CSV_REQUIRED",
    message: "Choose a bank CSV export.",
  });
};
