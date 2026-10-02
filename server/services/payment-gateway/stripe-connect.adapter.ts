// Stripe Connect STANDARD adapter (Phase 8 D1): every company connects its OWN Stripe account (OAuth) and customers
// are charged ON that account (direct charges, the Stripe-Account header). No platform fee. The platform key is only
// used to run the OAuth exchange and to make requests on a connected account's behalf: Muhasib never holds tenants'
// customer money (that would make it a payment facilitator).

import Stripe from "stripe";
import { getEnv } from "../../config/env";
import { fromMinor, toMinor, isSupportedGatewayCurrency } from "./amounts";
import {
  GatewayError,
  type CheckoutRequest,
  type CheckoutSession,
  type GatewayProvider,
  type OAuthResult,
  type ParsedRefund,
  type PaymentDetails,
} from "./types";

const SESSION_LIFETIME_SECONDS = 24 * 60 * 60;

/** Pure: the refunds in a `charge.refunded` event (shared with the fake gateway). */
export function parseChargeRefundedEvent(event: any): ParsedRefund[] {
  if (event?.type !== "charge.refunded") return [];
  const charge = event?.data?.object;
  if (!charge) return [];
  const paymentId = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;
  if (!paymentId) return [];
  const list: any[] = Array.isArray(charge.refunds?.data) ? charge.refunds.data : [];
  return list
    .filter((r) => r && typeof r.id === "string" && (r.status === undefined || r.status === "succeeded"))
    .map((r) => ({
      refundId: r.id as string,
      chargeId: typeof charge.id === "string" ? charge.id : null,
      paymentId,
      amount: fromMinor(Number(r.amount)),
      currency: String(r.currency ?? charge.currency ?? "").toUpperCase(),
    }));
}

export class StripeConnectAdapter implements GatewayProvider {
  readonly name = "stripe" as const;

  constructor(private readonly clientFactory?: () => Stripe | null) {}

  private client(): Stripe | null {
    if (this.clientFactory) return this.clientFactory();
    const key = getEnv().STRIPE_SECRET_KEY;
    return key ? new Stripe(key, { apiVersion: "2024-12-18.acacia" as any }) : null;
  }

  private need(): Stripe {
    const c = this.client();
    if (!c) throw new GatewayError("Online payment is not configured.", "PAYMENT_NOT_CONFIGURED");
    return c;
  }

  isConfigured(): boolean {
    return !!this.client() && !!getEnv().STRIPE_CONNECT_CLIENT_ID;
  }

  oauthAuthorizeUrl(args: { state: string; redirectUri: string }): string {
    const clientId = getEnv().STRIPE_CONNECT_CLIENT_ID;
    if (!clientId) throw new GatewayError("Online payment is not configured.", "PAYMENT_NOT_CONFIGURED");
    const q = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      scope: "read_write",
      state: args.state,
      redirect_uri: args.redirectUri,
    });
    return `https://connect.stripe.com/oauth/authorize?${q.toString()}`;
  }

  async exchangeOAuthCode(code: string): Promise<OAuthResult> {
    const res: any = await this.need().oauth.token({ grant_type: "authorization_code", code });
    if (!res?.stripe_user_id) throw new GatewayError("Stripe did not return an account.", "OAUTH_FAILED");
    return { accountId: res.stripe_user_id as string, livemode: !!res.livemode };
  }

  async deauthorize(accountId: string): Promise<void> {
    const clientId = getEnv().STRIPE_CONNECT_CLIENT_ID;
    if (!clientId) return;
    await this.need().oauth.deauthorize({ client_id: clientId, stripe_user_id: accountId });
  }

  async createCheckout(req: CheckoutRequest): Promise<CheckoutSession> {
    if (!isSupportedGatewayCurrency(req.currency)) {
      throw new GatewayError(`${req.currency} cannot be paid online.`, "CURRENCY_NOT_SUPPORTED");
    }
    const metadata = { kind: "invoice", invoiceId: req.invoiceId, companyId: req.companyId };
    const session = await this.need().checkout.sessions.create(
      {
        mode: "payment",
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: req.currency.toLowerCase(),
              unit_amount: toMinor(req.amount),
              product_data: { name: req.description },
            },
          },
        ],
        success_url: req.successUrl,
        cancel_url: req.cancelUrl,
        customer_email: req.customerEmail || undefined,
        client_reference_id: req.invoiceId,
        metadata,
        payment_intent_data: { metadata },
        expires_at: Math.floor(Date.now() / 1000) + SESSION_LIFETIME_SECONDS,
      },
      { stripeAccount: req.accountId }
    );
    if (!session.url) throw new GatewayError("Stripe returned no checkout URL.", "CHECKOUT_FAILED");
    return { sessionId: session.id, url: session.url, expiresAt: session.expires_at ? new Date(session.expires_at * 1000) : null };
  }

  async expireCheckout(args: { accountId: string; sessionId: string }): Promise<void> {
    try {
      await this.need().checkout.sessions.expire(args.sessionId, {}, { stripeAccount: args.accountId });
    } catch (err: any) {
      // Already expired or completed: nothing left to expire.
      if (err?.code === "resource_missing" || /not.*open|already/i.test(String(err?.message))) return;
      throw err;
    }
  }

  async retrievePayment(args: { accountId: string; paymentId: string }): Promise<PaymentDetails> {
    const pi: any = await this.need().paymentIntents.retrieve(
      args.paymentId,
      { expand: ["latest_charge.balance_transaction"] },
      { stripeAccount: args.accountId }
    );
    const charge = typeof pi.latest_charge === "object" ? pi.latest_charge : null;
    const bt = charge && typeof charge.balance_transaction === "object" ? charge.balance_transaction : null;
    let feeAed: number | null = null;
    let settledAed: number | null = null;
    if (bt) {
      if (String(bt.currency).toLowerCase() !== "aed") {
        throw new GatewayError("The Stripe balance is not in AED, so the fee cannot be posted.", "FEE_CURRENCY_UNSUPPORTED");
      }
      feeAed = fromMinor(Number(bt.fee));
      settledAed = fromMinor(Number(bt.amount));
    }
    return {
      paymentId: pi.id,
      chargeId: charge?.id ?? null,
      amount: fromMinor(Number(pi.amount_received ?? pi.amount)),
      currency: String(pi.currency).toUpperCase(),
      feeAed,
      settledAed,
      status: pi.status === "succeeded" ? "succeeded" : pi.status === "canceled" ? "failed" : "pending",
    };
  }

  async parseRefunds(event: any): Promise<ParsedRefund[]> {
    const direct = parseChargeRefundedEvent(event);
    if (direct.length > 0) return direct;
    // Since API version 2022-11-15 a Charge no longer carries its refunds list: ask Stripe for them.
    const charge = event?.data?.object;
    if (event?.type !== "charge.refunded" || !charge?.id || !event?.account) return [];
    const paymentId = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;
    if (!paymentId) return [];
    const list = await this.need().refunds.list({ charge: charge.id, limit: 100 }, { stripeAccount: event.account });
    return list.data
      .filter((r: any) => r.status === "succeeded")
      .map((r: any) => ({
        refundId: r.id as string,
        chargeId: charge.id as string,
        paymentId,
        amount: fromMinor(Number(r.amount)),
        currency: String(r.currency).toUpperCase(),
      }));
  }
}
