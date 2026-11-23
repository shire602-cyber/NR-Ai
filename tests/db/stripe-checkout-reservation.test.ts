import { beforeEach, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import { useHarness } from "./harness";

const h = useHarness();
const stripe = vi.hoisted(() => ({
  createSession: vi.fn(),
  listSessions: vi.fn(),
  listSubscriptions: vi.fn(),
  retrieveSubscription: vi.fn(),
  updateSubscription: vi.fn(),
}));

vi.mock("stripe", () => ({
  default: class {
    checkout = { sessions: { create: stripe.createSession, list: stripe.listSessions } };
    subscriptions = {
      list: stripe.listSubscriptions,
      retrieve: stripe.retrieveSubscription,
      update: stripe.updateSubscription,
    };
  },
}));

vi.mock("../../server/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/config/env")>();
  return { ...actual, getEnv: () => ({ ...actual.getEnv(), STRIPE_SECRET_KEY: "fixture" }) };
});

beforeEach(() => {
  vi.resetAllMocks();
  stripe.listSessions.mockReturnValue([]);
  stripe.listSubscriptions.mockReturnValue([]);
  stripe.createSession.mockResolvedValue({ url: "https://checkout.example.test" });
});

it.each([false, true])("[PR95] reserves checkout (returning: %s)", async (returning) => {
  const t = await h.createTenant();
  const companyId = t.company.id;
  await h.sql(
    `UPDATE subscriptions SET stripe_customer_id = 'fixture-customer',
      trial_ends_at = now() + interval '4 days', stripe_checkout_completed = $2 WHERE company_id = $1`,
    [companyId, returning]
  );
  const { createCheckoutSession, handleWebhookEvent, PLAN_PRICE_MAP } =
    await import("../../server/services/stripe.service");
  const oldPrice = PLAN_PRICE_MAP.starter.monthly;
  PLAN_PRICE_MAP.starter.monthly = "fixture-price";
  const checkout = () =>
    createCheckoutSession(
      companyId,
      "starter",
      "monthly",
      "https://example.test/success",
      "https://example.test/cancel"
    );

  // Both calls reach Stripe with the same local reservation state before either runs the SQL update.
  let callers = 0;
  let release!: () => void;
  const bothRead = new Promise<void>((resolve) => {
    release = resolve;
  });
  stripe.listSessions.mockImplementation(async function* () {
    if (++callers === 2) release();
    await bothRead;
    yield* [];
  });
  try {
    const results = await Promise.allSettled([checkout(), checkout()]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.find((result) => result.status === "rejected")).toMatchObject({
      reason: { code: "STRIPE_CHECKOUT_IN_PROGRESS" },
    });
    expect(stripe.createSession).toHaveBeenCalledTimes(1);
    const first = stripe.createSession.mock.calls[0][0] as Stripe.Checkout.SessionCreateParams;
    if (returning) expect(first.subscription_data?.trial_end).toBeUndefined();
    else expect(first.subscription_data?.trial_end).toBeDefined();
    const [company] = await h.sql<{ expires: number }>(
      "SELECT extract(epoch FROM stripe_first_checkout_expires_at)::integer AS expires FROM companies WHERE id = $1",
      [companyId]
    );
    expect(company.expires).toBe(first.expires_at);
    expect(stripe.createSession.mock.calls[0][1]).toEqual({
      idempotencyKey: `checkout-session:${companyId}:${company.expires}`,
    });
    stripe.listSessions.mockReturnValue([
      { mode: "subscription", status: "open", metadata: first.metadata },
    ]);
    const retries = await Promise.allSettled([checkout(), checkout()]);
    for (const retry of retries) {
      expect(retry).toMatchObject({
        status: "rejected",
        reason: { code: "STRIPE_CHECKOUT_IN_PROGRESS" },
      });
    }
    expect(stripe.createSession).toHaveBeenCalledTimes(1);

    vi.spyOn(Date, "now").mockReturnValue((company.expires + 1) * 1000);
    stripe.listSessions.mockReturnValue([
      { mode: "subscription", status: "expired", metadata: first.metadata },
    ]);
    await expect(checkout()).resolves.toBe("https://checkout.example.test");
    expect(stripe.createSession).toHaveBeenCalledTimes(2);

    const retry = stripe.createSession.mock.calls[1][0] as Stripe.Checkout.SessionCreateParams;
    const completed = {
      id: "fixture-completed-session",
      mode: "subscription",
      status: "complete",
      customer: "fixture-customer",
      subscription: "fixture-subscription",
      metadata: retry.metadata,
    };
    stripe.listSessions.mockReturnValue([completed]);
    stripe.retrieveSubscription.mockResolvedValue({
      id: completed.subscription,
      customer: completed.customer,
      metadata: retry.subscription_data?.metadata,
      status: "active",
      current_period_start: company.expires,
      current_period_end: company.expires + 30 * 86_400,
      items: { data: [{ quantity: 1 }] },
    });
    // Even before the new reservation times out, retry and webhook can race on the same session.
    const [url] = await Promise.all([
      checkout(),
      handleWebhookEvent({
        id: "fixture-checkout-webhook",
        type: "checkout.session.completed",
        data: { object: completed },
      } as unknown as Stripe.Event),
    ]);
    expect(url).toBe("https://example.test/success");
    expect(stripe.createSession).toHaveBeenCalledTimes(2);
    expect(
      await h.sql(
        `SELECT plan_id, status, stripe_subscription_id, stripe_checkout_completed
          FROM subscriptions WHERE company_id = $1`,
        [companyId]
      )
    ).toEqual([
      {
        plan_id: "starter",
        status: "active",
        stripe_subscription_id: "fixture-subscription",
        stripe_checkout_completed: true,
      },
    ]);
  } finally {
    PLAN_PRICE_MAP.starter.monthly = oldPrice;
    vi.restoreAllMocks();
  }
});

it("[PR94] changes Starter to Professional on the existing Stripe subscription", async () => {
  const t = await h.createTenant();
  const companyId = t.company.id;
  await h.sql(
    `UPDATE subscriptions SET plan_id = 'starter', stripe_customer_id = 'fixture-customer',
      stripe_subscription_id = 'fixture-subscription' WHERE company_id = $1`,
    [companyId]
  );
  const { PLAN_PRICE_MAP } = await import("../../server/services/stripe.service");
  const oldPrice = PLAN_PRICE_MAP.professional.monthly;
  PLAN_PRICE_MAP.professional.monthly = "price-professional";
  stripe.retrieveSubscription.mockResolvedValue({ items: { data: [{ id: "existing-item" }] } });
  try {
    const result = await t.as.post(`/api/companies/${companyId}/billing/change-plan`, {
      planId: "professional",
      billingCycle: "monthly",
    });
    expect(result.status).toBe(200);
    expect(stripe.retrieveSubscription).toHaveBeenCalledWith("fixture-subscription");
    expect(stripe.updateSubscription).toHaveBeenCalledExactlyOnceWith("fixture-subscription", {
      items: [{ id: "existing-item", price: "price-professional", quantity: 1 }],
      proration_behavior: "create_prorations",
      metadata: { companyId, planId: "professional", billingCycle: "monthly" },
    });
    expect(stripe.createSession).not.toHaveBeenCalled();
    const billing = await t.as.get(`/api/companies/${companyId}/billing/subscription`);
    expect(billing.body).toMatchObject({
      subscription: { stripeSubscriptionId: "fixture-subscription" },
      entitlement: { state: "active", planId: "professional" },
    });
  } finally {
    PLAN_PRICE_MAP.professional.monthly = oldPrice;
  }
});

it.each([
  { scenario: "a returning customer", returning: true, ageHours: 1, sessionOnly: false },
  {
    scenario: "a returning customer whose legacy checkout completes after listing subscriptions",
    returning: true,
    ageHours: 1,
    sessionOnly: false,
    completesAfterSubscriptionList: true,
  },
  {
    scenario: "a pre-migration checkout older than 24 hours",
    returning: false,
    ageHours: 48,
    sessionOnly: false,
  },
  {
    scenario: "an older checkout with plan metadata only on the session",
    returning: false,
    ageHours: 48,
    sessionOnly: true,
  },
  {
    scenario: "a session-only checkout canceled before recovery links it",
    returning: false,
    ageHours: 48,
    sessionOnly: true,
    canceledDuringRecovery: true,
  },
])("[PR95] reconciles $scenario", async (fixture) => {
  const {
    returning,
    ageHours,
    sessionOnly,
    completesAfterSubscriptionList,
    canceledDuringRecovery,
  } = fixture;
  const t = await h.createTenant();
  const companyId = t.company.id;
  const customer = `fixture-customer-${companyId}`;
  const subscriptionId = `missed-webhook-subscription-${companyId}`;
  await h.sql(
    "UPDATE subscriptions SET stripe_customer_id = $2, stripe_checkout_completed = $3 WHERE company_id = $1",
    [companyId, customer, returning]
  );
  if (sessionOnly) {
    await h.sql(
      "UPDATE subscriptions SET created_at = now() - interval '60 days' WHERE company_id = $1",
      [companyId]
    );
  }
  const { handleWebhookEvent, PLAN_PRICE_MAP } =
    await import("../../server/services/stripe.service");
  const oldPrice = PLAN_PRICE_MAP.starter.monthly;
  PLAN_PRICE_MAP.starter.monthly = "price-starter";
  const checkout = () =>
    t.as.post(`/api/companies/${companyId}/billing/checkout`, {
      planId: "starter",
      billingCycle: "monthly",
    });
  try {
    if (returning) {
      stripe.listSubscriptions.mockReturnValue([{ status: "canceled" }]);
      const first = await checkout();
      expect(first.body).toEqual({ url: "https://checkout.example.test" });
    }
    if (completesAfterSubscriptionList) {
      await h.sql(
        "UPDATE companies SET stripe_first_checkout_expires_at = date_trunc('second', now()) - interval '5 minutes' WHERE id = $1",
        [companyId]
      );
    }
    const created = Math.floor(Date.now() / 1000) - ageHours * 3_600;
    const metadata = { companyId, planId: "starter", billingCycle: "monthly" };
    const completed = {
      mode: "subscription",
      status: "complete",
      metadata,
      customer,
      subscription: subscriptionId,
    };
    const active = {
      id: subscriptionId,
      customer,
      metadata: sessionOnly ? {} : metadata,
      created,
      status: "active",
      cancel_at_period_end: false,
      current_period_start: created,
      current_period_end: created + 30 * 86_400,
      items: { data: [{ quantity: 1 }] },
    };
    const deleted = {
      id: `fixture-subscription-deleted-${companyId}`,
      type: "customer.subscription.deleted",
      data: { object: { ...active, status: "canceled" } },
    } as unknown as Stripe.Event;
    stripe.listSessions.mockImplementation(async function* (
      params: Stripe.Checkout.SessionListParams
    ) {
      if (canceledDuringRecovery && params.subscription === subscriptionId) {
        await expect(handleWebhookEvent(deleted)).rejects.toThrow("before recovery linked it");
      }
      if (created >= (typeof params.created === "object" ? (params.created.gte ?? 0) : 0)) {
        yield completed;
      }
    });
    if (completesAfterSubscriptionList) stripe.retrieveSubscription.mockResolvedValue(active);
    else stripe.listSubscriptions.mockReturnValue([active]);
    const retry = await checkout();
    expect(retry.status).toBe(200);
    expect(retry.body).toEqual({ url: expect.stringMatching(/\/subscription\?success=true$/) });
    expect(stripe.listSubscriptions).toHaveBeenCalledWith({ customer, status: "all" });
    if (sessionOnly)
      expect(stripe.listSessions).toHaveBeenCalledWith({ subscription: subscriptionId });
    if (completesAfterSubscriptionList)
      expect(stripe.retrieveSubscription).toHaveBeenCalledWith(subscriptionId);
    expect(stripe.createSession).toHaveBeenCalledTimes(returning ? 1 : 0);
    const billing = await t.as.get(`/api/companies/${companyId}/billing/subscription`);
    expect(billing.body).toMatchObject({
      subscription: { stripeSubscriptionId: subscriptionId, stripeCheckoutCompleted: true },
      entitlement: { state: "active", planId: "starter" },
    });
    if (sessionOnly && !canceledDuringRecovery) {
      await handleWebhookEvent({
        id: "fixture-subscription-updated",
        type: "customer.subscription.updated",
        data: { object: { ...active, cancel_at_period_end: true } },
      } as unknown as Stripe.Event);
      const scheduled = await t.as.get(`/api/companies/${companyId}/billing/subscription`);
      expect(scheduled.body).toMatchObject({ subscription: { cancelAtPeriodEnd: true } });
    }
    if (sessionOnly) {
      await handleWebhookEvent(deleted);
      const canceled = await t.as.get(`/api/companies/${companyId}/billing/subscription`);
      expect(canceled.body).toMatchObject({
        subscription: { planId: "free", stripeSubscriptionId: null, stripeCheckoutCompleted: true },
        entitlement: { state: "expired", planId: null },
      });
    }
  } finally {
    PLAN_PRICE_MAP.starter.monthly = oldPrice;
  }
});
