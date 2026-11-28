/**
 * Stripe Checkout adapter for invoice payments (W4-D, R16-14). Separate from SaaS billing
 * (server/routes/billing.routes.ts).
 *
 * Config: STRIPE_SECRET_KEY + INVOICE_PAYMENTS_ENABLED=true + a webhook signing secret
 * (STRIPE_INVOICE_WEBHOOK_SECRET, falling back to STRIPE_WEBHOOK_SECRET). sk_live_ keys are
 * `live`, anything else `sandbox` (test mode, labelled in the UI).
 *
 * The Stripe REST API is called with fetch (injectable for tests: setStripeFetch) and webhooks
 * are verified with Stripe's v1 scheme: HMAC-SHA256 over `${t}.${rawBody}`, 5-minute tolerance.
 */
import crypto from "crypto";
import type { CapabilityStatus } from "../../../shared/capabilities";
import { DomainError } from "../../errors";
import {
  WebhookSignatureError,
  type CheckoutSession,
  type CheckoutSessionInput,
  type PaymentProviderAdapter,
  type VerifiedPaymentEvent,
} from "./types";

type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string }
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

let fetchImpl: FetchLike | null = null;

/** Tests only: replace the HTTP client used for api.stripe.com (null restores fetch). */
export function setStripeFetch(fn: FetchLike | null): void {
  fetchImpl = fn;
}

const STRIPE_API = "https://api.stripe.com/v1";
const env = (n: string) => (process.env[n] ?? "").trim();
const flag = (n: string) => ["1", "true", "yes", "on"].includes(env(n).toLowerCase());

export function stripeWebhookSecret(): string {
  return env("STRIPE_INVOICE_WEBHOOK_SECRET") || env("STRIPE_WEBHOOK_SECRET");
}

function form(params: Record<string, string | number | undefined | null>): string {
  return Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");
}

async function stripeRequest(
  method: "GET" | "POST",
  path: string,
  body?: string
): Promise<Record<string, unknown>> {
  const f: FetchLike = fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  const res = await f(`${STRIPE_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env("STRIPE_SECRET_KEY")}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Stripe-Version": "2024-06-20",
    },
    ...(body ? { body } : {}),
  });
  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    const msg = (json?.error as { message?: string } | undefined)?.message ?? `HTTP ${res.status}`;
    throw new DomainError("PAYMENT_PROVIDER_ERROR", 502, { provider: "stripe" }, msg);
  }
  return json;
}

/** Build a Stripe-Signature header (tests and local tooling). */
export function signStripePayload(payload: string, secret: string, timestamp?: number): string {
  const t = timestamp ?? Math.floor(Date.now() / 1000);
  const v1 = crypto.createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex");
  return `t=${t},v1=${v1}`;
}

export function verifyStripeSignature(
  payload: string,
  header: string | undefined,
  secret: string,
  toleranceSeconds = 300
): boolean {
  if (!header || !secret) return false;
  const parts = header.split(",").map((p) => p.trim().split("="));
  const t = Number(parts.find(([k]) => k === "t")?.[1]);
  const sigs = parts.filter(([k]) => k === "v1").map(([, v]) => v ?? "");
  if (!Number.isFinite(t) || !sigs.length) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - t) > toleranceSeconds) return false;
  const expected = Buffer.from(
    crypto.createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex")
  );
  return sigs.some((s) => {
    const got = Buffer.from(s);
    return got.length === expected.length && crypto.timingSafeEqual(got, expected);
  });
}

interface StripeSession {
  id?: string;
  payment_status?: string;
  amount_total?: number;
  currency?: string;
  payment_intent?: string | null;
  client_reference_id?: string | null;
  metadata?: Record<string, string>;
}

export const stripeAdapter: PaymentProviderAdapter = {
  id: "stripe",
  label: { en: "Card payment (Stripe)", ar: "الدفع بالبطاقة (Stripe)" },
  status(): CapabilityStatus {
    if (!env("STRIPE_SECRET_KEY") || !flag("INVOICE_PAYMENTS_ENABLED") || !stripeWebhookSecret()) {
      return "requires_external";
    }
    return env("STRIPE_SECRET_KEY").startsWith("sk_live_") ? "live" : "sandbox";
  },
  async createCheckoutSession(input: CheckoutSessionInput): Promise<CheckoutSession> {
    const body = form({
      mode: "payment",
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      client_reference_id: input.linkId,
      customer_email: input.customerEmail ?? undefined,
      // Stripe allows 30 minutes .. 24 hours.
      expires_at: Math.floor(
        Math.min(input.expiresAt.getTime(), Date.now() + 23 * 3_600_000) / 1000
      ),
      "line_items[0][quantity]": 1,
      "line_items[0][price_data][currency]": input.currency.toLowerCase(),
      "line_items[0][price_data][unit_amount]": input.amountFils,
      "line_items[0][price_data][product_data][name]": `Invoice ${input.invoiceNumber} — ${input.companyName}`,
      "metadata[payment_link_id]": input.linkId,
      "metadata[invoice_id]": input.invoiceId,
      "payment_intent_data[metadata][payment_link_id]": input.linkId,
    });
    const session = (await stripeRequest("POST", "/checkout/sessions", body)) as {
      id?: string;
      url?: string;
    };
    if (!session.id || !session.url) {
      throw new DomainError("PAYMENT_PROVIDER_ERROR", 502, { provider: "stripe" });
    }
    return { sessionId: session.id, url: session.url };
  },
  verifyWebhook(rawBody, headers): VerifiedPaymentEvent {
    if (!verifyStripeSignature(rawBody, headers["stripe-signature"], stripeWebhookSecret())) {
      throw new WebhookSignatureError();
    }
    let evt: { id?: string; type?: string; data?: { object?: StripeSession } };
    try {
      evt = JSON.parse(rawBody);
    } catch {
      throw new WebhookSignatureError("Webhook body is not JSON");
    }
    const obj = evt.data?.object ?? {};
    const type = evt.type ?? "unknown";
    let kind: VerifiedPaymentEvent["kind"] = "ignored";
    if (type === "checkout.session.completed" && obj.payment_status === "paid") kind = "paid";
    else if (type === "checkout.session.async_payment_succeeded") kind = "paid";
    else if (type === "checkout.session.async_payment_failed") kind = "failed";
    else if (type === "checkout.session.expired") kind = "expired";
    return {
      provider: "stripe",
      eventId: evt.id ?? "",
      type,
      kind,
      sessionId: obj.id ?? null,
      linkId: obj.metadata?.payment_link_id ?? obj.client_reference_id ?? null,
      amountFils: typeof obj.amount_total === "number" ? obj.amount_total : null,
      currency: obj.currency ? obj.currency.toUpperCase() : null,
      paymentReference: obj.payment_intent ?? obj.id ?? null,
    };
  },
  async fetchFeeFils(event): Promise<number | null> {
    if (!event.paymentReference || !event.paymentReference.startsWith("pi_")) return null;
    try {
      const pi = (await stripeRequest(
        "GET",
        `/payment_intents/${encodeURIComponent(event.paymentReference)}?expand[]=latest_charge.balance_transaction`
      )) as {
        latest_charge?: { balance_transaction?: { fee?: number; currency?: string } };
      };
      const bt = pi.latest_charge?.balance_transaction;
      if (!bt || typeof bt.fee !== "number") return null;
      // Only book the fee when Stripe settles in the base currency.
      return (bt.currency ?? "").toUpperCase() === "AED" ? bt.fee : null;
    } catch {
      return null;
    }
  },
};
