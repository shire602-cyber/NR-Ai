// Creating an online payment for an invoice (Phase 8 D1), from the public invoice page or the customer portal.
// Nothing is posted here: the money is booked only when the signed provider webhook says the payment succeeded.

import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { invoices, paymentLinks, type Invoice } from "../../../shared/schema";
import { AppError } from "../../errors";
import { createLogger } from "../../config/logger";
import { getInvoiceBalance } from "../invoice-outstanding.db";
import { storage } from "../../storage";
import { runExclusive } from "../document-queue";
import { getReadyConnection } from "./connection.service";
import { getGatewayProvider } from "./index";
import { MIN_ONLINE_AMOUNT, isSupportedGatewayCurrency } from "./amounts";
import { GatewayError } from "./types";

const log = createLogger("gateway-checkout");
const refuse = (statusCode: number, code: string, message: string) => new AppError({ message, statusCode, code });

/** Invoice types a customer can pay online (never a credit note). */
export const PAYABLE_TYPES = ["invoice", "advance", "late_fee"];
const PAYABLE_STATUSES = ["sent", "posted", "partial"];

export interface OnlinePaymentView {
  configured: boolean;
  allowPartial: boolean;
  /** This invoice can be paid online right now. */
  payable: boolean;
}

/**
 * Pure: what the page shows for one invoice, given the company's ready connection (or null) and the invoice's
 * outstanding amount. The portal list loads the connection once and the balances in one query, then calls this per row.
 */
export function onlinePaymentViewFrom(
  conn: { allowPartial: boolean } | null,
  invoice: Pick<Invoice, "status" | "invoiceType" | "currency">,
  outstanding: number
): OnlinePaymentView {
  if (!conn) return { configured: false, allowPartial: false, payable: false };
  const payable =
    PAYABLE_TYPES.includes(invoice.invoiceType ?? "invoice") &&
    PAYABLE_STATUSES.includes(invoice.status) &&
    isSupportedGatewayCurrency(invoice.currency) &&
    outstanding > 0.004;
  return { configured: true, allowPartial: conn.allowPartial, payable };
}

/** What the public invoice page shows: only "configured" when the company can really take payment. */
export async function onlinePaymentView(invoice: Pick<Invoice, "id" | "companyId" | "status" | "invoiceType" | "currency">): Promise<OnlinePaymentView> {
  const conn = await getReadyConnection(invoice.companyId);
  if (!conn) return onlinePaymentViewFrom(null, invoice, 0);
  const balance = await getInvoiceBalance(invoice.companyId, invoice.id);
  return onlinePaymentViewFrom(conn, invoice, balance.outstanding);
}

export interface CreateCheckoutArgs {
  invoice: Invoice;
  amount?: number | null;
  via: "public" | "portal";
  origin: string;
  /** Where the customer returns to (the page they came from). */
  returnPath: string;
  customerEmail?: string | null;
  fakeRate?: number;
}

/** One checkout per invoice at a time: expiring the old session and creating the new one must not interleave. */
export async function createInvoiceCheckout(args: CreateCheckoutArgs): Promise<{ url: string }> {
  return await runExclusive(`checkout:${args.invoice.id}`, () => createInvoiceCheckoutLocked(args));
}

async function createInvoiceCheckoutLocked(args: CreateCheckoutArgs): Promise<{ url: string }> {
  const { invoice } = args;
  const provider = getGatewayProvider();
  const conn = await getReadyConnection(invoice.companyId);
  if (!provider || !conn || !conn.externalAccountId) {
    throw refuse(503, "PAYMENT_NOT_CONFIGURED", "Online payment is not available for this company.");
  }
  if (!PAYABLE_TYPES.includes(invoice.invoiceType ?? "invoice") || !PAYABLE_STATUSES.includes(invoice.status)) {
    throw refuse(409, "INVOICE_NOT_PAYABLE", "This invoice cannot be paid online.");
  }
  if (!isSupportedGatewayCurrency(invoice.currency)) {
    throw refuse(422, "CURRENCY_NOT_SUPPORTED", `${invoice.currency} invoices cannot be paid online.`);
  }
  const balance = await getInvoiceBalance(invoice.companyId, invoice.id);
  if (balance.outstanding <= 0.004) throw refuse(409, "INVOICE_NOT_PAYABLE", "Nothing is outstanding on this invoice.");

  let amount = balance.outstanding;
  if (args.amount !== undefined && args.amount !== null) {
    amount = Math.round(args.amount * 100) / 100;
    if (!(amount > 0)) throw refuse(422, "AMOUNT_BELOW_MINIMUM", "The amount must be above 0.");
    if (amount > balance.outstanding + 0.004) {
      throw refuse(422, "AMOUNT_EXCEEDS_OUTSTANDING", `The amount is more than the ${balance.outstanding.toFixed(2)} outstanding.`);
    }
    if (amount < balance.outstanding - 0.004 && !conn.allowPartial) {
      throw refuse(422, "PARTIAL_NOT_ALLOWED", "This company accepts payment of the full outstanding amount only.");
    }
  }
  if (amount < MIN_ONLINE_AMOUNT) {
    throw refuse(422, "AMOUNT_BELOW_MINIMUM", `The smallest online payment is ${MIN_ONLINE_AMOUNT.toFixed(2)} ${invoice.currency}.`);
  }

  // Only one open payment per invoice: earlier open sessions are expired so a customer cannot pay twice by accident.
  const open = await db
    .select()
    .from(paymentLinks)
    .where(and(eq(paymentLinks.invoiceId, invoice.id), eq(paymentLinks.status, "open")));
  for (const link of open) {
    await provider.expireCheckout({ accountId: conn.externalAccountId, sessionId: link.providerSessionId }).catch((err) =>
      log.warn({ err: err?.message, sessionId: link.providerSessionId }, "Could not expire an older checkout session")
    );
    await db.update(paymentLinks).set({ status: "expired" } as any).where(eq(paymentLinks.id, link.id));
  }

  const company = await storage.getCompany(invoice.companyId);
  const base = args.origin.replace(/\/$/, "");
  let session;
  try {
    session = await provider.createCheckout({
      accountId: conn.externalAccountId,
      companyId: invoice.companyId,
      invoiceId: invoice.id,
      invoiceNumber: invoice.number,
      amount,
      currency: invoice.currency,
      customerEmail: args.customerEmail ?? null,
      successUrl: `${base}${args.returnPath}?payment=success`,
      cancelUrl: `${base}${args.returnPath}?payment=cancelled`,
      description: `Invoice ${invoice.number}${company?.name ? ` - ${company.name}` : ""}`,
      fakeRate: args.fakeRate,
    });
  } catch (err: any) {
    if (err instanceof GatewayError) throw refuse(err.code === "CURRENCY_NOT_SUPPORTED" ? 422 : 502, err.code, err.message);
    log.error({ err: err?.message }, "Creating the checkout session failed");
    throw refuse(502, "CHECKOUT_FAILED", "The payment page could not be created. Please try again.");
  }
  try {
    await db.insert(paymentLinks).values({
    companyId: invoice.companyId,
    invoiceId: invoice.id,
    provider: provider.name === "fake" ? "stripe" : provider.name,
    providerSessionId: session.sessionId,
    amount,
    currency: invoice.currency,
    status: "open",
    url: session.url,
    createdVia: args.via,
    expiresAt: session.expiresAt,
  } as any);
  } catch (err: any) {
    // The partial unique index (one open link per invoice): another instance got there first. Close our session.
    if (err?.code === "23505" || err?.cause?.code === "23505") {
      await provider.expireCheckout({ accountId: conn.externalAccountId, sessionId: session.sessionId }).catch(() => undefined);
      throw refuse(409, "CHECKOUT_IN_PROGRESS", "A payment for this invoice was just started. Please use that payment page.");
    }
    throw err;
  }
  return { url: session.url };
}

export async function invoiceForShareToken(token: string): Promise<Invoice> {
  const invoice = await storage.getInvoiceByShareToken(token);
  if (!invoice) throw refuse(404, "INVOICE_NOT_FOUND", "Invoice not found or link is invalid");
  if (invoice.shareTokenExpiresAt && new Date(invoice.shareTokenExpiresAt) < new Date()) {
    throw refuse(410, "LINK_EXPIRED", "This invoice link has expired");
  }
  return invoice;
}

void invoices;
