// Refund of a customer credit balance: money a customer paid in excess of an invoice (the overpayment is
// parked in 2050 Customer Advances / Deferred Revenue by the payment) paid back to them.
//
//   Dr 2050 Customer credit / Cr Bank or cash       dated the refund day, source "customer_credit_refund"
//
// Mirrors the credit-note refund (customer-refund.service.ts): locked per customer, the amount may not exceed
// the balance, a void keeps the row and posts the reversing entry. AED only: the credit is held in AED.

import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { customerCreditRefunds, journalEntries, journalLines, type CustomerCreditRefund } from "../../shared/schema";
import { storage } from "../storage";
import { ACCOUNT_CODES } from "../constants";
import { AppError } from "../middleware/errorHandler";
import { LOCK_NS, withDocumentLock } from "./document-lock";
import { resolveSettlementDate } from "./payment-date-guard.service";
import { assertPeriodNotLocked } from "./period-lock.service";
import { createRefund, getRefundSummary, isRefundAccount, voidRefund } from "./customer-refund.service";
import { ensureSystemAccount } from "./inventory-costing.service";
import { uaeCalendarDate } from "../utils/date";

export const CUSTOMER_CREDIT_REFUND_SOURCE = "customer_credit_refund";

type Tx = typeof db;
const rowsOf = (res: any): any[] => (res?.rows ?? res) as any[];
const round2 = (n: number) => Math.round(n * 100) / 100;

export interface CustomerCreditBalance {
  contactId: string;
  currency: "AED";
  /** Overpayments received into 2050 for this customer's invoices (net of payments undone). */
  received: number;
  refunded: number;
  available: number;
}

async function loadContact(tx: Tx, companyId: string, contactId: string) {
  const res = await tx.execute(sql`SELECT id, name FROM customer_contacts WHERE id = ${contactId} AND company_id = ${companyId}`);
  const contact = rowsOf(res)[0];
  if (!contact) throw new AppError({ message: "Customer not found", statusCode: 404, code: "CUSTOMER_NOT_FOUND" });
  return contact as { id: string; name: string };
}

async function balanceInTx(tx: Tx, companyId: string, contactId: string, name: string): Promise<CustomerCreditBalance> {
  const received = rowsOf(
    await tx.execute(sql`
      SELECT COALESCE(SUM(jl.credit - jl.debit), 0)::float8 AS net
        FROM journal_lines jl
        JOIN journal_entries je ON je.id = jl.entry_id
        JOIN accounts a ON a.id = jl.account_id
       WHERE je.company_id = ${companyId} AND je.status = 'posted' AND je.source = 'payment'
         AND a.company_id = ${companyId} AND a.code = ${ACCOUNT_CODES.DEFERRED_REVENUE}
         AND je.source_id::text IN (
           SELECT i.id::text FROM invoices i
            WHERE i.company_id = ${companyId}
              AND (i.contact_id = ${contactId} OR (i.contact_id IS NULL AND lower(i.customer_name) = lower(${name}))))`)
  )[0];
  const refunded = rowsOf(
    await tx.execute(sql`
      SELECT COALESCE(SUM(amount), 0)::float8 AS total FROM customer_credit_refunds
       WHERE company_id = ${companyId} AND contact_id = ${contactId} AND voided_at IS NULL`)
  )[0];
  const rec = round2(Number(received?.net) || 0);
  const ref = round2(Number(refunded?.total) || 0);
  return { contactId, currency: "AED", received: rec, refunded: ref, available: Math.max(0, round2(rec - ref)) };
}

/**
 * Every customer's unrefunded credit (overpayments held in 2050, net of refunds) as of a UAE day, for the receivables
 * ageing: the credit is shown as a negative line so ageing = AR 1040 - customer credit 2050.
 */
export async function customerCreditsAsOf(companyId: string, asOfYmd: string): Promise<Array<{ name: string; amount: number }>> {
  const res = await db.execute(sql`
    WITH rec AS (
      SELECT COALESCE(i.contact_id::text, 'n:' || lower(i.customer_name)) AS k,
             COALESCE(MAX(c.name), MAX(i.customer_name)) AS name,
             SUM(jl.credit - jl.debit) AS amt
        FROM journal_lines jl
        JOIN journal_entries je ON je.id = jl.entry_id
        JOIN accounts a ON a.id = jl.account_id
        JOIN invoices i ON i.id::text = je.source_id::text AND i.company_id = ${companyId}
        LEFT JOIN customer_contacts c ON c.id = i.contact_id
       WHERE je.company_id = ${companyId} AND je.status = 'posted' AND je.source = 'payment'
         AND a.company_id = ${companyId} AND a.code = ${ACCOUNT_CODES.DEFERRED_REVENUE}
         AND ((je.date + INTERVAL '4 hours')::date) <= ${asOfYmd}::date
       GROUP BY 1
    ), ref AS (
      SELECT contact_id::text AS k, SUM(amount) AS amt FROM customer_credit_refunds
       WHERE company_id = ${companyId} AND (voided_at IS NULL OR (voided_at + INTERVAL '4 hours')::date > ${asOfYmd}::date)
         AND refund_date <= ${asOfYmd}::date
       GROUP BY 1
    )
    SELECT rec.name, (rec.amt - COALESCE(ref.amt, 0))::float8 AS amount
      FROM rec LEFT JOIN ref ON ref.k = rec.k
     WHERE rec.amt - COALESCE(ref.amt, 0) > 0.004
     ORDER BY rec.name`);
  return rowsOf(res).map((r: any) => ({ name: String(r.name), amount: round2(Number(r.amount) || 0) }));
}

/** The AED credit notes of a customer's invoices that left a credit balance, with what each can still pay back. */
async function creditNoteCredits(companyId: string, contactId: string, name: string): Promise<Array<{ id: string; number: string; refundable: number }>> {
  const res = await db.execute(sql`
    SELECT cn.id, cn.number FROM invoices cn
      LEFT JOIN invoices orig ON orig.id = cn.original_invoice_id
     WHERE cn.company_id = ${companyId} AND cn.invoice_type = 'credit_note' AND cn.status NOT IN ('void', 'cancelled', 'draft')
       AND upper(cn.currency) = 'AED'
       AND (COALESCE(cn.contact_id, orig.contact_id) = ${contactId}
            OR (COALESCE(cn.contact_id, orig.contact_id) IS NULL AND lower(cn.customer_name) = lower(${name})))
     ORDER BY cn.created_at`);
  const out: Array<{ id: string; number: string; refundable: number }> = [];
  for (const row of rowsOf(res)) {
    const summary = await getRefundSummary(companyId, row.id);
    if (summary.refundable > 0.004) out.push({ id: row.id, number: row.number, refundable: summary.refundable });
  }
  return out;
}

/**
 * What the customer can be paid back: overpayments held in 2050 PLUS the credit balance credit notes left on paid
 * invoices (the same amount an invoice's payment-refunds POST pays back). One number for the dialog and the statement.
 */
export async function getCustomerCreditBalance(companyId: string, contactId: string): Promise<CustomerCreditBalance & { overpayment: number; creditNoteCredit: number }> {
  const contact = await loadContact(db, companyId, contactId);
  const base = await balanceInTx(db, companyId, contactId, contact.name);
  const creditNoteCredit = round2((await creditNoteCredits(companyId, contactId, contact.name)).reduce((a, c) => a + c.refundable, 0));
  return { ...base, overpayment: base.available, creditNoteCredit, available: round2(base.available + creditNoteCredit) };
}

export interface CustomerCreditRefundRow {
  id: string;
  amount: number;
  refundDate: string;
  reference: string | null;
  voidedAt: Date | string | null;
  kind: "overpayment" | "credit_note";
  creditNoteId?: string;
  creditNoteNumber?: string;
}

/** Every refund paid to the customer: out of overpayments, and out of credit-note credit; newest first. */
export async function listCustomerCreditRefunds(companyId: string, contactId: string): Promise<CustomerCreditRefundRow[]> {
  const over = await db
    .select()
    .from(customerCreditRefunds)
    .where(and(eq(customerCreditRefunds.companyId, companyId), eq(customerCreditRefunds.contactId, contactId)));
  const viaNotes = rowsOf(
    await db.execute(sql`
      SELECT r.id, r.amount::float8 AS amount, to_char(r.refund_date, 'YYYY-MM-DD') AS "refundDate", r.reference, r.voided_at AS "voidedAt",
             r.created_at AS "createdAt", cn.id AS "creditNoteId", cn.number AS "creditNoteNumber"
        FROM customer_refunds r JOIN invoices cn ON cn.id = r.credit_note_id
       WHERE r.company_id = ${companyId} AND upper(cn.currency) = 'AED'
         AND COALESCE(cn.contact_id, (SELECT o.contact_id FROM invoices o WHERE o.id = cn.original_invoice_id)) = ${contactId}`)
  );
  const rows: Array<CustomerCreditRefundRow & { createdAt: Date | string }> = [
    ...over.map((r: any) => ({ id: r.id, amount: Number(r.amount), refundDate: String(r.refundDate), reference: r.reference, voidedAt: r.voidedAt, kind: "overpayment" as const, createdAt: r.createdAt })),
    ...viaNotes.map((r: any) => ({ ...r, kind: "credit_note" as const })),
  ];
  return rows.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)).map(({ createdAt, ...rest }) => rest);
}

/** Pay the customer back: credit-note credit first (each against its credit note), then overpayments (Dr 2050). */
export async function refundCustomerCredit(input: {
  companyId: string;
  contactId: string;
  userId: string;
  amount: number;
  date?: string | null;
  bankAccountId: string;
  reference?: string | null;
  notes?: string | null;
}): Promise<{ refund: any; refunds: any[]; remaining: number }> {
  const { companyId, contactId } = input;
  const balance = await getCustomerCreditBalance(companyId, contactId);
  const amount = round2(input.amount);
  if (!(amount > 0)) throw new AppError({ message: "Refund amount must be greater than zero.", statusCode: 422, code: "INVALID_AMOUNT" });
  if (amount > balance.available + 0.005) {
    throw new AppError({
      message: `The refund (${amount.toFixed(2)}) is more than the credit balance of this customer (${balance.available.toFixed(2)} AED).`,
      statusCode: 422,
      code: "EXCEEDS_CREDIT_BALANCE",
    });
  }
  const contact = await loadContact(db, companyId, contactId);
  const refunds: any[] = [];
  let left = amount;
  for (const cn of await creditNoteCredits(companyId, contactId, contact.name)) {
    if (left <= 0.004) break;
    const part = round2(Math.min(left, cn.refundable));
    const out = await createRefund({
      companyId,
      creditNoteId: cn.id,
      userId: input.userId,
      amount: part,
      date: input.date,
      bankAccountId: input.bankAccountId,
      reference: input.reference,
      notes: input.notes,
    });
    refunds.push({ ...out.refund, creditNoteId: cn.id, creditNoteNumber: cn.number, kind: "credit_note" });
    left = round2(left - part);
  }
  if (left > 0.004) {
    const out = await createCustomerCreditRefund({ ...input, amount: left });
    refunds.push({ ...out.refund, kind: "overpayment" });
  }
  return { refund: refunds[0], refunds, remaining: round2(balance.available - amount) };
}

/** Void one refund of the customer: an overpayment refund (2050) or a refund of a credit note. */
export async function voidCustomerCreditRefundAny(args: { companyId: string; contactId: string; refundId: string; userId: string }) {
  const [over] = await db
    .select({ id: customerCreditRefunds.id })
    .from(customerCreditRefunds)
    .where(and(eq(customerCreditRefunds.id, args.refundId), eq(customerCreditRefunds.companyId, args.companyId), eq(customerCreditRefunds.contactId, args.contactId)));
  if (over) return await voidCustomerCreditRefund(args);
  const res = rowsOf(
    await db.execute(sql`
      SELECT r.credit_note_id AS "creditNoteId" FROM customer_refunds r JOIN invoices cn ON cn.id = r.credit_note_id
       WHERE r.id = ${args.refundId} AND r.company_id = ${args.companyId}
         AND COALESCE(cn.contact_id, (SELECT o.contact_id FROM invoices o WHERE o.id = cn.original_invoice_id)) = ${args.contactId}`)
  )[0];
  if (!res) throw new AppError({ message: "Refund not found", statusCode: 404, code: "REFUND_NOT_FOUND" });
  return await voidRefund({ companyId: args.companyId, creditNoteId: res.creditNoteId, refundId: args.refundId, userId: args.userId });
}

export async function createCustomerCreditRefund(input: {
  companyId: string;
  contactId: string;
  userId: string;
  amount: number;
  date?: string | null;
  bankAccountId: string;
  reference?: string | null;
  notes?: string | null;
}): Promise<{ refund: CustomerCreditRefund; journalEntryId: string; remaining: number }> {
  const { companyId, contactId } = input;
  const contact = await loadContact(db, companyId, contactId);
  const bank = await storage.getAccount(input.bankAccountId, companyId);
  if (!bank || !(await isRefundAccount(bank, companyId))) {
    throw new AppError({
      message: "Invalid refund account: it must be a cash or bank account of this company (not Accounts Receivable or Inventory).",
      statusCode: 400,
      code: "INVALID_BANK_ACCOUNT",
    });
  }
  const bankCurrency = (((bank as any).currency as string | null | undefined) || "AED").toUpperCase();
  if (bankCurrency !== "AED") {
    throw new AppError({ message: "A customer credit is held in AED: refund it from an AED account.", statusCode: 422, code: "CURRENCY_MISMATCH" });
  }
  const { date: refundDate, ymd: refundYmd } = await resolveSettlementDate(companyId, { requested: input.date });
  const credit = await ensureSystemAccount(db, companyId, ACCOUNT_CODES.DEFERRED_REVENUE, "liability");
  const amount = round2(input.amount);

  return await withDocumentLock(contactId, LOCK_NS.CREDIT_NOTE, async (tx: Tx) => {
    const balance = await balanceInTx(tx, companyId, contactId, contact.name);
    if (!(amount > 0)) throw new AppError({ message: "Refund amount must be greater than zero.", statusCode: 422, code: "INVALID_AMOUNT" });
    if (amount > balance.available + 0.005) {
      throw new AppError({
        message: `The refund (${amount.toFixed(2)}) is more than the credit balance of this customer (${balance.available.toFixed(2)} AED).`,
        statusCode: 422,
        code: "EXCEEDS_CREDIT_BALANCE",
      });
    }
    const [refund] = await tx
      .insert(customerCreditRefunds)
      .values({
        companyId,
        contactId,
        amount,
        refundDate: refundYmd,
        bankAccountId: input.bankAccountId,
        reference: input.reference?.trim() || null,
        notes: input.notes?.trim() || null,
        createdBy: input.userId,
      })
      .returning();
    const label = `Refund of customer credit - ${contact.name}`;
    const entry = await storage.createJournalEntry(
      {
        companyId,
        date: refundDate,
        memo: `${label}${input.reference ? ` - ${input.reference}` : ""}`,
        entryNumber: "PENDING",
        status: "posted",
        source: CUSTOMER_CREDIT_REFUND_SOURCE,
        sourceId: refund.id,
        createdBy: input.userId,
        postedBy: input.userId,
        postedAt: refundDate,
      } as any,
      [
        { accountId: credit.id, debit: amount, credit: 0, description: label },
        { accountId: input.bankAccountId, debit: 0, credit: amount, description: label },
      ] as any,
      { tx }
    );
    const [saved] = await tx.update(customerCreditRefunds).set({ journalEntryId: entry.id }).where(eq(customerCreditRefunds.id, refund.id)).returning();
    return { refund: saved, journalEntryId: entry.id, remaining: round2(balance.available - amount) };
  });
}

export async function voidCustomerCreditRefund(args: {
  companyId: string;
  contactId: string;
  refundId: string;
  userId: string;
}): Promise<{ refund: CustomerCreditRefund; reversalEntryId: string }> {
  const { companyId, contactId, refundId, userId } = args;
  await loadContact(db, companyId, contactId);
  const postedAtNow = new Date();
  const reversalDate = uaeCalendarDate(postedAtNow);
  await assertPeriodNotLocked(companyId, reversalDate);

  return await withDocumentLock(contactId, LOCK_NS.CREDIT_NOTE, async (tx: Tx) => {
    const locked = rowsOf(
      await tx.execute(sql`
        SELECT id FROM customer_credit_refunds
         WHERE id = ${refundId} AND company_id = ${companyId} AND contact_id = ${contactId} FOR UPDATE`)
    );
    if (locked.length === 0) throw new AppError({ message: "Refund not found", statusCode: 404, code: "REFUND_NOT_FOUND" });
    const [refund] = await tx.select().from(customerCreditRefunds).where(eq(customerCreditRefunds.id, refundId));
    if (refund.voidedAt) throw new AppError({ message: "This refund is already void.", statusCode: 409, code: "REFUND_ALREADY_VOID" });
    if (!refund.journalEntryId) throw new AppError({ message: "This refund has no journal entry to reverse.", statusCode: 422, code: "NOTHING_TO_REVERSE" });
    const [original] = await tx.select().from(journalEntries).where(eq(journalEntries.id, refund.journalEntryId));
    const posted = await tx.select().from(journalLines).where(eq(journalLines.entryId, refund.journalEntryId));
    const lines = posted.map((l: any) => ({
      accountId: l.accountId,
      debit: Number(l.credit) || 0,
      credit: Number(l.debit) || 0,
      description: `Reversal: ${l.description || ""}`.slice(0, 255),
    }));
    const reversal = await storage.createJournalEntry(
      {
        companyId,
        date: reversalDate,
        memo: `Void refund of customer credit - reversal of ${original?.entryNumber ?? "original posting"}`,
        entryNumber: "PENDING",
        status: "posted",
        source: CUSTOMER_CREDIT_REFUND_SOURCE,
        sourceId: refundId,
        reversedEntryId: refund.journalEntryId,
        reversalReason: "Customer credit refund voided",
        createdBy: userId,
        postedBy: userId,
        postedAt: postedAtNow,
      } as any,
      lines as any,
      { tx }
    );
    const [saved] = await tx
      .update(customerCreditRefunds)
      .set({ voidedAt: postedAtNow, voidJournalEntryId: reversal.id })
      .where(eq(customerCreditRefunds.id, refundId))
      .returning();
    return { refund: saved, reversalEntryId: reversal.id };
  });
}
