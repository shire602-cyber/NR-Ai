// FX revaluation of a foreign-currency bank balance (Teardown 7 F2).
//
//   adjustment (AED) = balance in the account's currency x closing rate  -  what the ledger carries it at (AED)
//
// A gain is Dr bank / Cr 4095, a loss Dr 4095 / Cr bank (4095: unrealised exchange gain/(loss), apart from the realised 4090 / 5140). The entry moves AED only: its bank line carries the account's
// currency with an amount of 0, so in the reconciliation (which compares currency amounts) it is a rate difference and
// never a deposit in transit. Like the open-document revaluation (exchange-rates.routes.ts) it is dated the as-of day
// and reversed automatically the next day, so nothing stacks: every run recomputes against what the ledger carries now.
// One entry per bank account and date (409 REVALUATION_ALREADY_POSTED), and the month-end checklist asks for it.

import { sql } from "drizzle-orm";
import { db } from "../db";
import { AppError } from "../errors";
import { storage } from "../storage";
import { dubaiDaySql } from "./vat-dubai-day";
import { uaeYmdParts } from "../utils/date";
import { LOCK_NS, withDocumentLock } from "./document-lock";
import { assertNotFutureDate, assertPeriodNotLocked } from "./period-lock.service";
import { computeBankReconciliationStatement } from "./bank-reconciliation.service";
import { bankRate } from "./bank-posting-common";
import { ensureUnrealisedFxAccount } from "./fx-unrealised-account";

export const BANK_REVALUATION_SOURCE = "fx_revaluation_bank";
export const BANK_REVALUATION_REVERSAL_SOURCE = "fx_revaluation_bank_reversal";

const r2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;
const rowsOf = (res: any): any[] => (res?.rows ?? res) as any[];
const err = (status: number, code: string, message: string, details?: unknown) => new AppError({ message, statusCode: status, code, details });
const isYmd = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const nextDay = (ymd: string): string => new Date(new Date(`${ymd}T00:00:00Z`).getTime() + 86400000).toISOString().slice(0, 10);

export interface BankRevaluationPreview {
  bankAccountId: string;
  bankAccountName: string;
  currency: string;
  asOf: string;
  /** The account's balance in its own currency at the date (the reconciliation's ledger balance). */
  foreignBalance: number;
  closingRate: number;
  /** What the ledger carries that balance at, in AED. */
  carryingAed: number;
  targetAed: number;
  /** Positive = unrealised gain (Dr bank / Cr 4090), negative = loss. */
  adjustmentAed: number;
  /** An entry for this account and date already exists. */
  alreadyPosted: boolean;
  existingEntry: { journalEntryId: string; entryNumber: string } | null;
  // the names the screens read: rate on file or typed, book value, value at the closing rate, and their difference
  rate: number;
  rateSource: "typed" | "rate_table";
  bookValueAed: number;
  closingValueAed: number;
  difference: number;
}

async function requireForeignBank(companyId: string, bankAccountId: string) {
  const account = await storage.getBankAccountById(bankAccountId);
  if (!account || account.companyId !== companyId) throw err(404, "BANK_ACCOUNT_NOT_FOUND", "Bank account not found");
  if (!account.glAccountId) throw err(422, "BANK_GL_NOT_LINKED", "This bank account is not linked to a ledger account.");
  const currency = (account.currency || "AED").toUpperCase();
  if (currency === "AED") throw err(422, "BANK_ACCOUNT_NOT_FOREIGN", "This account is in AED: there is nothing to revalue.");
  return { account, currency, glAccountId: account.glAccountId };
}

async function existingRevaluation(ex: Pick<typeof db, "execute">, companyId: string, bankAccountId: string, asOf: string) {
  const [row] = rowsOf(
    await ex.execute(sql`
      SELECT id, entry_number FROM journal_entries
       WHERE company_id = ${companyId} AND source = ${BANK_REVALUATION_SOURCE} AND source_id = ${bankAccountId} AND status <> 'void'
         AND ${sql.raw(dubaiDaySql("date"))} = ${asOf}::date
       LIMIT 1`)
  );
  return row ? { journalEntryId: String(row.id), entryNumber: String(row.entry_number) } : null;
}

export async function previewBankRevaluation(companyId: string, bankAccountId: string, asOf: string, rate?: number | null): Promise<BankRevaluationPreview> {
  if (!isYmd(asOf)) throw err(400, "VALIDATION_ERROR", "asOf must be a date (YYYY-MM-DD).");
  const { account, currency, glAccountId } = await requireForeignBank(companyId, bankAccountId);
  const closingRate = rate !== undefined && rate !== null ? Number(rate) : await bankRate(companyId, currency, new Date(`${asOf}T00:00:00Z`));
  if (!(closingRate > 0)) throw err(422, "FX_RATE_INVALID", "The exchange rate must be above 0.");
  const statement = await computeBankReconciliationStatement(companyId, bankAccountId, asOf);
  const [carry] = rowsOf(
    await db.execute(sql`
      SELECT COALESCE(SUM(jl.debit - jl.credit), 0)::float8 AS aed
        FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
       WHERE je.company_id = ${companyId} AND je.status = 'posted' AND jl.account_id = ${glAccountId}
         AND ${sql.raw(dubaiDaySql("je.date"))} <= ${asOf}::date`)
  );
  const foreignBalance = r2(statement.ledgerBalance);
  const carryingAed = r2(Number(carry?.aed) || 0);
  const targetAed = r2(foreignBalance * closingRate);
  const adjustmentAed = r2(targetAed - carryingAed);
  const existingEntry = await existingRevaluation(db, companyId, bankAccountId, asOf);
  return {
    bankAccountId,
    bankAccountName: account.nameEn,
    currency,
    asOf,
    foreignBalance,
    closingRate,
    carryingAed,
    targetAed,
    adjustmentAed,
    alreadyPosted: !!existingEntry,
    existingEntry,
    rate: closingRate,
    rateSource: rate !== undefined && rate !== null ? "typed" : "rate_table",
    bookValueAed: carryingAed,
    closingValueAed: targetAed,
    difference: adjustmentAed,
  };
}

export interface BankRevaluationResult extends BankRevaluationPreview {
  posted: boolean;
  journalEntryId: string | null;
  reversalEntryId: string | null;
  reversalDate: string | null;
  reason?: string;
}

export async function revalueBankAccount(args: { companyId: string; userId: string; bankAccountId: string; asOf: string; exchangeRate?: number | null }): Promise<BankRevaluationResult> {
  const { companyId, userId, bankAccountId, asOf } = args;
  if (!isYmd(asOf)) throw err(400, "VALIDATION_ERROR", "asOf must be a date (YYYY-MM-DD).");
  const asOfDate = new Date(`${asOf}T00:00:00.000Z`);
  const reversalYmd = nextDay(asOf);
  const reversalDate = new Date(`${reversalYmd}T00:00:00.000Z`);
  // a revaluation books a result that has not happened yet if it is dated in the future; a locked period is never written into
  assertNotFutureDate(asOfDate);
  await assertPeriodNotLocked(companyId, asOfDate);
  await assertPeriodNotLocked(companyId, reversalDate);

  const { glAccountId, currency } = await requireForeignBank(companyId, bankAccountId);

  return await withDocumentLock(`${companyId}:${bankAccountId}:${asOf}`, LOCK_NS.BANK_REVALUATION, async (tx) => {
    const preview = await previewBankRevaluation(companyId, bankAccountId, asOf, args.exchangeRate);
    if (preview.existingEntry) {
      throw err(409, "REVALUATION_ALREADY_POSTED", `A revaluation of ${preview.bankAccountName} for ${asOf} is already posted (entry ${preview.existingEntry.entryNumber}).`, { journalEntryId: preview.existingEntry.journalEntryId });
    }
    const adjustment = preview.adjustmentAed;
    if (Math.abs(adjustment) < 0.01) {
      return { ...preview, posted: false, journalEntryId: null, reversalEntryId: null, reversalDate: null, reason: "NO_DIFFERENCE" };
    }
    const unrealisedId = await ensureUnrealisedFxAccount(companyId);

    const amount = Math.abs(adjustment);
    const label = `Unrealised FX ${adjustment > 0 ? "gain" : "loss"} - ${preview.bankAccountName} (${currency} ${preview.foreignBalance.toFixed(2)} at ${preview.closingRate})`;
    // the bank line is in the account's currency with an amount of 0: a rate difference, not money moving
    const bankLeg = (debit: number, credit: number, text: string) => ({
      accountId: glAccountId,
      debit,
      credit,
      description: text,
      foreignCurrency: currency,
      foreignDebit: 0,
      foreignCredit: 0,
      exchangeRate: preview.closingRate,
    });
    const lines =
      adjustment > 0
        ? [bankLeg(amount, 0, label), { accountId: unrealisedId, debit: 0, credit: amount, description: label }]
        : [{ accountId: unrealisedId, debit: amount, credit: 0, description: label }, bankLeg(0, amount, label)];
    const entry = await storage.createJournalEntry(
      {
        companyId,
        date: asOfDate,
        memo: `Unrealised FX revaluation of ${preview.bankAccountName} as of ${asOf}`,
        entryNumber: "PENDING",
        status: "posted",
        source: BANK_REVALUATION_SOURCE,
        sourceId: bankAccountId,
        createdBy: userId,
        postedBy: userId,
        postedAt: new Date(),
      } as any,
      lines as any,
      { tx }
    );
    const reversal = await storage.createJournalEntry(
      {
        companyId,
        date: reversalDate,
        memo: `Reversal of unrealised FX revaluation of ${preview.bankAccountName} as of ${asOf}`,
        entryNumber: "PENDING",
        status: "posted",
        source: BANK_REVALUATION_REVERSAL_SOURCE,
        sourceId: bankAccountId,
        reversedEntryId: entry.id,
        reversalReason: "Automatic reversal of period-end unrealised FX revaluation",
        createdBy: userId,
        postedBy: userId,
        postedAt: new Date(),
      } as any,
      lines.map((l: any) => ({ ...l, debit: l.credit, credit: l.debit, description: `Reversal - ${l.description}` })) as any,
      { tx }
    );
    return { ...preview, posted: true, journalEntryId: entry.id, reversalEntryId: reversal.id, reversalDate: reversalYmd };
  });
}

/** Every active foreign-currency bank account with a ledger account, revalued at a date. One failing account does not stop the rest. */
export async function revalueAllBankAccounts(args: { companyId: string; userId: string; asOf: string }): Promise<BankRevaluationResult[] | Array<Record<string, unknown>>> {
  const banks = (await storage.getBankAccountsByCompanyId(args.companyId)).filter((b) => b.isActive !== false && b.glAccountId && (b.currency || "AED").toUpperCase() !== "AED");
  const results: Array<Record<string, unknown>> = [];
  for (const bank of banks) {
    try {
      const r = await revalueBankAccount({ ...args, bankAccountId: bank.id });
      results.push({ bankAccountId: bank.id, bankAccountName: bank.nameEn, currency: r.currency, posted: r.posted, adjustmentAed: r.adjustmentAed, journalEntryId: r.journalEntryId, reversalEntryId: r.reversalEntryId, reason: r.reason });
    } catch (e: any) {
      if (!(e instanceof AppError)) throw e;
      results.push({ bankAccountId: bank.id, bankAccountName: bank.nameEn, currency: (bank.currency || "AED").toUpperCase(), posted: false, reason: e.code, message: e.message });
    }
  }
  return results;
}

/**
 * Month-end checklist: is every foreign-currency bank account revalued at the period end? An account needs it when an
 * entry for the day is missing and its balance is carried at something other than the closing rate. A month that has not
 * ended yet is not asked for.
 */
export async function bankRevaluationChecklist(companyId: string, periodEnd: string): Promise<{ complete: boolean; details: string }> {
  const banks = (await storage.getBankAccountsByCompanyId(companyId)).filter((b) => b.isActive !== false && b.glAccountId && (b.currency || "AED").toUpperCase() !== "AED");
  if (banks.length === 0) return { complete: true, details: "No foreign-currency bank accounts" };
  const p = uaeYmdParts(new Date());
  const todayYmd = `${p.year}-${String(p.month + 1).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
  if (isYmd(periodEnd) && todayYmd < periodEnd) return { complete: true, details: "The month has not ended: foreign-currency bank accounts are revalued at the month end" };
  const open: string[] = [];
  for (const bank of banks) {
    try {
      const p = await previewBankRevaluation(companyId, bank.id, periodEnd);
      if (!p.alreadyPosted && Math.abs(p.adjustmentAed) >= 0.01) open.push(`${bank.nameEn} (${p.currency})`);
    } catch (e) {
      if (e instanceof AppError && e.code === "FX_RATE_MISSING") open.push(`${bank.nameEn} (${(bank.currency || "").toUpperCase()}: no rate)`);
      else throw e;
    }
  }
  return open.length === 0
    ? { complete: true, details: `${banks.length} foreign-currency bank account(s) revalued at ${periodEnd}` }
    : { complete: false, details: `Not revalued at ${periodEnd}: ${open.join(", ")}` };
}
