// Fake gateway for tests (Phase 8 D1). Switched on by PAYMENT_GATEWAY_FAKE=1; the boot refuses it in production.
// It behaves like the Stripe adapter from the outside (same interface, same event shapes) but needs no keys and no
// network: onboarding returns a link straight back to our own callback, checkouts are in-memory, and the fee is a
// deterministic 2.9% + 1.00 AED so tests can assert the fee journal exactly.

import { randomBytes } from "crypto";
import Decimal from "decimal.js";
import { parseChargeRefundedEvent } from "./stripe-connect.adapter";
import {
  GatewayError,
  type CheckoutRequest,
  type CheckoutSession,
  type GatewayProvider,
  type OAuthResult,
  type ParsedRefund,
  type PaymentDetails,
} from "./types";

export const FAKE_PLATFORM_WEBHOOK_SECRET = "whsec_fake_platform_secret";
export const FAKE_CONNECT_WEBHOOK_SECRET = "whsec_fake_connect_secret";

/** The fee the fake gateway "charges": 2.9% + AED 1.00 of the AED settled amount. */
export function fakeFeeAed(settledAed: number): number {
  return new Decimal(settledAed).times(0.029).plus(1).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();
}

const sessions = new Map<string, { amount: number; currency: string; fakeRate?: number; expired: boolean }>();

export class FakeGatewayAdapter implements GatewayProvider {
  readonly name = "fake" as const;

  isConfigured(): boolean {
    return true;
  }

  oauthAuthorizeUrl(args: { state: string; redirectUri: string }): string {
    const account = `fake_${randomBytes(5).toString("hex")}`;
    const q = new URLSearchParams({ code: account, state: args.state });
    return `${args.redirectUri}?${q.toString()}`;
  }

  async exchangeOAuthCode(code: string): Promise<OAuthResult> {
    if (!/^fake_[0-9a-z]+$/i.test(code)) throw new GatewayError("Invalid authorisation code.", "OAUTH_FAILED");
    return { accountId: `acct_${code}`, livemode: false };
  }

  async deauthorize(): Promise<void> {}

  async createCheckout(req: CheckoutRequest): Promise<CheckoutSession> {
    const sessionId = `cs_fake_${randomBytes(8).toString("hex")}`;
    sessions.set(sessionId, { amount: req.amount, currency: req.currency.toUpperCase(), fakeRate: req.fakeRate, expired: false });
    return { sessionId, url: `https://fake-pay.example.test/c/${sessionId}`, expiresAt: new Date(Date.now() + 24 * 3600 * 1000) };
  }

  async expireCheckout(args: { sessionId: string }): Promise<void> {
    const s = sessions.get(args.sessionId);
    if (s) s.expired = true;
  }

  async retrievePayment(args: {
    accountId: string;
    paymentId: string;
    hint?: { amount: number; currency: string; fakeRate?: number };
  }): Promise<PaymentDetails> {
    const hint = args.hint;
    if (!hint) throw new GatewayError("The fake gateway needs the event's own amount.", "FAKE_NEEDS_HINT");
    const rate = hint.fakeRate && hint.fakeRate > 0 ? hint.fakeRate : hint.currency.toUpperCase() === "AED" ? 1 : 0;
    if (!rate) throw new GatewayError("The fake gateway needs a rate for a foreign currency.", "FAKE_NEEDS_RATE");
    const settledAed = new Decimal(hint.amount).times(rate).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();
    return {
      paymentId: args.paymentId,
      chargeId: `ch_fake_${args.paymentId.slice(-8)}`,
      amount: hint.amount,
      currency: hint.currency.toUpperCase(),
      feeAed: fakeFeeAed(settledAed),
      settledAed,
      status: "succeeded",
    };
  }

  parseRefunds(event: unknown): ParsedRefund[] {
    return parseChargeRefundedEvent(event);
  }
}
