import { describe, expect, it } from "vitest";
import { verifyCheckoutCompleted } from "../../server/services/payment-gateway/verify";
import { hashState, signState, verifyState, STATE_TTL_MS } from "../../server/services/payment-gateway/state";
import { fromMinor, isSupportedGatewayCurrency, toMinor } from "../../server/services/payment-gateway/amounts";
import { parseChargeRefundedEvent } from "../../server/services/payment-gateway/stripe-connect.adapter";
import { FakeGatewayAdapter, fakeFeeAed } from "../../server/services/payment-gateway/fake.adapter";
import { isFakeGatewayInProduction } from "../../server/config/env";

const link = { companyId: "co-A", invoiceId: "inv-1", amount: 997.5, currency: "AED" };
const connection = { companyId: "co-A", externalAccountId: "acct_A", status: "active" };
const session = (over: Record<string, unknown> = {}) => ({
  id: "cs_1",
  payment_status: "paid",
  payment_intent: "pi_1",
  amount_total: 99750,
  currency: "aed",
  metadata: { kind: "invoice", invoiceId: "inv-1" },
  ...over,
});

describe("verifyCheckoutCompleted: money is posted only when our own records agree with the signed event", () => {
  it("accepts a genuine paid session", () => {
    expect(verifyCheckoutCompleted({ eventAccount: "acct_A", session: session(), link, connection })).toEqual({
      ok: true,
      paymentId: "pi_1",
      amount: 997.5,
      currency: "AED",
    });
  });
  it("refuses an event without a connected account", () => {
    expect(verifyCheckoutCompleted({ eventAccount: null, session: session(), link, connection })).toMatchObject({ ok: false, reason: "no_account" });
  });
  it("refuses a session we never created", () => {
    expect(verifyCheckoutCompleted({ eventAccount: "acct_A", session: session(), link: null, connection })).toMatchObject({ ok: false, reason: "unknown_session" });
  });
  it("refuses an event from an account that is not the one connected to the link's company", () => {
    expect(verifyCheckoutCompleted({ eventAccount: "acct_EVIL", session: session(), link, connection: null })).toMatchObject({ ok: false, reason: "foreign_account" });
    expect(verifyCheckoutCompleted({ eventAccount: "acct_A", session: session(), link, connection: { ...connection, companyId: "co-B" } })).toMatchObject({ ok: false, reason: "foreign_account" });
    expect(verifyCheckoutCompleted({ eventAccount: "acct_A", session: session(), link, connection: { ...connection, status: "revoked" } })).toMatchObject({ ok: false, reason: "foreign_account" });
  });
  it("refuses metadata that names another invoice", () => {
    expect(verifyCheckoutCompleted({ eventAccount: "acct_A", session: session({ metadata: { invoiceId: "inv-2" } }), link, connection })).toMatchObject({ ok: false, reason: "invoice_mismatch" });
  });
  it("refuses a different amount or currency than we asked for", () => {
    expect(verifyCheckoutCompleted({ eventAccount: "acct_A", session: session({ amount_total: 100 }), link, connection })).toMatchObject({ ok: false, reason: "amount_mismatch" });
    expect(verifyCheckoutCompleted({ eventAccount: "acct_A", session: session({ currency: "usd" }), link, connection })).toMatchObject({ ok: false, reason: "currency_mismatch" });
  });
  it("refuses an unpaid session and one without a payment id", () => {
    expect(verifyCheckoutCompleted({ eventAccount: "acct_A", session: session({ payment_status: "unpaid" }), link, connection })).toMatchObject({ ok: false, reason: "not_paid" });
    expect(verifyCheckoutCompleted({ eventAccount: "acct_A", session: session({ payment_intent: null }), link, connection })).toMatchObject({ ok: false, reason: "no_payment_id" });
  });
  it("metadata alone never makes an event trustworthy: no metadata is fine when the link matches", () => {
    expect(verifyCheckoutCompleted({ eventAccount: "acct_A", session: session({ metadata: null }), link, connection }).ok).toBe(true);
  });
});

describe("OAuth state", () => {
  const secret = "s3cret";
  it("round-trips company and user", () => {
    const state = signState({ companyId: "co", userId: "u", secret });
    expect(verifyState(state, secret)).toEqual({ ok: true, companyId: "co", userId: "u" });
  });
  it("rejects a tampered state, a wrong secret and an expired state", () => {
    const state = signState({ companyId: "co", userId: "u", secret, now: 1_000_000 });
    expect(verifyState(state.replace(/.$/, "x"), secret, 1_000_001)).toMatchObject({ ok: false });
    expect(verifyState(state, "other", 1_000_001)).toMatchObject({ ok: false, reason: "bad_signature" });
    expect(verifyState(state, secret, 1_000_000 + STATE_TTL_MS + 1)).toMatchObject({ ok: false, reason: "expired" });
    expect(verifyState(state, secret, 1_000_000 + STATE_TTL_MS - 1).ok).toBe(true);
    expect(verifyState("nonsense", secret)).toMatchObject({ ok: false, reason: "malformed" });
  });
  it("a state hash is stable and differs per state", () => {
    const a = signState({ companyId: "co", userId: "u", secret });
    const b = signState({ companyId: "co", userId: "u", secret });
    expect(hashState(a)).toBe(hashState(a));
    expect(hashState(a)).not.toBe(hashState(b));
  });
});

describe("amounts", () => {
  it("converts to and from minor units exactly", () => {
    expect(toMinor(997.5)).toBe(99750);
    expect(toMinor(0.1 + 0.2)).toBe(30);
    expect(fromMinor(99750)).toBe(997.5);
  });
  it("refuses zero- and three-decimal currencies online", () => {
    expect(isSupportedGatewayCurrency("AED")).toBe(true);
    expect(isSupportedGatewayCurrency("USD")).toBe(true);
    expect(isSupportedGatewayCurrency("JPY")).toBe(false);
    expect(isSupportedGatewayCurrency("KWD")).toBe(false);
  });
});

describe("refund events", () => {
  const event = {
    type: "charge.refunded",
    account: "acct_A",
    data: { object: { id: "ch_1", payment_intent: "pi_1", currency: "aed", refunds: { data: [{ id: "re_1", amount: 20000, currency: "aed", status: "succeeded" }, { id: "re_2", amount: 100, currency: "aed", status: "failed" }] } } },
  };
  it("returns the succeeded refunds with major-unit amounts", () => {
    expect(parseChargeRefundedEvent(event)).toEqual([{ refundId: "re_1", chargeId: "ch_1", paymentId: "pi_1", amount: 200, currency: "AED" }]);
  });
  it("ignores other event types and charges without a payment intent", () => {
    expect(parseChargeRefundedEvent({ ...event, type: "charge.succeeded" })).toEqual([]);
    expect(parseChargeRefundedEvent({ ...event, data: { object: { id: "ch_1", refunds: { data: [] } } } })).toEqual([]);
  });
});

describe("fake gateway", () => {
  it("fee is 2.9% + 1.00 AED of the settled amount", () => {
    expect(fakeFeeAed(997.5)).toBe(29.93);
    expect(fakeFeeAed(100)).toBe(3.9);
  });
  it("settles a foreign charge at the stated rate and refuses to guess one", async () => {
    const fake = new FakeGatewayAdapter();
    const ok = await fake.retrievePayment({ accountId: "acct", paymentId: "pi_x", hint: { amount: 100, currency: "USD", fakeRate: 3.6725 } });
    expect(ok.settledAed).toBe(367.25);
    expect(ok.feeAed).toBe(fakeFeeAed(367.25));
    await expect(fake.retrievePayment({ accountId: "acct", paymentId: "pi_x", hint: { amount: 100, currency: "USD" } })).rejects.toThrow();
  });
  it("onboarding goes straight back to our own callback and the code exchanges to an account", async () => {
    const fake = new FakeGatewayAdapter();
    const url = fake.oauthAuthorizeUrl({ state: "st", redirectUri: "http://localhost/api/payment-gateway/stripe/callback" });
    const code = new URL(url).searchParams.get("code")!;
    expect(url).toContain("state=st");
    expect((await fake.exchangeOAuthCode(code)).accountId).toBe(`acct_${code}`);
    await expect(fake.exchangeOAuthCode("junk")).rejects.toThrow();
  });
});

describe("the fake gateway never runs in production", () => {
  it("is refused only in production with the flag on", () => {
    expect(isFakeGatewayInProduction({ NODE_ENV: "production", PAYMENT_GATEWAY_FAKE: "1" })).toBe(true);
    expect(isFakeGatewayInProduction({ NODE_ENV: "development", PAYMENT_GATEWAY_FAKE: "1" })).toBe(false);
    expect(isFakeGatewayInProduction({ NODE_ENV: "production" })).toBe(false);
  });
});
