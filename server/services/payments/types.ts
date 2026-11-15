/**
 * Online invoice payment gateway boundary (W4-D, R16-14).
 *
 * An adapter turns a payment link into a hosted checkout session and turns the gateway's
 * signed webhook into a verified, provider-neutral event. Adapters never touch the ledger: the
 * payment-links service posts through the registered "invoices.recordPayment" service.
 */
import type { CapabilityStatus } from "../../../shared/capabilities";
import type { PaymentProviderId } from "../../../shared/validators/portal";

export type { PaymentProviderId };

export interface CheckoutSessionInput {
  linkId: string;
  invoiceId: string;
  invoiceNumber: string;
  companyName: string;
  /** Minor units (fils for AED). */
  amountFils: number;
  currency: string;
  customerEmail?: string | null;
  successUrl: string;
  cancelUrl: string;
  expiresAt: Date;
}

export interface CheckoutSession {
  sessionId: string;
  url: string;
}

export type PaymentEventKind = "paid" | "failed" | "expired" | "ignored";

export interface VerifiedPaymentEvent {
  provider: PaymentProviderId;
  eventId: string;
  type: string;
  kind: PaymentEventKind;
  sessionId?: string | null;
  linkId?: string | null;
  amountFils?: number | null;
  currency?: string | null;
  /** Gateway reference stored on the invoice payment (e.g. Stripe payment intent). */
  paymentReference?: string | null;
}

export class WebhookSignatureError extends Error {
  constructor(message = "Invalid webhook signature") {
    super(message);
    this.name = "WebhookSignatureError";
  }
}

export interface PaymentProviderAdapter {
  id: PaymentProviderId;
  label: { en: string; ar: string };
  /** live/sandbox when usable; requires_external until merchant onboarding is done. */
  status(): CapabilityStatus;
  createCheckoutSession(input: CheckoutSessionInput): Promise<CheckoutSession>;
  verifyWebhook(rawBody: string, headers: Record<string, string | undefined>): VerifiedPaymentEvent;
  /** Gateway fee in base-currency (AED) fils for a paid event, or null when unknown. */
  fetchFeeFils?(event: VerifiedPaymentEvent): Promise<number | null>;
}
