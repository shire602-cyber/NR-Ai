// Refunds made in the provider's dashboard (Phase 8 D1: charge.refunded). In-app refunds are out of scope; a refund
// made in Stripe is REFLECTED in the books through the existing flows: a credit note on the paid invoice (the gross
// split per VAT bucket, splitGrossRefund) and then a customer refund out of 1025 (Dr 1040 / Cr 1025).
//
// gateway_refunds is a state machine like gateway_payments: received -> credit_note_posted -> settled | unallocated,
// idempotent on the provider's refund id.

import { and, eq, sql } from "drizzle-orm";
import { db } from "../../db";
import { gatewayPayments, gatewayRefunds, invoiceLines, invoices, type GatewayPayment, type GatewayRefund } from "../../../shared/schema";
import { storage } from "../../storage";
import { createLogger } from "../../config/logger";
import { ACCOUNT_CODES } from "../../constants";
import { runExclusive } from "../document-queue";
import { ensureSystemAccount } from "../inventory-costing.service";
import { issueCreditNote } from "../credit-note-issue.service";
import { createRefund } from "../customer-refund.service";
import { getInvoiceBalance } from "../invoice-outstanding.db";
import { remainingVatBuckets } from "../credit-note-remainder.service";
import { revenueContextOf } from "../credit-note-issue.service";
import { splitGrossRefund } from "../../../shared/sales-line-math";
import { uaeCalendarDate } from "../../utils/date";
import { createAndEmitNotification } from "../socket.service";
import { ownerUserId } from "./settle.service";
import type { ParsedRefund } from "./types";

const log = createLogger("gateway-refund");

export type RefundOutcome = { status: "settled" | "unallocated" | "ignored"; reason?: string; gatewayRefundId?: string };

async function lockRefund(id: string): Promise<GatewayRefund> {
  return await db.transaction(async (tx: typeof db) => {
    await tx.execute(sql`SELECT id FROM gateway_refunds WHERE id = ${id}::uuid FOR UPDATE`);
    const [row] = await tx.select().from(gatewayRefunds).where(eq(gatewayRefunds.id, id));
    return row;
  });
}

export async function processRefund(args: { companyId: string; refund: ParsedRefund }): Promise<RefundOutcome> {
  const { companyId, refund } = args;
  const [payment] = await db
    .select()
    .from(gatewayPayments)
    .where(and(eq(gatewayPayments.companyId, companyId), eq(gatewayPayments.provider, "stripe"), eq(gatewayPayments.providerPaymentId, refund.paymentId)));
  if (!payment) {
    log.warn({ refundId: refund.refundId, paymentId: refund.paymentId }, "Refund for a payment we never recorded: nothing posted");
    return { status: "ignored", reason: "unknown_payment" };
  }
  if (payment.status === "unallocated") return { status: "ignored", reason: "payment_unallocated" };
  if (refund.currency.toUpperCase() !== payment.currency.toUpperCase()) return { status: "ignored", reason: "currency_mismatch" };

  return await runExclusive(`gateway-refund:${refund.refundId}`, async () => {
    await db
      .insert(gatewayRefunds)
      .values({ companyId, gatewayPaymentId: payment.id, provider: "stripe", providerRefundId: refund.refundId, amount: refund.amount, status: "received" } as any)
      .onConflictDoNothing();
    const [existing] = await db
      .select()
      .from(gatewayRefunds)
      .where(and(eq(gatewayRefunds.provider, "stripe"), eq(gatewayRefunds.providerRefundId, refund.refundId)));
    if (!existing || existing.companyId !== companyId) return { status: "ignored", reason: "refund_belongs_elsewhere" } as RefundOutcome;
    let gr = await lockRefund(existing.id);
    if (gr.status === "settled") return { status: "settled", gatewayRefundId: gr.id } as RefundOutcome;
    if (gr.status === "unallocated") return { status: "unallocated", reason: gr.note ?? undefined, gatewayRefundId: gr.id } as RefundOutcome;

    const userId = await ownerUserId(companyId);
    if (!userId) throw new Error("The company has no user to post as.");
    const park = async (note: string): Promise<RefundOutcome> => {
      await db.update(gatewayRefunds).set({ status: "unallocated", note } as any).where(eq(gatewayRefunds.id, gr.id));
      await createAndEmitNotification({
        userId,
        companyId,
        type: "online_payment",
        title: "Stripe refund could not be recorded",
        message: `${note} Record the credit note and refund by hand.`,
        priority: "high",
        relatedEntityType: "invoice",
        relatedEntityId: payment.invoiceId,
        actionUrl: "/invoices",
      } as any).catch(() => undefined);
      return { status: "unallocated", reason: note, gatewayRefundId: gr.id };
    };

    const original = await storage.getInvoice(payment.invoiceId, companyId);
    if (!original) return park("The invoice of the refunded payment no longer exists.");

    // ── Step 1: the credit note ──────────────────────────────────────────────
    if (gr.status === "received") {
      // A refund can only be paid out of 1025 when the invoice is settled: a credit note on an invoice that still owes
      // money would just reduce the receivable and leave the refunded cash unrecorded. Park it, post nothing.
      const balance = await getInvoiceBalance(companyId, original.id);
      if (balance.outstanding > 0.005) {
        return park(`Invoice ${original.number} still has ${balance.outstanding.toFixed(2)} outstanding, so the refund cannot be matched to a credit balance.`);
      }
      const originalLines = await storage.getInvoiceLinesByInvoiceId(original.id);
      const accounts = await storage.getAccountsByCompanyId(companyId);
      const ctx = revenueContextOf(accounts);
      if (!ctx) return park("The chart of accounts has no revenue account.");
      const earlier = await db.select().from(invoices).where(and(eq(invoices.companyId, companyId), eq(invoices.originalInvoiceId, original.id), eq(invoices.invoiceType, "credit_note")));
      const live = earlier.filter((c: any) => c.status !== "void" && c.status !== "cancelled");
      const creditedLines = live.length
        ? await db.select().from(invoiceLines).where(sql`${invoiceLines.invoiceId} IN (${sql.join(live.map((c: any) => sql`${c.id}::uuid`), sql`, `)})`)
        : [];
      const remaining = remainingVatBuckets({ originalLines: originalLines as any[], creditedLines: creditedLines as any[], ctx });
      const remainingGross = remaining.reduce((s, b) => s + b.net + b.vat, 0);
      if (refund.amount > remainingGross + 0.01) return park(`The refund of ${refund.amount.toFixed(2)} is more than what is left to credit on invoice ${original.number}.`);

      let body: Record<string, unknown>;
      if (live.length === 0 && Math.abs(refund.amount - Math.abs(Number(original.total))) < 0.005) {
        body = { date: uaeCalendarDate().toISOString().slice(0, 10) }; // the whole invoice: a full reversal
      } else {
        const parts = splitGrossRefund(
          Math.min(refund.amount, Math.round(remainingGross * 100) / 100),
          remaining.map((b) => ({ vatRate: b.vatRate, vatSupplyType: b.supplyType, net: b.net, vat: b.vat }))
        ).filter((p) => p.net > 0 || p.vat > 0);
        body = {
          date: uaeCalendarDate().toISOString().slice(0, 10),
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
      if (!cn.ok) return park(String(cn.body.message ?? "The credit note could not be issued."));
      await db.update(gatewayRefunds).set({ status: "credit_note_posted", creditNoteId: cn.creditNote.id } as any).where(eq(gatewayRefunds.id, gr.id));
      gr = await lockRefund(gr.id);
    }

    // ── Step 2: the cash refund out of 1025 ──────────────────────────────────
    if (gr.status === "credit_note_posted" && gr.creditNoteId) {
      const clearing = await ensureSystemAccount(db, companyId, ACCOUNT_CODES.GATEWAY_CLEARING, "asset");
      const [cn] = await db.select().from(invoices).where(eq(invoices.id, gr.creditNoteId));
      try {
        const out = await createRefund({
          companyId,
          creditNoteId: gr.creditNoteId,
          userId,
          amount: Math.abs(Number(cn.total)),
          date: uaeCalendarDate().toISOString().slice(0, 10),
          bankAccountId: clearing.id,
          reference: refund.refundId,
          notes: `Stripe refund ${refund.refundId}`,
        });
        await db
          .update(gatewayRefunds)
          .set({ status: "settled", customerRefundId: out.refund.id } as any)
          .where(eq(gatewayRefunds.id, gr.id));
        await db
          .update(gatewayPayments)
          .set({ refundedAmount: sql`${gatewayPayments.refundedAmount} + ${refund.amount}`, updatedAt: new Date() } as any)
          .where(eq(gatewayPayments.id, payment.id));
      } catch (err: any) {
        return park(`The credit note was issued, but the refund could not be recorded: ${err?.message ?? "unknown error"}`);
      }
    }
    return { status: "settled", gatewayRefundId: gr.id } as RefundOutcome;
  });
}

void (null as unknown as GatewayPayment);
