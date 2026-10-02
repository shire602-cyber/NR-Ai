// The payment gateway provider interface (Phase 8 D1). One implementation per provider; PayTabs and Telr can be
// added behind this contract. Money settles ONLY through storage.recordInvoicePayment (see settle.service.ts); a
// provider just creates checkouts, reports what a payment cost and what it was in AED, and parses refunds.

export type GatewayProviderName = "stripe" | "fake";

export interface CheckoutRequest {
  /** The company's own connected account (Stripe: acct_...). Direct charges are made ON this account. */
  accountId: string;
  companyId: string;
  invoiceId: string;
  invoiceNumber: string;
  /** Amount in the invoice currency, 2 decimals. */
  amount: number;
  currency: string;
  customerEmail?: string | null;
  successUrl: string;
  cancelUrl: string;
  description: string;
  /** Test hook: AED per unit of `currency` the fake gateway settles at. Ignored by real providers. */
  fakeRate?: number;
}

export interface CheckoutSession {
  sessionId: string;
  url: string;
  expiresAt: Date | null;
}

export interface PaymentDetails {
  paymentId: string;
  chargeId: string | null;
  /** Charged amount in `currency`. */
  amount: number;
  currency: string;
  /** What the provider kept, in AED (from the balance transaction); null while it is not known yet. */
  feeAed: number | null;
  /** What lands in the merchant's balance, in AED. */
  settledAed: number | null;
  status: "succeeded" | "pending" | "failed";
}

export interface ParsedRefund {
  refundId: string;
  chargeId: string | null;
  paymentId: string;
  amount: number;
  currency: string;
}

export interface OAuthResult {
  accountId: string;
  livemode: boolean;
}

export interface GatewayProvider {
  readonly name: GatewayProviderName;
  /** Keys present: the provider can be used at all. Off (false) without them, and the UI says "not configured". */
  isConfigured(): boolean;
  /** The URL that sends a company owner to the provider to connect their own account. */
  oauthAuthorizeUrl(args: { state: string; redirectUri: string }): string;
  exchangeOAuthCode(code: string): Promise<OAuthResult>;
  deauthorize(accountId: string): Promise<void>;
  createCheckout(req: CheckoutRequest): Promise<CheckoutSession>;
  expireCheckout(args: { accountId: string; sessionId: string }): Promise<void>;
  retrievePayment(args: {
    accountId: string;
    paymentId: string;
    /** What the signed event itself said (the fake gateway has no API to ask). */
    hint?: { amount: number; currency: string; fakeRate?: number };
  }): Promise<PaymentDetails>;
  /** The refunds a `charge.refunded` event reports (amounts in the charge currency). */
  parseRefunds(event: unknown): Promise<ParsedRefund[]> | ParsedRefund[];
}

export class GatewayError extends Error {
  constructor(
    message: string,
    public readonly code: string
  ) {
    super(message);
    this.name = "GatewayError";
  }
}
