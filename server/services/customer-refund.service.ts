// Customer refunds: cash paid back to a customer against an issued credit note (see customer-refund.ts
// for the rules and the journal). The database half: reads, locks, the journal entry and the row.
//
// Locking. Refunds, credit-note creation, credit-note void and payments of one invoice all read "what is
// still owed / credited" and then write, so they take the same locks in the same order:
//   document queue + posting slot + advisory lock LOCK_NS.CREDIT_NOTE on the ORIGINAL invoice (withDocumentLock,
//   which runs through document-queue.ts runExclusive), then the invoice row FOR UPDATE (the row
//   recordInvoicePayment locks), then the shared month lock inside createJournalEntry. Everything between
//   the locks and the commit uses the transaction handle only, never the pool.
// The refund journal is a system entry (source "customer_refund"): read-only in the journal screens
// (journal-entry-protection.ts), undone only here, by voiding the refund.

import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { bankAccounts, customerRefunds, invoices, journalEntries, journalLines, type CustomerRefund } from "../../shared/schema";
import { isCashOrBankAccount } from "./financial-statements";
import { storage } from "../storage";
import { ACCOUNT_CODES } from "../constants";
import { AppError } from "../middleware/errorHandler";
import { LOCK_NS, withDocumentLock } from "./document-lock";
import { resolveSettlementDate } from "./payment-date-guard.service";
import { assertPeriodNotLocked } from "./period-lock.service";
import { resolveInvoiceFx } from "./invoice-fx";
import { uaeCalendarDate } from "../utils/date";
import {
  buildRefundJournalLines,
  buildRefundReversalLines,
  computeRefundable,
  evaluateRefund,
  type Refundable,
} from "./customer-refund";

export const CUSTOMER_REFUND_SOURCE = "customer_refund";

type Tx = typeof db;
const rowsOf = (res: any): any[] => (res?.rows ?? res) as any[];
const ymd = (d: Date | string): string => (d instanceof Date ? d.toISOString() : String(d)).slice(0, 10);
const refusal = (f: { status: number; code: string; message: string }) =>
  new AppError({ message: f.message, statusCode: f.status, code: f.code });

export interface RefundSummary extends Refundable {
  creditNoteId: string;
  currency: string;
  creditNoteTotal: number;
  refunded: number;
}

/** The ids whose AR entries make up one invoice's receivable: the invoice, its credit notes, their refunds. */
async function receivableCreditAed(tx: Tx, companyId: string, arAccountId: string, originalInvoiceId: string): Promise<number> {
  const res = await tx.execute(sql`
    WITH family AS (
      SELECT ${originalInvoiceId}::uuid AS id
      UNION ALL
      SELECT cn.id FROM invoices cn
       WHERE cn.company_id = ${companyId} AND cn.original_invoice_id = ${originalInvoiceId} AND cn.invoice_type = 'credit_note'
    )
    SELECT COALESCE(SUM(jl.debit - jl.credit), 0)::float8 AS net
      FROM journal_lines jl
      JOIN journal_entries je ON je.id = jl.entry_id
     WHERE je.company_id = ${companyId} AND je.status = 'posted' AND jl.account_id = ${arAccountId}
       AND ( (je.source IN ('invoice', 'payment') AND je.source_id IN (SELECT id FROM family))
          OR (je.source = ${CUSTOMER_REFUND_SOURCE}
              AND je.source_id IN (SELECT r.id FROM customer_refunds r WHERE r.credit_note_id IN (SELECT id FROM family))) )`);
  // A debit balance is money the customer owes; a CREDIT balance (net < 0) is what can be refunded.
  return Math.max(0, -(Number(rowsOf(res)[0]?.net) || 0));
}

async function liveRefundedTotal(tx: Tx, creditNoteId: string): Promise<number> {
  const res = await tx.execute(sql`
    SELECT COALESCE(SUM(amount), 0)::float8 AS total FROM customer_refunds
     WHERE credit_note_id = ${creditNoteId} AND voided_at IS NULL`);
  return Number(rowsOf(res)[0]?.total) || 0;
}

async function loadCreditNote(tx: Tx, companyId: string, creditNoteId: string) {
  const [cn] = await tx
    .select()
    .from(invoices)
    .where(and(eq(invoices.id, creditNoteId), eq(invoices.companyId, companyId)));
  if (!cn || cn.invoiceType !== "credit_note") {
    throw new AppError({ message: "Credit note not found", statusCode: 404, code: "CREDIT_NOTE_NOT_FOUND" });
  }
  return cn;
}

async function loadRefundAccounts(companyId: string): Promise<{ ar: string; gain: string | null; loss: string | null }> {
  const accounts = await storage.getAccountsByCompanyId(companyId);
  const ar = accounts.find((a) => a.code === ACCOUNT_CODES.AR && a.isSystemAccount);
  if (!ar) {
    throw new AppError({ message: "Accounts Receivable account not found", statusCode: 422, code: "CHART_OF_ACCOUNTS_MISSING" });
  }
  return {
    ar: ar.id,
    gain: accounts.find((a) => a.code === ACCOUNT_CODES.FX_GAIN)?.id ?? null,
    loss: accounts.find((a) => a.code === ACCOUNT_CODES.FX_LOSS)?.id ?? null,
  };
}

/** What a credit note has left to refund (read-only, for the screen and the list endpoint). */
export async function getRefundSummary(companyId: string, creditNoteId: string): Promise<RefundSummary> {
  const { ar } = await loadRefundAccounts(companyId);
  const cn = await loadCreditNote(db, companyId, creditNoteId);
  const refunded = await liveRefundedTotal(db, creditNoteId);
  const creditAed = await receivableCreditAed(db, companyId, ar, cn.originalInvoiceId ?? cn.id);
  const total = Math.abs(Number(cn.total) || 0);
  return {
    creditNoteId,
    currency: cn.currency,
    creditNoteTotal: total,
    refunded: Math.round(refunded * 100) / 100,
    ...computeRefundable({
      creditNoteTotal: total,
      refundedLive: refunded,
      receivableCreditAed: creditAed,
      creditNoteRate: resolveInvoiceFx(cn).rate,
    }),
  };
}

export async function listRefunds(companyId: string, creditNoteId: string): Promise<CustomerRefund[]> {
  return await db
    .select()
    .from(customerRefunds)
    .where(and(eq(customerRefunds.companyId, companyId), eq(customerRefunds.creditNoteId, creditNoteId)))
    .orderBy(desc(customerRefunds.createdAt));
}

export interface CreateRefundInput {
  companyId: string;
  creditNoteId: string;
  userId: string;
  amount: number;
  /** YYYY-MM-DD; default today (UAE). Not in the future, not in a locked period. */
  date?: string | null;
  bankAccountId: string;
  /** AED per unit on the refund date; needed to pay a foreign credit note from an account in another currency. */
  exchangeRate?: number | null;
  reference?: string | null;
  notes?: string | null;
}

/** Codes that are asset accounts but never where a refund is paid from: receivables and stock. */
const NEVER_REFUND_FROM = new Set<string>([ACCOUNT_CODES.AR, ACCOUNT_CODES.INVENTORY]);

/** A refund is paid from a cash or bank account: an asset account that is one, or is linked to a bank account record. */
export async function isRefundAccount(
  account: { id: string; type: string; code?: string | null; nameEn?: string | null; subType?: string | null },
  companyId: string
): Promise<boolean> {
  if (account.type !== "asset" || NEVER_REFUND_FROM.has(account.code ?? "")) return false;
  if (isCashOrBankAccount(account)) return true;
  const linked = await db
    .select({ id: bankAccounts.id })
    .from(bankAccounts)
    .where(and(eq(bankAccounts.companyId, companyId), eq(bankAccounts.glAccountId, account.id)))
    .limit(1);
  return linked.length > 0;
}

export async function createRefund(input: CreateRefundInput): Promise<{ refund: CustomerRefund; journalEntryId: string; remaining: number }> {
  const { companyId, creditNoteId } = input;

  // Everything that needs the pool is read BEFORE the transaction opens.
  const preliminary = await storage.getInvoice(creditNoteId, companyId);
  if (!preliminary || preliminary.invoiceType !== "credit_note") {
    throw new AppError({ message: "Credit note not found", statusCode: 404, code: "CREDIT_NOTE_NOT_FOUND" });
  }
  const bank = await storage.getAccount(input.bankAccountId, companyId);
  if (!bank || !(await isRefundAccount(bank, companyId))) {
    throw new AppError({
      message: "Invalid refund account: it must be a cash or bank account of this company (not Accounts Receivable or Inventory).",
      statusCode: 400,
      code: "INVALID_BANK_ACCOUNT",
    });
  }
  const bankCurrency = ((bank as any).currency as string | null | undefined) || null;
  const cnFx = resolveInvoiceFx(preliminary);
  const explicitRate = input.exchangeRate && input.exchangeRate > 0 ? input.exchangeRate : null;
  if (bankCurrency && bankCurrency.toUpperCase() !== cnFx.currency && !explicitRate) {
    throw new AppError({
      message: `Refund account currency (${bankCurrency}) does not match the credit note currency (${cnFx.currency}). Provide the refund-date exchange rate.`,
      statusCode: 422,
      code: "CURRENCY_MISMATCH",
    });
  }
  const accounts = await loadRefundAccounts(companyId);
  // Not in the future, and not into a locked period (the shared month lock re-checks inside the transaction).
  const { date: refundDate, ymd: refundYmd } = await resolveSettlementDate(companyId, { requested: input.date });
  const refundRate = explicitRate ?? cnFx.rate;
  const lockKey = preliminary.originalInvoiceId ?? preliminary.id;

  return await withDocumentLock(lockKey, LOCK_NS.CREDIT_NOTE, async (tx: Tx) => {
    // The invoice row: the same row a payment locks, so a payment cannot slip in between check and write.
    await tx.execute(sql`SELECT id FROM invoices WHERE id = ${lockKey} FOR UPDATE`);
    const cn = await loadCreditNote(tx, companyId, creditNoteId);
    // A credit note issued before it copied the customer carries no contact: the original invoice has it.
    let contactId: string | null = cn.contactId ?? null;
    if (!contactId && cn.originalInvoiceId) {
      const [orig] = await tx.select({ contactId: invoices.contactId }).from(invoices).where(eq(invoices.id, cn.originalInvoiceId));
      contactId = orig?.contactId ?? null;
    }
    const refundedLive = await liveRefundedTotal(tx, creditNoteId);
    const creditAed = await receivableCreditAed(tx, companyId, accounts.ar, lockKey);
    const failure = evaluateRefund({
      creditNoteStatus: cn.status,
      creditNoteType: cn.invoiceType ?? "invoice",
      creditNoteDate: ymd(cn.date),
      refundDate: refundYmd,
      creditNoteTotal: Math.abs(Number(cn.total) || 0),
      refundedLive,
      receivableCreditAed: creditAed,
      creditNoteRate: cnFx.rate,
      amount: input.amount,
    });
    if (failure) throw refusal(failure);

    const journal = buildRefundJournalLines({
      amount: input.amount,
      creditNoteRate: cnFx.rate,
      refundRate,
      bankAccountId: input.bankAccountId,
      receivableAccountId: accounts.ar,
      fxGainAccountId: accounts.gain,
      fxLossAccountId: accounts.loss,
      currency: cnFx.currency,
      label: `Refund of credit note ${cn.number}`,
    });
    if (!journal.ok) throw refusal(journal);

    const [refund] = await tx
      .insert(customerRefunds)
      .values({
        companyId,
        contactId,
        creditNoteId,
        amount: input.amount,
        currency: cnFx.currency,
        exchangeRate: refundRate,
        refundDate: refundYmd,
        bankAccountId: input.bankAccountId,
        reference: input.reference?.trim() || null,
        notes: input.notes?.trim() || null,
        createdBy: input.userId,
      })
      .returning();

    const entry = await storage.createJournalEntry(
      {
        companyId,
        date: refundDate,
        memo: `Refund of credit note ${cn.number} to ${cn.customerName}${input.reference ? ` - ${input.reference}` : ""}`,
        entryNumber: "PENDING", // assigned inside the transaction
        status: "posted",
        source: CUSTOMER_REFUND_SOURCE,
        sourceId: refund.id,
        createdBy: input.userId,
        postedBy: input.userId,
        postedAt: refundDate,
      } as any,
      journal.lines as any,
      { tx }
    );
    const [saved] = await tx
      .update(customerRefunds)
      .set({ journalEntryId: entry.id })
      .where(eq(customerRefunds.id, refund.id))
      .returning();

    const after = computeRefundable({
      creditNoteTotal: Math.abs(Number(cn.total) || 0),
      refundedLive: refundedLive + input.amount,
      receivableCreditAed: Math.max(0, creditAed - Math.round(input.amount * cnFx.rate * 100) / 100),
      creditNoteRate: cnFx.rate,
    });
    return { refund: saved, journalEntryId: entry.id, remaining: after.refundable };
  });
}

export async function voidRefund(args: {
  companyId: string;
  creditNoteId: string;
  refundId: string;
  userId: string;
}): Promise<{ refund: CustomerRefund; reversalEntryId: string }> {
  const { companyId, creditNoteId, refundId, userId } = args;
  const preliminary = await storage.getInvoice(creditNoteId, companyId);
  if (!preliminary || preliminary.invoiceType !== "credit_note") {
    throw new AppError({ message: "Credit note not found", statusCode: 404, code: "CREDIT_NOTE_NOT_FOUND" });
  }
  // The reversal is dated the UAE day of the void (like invoice void), and must not land in a locked period.
  const postedAtNow = new Date();
  const reversalDate = uaeCalendarDate(postedAtNow);
  await assertPeriodNotLocked(companyId, reversalDate);
  const lockKey = preliminary.originalInvoiceId ?? preliminary.id;

  return await withDocumentLock(lockKey, LOCK_NS.CREDIT_NOTE, async (tx: Tx) => {
    await tx.execute(sql`SELECT id FROM invoices WHERE id = ${lockKey} FOR UPDATE`);
    const locked = rowsOf(
      await tx.execute(sql`
        SELECT id FROM customer_refunds
         WHERE id = ${refundId} AND company_id = ${companyId} AND credit_note_id = ${creditNoteId} FOR UPDATE`)
    );
    if (locked.length === 0) {
      throw new AppError({ message: "Refund not found", statusCode: 404, code: "REFUND_NOT_FOUND" });
    }
    const [refund] = await tx.select().from(customerRefunds).where(eq(customerRefunds.id, refundId));
    if (refund.voidedAt) {
      throw new AppError({ message: "This refund is already void.", statusCode: 409, code: "REFUND_ALREADY_VOID" });
    }
    if (!refund.journalEntryId) {
      throw new AppError({ message: "This refund has no journal entry to reverse.", statusCode: 422, code: "NOTHING_TO_REVERSE" });
    }
    const [original] = await tx.select().from(journalEntries).where(eq(journalEntries.id, refund.journalEntryId));
    const posted = await tx.select().from(journalLines).where(eq(journalLines.entryId, refund.journalEntryId));
    const label = `Void refund of credit note ${preliminary.number}`;
    const lines = buildRefundReversalLines(
      posted.map((l: any) => ({ accountId: l.accountId, debit: Number(l.debit) || 0, credit: Number(l.credit) || 0, description: l.description })),
      label
    );
    if (lines.length === 0) {
      throw new AppError({ message: "The refund's journal entry has no lines to reverse.", statusCode: 422, code: "NOTHING_TO_REVERSE" });
    }
    const reversal = await storage.createJournalEntry(
      {
        companyId,
        date: reversalDate,
        memo: `${label} - reversal of ${original?.entryNumber ?? "original posting"}`,
        entryNumber: "PENDING",
        status: "posted",
        source: CUSTOMER_REFUND_SOURCE,
        sourceId: refundId,
        reversedEntryId: refund.journalEntryId,
        reversalReason: "Customer refund voided",
        createdBy: userId,
        postedBy: userId,
        postedAt: postedAtNow,
      } as any,
      lines as any,
      { tx }
    );
    const [saved] = await tx
      .update(customerRefunds)
      .set({ voidedAt: postedAtNow, voidJournalEntryId: reversal.id, updatedAt: postedAtNow })
      .where(eq(customerRefunds.id, refundId))
      .returning();
    return { refund: saved, reversalEntryId: reversal.id };
  });
}

/** Live refunds of a credit note, for the credit-note void guard (read inside the caller's transaction). */
export async function countLiveRefunds(tx: Tx, creditNoteId: string): Promise<number> {
  const res = await tx.execute(sql`
    SELECT COUNT(*)::int AS n FROM customer_refunds WHERE credit_note_id = ${creditNoteId} AND voided_at IS NULL`);
  return Number(rowsOf(res)[0]?.n) || 0;
}
