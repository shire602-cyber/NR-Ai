/**
 * Bank reconciliation service (W3-C). The ONE place that changes the reconciliation state of a
 * bank line and the ledger effect that goes with it.
 *
 *   applyMatch(...)        manual match, suggestions, auto-reconcile apply and rules
 *   unmatchTransaction(...) reverses exactly what the match created (R06-02)
 *
 * Targets (R06-03, R06-05, R06-13, R06-21):
 *   invoice  -> resolve("invoices.recordPayment") / unmatch resolve("invoices.reversePayment")
 *               (W3-A invoice-payment.service): Dr bank / Cr AR, invoice paid or partial
 *   bill     -> resolve("bills.recordPayment") / unmatch resolve("bills.reversePayment")
 *               (W3-B bill-payment.service); a missing service is a 503 SERVICE_UNAVAILABLE
 *   journal  -> link only when the entry has a line on THIS bank GL account for the same amount
 *               and direction (a revenue/AR entry never qualifies)
 *   receipt  -> link the receipt's posted entry under the same cash-side rule
 *   transfer -> one entry between the two bank GL accounts (optionally clearing the counterpart line)
 *   entry    -> a new entry through server/ledger (VAT split, bank fee, FX difference lines)
 *   rule     -> an entry from a reconciliation rule (posted, or a draft for review)
 *
 * Every apply locks the bank row (FOR UPDATE), requires is_reconciled = false, checks the period
 * lock, validates the target belongs to the company (404 otherwise) and records allocations in
 * bank_transaction_matches with an idempotency key. Journals are written only via server/ledger.
 */
import { randomUUID } from "node:crypto";
import type { Request } from "express";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, pool } from "../db";
import { DomainError } from "../errors";
import { storage } from "../storage";
import {
  deleteDraft,
  postJournal,
  postDraft,
  reverseBySource,
  reverseEntry,
  withLedgerTx,
} from "../ledger";
import type { LedgerTx, PostJournalLineInput } from "../ledger";
import { assertPeriodNotLocked } from "./period-lock.service";
import { has, resolve } from "../platform/service-registry";
import { createLogger } from "../config/logger";
import { ACCOUNT_CODES } from "../constants";
import { fromFils, mulRate, toFils } from "../../shared/money";
import {
  accounts as accountsTable,
  bankAccounts,
  bankImportBatches,
  bankTransactionMatches,
  bankTransactions,
  journalEntries,
  journalLines,
  reconciliationRules,
  type Account,
  type BankAccount,
  type BankTransaction,
  type BankTransactionMatch,
  type ReconciliationRule,
} from "../../shared/schema";
import type { VatTreatment } from "../../shared/validators/banking";

const log = createLogger("bank-reconciliation");

// ─── Small helpers ─────────────────────────────────────────────────────────

/** DB money (number, 2dp) -> integer fils. */
export function dbFils(value: number | string | null | undefined): number {
  if (value === null || value === undefined || value === "") return 0;
  return toFils(typeof value === "number" ? value : String(value), { rounding: "halfUp" });
}

function isoDate(d: Date | string): string {
  if (typeof d === "string") return d.slice(0, 10);
  return d.toISOString().slice(0, 10);
}

function notFound(code: string, message?: string): DomainError {
  return new DomainError(code, 404, undefined, message);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** An error safe to show to a user: never raw SQL (R06-16). */
export function publicErrorMessage(err: unknown): { code: string; message: string } {
  if (err instanceof DomainError) return { code: err.code ?? "ERROR", message: err.message };
  const e = err as { code?: unknown; message?: unknown; statusCode?: unknown };
  if (typeof e?.code === "string" && /^[A-Z][A-Z_]+$/.test(e.code)) {
    const msg =
      typeof e.message === "string" && !/select |insert |update |delete /i.test(e.message);
    return { code: e.code, message: msg ? String(e.message) : "The match could not be applied" };
  }
  return { code: "MATCH_FAILED", message: "The match could not be applied" };
}

/** Map a legacy coded error (recordInvoicePayment) onto a DomainError with a 4xx status. */
function asDomainError(err: unknown): unknown {
  if (err instanceof DomainError) return err;
  const e = err as { code?: unknown; message?: unknown; details?: unknown };
  const code = typeof e?.code === "string" ? e.code : "";
  const status: Record<string, number> = {
    INVOICE_NOT_FOUND: 404,
    INVOICE_COMPANY_MISMATCH: 404,
    INVOICE_TERMINAL: 409,
    CURRENCY_MISMATCH: 422,
    OVERPAYMENT: 422,
    PAYMENT_EXCEEDS_BALANCE: 422,
    BILL_NOT_FOUND: 404,
  };
  if (status[code])
    return new DomainError(
      code === "INVOICE_COMPANY_MISMATCH" ? "INVOICE_NOT_FOUND" : code,
      status[code],
      e.details,
      typeof e.message === "string" ? e.message : undefined
    );
  return err;
}

// ─── Bank accounts and GL resolution (R06-01) ──────────────────────────────

export interface ResolvedBank {
  bankAccount: BankAccount | null;
  glAccountId: string;
  glAccount: Account;
  currency: string;
  baseCurrency: string;
}

/** Next free code in the 1021..1029 series (then 1020-NN). */
async function nextBankGlCode(companyId: string): Promise<string> {
  const rows: Array<{ code: string }> = await db
    .select({ code: accountsTable.code })
    .from(accountsTable)
    .where(eq(accountsTable.companyId, companyId));
  const taken = new Set(rows.map((r) => r.code));
  for (let n = 1021; n <= 1029; n++) if (!taken.has(String(n))) return String(n);
  for (let n = 10; n < 1000; n++) {
    const code = `1020-${String(n).padStart(2, "0")}`;
    if (!taken.has(code)) return code;
  }
  throw new DomainError("BANK_GL_CODE_EXHAUSTED", 409);
}

/**
 * X5 (J1 D1): a dedicated bank GL account sits under the generic "1020 Bank Accounts" account,
 * which then becomes a header the kernel refuses to post to, so no payment can land on an
 * account the bank statement cannot match. 1020 is only adopted as the header while it is
 * unused (no bank account links to it and it carries no journal lines); otherwise the new
 * account stays top-level and the defaults alone route payments to the real bank account.
 */
async function bankHeaderParentId(companyId: string): Promise<string | null> {
  const { rows } = await pool.query(
    `SELECT a.id FROM accounts a
      WHERE a.company_id = $1 AND a.code = '1020' AND a.type = 'asset'
        AND a.is_active = true AND a.is_archived = false
        AND NOT EXISTS (SELECT 1 FROM bank_accounts ba WHERE ba.gl_account_id = a.id)
        AND NOT EXISTS (SELECT 1 FROM journal_lines jl WHERE jl.account_id = a.id)
      LIMIT 1`,
    [companyId]
  );
  return (rows[0]?.id as string | undefined) ?? null;
}

/** Create a dedicated GL account (asset, sub_type bank) for a managed bank account. */
export async function createBankGlAccount(
  companyId: string,
  input: { nameEn: string; currency: string }
): Promise<Account> {
  const code = await nextBankGlCode(companyId);
  const parentId = await bankHeaderParentId(companyId);
  return storage.createAccount({
    companyId,
    code,
    parentId,
    nameEn: `Bank - ${input.nameEn}`.slice(0, 200),
    nameAr: `بنك - ${input.nameEn}`.slice(0, 200),
    description: `GL account for bank account ${input.nameEn} (${input.currency})`,
    type: "asset",
    subType: "bank",
    isVatAccount: false,
    vatType: null,
    isSystemAccount: false,
    isActive: true,
  });
}

/** A GL account a bank account may link to: same company, active asset with sub_type bank/cash. */
export async function assertLinkableGlAccount(
  companyId: string,
  glAccountId: string
): Promise<Account> {
  const account = await storage.getAccount(glAccountId, companyId);
  if (!account) throw notFound("GL_ACCOUNT_NOT_FOUND", "GL account not found");
  if (!account.isActive || account.isArchived)
    throw new DomainError("GL_ACCOUNT_INACTIVE", 422, undefined, "GL account is inactive");
  if (account.type !== "asset" || !["bank", "cash"].includes(account.subType ?? "")) {
    throw new DomainError(
      "GL_ACCOUNT_NOT_BANK",
      422,
      { type: account.type, subType: account.subType },
      "A bank account must link to an asset GL account with sub-type bank or cash"
    );
  }
  return account;
}

/** Re-point unreconciled lines of a bank account at its current GL link. */
export async function syncUnreconciledGlLink(
  companyId: string,
  bankAccountId: string,
  glAccountId: string
): Promise<number> {
  const rows: Array<{ id: string }> = await db
    .update(bankTransactions)
    .set({ bankAccountId: glAccountId })
    .where(
      and(
        eq(bankTransactions.companyId, companyId),
        eq(bankTransactions.bankStatementAccountId, bankAccountId),
        eq(bankTransactions.isReconciled, false)
      )
    )
    .returning({ id: bankTransactions.id });
  return rows.length;
}

async function companyBaseCurrency(companyId: string): Promise<string> {
  const company = await storage.getCompany(companyId);
  return (company as { baseCurrency?: string | null } | undefined)?.baseCurrency || "AED";
}

/**
 * The GL account of a bank line, resolved NOW from its managed bank account (R06-01). Lines
 * without a managed account fall back to the cached GL column (legacy rows).
 */
export async function resolveBankGl(txn: BankTransaction): Promise<ResolvedBank> {
  const baseCurrency = await companyBaseCurrency(txn.companyId);
  let bankAccount: BankAccount | null = null;
  let glAccountId: string | null = null;
  if (txn.bankStatementAccountId) {
    const [row] = await db
      .select()
      .from(bankAccounts)
      .where(
        and(
          eq(bankAccounts.id, txn.bankStatementAccountId),
          eq(bankAccounts.companyId, txn.companyId)
        )
      );
    bankAccount = (row as BankAccount | undefined) ?? null;
    glAccountId = bankAccount?.glAccountId ?? null;
  }
  if (!glAccountId) glAccountId = txn.bankAccountId ?? null;
  if (!glAccountId) {
    throw new DomainError(
      "BANK_ACCOUNT_NOT_LINKED",
      409,
      { bankAccountId: txn.bankStatementAccountId },
      "The bank account of this line has no GL account. Link one on the Bank accounts page."
    );
  }
  const glAccount = await storage.getAccount(glAccountId, txn.companyId);
  if (!glAccount) throw notFound("GL_ACCOUNT_NOT_FOUND", "Bank GL account not found");
  return {
    bankAccount,
    glAccountId,
    glAccount,
    currency: bankAccount?.currency || baseCurrency,
    baseCurrency,
  };
}

// ─── Loading ───────────────────────────────────────────────────────────────

async function loadTxn(companyId: string, txnId: string, tx?: LedgerTx): Promise<BankTransaction> {
  if (!UUID_RE.test(txnId))
    throw notFound("BANK_TRANSACTION_NOT_FOUND", "Bank transaction not found");
  const [row] = await (tx ?? db)
    .select()
    .from(bankTransactions)
    .where(and(eq(bankTransactions.id, txnId), eq(bankTransactions.companyId, companyId)));
  if (!row || row.deletedAt)
    throw notFound("BANK_TRANSACTION_NOT_FOUND", "Bank transaction not found");
  return row as BankTransaction;
}

async function lockTxn(tx: LedgerTx, companyId: string, txnId: string): Promise<BankTransaction> {
  const [row] = await tx
    .select()
    .from(bankTransactions)
    .where(and(eq(bankTransactions.id, txnId), eq(bankTransactions.companyId, companyId)))
    .for("update");
  if (!row || row.deletedAt)
    throw notFound("BANK_TRANSACTION_NOT_FOUND", "Bank transaction not found");
  return row as BankTransaction;
}

export async function getMatches(
  companyId: string,
  txnId: string,
  statuses: Array<"pending" | "active" | "reversed"> = ["pending", "active"]
): Promise<BankTransactionMatch[]> {
  return db
    .select()
    .from(bankTransactionMatches)
    .where(
      and(
        eq(bankTransactionMatches.companyId, companyId),
        eq(bankTransactionMatches.bankTransactionId, txnId),
        inArray(bankTransactionMatches.status, statuses)
      )
    );
}

// ─── Targets ───────────────────────────────────────────────────────────────

export type MatchTarget =
  | { kind: "invoice"; id: string; amountFils?: number; exchangeRate?: number }
  | { kind: "bill"; id: string; amountFils?: number }
  | { kind: "journal"; id: string }
  | { kind: "receipt"; id: string }
  | { kind: "transfer"; id: string; counterpartTransactionId?: string }
  | {
      kind: "split";
      allocations: Array<{ type: "invoice" | "bill"; id: string; amountFils: number }>;
    }
  | ({ kind: "entry" } & CreateEntryOptions)
  | ({ kind: "rule"; ruleId: string } & CreateEntryOptions);

export interface CreateEntryOptions {
  accountId: string;
  memo?: string | null;
  vatTreatment?: VatTreatment;
  vatAmountFils?: number;
  bankFeeFils?: number;
  bankFeeAccountId?: string;
  contraAmountFils?: number;
  costCenterId?: string | null;
  postingMode?: "posted" | "draft";
}

export interface ApplyMatchInput {
  companyId: string;
  transactionId: string;
  actorId: string;
  target: MatchTarget;
  idempotencyKey?: string;
  req?: Request;
}

export interface ApplyMatchResult {
  status: "applied" | "replayed" | "pending_review";
  transaction: BankTransaction;
  matches: BankTransactionMatch[];
  journalEntryIds: string[];
}

interface PlannedAllocation {
  targetType: string;
  targetId: string | null;
  amountFils: number;
  journalEntryId: string | null;
  paymentId: string | null;
  accountId: string | null;
  createdJournal: boolean;
  status: "pending" | "active";
  vat?: BuiltEntry["vat"];
}

/** The cash-side rule: the entry must hit this bank GL account for the same amount and side. */
async function assertCashSideEntry(
  companyId: string,
  entryId: string,
  bankGlAccountId: string,
  absFils: number,
  inflow: boolean,
  what: "journal" | "receipt"
): Promise<void> {
  const [entry] = await db
    .select()
    .from(journalEntries)
    .where(and(eq(journalEntries.id, entryId), eq(journalEntries.companyId, companyId)));
  if (!entry) throw notFound("JOURNAL_ENTRY_NOT_FOUND", "Journal entry not found");
  if (entry.status !== "posted")
    throw new DomainError(
      "JOURNAL_NOT_POSTED",
      422,
      undefined,
      "Only posted entries can be matched"
    );
  if (entry.reversedByEntryId || entry.entryKind === "reversal")
    throw new DomainError("JOURNAL_REVERSED", 422, undefined, "The entry has been reversed");
  const lines: Array<{ accountId: string; debit: number; credit: number }> = await db
    .select({
      accountId: journalLines.accountId,
      debit: journalLines.debit,
      credit: journalLines.credit,
    })
    .from(journalLines)
    .where(eq(journalLines.entryId, entryId));
  const onBank = lines.filter((l) => l.accountId === bankGlAccountId);
  const net = onBank.reduce((s, l) => s + dbFils(l.debit) - dbFils(l.credit), 0);
  const expected = inflow ? absFils : -absFils;
  if (net !== expected) {
    throw new DomainError(
      what === "receipt" ? "RECEIPT_NOT_PAID_FROM_BANK" : "JOURNAL_NOT_CASH_SIDE",
      422,
      { bankGlAccountId, expectedFils: expected, entryBankNetFils: net },
      what === "receipt"
        ? "The receipt was not paid from this bank account for this amount"
        : "Only an entry with a line on this bank account for the same amount can be matched " +
            "(a sales or revenue entry is not a payment — match the invoice instead)"
    );
  }
  const [taken] = await db
    .select({ id: bankTransactionMatches.id })
    .from(bankTransactionMatches)
    .where(
      and(
        eq(bankTransactionMatches.companyId, companyId),
        eq(bankTransactionMatches.journalEntryId, entryId),
        inArray(bankTransactionMatches.status, ["active", "pending"])
      )
    )
    .limit(1);
  if (taken)
    throw new DomainError(
      "ENTRY_ALREADY_MATCHED",
      409,
      undefined,
      "That entry is already matched to another bank line"
    );
}

type RecordInvoicePayment = (input: {
  invoiceId: string;
  companyId: string;
  amount: number;
  date: Date;
  method?: string;
  reference?: string | null;
  notes?: string | null;
  paymentAccountId: string;
  paymentExchangeRate?: number | null;
  createdBy: string;
}) => Promise<{ payment: { id: string }; journalEntryId: string }>;

interface BillPaymentResult {
  payment?: { id?: string; journalEntryId?: string | null } | null;
  paymentId?: string;
  journalEntryId?: string | null;
  id?: string;
}
type RecordBillPayment = (input: {
  billId: string;
  companyId: string;
  amount: string;
  amountFils: number;
  date: string;
  paymentAccountId: string;
  reference?: string | null;
  notes?: string | null;
  method?: string;
  userId: string;
  actorId: string;
}) => Promise<BillPaymentResult>;
type ReverseBillPayment = (input: {
  companyId: string;
  paymentId: string;
  billId: string | null;
  actorId: string;
  reason: string;
  tx?: LedgerTx;
}) => Promise<unknown>;
type ReverseInvoicePayment = (input: {
  companyId: string;
  paymentId: string;
  actorId: string;
  reason: string;
  tx?: LedgerTx;
}) => Promise<unknown>;

async function recordInvoicePaymentFor(
  companyId: string,
  txn: BankTransaction,
  bank: ResolvedBank,
  invoiceId: string,
  amountFils: number,
  actorId: string,
  exchangeRate?: number
): Promise<{ paymentId: string; journalEntryId: string }> {
  const record = resolve<RecordInvoicePayment>("invoices.recordPayment");
  try {
    const result = await record({
      invoiceId,
      companyId,
      amount: Number(fromFils(amountFils)),
      date: new Date(`${isoDate(txn.transactionDate)}T00:00:00.000Z`),
      method: "bank_reconciliation",
      reference: txn.reference,
      notes: `Reconciled from bank statement: ${txn.description}`.slice(0, 500),
      paymentAccountId: bank.glAccountId,
      paymentExchangeRate: exchangeRate ?? null,
      createdBy: actorId,
    });
    return { paymentId: result.payment.id, journalEntryId: result.journalEntryId };
  } catch (err) {
    throw asDomainError(err);
  }
}

async function recordBillPaymentFor(
  companyId: string,
  txn: BankTransaction,
  bank: ResolvedBank,
  billId: string,
  amountFils: number,
  actorId: string
): Promise<{ paymentId: string | null; journalEntryId: string | null }> {
  const record = resolve<RecordBillPayment>("bills.recordPayment");
  try {
    const r = await record({
      billId,
      companyId,
      amount: fromFils(amountFils),
      amountFils,
      date: isoDate(txn.transactionDate),
      paymentAccountId: bank.glAccountId,
      reference: txn.reference,
      notes: `Reconciled from bank statement: ${txn.description}`.slice(0, 500),
      method: "bank_reconciliation",
      userId: actorId,
      actorId,
    });
    return {
      paymentId: r?.payment?.id ?? r?.paymentId ?? r?.id ?? null,
      journalEntryId: r?.journalEntryId ?? r?.payment?.journalEntryId ?? null,
    };
  } catch (err) {
    throw asDomainError(err);
  }
}

/**
 * Undo an invoice payment created by a bank match through W3-A's "invoices.reversePayment"
 * (kernel reversal of the payment journal, payment row removed, invoice status restored), inside
 * the caller's ledger transaction.
 */
async function reverseInvoicePayment(
  tx: LedgerTx,
  companyId: string,
  paymentId: string,
  actorId: string,
  reason: string
): Promise<void> {
  await resolve<ReverseInvoicePayment>("invoices.reversePayment")({
    companyId,
    paymentId,
    actorId,
    reason,
    tx,
  });
}

/** Undo a bill payment created by a bank match through W3-B's "bills.reversePayment". */
async function reverseBillPayment(
  tx: LedgerTx | undefined,
  companyId: string,
  paymentId: string,
  billId: string | null,
  actorId: string,
  reason: string
): Promise<void> {
  await resolve<ReverseBillPayment>("bills.reversePayment")({
    companyId,
    paymentId,
    billId,
    actorId,
    reason,
    tx,
  });
}

// ─── Entry builder (R06-21: VAT split, bank fee, FX difference) ────────────

interface BuiltEntry {
  lines: PostJournalLineInput[];
  contraAccountId: string;
  /**
   * A1 (H7/M8): what the VAT return reports for this entry. Net is signed: + a supply (inflow),
   * - a purchase (outflow). Null when the entry carries no VAT treatment.
   */
  vat: { treatment: VatTreatment; netFils: number; vatFils: number } | null;
}

async function accountIdByCode(companyId: string, code: string): Promise<string | null> {
  const [row] = await db
    .select({ id: accountsTable.id })
    .from(accountsTable)
    .where(and(eq(accountsTable.companyId, companyId), eq(accountsTable.code, code)));
  return row?.id ?? null;
}

async function assertPostableAccount(
  companyId: string,
  accountId: string,
  label: string
): Promise<Account> {
  const account = await storage.getAccount(accountId, companyId);
  if (!account) throw notFound("ACCOUNT_NOT_FOUND", `${label} not found`);
  if (!account.isActive || account.isArchived)
    throw new DomainError("ACCOUNT_INACTIVE", 422, undefined, `${label} is inactive`);
  return account;
}

export async function buildEntryLines(
  txn: BankTransaction,
  bank: ResolvedBank,
  opts: CreateEntryOptions
): Promise<BuiltEntry> {
  const companyId = txn.companyId;
  const contra = await assertPostableAccount(companyId, opts.accountId, "Account");
  if (contra.id === bank.glAccountId)
    throw new DomainError(
      "SAME_ACCOUNT_ENTRY",
      422,
      undefined,
      "Choose an account other than the bank account"
    );
  const inflow = Number(txn.amount) > 0;
  const absForeign = dbFils(Math.abs(Number(txn.amount)));
  if (absForeign <= 0)
    throw new DomainError("ZERO_AMOUNT_LINE", 422, undefined, "The bank line has no amount");
  const desc = txn.description.slice(0, 500);

  // Bank side (base currency; foreign amounts kept for a foreign-currency account).
  let bankBase = absForeign;
  const bankLine: PostJournalLineInput = {
    accountId: bank.glAccountId,
    description: desc,
  };
  if (bank.currency !== bank.baseCurrency) {
    if (!has("fx.getRate")) throw new DomainError("FX_UNAVAILABLE", 503);
    const getRate =
      resolve<
        (c: string, f: string, t: string, d: string) => Promise<{ rate: number; rateText: string }>
      >("fx.getRate");
    const r = await getRate(
      companyId,
      bank.currency,
      bank.baseCurrency,
      isoDate(txn.transactionDate)
    );
    bankBase = mulRate(absForeign, r.rateText);
    bankLine.foreignCurrency = bank.currency;
    bankLine.exchangeRate = r.rateText;
    if (inflow) bankLine.foreignDebit = fromFils(absForeign);
    else bankLine.foreignCredit = fromFils(absForeign);
  }
  if (inflow) bankLine.debitFils = bankBase;
  else bankLine.creditFils = bankBase;

  const lines: PostJournalLineInput[] = [bankLine];
  const fee = opts.bankFeeFils ?? 0;
  if (fee > 0) {
    const feeAccountId = opts.bankFeeAccountId ?? (await accountIdByCode(companyId, "5110"));
    if (!feeAccountId)
      throw new DomainError(
        "BANK_FEE_ACCOUNT_MISSING",
        422,
        undefined,
        "Choose a bank fee account"
      );
    await assertPostableAccount(companyId, feeAccountId, "Bank fee account");
    lines.push({
      accountId: feeAccountId,
      debitFils: fee,
      description: `Bank fee: ${desc}`.slice(0, 500),
    });
  }
  // Outflow: the bank line contains the fee. Inflow: the fee was deducted before crediting us.
  const gross = inflow ? bankBase + fee : bankBase - fee;
  if (gross <= 0)
    throw new DomainError(
      "BANK_FEE_TOO_LARGE",
      422,
      undefined,
      "The bank fee must be less than the amount"
    );

  const contraTotal = opts.contraAmountFils ?? gross;
  const fxDiff = gross - contraTotal; // > 0: bank moved more than the contra value
  if (fxDiff !== 0) {
    // Outflow paying more than the contra value is a loss; inflow receiving more is a gain.
    const isGain = inflow ? fxDiff > 0 : fxDiff < 0;
    const fxAccountId = await accountIdByCode(
      companyId,
      isGain ? ACCOUNT_CODES.FX_GAIN : ACCOUNT_CODES.FX_LOSS
    );
    if (!fxAccountId) throw new DomainError("FX_ACCOUNT_MISSING", 422);
    const amt = Math.abs(fxDiff);
    lines.push(
      isGain
        ? { accountId: fxAccountId, creditFils: amt, description: "FX difference" }
        : { accountId: fxAccountId, debitFils: amt, description: "FX difference" }
    );
  }

  const treatment = opts.vatTreatment ?? "none";
  let vat = 0;
  if (treatment === "standard") {
    vat = opts.vatAmountFils ?? Math.round((contraTotal * 5) / 105);
    if (vat >= contraTotal)
      throw new DomainError("VAT_TOO_LARGE", 422, undefined, "VAT must be less than the amount");
    const vatAccountId = await accountIdByCode(
      companyId,
      inflow ? ACCOUNT_CODES.VAT_OUTPUT : ACCOUNT_CODES.VAT_INPUT
    );
    if (!vatAccountId) throw new DomainError("VAT_ACCOUNT_MISSING", 422);
    if (vat > 0)
      lines.push(
        inflow
          ? {
              accountId: vatAccountId,
              creditFils: vat,
              description: `Output VAT 5%: ${desc}`.slice(0, 500),
            }
          : {
              accountId: vatAccountId,
              debitFils: vat,
              description: `Input VAT 5%: ${desc}`.slice(0, 500),
            }
      );
  }
  const net = contraTotal - vat;
  const vatRecord =
    treatment === "none" ? null : { treatment, netFils: inflow ? net : -net, vatFils: vat };
  lines.push(
    inflow
      ? {
          accountId: contra.id,
          creditFils: net,
          description: desc,
          costCenterId: opts.costCenterId ?? null,
        }
      : {
          accountId: contra.id,
          debitFils: net,
          description: desc,
          costCenterId: opts.costCenterId ?? null,
        }
  );
  return { lines, contraAccountId: contra.id, vat: vatRecord };
}

// ─── applyMatch ────────────────────────────────────────────────────────────

function targetSignature(t: MatchTarget): Array<{ type: string; id: string | null }> {
  switch (t.kind) {
    case "split":
      return t.allocations.map((a) => ({ type: a.type, id: a.id }));
    case "entry":
      return [{ type: "entry", id: null }];
    case "rule":
      return [{ type: "rule", id: t.ruleId }];
    default:
      return [{ type: t.kind, id: t.id }];
  }
}

function sameTarget(existing: BankTransactionMatch[], t: MatchTarget): boolean {
  if (t.kind === "entry") {
    // A repeated create-entry with the same contra account is a replay; another account is not.
    return (
      existing.length === 1 &&
      existing[0].targetType === "entry" &&
      existing[0].accountId === t.accountId
    );
  }
  const want = targetSignature(t);
  if (existing.length !== want.length) return false;
  return want.every((w) =>
    existing.some((e) => e.targetType === w.type && (w.id === null || e.targetId === w.id))
  );
}

async function findByIdempotencyKey(
  companyId: string,
  key: string
): Promise<BankTransactionMatch[]> {
  const [first] = await db
    .select()
    .from(bankTransactionMatches)
    .where(
      and(
        eq(bankTransactionMatches.companyId, companyId),
        eq(bankTransactionMatches.idempotencyKey, key)
      )
    );
  if (!first) return [];
  return db
    .select()
    .from(bankTransactionMatches)
    .where(eq(bankTransactionMatches.matchGroupId, first.matchGroupId));
}

async function assertMatchable(txn: BankTransaction): Promise<void> {
  if (txn.excludedAt)
    throw new DomainError(
      "TRANSACTION_EXCLUDED",
      409,
      undefined,
      "Restore the line before matching it"
    );
}

/**
 * Apply one match to a bank line. Returns status "replayed" (and changes nothing) when the line
 * is already matched to the same target or the idempotency key was used before.
 */
export async function applyMatch(input: ApplyMatchInput): Promise<ApplyMatchResult> {
  const { companyId, transactionId, actorId, target } = input;
  if (input.idempotencyKey) {
    const prior = await findByIdempotencyKey(companyId, input.idempotencyKey);
    if (prior.length > 0) {
      if (prior[0].bankTransactionId !== transactionId)
        throw new DomainError("IDEMPOTENCY_KEY_REUSED", 409);
      if (prior.every((m) => m.status === "reversed"))
        throw new DomainError(
          "IDEMPOTENCY_KEY_REUSED",
          409,
          undefined,
          "That match was unmatched; send a new idempotency key to match again"
        );
      const txn = await loadTxn(companyId, transactionId);
      return {
        status: "replayed",
        transaction: txn,
        matches: prior,
        journalEntryIds: prior.map((m) => m.journalEntryId).filter((x): x is string => !!x),
      };
    }
  }

  const txn = await loadTxn(companyId, transactionId);
  await assertMatchable(txn);
  const existing = await getMatches(companyId, transactionId);
  if (txn.isReconciled || existing.some((m) => m.status === "active")) {
    if (existing.length > 0 && sameTarget(existing, target)) {
      return {
        status: "replayed",
        transaction: txn,
        matches: existing,
        journalEntryIds: existing.map((m) => m.journalEntryId).filter((x): x is string => !!x),
      };
    }
    throw new DomainError(
      "ALREADY_RECONCILED",
      409,
      { matchedJournalEntryId: txn.matchedJournalEntryId ?? null },
      "This bank transaction is already reconciled. Unmatch it first."
    );
  }
  if (existing.some((m) => m.status === "pending")) {
    throw new DomainError(
      "MATCH_PENDING_REVIEW",
      409,
      undefined,
      "A draft entry for this line is waiting for review. Post or unmatch it first."
    );
  }

  await assertPeriodNotLocked(companyId, txn.transactionDate);
  const bank = await resolveBankGl(txn);
  const inflow = Number(txn.amount) > 0;
  const absFils = dbFils(Math.abs(Number(txn.amount)));
  const groupId = randomUUID();
  const idem = input.idempotencyKey ?? `bankmatch:${transactionId}:${groupId}`;

  // ── Validate targets before writing anything (404 for other-company / random ids) ──
  if (target.kind === "invoice" || target.kind === "split" || target.kind === "bill") {
    const allocs =
      target.kind === "split"
        ? target.allocations
        : [{ type: target.kind, id: target.id, amountFils: target.amountFils ?? absFils }];
    const total = allocs.reduce((s, a) => s + a.amountFils, 0);
    if (target.kind === "split" && total !== absFils) {
      throw new DomainError(
        "ALLOCATION_MISMATCH",
        422,
        { allocatedFils: total, bankFils: absFils },
        "Allocations must add up exactly to the bank amount"
      );
    }
    if (target.kind !== "split" && total > absFils) {
      throw new DomainError(
        "ALLOCATION_EXCEEDS_BANK",
        422,
        undefined,
        "Amount exceeds the bank line"
      );
    }
    const ids = new Set<string>();
    for (const a of allocs) {
      if (ids.has(a.id)) throw new DomainError("DUPLICATE_ALLOCATION", 422);
      ids.add(a.id);
      if (a.type === "invoice") {
        if (!inflow)
          throw new DomainError(
            "DIRECTION_MISMATCH",
            422,
            undefined,
            "An invoice can only match money received"
          );
        const inv = await storage.getInvoice(a.id, companyId);
        if (!inv) throw notFound("INVOICE_NOT_FOUND", "Invoice not found");
      } else {
        if (inflow)
          throw new DomainError(
            "DIRECTION_MISMATCH",
            422,
            undefined,
            "A bill can only match money paid out"
          );
        const { rows } = await pool.query(
          `SELECT id FROM vendor_bills WHERE id = $1 AND company_id = $2`,
          [a.id, companyId]
        );
        if (!rows[0]) throw notFound("BILL_NOT_FOUND", "Bill not found");
      }
    }
    return applyPaymentAllocations(input, txn, bank, allocs, groupId, idem);
  }

  let plan: PlannedAllocation[] = [];
  let ledgerWork: ((tx: LedgerTx) => Promise<PlannedAllocation[]>) | null = null;
  let counterpart: BankTransaction | null = null;

  if (target.kind === "journal") {
    await assertCashSideEntry(companyId, target.id, bank.glAccountId, absFils, inflow, "journal");
    plan = [
      {
        targetType: "journal",
        targetId: target.id,
        amountFils: absFils,
        journalEntryId: target.id,
        paymentId: null,
        accountId: null,
        createdJournal: false,
        status: "active",
      },
    ];
  } else if (target.kind === "receipt") {
    if (inflow)
      throw new DomainError(
        "DIRECTION_MISMATCH",
        422,
        undefined,
        "A receipt can only match money paid out"
      );
    const receipt = await storage.getReceipt(target.id, companyId);
    if (!receipt) throw notFound("RECEIPT_NOT_FOUND", "Receipt not found");
    if (!receipt.posted || !receipt.journalEntryId)
      throw new DomainError(
        "RECEIPT_NOT_POSTED",
        422,
        undefined,
        "Post the receipt before matching it"
      );
    await assertCashSideEntry(
      companyId,
      receipt.journalEntryId,
      bank.glAccountId,
      absFils,
      inflow,
      "receipt"
    );
    plan = [
      {
        targetType: "receipt",
        targetId: target.id,
        amountFils: absFils,
        journalEntryId: receipt.journalEntryId,
        paymentId: null,
        accountId: null,
        createdJournal: false,
        status: "active",
      },
    ];
  } else if (target.kind === "transfer") {
    if (!UUID_RE.test(target.id))
      throw notFound("BANK_ACCOUNT_NOT_FOUND", "Bank account not found");
    const [other] = await db
      .select()
      .from(bankAccounts)
      .where(and(eq(bankAccounts.id, target.id), eq(bankAccounts.companyId, companyId)));
    if (!other) throw notFound("BANK_ACCOUNT_NOT_FOUND", "Counterpart bank account not found");
    if (other.id === txn.bankStatementAccountId)
      throw new DomainError(
        "TRANSFER_SAME_ACCOUNT",
        422,
        undefined,
        "Choose a different bank account"
      );
    if (!other.glAccountId) throw new DomainError("BANK_ACCOUNT_NOT_LINKED", 409);
    if (other.glAccountId === bank.glAccountId)
      throw new DomainError(
        "TRANSFER_SAME_GL",
        422,
        undefined,
        "Both bank accounts use the same GL account"
      );
    if ((other.currency || bank.baseCurrency) !== bank.currency)
      throw new DomainError(
        "TRANSFER_CURRENCY_MISMATCH",
        422,
        undefined,
        "Transfers must be in one currency"
      );
    if (target.counterpartTransactionId) {
      counterpart = await loadTxn(companyId, target.counterpartTransactionId);
      if (counterpart.bankStatementAccountId !== other.id)
        throw new DomainError("COUNTERPART_ACCOUNT_MISMATCH", 422);
      if (dbFils(counterpart.amount) !== -dbFils(txn.amount))
        throw new DomainError(
          "COUNTERPART_AMOUNT_MISMATCH",
          422,
          undefined,
          "The counterpart amount must be opposite"
        );
      if (counterpart.isReconciled) throw new DomainError("COUNTERPART_ALREADY_RECONCILED", 409);
      await assertPeriodNotLocked(companyId, counterpart.transactionDate);
    }
    const otherGl = other.glAccountId;
    const cp = counterpart;
    ledgerWork = async (tx) => {
      const entry = await postJournal(
        {
          companyId,
          date: isoDate(txn.transactionDate),
          memo: `Transfer ${inflow ? "from" : "to"} ${other.nameEn}: ${txn.description}`.slice(
            0,
            500
          ),
          source: "bank_transfer",
          sourceId: txn.id,
          idempotencyKey: `bankmatch:${groupId}`,
          status: "posted",
          lines: [
            inflow
              ? {
                  accountId: bank.glAccountId,
                  debitFils: absFils,
                  description: txn.description.slice(0, 500),
                }
              : {
                  accountId: bank.glAccountId,
                  creditFils: absFils,
                  description: txn.description.slice(0, 500),
                },
            inflow
              ? {
                  accountId: otherGl,
                  creditFils: absFils,
                  description: txn.description.slice(0, 500),
                }
              : {
                  accountId: otherGl,
                  debitFils: absFils,
                  description: txn.description.slice(0, 500),
                },
          ],
        },
        { actorId, tx, audit: true }
      );
      const out: PlannedAllocation[] = [
        {
          targetType: "transfer",
          targetId: other.id,
          amountFils: absFils,
          journalEntryId: entry.entry.id,
          paymentId: null,
          accountId: otherGl,
          createdJournal: true,
          status: "active",
        },
      ];
      if (cp) {
        const locked = await lockTxn(tx, companyId, cp.id);
        if (locked.isReconciled) throw new DomainError("COUNTERPART_ALREADY_RECONCILED", 409);
        await tx
          .update(bankTransactions)
          .set({
            isReconciled: true,
            matchStatus: "matched",
            matchedType: "transfer",
            matchedJournalEntryId: entry.entry.id,
            matchConfidence: 1,
          })
          .where(and(eq(bankTransactions.id, cp.id), eq(bankTransactions.isReconciled, false)));
        await tx.insert(bankTransactionMatches).values({
          companyId,
          bankTransactionId: cp.id,
          matchGroupId: groupId,
          targetType: "transfer",
          targetId: txn.bankStatementAccountId,
          amount: Number(fromFils(absFils)),
          journalEntryId: entry.entry.id,
          accountId: bank.glAccountId,
          createdJournal: false,
          status: "active",
          idempotencyKey: `${idem}:counterpart`,
          createdBy: actorId,
        });
      }
      return out;
    };
  } else if (target.kind === "entry" || target.kind === "rule") {
    const built = await buildEntryLines(txn, bank, target);
    const draft = target.postingMode === "draft";
    let memo = target.memo || txn.description;
    if (target.vatTreatment && target.vatTreatment !== "none" && target.vatTreatment !== "standard")
      memo = `${memo} (VAT: ${target.vatTreatment})`;
    ledgerWork = async (tx) => {
      const entry = await postJournal(
        {
          companyId,
          date: isoDate(txn.transactionDate),
          memo: memo.slice(0, 500),
          reference: txn.reference ?? null,
          source: "bank_reconciliation",
          sourceId: txn.id,
          idempotencyKey: `bankmatch:${groupId}`,
          status: draft ? "draft" : "posted",
          lines: built.lines,
        },
        { actorId, tx, audit: true }
      );
      return [
        {
          targetType: target.kind,
          targetId: target.kind === "rule" ? target.ruleId : entry.entry.id,
          amountFils: absFils,
          journalEntryId: entry.entry.id,
          paymentId: null,
          accountId: built.contraAccountId,
          createdJournal: true,
          status: draft ? "pending" : "active",
          vat: built.vat,
        },
      ];
    };
  } else {
    throw new DomainError("INVALID_MATCH_TARGET", 400);
  }

  const result = await withLedgerTx(async (tx) => {
    const locked = await lockTxn(tx, companyId, transactionId);
    if (locked.isReconciled) throw new DomainError("ALREADY_RECONCILED", 409);
    if (locked.excludedAt) throw new DomainError("TRANSACTION_EXCLUDED", 409);
    const allocations = ledgerWork ? await ledgerWork(tx) : plan;
    const pending = allocations.every((a) => a.status === "pending");
    const inserted: BankTransactionMatch[] = [];
    for (const [i, a] of allocations.entries()) {
      const [row] = await tx
        .insert(bankTransactionMatches)
        .values({
          companyId,
          bankTransactionId: transactionId,
          matchGroupId: groupId,
          targetType: a.targetType,
          targetId: a.targetId,
          amount: Number(fromFils(a.amountFils)),
          journalEntryId: a.journalEntryId,
          paymentId: a.paymentId,
          accountId: a.accountId,
          createdJournal: a.createdJournal,
          vatTreatment: a.vat?.treatment ?? null,
          vatNetAmount: a.vat ? Number(fromFils(a.vat.netFils)) : null,
          vatAmount: a.vat ? Number(fromFils(a.vat.vatFils)) : null,
          status: a.status,
          idempotencyKey: i === 0 ? idem : `${idem}:${i}`,
          createdBy: actorId,
        })
        .returning();
      inserted.push(row as BankTransactionMatch);
    }
    const first = allocations[0];
    const [updated] = await tx
      .update(bankTransactions)
      .set({
        isReconciled: !pending,
        matchStatus: pending ? "suggested" : "matched",
        matchedType: first.targetType,
        matchedJournalEntryId: first.journalEntryId,
        matchedReceiptId: first.targetType === "receipt" ? first.targetId : null,
        matchedInvoiceId: null,
        matchConfidence: 1,
        bankAccountId: bank.glAccountId,
      })
      .where(
        and(
          eq(bankTransactions.id, transactionId),
          eq(bankTransactions.companyId, companyId),
          eq(bankTransactions.isReconciled, false)
        )
      )
      .returning();
    if (!updated) throw new DomainError("ALREADY_RECONCILED", 409);
    return { updated: updated as BankTransaction, inserted, pending };
  });

  if (target.kind === "rule") {
    await storage.incrementRuleAppliedCount(target.ruleId).catch(() => undefined);
  }
  await audit(input, "bank.reconcile", {
    before: { matchStatus: txn.matchStatus },
    after: {
      target: targetSignature(target),
      journalEntryIds: result.inserted.map((m) => m.journalEntryId),
      pendingReview: result.pending,
    },
  });
  return {
    status: result.pending ? "pending_review" : "applied",
    transaction: result.updated,
    matches: result.inserted,
    journalEntryIds: result.inserted.map((m) => m.journalEntryId).filter((x): x is string => !!x),
  };
}

/** Invoice / bill allocations: each payment posts through its own module, then the line is locked in. */
async function applyPaymentAllocations(
  input: ApplyMatchInput,
  txn: BankTransaction,
  bank: ResolvedBank,
  allocs: Array<{ type: string; id: string; amountFils: number }>,
  groupId: string,
  idem: string
): Promise<ApplyMatchResult> {
  const { companyId, actorId } = input;
  const done: PlannedAllocation[] = [];
  const exchangeRate = input.target.kind === "invoice" ? input.target.exchangeRate : undefined;
  const compensate = async () => {
    for (const a of done.reverse()) {
      try {
        if (a.targetType === "invoice" && a.paymentId) {
          await withLedgerTx((tx) =>
            reverseInvoicePayment(
              tx,
              companyId,
              a.paymentId as string,
              actorId,
              "Bank match rolled back"
            )
          );
        } else if (a.targetType === "bill" && a.paymentId) {
          await withLedgerTx((tx) =>
            reverseBillPayment(
              tx,
              companyId,
              a.paymentId as string,
              a.targetId,
              actorId,
              "Bank match rolled back"
            )
          );
        }
      } catch (err) {
        log.error(
          { err: (err as Error).message, allocation: a },
          "Compensation after failed match failed"
        );
      }
    }
  };

  // Lock the line first so two concurrent applies cannot both pay the invoice.
  const claim = await db
    .update(bankTransactions)
    .set({ matchStatus: "suggested", matchedType: "processing" })
    .where(
      and(
        eq(bankTransactions.id, txn.id),
        eq(bankTransactions.companyId, companyId),
        eq(bankTransactions.isReconciled, false),
        sql`(${bankTransactions.matchedType} IS DISTINCT FROM 'processing')`
      )
    )
    .returning({ id: bankTransactions.id });
  if (claim.length === 0) throw new DomainError("ALREADY_RECONCILED", 409);

  try {
    for (const a of allocs) {
      if (a.type === "invoice") {
        const r = await recordInvoicePaymentFor(
          companyId,
          txn,
          bank,
          a.id,
          a.amountFils,
          actorId,
          exchangeRate
        );
        done.push({
          targetType: "invoice",
          targetId: a.id,
          amountFils: a.amountFils,
          journalEntryId: r.journalEntryId,
          paymentId: r.paymentId,
          accountId: null,
          createdJournal: false,
          status: "active",
        });
      } else {
        const r = await recordBillPaymentFor(companyId, txn, bank, a.id, a.amountFils, actorId);
        done.push({
          targetType: "bill",
          targetId: a.id,
          amountFils: a.amountFils,
          journalEntryId: r.journalEntryId,
          paymentId: r.paymentId,
          accountId: null,
          createdJournal: false,
          status: "active",
        });
      }
    }
    const result = await withLedgerTx(async (tx) => {
      const inserted: BankTransactionMatch[] = [];
      for (const [i, a] of done.entries()) {
        const [row] = await tx
          .insert(bankTransactionMatches)
          .values({
            companyId,
            bankTransactionId: txn.id,
            matchGroupId: groupId,
            targetType: a.targetType,
            targetId: a.targetId,
            amount: Number(fromFils(a.amountFils)),
            journalEntryId: a.journalEntryId,
            paymentId: a.paymentId,
            accountId: null,
            createdJournal: false,
            status: "active",
            idempotencyKey: i === 0 ? idem : `${idem}:${i}`,
            createdBy: actorId,
          })
          .returning();
        inserted.push(row as BankTransactionMatch);
      }
      const first = done[0];
      const [updated] = await tx
        .update(bankTransactions)
        .set({
          isReconciled: true,
          matchStatus: "matched",
          matchedType: done.length > 1 ? "split" : first.targetType,
          matchedInvoiceId: first.targetType === "invoice" ? first.targetId : null,
          matchedJournalEntryId: first.journalEntryId,
          matchedReceiptId: null,
          matchConfidence: 1,
          bankAccountId: bank.glAccountId,
        })
        .where(and(eq(bankTransactions.id, txn.id), eq(bankTransactions.companyId, companyId)))
        .returning();
      return { updated: updated as BankTransaction, inserted };
    });
    await audit(input, "bank.reconcile", {
      before: { matchStatus: txn.matchStatus },
      after: { target: allocs.map((a) => ({ type: a.type, id: a.id, amountFils: a.amountFils })) },
    });
    return {
      status: "applied",
      transaction: result.updated,
      matches: result.inserted,
      journalEntryIds: result.inserted.map((m) => m.journalEntryId).filter((x): x is string => !!x),
    };
  } catch (err) {
    await compensate();
    await db
      .update(bankTransactions)
      .set({
        matchStatus: txn.matchStatus === "matched" ? "unmatched" : txn.matchStatus,
        matchedType: null,
      })
      .where(and(eq(bankTransactions.id, txn.id), eq(bankTransactions.isReconciled, false)));
    throw err;
  }
}

async function audit(
  input: { companyId: string; actorId: string; transactionId: string; req?: Request },
  action: string,
  payload: { before?: unknown; after?: unknown }
): Promise<void> {
  const { recordAudit } = await import("./audit.service");
  await recordAudit({
    userId: input.actorId,
    companyId: input.companyId,
    action,
    entityType: "bank_transaction",
    entityId: input.transactionId,
    before: payload.before ?? null,
    after: payload.after ?? null,
    req: input.req,
  });
}

// ─── Confirm a draft created for review ─────────────────────────────────────

export async function confirmPendingEntry(input: {
  companyId: string;
  transactionId: string;
  actorId: string;
  req?: Request;
}): Promise<ApplyMatchResult> {
  const { companyId, transactionId, actorId } = input;
  const txn = await loadTxn(companyId, transactionId);
  const pending = (await getMatches(companyId, transactionId, ["pending"]))[0];
  if (!pending || !pending.journalEntryId)
    throw new DomainError("NO_PENDING_ENTRY", 409, undefined, "There is no draft entry to post");
  await assertPeriodNotLocked(companyId, txn.transactionDate);
  const result = await withLedgerTx(async (tx) => {
    const locked = await lockTxn(tx, companyId, transactionId);
    if (locked.isReconciled) throw new DomainError("ALREADY_RECONCILED", 409);
    await postDraft(pending.journalEntryId as string, { actorId, tx, companyId, req: input.req });
    const [m] = await tx
      .update(bankTransactionMatches)
      .set({ status: "active" })
      .where(
        and(eq(bankTransactionMatches.id, pending.id), eq(bankTransactionMatches.status, "pending"))
      )
      .returning();
    const [updated] = await tx
      .update(bankTransactions)
      .set({ isReconciled: true, matchStatus: "matched" })
      .where(eq(bankTransactions.id, transactionId))
      .returning();
    return { m: m as BankTransactionMatch, updated: updated as BankTransaction };
  });
  await audit(input, "bank.reconcile_confirm_entry", {
    after: { journalEntryId: pending.journalEntryId },
  });
  return {
    status: "applied",
    transaction: result.updated,
    matches: [result.m],
    journalEntryIds: [pending.journalEntryId],
  };
}

// ─── Unmatch (R06-02) ──────────────────────────────────────────────────────

export interface UnmatchResult {
  transaction: BankTransaction;
  reversedEntryIds: string[];
  reversedPayments: string[];
  unmatchedTransactionIds: string[];
}

export async function unmatchTransaction(input: {
  companyId: string;
  transactionId: string;
  actorId: string;
  reason?: string;
  req?: Request;
}): Promise<UnmatchResult> {
  const { companyId, transactionId, actorId } = input;
  const reason = input.reason || "Bank line unmatched";
  const txn = await loadTxn(companyId, transactionId);
  const mine = await getMatches(companyId, transactionId);
  if (!txn.isReconciled && mine.length === 0 && txn.matchStatus !== "suggested") {
    throw new DomainError("NOT_MATCHED", 409, undefined, "This bank line is not matched");
  }
  await assertPeriodNotLocked(companyId, txn.transactionDate);

  // Whole groups go back together (a transfer also clears its counterpart line).
  const groupIds = [...new Set(mine.map((m) => m.matchGroupId))];
  const group: BankTransactionMatch[] =
    groupIds.length > 0
      ? await db
          .select()
          .from(bankTransactionMatches)
          .where(
            and(
              eq(bankTransactionMatches.companyId, companyId),
              inArray(bankTransactionMatches.matchGroupId, groupIds),
              inArray(bankTransactionMatches.status, ["pending", "active"])
            )
          )
      : [];
  const txnIds = [...new Set([transactionId, ...group.map((m) => m.bankTransactionId)])];
  for (const id of txnIds) {
    if (id === transactionId) continue;
    const other = await loadTxn(companyId, id);
    await assertPeriodNotLocked(companyId, other.transactionDate);
  }

  const reversedEntryIds: string[] = [];
  const reversedPayments: string[] = [];
  const result = await withLedgerTx(async (tx) => {
    for (const id of txnIds) await lockTxn(tx, companyId, id);
    // Clear the line first: it references the entries removed or reversed below.
    const rows: BankTransaction[] = await tx
      .update(bankTransactions)
      .set({
        isReconciled: false,
        matchStatus: "unmatched",
        matchedType: null,
        matchedJournalEntryId: null,
        matchedReceiptId: null,
        matchedInvoiceId: null,
        matchConfidence: null,
      })
      .where(and(eq(bankTransactions.companyId, companyId), inArray(bankTransactions.id, txnIds)))
      .returning();
    const reversedSources = new Set<string>();
    for (const m of group) {
      if (m.status === "pending" && m.journalEntryId) {
        // A draft created for review has no ledger effect: remove it so it cannot be posted later.
        // A draft someone has since posted is reversed instead.
        const [je] = await tx
          .select({ status: journalEntries.status })
          .from(journalEntries)
          .where(
            and(eq(journalEntries.id, m.journalEntryId), eq(journalEntries.companyId, companyId))
          );
        if (je?.status === "draft") {
          await deleteDraft(m.journalEntryId, { actorId, tx, companyId, req: input.req });
        } else if (je?.status === "posted") {
          await reverseEntry(
            m.journalEntryId,
            { reason },
            { actorId, tx, companyId, req: input.req }
          );
          reversedEntryIds.push(m.journalEntryId);
        }
      } else if (m.createdJournal && m.journalEntryId) {
        const [je] = await tx
          .select({ source: journalEntries.source, sourceId: journalEntries.sourceId })
          .from(journalEntries)
          .where(eq(journalEntries.id, m.journalEntryId));
        const key = `${je?.source}:${je?.sourceId}`;
        if (je?.sourceId && !reversedSources.has(key)) {
          reversedSources.add(key);
          const rev = await reverseBySource(
            companyId,
            je.source,
            je.sourceId,
            { reason },
            { actorId, tx, companyId, req: input.req }
          );
          for (const r of rev) reversedEntryIds.push(r.original.id);
        }
      } else if (m.targetType === "invoice" && m.paymentId) {
        await reverseInvoicePayment(tx, companyId, m.paymentId, actorId, reason);
        reversedPayments.push(m.paymentId);
        if (m.journalEntryId) reversedEntryIds.push(m.journalEntryId);
      } else if (m.targetType === "bill" && m.paymentId) {
        await reverseBillPayment(tx, companyId, m.paymentId, m.targetId, actorId, reason);
        reversedPayments.push(m.paymentId);
        if (m.journalEntryId) reversedEntryIds.push(m.journalEntryId);
      }
      await tx
        .update(bankTransactionMatches)
        .set({ status: "reversed", reversedAt: new Date(), reversedBy: actorId })
        .where(eq(bankTransactionMatches.id, m.id));
    }
    return rows.find((r) => r.id === transactionId) as BankTransaction;
  });
  await audit(input, "bank.unmatch", {
    before: { matchStatus: txn.matchStatus, matches: group.map((m) => m.id) },
    after: { reversedEntryIds, reversedPayments },
  });
  return {
    transaction: result,
    reversedEntryIds,
    reversedPayments,
    unmatchedTransactionIds: txnIds,
  };
}

// ─── Rules (R06-04, R06-15) ────────────────────────────────────────────────

export function ruleFieldValue(
  txn: { description: string; reference: string | null; amount: number },
  field: string
): string | null {
  switch (field) {
    case "description":
      return txn.description;
    case "reference":
      return txn.reference;
    case "amount":
      return fromFils(dbFils(Math.abs(Number(txn.amount))));
    default:
      return null;
  }
}

export function ruleMatches(
  rule: Pick<ReconciliationRule, "matchField" | "matchType" | "matchValue" | "direction">,
  txn: { description: string; reference: string | null; amount: number }
): boolean {
  const dir = rule.direction ?? "any";
  if (dir === "inflow" && !(Number(txn.amount) > 0)) return false;
  if (dir === "outflow" && !(Number(txn.amount) < 0)) return false;
  const value = ruleFieldValue(txn, rule.matchField);
  if (value === null || value === undefined) return false;
  const field = value.toLowerCase();
  const want =
    rule.matchField === "amount"
      ? fromFils(dbFils(rule.matchValue))
      : rule.matchValue.toLowerCase();
  switch (rule.matchType) {
    case "contains":
      return field.includes(want);
    case "exact":
      return field === want;
    case "starts_with":
      return field.startsWith(want);
    case "regex":
      try {
        return new RegExp(rule.matchValue, "i").test(value.slice(0, 2000));
      } catch {
        return false;
      }
    default:
      return false;
  }
}

export interface RuleRunResult {
  matched: number;
  posted: number;
  pendingReview: number;
  totalUnreconciled: number;
  rulesEvaluated: number;
  errors: Array<{ bankTransactionId: string; ruleId: string; code: string; message: string }>;
}

/** Apply active rules to unreconciled lines: each hit creates a real entry or a review draft. */
export async function runReconciliationRules(input: {
  companyId: string;
  actorId: string;
  req?: Request;
}): Promise<RuleRunResult> {
  const { companyId, actorId } = input;
  const rules: ReconciliationRule[] = (
    await db
      .select()
      .from(reconciliationRules)
      .where(
        and(eq(reconciliationRules.companyId, companyId), eq(reconciliationRules.isActive, true))
      )
  )
    .filter((r: ReconciliationRule) => !!r.accountId)
    .sort((a: ReconciliationRule, b: ReconciliationRule) => b.priority - a.priority);
  const lines: BankTransaction[] = await db
    .select()
    .from(bankTransactions)
    .where(
      and(
        eq(bankTransactions.companyId, companyId),
        eq(bankTransactions.isReconciled, false),
        isNull(bankTransactions.deletedAt),
        isNull(bankTransactions.excludedAt)
      )
    );
  const out: RuleRunResult = {
    matched: 0,
    posted: 0,
    pendingReview: 0,
    totalUnreconciled: lines.length,
    rulesEvaluated: rules.length,
    errors: [],
  };
  for (const txn of lines) {
    const rule = rules.find((r) => ruleMatches(r, txn));
    if (!rule) continue;
    try {
      const r = await applyMatch({
        companyId,
        transactionId: txn.id,
        actorId,
        req: input.req,
        // No fixed key: the row lock + is_reconciled check make a repeat run a no-op, and a
        // line that was unmatched must be able to match the rule again.
        target: {
          kind: "rule",
          ruleId: rule.id,
          accountId: rule.accountId as string,
          vatTreatment: (rule.vatTreatment as VatTreatment) ?? "none",
          memo: rule.memo || `${rule.name}: ${txn.description}`,
          postingMode: rule.requireReview ? "draft" : "posted",
        },
      });
      if (r.status === "replayed") continue;
      out.matched++;
      if (r.status === "pending_review") out.pendingReview++;
      else out.posted++;
      if (rule.category && !txn.category) {
        await db
          .update(bankTransactions)
          .set({ category: rule.category })
          .where(eq(bankTransactions.id, txn.id));
      }
    } catch (err) {
      const e = publicErrorMessage(err);
      out.errors.push({
        bankTransactionId: txn.id,
        ruleId: rule.id,
        code: e.code,
        message: e.message,
      });
    }
  }
  return out;
}

/** Normalised payee key: the leading alphabetic words of a description. */
export function payeeKey(description: string): string {
  return description
    .toUpperCase()
    .replace(/[^A-Z؀-ۿ ]+/g, " ")
    .split(/\s+/)
    .filter(
      (w) =>
        w.length > 2 &&
        ![
          "POS",
          "PURCHASE",
          "PAYMENT",
          "TRANSFER",
          "INWARD",
          "OUTWARD",
          "DEBIT",
          "CREDIT",
          "CARD",
          "THE",
        ].includes(w)
    )
    .slice(0, 2)
    .join(" ")
    .trim();
}

export interface RuleSuggestion {
  matchValue: string;
  accountId: string;
  accountCode: string | null;
  accountName: string | null;
  occurrences: number;
  direction: "inflow" | "outflow";
}

/** Payee memory: payees coded to the same account at least twice and not covered by a rule. */
export async function suggestRulesFromHistory(companyId: string): Promise<RuleSuggestion[]> {
  const { rows } = await pool.query(
    `SELECT bt.description, bt.amount::text AS amount, m.account_id, a.code, a.name_en
       FROM bank_transaction_matches m
       JOIN bank_transactions bt ON bt.id = m.bank_transaction_id
       LEFT JOIN accounts a ON a.id = m.account_id
      WHERE m.company_id = $1 AND m.status = 'active' AND m.target_type IN ('entry', 'rule')
        AND m.account_id IS NOT NULL`,
    [companyId]
  );
  const rules: ReconciliationRule[] = await db
    .select()
    .from(reconciliationRules)
    .where(eq(reconciliationRules.companyId, companyId));
  const groups = new Map<string, RuleSuggestion>();
  for (const r of rows as Array<{
    description: string;
    amount: string;
    account_id: string;
    code: string | null;
    name_en: string | null;
  }>) {
    const key = payeeKey(r.description);
    if (!key) continue;
    const direction = Number(r.amount) > 0 ? "inflow" : "outflow";
    const id = `${key}|${r.account_id}|${direction}`;
    const g = groups.get(id) ?? {
      matchValue: key.toLowerCase(),
      accountId: r.account_id,
      accountCode: r.code,
      accountName: r.name_en,
      occurrences: 0,
      direction,
    };
    g.occurrences++;
    groups.set(id, g);
  }
  return [...groups.values()]
    .filter((g) => g.occurrences >= 2)
    .filter(
      (g) =>
        !rules.some(
          (r) =>
            r.matchField === "description" &&
            ruleMatches(r, {
              description: g.matchValue,
              reference: null,
              amount: g.direction === "inflow" ? 1 : -1,
            })
        )
    )
    .sort((a, b) => b.occurrences - a.occurrences)
    .slice(0, 25);
}

// ─── Transactions: edit / exclude / delete / import history (R06-22) ────────

async function assertEditable(txn: BankTransaction): Promise<void> {
  if (txn.isReconciled || txn.matchStatus === "matched")
    throw new DomainError(
      "TRANSACTION_RECONCILED",
      409,
      undefined,
      "Unmatch the line before changing it"
    );
  const pending = await getMatches(txn.companyId, txn.id, ["pending", "active"]);
  if (pending.length > 0)
    throw new DomainError(
      "MATCH_PENDING_REVIEW",
      409,
      undefined,
      "Unmatch the line before changing it"
    );
}

export async function editTransaction(input: {
  companyId: string;
  transactionId: string;
  actorId: string;
  patch: { description?: string; category?: string | null; reference?: string | null };
  req?: Request;
}): Promise<BankTransaction> {
  const txn = await loadTxn(input.companyId, input.transactionId);
  await assertEditable(txn);
  const [row] = await db
    .update(bankTransactions)
    .set(input.patch)
    .where(
      and(
        eq(bankTransactions.id, txn.id),
        eq(bankTransactions.companyId, input.companyId),
        eq(bankTransactions.isReconciled, false)
      )
    )
    .returning();
  if (!row) throw new DomainError("TRANSACTION_RECONCILED", 409);
  await audit(input, "bank.transaction_edit", {
    before: { description: txn.description, category: txn.category, reference: txn.reference },
    after: input.patch,
  });
  return row as BankTransaction;
}

export async function setExcluded(input: {
  companyId: string;
  transactionId: string;
  actorId: string;
  exclude: boolean;
  reason?: string;
  req?: Request;
}): Promise<BankTransaction> {
  const txn = await loadTxn(input.companyId, input.transactionId);
  if (input.exclude) await assertEditable(txn);
  const [row] = await db
    .update(bankTransactions)
    .set(
      input.exclude
        ? {
            excludedAt: new Date(),
            excludedBy: input.actorId,
            excludeReason: input.reason ?? null,
            matchStatus: "unmatched",
          }
        : { excludedAt: null, excludedBy: null, excludeReason: null }
    )
    .where(
      and(
        eq(bankTransactions.id, txn.id),
        eq(bankTransactions.companyId, input.companyId),
        eq(bankTransactions.isReconciled, false)
      )
    )
    .returning();
  if (!row) throw new DomainError("TRANSACTION_RECONCILED", 409);
  await audit(input, input.exclude ? "bank.transaction_exclude" : "bank.transaction_restore", {
    after: { reason: input.reason ?? null },
  });
  return row as BankTransaction;
}

export async function softDeleteTransaction(input: {
  companyId: string;
  transactionId: string;
  actorId: string;
  reason: string;
  req?: Request;
}): Promise<BankTransaction> {
  const txn = await loadTxn(input.companyId, input.transactionId);
  await assertEditable(txn);
  const [row] = await db
    .update(bankTransactions)
    .set({
      deletedAt: new Date(),
      deletedBy: input.actorId,
      excludeReason: input.reason,
      matchStatus: "unmatched",
    })
    .where(
      and(
        eq(bankTransactions.id, txn.id),
        eq(bankTransactions.companyId, input.companyId),
        eq(bankTransactions.isReconciled, false)
      )
    )
    .returning();
  if (!row) throw new DomainError("TRANSACTION_RECONCILED", 409);
  await audit(input, "bank.transaction_delete", {
    before: { description: txn.description, amount: txn.amount, date: txn.transactionDate },
    after: { reason: input.reason },
  });
  return row as BankTransaction;
}

/** Undo an import: remove its unreconciled rows; reconciled rows stay (they have ledger effect). */
export async function undoImportBatch(input: {
  companyId: string;
  batchId: string;
  actorId: string;
  req?: Request;
}): Promise<{ removed: number; keptReconciled: number }> {
  if (!UUID_RE.test(input.batchId)) throw notFound("IMPORT_BATCH_NOT_FOUND");
  const [batch] = await db
    .select()
    .from(bankImportBatches)
    .where(
      and(eq(bankImportBatches.id, input.batchId), eq(bankImportBatches.companyId, input.companyId))
    );
  if (!batch) throw notFound("IMPORT_BATCH_NOT_FOUND", "Import not found");
  if (batch.status === "undone") throw new DomainError("IMPORT_ALREADY_UNDONE", 409);
  const result = await withLedgerTx(async (tx) => {
    const rows: Array<{ id: string; isReconciled: boolean }> = await tx
      .select({ id: bankTransactions.id, isReconciled: bankTransactions.isReconciled })
      .from(bankTransactions)
      .where(
        and(
          eq(bankTransactions.companyId, input.companyId),
          eq(bankTransactions.importBatchId, batch.id),
          isNull(bankTransactions.deletedAt)
        )
      );
    const removable = rows.filter((r) => !r.isReconciled).map((r) => r.id);
    let removed = 0;
    if (removable.length > 0) {
      const activeMatches: Array<{ id: string }> = await tx
        .select({ id: bankTransactionMatches.bankTransactionId })
        .from(bankTransactionMatches)
        .where(
          and(
            inArray(bankTransactionMatches.bankTransactionId, removable),
            inArray(bankTransactionMatches.status, ["pending", "active"])
          )
        );
      const blocked = new Set(activeMatches.map((m) => m.id));
      const ids = removable.filter((id) => !blocked.has(id));
      if (ids.length > 0) {
        const del = await tx
          .delete(bankTransactions)
          .where(
            and(
              eq(bankTransactions.companyId, input.companyId),
              inArray(bankTransactions.id, ids),
              eq(bankTransactions.isReconciled, false)
            )
          )
          .returning({ id: bankTransactions.id });
        removed = del.length;
      }
    }
    await tx
      .update(bankImportBatches)
      .set({
        status: "undone",
        undoneAt: new Date(),
        undoneBy: input.actorId,
        removedCount: removed,
      })
      .where(eq(bankImportBatches.id, batch.id));
    return { removed, keptReconciled: rows.length - removed };
  });
  const { recordAudit } = await import("./audit.service");
  await recordAudit({
    userId: input.actorId,
    companyId: input.companyId,
    action: "bank.import_undo",
    entityType: "bank_import_batch",
    entityId: batch.id,
    after: result,
    req: input.req,
  });
  return result;
}

/**
 * Opening-balance continuity: the first imported running balance should equal the previous
 * statement's closing balance (or the account opening balance). Returns a warning or null.
 */
export function continuityWarning(input: {
  previousBalanceFils: number | null;
  firstRow: { amountFils: number; balanceFils: number | null } | null;
}): string | null {
  if (input.previousBalanceFils === null || !input.firstRow || input.firstRow.balanceFils === null)
    return null;
  const expected = input.previousBalanceFils + input.firstRow.amountFils;
  if (expected === input.firstRow.balanceFils) return null;
  return `Opening balance does not continue from the previous statement: expected ${fromFils(expected)} after the first row, statement shows ${fromFils(input.firstRow.balanceFils)} (gap ${fromFils(input.firstRow.balanceFils - expected)}).`;
}

/** The balance the next statement should start from: last running balance, else opening + sum. */
export async function previousClosingBalanceFils(
  companyId: string,
  bankAccountId: string,
  beforeDate?: Date
): Promise<number | null> {
  const { rows } = await pool.query(
    `SELECT balance::text AS balance FROM bank_transactions
      WHERE company_id = $1 AND bank_statement_account_id = $2 AND deleted_at IS NULL
        AND balance IS NOT NULL AND ($3::timestamp IS NULL OR transaction_date < $3::timestamp)
      ORDER BY transaction_date DESC, created_at DESC LIMIT 1`,
    [companyId, bankAccountId, beforeDate ?? null]
  );
  if (rows[0]) return dbFils(rows[0].balance);
  return null;
}

// ─── Reconciliation statement (R06-20) ─────────────────────────────────────

export interface StatementItem {
  date: string;
  description: string;
  reference: string | null;
  amountFils: number;
  amount: string;
  source: "gl" | "bank";
  id: string;
}

export interface ReconciliationStatement {
  companyId: string;
  bankAccountId: string;
  bankAccountName: string;
  glAccountId: string;
  glAccountCode: string;
  currency: string;
  periodStart: string | null;
  periodEnd: string;
  statementClosingBalanceFils: number;
  glBalanceFils: number;
  depositsInTransit: StatementItem[];
  outstandingPayments: StatementItem[];
  unrecordedReceipts: StatementItem[];
  unrecordedPayments: StatementItem[];
  depositsInTransitFils: number;
  outstandingPaymentsFils: number;
  unrecordedReceiptsFils: number;
  unrecordedPaymentsFils: number;
  adjustedBankBalanceFils: number;
  adjustedBookBalanceFils: number;
  differenceFils: number;
  /** Display copies (2dp strings). */
  totals: Record<string, string>;
  generatedAt: string;
}

/**
 * Statement vs book (R06-20):
 *   adjusted bank = statement closing + deposits in transit - outstanding payments
 *   adjusted book = GL balance + bank receipts not in the books - bank payments not in the books
 *   difference    = adjusted bank - adjusted book (0 when reconciled)
 * Exported for the reports worker.
 */
export async function buildReconciliationStatement(input: {
  companyId: string;
  bankAccountId: string;
  periodEnd: string;
  periodStart?: string | null;
  statementClosingBalanceFils: number;
}): Promise<ReconciliationStatement> {
  const { companyId, bankAccountId, periodEnd } = input;
  if (!UUID_RE.test(bankAccountId))
    throw notFound("BANK_ACCOUNT_NOT_FOUND", "Bank account not found");
  const [ba] = await db
    .select()
    .from(bankAccounts)
    .where(and(eq(bankAccounts.id, bankAccountId), eq(bankAccounts.companyId, companyId)));
  if (!ba) throw notFound("BANK_ACCOUNT_NOT_FOUND", "Bank account not found");
  if (!ba.glAccountId) throw new DomainError("BANK_ACCOUNT_NOT_LINKED", 409);
  const gl = await storage.getAccount(ba.glAccountId, companyId);
  if (!gl) throw notFound("GL_ACCOUNT_NOT_FOUND");

  const { accountTotals } = await import("../reporting");
  const totals = await accountTotals(companyId, { to: periodEnd });
  const t = totals.get(ba.glAccountId);
  // Foreign-currency accounts reconcile in base currency here (GL is kept in base).
  const glBalanceFils = t ? t.debit - t.credit : 0;

  // GL lines on the bank account up to period end, and the entries cleared by bank lines dated
  // on or before period end.
  const { rows: glRows } = await pool.query(
    `SELECT je.id, ((je.date + interval '4 hours')::date)::text AS d, je.memo, je.reference,
            COALESCE(SUM(ROUND(jl.debit * 100)), 0)::bigint - COALESCE(SUM(ROUND(jl.credit * 100)), 0)::bigint AS net
       FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
      WHERE je.company_id = $1 AND je.status = 'posted' AND jl.account_id = $2
        AND ((je.date + interval '4 hours')::date) <= $3::date
      GROUP BY je.id, je.date, je.memo, je.reference`,
    [companyId, ba.glAccountId, periodEnd]
  );
  const { rows: cleared } = await pool.query(
    `SELECT DISTINCT m.journal_entry_id AS id
       FROM bank_transaction_matches m JOIN bank_transactions bt ON bt.id = m.bank_transaction_id
      WHERE m.company_id = $1 AND m.status = 'active' AND m.journal_entry_id IS NOT NULL
        AND bt.transaction_date::date <= $2::date AND bt.deleted_at IS NULL`,
    [companyId, periodEnd]
  );
  const clearedIds = new Set((cleared as Array<{ id: string }>).map((r) => r.id));
  // A reversal and its original net to zero: both count as cleared.
  const { rows: revPairs } = await pool.query(
    `SELECT o.id AS original, o.reversed_by_entry_id AS reversal
       FROM journal_entries o
      WHERE o.company_id = $1 AND o.reversed_by_entry_id IS NOT NULL`,
    [companyId]
  );
  const reversalOf = new Map<string, string>();
  for (const r of revPairs as Array<{ original: string; reversal: string }>) {
    reversalOf.set(r.original, r.reversal);
    reversalOf.set(r.reversal, r.original);
  }
  const glIds = new Set((glRows as Array<{ id: string }>).map((r) => r.id));

  const depositsInTransit: StatementItem[] = [];
  const outstandingPayments: StatementItem[] = [];
  for (const r of glRows as Array<{
    id: string;
    d: string;
    memo: string | null;
    reference: string | null;
    net: string;
  }>) {
    const net = Number(r.net);
    if (net === 0 || clearedIds.has(r.id)) continue;
    const pair = reversalOf.get(r.id);
    if (pair && glIds.has(pair) && !clearedIds.has(pair)) continue; // offsetting pair inside the period
    const item: StatementItem = {
      id: r.id,
      date: r.d,
      description: r.memo ?? "",
      reference: r.reference,
      amountFils: Math.abs(net),
      amount: fromFils(Math.abs(net)),
      source: "gl",
    };
    if (net > 0) depositsInTransit.push(item);
    else outstandingPayments.push(item);
  }

  const { rows: bankRows } = await pool.query(
    `SELECT id, transaction_date::date::text AS d, description, reference, amount::text AS amount
       FROM bank_transactions
      WHERE company_id = $1 AND bank_statement_account_id = $2 AND deleted_at IS NULL
        AND excluded_at IS NULL AND is_reconciled = false
        AND transaction_date::date <= $3::date
      ORDER BY transaction_date`,
    [companyId, bankAccountId, periodEnd]
  );
  const unrecordedReceipts: StatementItem[] = [];
  const unrecordedPayments: StatementItem[] = [];
  for (const r of bankRows as Array<{
    id: string;
    d: string;
    description: string;
    reference: string | null;
    amount: string;
  }>) {
    const f = dbFils(r.amount);
    const item: StatementItem = {
      id: r.id,
      date: r.d,
      description: r.description,
      reference: r.reference,
      amountFils: Math.abs(f),
      amount: fromFils(Math.abs(f)),
      source: "bank",
    };
    if (f > 0) unrecordedReceipts.push(item);
    else if (f < 0) unrecordedPayments.push(item);
  }
  const sum = (xs: StatementItem[]) => xs.reduce((s, x) => s + x.amountFils, 0);
  const dit = sum(depositsInTransit);
  const op = sum(outstandingPayments);
  const ur = sum(unrecordedReceipts);
  const up = sum(unrecordedPayments);
  const adjustedBank = input.statementClosingBalanceFils + dit - op;
  const adjustedBook = glBalanceFils + ur - up;
  const difference = adjustedBank - adjustedBook;
  return {
    companyId,
    bankAccountId,
    bankAccountName: ba.nameEn,
    glAccountId: ba.glAccountId,
    glAccountCode: gl.code,
    currency: ba.currency,
    periodStart: input.periodStart ?? null,
    periodEnd,
    statementClosingBalanceFils: input.statementClosingBalanceFils,
    glBalanceFils,
    depositsInTransit,
    outstandingPayments,
    unrecordedReceipts,
    unrecordedPayments,
    depositsInTransitFils: dit,
    outstandingPaymentsFils: op,
    unrecordedReceiptsFils: ur,
    unrecordedPaymentsFils: up,
    adjustedBankBalanceFils: adjustedBank,
    adjustedBookBalanceFils: adjustedBook,
    differenceFils: difference,
    totals: {
      statementClosingBalance: fromFils(input.statementClosingBalanceFils),
      glBalance: fromFils(glBalanceFils),
      depositsInTransit: fromFils(dit),
      outstandingPayments: fromFils(op),
      unrecordedReceipts: fromFils(ur),
      unrecordedPayments: fromFils(up),
      adjustedBankBalance: fromFils(adjustedBank),
      adjustedBookBalance: fromFils(adjustedBook),
      difference: fromFils(difference),
    },
    generatedAt: new Date().toISOString(),
  };
}

// ─── Statement exports (PDF via pdf-fonts, XLSX/CSV via the generic workbook) ───

export interface StatementExportMeta {
  companyName: string;
  locale: string | null;
  status: string;
  signedOffBy: string | null;
  signedOffAt: string | null;
}

export async function renderReconciliationPdf(
  st: ReconciliationStatement,
  meta: StatementExportMeta
): Promise<Buffer> {
  // @ts-expect-error - pdfkit has no type declarations
  const { default: PDFDocument } = await import("pdfkit");
  const { bilingual, pdfLocale, preparePdfDocument } = await import("./pdf-fonts");
  return new Promise((resolvePdf, reject) => {
    try {
      const doc = new PDFDocument({
        size: "A4",
        margin: 50,
        info: { Title: "Bank reconciliation" },
      });
      preparePdfDocument(doc);
      const chunks: Buffer[] = [];
      doc.on("data", (c: Buffer) => chunks.push(c));
      doc.on("end", () => resolvePdf(Buffer.concat(chunks)));
      doc.on("error", reject);
      const locale = pdfLocale({ locale: meta.locale });
      const L = (en: string, ar: string) => bilingual(locale, en, ar);
      const width = 495;
      doc
        .fontSize(16)
        .font("Helvetica-Bold")
        .text(L("Bank reconciliation statement", "كشف التسوية البنكية"), 50, 50, { width });
      doc.fontSize(10).font("Helvetica");
      doc.text(meta.companyName, { width });
      doc.text(`${st.bankAccountName} — GL ${st.glAccountCode} (${st.currency})`, { width });
      doc.text(
        `${L("Period end", "نهاية الفترة")}: ${st.periodEnd}${st.periodStart ? `  (${L("from", "من")} ${st.periodStart})` : ""}`,
        { width }
      );
      doc.moveDown();
      const row = (label: string, value: string, bold = false) => {
        const y = doc.y;
        doc.font(bold ? "Helvetica-Bold" : "Helvetica").text(label, 50, y, { width: 350 });
        doc.text(value, 410, y, { width: 135, align: "right" });
        doc.y = Math.max(doc.y, y + 14);
      };
      const section = (title: string, items: StatementItem[], total: string) => {
        doc.moveDown(0.5);
        doc.font("Helvetica-Bold").text(title, 50, doc.y, { width });
        for (const it of items.slice(0, 200)) {
          row(`  ${it.date}  ${it.description}`.slice(0, 90), it.amount);
        }
        row(L("Total", "الإجمالي"), total, true);
      };
      const t = st.totals;
      row(L("Balance per bank statement", "الرصيد حسب كشف البنك"), t.statementClosingBalance, true);
      section(
        L("Add: deposits in transit", "يضاف: إيداعات قيد التحصيل"),
        st.depositsInTransit,
        t.depositsInTransit
      );
      section(
        L("Less: outstanding payments", "يطرح: مدفوعات معلقة"),
        st.outstandingPayments,
        t.outstandingPayments
      );
      row(L("Adjusted bank balance", "رصيد البنك المعدل"), t.adjustedBankBalance, true);
      doc.moveDown();
      row(L("Balance per books (GL)", "الرصيد حسب الدفاتر"), t.glBalance, true);
      section(
        L("Add: bank receipts not in books", "يضاف: مقبوضات غير مسجلة"),
        st.unrecordedReceipts,
        t.unrecordedReceipts
      );
      section(
        L("Less: bank payments not in books", "يطرح: مدفوعات غير مسجلة"),
        st.unrecordedPayments,
        t.unrecordedPayments
      );
      row(L("Adjusted book balance", "رصيد الدفاتر المعدل"), t.adjustedBookBalance, true);
      doc.moveDown();
      row(L("Difference", "الفرق"), t.difference, true);
      doc.moveDown();
      doc
        .font("Helvetica")
        .text(
          meta.status === "signed_off"
            ? `${L("Signed off by", "اعتمد بواسطة")}: ${meta.signedOffBy ?? "-"}  ${meta.signedOffAt ?? ""}`
            : L("Draft — not signed off", "مسودة — غير معتمدة"),
          50,
          doc.y,
          { width }
        );
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

export function reconciliationSheets(
  st: ReconciliationStatement,
  rec: { status: string; signedOffAt: Date | null }
) {
  const t = st.totals;
  const summary: Array<[string, string]> = [
    ["Balance per bank statement", t.statementClosingBalance],
    ["Add: deposits in transit", t.depositsInTransit],
    ["Less: outstanding payments", t.outstandingPayments],
    ["Adjusted bank balance", t.adjustedBankBalance],
    ["Balance per books (GL)", t.glBalance],
    ["Add: bank receipts not in books", t.unrecordedReceipts],
    ["Less: bank payments not in books", t.unrecordedPayments],
    ["Adjusted book balance", t.adjustedBookBalance],
    ["Difference", t.difference],
    ["Status", rec.status],
    ["Signed off at", rec.signedOffAt ? new Date(rec.signedOffAt).toISOString() : ""],
  ];
  const items = [
    ...st.depositsInTransit.map((i) => ({ ...i, kind: "Deposit in transit" })),
    ...st.outstandingPayments.map((i) => ({ ...i, kind: "Outstanding payment" })),
    ...st.unrecordedReceipts.map((i) => ({ ...i, kind: "Bank receipt not in books" })),
    ...st.unrecordedPayments.map((i) => ({ ...i, kind: "Bank payment not in books" })),
  ];
  return [
    {
      sheetName: "Reconciliation",
      columns: [
        { header: `${st.bankAccountName} ${st.periodEnd}`, key: "label", width: 44 },
        { header: st.currency, key: "value", width: 18 },
      ],
      rows: summary.map(([label, value]) => ({
        label,
        value: /^-?\d+\.\d{2}$/.test(value) ? Number(value) : value,
      })),
    },
    {
      sheetName: "Outstanding items",
      columns: [
        { header: "Type", key: "kind", width: 26 },
        { header: "Date", key: "date", width: 12 },
        { header: "Description", key: "description", width: 44 },
        { header: "Reference", key: "reference", width: 18 },
        { header: "Amount", key: "amount", width: 14 },
      ],
      rows: items.map((i) => ({
        kind: i.kind,
        date: i.date,
        description: i.description,
        reference: i.reference ?? "",
        amount: Number(i.amount),
      })),
    },
  ];
}
