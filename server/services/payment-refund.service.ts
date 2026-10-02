// Refunds of money on an invoice. A refund is a payment-side event: Dr 1040 Accounts Receivable / Cr the bank (or
// 1025 gateway clearing) against the credit balance a credit note left, through the customer-refund service. It never
// reverses sales or output VAT: that is what a credit note does, once. issueRefundCreditNote below is only for a
// refund made in the provider's dashboard (payment-gateway/refund.service.ts), which has no credit note yet.

import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { invoiceLines, invoices } from "../../shared/schema";
import { storage } from "../storage";
import { AppError } from "../middleware/errorHandler";
import { issueCreditNote, revenueContextOf } from "./credit-note-issue.service";
import { createRefund, getRefundSummary, isRefundAccount, voidRefund } from "./customer-refund.service";
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

/** Live credit notes of an invoice with what each can still pay back (document currency), oldest first. */
export async function refundableCreditNotes(companyId: string, invoiceId: string) {
  const notes = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.companyId, companyId), eq(invoices.originalInvoiceId, invoiceId), eq(invoices.invoiceType, "credit_note")))
    .orderBy(asc(invoices.createdAt));
  const out: Array<{ id: string; number: string; refundable: number }> = [];
  for (const cn of notes) {
    if (cn.status === "void" || cn.status === "cancelled" || cn.status === "draft") continue;
    const summary = await getRefundSummary(companyId, cn.id);
    if (summary.refundable > 0.004) out.push({ id: cn.id, number: cn.number, refundable: summary.refundable });
  }
  return out;
}

/**
 * Refund money to the customer on an invoice. A refund of money is a payment-side event only: Dr 1040 Accounts
 * Receivable / Cr the bank, through the customer-refund service, against the credit balance an existing credit note
 * left. It never issues a credit note of its own (that would reverse sales and output VAT a second time). To pay back
 * more than the credit balance, credit the goods or services first (a credit note), then refund.
 */
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
  const bank = await storage.getAccount(input.bankAccountId, companyId);
  if (!bank || !(await isRefundAccount(bank, companyId))) {
    throw new AppError({
      message: "Invalid refund account: it must be a cash or bank account of this company (not Accounts Receivable or Inventory).",
      statusCode: 400,
      code: "INVALID_BANK_ACCOUNT",
    });
  }
  if (!(input.amount > 0)) throw new AppError({ message: "Refund amount must be greater than zero.", statusCode: 422, code: "INVALID_AMOUNT" });

  const available = await refundableCreditNotes(companyId, original.id);
  const total = Math.round(available.reduce((s, c) => s + c.refundable, 0) * 100) / 100;
  if (total <= 0.004) {
    throw new AppError({
      message: `Invoice ${original.number} has no credit balance to refund. Issue a credit note for the goods or services returned first; the refund pays back the credit it leaves.`,
      statusCode: 422,
      code: "NO_CREDIT_BALANCE",
    });
  }
  if (input.amount > total + 0.005) {
    throw new AppError({
      message: `The refund (${input.amount.toFixed(2)}) is more than the credit balance of invoice ${original.number} (${total.toFixed(2)}).`,
      statusCode: 422,
      code: "REFUND_EXCEEDS_CREDIT",
    });
  }

  const refunds: any[] = [];
  let left = Math.round(input.amount * 100) / 100;
  for (const cn of available) {
    if (left <= 0.004) break;
    const part = Math.round(Math.min(left, cn.refundable) * 100) / 100;
    const out = await createRefund({
      companyId,
      creditNoteId: cn.id,
      userId: input.userId,
      amount: part,
      date: input.date,
      bankAccountId: input.bankAccountId,
      exchangeRate: input.exchangeRate,
      reference: input.reference,
      notes: input.notes,
    });
    refunds.push({ ...out.refund, creditNoteId: cn.id, creditNoteNumber: cn.number });
    left = Math.round((left - part) * 100) / 100;
  }
  return { refunds, refund: refunds[0], remaining: Math.round((total - input.amount) * 100) / 100 };
}

/** The refunds paid on an invoice's credit notes (live and void), for its payments list. */
export async function listInvoiceRefunds(companyId: string, invoiceId: string) {
  const res: any = await db.execute(sql`
    SELECT r.id, r.credit_note_id AS "creditNoteId", cn.number AS "creditNoteNumber", r.amount::float8 AS amount, r.currency,
           to_char(r.refund_date, 'YYYY-MM-DD') AS date, r.reference, r.notes, r.bank_account_id AS "bankAccountId",
           r.voided_at AS "voidedAt", r.created_at AS "createdAt"
      FROM customer_refunds r JOIN invoices cn ON cn.id = r.credit_note_id
     WHERE r.company_id = ${companyId} AND cn.original_invoice_id = ${invoiceId}
     ORDER BY r.created_at`);
  return (res.rows ?? res) as any[];
}

/** Void one refund of an invoice (reverses its journal, restores the credit balance); the credit note can then be voided. */
export async function voidInvoiceRefund(input: { companyId: string; invoiceId: string; refundId: string; userId: string }) {
  const res: any = await db.execute(sql`
    SELECT r.credit_note_id AS "creditNoteId" FROM customer_refunds r JOIN invoices cn ON cn.id = r.credit_note_id
     WHERE r.id = ${input.refundId} AND r.company_id = ${input.companyId} AND cn.original_invoice_id = ${input.invoiceId}`);
  const row = (res.rows ?? res)[0];
  if (!row) throw new AppError({ message: "Refund not found", statusCode: 404, code: "REFUND_NOT_FOUND" });
  return await voidRefund({ companyId: input.companyId, creditNoteId: row.creditNoteId, refundId: input.refundId, userId: input.userId });
}
