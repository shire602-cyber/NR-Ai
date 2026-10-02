// Settling an online payment (Phase 8 D1). The ONLY way the money reaches the books, and only through the existing
// payment path: storage.recordInvoicePayment (Dr 1025 Payment Gateway Clearing / Cr 1040, overpayment to 2050), then a
// SEPARATE gateway_fee journal (Dr 5110 / Cr 1025). The payout from the provider to the bank (Dr 1020 / Cr 1025) is
// matched by the bank feed (D3).
//
// gateway_payments is a small state machine: received -> payment_posted -> settled | unallocated. Every transition is
// idempotent (unique provider payment id; unique gateway reference on invoice_payments), so an event replay, a retry
// after a crash, or two different events for one payment can never post twice.

import { and, eq, sql } from "drizzle-orm";
import { db } from "../../db";
import {
  gatewayPayments,
  invoicePayments,
  journalEntries,
  paymentLinks,
  type GatewayPayment,
  type PaymentGatewayConnection,
  type PaymentLink,
} from "../../../shared/schema";
import { storage } from "../../storage";
import { createLogger } from "../../config/logger";
import { ACCOUNT_CODES } from "../../constants";
import { runExclusive } from "../document-queue";
import { ensureSystemAccount } from "../inventory-costing.service";
import { resolveSettlementDate } from "../payment-date-guard.service";
import { assertPeriodNotLocked } from "../period-lock.service";
import { recordAudit } from "../audit.service";
import { createAndEmitNotification } from "../socket.service";
import { getGatewayProvider } from "./index";
import { GatewayError } from "./types";
import { verifyCheckoutCompleted, type SessionLike } from "./verify";

const log = createLogger("gateway-settle");
export const GATEWAY_METHOD = "gateway";
export const GATEWAY_FEE_SOURCE = "gateway_fee";

const isUnique = (err: any) => err?.code === "23505" || err?.cause?.code === "23505";
const rowsOf = (res: any): any[] => (res?.rows ?? res) as any[];

export type SettleOutcome =
  | { status: "ignored"; reason: string }
  | { status: "unallocated"; gatewayPaymentId: string; reason: string }
  | { status: "settled"; gatewayPaymentId: string; replay: boolean };

export async function ownerUserId(companyId: string): Promise<string | null> {
  const users = await storage.getCompanyUsersByCompanyId(companyId);
  return (users.find((u: any) => u.role === "owner") ?? users[0])?.userId ?? null;
}

async function notifyOwner(companyId: string, userId: string, title: string, message: string, invoiceId: string, priority: "normal" | "high" = "normal") {
  await createAndEmitNotification({
    userId,
    companyId,
    type: "online_payment",
    title,
    message,
    priority,
    relatedEntityType: "invoice",
    relatedEntityId: invoiceId,
    actionUrl: "/invoices",
  } as any).catch((err: any) => log.warn({ err: err?.message }, "Could not notify the owner"));
}

/** The existing invoice payment for a provider payment id (the unique gateway reference), if any. */
async function findPaymentByReference(companyId: string, reference: string) {
  const [row] = await db
    .select()
    .from(invoicePayments)
    .where(and(eq(invoicePayments.companyId, companyId), eq(invoicePayments.reference, reference), eq(invoicePayments.method, GATEWAY_METHOD)));
  return row ?? null;
}

async function lockRow(id: string): Promise<GatewayPayment> {
  return await db.transaction(async (tx: typeof db) => {
    await tx.execute(sql`SELECT id FROM gateway_payments WHERE id = ${id}::uuid FOR UPDATE`);
    const [row] = await tx.select().from(gatewayPayments).where(eq(gatewayPayments.id, id));
    return row;
  });
}

export async function settleCheckoutSession(args: {
  eventAccount: string | null | undefined;
  session: SessionLike;
  link: PaymentLink | null;
  connection: PaymentGatewayConnection | null;
}): Promise<SettleOutcome> {
  const verdict = verifyCheckoutCompleted({
    eventAccount: args.eventAccount,
    session: args.session,
    link: args.link ? { companyId: args.link.companyId, invoiceId: args.link.invoiceId, amount: args.link.amount, currency: args.link.currency } : null,
    connection: args.connection
      ? { companyId: args.connection.companyId, externalAccountId: args.connection.externalAccountId, status: args.connection.status }
      : null,
  });
  if (!verdict.ok) {
    log.warn({ reason: verdict.reason, sessionId: args.session.id, account: args.eventAccount }, "Checkout event not trusted: nothing posted");
    return { status: "ignored", reason: verdict.reason };
  }
  const link = args.link as PaymentLink;
  const provider = getGatewayProvider();
  if (!provider) throw new GatewayError("Online payment is not configured.", "PAYMENT_NOT_CONFIGURED");

  // What the provider says the payment was and cost. A fee that is not known yet throws: the event claim is released
  // and the provider's retry settles it later.
  const details = await provider.retrievePayment({
    accountId: args.eventAccount as string,
    paymentId: verdict.paymentId,
    hint: { amount: verdict.amount, currency: verdict.currency, fakeRate: args.session.metadata?.fakeRate ? Number(args.session.metadata.fakeRate) : undefined },
  });
  if (details.status !== "succeeded") throw new GatewayError("The payment has not succeeded yet.", "PAYMENT_NOT_SUCCEEDED");
  if (details.feeAed === null) throw new GatewayError("The provider has not reported the fee yet.", "FEE_NOT_AVAILABLE");
  if (Math.abs(details.amount - verdict.amount) > 0.005) {
    log.warn({ paymentId: verdict.paymentId, event: verdict.amount, provider: details.amount }, "Provider amount differs from the event: nothing posted");
    return { status: "ignored", reason: "provider_amount_mismatch" };
  }

  return await runExclusive(`gateway:${verdict.paymentId}`, async () => {
    const rate = args.link && details.settledAed !== null && details.amount > 0 ? details.settledAed / details.amount : 1;
    const inserted = await db
      .insert(gatewayPayments)
      .values({
        companyId: link.companyId,
        invoiceId: link.invoiceId,
        paymentLinkId: link.id,
        provider: "stripe",
        providerPaymentId: verdict.paymentId,
        providerChargeId: details.chargeId,
        amount: verdict.amount,
        currency: verdict.currency,
        exchangeRate: Math.round(rate * 1_000_000) / 1_000_000,
        feeAed: details.feeAed,
        status: "received",
      } as any)
      .onConflictDoNothing()
      .returning({ id: gatewayPayments.id });
    const [existing] = await db
      .select()
      .from(gatewayPayments)
      .where(and(eq(gatewayPayments.provider, "stripe"), eq(gatewayPayments.providerPaymentId, verdict.paymentId)));
    if (!existing || existing.companyId !== link.companyId) return { status: "ignored", reason: "payment_belongs_elsewhere" } as SettleOutcome;
    const replay = inserted.length === 0;

    let gp = await lockRow(existing.id);
    if (gp.status === "settled") return { status: "settled", gatewayPaymentId: gp.id, replay: true } as SettleOutcome;
    if (gp.status === "unallocated") return { status: "unallocated", gatewayPaymentId: gp.id, reason: gp.note ?? "unallocated" } as SettleOutcome;

    const userId = await ownerUserId(link.companyId);
    if (!userId) throw new GatewayError("The company has no user to post as.", "NO_POSTING_USER");

    // ── Step 1: the customer's payment (Dr 1025 / Cr 1040) ───────────────────
    if (gp.status === "received") {
      const clearing = await ensureSystemAccount(db, link.companyId, ACCOUNT_CODES.GATEWAY_CLEARING, "asset");
      const accounts = await storage.getAccountsByCompanyId(link.companyId);
      const ar = accounts.find((a) => a.code === ACCOUNT_CODES.AR && a.isSystemAccount);
      if (!ar) throw new GatewayError("Accounts Receivable account not found.", "CHART_OF_ACCOUNTS_MISSING");
      const invoice = await storage.getInvoice(link.invoiceId, link.companyId);
      if (!invoice) throw new GatewayError("Invoice not found.", "INVOICE_NOT_FOUND");

      let payment = await findPaymentByReference(link.companyId, verdict.paymentId);
      let recorded: Awaited<ReturnType<typeof storage.recordInvoicePayment>> | null = null;
      if (!payment) {
        const { date } = await resolveSettlementDate(link.companyId, {});
        const foreign = invoice.currency !== "AED";
        try {
          recorded = await storage.recordInvoicePayment({
            invoiceId: link.invoiceId,
            companyId: link.companyId,
            amount: verdict.amount,
            date,
            method: GATEWAY_METHOD,
            reference: verdict.paymentId,
            notes: `Online payment ${verdict.paymentId}`,
            paymentAccountId: clearing.id,
            paymentAccountCurrency: "AED",
            paymentExchangeRate: foreign && details.settledAed ? details.settledAed / details.amount : null,
            receivableAccountId: ar.id,
            createdBy: userId,
            allowCredit: true,
          });
          payment = recorded.payment as any;
        } catch (err: any) {
          if (err?.code === "INVOICE_NOTHING_OUTSTANDING" || err?.code === "INVOICE_TERMINAL") {
            // Paid, credited, void or cancelled in the meantime: the customer's money has nowhere to go. Park it,
            // tell the owner, and leave the books alone: the payment must be refunded in the provider's dashboard.
            const note = `Invoice ${invoice.number} could not take the payment (${err.code}).`;
            await db.update(gatewayPayments).set({ status: "unallocated", note, updatedAt: new Date() } as any).where(eq(gatewayPayments.id, gp.id));
            await notifyOwner(link.companyId, userId, "Online payment could not be applied", `${note} Refund it from your Stripe dashboard.`, link.invoiceId, "high");
            return { status: "unallocated", gatewayPaymentId: gp.id, reason: err.code } as SettleOutcome;
          }
          if (isUnique(err)) {
            // Another settlement of the same payment won the unique reference: link to its payment row.
            payment = await findPaymentByReference(link.companyId, verdict.paymentId);
            if (!payment) throw err;
          } else {
            throw err;
          }
        }
      }
      await db
        .update(gatewayPayments)
        .set({ status: "payment_posted", invoicePaymentId: payment!.id, updatedAt: new Date() } as any)
        .where(eq(gatewayPayments.id, gp.id));
      if (recorded) {
        // After commit: the audit row is what the outbound webhook events (payment.received, invoice.paid) read.
        await recordAudit({
          userId,
          companyId: link.companyId,
          action: "invoice.payment",
          entityType: "invoice",
          entityId: link.invoiceId,
          before: { status: invoice.status, totalPaid: recorded.totalPaid - verdict.amount },
          after: { status: recorded.invoice.status, totalPaid: recorded.totalPaid },
          extra: { paymentId: recorded.payment.id, amount: verdict.amount, method: GATEWAY_METHOD, journalEntryId: recorded.journalEntryId },
        });
        await notifyOwner(
          link.companyId,
          userId,
          "Online payment received",
          `${verdict.amount.toFixed(2)} ${verdict.currency} paid online for invoice ${invoice.number}.`,
          link.invoiceId
        );
      }
      gp = await lockRow(gp.id);
    }

    // ── Step 2: the gateway fee, its own journal (Dr 5110 / Cr 1025) ─────────
    if (gp.status === "payment_posted") {
      const fee = Number(gp.feeAed);
      let feeEntryId: string | null = gp.feeJournalEntryId ?? null;
      if (fee > 0 && !feeEntryId) {
        const [existingFee] = await db
          .select({ id: journalEntries.id })
          .from(journalEntries)
          .where(and(eq(journalEntries.companyId, link.companyId), eq(journalEntries.source, GATEWAY_FEE_SOURCE), eq(journalEntries.sourceId, gp.id)));
        if (existingFee) {
          feeEntryId = existingFee.id;
        } else {
          const [payment] = await db.select().from(invoicePayments).where(eq(invoicePayments.id, gp.invoicePaymentId as string));
          const date = payment?.date ? new Date(payment.date) : new Date();
          await assertPeriodNotLocked(link.companyId, date);
          const clearing = await ensureSystemAccount(db, link.companyId, ACCOUNT_CODES.GATEWAY_CLEARING, "asset");
          const feeAccount = await ensureSystemAccount(db, link.companyId, ACCOUNT_CODES.GATEWAY_FEES, "expense");
          const entry = await storage.createJournalEntry(
            {
              companyId: link.companyId,
              date,
              memo: `Payment gateway fee - ${verdict.paymentId}`,
              entryNumber: "PENDING",
              status: "posted",
              source: GATEWAY_FEE_SOURCE,
              sourceId: gp.id,
              createdBy: userId,
              postedBy: userId,
              postedAt: date,
            } as any,
            [
              { accountId: feeAccount.id, debit: fee, credit: 0, description: `Gateway fee - ${verdict.paymentId}` },
              { accountId: clearing.id, debit: 0, credit: fee, description: `Gateway fee - ${verdict.paymentId}` },
            ] as any
          );
          feeEntryId = entry.id;
        }
      }
      await db
        .update(gatewayPayments)
        .set({ status: "settled", feeJournalEntryId: feeEntryId, updatedAt: new Date() } as any)
        .where(eq(gatewayPayments.id, gp.id));
      await db.update(paymentLinks).set({ status: "completed" } as any).where(eq(paymentLinks.id, link.id));
    }
    return { status: "settled", gatewayPaymentId: gp.id, replay } as SettleOutcome;
  });
}

void rowsOf;
