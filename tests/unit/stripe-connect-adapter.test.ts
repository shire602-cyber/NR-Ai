import { describe, expect, it, vi } from "vitest";
import { StripeConnectAdapter } from "../../server/services/payment-gateway/stripe-connect.adapter";

// A minimal stand-in for the Stripe client: records the request options so the Stripe-Account header (direct charge on
// the company's own connected account) can be asserted without any network.
function fakeStripe() {
  const calls: any = {};
  const client: any = {
    checkout: {
      sessions: {
        create: vi.fn(async (params: any, opts: any) => {
          calls.create = { params, opts };
          return { id: "cs_live_1", url: "https://checkout.stripe.test/c/cs_live_1", expires_at: 1_900_000_000 };
        }),
        expire: vi.fn(async (id: string, _p: any, opts: any) => {
          calls.expire = { id, opts };
        }),
      },
    },
    paymentIntents: {
      retrieve: vi.fn(async (id: string, params: any, opts: any) => {
        calls.retrieve = { id, params, opts };
        return {
          id,
          status: "succeeded",
          amount: 99750,
          amount_received: 99750,
          currency: "aed",
          latest_charge: { id: "ch_1", balance_transaction: { currency: "aed", fee: 2993, amount: 99750 } },
        };
      }),
    },
    refunds: { list: vi.fn(async () => ({ data: [{ id: "re_9", amount: 5000, currency: "aed", status: "succeeded" }] })) },
  };
  return { client, calls };
}

describe("StripeConnectAdapter (Stripe Connect Standard, direct charges)", () => {
  it("is not configured without keys", () => {
    const adapter = new StripeConnectAdapter(() => null);
    expect(adapter.isConfigured()).toBe(false);
  });

  it("creates the checkout ON the connected account, in minor units, with metadata that names the invoice", async () => {
    const { client, calls } = fakeStripe();
    const adapter = new StripeConnectAdapter(() => client);
    const session = await adapter.createCheckout({
      accountId: "acct_123",
      companyId: "co-1",
      invoiceId: "inv-1",
      invoiceNumber: "INV-1",
      amount: 997.5,
      currency: "AED",
      successUrl: "https://app/ok",
      cancelUrl: "https://app/no",
      description: "Invoice INV-1",
    });
    expect(session).toMatchObject({ sessionId: "cs_live_1", url: "https://checkout.stripe.test/c/cs_live_1" });
    expect(calls.create.opts).toEqual({ stripeAccount: "acct_123" });
    expect(calls.create.params.mode).toBe("payment");
    expect(calls.create.params.line_items[0].price_data.unit_amount).toBe(99750);
    expect(calls.create.params.line_items[0].price_data.currency).toBe("aed");
    expect(calls.create.params.metadata).toEqual({ kind: "invoice", invoiceId: "inv-1", companyId: "co-1" });
    // no platform fee: this is a direct charge on the company's own account
    expect(calls.create.params.payment_intent_data.application_fee_amount).toBeUndefined();
  });

  it("refuses a zero-decimal currency instead of charging 100x", async () => {
    const { client } = fakeStripe();
    const adapter = new StripeConnectAdapter(() => client);
    await expect(
      adapter.createCheckout({ accountId: "acct_1", companyId: "c", invoiceId: "i", invoiceNumber: "n", amount: 1000, currency: "JPY", successUrl: "u", cancelUrl: "u", description: "d" })
    ).rejects.toMatchObject({ code: "CURRENCY_NOT_SUPPORTED" });
  });

  it("reads amount, fee and settlement in AED from the balance transaction of the connected account's charge", async () => {
    const { client, calls } = fakeStripe();
    const adapter = new StripeConnectAdapter(() => client);
    const details = await adapter.retrievePayment({ accountId: "acct_123", paymentId: "pi_1" });
    expect(calls.retrieve.opts).toEqual({ stripeAccount: "acct_123" });
    expect(calls.retrieve.params.expand).toContain("latest_charge.balance_transaction");
    expect(details).toMatchObject({ paymentId: "pi_1", chargeId: "ch_1", amount: 997.5, currency: "AED", feeAed: 29.93, settledAed: 997.5, status: "succeeded" });
  });

  it("reports the fee as unknown while the balance transaction is missing", async () => {
    const { client } = fakeStripe();
    client.paymentIntents.retrieve = vi.fn(async () => ({ id: "pi_2", status: "succeeded", amount: 100, currency: "aed", latest_charge: { id: "ch_2", balance_transaction: null } }));
    const adapter = new StripeConnectAdapter(() => client);
    expect((await adapter.retrievePayment({ accountId: "a", paymentId: "pi_2" })).feeAed).toBeNull();
  });

  it("a non-AED balance cannot be posted (the fee is stated in AED)", async () => {
    const { client } = fakeStripe();
    client.paymentIntents.retrieve = vi.fn(async () => ({ id: "pi_3", status: "succeeded", amount: 100, currency: "usd", latest_charge: { id: "ch", balance_transaction: { currency: "usd", fee: 10, amount: 100 } } }));
    const adapter = new StripeConnectAdapter(() => client);
    await expect(adapter.retrievePayment({ accountId: "a", paymentId: "pi_3" })).rejects.toMatchObject({ code: "FEE_CURRENCY_UNSUPPORTED" });
  });

  it("asks Stripe for the refunds when the charge event does not carry them (API >= 2022-11-15)", async () => {
    const { client } = fakeStripe();
    const adapter = new StripeConnectAdapter(() => client);
    const refunds = await adapter.parseRefunds({
      type: "charge.refunded",
      account: "acct_123",
      data: { object: { id: "ch_1", payment_intent: "pi_1", currency: "aed" } },
    });
    expect(refunds).toEqual([{ refundId: "re_9", chargeId: "ch_1", paymentId: "pi_1", amount: 50, currency: "AED" }]);
  });

  it("expiring an already closed session is not an error", async () => {
    const { client } = fakeStripe();
    client.checkout.sessions.expire = vi.fn(async () => {
      throw Object.assign(new Error("Only open sessions can be expired"), { code: "resource_missing" });
    });
    const adapter = new StripeConnectAdapter(() => client);
    await expect(adapter.expireCheckout({ accountId: "a", sessionId: "cs" })).resolves.toBeUndefined();
  });
});
