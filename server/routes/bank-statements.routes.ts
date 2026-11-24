import type { Express, Request, Response } from "express";
import { z } from "zod";
import { authMiddleware, requireCustomer } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { strictBody } from "../http/strict-body";
import { parsedBody } from "../http/parsed-body";
import {
  assertDifferentActor,
  companyHasSingleMember,
  requirePermission,
} from "../middleware/companyRolePolicy";
import { DomainError } from "../errors";
import { storage } from "../storage";
import { db } from "../db";
import { and, desc, eq } from "drizzle-orm";
import { getSuggestionsForTransaction } from "../services/auto-reconcile.service";
import { createLogger } from "../config/logger";
import { createAndEmitNotification } from "../services/socket.service";
import { notificationCopy } from "../../shared/server-copy";
import { bankStatementCopy, statementRecognized } from "../../shared/bank-statement-copy";
import {
  parseBankCsvText,
  toLegacyTransactions,
  type BankParseResult,
  type ParseOptions,
} from "../services/bank-statement-parser.service";
import {
  assertStatementDatesValid,
  importStatementRows,
  parseStatementCsv,
  statementImportChoice,
} from "../services/bank-import.service";
import {
  applyMatch,
  assertLinkableGlAccount,
  buildReconciliationStatement,
  confirmPendingEntry,
  createBankGlAccount,
  dbFils,
  editTransaction,
  getMatches,
  setExcluded,
  softDeleteTransaction,
  syncUnreconciledGlLink,
  undoImportBatch,
  unmatchTransaction,
  reconciliationSheets,
  renderReconciliationPdf,
  type MatchTarget,
} from "../services/bank-reconciliation.service";
import { sendTabular } from "../reporting/http";
import { fromFils } from "../../shared/money";
import {
  bankAccountCreateBody,
  bankAccountRelinkBody,
  bankAccountUpdateBody,
  bankCreateEntryBody,
  bankMatchBody,
  bankTransactionDeleteBody,
  bankTransactionEditBody,
  bankTransactionExcludeBody,
  reconciliationStatementBody,
  UAE_BANK_SUGGESTIONS,
  type BankAccountCreateBody,
  type BankAccountUpdateBody,
  type BankCreateEntryBody,
  type BankMatchBody,
  type ReconciliationStatementBody,
} from "../../shared/validators/banking";
import { zDate } from "../../shared/validators/primitives";
import {
  bankImportBatches,
  bankReconciliations,
  type BankReconciliation,
} from "../../shared/schema";

const log = createLogger("bank-statements");

// ─── Statement parsing schemas (R06-23, parser from W1-E) ────────────────────

const columnIndex = z.number().int().min(0).max(200).nullable().optional();

const statementSourceShape = {
  csvContent: z.string().optional(),
  fileBase64: z.string().optional(),
  fileName: z.string().max(255).optional(),
  expectedKind: z.literal("csv").optional(),
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
    .strict()
    .optional(),
};

const hasStatementSource = (v: { csvContent?: string; fileBase64?: string }) =>
  Boolean(v.csvContent?.trim() || v.fileBase64?.trim());
const statementSourceMessage = {
  message: bankStatementCopy.en,
};

const bankStatementImportSchema = z
  .object({
    bankAccountId: z.string().guid("bankAccountId must be a valid UUID"),
    ...statementSourceShape,
    /** Import rows even when they match transactions already on the account. */
    allowDuplicates: z.boolean().optional(),
    /** Proceed although the preview flagged an ambiguity (assumed DD/MM, decimal point). */
    acknowledgeAmbiguity: z.boolean().optional(),
  })
  .refine(hasStatementSource, statementSourceMessage);

const bankStatementPreviewSchema = z
  .object({
    bankAccountId: z.string().guid().optional(),
    ...statementSourceShape,
  })
  .refine(hasStatementSource, statementSourceMessage);

const unmatchBody = z.object({ reason: z.string().trim().max(500).optional() }).strict();
const emptyBody = z.object({}).strict();

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
  return body.fileBase64?.trim()
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

function actor(req: Request): string {
  return (req as Request & { user: { id: string } }).user.id;
}

async function assertAccess(req: Request, companyId: string): Promise<void> {
  if (!(await storage.hasCompanyAccess(actor(req), companyId)))
    throw new DomainError("COMPANY_ACCESS_DENIED", 403, undefined, "Access denied");
}

async function ownedBankAccount(companyId: string, accountId: string) {
  const account = await storage.getBankAccountById(accountId, companyId);
  if (!account)
    throw new DomainError("BANK_ACCOUNT_NOT_FOUND", 404, undefined, "Bank account not found");
  return account;
}

function idempotencyKeyOf(req: Request, bodyKey?: string): string | undefined {
  const header = req.header("idempotency-key");
  const key = bodyKey ?? (typeof header === "string" ? header.trim() : undefined);
  if (key && !/^[A-Za-z0-9:_\-.]{8,120}$/.test(key))
    throw new DomainError("INVALID_IDEMPOTENCY_KEY", 400);
  return key || undefined;
}

/** Match request body -> match target. */
function targetFromBody(body: BankMatchBody): MatchTarget {
  if (body.allocations) {
    return {
      kind: "split",
      allocations: body.allocations.map((a) => ({ type: a.type, id: a.id, amountFils: a.amount })),
    };
  }
  const id = body.matchedId as string;
  switch (body.matchedType) {
    case "invoice":
      return { kind: "invoice", id, amountFils: body.amount, exchangeRate: body.exchangeRate };
    case "bill":
      return { kind: "bill", id, amountFils: body.amount };
    case "receipt":
      return { kind: "receipt", id };
    case "transfer":
      return { kind: "transfer", id, counterpartTransactionId: body.counterpartTransactionId };
    default:
      return { kind: "journal", id };
  }
}

function statementQuery(req: Request): ReconciliationStatementBody {
  const q = req.query as Record<string, unknown>;
  const parsed = reconciliationStatementBody.safeParse({
    periodEnd: q.periodEnd,
    ...(q.periodStart ? { periodStart: q.periodStart } : {}),
    statementClosingBalance: q.statementClosingBalance,
  });
  if (!parsed.success)
    throw new DomainError(
      "VALIDATION_ERROR",
      400,
      parsed.error.flatten().fieldErrors,
      "periodEnd (YYYY-MM-DD) and statementClosingBalance are required"
    );
  return parsed.data;
}

export function registerBankStatementRoutes(app: Express) {
  // ─────────────────────────────────────────────────────────────
  // Bank account management (R06-01, R06-17)
  // ─────────────────────────────────────────────────────────────

  app.get(
    "/api/companies/:companyId/bank-accounts",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      await assertAccess(req, companyId);
      const accounts = await storage.getBankAccountsByCompanyId(companyId);
      res.json(accounts);
    })
  );

  /** Bank names are free text; this list only feeds the form's suggestions. */
  app.get(
    "/api/companies/:companyId/bank-accounts/bank-name-suggestions",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      await assertAccess(req, req.params.companyId);
      res.json({ suggestions: UAE_BANK_SUGGESTIONS });
    })
  );

  /**
   * Create a managed bank account. Without glAccountId a dedicated GL account (asset, sub_type
   * bank, code 1021-1029) is created, so every line imported later can be reconciled (R06-01).
   */
  app.post(
    "/api/companies/:companyId/bank-accounts",
    authMiddleware,
    requireCustomer,
    strictBody(bankAccountCreateBody),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      await assertAccess(req, companyId);
      const body = parsedBody<BankAccountCreateBody>(req);
      const currency = body.currency ?? "AED";
      const gl = body.glAccountId
        ? await assertLinkableGlAccount(companyId, body.glAccountId)
        : await createBankGlAccount(companyId, { nameEn: body.nameEn, currency });
      const account = await storage.createBankAccount({
        companyId,
        nameEn: body.nameEn,
        bankName: body.bankName,
        accountNumber: body.accountNumber || null,
        iban: body.iban || null,
        currency,
        glAccountId: gl.id,
        isActive: true,
        openingBalance:
          body.openingBalance !== undefined ? Number(fromFils(body.openingBalance)) : 0,
        openingBalanceDate: body.openingBalanceDate ?? null,
      });
      res
        .status(201)
        .json({ ...account, glAccount: { id: gl.id, code: gl.code, nameEn: gl.nameEn } });
    })
  );

  async function relink(req: Request, companyId: string, accountId: string, glAccountId: string) {
    const existing = await ownedBankAccount(companyId, accountId);
    const gl = await assertLinkableGlAccount(companyId, glAccountId);
    const updated = await storage.updateBankAccount(existing.id, { glAccountId: gl.id });
    const relinked = await syncUnreconciledGlLink(companyId, existing.id, gl.id);
    const { recordAudit } = await import("../services/audit.service");
    await recordAudit({
      userId: actor(req),
      companyId,
      action: "bank.account_relink",
      entityType: "bank_account",
      entityId: existing.id,
      before: { glAccountId: existing.glAccountId },
      after: { glAccountId: gl.id, relinkedUnreconciled: relinked },
      req,
    });
    return { ...updated, relinkedTransactions: relinked };
  }

  app.patch(
    "/api/companies/:companyId/bank-accounts/:accountId",
    authMiddleware,
    requireCustomer,
    strictBody(bankAccountUpdateBody),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, accountId } = req.params;
      await assertAccess(req, companyId);
      const existing = await ownedBankAccount(companyId, accountId);
      const body = parsedBody<BankAccountUpdateBody>(req);
      const patch = {
        ...(body.nameEn !== undefined && { nameEn: body.nameEn }),
        ...(body.bankName !== undefined && { bankName: body.bankName }),
        ...(body.accountNumber !== undefined && { accountNumber: body.accountNumber || null }),
        ...(body.iban !== undefined && { iban: body.iban || null }),
        ...(body.currency !== undefined && { currency: body.currency }),
        ...(body.isActive !== undefined && { isActive: body.isActive }),
        ...(body.openingBalance !== undefined && {
          openingBalance: Number(fromFils(body.openingBalance)),
        }),
        ...(body.openingBalanceDate !== undefined && {
          openingBalanceDate: body.openingBalanceDate,
        }),
      };
      let updated = Object.keys(patch).length
        ? await storage.updateBankAccount(existing.id, patch)
        : existing;
      if (body.glAccountId && body.glAccountId !== existing.glAccountId) {
        updated = await relink(req, companyId, accountId, body.glAccountId);
      }
      res.json(updated);
    })
  );

  /** Relink to another GL account; unreconciled lines follow (R06-01, R06-22). */
  app.post(
    "/api/companies/:companyId/bank-accounts/:accountId/relink",
    authMiddleware,
    requireCustomer,
    requirePermission("settings.company"),
    strictBody(bankAccountRelinkBody),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, accountId } = req.params;
      await assertAccess(req, companyId);
      res.json(await relink(req, companyId, accountId, req.body.glAccountId));
    })
  );

  // ─────────────────────────────────────────────────────────────
  // Statement import (parser: services/bank-statement-parser.service.ts)
  // ─────────────────────────────────────────────────────────────

  app.post(
    "/api/companies/:companyId/bank-statements/preview",
    authMiddleware,
    requireCustomer,
    strictBody(bankStatementPreviewSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      await assertAccess(req, companyId);

      let parsed: BankParseResult;
      try {
        parsed = parseStatementCsv(statementBytes(req.body), statementOptions(req.body));
      } catch (err) {
        if (err instanceof DomainError) throw err;
        log.warn({ err: (err as Error).message }, "Bank statement preview failed to parse");
        return res
          .status(400)
          .json({ message: "Could not read the statement file", code: "STATEMENT_UNREADABLE" });
      }

      const errorRows = parsed.rows.filter((r) => r.errors.length > 0);
      const validRows = parsed.rows.length - errorRows.length;
      res.json({
        kind: parsed.kind,
        detectedFormat: parsed.format,
        detectedFormatLabel: validRows > 0 ? statementRecognized.en : null,
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
        validRows,
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
   * Import a CSV statement into a managed bank account.
   * Every import is a batch (history + undo) with an opening-balance continuity check.
   */
  app.post(
    "/api/companies/:companyId/bank-statements/import",
    authMiddleware,
    requireCustomer,
    strictBody(bankStatementImportSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = actor(req);
      await assertAccess(req, companyId);
      const { bankAccountId, allowDuplicates, acknowledgeAmbiguity } = req.body;
      const bankAccount = await ownedBankAccount(companyId, bankAccountId);

      let parsedFile: BankParseResult;
      try {
        parsedFile = parseStatementCsv(statementBytes(req.body), statementOptions(req.body));
      } catch (err) {
        if (err instanceof DomainError) throw err;
        log.warn({ err: (err as Error).message }, "Bank statement import failed to parse");
        return res
          .status(400)
          .json({ message: "Could not read the statement file", code: "STATEMENT_UNREADABLE" });
      }
      assertStatementDatesValid(parsedFile);
      const format = parsedFile.format;
      const parseErrors = summarizeRowErrors(parsedFile);
      const validRows = parsedFile.rows.filter((r) => r.errors.length === 0 && r.date);

      if (validRows.length === 0) {
        return res.status(400).json({
          code: "NO_VALID_TRANSACTIONS",
          message: "No valid transactions found in the statement",
          parseErrors,
          warnings: parsedFile.warnings,
          detectedFormat: format,
        });
      }

      const choice = statementImportChoice(parsedFile, acknowledgeAmbiguity);
      if (choice) return res.status(409).json(choice);

      const result = await importStatementRows({
        companyId,
        bankAccountId: bankAccount.id,
        rows: parsedFile.rows,
        kind: parsedFile.kind,
        fileFingerprint: parsedFile.fileFingerprint,
        source: parsedFile.kind,
        fileName: req.body.fileName ?? null,
        format,
        actorId: userId,
        allowDuplicates: Boolean(allowDuplicates),
      });
      const created = result.imported;
      const duplicateSkips = result.plan.skipped.filter((s) => s.reason !== "invalid_row");
      const skippedDuplicates = duplicateSkips.length;

      createAndEmitNotification({
        userId,
        companyId,
        type: "bank_import",
        ...notificationCopy(
          "notification.bankStatementImported.title",
          // A re-import that adds nothing (or skips some rows) says so, instead of "0 imported".
          created.length === 0 && skippedDuplicates > 0
            ? "notification.bankStatementNothingNew.message"
            : skippedDuplicates > 0
              ? "notification.bankStatementImportedSkipped.message"
              : "notification.bankStatementImported.message",
          {
            count: created.length,
            skipped: skippedDuplicates,
            bank: bankAccount.bankName,
          }
        ),
        priority: "normal",
        relatedEntityType: "bank_statement",
        actionUrl: "/bank-reconciliation",
      }).catch(() => {});

      res.status(201).json({
        imported: created.length,
        batchId: result.batchId,
        continuityWarning: result.continuityWarning,
        skippedDuplicates,
        skipped: result.plan.skipped.slice(0, 200).map(({ rowIndex, reason, detail }) => ({
          rowIndex,
          reason,
          detail,
        })),
        fileAlreadyImported: result.plan.fileAlreadyImported,
        fileFingerprint: parsedFile.fileFingerprint,
        detectedFormat: format,
        dateOrder: parsedFile.dateOrder,
        decimalSeparator: parsedFile.decimalSeparator,
        warnings: parsedFile.warnings.length > 0 ? parsedFile.warnings : undefined,
        parseErrors: parseErrors.length > 0 ? parseErrors : undefined,
        message:
          skippedDuplicates > 0
            ? `Imported ${created.length} new transaction(s); skipped ${skippedDuplicates} duplicate(s).`
            : `Imported ${created.length} transaction(s).`,
      });
    })
  );

  /** Import history per file (R06-22). */
  app.get(
    "/api/companies/:companyId/bank-statements/imports",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      await assertAccess(req, companyId);
      const bankAccountId =
        typeof req.query.bankAccountId === "string" ? req.query.bankAccountId : null;
      const rows = await db
        .select()
        .from(bankImportBatches)
        .where(
          bankAccountId && /^[0-9a-f-]{36}$/i.test(bankAccountId)
            ? and(
                eq(bankImportBatches.companyId, companyId),
                eq(bankImportBatches.bankAccountId, bankAccountId)
              )
            : eq(bankImportBatches.companyId, companyId)
        )
        .orderBy(desc(bankImportBatches.createdAt))
        .limit(200);
      res.json(rows);
    })
  );

  /** Undo an import: removes its unreconciled rows (reconciled rows stay). */
  app.post(
    "/api/companies/:companyId/bank-statements/imports/:batchId/undo",
    authMiddleware,
    requireCustomer,
    strictBody(emptyBody),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, batchId } = req.params;
      await assertAccess(req, companyId);
      res.json(await undoImportBatch({ companyId, batchId, actorId: actor(req), req }));
    })
  );

  // ─────────────────────────────────────────────────────────────
  // Reconciliation
  // ─────────────────────────────────────────────────────────────

  app.get(
    "/api/companies/:companyId/bank-statements/unreconciled",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      await assertAccess(req, companyId);
      const { bankAccountId } = req.query;
      let transactions = await storage.getUnreconciledBankTransactions(companyId);
      if (bankAccountId && typeof bankAccountId === "string") {
        transactions = transactions.filter((t) => t.bankStatementAccountId === bankAccountId);
      }
      res.json(transactions);
    })
  );

  /**
   * Match a bank line (R06-03, R06-05, R06-13, R06-21): invoice, bill, cash-side journal, receipt,
   * transfer, or a split across invoices / bills. Repeating the same match is a no-op.
   */
  app.post(
    "/api/companies/:companyId/bank-statements/:tid/match",
    authMiddleware,
    requireCustomer,
    requirePermission("ledger.post"),
    strictBody(bankMatchBody),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, tid } = req.params;
      await assertAccess(req, companyId);
      const body = parsedBody<BankMatchBody>(req);
      const result = await applyMatch({
        companyId,
        transactionId: tid,
        actorId: actor(req),
        target: targetFromBody(body),
        idempotencyKey: idempotencyKeyOf(req, body.idempotencyKey),
        req,
      });
      res.status(result.status === "replayed" ? 200 : 201).json({
        ...result.transaction,
        status: result.status,
        replayed: result.status === "replayed",
        matches: result.matches,
        journalEntryIds: result.journalEntryIds,
      });
    })
  );

  /**
   * Create a journal entry from a bank line through the ledger kernel: contra account, optional
   * 5% VAT split, bank fee and FX difference lines; postingMode draft creates an entry for review.
   */
  app.post(
    "/api/companies/:companyId/bank-statements/:tid/create-entry",
    authMiddleware,
    requireCustomer,
    requirePermission("ledger.post"),
    strictBody(bankCreateEntryBody),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, tid } = req.params;
      await assertAccess(req, companyId);
      const body = parsedBody<BankCreateEntryBody>(req);
      const result = await applyMatch({
        companyId,
        transactionId: tid,
        actorId: actor(req),
        idempotencyKey: idempotencyKeyOf(req, body.idempotencyKey),
        req,
        target: {
          kind: "entry",
          accountId: body.accountId,
          memo: body.memo ?? null,
          vatTreatment: body.vatTreatment,
          vatAmountFils: body.vatAmount,
          bankFeeFils: body.bankFee,
          bankFeeAccountId: body.bankFeeAccountId,
          contraAmountFils: body.contraAmount,
          costCenterId: body.costCenterId ?? null,
          postingMode: body.postingMode,
        },
      });
      const entryId = result.journalEntryIds[0] ?? null;
      const journalEntry = entryId ? await storage.getJournalEntry(entryId, companyId) : null;
      res.status(result.status === "replayed" ? 200 : 201).json({
        status: result.status,
        replayed: result.status === "replayed",
        journalEntry,
        bankTransaction: result.transaction,
        matches: result.matches,
      });
    })
  );

  /** Post the draft entry a review rule or create-entry draft left on the line. */
  app.post(
    "/api/companies/:companyId/bank-statements/:tid/confirm-entry",
    authMiddleware,
    requireCustomer,
    requirePermission("ledger.post"),
    strictBody(emptyBody),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, tid } = req.params;
      await assertAccess(req, companyId);
      const result = await confirmPendingEntry({
        companyId,
        transactionId: tid,
        actorId: actor(req),
        req,
      });
      res.json({
        ...result.transaction,
        matches: result.matches,
        journalEntryIds: result.journalEntryIds,
      });
    })
  );

  /**
   * Unmatch (R06-02): reverse what the match created (entries via reverseBySource, invoice / bill
   * payments) and put the line back on the worklist.
   */
  app.delete(
    "/api/companies/:companyId/bank-statements/:tid/match",
    authMiddleware,
    requireCustomer,
    requirePermission("ledger.post"),
    strictBody(unmatchBody),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, tid } = req.params;
      await assertAccess(req, companyId);
      const result = await unmatchTransaction({
        companyId,
        transactionId: tid,
        actorId: actor(req),
        reason: req.body?.reason,
        req,
      });
      res.json({
        ...result.transaction,
        reversedEntryIds: result.reversedEntryIds,
        reversedPayments: result.reversedPayments,
        unmatchedTransactionIds: result.unmatchedTransactionIds,
      });
    })
  );

  app.get(
    "/api/companies/:companyId/bank-statements/:tid/matches",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, tid } = req.params;
      await assertAccess(req, companyId);
      const txn = await storage.getBankTransactionById(tid, companyId);
      if (!txn) throw new DomainError("BANK_TRANSACTION_NOT_FOUND", 404);
      res.json(await getMatches(companyId, tid, ["pending", "active", "reversed"]));
    })
  );

  /** All lines (optionally one bank account; excluded rows with includeExcluded=true). */
  app.get(
    "/api/companies/:companyId/bank-statements/transactions",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      await assertAccess(req, companyId);
      const { bankAccountId, includeExcluded } = req.query;
      let transactions = await storage.getBankTransactionsByCompanyId(companyId);
      if (bankAccountId && typeof bankAccountId === "string") {
        transactions = transactions.filter((t) => t.bankStatementAccountId === bankAccountId);
      }
      if (includeExcluded !== "true") transactions = transactions.filter((t) => !t.excludedAt);
      res.json(transactions);
    })
  );

  app.get(
    "/api/companies/:companyId/bank-statements/:tid/suggestions",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, tid } = req.params;
      await assertAccess(req, companyId);
      const txn = await storage.getBankTransactionById(tid, companyId);
      if (!txn || txn.deletedAt) throw new DomainError("BANK_TRANSACTION_NOT_FOUND", 404);
      res.json(await getSuggestionsForTransaction(companyId, tid, 5));
    })
  );

  // ─── Edit / exclude / restore / delete (R06-22) ───────────────

  app.patch(
    "/api/companies/:companyId/bank-statements/:tid",
    authMiddleware,
    requireCustomer,
    strictBody(bankTransactionEditBody),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, tid } = req.params;
      await assertAccess(req, companyId);
      res.json(
        await editTransaction({
          companyId,
          transactionId: tid,
          actorId: actor(req),
          patch: req.body,
          req,
        })
      );
    })
  );

  app.post(
    "/api/companies/:companyId/bank-statements/:tid/exclude",
    authMiddleware,
    requireCustomer,
    strictBody(bankTransactionExcludeBody),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, tid } = req.params;
      await assertAccess(req, companyId);
      res.json(
        await setExcluded({
          companyId,
          transactionId: tid,
          actorId: actor(req),
          exclude: true,
          reason: req.body.reason,
          req,
        })
      );
    })
  );

  app.post(
    "/api/companies/:companyId/bank-statements/:tid/restore",
    authMiddleware,
    requireCustomer,
    strictBody(emptyBody),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, tid } = req.params;
      await assertAccess(req, companyId);
      res.json(
        await setExcluded({
          companyId,
          transactionId: tid,
          actorId: actor(req),
          exclude: false,
          req,
        })
      );
    })
  );

  app.delete(
    "/api/companies/:companyId/bank-statements/:tid",
    authMiddleware,
    requireCustomer,
    strictBody(bankTransactionDeleteBody),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, tid } = req.params;
      await assertAccess(req, companyId);
      const row = await softDeleteTransaction({
        companyId,
        transactionId: tid,
        actorId: actor(req),
        reason: req.body.reason,
        req,
      });
      res.json({ id: row.id, deletedAt: row.deletedAt });
    })
  );

  /**
   * Summary counts (R06-18): excluded / deleted rows are not part of the worklist; reconciled =
   * matched (one invariant, enforced by the database).
   */
  app.get(
    "/api/companies/:companyId/bank-statements/report",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      await assertAccess(req, companyId);
      const { from, to, bankAccountId } = req.query;
      let transactions = (await storage.getBankTransactionsByCompanyId(companyId)).filter(
        (t) => !t.excludedAt
      );
      if (bankAccountId && typeof bankAccountId === "string") {
        transactions = transactions.filter((t) => t.bankStatementAccountId === bankAccountId);
      }
      const fromIso = typeof from === "string" ? zDate.safeParse(from) : null;
      const toIso = typeof to === "string" ? zDate.safeParse(to) : null;
      if ((fromIso && !fromIso.success) || (toIso && !toIso.success))
        throw new DomainError("INVALID_REPORT_DATE", 400);
      const day = (d: Date | string) => new Date(d).toISOString().slice(0, 10);
      if (fromIso?.success)
        transactions = transactions.filter((t) => day(t.transactionDate) >= fromIso.data);
      if (toIso?.success)
        transactions = transactions.filter((t) => day(t.transactionDate) <= toIso.data);

      const reconciled = transactions.filter((t) => t.isReconciled && t.matchStatus === "matched");
      const unreconciled = transactions.filter((t) => !t.isReconciled);
      const suggested = unreconciled.filter((t) => t.matchStatus === "suggested");
      const sum = (xs: typeof transactions, sign: 1 | -1) =>
        xs
          .filter((t) => Math.sign(Number(t.amount)) === sign)
          .reduce((s, t) => s + Math.abs(dbFils(t.amount)), 0);
      const totalCredits = sum(transactions, 1);
      const totalDebits = sum(transactions, -1);
      const reconciledCredits = sum(reconciled, 1);
      const reconciledDebits = sum(reconciled, -1);
      const n = (f: number) => Number(fromFils(f));

      res.json({
        period: { from: from || null, to: to || null },
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
          totalCredits: n(totalCredits),
          totalDebits: n(totalDebits),
          netAmount: n(totalCredits - totalDebits),
          reconciledCredits: n(reconciledCredits),
          reconciledDebits: n(reconciledDebits),
          unreconciledCredits: n(totalCredits - reconciledCredits),
          unreconciledDebits: n(totalDebits - reconciledDebits),
        },
      });
    })
  );

  // ─────────────────────────────────────────────────────────────
  // Reconciliation statement + sign-off (R06-20)
  // ─────────────────────────────────────────────────────────────

  app.get(
    "/api/companies/:companyId/bank-accounts/:accountId/reconciliation-statement",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, accountId } = req.params;
      await assertAccess(req, companyId);
      const q = statementQuery(req);
      res.json(
        await buildReconciliationStatement({
          companyId,
          bankAccountId: accountId,
          periodEnd: q.periodEnd,
          periodStart: q.periodStart ?? null,
          statementClosingBalanceFils: q.statementClosingBalance,
        })
      );
    })
  );

  app.get(
    "/api/companies/:companyId/bank-accounts/:accountId/reconciliations",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, accountId } = req.params;
      await assertAccess(req, companyId);
      await ownedBankAccount(companyId, accountId);
      const rows = await db
        .select()
        .from(bankReconciliations)
        .where(
          and(
            eq(bankReconciliations.companyId, companyId),
            eq(bankReconciliations.bankAccountId, accountId)
          )
        )
        .orderBy(desc(bankReconciliations.periodEnd));
      res.json(rows.map((r: BankReconciliation) => ({ ...r, snapshot: undefined })));
    })
  );

  /** Save a statement snapshot (draft) for sign-off. */
  app.post(
    "/api/companies/:companyId/bank-accounts/:accountId/reconciliations",
    authMiddleware,
    requireCustomer,
    strictBody(reconciliationStatementBody),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, accountId } = req.params;
      await assertAccess(req, companyId);
      const body = parsedBody<ReconciliationStatementBody>(req);
      const statement = await buildReconciliationStatement({
        companyId,
        bankAccountId: accountId,
        periodEnd: body.periodEnd,
        periodStart: body.periodStart ?? null,
        statementClosingBalanceFils: body.statementClosingBalance,
      });
      const [row] = await db
        .insert(bankReconciliations)
        .values({
          companyId,
          bankAccountId: accountId,
          periodStart: body.periodStart ?? null,
          periodEnd: body.periodEnd,
          statementClosingBalance: Number(fromFils(statement.statementClosingBalanceFils)),
          glBalance: Number(fromFils(statement.glBalanceFils)),
          difference: Number(fromFils(statement.differenceFils)),
          snapshot: statement,
          status: "draft",
          createdBy: actor(req),
        })
        .returning();
      res.status(201).json({ ...row, statement });
    })
  );

  async function ownedReconciliation(companyId: string, id: string): Promise<BankReconciliation> {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
      throw new DomainError("RECONCILIATION_NOT_FOUND", 404);
    const [row] = await db
      .select()
      .from(bankReconciliations)
      .where(and(eq(bankReconciliations.id, id), eq(bankReconciliations.companyId, companyId)));
    if (!row)
      throw new DomainError("RECONCILIATION_NOT_FOUND", 404, undefined, "Reconciliation not found");
    return row as BankReconciliation;
  }

  /**
   * Sign-off: recomputed now; only a zero difference can be signed (422 RECONCILIATION_DIFFERENCE),
   * by someone other than the preparer unless the company has a single member.
   */
  app.post(
    "/api/companies/:companyId/bank-reconciliations/:reconciliationId/sign-off",
    authMiddleware,
    requireCustomer,
    requirePermission("ledger.post"),
    strictBody(emptyBody),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, reconciliationId } = req.params;
      await assertAccess(req, companyId);
      const rec = await ownedReconciliation(companyId, reconciliationId);
      if (rec.status === "signed_off") throw new DomainError("RECONCILIATION_SIGNED_OFF", 409);
      assertDifferentActor(rec.createdBy, actor(req), {
        allowSingleOwner: await companyHasSingleMember(companyId),
      });
      const statement = await buildReconciliationStatement({
        companyId,
        bankAccountId: rec.bankAccountId,
        periodEnd: rec.periodEnd,
        periodStart: rec.periodStart,
        statementClosingBalanceFils: dbFils(rec.statementClosingBalance),
      });
      if (statement.differenceFils !== 0) {
        throw new DomainError(
          "RECONCILIATION_DIFFERENCE",
          422,
          { difference: fromFils(statement.differenceFils) },
          "The statement does not reconcile; resolve the difference before signing off"
        );
      }
      const [row] = await db
        .update(bankReconciliations)
        .set({
          status: "signed_off",
          signedOffBy: actor(req),
          signedOffAt: new Date(),
          snapshot: statement,
          glBalance: Number(fromFils(statement.glBalanceFils)),
          difference: 0,
        })
        .where(and(eq(bankReconciliations.id, rec.id), eq(bankReconciliations.status, "draft")))
        .returning();
      if (!row) throw new DomainError("RECONCILIATION_SIGNED_OFF", 409);
      const { recordAudit } = await import("../services/audit.service");
      await recordAudit({
        userId: actor(req),
        companyId,
        action: "bank.reconciliation_sign_off",
        entityType: "bank_reconciliation",
        entityId: rec.id,
        after: { periodEnd: rec.periodEnd, glBalance: statement.totals.glBalance },
        req,
      });
      res.json({ ...row, statement });
    })
  );

  app.get(
    "/api/companies/:companyId/bank-reconciliations/:reconciliationId/export",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, reconciliationId } = req.params;
      await assertAccess(req, companyId);
      const rec = await ownedReconciliation(companyId, reconciliationId);
      const statement = rec.snapshot as unknown as Awaited<
        ReturnType<typeof buildReconciliationStatement>
      >;
      const company = await storage.getCompany(companyId);
      const format =
        req.query.format === "xlsx" ? "xlsx" : req.query.format === "csv" ? "csv" : "pdf";
      const base = `bank-reconciliation-${statement.bankAccountName}-${rec.periodEnd}`;
      if (format === "pdf") {
        const signer = rec.signedOffBy ? await storage.getUser(rec.signedOffBy) : undefined;
        const pdf = await renderReconciliationPdf(statement, {
          companyName: company?.name ?? "",
          locale: (company as { locale?: string | null } | undefined)?.locale ?? null,
          status: rec.status,
          signedOffBy: signer?.name ?? signer?.email ?? null,
          signedOffAt: rec.signedOffAt ? rec.signedOffAt.toISOString() : null,
        });
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${base.replace(/[^A-Za-z0-9._-]+/g, "-")}.pdf"`
        );
        return res.send(pdf);
      }
      await sendTabular(res, format, base, reconciliationSheets(statement, rec));
    })
  );
}
