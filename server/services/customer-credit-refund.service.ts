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
import { isRefundAccount } from "./customer-refund.service";
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

export async function getCustomerCreditBalance(companyId: string, contactId: string): Promise<CustomerCreditBalance> {
  const contact = await loadContact(db, companyId, contactId);
  return balanceInTx(db, companyId, contactId, contact.name);
}

export async function listCustomerCreditRefunds(companyId: string, contactId: string): Promise<CustomerCreditRefund[]> {
  return await db
    .select()
    .from(customerCreditRefunds)
    .where(and(eq(customerCreditRefunds.companyId, companyId), eq(customerCreditRefunds.contactId, contactId)))
    .orderBy(desc(customerCreditRefunds.createdAt));
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
