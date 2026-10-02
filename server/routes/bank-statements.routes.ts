import type { Express, Request, Response } from "express";
import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { authMiddleware, requireCompanyAccess, requireCustomer } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { validate } from "../middleware/validate";
import { db } from "../db";
import { bankTransactions } from "../../shared/schema";
import { storage } from "../storage";
import { AppError } from "../errors";
import { createLogger } from "../config/logger";
import { createAndEmitNotification } from "../services/socket.service";
import { recordAudit } from "../services/audit.service";
import { assertCanPostBanking } from "../services/bank-access";
import { importStatementFile } from "../services/bank-import.service";
import { suggestForTransaction, suggestForTransactions } from "../services/bank-matching.service";
import { applyMatch, unmatchTransaction } from "../services/bank-posting.service";
import { bulkMatch, MAX_BULK_ITEMS } from "../services/bank-bulk-match.service";
import { previewRules } from "../services/bank-rules.service";
import { computeBankReconciliationStatement } from "../services/bank-reconciliation.service";
import { reconciliationStatementCsv } from "../services/bank-reconciliation-math";
import { uaeYmdParts } from "../utils/date";

const log = createLogger("bank-statements");

const uuid = z.string().uuid();
const companyParams = z.object({ companyId: uuid }).passthrough();
const txnParams = z.object({ companyId: uuid, tid: uuid }).passthrough();
const accountParams = z.object({ companyId: uuid, accountId: uuid }).passthrough();

const UAE_BANKS = ["Emirates NBD", "ADCB", "FAB", "Mashreq", "Other"] as const;
const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

// `name` is accepted as an alias for `nameEn` (sending it used to hit a NOT NULL column and return HTTP 500).
const bankAccountCreateSchema = z.preprocess(
  (value) => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const v = { ...(value as Record<string, unknown>) };
      if (v.nameEn == null && typeof v.name === "string") v.nameEn = v.name;
      delete v.name;
      return v;
    }
    return value;
  },
  z.object({
    nameEn: z.string().min(1, "nameEn (or name) is required").max(255),
    bankName: z.enum(UAE_BANKS, { errorMap: () => ({ message: `bankName must be one of: ${UAE_BANKS.join(", ")}` }) }),
    accountNumber: z.string().max(64).optional().nullable(),
    iban: z.string().max(64).optional().nullable(),
    currency: z.string().length(3).optional(),
    glAccountId: uuid.optional().nullable(),
    reconcileFrom: isoDay.optional().nullable(),
  })
);

const bankAccountUpdateSchema = z.object({
  nameEn: z.string().min(1).max(255).optional(),
  bankName: z.enum(UAE_BANKS).optional(),
  accountNumber: z.string().max(64).optional().nullable(),
  iban: z.string().max(64).optional().nullable(),
  currency: z.string().length(3).optional(),
  glAccountId: uuid.optional().nullable(),
  reconcileFrom: isoDay.optional().nullable(),
  isActive: z.boolean().optional(),
});

// `csvContent` is the original field name; `content` carries any format.
const importSchema = z
  .object({
    bankAccountId: uuid,
    content: z.string().min(1).max(7_000_000).optional(),
    csvContent: z.string().min(1).max(7_000_000).optional(),
    fileName: z.string().max(255).optional().nullable(),
    format: z.enum(["auto", "csv", "ofx", "mt940", "camt053"]).default("auto"),
  })
  .refine((v) => !!(v.content ?? v.csvContent), { message: "content (the statement file text) is required", path: ["content"] });

const matchSchema = z.object({
  matchedType: z.enum(["invoice", "bill", "receipt", "journal"]),
  matchedId: uuid,
  // Optional payment date for invoice and bill matches. Defaults to the bank line's date; not in the future, not in a locked period.
  paymentDate: z.string().min(1).optional().nullable(),
});

const createEntrySchema = z.object({
  accountId: uuid,
  memo: z.string().max(500).optional().nullable(),
});

const applyRuleSchema = z.object({ ruleId: uuid });

const bulkSchema = z.object({
  items: z
    .array(
      z.object({
        transactionId: uuid,
        kind: z.enum(["invoice", "bill", "journal", "receipt", "rule", "account"]),
        targetId: uuid,
        paymentDate: z.string().min(1).optional().nullable(),
      })
    )
    .min(1)
    .max(MAX_BULK_ITEMS),
  dryRun: z.boolean().optional(),
});

const applyRulesSchema = z.object({
  bankAccountId: uuid.optional(),
  commit: z.boolean().default(false),
  transactionIds: z.array(uuid).max(500).optional(),
});

const today = (): string => {
  const p = uaeYmdParts(new Date());
  return `${p.year}-${String(p.month + 1).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
};

/** Re-score open lines after an import and mark the confident ones `suggested`. Best effort, never blocks the import. */
async function markSuggestions(companyId: string, bankAccountId: string): Promise<void> {
  try {
    const open = (await storage.getUnreconciledBankTransactions(companyId)).filter((t) => t.bankStatementAccountId === bankAccountId && t.matchStatus === "unmatched");
    if (open.length === 0) return;
    const suggestions = await suggestForTransactions(companyId, open, 60);
    for (const s of suggestions) {
      await db
        .update(bankTransactions)
        .set({ matchStatus: "suggested", matchConfidence: s.confidence / 100, suggestedRuleId: s.kind === "rule" ? s.targetId : null })
        .where(and(eq(bankTransactions.id, s.transactionId), eq(bankTransactions.companyId, companyId), eq(bankTransactions.matchStatus, "unmatched")));
    }
  } catch (err) {
    log.warn({ err: (err as Error).message }, "Suggesting matches after import failed; continuing without them");
  }
}

async function requireOwnGl(companyId: string, glAccountId: string): Promise<void> {
  const account = await storage.getAccount(glAccountId, companyId);
  if (!account || account.isActive === false || account.type !== "asset") {
    throw new AppError({ message: "The linked ledger account must be an active asset account of this company.", statusCode: 422, code: "ACCOUNT_INVALID" });
  }
}

export function registerBankStatementRoutes(app: Express) {
  const guard = [authMiddleware, requireCustomer, validate({ params: companyParams }), requireCompanyAccess("params")];
  const txnGuard = [authMiddleware, requireCustomer, validate({ params: txnParams }), requireCompanyAccess("params")];

  // ─── Bank accounts ───────────────────────────────────────────────────────

  app.get(
    "/api/companies/:companyId/bank-accounts",
    ...guard,
    asyncHandler(async (req: Request, res: Response) => {
      res.json(await storage.getBankAccountsByCompanyId(req.params.companyId));
    })
  );

  app.post(
    "/api/companies/:companyId/bank-accounts",
    authMiddleware,
    requireCustomer,
    validate({ params: companyParams, body: bankAccountCreateSchema }),
    requireCompanyAccess("params"),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const { nameEn, bankName, accountNumber, iban, currency, glAccountId, reconcileFrom } = req.body;
      if (glAccountId) await requireOwnGl(companyId, glAccountId);
      const account = await storage.createBankAccount({
        companyId,
        nameEn,
        bankName,
        accountNumber: accountNumber || null,
        iban: iban || null,
        currency: (currency || "AED").toUpperCase(),
        glAccountId: glAccountId || null,
        reconcileFrom: reconcileFrom ?? null,
        isActive: true,
      } as any);
      res.status(201).json(account);
    })
  );

  app.patch(
    "/api/companies/:companyId/bank-accounts/:accountId",
    authMiddleware,
    requireCustomer,
    validate({ params: accountParams, body: bankAccountUpdateSchema }),
    requireCompanyAccess("params"),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, accountId } = req.params;
      const existing = await storage.getBankAccountById(accountId);
      if (!existing || existing.companyId !== companyId) throw new AppError({ message: "Bank account not found", statusCode: 404, code: "BANK_ACCOUNT_NOT_FOUND" });

      const { nameEn, bankName, accountNumber, iban, currency, glAccountId, reconcileFrom, isActive } = req.body;
      const glChanges = glAccountId !== undefined && glAccountId !== existing.glAccountId;
      if (glChanges || (reconcileFrom !== undefined && String(reconcileFrom ?? "") !== String(existing.reconcileFrom ?? ""))) {
        await assertCanPostBanking(req.user!.id, companyId);
      }
      if (glChanges) {
        if (glAccountId) await requireOwnGl(companyId, glAccountId);
        const used = await db.execute(sql`
          SELECT 1 FROM bank_transactions
           WHERE company_id = ${companyId} AND bank_statement_account_id = ${accountId}
             AND (is_reconciled OR matched_journal_entry_id IS NOT NULL OR reconciliation_id IS NOT NULL) LIMIT 1`);
        if (((used as any).rows ?? used).length > 0) {
          throw new AppError({ message: "Matched bank lines already post to the current ledger account. Unmatch them before relinking.", statusCode: 409, code: "BANK_GL_IN_USE" });
        }
      }
      if (currency !== undefined && currency.toUpperCase() !== (existing.currency || "AED").toUpperCase()) {
        const any = await db.execute(sql`SELECT 1 FROM bank_transactions WHERE company_id = ${companyId} AND bank_statement_account_id = ${accountId} LIMIT 1`);
        if (((any as any).rows ?? any).length > 0) {
          throw new AppError({ message: "The currency cannot change once the account has bank lines.", statusCode: 409, code: "BANK_CURRENCY_IN_USE" });
        }
      }

      const updated = await storage.updateBankAccount(accountId, {
        ...(nameEn !== undefined && { nameEn }),
        ...(bankName !== undefined && { bankName }),
        ...(accountNumber !== undefined && { accountNumber }),
        ...(iban !== undefined && { iban }),
        ...(currency !== undefined && { currency: currency.toUpperCase() }),
        ...(glAccountId !== undefined && { glAccountId }),
        ...(reconcileFrom !== undefined && { reconcileFrom }),
        ...(isActive !== undefined && { isActive }),
      } as any);
      if (glChanges && glAccountId) {
        // lines that were never matched follow the account to its new ledger account
        await db
          .update(bankTransactions)
          .set({ bankAccountId: glAccountId })
          .where(and(eq(bankTransactions.companyId, companyId), eq(bankTransactions.bankStatementAccountId, accountId)));
      }
      res.json(updated);
    })
  );

  // ─── Import (CSV, OFX, MT940, CAMT.053) ──────────────────────────────────

  app.post(
    "/api/companies/:companyId/bank-statements/import",
    authMiddleware,
    requireCustomer,
    validate({ params: companyParams, body: importSchema }),
    requireCompanyAccess("params"),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = req.user!.id;
      const { bankAccountId, fileName, format } = req.body;
      const content: string = req.body.content ?? req.body.csvContent;

      const account = await storage.getBankAccountById(bankAccountId);
      if (!account || account.companyId !== companyId) throw new AppError({ message: "Bank account not found", statusCode: 404, code: "BANK_ACCOUNT_NOT_FOUND" });

      const outcome = await importStatementFile({ companyId, userId, account, content, fileName, format });
      const { insertedIds: _ids, ...body } = outcome;

      void markSuggestions(companyId, account.id);
      createAndEmitNotification({
        userId,
        companyId,
        type: "bank_import",
        title: "Bank statement imported",
        message: `${outcome.imported} transaction(s) imported from ${account.bankName} (${outcome.format} format)`,
        priority: "normal",
        relatedEntityType: "bank_statement",
        actionUrl: "/bank-reconciliation",
      }).catch(() => {});
      await recordAudit({ userId, companyId, action: "bank.import", entityType: "bank_statement_import", entityId: outcome.importId, after: { format: outcome.format, imported: outcome.imported, duplicates: outcome.duplicates }, req });

      res.status(201).json({
        ...body,
        detectedFormat: outcome.format,
        message:
          outcome.duplicates > 0
            ? `Imported ${outcome.imported} new transaction(s); skipped ${outcome.duplicates} duplicate(s).`
            : `Imported ${outcome.imported} transaction(s).`,
      });
    })
  );

  // ─── Lists ───────────────────────────────────────────────────────────────

  app.get(
    "/api/companies/:companyId/bank-statements/unreconciled",
    ...guard,
    asyncHandler(async (req: Request, res: Response) => {
      const { bankAccountId } = req.query;
      let transactions = await storage.getUnreconciledBankTransactions(req.params.companyId);
      if (typeof bankAccountId === "string" && bankAccountId) transactions = transactions.filter((t) => t.bankStatementAccountId === bankAccountId);
      res.json(transactions);
    })
  );

  app.get(
    "/api/companies/:companyId/bank-statements/transactions",
    ...guard,
    asyncHandler(async (req: Request, res: Response) => {
      const { bankAccountId } = req.query;
      let transactions = await storage.getBankTransactionsByCompanyId(req.params.companyId);
      if (typeof bankAccountId === "string" && bankAccountId) transactions = transactions.filter((t) => t.bankStatementAccountId === bankAccountId);
      res.json(transactions);
    })
  );

  // ─── Suggestions ─────────────────────────────────────────────────────────

  app.get(
    "/api/companies/:companyId/bank-statements/suggestions",
    ...guard,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const bankAccountId = typeof req.query.bankAccountId === "string" && uuid.safeParse(req.query.bankAccountId).success ? req.query.bankAccountId : null;
      const minConfidence = Math.min(100, Math.max(0, Number(req.query.minConfidence ?? 60) || 60));
      let txns = await storage.getUnreconciledBankTransactions(companyId);
      if (bankAccountId) txns = txns.filter((t) => t.bankStatementAccountId === bankAccountId);
      res.json(await suggestForTransactions(companyId, txns.slice(0, 1000), minConfidence));
    })
  );

  app.get(
    "/api/companies/:companyId/bank-statements/:tid/suggestions",
    ...txnGuard,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, tid } = req.params;
      const txn = await storage.getBankTransactionById(tid, companyId);
      if (!txn) throw new AppError({ message: "Bank transaction not found", statusCode: 404, code: "BANK_TXN_NOT_FOUND" });
      res.json(await suggestForTransaction(companyId, txn, 5));
    })
  );

  // ─── Match / create entry / apply rule / unmatch ─────────────────────────

  app.post(
    "/api/companies/:companyId/bank-statements/:tid/match",
    authMiddleware,
    requireCustomer,
    validate({ params: txnParams, body: matchSchema }),
    requireCompanyAccess("params"),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, tid } = req.params;
      const userId = req.user!.id;
      await assertCanPostBanking(userId, companyId);
      const { matchedType, matchedId, paymentDate } = req.body;
      const result = await applyMatch({ companyId, userId }, { transactionId: tid, kind: matchedType, targetId: matchedId, paymentDate });
      await recordAudit({ userId, companyId, action: "bank.reconcile", entityType: "bank_transaction", entityId: tid, after: { matchedType, matchedId, journalEntryId: result.journalEntryId, matchStatus: "matched" }, req });
      res.json({ ...result.transaction, matchStatus: "matched", journalEntryId: result.journalEntryId });
    })
  );

  app.post(
    "/api/companies/:companyId/bank-statements/:tid/create-entry",
    authMiddleware,
    requireCustomer,
    validate({ params: txnParams, body: createEntrySchema }),
    requireCompanyAccess("params"),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, tid } = req.params;
      const userId = req.user!.id;
      await assertCanPostBanking(userId, companyId);
      const { accountId, memo } = req.body;
      const result = await applyMatch({ companyId, userId }, { transactionId: tid, kind: "account", targetId: accountId, memo });
      const entry = result.journalEntryId ? await storage.getJournalEntryById(result.journalEntryId) : null;
      await recordAudit({ userId, companyId, action: "bank.reconcile_create_entry", entityType: "bank_transaction", entityId: tid, after: { journalEntryId: result.journalEntryId, accountId }, req });
      res.status(201).json({ journalEntry: entry, bankTransaction: { ...result.transaction, matchStatus: "matched" } });
    })
  );

  app.post(
    "/api/companies/:companyId/bank-statements/:tid/apply-rule",
    authMiddleware,
    requireCustomer,
    validate({ params: txnParams, body: applyRuleSchema }),
    requireCompanyAccess("params"),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, tid } = req.params;
      const userId = req.user!.id;
      await assertCanPostBanking(userId, companyId);
      const result = await applyMatch({ companyId, userId }, { transactionId: tid, kind: "rule", targetId: req.body.ruleId });
      await recordAudit({ userId, companyId, action: "bank.apply_rule", entityType: "bank_transaction", entityId: tid, after: { ruleId: req.body.ruleId, journalEntryId: result.journalEntryId, receiptId: result.receiptId }, req });
      res.status(201).json({ transaction: result.transaction, journalEntryId: result.journalEntryId, receiptId: result.receiptId });
    })
  );

  app.delete(
    "/api/companies/:companyId/bank-statements/:tid/match",
    ...txnGuard,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, tid } = req.params;
      const userId = req.user!.id;
      await assertCanPostBanking(userId, companyId);
      const result = await unmatchTransaction({ companyId, userId }, tid);
      await recordAudit({ userId, companyId, action: "bank.unmatch", entityType: "bank_transaction", entityId: tid, after: { reversedEntryId: result.reversedEntryId }, req });
      res.json({ ...result.transaction, reversedEntryId: result.reversedEntryId });
    })
  );

  // ─── Bulk ────────────────────────────────────────────────────────────────

  app.post(
    "/api/companies/:companyId/bank-statements/bulk-match",
    authMiddleware,
    requireCustomer,
    validate({ params: companyParams, body: bulkSchema }),
    requireCompanyAccess("params"),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = req.user!.id;
      await assertCanPostBanking(userId, companyId);
      const outcome = await bulkMatch({ companyId, userId }, req.body.items, { dryRun: req.body.dryRun === true });
      if (!outcome.dryRun) {
        await recordAudit({ userId, companyId, action: "bank.bulk_match", entityType: "bank_transaction", after: { applied: outcome.applied }, req });
      }
      res.json(outcome);
    })
  );

  app.post(
    "/api/companies/:companyId/bank-statements/apply-rules",
    authMiddleware,
    requireCustomer,
    validate({ params: companyParams, body: applyRulesSchema }),
    requireCompanyAccess("params"),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = req.user!.id;
      const { bankAccountId, commit, transactionIds } = req.body;
      if (commit) await assertCanPostBanking(userId, companyId);

      let txns = (await storage.getUnreconciledBankTransactions(companyId)).filter((t) => t.matchStatus !== "matched");
      if (bankAccountId) txns = txns.filter((t) => t.bankStatementAccountId === bankAccountId);
      if (transactionIds?.length) {
        const wanted = new Set(transactionIds);
        txns = txns.filter((t) => wanted.has(t.id));
      }
      txns = txns.slice(0, 500);

      const preview = await previewRules(companyId, txns);
      if (!commit) return res.json(preview);

      const results: Array<{ transactionId: string; ruleId: string; journalEntryId?: string | null; receiptId?: string | null; error?: { code: string; message: string } }> = [];
      for (const p of preview) {
        try {
          const done = await applyMatch({ companyId, userId }, { transactionId: p.transactionId, kind: "rule", targetId: p.ruleId });
          results.push({ transactionId: p.transactionId, ruleId: p.ruleId, journalEntryId: done.journalEntryId, receiptId: done.receiptId });
        } catch (err) {
          const e = err instanceof AppError ? err : null;
          results.push({ transactionId: p.transactionId, ruleId: p.ruleId, error: { code: e?.code ?? "INTERNAL_ERROR", message: e?.message ?? "Unexpected error" } });
        }
      }
      await recordAudit({ userId, companyId, action: "bank.apply_rules", entityType: "bank_transaction", after: { applied: results.filter((r) => !r.error).length, failed: results.filter((r) => r.error).length }, req });
      res.json({ applied: results.filter((r) => !r.error).length, results });
    })
  );

  // ─── Reports ─────────────────────────────────────────────────────────────

  app.get(
    "/api/companies/:companyId/bank-statements/reconciliation-report",
    ...guard,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const bankAccountId = String(req.query.bankAccountId ?? "");
      if (!uuid.safeParse(bankAccountId).success) throw new AppError({ message: "bankAccountId is required", statusCode: 400, code: "VALIDATION_ERROR" });
      const asOf = typeof req.query.asOf === "string" && req.query.asOf ? req.query.asOf : today();
      if (!isoDay.safeParse(asOf).success) throw new AppError({ message: "asOf must be YYYY-MM-DD", statusCode: 400, code: "VALIDATION_ERROR" });
      const rawBalance = req.query.statementBalance;
      const statementBalance = rawBalance === undefined || rawBalance === "" ? undefined : Number(rawBalance);
      if (statementBalance !== undefined && !Number.isFinite(statementBalance)) throw new AppError({ message: "statementBalance must be a number", statusCode: 400, code: "VALIDATION_ERROR" });

      const statement = await computeBankReconciliationStatement(companyId, bankAccountId, asOf, statementBalance);
      if (req.query.format === "csv") {
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="bank-reconciliation-${asOf}.csv"`);
        return res.send(reconciliationStatementCsv(statement));
      }
      res.json(statement);
    })
  );

  app.get(
    "/api/companies/:companyId/bank-statements/report",
    ...guard,
    asyncHandler(async (req: Request, res: Response) => {
      const { from, to, bankAccountId } = req.query;
      let transactions = await storage.getBankTransactionsByCompanyId(req.params.companyId);
      if (bankAccountId && typeof bankAccountId === "string") transactions = transactions.filter((t) => t.bankStatementAccountId === bankAccountId);
      if (from && typeof from === "string") transactions = transactions.filter((t) => new Date(t.transactionDate) >= new Date(from));
      if (to && typeof to === "string") transactions = transactions.filter((t) => new Date(t.transactionDate) <= new Date(to));

      const reconciled = transactions.filter((t) => t.isReconciled);
      const unreconciled = transactions.filter((t) => !t.isReconciled);
      const suggested = unreconciled.filter((t) => t.matchStatus === "suggested");
      const totalCredits = transactions.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0);
      const totalDebits = transactions.filter((t) => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);
      const reconciledCredits = reconciled.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0);
      const reconciledDebits = reconciled.filter((t) => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);

      res.json({
        period: { from: from || null, to: to || null },
        summary: {
          totalTransactions: transactions.length,
          reconciledCount: reconciled.length,
          unreconciledCount: unreconciled.length,
          suggestedCount: suggested.length,
          reconciledPct: transactions.length > 0 ? Math.round((reconciled.length / transactions.length) * 100) : 0,
        },
        amounts: {
          totalCredits,
          totalDebits,
          netAmount: totalCredits - totalDebits,
          reconciledCredits,
          reconciledDebits,
          unreconciledCredits: totalCredits - reconciledCredits,
          unreconciledDebits: totalDebits - reconciledDebits,
        },
      });
    })
  );
}


