/**
 * Online invoice payment (W4-D, R16-14).
 *
 *   createPaymentLink   one active link per invoice; amount = the invoice's open balance (fils)
 *   startCheckout       hosted checkout session at the provider (Stripe Checkout)
 *   handleGatewayWebhook verified, idempotent event → invoices.recordPayment (ledger, once),
 *                        gateway fee to Bank Charges, receipt email to the customer
 *
 * With no live/sandbox provider nothing is offered: paymentsAvailability() reports
 * requires_external and the UI shows no Pay button.
 */
import crypto from "crypto";
import { and, desc, eq, gt, inArray } from "drizzle-orm";
import { db, pool } from "../../db";
import {
  accounts,
  companies,
  customerContacts,
  invoices,
  paymentLinks,
  type Invoice,
  type PaymentLink,
} from "../../../shared/schema";
import { DomainError } from "../../errors";
import { createLogger } from "../../config/logger";
import { has, resolve } from "../../platform/service-registry";
import { postJournal } from "../../ledger";
import { fromFils } from "../../../shared/money";
import { invoiceOpenFils, isIssuedStatus } from "../invoice-posting.service";
import { escapeHtml, renderBilingualEmail, sendEmail } from "../email.service";
import type { CapabilityStatus } from "../../../shared/capabilities";
import { defaultChartOfAccounts } from "../../defaultChartOfAccounts";
import { stripeAdapter } from "./stripe";
import { ngeniusAdapter, telrAdapter, UAE_GATEWAY_ACTIONS } from "./uae-gateways";
import {
  WebhookSignatureError,
  type PaymentProviderAdapter,
  type PaymentProviderId,
  type VerifiedPaymentEvent,
} from "./types";
import type { RecordInvoicePaymentService } from "../invoice-payment.service";

export * from "./types";
export { setStripeFetch, signStripePayload, verifyStripeSignature } from "./stripe";

const log = createLogger("invoice-payments");

const ADAPTERS: Record<PaymentProviderId, PaymentProviderAdapter> = {
  stripe: stripeAdapter,
  telr: telrAdapter,
  ngenius: ngeniusAdapter,
};

export const CLEARING_ACCOUNT_CODE = "1025";
export const BANK_CHARGES_CODE = "5110";
const DEFAULT_LINK_DAYS = 30;

export function getPaymentAdapter(id: string): PaymentProviderAdapter | null {
  return (ADAPTERS as Record<string, PaymentProviderAdapter | undefined>)[id] ?? null;
}

const usable = (s: CapabilityStatus) => s === "live" || s === "sandbox";

/** The provider to use: INVOICE_PAYMENTS_PROVIDER when usable, else the first usable one. */
export function activePaymentAdapter(preferred?: string | null): PaymentProviderAdapter | null {
  const pref = preferred || process.env.INVOICE_PAYMENTS_PROVIDER;
  const p = pref ? getPaymentAdapter(pref) : null;
  if (p && usable(p.status())) return p;
  return Object.values(ADAPTERS).find((a) => usable(a.status())) ?? null;
}

export interface PaymentsAvailability {
  available: boolean;
  status: CapabilityStatus;
  provider: PaymentProviderId | null;
  providers: Array<{
    id: PaymentProviderId;
    status: CapabilityStatus;
    label: { en: string; ar: string };
  }>;
  externalAction: { en: string; ar: string };
}

export function paymentsAvailability(): PaymentsAvailability {
  const active = activePaymentAdapter();
  return {
    available: !!active,
    status: active ? active.status() : "requires_external",
    provider: active?.id ?? null,
    providers: Object.values(ADAPTERS).map((a) => ({
      id: a.id,
      status: a.status(),
      label: a.label,
    })),
    externalAction: active
      ? { en: "", ar: "" }
      : {
          en: `Complete merchant onboarding with a payment gateway: Stripe (STRIPE_SECRET_KEY, INVOICE_PAYMENTS_ENABLED, STRIPE_INVOICE_WEBHOOK_SECRET), ${UAE_GATEWAY_ACTIONS.telr.en}`,
          ar: `أكمل تسجيل التاجر لدى بوابة دفع: Stripe أو ${UAE_GATEWAY_ACTIONS.telr.ar}`,
        },
  };
}

export function publicBaseUrl(): string {
  return (
    process.env.FRONTEND_URL ||
    process.env.AUTH_PUBLIC_URL ||
    "http://localhost:5000"
  ).replace(/\/+$/, "");
}

const hashToken = (raw: string) => crypto.createHash("sha256").update(raw).digest("hex");

async function accountIdByCode(companyId: string, code: string): Promise<string | null> {
  const [row] = await db
    .select({ id: accounts.id, type: accounts.type, subType: accounts.subType })
    .from(accounts)
    .where(and(eq(accounts.companyId, companyId), eq(accounts.code, code)));
  return row?.id ?? null;
}

/** Gateway clearing account (asset/bank, code 1025), created on first use. */
export async function ensureClearingAccount(companyId: string): Promise<string> {
  const [row] = await db
    .select({ id: accounts.id, type: accounts.type, subType: accounts.subType })
    .from(accounts)
    .where(and(eq(accounts.companyId, companyId), eq(accounts.code, CLEARING_ACCOUNT_CODE)));
  if (row && row.type === "asset" && (row.subType === "bank" || row.subType === "cash")) {
    return row.id;
  }
  if (row) {
    // Code taken by another kind of account: fall back to the main bank account.
    const bank = await accountIdByCode(companyId, "1020");
    if (bank) return bank;
    throw new DomainError("CLEARING_ACCOUNT_UNAVAILABLE", 422);
  }
  await db
    .insert(accounts)
    .values({
      companyId,
      code: CLEARING_ACCOUNT_CODE,
      nameEn: "Online Payments Clearing (Gateway)",
      nameAr: "حساب مقاصة المدفوعات الإلكترونية",
      description: "Card payments collected by the payment gateway, pending payout (W4-D)",
      type: "asset",
      subType: "bank",
      isSystemAccount: true,
    })
    .onConflictDoNothing();
  const id = await accountIdByCode(companyId, CLEARING_ACCOUNT_CODE);
  if (!id) throw new DomainError("CLEARING_ACCOUNT_UNAVAILABLE", 422);
  return id;
}

async function ensureBankChargesAccount(companyId: string): Promise<string> {
  const existing = await accountIdByCode(companyId, BANK_CHARGES_CODE);
  if (existing) return existing;
  const tpl = defaultChartOfAccounts.find((a) => a.code === BANK_CHARGES_CODE);
  await db
    .insert(accounts)
    .values({
      companyId,
      code: BANK_CHARGES_CODE,
      nameEn: tpl?.nameEn ?? "Bank Charges & Fees",
      nameAr: tpl?.nameAr ?? "الرسوم والعمولات البنكية",
      type: "expense",
      subType: tpl?.subType ?? "operating_expense",
      isSystemAccount: true,
    })
    .onConflictDoNothing();
  const id = await accountIdByCode(companyId, BANK_CHARGES_CODE);
  if (!id) throw new DomainError("BANK_CHARGES_ACCOUNT_MISSING", 422);
  return id;
}

async function payableInvoice(companyId: string, invoiceId: string): Promise<Invoice> {
  const [invoice] = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.id, invoiceId), eq(invoices.companyId, companyId)));
  if (!invoice) throw new DomainError("INVOICE_NOT_FOUND", 404, undefined, "Invoice not found");
  if (invoice.invoiceType === "credit_note" || !isIssuedStatus(invoice.status)) {
    throw new DomainError(
      "INVOICE_NOT_PAYABLE",
      409,
      { status: invoice.status },
      "Only issued, unpaid invoices can be paid online"
    );
  }
  if (invoice.status === "paid") {
    throw new DomainError("INVOICE_ALREADY_PAID", 409, undefined, "This invoice is already paid");
  }
  return invoice as Invoice;
}

export interface PaymentLinkView {
  id: string;
  invoiceId: string;
  provider: string;
  amountFils: number;
  amount: string;
  currency: string;
  status: string;
  expiresAt: Date;
  paidAt: Date | null;
  url?: string;
}

function view(link: PaymentLink, token?: string): PaymentLinkView {
  return {
    id: link.id,
    invoiceId: link.invoiceId,
    provider: link.provider,
    amountFils: link.amountFils,
    amount: fromFils(link.amountFils),
    currency: link.currency,
    status: link.status,
    expiresAt: link.expiresAt,
    paidAt: link.paidAt ?? null,
    ...(token ? { url: `${publicBaseUrl()}/api/portal/pay/${token}` } : {}),
  };
}

/**
 * Create a payment link for the invoice's open balance. Refuses (503
 * PAYMENTS_REQUIRES_EXTERNAL) when no gateway is configured. Active links for the invoice
 * whose amount no longer matches the open balance are cancelled.
 */
export async function createPaymentLink(args: {
  companyId: string;
  invoiceId: string;
  createdBy?: string | null;
  provider?: string | null;
  expiresInDays?: number;
  depositAccountId?: string | null;
}): Promise<{ link: PaymentLink; token: string; view: PaymentLinkView }> {
  const adapter = activePaymentAdapter(args.provider);
  if (!adapter) {
    const a = paymentsAvailability();
    throw new DomainError(
      "PAYMENTS_REQUIRES_EXTERNAL",
      503,
      { status: a.status, externalAction: a.externalAction },
      "Online payments are not set up for this deployment"
    );
  }
  const invoice = await payableInvoice(args.companyId, args.invoiceId);
  const openFils = await invoiceOpenFils(db, invoice);
  if (openFils <= 0) {
    throw new DomainError("INVOICE_ALREADY_PAID", 409, undefined, "Nothing left to pay");
  }
  let depositAccountId = args.depositAccountId ?? null;
  if (depositAccountId) {
    const { assertCashOrBankAccount } = await import("../invoice-payment.service");
    await assertCashOrBankAccount(args.companyId, depositAccountId);
  } else {
    depositAccountId = await ensureClearingAccount(args.companyId);
  }
  await db
    .update(paymentLinks)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(and(eq(paymentLinks.invoiceId, invoice.id), eq(paymentLinks.status, "active")));
  const token = crypto.randomBytes(24).toString("hex");
  const [link] = await db
    .insert(paymentLinks)
    .values({
      companyId: args.companyId,
      invoiceId: invoice.id,
      provider: adapter.id,
      tokenHash: hashToken(token),
      amountFils: openFils,
      currency: (invoice.currency || "AED").toUpperCase(),
      status: "active",
      expiresAt: new Date(Date.now() + (args.expiresInDays ?? DEFAULT_LINK_DAYS) * 86_400_000),
      depositAccountId,
      createdBy: args.createdBy ?? null,
    })
    .returning();
  return { link: link as PaymentLink, token, view: view(link as PaymentLink, token) };
}

export async function listPaymentLinks(companyId: string, invoiceId: string) {
  const rows = await db
    .select()
    .from(paymentLinks)
    .where(and(eq(paymentLinks.companyId, companyId), eq(paymentLinks.invoiceId, invoiceId)))
    .orderBy(desc(paymentLinks.createdAt));
  return rows.map((r: PaymentLink) => view(r));
}

export async function cancelPaymentLink(companyId: string, linkId: string): Promise<boolean> {
  const rows = await db
    .update(paymentLinks)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(
      and(
        eq(paymentLinks.id, linkId),
        eq(paymentLinks.companyId, companyId),
        eq(paymentLinks.status, "active")
      )
    )
    .returning({ id: paymentLinks.id });
  return rows.length > 0;
}

export async function findLinkByToken(token: string): Promise<PaymentLink | null> {
  if (!/^[0-9a-f]{48}$/i.test(token)) return null;
  const [row] = await db
    .select()
    .from(paymentLinks)
    .where(eq(paymentLinks.tokenHash, hashToken(token.toLowerCase())));
  return (row as PaymentLink) ?? null;
}

/** Create (or reuse) a checkout session for an active link and return the provider URL. */
export async function startCheckout(
  link: PaymentLink,
  urls: { successUrl: string; cancelUrl: string }
): Promise<{ url: string }> {
  if (link.status !== "active") {
    throw new DomainError(
      "PAYMENT_LINK_INACTIVE",
      410,
      { status: link.status },
      "This payment link is no longer active"
    );
  }
  if (new Date(link.expiresAt).getTime() < Date.now()) {
    await db
      .update(paymentLinks)
      .set({ status: "expired", updatedAt: new Date() })
      .where(eq(paymentLinks.id, link.id));
    throw new DomainError("PAYMENT_LINK_EXPIRED", 410, undefined, "This payment link has expired");
  }
  const adapter = getPaymentAdapter(link.provider);
  if (!adapter || !usable(adapter.status())) {
    throw new DomainError(
      "PAYMENTS_REQUIRES_EXTERNAL",
      503,
      undefined,
      "Online payments are not available"
    );
  }
  const [invoice] = await db.select().from(invoices).where(eq(invoices.id, link.invoiceId));
  const [company] = await db
    .select({ name: companies.name })
    .from(companies)
    .where(eq(companies.id, link.companyId));
  let email: string | null = null;
  if (invoice?.contactId) {
    const [c] = await db
      .select({ email: customerContacts.email })
      .from(customerContacts)
      .where(eq(customerContacts.id, invoice.contactId));
    email = c?.email ?? null;
  }
  const session = await adapter.createCheckoutSession({
    linkId: link.id,
    invoiceId: link.invoiceId,
    invoiceNumber: invoice?.number ?? "",
    companyName: company?.name ?? "",
    amountFils: link.amountFils,
    currency: link.currency,
    customerEmail: email,
    successUrl: urls.successUrl,
    cancelUrl: urls.cancelUrl,
    expiresAt: new Date(link.expiresAt),
  });
  await db
    .update(paymentLinks)
    .set({ providerSessionId: session.sessionId, providerUrl: session.url, updatedAt: new Date() })
    .where(eq(paymentLinks.id, link.id));
  return { url: session.url };
}

/** Pay an invoice from a customer surface: reuse the active link or create one, then check out. */
export async function checkoutForInvoice(args: {
  companyId: string;
  invoiceId: string;
  successUrl: string;
  cancelUrl: string;
}): Promise<{ url: string; amountFils: number; currency: string }> {
  const invoice = await payableInvoice(args.companyId, args.invoiceId);
  const openFils = await invoiceOpenFils(db, invoice);
  const [existing] = await db
    .select()
    .from(paymentLinks)
    .where(
      and(
        eq(paymentLinks.invoiceId, invoice.id),
        eq(paymentLinks.status, "active"),
        gt(paymentLinks.expiresAt, new Date())
      )
    )
    .orderBy(desc(paymentLinks.createdAt))
    .limit(1);
  let link = existing as PaymentLink | undefined;
  if (!link || link.amountFils !== openFils) {
    link = (await createPaymentLink({ companyId: args.companyId, invoiceId: invoice.id })).link;
  }
  const { url } = await startCheckout(link, args);
  return { url, amountFils: link.amountFils, currency: link.currency };
}

async function companyActor(companyId: string, preferred?: string | null): Promise<string> {
  if (preferred) return preferred;
  const { rows } = await pool.query(
    `SELECT user_id FROM company_users WHERE company_id = $1
      ORDER BY (role = 'owner') DESC, created_at ASC LIMIT 1`,
    [companyId]
  );
  if (!rows[0]) throw new DomainError("NO_COMPANY_USER", 409);
  return rows[0].user_id as string;
}

export interface WebhookOutcome {
  status: "processed" | "duplicate" | "ignored";
  paymentId?: string;
  invoiceStatus?: string;
}

/**
 * Verify, de-duplicate and apply a gateway webhook. A paid event posts exactly one invoice
 * payment through invoices.recordPayment. Throws WebhookSignatureError for a bad signature.
 */
export async function handleGatewayWebhook(
  providerId: string,
  rawBody: string,
  headers: Record<string, string | undefined>
): Promise<WebhookOutcome> {
  const adapter = getPaymentAdapter(providerId);
  if (!adapter) throw new DomainError("UNKNOWN_PAYMENT_PROVIDER", 404);
  const event = adapter.verifyWebhook(rawBody, headers);
  if (!event.eventId) throw new WebhookSignatureError("Event has no id");

  const claimed = await pool.query(
    `INSERT INTO payment_gateway_events (provider, event_id, type, outcome)
     VALUES ($1, $2, $3, 'processing') ON CONFLICT DO NOTHING RETURNING event_id`,
    [event.provider, event.eventId, event.type]
  );
  if (!claimed.rows.length) return { status: "duplicate" };

  const finish = (outcome: string, linkId?: string | null, detail?: string) =>
    pool.query(
      `UPDATE payment_gateway_events SET outcome = $3, payment_link_id = $4, detail = $5
        WHERE provider = $1 AND event_id = $2`,
      [event.provider, event.eventId, outcome, linkId ?? null, detail ?? null]
    );

  try {
    const link = await linkForEvent(event);
    if (!link) {
      await finish("ignored", null, "no matching payment link");
      return { status: "ignored" };
    }
    if (event.kind === "expired" || event.kind === "failed") {
      await finish(event.kind, link.id);
      return { status: "ignored" };
    }
    if (event.kind !== "paid") {
      await finish("ignored", link.id);
      return { status: "ignored" };
    }
    const out = await applyPaidEvent(link, event, adapter);
    await finish(out.status, link.id);
    return out;
  } catch (err) {
    // Let the gateway retry: forget the claim so the next delivery is processed.
    await pool.query(`DELETE FROM payment_gateway_events WHERE provider = $1 AND event_id = $2`, [
      event.provider,
      event.eventId,
    ]);
    throw err;
  }
}

async function linkForEvent(event: VerifiedPaymentEvent): Promise<PaymentLink | null> {
  if (event.linkId && /^[0-9a-f-]{36}$/i.test(event.linkId)) {
    const [row] = await db.select().from(paymentLinks).where(eq(paymentLinks.id, event.linkId));
    if (row && row.provider === event.provider) return row as PaymentLink;
  }
  if (event.sessionId) {
    const [row] = await db
      .select()
      .from(paymentLinks)
      .where(
        and(
          eq(paymentLinks.provider, event.provider),
          eq(paymentLinks.providerSessionId, event.sessionId)
        )
      );
    if (row) return row as PaymentLink;
  }
  return null;
}

async function applyPaidEvent(
  link: PaymentLink,
  event: VerifiedPaymentEvent,
  adapter: PaymentProviderAdapter
): Promise<WebhookOutcome> {
  // Claim the link: exactly one paid event can move it to processing.
  const claimed = await db
    .update(paymentLinks)
    .set({ status: "processing", updatedAt: new Date() })
    .where(
      and(
        eq(paymentLinks.id, link.id),
        inArray(paymentLinks.status, ["active", "expired", "cancelled"])
      )
    )
    .returning({ id: paymentLinks.id });
  if (!claimed.length) return { status: "duplicate" };

  const amountFils = event.amountFils ?? link.amountFils;
  if (event.currency && event.currency.toUpperCase() !== link.currency.toUpperCase()) {
    await db
      .update(paymentLinks)
      .set({ status: "active", updatedAt: new Date() })
      .where(eq(paymentLinks.id, link.id));
    throw new DomainError("PAYMENT_CURRENCY_MISMATCH", 422, {
      link: link.currency,
      event: event.currency,
    });
  }
  if (!has("invoices.recordPayment")) {
    const { registerInvoicePaymentService } = await import("../invoice-payment.service");
    registerInvoicePaymentService();
  }
  const recordPayment = resolve<RecordInvoicePaymentService>("invoices.recordPayment");
  const actor = await companyActor(link.companyId, link.createdBy);
  const depositAccountId = link.depositAccountId ?? (await ensureClearingAccount(link.companyId));
  let result: Awaited<ReturnType<RecordInvoicePaymentService>>;
  try {
    result = await recordPayment({
      invoiceId: link.invoiceId,
      companyId: link.companyId,
      amount: Number(fromFils(amountFils)),
      date: new Date(),
      method: "online",
      reference: `${event.provider}:${event.paymentReference ?? event.sessionId ?? event.eventId}`,
      notes: `Online payment via ${adapter.label.en} (link ${link.id})`,
      paymentAccountId: depositAccountId,
      createdBy: actor,
      // The customer has paid this money: any excess over the open balance is a credit.
      allowCredit: true,
    });
  } catch (err) {
    await db
      .update(paymentLinks)
      .set({ status: "active", updatedAt: new Date() })
      .where(eq(paymentLinks.id, link.id));
    throw err;
  }

  let feeFils: number | null = null;
  let feeEntryId: string | null = null;
  try {
    feeFils = adapter.fetchFeeFils ? await adapter.fetchFeeFils(event) : null;
    if (feeFils && feeFils > 0) {
      const chargesId = await ensureBankChargesAccount(link.companyId);
      const { entry } = await postJournal(
        {
          companyId: link.companyId,
          date: new Date().toISOString().slice(0, 10),
          memo: `Payment gateway fee (${event.provider}) for link ${link.id}`,
          status: "posted",
          source: "payment_gateway_fee",
          sourceId: link.id,
          idempotencyKey: `gateway_fee:${link.id}`,
          lines: [
            { accountId: chargesId, debitFils: feeFils, description: "Gateway processing fee" },
            {
              accountId: depositAccountId,
              creditFils: feeFils,
              description: "Gateway processing fee",
            },
          ],
        },
        { actorId: actor }
      );
      feeEntryId = entry.id;
    }
  } catch (err) {
    // The payment is posted; a missing fee is reported, not hidden.
    log.warn({ err: (err as Error)?.message, linkId: link.id }, "Gateway fee was not booked");
  }

  await db
    .update(paymentLinks)
    .set({
      status: "paid",
      paidAt: new Date(),
      paidAmountFils: amountFils,
      invoicePaymentId: result.payment.id,
      feeFils,
      feeJournalEntryId: feeEntryId,
      updatedAt: new Date(),
    })
    .where(eq(paymentLinks.id, link.id));

  await emailReceipt(link, amountFils, event).catch((err) =>
    log.warn({ err: (err as Error)?.message, linkId: link.id }, "Receipt email not queued")
  );
  return {
    status: "processed",
    paymentId: result.payment.id,
    invoiceStatus: result.invoice.status,
  };
}

async function emailReceipt(link: PaymentLink, amountFils: number, event: VerifiedPaymentEvent) {
  const [invoice] = await db.select().from(invoices).where(eq(invoices.id, link.invoiceId));
  if (!invoice?.contactId) return;
  const [contact] = await db
    .select()
    .from(customerContacts)
    .where(eq(customerContacts.id, invoice.contactId));
  if (!contact?.email) return;
  const [company] = await db.select().from(companies).where(eq(companies.id, link.companyId));
  const amount = `${link.currency} ${fromFils(amountFils)}`;
  const html = renderBilingualEmail(
    {
      brandName: company?.name ?? "Muhasib.ai",
      heading: { en: "Payment received — thank you", ar: "تم استلام الدفعة — شكراً لكم" },
      paragraphs: {
        en: [
          `Dear ${escapeHtml(contact.name)},`,
          `We received your online payment of <strong>${escapeHtml(amount)}</strong> for invoice <strong>${escapeHtml(invoice.number)}</strong>.`,
        ],
        ar: [
          `عزيزنا ${escapeHtml(contact.name)}،`,
          `استلمنا دفعتكم الإلكترونية بمبلغ <strong dir="ltr">${escapeHtml(amount)}</strong> عن الفاتورة رقم <strong>${escapeHtml(invoice.number)}</strong>.`,
        ],
      },
      summary: [
        { label: { en: "Invoice", ar: "الفاتورة" }, value: invoice.number },
        { label: { en: "Amount paid", ar: "المبلغ المدفوع" }, value: amount, strong: true },
        {
          label: { en: "Reference", ar: "المرجع" },
          value: event.paymentReference ?? event.eventId,
        },
      ],
    },
    contact.preferredLanguage === "ar"
      ? "ar"
      : contact.preferredLanguage === "en"
        ? "en"
        : "bilingual"
  );
  await sendEmail(
    contact.email,
    `Payment receipt — invoice ${invoice.number}`,
    `Payment received: ${amount}`,
    {
      html,
      companyId: link.companyId,
      category: "payment_receipt",
      relatedEntityType: "invoice",
      relatedEntityId: invoice.id,
      idempotencyKey: `payment_receipt:${link.id}`,
    }
  );
}
