import type { Express, Request, Response } from "express";
import { z } from "zod";
import { authMiddleware, requireCustomer } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { validate } from "../middleware/validate";
import { storage } from "../storage";
import {
  autoReconcileTransactions,
  getSuggestionsForTransaction,
} from "../services/auto-reconcile.service";
import { createLogger } from "../config/logger";
import { createAndEmitNotification } from "../services/socket.service";
import { assertPeriodNotLocked } from "../services/period-lock.service";
import { ACCOUNT_CODES } from "../constants";
import {
  BANK_FORMAT_LABELS,
  importSourceFor,
  parseBankCsvText,
  parseBankStatement,
  planBankImport,
  toLegacyTransactions,
  type BankParseResult,
  type ParseOptions,
} from "../services/bank-statement-parser.service";

const log = createLogger("bank-statements");

// =====================================
// Zod schemas
// =====================================

const UAE_BANKS = ["Emirates NBD", "ADCB", "FAB", "Mashreq", "Other"] as const;

// `name` is accepted as an alias for `nameEn` — it is the field name callers
// reach for first, and sending it previously hit a NOT NULL column and returned
// HTTP 500. Normalised before validation so the error messages stay accurate.
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
    bankName: z.enum(UAE_BANKS, {
      errorMap: () => ({ message: `bankName must be one of: ${UAE_BANKS.join(", ")}` }),
    }),
    accountNumber: z.string().max(64).optional().nullable(),
    iban: z.string().max(64).optional().nullable(),
    currency: z.string().length(3).optional(),
    glAccountId: z.string().uuid().optional().nullable(),
  })
);

const bankAccountUpdateSchema = z.object({
  nameEn: z.string().min(1).max(255).optional(),
  bankName: z.enum(UAE_BANKS).optional(),
  accountNumber: z.string().max(64).optional().nullable(),
  iban: z.string().max(64).optional().nullable(),
  currency: z.string().length(3).optional(),
  glAccountId: z.string().uuid().optional().nullable(),
  isActive: z.boolean().optional(),
});

const columnIndex = z.number().int().min(0).max(200).nullable().optional();

/** Statement source + parsing choices shared by the preview and import endpoints (R06-23). */
const statementSourceShape = {
  csvContent: z.string().min(1, "csvContent (raw statement text) is required").optional(),
  fileBase64: z.string().min(1).optional(),
  fileName: z.string().max(255).optional(),
  delimiter: z.enum([",", ";", "\t", "|"]).optional(),
  decimalSeparator: z.enum([".", ","]).optional(),
  dateOrder: z.enum(["DMY", "MDY", "YMD"]).optional(),
  headerRow: z.number().int().min(1).max(10000).optional(),
  format: z
    .enum([
      "emiratesnbd",
      "adcb",
      "fab",
      "mashreq",
      "mashreqneo",
      "rakbank",
      "cbd",
      "wio",
      "generic",
    ])
    .optional(),
  mapping: z
    .object({
      date: columnIndex,
      description: columnIndex,
      reference: columnIndex,
      debit: columnIndex,
      credit: columnIndex,
      amount: columnIndex,
      direction: columnIndex,
      balance: columnIndex,
    })
    .optional(),
};

const hasStatementSource = (v: { csvContent?: string; fileBase64?: string }) =>
  Boolean(v.csvContent || v.fileBase64);
const statementSourceMessage = {
  message: "csvContent (raw statement text) or fileBase64 (XLSX/other file) is required",
  path: ["csvContent"],
};

const bankStatementImportSchema = z
  .object({
    bankAccountId: z.string().uuid("bankAccountId must be a valid UUID"),
    ...statementSourceShape,
    /** Import rows even when they match transactions already on the account. */
    allowDuplicates: z.boolean().optional(),
    /** Proceed although the preview flagged an ambiguity (assumed DD/MM, decimal point). */
    acknowledgeAmbiguity: z.boolean().optional(),
  })
  .refine(hasStatementSource, statementSourceMessage);

const bankStatementPreviewSchema = z
  .object({
    bankAccountId: z.string().uuid().optional(),
    ...statementSourceShape,
  })
  .refine(hasStatementSource, statementSourceMessage);

const bankMatchSchema = z.object({
  matchedType: z.enum(["invoice", "receipt", "journal"]),
  matchedId: z.string().uuid("matchedId must be a valid UUID"),
});

const bankCreateEntrySchema = z.object({
  accountId: z.string().uuid("accountId (GL account to debit/credit) must be a valid UUID"),
  memo: z.string().max(500).optional().nullable(),
});

// ─── Statement parsing ──────────────────────────────────────────────────────
// All parsing lives in services/bank-statement-parser.service.ts (pure functions, no DB).

/**
 * Synchronous CSV helper kept for existing callers/tests: parses CSV text and returns the
 * valid transactions plus row error messages.
 */
export function parseBankCsv(csvContent: string) {
  return toLegacyTransactions(parseBankCsvText(csvContent));
}

type StatementRequestBody = {
  csvContent?: string;
  fileBase64?: string;
  fileName?: string;
  delimiter?: string;
  decimalSeparator?: "." | ",";
  dateOrder?: "DMY" | "MDY" | "YMD";
  headerRow?: number;
  format?: ParseOptions["format"];
  mapping?: ParseOptions["mapping"];
};

function statementBytes(body: StatementRequestBody): Buffer {
  return body.fileBase64
    ? Buffer.from(body.fileBase64, "base64")
    : Buffer.from(body.csvContent ?? "", "utf8");
}

function statementOptions(body: StatementRequestBody): ParseOptions {
  const options: ParseOptions = {};
  if (body.delimiter) options.delimiter = body.delimiter;
  if (body.decimalSeparator) options.decimalSeparator = body.decimalSeparator;
  if (body.dateOrder) options.dateOrder = body.dateOrder;
  if (body.headerRow) options.headerRow = body.headerRow;
  if (body.format) options.format = body.format;
  if (body.mapping) options.mapping = body.mapping;
  return options;
}

function summarizeRowErrors(parsed: BankParseResult): string[] {
  return parsed.rows
    .filter((r) => r.errors.length > 0)
    .map((r) => `Row ${r.rowIndex}: ${r.errors.join("; ")}`);
}

// ─── AI Transaction Matching ────────────────────────────────────────────────

/**
 * After bulk import, attempt to auto-match each new transaction to
 * existing invoices/receipts using the auto-reconcile service.
 * Updates matchStatus to 'suggested' for confident matches.
 */
async function autoMatchImportedTransactions(companyId: string): Promise<void> {
  try {
    const result = await autoReconcileTransactions(companyId);
    // Apply high-confidence suggestions (>=75%) as 'suggested' status
    for (const match of result.matches) {
      if (match.confidence >= 75) {
        await storage.updateBankTransaction(match.bankTransactionId, companyId, {
          matchStatus: "suggested",
          matchConfidence: match.confidence / 100,
          ...(match.matchedType === "journal_entry" && { matchedJournalEntryId: match.matchedId }),
          ...(match.matchedType === "receipt" && { matchedReceiptId: match.matchedId }),
          ...(match.matchedType === "invoice" && { matchedInvoiceId: match.matchedId }),
        });
      }
    }
  } catch (err: any) {
    log.warn({ err: err.message }, "Auto-matching failed after import, continuing without matches");
  }
}

// ─── Route Registration ──────────────────────────────────────────────────────

export function registerBankStatementRoutes(app: Express) {
  // ─────────────────────────────────────────────────────────────
  // Bank Account Management
  // ─────────────────────────────────────────────────────────────

  /**
   * GET /api/companies/:companyId/bank-accounts
   * List all managed bank accounts for a company.
   */
  app.get(
    "/api/companies/:companyId/bank-accounts",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = (req as any).user.id;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) return res.status(403).json({ message: "Access denied" });

      const accounts = await storage.getBankAccountsByCompanyId(companyId);
      res.json(accounts);
    })
  );

  /**
   * POST /api/companies/:companyId/bank-accounts
   * Create a new managed bank account linked to a GL account.
   * Body: { nameEn, bankName, accountNumber?, iban?, currency?, glAccountId? }
   */
  app.post(
    "/api/companies/:companyId/bank-accounts",
    authMiddleware,
    requireCustomer,
    validate({ body: bankAccountCreateSchema }),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = (req as any).user.id;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) return res.status(403).json({ message: "Access denied" });

      const { nameEn, bankName, accountNumber, iban, currency, glAccountId } = req.body;

      const account = await storage.createBankAccount({
        companyId,
        nameEn,
        bankName,
        accountNumber: accountNumber || null,
        iban: iban || null,
        currency: currency || "AED",
        glAccountId: glAccountId || null,
        isActive: true,
      });

      res.status(201).json(account);
    })
  );

  /**
   * PATCH /api/companies/:companyId/bank-accounts/:accountId
   * Update a bank account (e.g., link to GL account).
   */
  app.patch(
    "/api/companies/:companyId/bank-accounts/:accountId",
    authMiddleware,
    requireCustomer,
    validate({ body: bankAccountUpdateSchema }),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, accountId } = req.params;
      const userId = (req as any).user.id;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) return res.status(403).json({ message: "Access denied" });

      const existing = await storage.getBankAccountById(accountId);
      if (!existing || existing.companyId !== companyId) {
        return res.status(404).json({ message: "Bank account not found" });
      }

      const { nameEn, bankName, accountNumber, iban, currency, glAccountId, isActive } = req.body;
      const updated = await storage.updateBankAccount(accountId, {
        ...(nameEn !== undefined && { nameEn }),
        ...(bankName !== undefined && { bankName }),
        ...(accountNumber !== undefined && { accountNumber }),
        ...(iban !== undefined && { iban }),
        ...(currency !== undefined && { currency }),
        ...(glAccountId !== undefined && { glAccountId }),
        ...(isActive !== undefined && { isActive }),
      });

      res.json(updated);
    })
  );

  // ─────────────────────────────────────────────────────────────
  // Bank Statement Import
  // ─────────────────────────────────────────────────────────────

  /**
   * POST /api/companies/:companyId/bank-statements/preview
   * Parse a statement without saving anything. Returns the detected format, delimiter, decimal
   * separator and date order, the detected (or supplied) column mapping, the header cells, the
   * first rows as parsed, row errors, and ambiguity warnings that need a user choice.
   * Body: same source/options fields as /import (no bankAccountId required).
   */
  app.post(
    "/api/companies/:companyId/bank-statements/preview",
    authMiddleware,
    requireCustomer,
    validate({ body: bankStatementPreviewSchema }),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = (req as any).user.id;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) return res.status(403).json({ message: "Access denied" });

      let parsed: BankParseResult;
      try {
        parsed = await parseBankStatement(statementBytes(req.body), statementOptions(req.body));
      } catch (err: any) {
        log.warn({ err: err.message }, "Bank statement preview failed to parse");
        return res.status(400).json({ message: "Could not read the statement file" });
      }

      const errorRows = parsed.rows.filter((r) => r.errors.length > 0);
      res.json({
        kind: parsed.kind,
        detectedFormat: parsed.format,
        detectedFormatLabel: BANK_FORMAT_LABELS[parsed.format],
        delimiter: parsed.delimiter,
        decimalSeparator: parsed.decimalSeparator,
        dateOrder: parsed.dateOrder,
        headerRow: parsed.headerRowIndex,
        headers: parsed.headers,
        mapping: parsed.mapping,
        fileFingerprint: parsed.fileFingerprint,
        accountHint: parsed.accountHint,
        currency: parsed.currency,
        totalRows: parsed.rows.length,
        validRows: parsed.rows.length - errorRows.length,
        errorRows: errorRows.length,
        ignoredRows: parsed.ignored.length,
        sampleRows: parsed.rows.slice(0, 10).map((r) => ({
          rowIndex: r.rowIndex,
          date: r.date ? r.date.toISOString().slice(0, 10) : null,
          description: r.description,
          debit: r.debit,
          credit: r.credit,
          amount: r.amount,
          balance: r.balance,
          reference: r.reference,
          errors: r.errors,
          raw: r.raw,
        })),
        errors: errorRows
          .slice(0, 50)
          .map((r) => ({ rowIndex: r.rowIndex, errors: r.errors, raw: r.raw })),
        warnings: parsed.warnings,
        requiresChoice: parsed.warnings.some((w) => w.requiresChoice),
      });
    })
  );

  /**
   * POST /api/companies/:companyId/bank-statements/import
   * Import bank statement rows from a CSV.
   *
   * Body: {
   *   bankAccountId: string  (from bank_accounts table),
   *   csvContent: string     (raw CSV text),
   * }
   *
   * Supports UAE bank formats: Emirates NBD, ADCB, FAB, Mashreq, generic.
   * Columns: date, description, debit, credit, balance (bank-specific headers auto-detected).
   * After import, runs AI auto-matching against existing invoices/receipts.
   */
  app.post(
    "/api/companies/:companyId/bank-statements/import",
    authMiddleware,
    requireCustomer,
    validate({ body: bankStatementImportSchema }),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = (req as any).user.id;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) return res.status(403).json({ message: "Access denied" });

      const { bankAccountId, allowDuplicates, acknowledgeAmbiguity } = req.body;

      // Validate bank account belongs to this company
      const bankAccount = await storage.getBankAccountById(bankAccountId);
      if (!bankAccount || bankAccount.companyId !== companyId) {
        return res.status(404).json({ message: "Bank account not found" });
      }

      // Parse (CSV / XLSX / MT940 / CAMT.053 / OFX)
      let parsedFile: BankParseResult;
      try {
        parsedFile = await parseBankStatement(statementBytes(req.body), statementOptions(req.body));
      } catch (err: any) {
        log.warn({ err: err.message }, "Bank statement import failed to parse");
        return res.status(400).json({ message: "Could not read the statement file" });
      }
      const format = parsedFile.format;
      const parseErrors = summarizeRowErrors(parsedFile);
      const validRows = parsedFile.rows.filter((r) => r.errors.length === 0 && r.date);

      if (validRows.length === 0) {
        return res.status(400).json({
          message: "No valid transactions found in the statement",
          parseErrors,
          warnings: parsedFile.warnings,
          detectedFormat: format,
        });
      }

      // Ambiguity (DD/MM vs MM/DD, decimal comma) must be a user choice, not a silent guess.
      const unresolved = parsedFile.warnings.filter((w) => w.requiresChoice);
      if (unresolved.length > 0 && !acknowledgeAmbiguity) {
        return res.status(409).json({
          code: "CHOICE_REQUIRED",
          message:
            "The statement is ambiguous. Confirm the date order, decimal separator or column mapping and retry.",
          warnings: parsedFile.warnings,
          dateOrder: parsedFile.dateOrder,
          decimalSeparator: parsedFile.decimalSeparator,
          detectedFormat: format,
        });
      }

      // Dedupe against existing transactions on the same managed bank account. Identical rows
      // inside one statement are all kept; a re-import of the same file adds nothing (R06-06).
      const existing = await storage.getBankTransactionsByCompanyId(companyId);
      const plan = planBankImport(
        parsedFile.rows,
        existing
          .filter((t) => t.bankStatementAccountId === bankAccountId)
          .map((t) => ({
            date: t.transactionDate,
            amount: Number(t.amount),
            description: t.description,
            reference: t.reference,
            importSource: t.importSource,
          })),
        {
          fileFingerprint: parsedFile.fileFingerprint,
          kind: parsedFile.kind,
          allowDuplicates: Boolean(allowDuplicates),
        }
      );

      const importSource = importSourceFor(parsedFile.kind, parsedFile.fileFingerprint);
      const toInsert = plan.toInsert.map((txn) => ({
        companyId,
        bankAccountId: bankAccount.glAccountId || null,
        bankStatementAccountId: bankAccountId,
        transactionDate: txn.date as Date,
        description: txn.description,
        // amount: positive = credit (inflow), negative = debit (outflow)
        amount: txn.amount,
        balance: txn.balance,
        reference: txn.reference,
        category: null,
        matchStatus: "unmatched" as const,
        isReconciled: false,
        importSource,
      }));

      const created = toInsert.length > 0 ? await storage.bulkCreateBankTransactions(toInsert) : [];
      const duplicateSkips = plan.skipped.filter((s) => s.reason !== "invalid_row");
      const skippedDuplicates = duplicateSkips.length;

      // Run AI auto-matching in background (non-blocking)
      autoMatchImportedTransactions(companyId).catch(() => {});

      createAndEmitNotification({
        userId,
        companyId,
        type: "bank_import",
        title: "Bank statement imported",
        message: `${created.length} transaction(s) imported from ${bankAccount.bankName} (${format} format)`,
        priority: "normal",
        relatedEntityType: "bank_statement",
        actionUrl: "/bank-reconciliation",
      }).catch(() => {});

      res.status(201).json({
        imported: created.length,
        skippedDuplicates,
        skipped: plan.skipped.slice(0, 200).map(({ rowIndex, reason, detail }) => ({
          rowIndex,
          reason,
          detail,
        })),
        fileAlreadyImported: plan.fileAlreadyImported,
        fileFingerprint: parsedFile.fileFingerprint,
        detectedFormat: format,
        dateOrder: parsedFile.dateOrder,
        decimalSeparator: parsedFile.decimalSeparator,
        warnings: parsedFile.warnings.length > 0 ? parsedFile.warnings : undefined,
        parseErrors: parseErrors.length > 0 ? parseErrors : undefined,
        message:
          skippedDuplicates > 0
            ? `Imported ${created.length} new transaction(s); skipped ${skippedDuplicates} duplicate(s). Auto-matching running in background.`
            : `Imported ${created.length} transaction(s). Auto-matching running in background.`,
      });
    })
  );

  // ─────────────────────────────────────────────────────────────
  // Reconciliation Endpoints
  // ─────────────────────────────────────────────────────────────

  /**
   * GET /api/companies/:companyId/bank-statements/unreconciled
   * Return all unmatched/unreconciled bank transactions.
   * Optional query param: bankAccountId — filter by managed bank account.
   */
  app.get(
    "/api/companies/:companyId/bank-statements/unreconciled",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = (req as any).user.id;
      const { bankAccountId } = req.query;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) return res.status(403).json({ message: "Access denied" });

      let transactions = await storage.getUnreconciledBankTransactions(companyId);

      if (bankAccountId && typeof bankAccountId === "string") {
        transactions = transactions.filter((t) => t.bankStatementAccountId === bankAccountId);
      }

      res.json(transactions);
    })
  );

  /**
   * POST /api/companies/:companyId/bank-statements/:tid/match
   * Manually match a bank transaction to an invoice or receipt.
   * Body: { matchedType: 'invoice' | 'receipt' | 'journal', matchedId: string }
   */
  app.post(
    "/api/companies/:companyId/bank-statements/:tid/match",
    authMiddleware,
    requireCustomer,
    validate({ body: bankMatchSchema }),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, tid } = req.params;
      const userId = (req as any).user.id;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) return res.status(403).json({ message: "Access denied" });

      const txn = await storage.getBankTransactionById(tid, companyId);
      if (!txn) {
        return res.status(404).json({ message: "Bank transaction not found" });
      }

      const { matchedType, matchedId } = req.body;

      // Manual reconciliation flips a transaction inside a period to matched —
      // refuse to mutate reconciliation state inside a locked period.
      await assertPeriodNotLocked(companyId, txn.transactionDate);

      let updated;

      if (matchedType === "invoice") {
        // Matching against an invoice means the customer has paid: we must
        // record the payment so the invoice's status/totalPaid update and a
        // proper double-entry JE is posted (Dr Bank, Cr A/R). Just flipping
        // the bank transaction's columns (the previous behaviour) left
        // invoices stuck on 'sent' indefinitely.
        const invoice = await storage.getInvoice(matchedId, companyId);
        if (!invoice) {
          return res.status(404).json({ message: "Invoice not found" });
        }

        if (!txn.bankAccountId) {
          return res.status(400).json({
            message:
              "Bank transaction has no linked GL bank account; cannot post payment journal entry.",
          });
        }

        const accounts = await storage.getAccountsByCompanyId(companyId);
        const accountsReceivable = accounts.find(
          (a) => a.code === ACCOUNT_CODES.AR && a.isSystemAccount
        );
        if (!accountsReceivable) {
          return res.status(500).json({ message: "Accounts Receivable account not found" });
        }

        const paymentAccount = await storage.getAccount(txn.bankAccountId, companyId);
        if (!paymentAccount) {
          return res.status(400).json({ message: "Bank GL account not found" });
        }

        // Match the unpaid remainder (or what the bank says, whichever is smaller).
        const previouslyPaid = await storage.getInvoicePaidTotal(matchedId);
        const remaining = Number(invoice.total) - previouslyPaid;
        const bankAbs = Math.abs(Number(txn.amount));
        const paymentAmount = Math.min(remaining, bankAbs);

        let journalEntryId: string | null = null;
        if (paymentAmount > 0.005) {
          try {
            const result = await storage.recordInvoicePayment({
              invoiceId: matchedId,
              companyId,
              amount: paymentAmount,
              date: new Date(txn.transactionDate),
              method: "bank_reconciliation",
              reference: txn.reference,
              notes: `Reconciled from bank statement: ${txn.description}`.slice(0, 500),
              paymentAccountId: txn.bankAccountId,
              paymentAccountCurrency: (paymentAccount as any).currency ?? null,
              receivableAccountId: accountsReceivable.id,
              createdBy: userId,
            });
            journalEntryId = result.journalEntryId;
          } catch (err: any) {
            if (
              err?.code === "CURRENCY_MISMATCH" ||
              err?.code === "OVERPAYMENT" ||
              err?.code === "INVOICE_TERMINAL"
            ) {
              return res.status(422).json({ message: err.message, code: err.code });
            }
            throw err;
          }
        }

        // Link the bank transaction to the invoice + the payment JE.
        // Bypass storage.reconcileBankTransaction here so we don't create a
        // second JE (recordInvoicePayment already posted the canonical one).
        updated = await storage.updateBankTransaction(tid, companyId, {
          isReconciled: true,
          matchStatus: "matched",
          matchedInvoiceId: matchedId,
          ...(journalEntryId ? { matchedJournalEntryId: journalEntryId } : {}),
        });
      } else {
        updated = await storage.reconcileBankTransaction(
          tid,
          companyId,
          matchedId,
          matchedType as "journal" | "receipt" | "invoice",
          userId
        );
        updated = await storage.updateBankTransaction(tid, companyId, { matchStatus: "matched" });
      }

      const { recordAudit } = await import("../services/audit.service");
      await recordAudit({
        userId,
        companyId,
        action: "bank.reconcile",
        entityType: "bank_transaction",
        entityId: tid,
        before: { matchStatus: txn.matchStatus },
        after: { matchedType, matchedId, matchStatus: "matched" },
        req,
      });

      res.json({ ...updated, matchStatus: "matched" });
    })
  );

  /**
   * POST /api/companies/:companyId/bank-statements/:tid/create-entry
   * Create a journal entry from an unmatched bank transaction.
   * Body: { accountId: string, memo?: string }
   * The bank account's GL account is the contra entry.
   */
  app.post(
    "/api/companies/:companyId/bank-statements/:tid/create-entry",
    authMiddleware,
    requireCustomer,
    validate({ body: bankCreateEntrySchema }),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, tid } = req.params;
      const userId = (req as any).user.id;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) return res.status(403).json({ message: "Access denied" });

      const txn = await storage.getBankTransactionById(tid, companyId);
      if (!txn) {
        return res.status(404).json({ message: "Bank transaction not found" });
      }

      // S-C2: refuse to create a second journal entry for a transaction that is
      // already matched/reconciled. Without this guard, calling the endpoint
      // twice posts two balanced JEs against the same bank line, double-counting
      // the cash movement and breaking reconciliation.
      if (txn.matchStatus === "matched" || txn.isReconciled || txn.matchedJournalEntryId) {
        return res.status(409).json({
          message: "This bank transaction is already reconciled to a journal entry.",
          code: "ALREADY_RECONCILED",
          matchedJournalEntryId: txn.matchedJournalEntryId ?? null,
        });
      }

      const { accountId, memo } = req.body;

      // Determine debit/credit based on transaction direction
      // Positive amount = credit to bank (inflow) → debit bank GL, credit the specified account
      // Negative amount = debit from bank (outflow) → credit bank GL, debit the specified account
      const absAmount = Math.abs(txn.amount);
      const isInflow = txn.amount > 0;

      const bankGlAccountId = txn.bankAccountId;
      if (!bankGlAccountId) {
        return res.status(400).json({
          message:
            "Cannot create journal entry: bank transaction has no associated bank account (bankAccountId is null). Link the transaction to a bank account first.",
        });
      }

      // Block creating reconciliation journal entries into a locked period.
      await assertPeriodNotLocked(companyId, txn.transactionDate);

      const entryNumber = await storage.generateEntryNumber(
        companyId,
        new Date(txn.transactionDate)
      );

      const entry = await storage.createJournalEntry(
        {
          companyId,
          entryNumber,
          date: new Date(txn.transactionDate),
          memo: memo || txn.description,
          status: "posted",
          source: "bank_reconciliation",
          sourceId: txn.id,
          createdBy: userId,
          postedBy: userId,
          postedAt: new Date(),
        },
        [
          {
            accountId: bankGlAccountId,
            debit: isInflow ? absAmount : 0,
            credit: isInflow ? 0 : absAmount,
            description: txn.description,
          },
          {
            accountId,
            debit: isInflow ? 0 : absAmount,
            credit: isInflow ? absAmount : 0,
            description: txn.description,
          },
        ]
      );

      // Mark transaction as matched to this journal entry
      const updated = await storage.reconcileBankTransaction(tid, companyId, entry.id, "journal");
      await storage.updateBankTransaction(tid, companyId, { matchStatus: "matched" });

      // S-H4: audit the GL posting from a bank transaction.
      const { recordAudit } = await import("../services/audit.service");
      await recordAudit({
        userId,
        companyId,
        action: "bank.reconcile_create_entry",
        entityType: "bank_transaction",
        entityId: tid,
        after: { journalEntryId: entry.id, amount: absAmount },
        req,
      });

      res.status(201).json({
        journalEntry: entry,
        bankTransaction: { ...updated, matchStatus: "matched" },
      });
    })
  );

  /**
   * GET /api/companies/:companyId/bank-statements/transactions
   * Return all bank transactions for a company (optionally filter by bankAccountId).
   */
  app.get(
    "/api/companies/:companyId/bank-statements/transactions",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = (req as any).user.id;
      const { bankAccountId } = req.query;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) return res.status(403).json({ message: "Access denied" });

      let transactions = await storage.getBankTransactionsByCompanyId(companyId);

      if (bankAccountId && typeof bankAccountId === "string") {
        transactions = transactions.filter((t) => t.bankStatementAccountId === bankAccountId);
      }

      res.json(transactions);
    })
  );

  /**
   * GET /api/companies/:companyId/bank-statements/:tid/suggestions
   * Return top match suggestions for a single bank transaction.
   */
  app.get(
    "/api/companies/:companyId/bank-statements/:tid/suggestions",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, tid } = req.params;
      const userId = (req as any).user.id;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) return res.status(403).json({ message: "Access denied" });

      const txn = await storage.getBankTransactionById(tid, companyId);
      if (!txn) {
        return res.status(404).json({ message: "Bank transaction not found" });
      }

      const suggestions = await getSuggestionsForTransaction(companyId, tid, 5);
      res.json(suggestions);
    })
  );

  /**
   * DELETE /api/companies/:companyId/bank-statements/:tid/match
   * Unmatch a reconciled transaction, resetting it to unmatched status.
   */
  app.delete(
    "/api/companies/:companyId/bank-statements/:tid/match",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, tid } = req.params;
      const userId = (req as any).user.id;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) return res.status(403).json({ message: "Access denied" });

      const txn = await storage.getBankTransactionById(tid, companyId);
      if (!txn) {
        return res.status(404).json({ message: "Bank transaction not found" });
      }

      // Unmatching reverses reconciliation state on the transaction's date —
      // refuse if that date is inside a locked period.
      await assertPeriodNotLocked(companyId, txn.transactionDate);

      const updated = await storage.updateBankTransaction(tid, companyId, {
        isReconciled: false,
        matchStatus: "unmatched",
        matchedJournalEntryId: null,
        matchedReceiptId: null,
        matchedInvoiceId: null,
        matchConfidence: null,
      });

      res.json(updated);
    })
  );

  /**
   * GET /api/companies/:companyId/bank-statements/report
   * Reconciliation summary report — totals and counts by status.
   * Optional query params: from (ISO date), to (ISO date), bankAccountId.
   */
  app.get(
    "/api/companies/:companyId/bank-statements/report",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = (req as any).user.id;
      const { from, to, bankAccountId } = req.query;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) return res.status(403).json({ message: "Access denied" });

      let transactions = await storage.getBankTransactionsByCompanyId(companyId);

      // Optional filters
      if (bankAccountId && typeof bankAccountId === "string") {
        transactions = transactions.filter((t) => t.bankStatementAccountId === bankAccountId);
      }
      if (from && typeof from === "string") {
        const fromDate = new Date(from);
        transactions = transactions.filter((t) => new Date(t.transactionDate) >= fromDate);
      }
      if (to && typeof to === "string") {
        const toDate = new Date(to);
        transactions = transactions.filter((t) => new Date(t.transactionDate) <= toDate);
      }

      const reconciled = transactions.filter((t) => t.isReconciled);
      const unreconciled = transactions.filter((t) => !t.isReconciled);
      const suggested = unreconciled.filter((t) => t.matchStatus === "suggested");

      const totalCredits = transactions
        .filter((t) => t.amount > 0)
        .reduce((s, t) => s + t.amount, 0);
      const totalDebits = transactions
        .filter((t) => t.amount < 0)
        .reduce((s, t) => s + Math.abs(t.amount), 0);
      const reconciledCredits = reconciled
        .filter((t) => t.amount > 0)
        .reduce((s, t) => s + t.amount, 0);
      const reconciledDebits = reconciled
        .filter((t) => t.amount < 0)
        .reduce((s, t) => s + Math.abs(t.amount), 0);

      res.json({
        period: {
          from: from || null,
          to: to || null,
        },
        summary: {
          totalTransactions: transactions.length,
          reconciledCount: reconciled.length,
          unreconciledCount: unreconciled.length,
          suggestedCount: suggested.length,
          reconciledPct:
            transactions.length > 0
              ? Math.round((reconciled.length / transactions.length) * 100)
              : 0,
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
