// Pay a vendor bill: the subledger rows and the journal entry commit together or not at all.
//
//   bill_payments row (+ payment_account_id) -> vendor_bills.amount_paid / status -> Dr 2010 A/P / Cr the bank or cash GL account
//
// Extracted from POST /api/bills/:id/payments so the bank reconciliation (matching an outflow to a bill) posts through
// the same code. The bill row is locked FOR UPDATE and the paid total is recomputed under the lock, so concurrent
// payments cannot overpay. Everything runs on one Drizzle transaction (the caller's, when `tx` is given); the journal
// goes through storage.createJournalEntry({ tx }), which takes the company-month posting lock and re-checks the period.

import Decimal from "decimal.js";
import { sql } from "drizzle-orm";
import { db } from "../db";
import { AppError } from "../errors";
import { ACCOUNT_CODES } from "../constants";
import { storage } from "../storage";
import { BILL_PAYMENT_JE_SOURCE } from "./bill-posting.service";

type Tx = typeof db;
const rowsOf = (res: any): any[] => (res?.rows ?? res) as any[];

export interface RecordBillPaymentInput {
  billId: string;
  companyId: string;
  amount: number | string;
  /** Calendar day of the payment, YYYY-MM-DD (already validated: not in the future, period not locked). */
  paymentDate: string;
  paymentMethod?: string | null;
  reference?: string | null;
  notes?: string | null;
  /** The bank or cash GL account the money leaves. Default: 1020 (1010 for cash). */
  paymentAccountId?: string | null;
  userId: string;
  /** false = keep the legacy behaviour of the payment route, which accepts any bill status. */
  requirePayableStatus?: boolean;
  tx?: Tx;
}

export interface RecordBillPaymentResult {
  payment: Record<string, any>;
  billStatus: string;
  amountPaid: number;
  totalAmount: number;
  remaining: number;
  journalEntryId: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** A bank or cash account of this company that can take the credit of a bill payment. */
export async function resolvePaymentAccount(
  companyId: string,
  paymentAccountId: string | null | undefined,
  method: string | null | undefined
): Promise<{ id: string }> {
  const accounts = await storage.getAccountsByCompanyId(companyId);
  if (paymentAccountId) {
    const account = accounts.find((a) => a.id === paymentAccountId);
    if (!account || account.isActive === false || account.type !== "asset") {
      throw new AppError({ message: "The payment account must be an active asset (bank or cash) account of this company.", statusCode: 422, code: "PAYMENT_ACCOUNT_INVALID" });
    }
    return { id: account.id };
  }
  const code = method === "cash" ? ACCOUNT_CODES.CASH : ACCOUNT_CODES.BANK;
  const fallback = accounts.find((a) => a.code === code && a.type === "asset") || accounts.find((a) => a.code === ACCOUNT_CODES.BANK && a.type === "asset");
  if (!fallback) {
    throw new AppError({ message: "Bank account not found in the chart of accounts.", statusCode: 422, code: "PAYMENT_ACCOUNT_INVALID" });
  }
  return { id: fallback.id };
}

async function run(input: RecordBillPaymentInput, tx: Tx): Promise<RecordBillPaymentResult> {
  const lock = rowsOf(
    await tx.execute(sql`
      SELECT id, company_id, vendor_name, bill_number, status, total_amount, exchange_rate
        FROM vendor_bills WHERE id = ${input.billId} AND company_id = ${input.companyId} FOR UPDATE`)
  )[0];
  if (!lock) throw new AppError({ message: "Bill not found", statusCode: 404, code: "BILL_NOT_FOUND" });
  if (input.requirePayableStatus !== false && lock.status !== "approved" && lock.status !== "partial") {
    throw new AppError({ message: `A ${lock.status} bill cannot be paid. Approve it first.`, statusCode: 422, code: "BILL_NOT_PAYABLE" });
  }

  const sums = rowsOf(
    await tx.execute(sql`
      SELECT COALESCE((SELECT SUM(amount) FROM bill_payments WHERE bill_id = ${input.billId}), 0)
           + COALESCE((SELECT SUM(amount) FROM vendor_credit_applications WHERE bill_id = ${input.billId}), 0) AS paid`)
  )[0];
  const totalD = new Decimal(lock.total_amount ?? 0);
  const paidD = new Decimal(sums?.paid ?? 0);
  const remainingD = totalD.minus(paidD);
  const amountD = new Decimal(input.amount);
  if (amountD.lessThanOrEqualTo(0)) {
    throw new AppError({ message: "Payment amount must be positive", statusCode: 400, code: "PAYMENT_AMOUNT_INVALID" });
  }
  if (amountD.greaterThan(remainingD.plus("0.005"))) {
    throw new AppError({
      message: `Payment amount (${amountD.toFixed(2)}) exceeds remaining balance (${remainingD.toFixed(2)})`,
      statusCode: 400,
      code: "PAYMENT_EXCEEDS_BALANCE",
      details: { remaining: remainingD.toNumber(), attempted: amountD.toNumber() },
    });
  }

  const account = await resolvePaymentAccount(input.companyId, input.paymentAccountId, input.paymentMethod);
  const accounts = await storage.getAccountsByCompanyId(input.companyId);
  const ap = accounts.find((a) => a.code === ACCOUNT_CODES.AP && a.type === "liability");
  if (!ap) throw new AppError({ message: "Accounts Payable not found in the chart of accounts.", statusCode: 422, code: "AP_ACCOUNT_MISSING" });

  const inserted = rowsOf(
    await tx.execute(sql`
      INSERT INTO bill_payments (bill_id, payment_date, amount, payment_method, reference, notes, payment_account_id)
      VALUES (${input.billId}, ${input.paymentDate}, ${amountD.toFixed(2)}, ${input.paymentMethod || "bank_transfer"},
              ${input.reference ?? null}, ${input.notes ?? null}, ${account.id})
      RETURNING *`)
  )[0];

  const newPaidD = paidD.plus(amountD);
  const status = newPaidD.greaterThanOrEqualTo(totalD.minus("0.005")) ? "paid" : "partial";
  await tx.execute(sql`
    UPDATE vendor_bills
       SET amount_paid = ${newPaidD.toFixed(2)}, status = ${status},
           paid_at = CASE WHEN ${status} = 'paid' THEN NOW() ELSE paid_at END
     WHERE id = ${input.billId}`);

  const rate = Number(lock.exchange_rate) > 0 ? Number(lock.exchange_rate) : 1;
  const aed = round2(amountD.toNumber() * rate);
  const payDate = new Date(`${input.paymentDate}T00:00:00Z`);
  const ref = lock.bill_number || String(lock.id).slice(0, 8);
  const entry = await storage.createJournalEntry(
    {
      companyId: input.companyId,
      date: payDate,
      memo: `Payment - Bill ${ref} - ${lock.vendor_name}`,
      entryNumber: "PENDING",
      status: "posted",
      source: BILL_PAYMENT_JE_SOURCE,
      sourceId: inserted.id,
      createdBy: input.userId,
      postedBy: input.userId,
      postedAt: payDate,
    } as any,
    [
      { accountId: ap.id, debit: aed, credit: 0, description: `Settle A/P - Bill ${ref} - ${lock.vendor_name}` },
      { accountId: account.id, debit: 0, credit: aed, description: `Payment to ${lock.vendor_name} - Bill ${ref}` },
    ],
    { tx }
  );

  return {
    payment: inserted,
    billStatus: status,
    amountPaid: newPaidD.toNumber(),
    totalAmount: totalD.toNumber(),
    remaining: totalD.minus(newPaidD).toNumber(),
    journalEntryId: entry.id,
  };
}

export async function recordBillPayment(input: RecordBillPaymentInput): Promise<RecordBillPaymentResult> {
  if (input.tx) return await run(input, input.tx);
  return await db.transaction((tx: Tx) => run(input, tx));
}
