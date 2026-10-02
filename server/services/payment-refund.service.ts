// Refund of (part of) a payment on a settled invoice, entered by hand: a bank or card refund the company made
// outside the app, or a gateway refund that was not reflected automatically.
//
// It is the same two steps the gateway refund runs (payment-gateway/refund.service.ts), so the ledger, the customer
// statement and the AR ageing all see it like any other credit note and refund:
//   1. a credit note on the invoice for the refunded gross (split per VAT bucket, partial by construction),
//   2. a customer refund of that credit note: Dr 1040 Accounts Receivable / Cr the bank (or 1025 gateway clearing).

import { and, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { invoiceLines, invoices } from "../../shared/schema";
import { storage } from "../storage";
import { AppError } from "../middleware/errorHandler";
import { issueCreditNote, revenueContextOf } from "./credit-note-issue.service";
import { createRefund, isRefundAccount } from "./customer-refund.service";
import { getInvoiceBalance } from "./invoice-outstanding.db";
import { remainingVatBuckets } from "./credit-note-remainder.service";
import { splitGrossRefund } from "../../shared/sales-line-math";
import { uaeCalendarDate } from "../utils/date";

type Failure = { ok: false; message: string; code: string; status: number };

/**
 * Issue the credit note that carries a gross refund of `amount` on `original`: the whole invoice reversed when the
 * refund is its full total, otherwise a partial credit note split per VAT bucket of what is left to credit.
 */
export async function issueRefundCreditNote(args: {
  companyId: string;
  original: any;
  userId: string;
  amount: number;
  date?: string | null;
}): Promise<{ ok: true; creditNote: any } | Failure> {
  const { companyId, original, userId, amount } = args;
  const day = args.date || uaeCalendarDate().toISOString().slice(0, 10);
  const originalLines = await storage.getInvoiceLinesByInvoiceId(original.id);
  const accounts = await storage.getAccountsByCompanyId(companyId);
  const ctx = revenueContextOf(accounts);
  if (!ctx) return { ok: false, status: 422, code: "CHART_OF_ACCOUNTS_MISSING", message: "The chart of accounts has no revenue account." };
  const earlier = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.companyId, companyId), eq(invoices.originalInvoiceId, original.id), eq(invoices.invoiceType, "credit_note")));
  const live = earlier.filter((c: any) => c.status !== "void" && c.status !== "cancelled");
  const creditedLines = live.length
    ? await db.select().from(invoiceLines).where(sql`${invoiceLines.invoiceId} IN (${sql.join(live.map((c: any) => sql`${c.id}::uuid`), sql`, `)})`)
    : [];
  const remaining = remainingVatBuckets({ originalLines: originalLines as any[], creditedLines: creditedLines as any[], ctx });
  const remainingGross = remaining.reduce((s, b) => s + b.net + b.vat, 0);
  if (amount > remainingGross + 0.01) {
    return { ok: false, status: 422, code: "REFUND_EXCEEDS_INVOICE", message: `The refund of ${amount.toFixed(2)} is more than what is left to credit on invoice ${original.number}.` };
  }
  let body: Record<string, unknown>;
  if (live.length === 0 && Math.abs(amount - Math.abs(Number(original.total))) < 0.005) {
    body = { date: day };
  } else {
    const parts = splitGrossRefund(
      Math.min(amount, Math.round(remainingGross * 100) / 100),
      remaining.map((b) => ({ vatRate: b.vatRate, vatSupplyType: b.supplyType, net: b.net, vat: b.vat }))
    ).filter((p) => p.net > 0 || p.vat > 0);
    body = {
      date: day,
      lines: parts.map((p) => ({
        description: `Refund - Invoice ${original.number}`,
        quantity: 1,
        unitPrice: p.net,
        vatRate: p.vatRate,
        vatSupplyType: p.vatSupplyType,
      })),
    };
  }
  const cn = await issueCreditNote({ companyId, invoiceId: original.id, original, userId, body });
  if (!cn.ok) return { ok: false, status: cn.status, code: String(cn.body.code ?? "CREDIT_NOTE_FAILED"), message: String(cn.body.message ?? "The credit note could not be issued.") };
  return { ok: true, creditNote: cn.creditNote };
}

export async function refundInvoicePayment(input: {
  companyId: string;
  invoiceId: string;
  userId: string;
  amount: number;
  date?: string | null;
  bankAccountId: string;
  exchangeRate?: number | null;
  reference?: string | null;
  notes?: string | null;
}) {
  const { companyId } = input;
  const original = await storage.getInvoice(input.invoiceId, companyId);
  if (!original || original.invoiceType === "credit_note") {
    throw new AppError({ message: "Invoice not found", statusCode: 404, code: "INVOICE_NOT_FOUND" });
  }
  // Everything that can refuse is checked BEFORE the credit note exists.
  const bank = await storage.getAccount(input.bankAccountId, companyId);
  if (!bank || !(await isRefundAccount(bank, companyId))) {
    throw new AppError({
      message: "Invalid refund account: it must be a cash or bank account of this company (not Accounts Receivable or Inventory).",
      statusCode: 400,
      code: "INVALID_BANK_ACCOUNT",
    });
  }
  if (!(input.amount > 0)) throw new AppError({ message: "Refund amount must be greater than zero.", statusCode: 422, code: "INVALID_AMOUNT" });
  const balance = await getInvoiceBalance(companyId, original.id);
  if (balance.paid <= 0.005) {
    throw new AppError({ message: `Invoice ${original.number} has no payment to refund.`, statusCode: 422, code: "NO_PAYMENT_TO_REFUND" });
  }
  if (balance.outstanding > 0.005) {
    throw new AppError({
      message: `Invoice ${original.number} still has ${balance.outstanding.toFixed(2)} outstanding. Refund a payment once the invoice is settled; use the customer's credit to refund an overpayment.`,
      statusCode: 422,
      code: "INVOICE_NOT_SETTLED",
    });
  }
  if (input.amount > balance.paid + 0.005) {
    throw new AppError({ message: `The refund (${input.amount.toFixed(2)}) is more than the ${balance.paid.toFixed(2)} paid on invoice ${original.number}.`, statusCode: 422, code: "REFUND_EXCEEDS_PAYMENT" });
  }

  const cn = await issueRefundCreditNote({ companyId, original, userId: input.userId, amount: input.amount, date: input.date });
  if (!cn.ok) throw new AppError({ message: cn.message, statusCode: cn.status, code: cn.code });
  try {
    const out = await createRefund({
      companyId,
      creditNoteId: cn.creditNote.id,
      userId: input.userId,
      amount: Math.abs(Number(cn.creditNote.total)),
      date: input.date,
      bankAccountId: input.bankAccountId,
      exchangeRate: input.exchangeRate,
      reference: input.reference,
      notes: input.notes,
    });
    return { creditNote: cn.creditNote, refund: out.refund, journalEntryId: out.journalEntryId };
  } catch (err: any) {
    throw new AppError({
      message: `The credit note ${cn.creditNote.number} was issued, but the refund could not be recorded: ${err?.message ?? "unknown error"}. Refund it from the credit note.`,
      statusCode: err?.statusCode ?? 422,
      code: "REFUND_AFTER_CREDIT_NOTE_FAILED",
    });
  }
}
