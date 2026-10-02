// Pieces every bank-posting path shares: reading a bank line under its lock, refusing frozen or matched lines,
// resolving the bank GL account and the FX rate, and writing the match onto the row.

import { and, eq, sql } from "drizzle-orm";
import type { db } from "../db";
import { bankTransactions, type Account, type BankAccount, type BankTransaction } from "../../shared/schema";
import { AppError } from "../errors";
import { storage } from "../storage";
import { resolveDocumentExchangeRate } from "./document-fx-rate";
import { ACCOUNT_CODES } from "../constants";

export type Tx = typeof db;

export const appError = (status: number, code: string, message: string, details?: unknown): AppError =>
  new AppError({ message, statusCode: status, code, details });

/** assertPeriodNotLocked raises a generic 403; the bank screens answer with the specific PERIOD_LOCKED code. */
export function periodLockedCode(err: unknown): unknown {
  if (err instanceof AppError && err.statusCode === 403 && err.code === "APP_ERROR" && /locked period/i.test(err.message)) {
    return new AppError({ message: err.message, statusCode: 403, code: "PERIOD_LOCKED" });
  }
  return err;
}

export interface PostCtx {
  companyId: string;
  userId: string;
}

/** Account codes that only a document may move: a bank line settles them through an invoice, bill or VAT filing. */
const DOCUMENT_ONLY_CODES = new Set<string>([ACCOUNT_CODES.AR, ACCOUNT_CODES.AP, ACCOUNT_CODES.VAT_INPUT, ACCOUNT_CODES.VAT_OUTPUT]);

export const isBankOrCashAccount = (a: Pick<Account, "type" | "code" | "nameEn">, managedGlIds: Set<string> = new Set<string>(), id?: string): boolean =>
  // a credit card is a liability account that is managed as a bank account
  (a.type === "liability" && id !== undefined && managedGlIds.has(id)) ||
  (a.type === "asset" && ((id !== undefined && managedGlIds.has(id)) || ["1010", "1020", "1025"].includes(a.code) || /\b(bank|cash)\b/i.test(a.nameEn)));

export const isDocumentOnlyAccount = (a: Pick<Account, "code">): boolean => DOCUMENT_ONLY_CODES.has(a.code);

/** Re-read the bank line inside the lock. 404 when it is not this company's. */
export async function readTransaction(tx: Tx, companyId: string, transactionId: string): Promise<BankTransaction> {
  const [row] = await tx
    .select()
    .from(bankTransactions)
    .where(and(eq(bankTransactions.id, transactionId), eq(bankTransactions.companyId, companyId)));
  if (!row) throw appError(404, "BANK_TXN_NOT_FOUND", "Bank transaction not found");
  return row;
}

export function assertNotFrozen(txn: BankTransaction): void {
  if (txn.reconciliationId) {
    throw appError(409, "BANK_TXN_IN_COMPLETED_RECONCILIATION", "This bank line belongs to a completed reconciliation. Reopen that reconciliation first.");
  }
}

export function assertOpen(txn: BankTransaction): void {
  assertNotFrozen(txn);
  if (txn.matchStatus === "matched" || txn.isReconciled || txn.matchedJournalEntryId) {
    throw appError(409, "ALREADY_RECONCILED", "This bank transaction is already reconciled.", { matchedJournalEntryId: txn.matchedJournalEntryId ?? null });
  }
}

export interface BankContext {
  bank: BankAccount | undefined;
  glAccountId: string;
  currency: string;
}

/** The managed bank account, its GL account and currency. 422 BANK_GL_NOT_LINKED when no GL account is linked. */
export async function resolveBank(companyId: string, txn: BankTransaction): Promise<BankContext> {
  const bank = txn.bankStatementAccountId ? await storage.getBankAccountById(txn.bankStatementAccountId) : undefined;
  if (bank && bank.companyId !== companyId) throw appError(404, "BANK_ACCOUNT_NOT_FOUND", "Bank account not found");
  const glAccountId = txn.bankAccountId ?? bank?.glAccountId ?? null;
  if (!glAccountId) {
    throw appError(422, "BANK_GL_NOT_LINKED", "This bank account is not linked to a ledger account. Link it first (Bank accounts).");
  }
  return { bank, glAccountId, currency: (bank?.currency || "AED").toUpperCase() };
}

/** AED per unit of the bank currency on the bank date. 422 FX_RATE_MISSING when none is on file. */
export async function bankRate(companyId: string, currency: string, date: Date): Promise<number> {
  if (currency === "AED") return 1;
  const r = await resolveDocumentExchangeRate({ currency, date, companyId, hint: "Add one under Exchange Rates." });
  if (!r.ok) throw appError(422, "FX_RATE_MISSING", r.message);
  return r.rate;
}

/**
 * The rate a foreign-currency RECEIPT is booked at: the one the user typed, else the company's rate for the receipt day.
 * Null for an AED account (nothing to convert). The difference to the rate the invoice was booked at is realised FX.
 */
export async function receiptRate(companyId: string, currency: string, date: Date, requested?: number | null): Promise<number | null> {
  if (currency === "AED") return null;
  if (requested !== undefined && requested !== null) {
    if (!(Number(requested) > 0)) throw appError(422, "FX_RATE_INVALID", "The exchange rate must be above 0.");
    return Number(requested);
  }
  return await bankRate(companyId, currency, date);
}

/** Chosen account for a posting: this company's, active, not archived, not the bank account itself. */
export async function resolveContraAccount(companyId: string, accountId: string, bankGlAccountId: string): Promise<Account> {
  const account = await storage.getAccount(accountId, companyId);
  if (!account || account.isActive === false || account.isArchived === true) {
    throw appError(422, "ACCOUNT_INVALID", "The account must be an active account of this company.");
  }
  if (account.id === bankGlAccountId) throw appError(422, "ACCOUNT_INVALID", "The account cannot be the bank account itself.");
  if (isDocumentOnlyAccount(account)) {
    throw appError(422, "ACCOUNT_REQUIRES_DOCUMENT", `Account ${account.code} ${account.nameEn} is moved by invoices, bills and VAT filings. Match the bank line to the document instead.`);
  }
  return account;
}

export function matchPatch(userId: string, patch: Record<string, unknown>, confidence?: number | null) {
  return {
    isReconciled: true,
    matchStatus: "matched",
    matchConfidence: confidence != null ? confidence / 100 : null,
    reconciledAt: new Date(),
    reconciledBy: userId,
    suggestedRuleId: null,
    ...patch,
  };
}

export const clearedPatch = {
  isReconciled: false,
  matchStatus: "unmatched",
  matchedJournalEntryId: null,
  matchedReceiptId: null,
  matchedInvoiceId: null,
  matchedBillId: null,
  matchConfidence: null,
  reconciledAt: null,
  reconciledBy: null,
  suggestedRuleId: null,
} as const;

export const rowsOf = (res: any): any[] => (res?.rows ?? res) as any[];

/** SQL: the bank line `bt` is matched to the journal entry `je` (as its first entry or as one of several). */
export const linkedTo = (bt: string, je: string) =>
  sql.raw(`(${bt}.matched_journal_entry_id = ${je}.id OR EXISTS (SELECT 1 FROM bank_transaction_entries e_l WHERE e_l.bank_transaction_id = ${bt}.id AND e_l.journal_entry_id = ${je}.id))`);

export async function save(tx: Tx, ctx: PostCtx, txnId: string, patch: Record<string, unknown>): Promise<BankTransaction> {
  const [row] = await tx
    .update(bankTransactions)
    .set(patch)
    .where(and(eq(bankTransactions.id, txnId), eq(bankTransactions.companyId, ctx.companyId)))
    .returning();
  return row;
}


// ─── re-link a payment an earlier unmatch left in the ledger ───────────────

/**
 * A posted payment of this document, from this bank GL account, for exactly this amount, whose journal no bank line of
 * the same bank account links to. Returns its journal entry id.
 */
export async function findUnlinkedPaymentDetail(
  tx: Tx,
  a: {
    table: "invoice_payments" | "bill_payments";
    fk: "invoice_id" | "bill_id";
    documentId: string;
    companyId: string;
    glAccountId: string;
    /** exactly this amount; null = any amount up to maxAmount */
    amount: number | null;
    maxAmount?: number;
    source: string;
    txnId: string;
  }
): Promise<{ id: string; amount: number } | null> {
  const max = a.maxAmount ?? 1e12;
  const rows = rowsOf(
    await tx.execute(
      a.table === "invoice_payments"
        ? sql`
      SELECT je.id, p.amount::float8 AS amount FROM invoice_payments p
        JOIN journal_entries je ON je.id = p.journal_entry_id AND je.company_id = ${a.companyId}
       WHERE p.invoice_id = ${a.documentId} AND p.payment_account_id = ${a.glAccountId} AND (${a.amount}::numeric IS NULL OR ABS(p.amount - ${a.amount}::numeric) < 0.005) AND p.amount <= ${max}::numeric + 0.005
         AND je.status = 'posted' AND je.source = ${a.source}
         AND NOT EXISTS (SELECT 1 FROM journal_entries rv WHERE rv.reversed_entry_id = je.id AND rv.status = 'posted')
         AND NOT EXISTS (SELECT 1 FROM bank_transactions bt WHERE bt.company_id = je.company_id AND ${linkedTo("bt", "je")}
                          AND bt.bank_account_id = ${a.glAccountId} AND bt.id <> ${a.txnId})
       ORDER BY je.date LIMIT 1`
        : sql`
      SELECT je.id, p.amount::float8 AS amount FROM bill_payments p
        JOIN journal_entries je ON je.company_id = ${a.companyId} AND je.source = ${a.source} AND je.source_id = p.id
       WHERE p.bill_id = ${a.documentId} AND p.payment_account_id = ${a.glAccountId} AND (${a.amount}::numeric IS NULL OR ABS(p.amount - ${a.amount}::numeric) < 0.005) AND p.amount <= ${max}::numeric + 0.005
         AND je.status = 'posted'
         AND NOT EXISTS (SELECT 1 FROM journal_entries rv WHERE rv.reversed_entry_id = je.id AND rv.status = 'posted')
         AND NOT EXISTS (SELECT 1 FROM bank_transactions bt WHERE bt.company_id = je.company_id AND ${linkedTo("bt", "je")}
                          AND bt.bank_account_id = ${a.glAccountId} AND bt.id <> ${a.txnId})
       ORDER BY je.date LIMIT 1`
    )
  );
  return rows[0] ? { id: rows[0].id, amount: Number(rows[0].amount) } : null;
}

export async function findUnlinkedPayment(tx: Tx, a: Omit<Parameters<typeof findUnlinkedPaymentDetail>[1], "amount"> & { amount: number }): Promise<string | null> {
  return (await findUnlinkedPaymentDetail(tx, a))?.id ?? null;
}

