import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../server/storage", () => ({ storage: {} }));
vi.mock("../../server/config/env", () => ({ getEnv: () => ({}) }));
vi.mock("../../server/config/logger", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import { handleWebhookEvent, type BillingStore } from "../../server/services/stripe.service";

const NOW_S = 1_790_000_000; // seconds
const COMPANY = "co-1";

type Row = Record<string, any>;

function makeStore(initial: Row | null) {
  let row: Row | null = initial ? { ...initial } : null;
  const claimed = new Set<string>();
  const store: BillingStore & { row: () => Row | null; claimed: Set<string> } = {
    claimStripeEvent: vi.fn(async (id: string) => (claimed.has(id) ? false : (claimed.add(id), true))),
    releaseStripeEvent: vi.fn(async (id: string) => void claimed.delete(id)),
    getSubscription: vi.fn(async (companyId: string) => (row && row.companyId === companyId ? row : undefined)),
    getSubscriptionByStripeCustomerId: vi.fn(async (id: string) => (row?.stripeCustomerId === id ? row : undefined)),
    getSubscriptionByStripeSubscriptionId: vi.fn(async (id: string) =>
      row?.stripeSubscriptionId === id ? row : undefined
    ),
    createSubscription: vi.fn(async (data: Row) => (row = { id: "sub-row-1", ...data })),
    updateSubscription: vi.fn(async (_id: string, data: Row) => (row = { ...row!, ...data })),
    row: () => row,
    claimed,
  };
  return store;
}

const trialRow = {
  id: "sub-row-1",
  companyId: COMPANY,
  planId: "professional",
  planName: "Professional",
  status: "trialing",
  trialEndsAt: new Date("2026-10-10T00:00:00Z"),
  currentPeriodStart: new Date("2026-09-26T00:00:00Z"),
  currentPeriodEnd: new Date("2026-10-10T00:00:00Z"),
  stripeCustomerId: null,
  stripeSubscriptionId: null,
};

const evt = (id: string, type: string, object: Row): any => ({ id, type, data: { object } });

const stripeSub = (over: Row = {}) => ({
  id: "sub_1",
  customer: "cus_1",
  status: "active",
  cancel_at_period_end: false,
  current_period_start: NOW_S,
  current_period_end: NOW_S + 30 * 86400,
  metadata: { companyId: COMPANY, planId: "starter", billingCycle: "monthly" },
  ...over,
});

let store: ReturnType<typeof makeStore>;
beforeEach(() => {
  store = makeStore(trialRow);
});

describe("stripe webhook handler", () => {
  it("checkout.session.completed activates the paid plan and ends the trial", async () => {
    await handleWebhookEvent(
      evt("evt_1", "checkout.session.completed", {
        id: "cs_1",
        customer: "cus_1",
        subscription: "sub_1",
        metadata: { companyId: COMPANY, planId: "starter", billingCycle: "monthly" },
      }),
      store
    );
    expect(store.row()).toMatchObject({
      planId: "starter",
      status: "active",
      trialEndsAt: null,
      stripeCustomerId: "cus_1",
      stripeSubscriptionId: "sub_1",
      billingCycle: "monthly",
    });
  });

  it("creates a subscription row when a paying company has none yet", async () => {
    store = makeStore(null);
    await handleWebhookEvent(
      evt("evt_2", "checkout.session.completed", {
        id: "cs_2",
        customer: "cus_1",
        subscription: "sub_1",
        metadata: { companyId: COMPANY, planId: "professional", billingCycle: "yearly" },
      }),
      store
    );
    expect(store.createSubscription).toHaveBeenCalledTimes(1);
    expect(store.row()).toMatchObject({ companyId: COMPANY, planId: "professional", status: "active" });
  });

  it("is idempotent: a redelivered event id is applied exactly once", async () => {
    const e = evt("evt_dup", "checkout.session.completed", {
      id: "cs_1",
      customer: "cus_1",
      subscription: "sub_1",
      metadata: { companyId: COMPANY, planId: "starter", billingCycle: "monthly" },
    });
    await handleWebhookEvent(e, store);
    await handleWebhookEvent(e, store);
    expect(store.updateSubscription).toHaveBeenCalledTimes(1);
  });

  it("customer.subscription.created links the Stripe ids and plan", async () => {
    await handleWebhookEvent(evt("evt_3", "customer.subscription.created", stripeSub()), store);
    expect(store.row()).toMatchObject({
      planId: "starter",
      status: "active",
      stripeSubscriptionId: "sub_1",
      stripeCustomerId: "cus_1",
      trialEndsAt: null,
    });
  });

  it("customer.subscription.updated maps past_due and cancel-at-period-end", async () => {
    await handleWebhookEvent(evt("evt_4a", "customer.subscription.created", stripeSub()), store);
    await handleWebhookEvent(
      evt("evt_4", "customer.subscription.updated", stripeSub({ status: "past_due", cancel_at_period_end: true })),
      store
    );
    expect(store.row()).toMatchObject({ status: "past_due", cancelAtPeriodEnd: true });
    expect((store.row()!.currentPeriodEnd as Date).getTime()).toBe((NOW_S + 30 * 86400) * 1000);
  });

  it("customer.subscription.updated maps canceled to cancelled and unpaid to cancelled", async () => {
    await handleWebhookEvent(evt("evt_5a", "customer.subscription.created", stripeSub()), store);
    await handleWebhookEvent(evt("evt_5", "customer.subscription.updated", stripeSub({ status: "canceled" })), store);
    expect(store.row()!.status).toBe("cancelled");
    await handleWebhookEvent(evt("evt_5b", "customer.subscription.updated", stripeSub({ status: "unpaid" })), store);
    expect(store.row()!.status).toBe("cancelled");
  });

  it("does not treat an incomplete subscription as active", async () => {
    await handleWebhookEvent(evt("evt_inc", "customer.subscription.updated", stripeSub({ status: "incomplete" })), store);
    expect(store.row()!.status).toBe("trialing");
  });

  it("customer.subscription.deleted downgrades to free", async () => {
    await handleWebhookEvent(evt("evt_6a", "customer.subscription.created", stripeSub()), store);
    await handleWebhookEvent(evt("evt_6", "customer.subscription.deleted", stripeSub({ status: "canceled" })), store);
    expect(store.row()).toMatchObject({ planId: "free", status: "active", stripeSubscriptionId: null });
  });

  it("invoice.payment_failed marks the subscription past_due (found by Stripe ids, no metadata)", async () => {
    await handleWebhookEvent(evt("evt_7a", "customer.subscription.created", stripeSub()), store);
    await handleWebhookEvent(
      evt("evt_7", "invoice.payment_failed", { id: "in_1", customer: "cus_1", subscription: "sub_1" }),
      store
    );
    expect(store.row()!.status).toBe("past_due");
  });

  it("invoice.paid brings a past_due subscription back to active", async () => {
    await handleWebhookEvent(evt("evt_8a", "customer.subscription.created", stripeSub({ status: "past_due" })), store);
    expect(store.row()!.status).toBe("past_due");
    await handleWebhookEvent(
      evt("evt_8", "invoice.paid", {
        id: "in_2",
        customer: "cus_1",
        subscription: "sub_1",
        lines: { data: [{ period: { start: NOW_S, end: NOW_S + 30 * 86400 } }] },
      }),
      store
    );
    expect(store.row()!.status).toBe("active");
    expect((store.row()!.currentPeriodEnd as Date).getTime()).toBe((NOW_S + 30 * 86400) * 1000);
  });

  it("ignores invoice events for a subscription it does not know", async () => {
    await handleWebhookEvent(
      evt("evt_9", "invoice.payment_failed", { id: "in_x", customer: "cus_unknown", subscription: "sub_unknown" }),
      store
    );
    expect(store.updateSubscription).not.toHaveBeenCalled();
  });

  it("releases the claim when processing fails so Stripe's retry is processed", async () => {
    (store.updateSubscription as any).mockRejectedValueOnce(new Error("db down"));
    const e = evt("evt_10", "customer.subscription.created", stripeSub());
    await expect(handleWebhookEvent(e, store)).rejects.toThrow("db down");
    expect(store.releaseStripeEvent).toHaveBeenCalledWith("evt_10");
    await handleWebhookEvent(e, store); // retry succeeds
    expect(store.row()!.stripeSubscriptionId).toBe("sub_1");
  });

  it("keeps unhandled event types claimed and changes nothing", async () => {
    await handleWebhookEvent(evt("evt_11", "charge.refunded", { id: "ch_1" }), store);
    expect(store.updateSubscription).not.toHaveBeenCalled();
    expect(store.claimed.has("evt_11")).toBe(true);
  });
});
