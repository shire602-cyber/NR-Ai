import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";

const stripe = vi.hoisted(() => ({
  listSessions: vi.fn(),
  listSubscriptions: vi.fn(),
  createSession: vi.fn().mockResolvedValue({ url: "https://checkout.example.test" }),
  createCoupon: vi.fn().mockResolvedValue({ id: "referral-discount" }),
  retrieveSubscription: vi.fn(),
  updateStripeSubscription: vi.fn(),
  getCompany: vi.fn(),
  getSubscription: vi.fn(),
  updateSubscription: vi.fn(),
  applyStripeCheckout: vi.fn(),
  createStripeEvent: vi.fn().mockResolvedValue(true),
  pq: vi.fn(),
}));

vi.mock("stripe", () => ({
  default: class {
    checkout = { sessions: { create: stripe.createSession, list: stripe.listSessions } };
    coupons = { create: stripe.createCoupon };
    subscriptions = {
      retrieve: stripe.retrieveSubscription,
      list: stripe.listSubscriptions,
      update: stripe.updateStripeSubscription,
    };
  },
}));
vi.mock("../../server/config/env", () => ({ getEnv: () => ({ STRIPE_SECRET_KEY: "fixture" }) }));
vi.mock("../../server/storage", () => ({
  storage: {
    getCompany: stripe.getCompany,
    getSubscription: stripe.getSubscription,
    updateSubscription: stripe.updateSubscription,
    applyStripeCheckout: stripe.applyStripeCheckout,
    createStripeEvent: stripe.createStripeEvent,
  },
}));
vi.mock("../../server/services/connectors/pq", () => ({ pq: stripe.pq }));

import {
  changeSubscriptionPlan,
  createCheckoutSession,
  handleWebhookEvent,
  PLAN_PRICE_MAP,
} from "../../server/services/stripe.service";

const now = new Date("2026-11-23T10:00:00.000Z");
const hour = 60 * 60 * 1000;
const currentStripeSubscription = {
  id: "first-subscription",
  customer: "fixture-customer",
  metadata: { companyId: "company", planId: "professional", billingCycle: "yearly" },
  status: "trialing",
  trial_end: 1_795_715_200,
  current_period_start: 1_795_369_600,
  current_period_end: 1_795_715_200,
  items: { data: [{ quantity: 3 }] },
};

describe("Stripe checkout product trial and referral", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stripe.getCompany.mockResolvedValue({ id: "company" });
    stripe.listSessions.mockReturnValue([]);
    stripe.listSubscriptions.mockReturnValue([]);
    stripe.createSession.mockResolvedValue({ url: "https://checkout.example.test" });
    stripe.retrieveSubscription.mockResolvedValue(currentStripeSubscription);
    let reservation: Date | null = null;
    stripe.pq.mockImplementation(async (query: string, params: [string, Date, Date | null]) => {
      if (/^UPDATE companies/.test(query)) {
        if (reservation?.getTime() !== params[2]?.getTime()) return { rowCount: 0, rows: [] };
        reservation = params[1];
        return { rowCount: 1, rows: [] };
      }
      return {
        rows: [{ id: "referral", referee_reward_type: "discount", referee_reward_amount: 10 }],
      };
    });
    vi.spyOn(Date, "now").mockReturnValue(now.getTime());
    PLAN_PRICE_MAP.starter.monthly = "price_fixture";
  });

  afterEach(() => vi.restoreAllMocks());

  it.each([
    { scenario: "mid-trial", hours: 96, trial: true },
    { scenario: "exactly 48 hours left", hours: 48, trial: true },
    { scenario: "less than 48 hours left", hours: 47, trial: false },
    { scenario: "expired", hours: -24, trial: false },
    { scenario: "missing original deadline", hours: null, trial: false },
  ])("sends the right checkout parameters for $scenario", async ({ hours, trial }) => {
    const trialEndsAt = hours === null ? null : new Date(now.getTime() + hours * hour);
    stripe.getSubscription.mockResolvedValue({
      planId: "free",
      stripeSubscriptionId: null,
      stripeCustomerId: "fixture-customer",
      trialEndsAt,
    });
    await createCheckoutSession(
      "company",
      "starter",
      "monthly",
      "https://example.test/success",
      "https://example.test/cancel"
    );

    const session = stripe.createSession.mock.calls[0][0];
    expect(session.subscription_data).not.toHaveProperty("trial_period_days");
    if (trial) {
      expect(session.subscription_data.trial_end).toBe(Math.floor(trialEndsAt!.getTime() / 1000));
    } else {
      expect(session.subscription_data).not.toHaveProperty("trial_end");
    }
    expect(stripe.createCoupon).toHaveBeenCalledWith(expect.objectContaining({ duration: "once" }));
    expect(session.discounts).toEqual([{ coupon: "referral-discount" }]);
  });

  it("does not start a second subscription when the local plan is stale", async () => {
    stripe.getSubscription.mockResolvedValue({
      planId: "free",
      stripeSubscriptionId: "existing-subscription",
      stripeCustomerId: "fixture-customer",
    });
    await expect(
      createCheckoutSession(
        "company",
        "starter",
        "monthly",
        "https://example.test/success",
        "https://example.test/cancel"
      )
    ).resolves.toBe("https://example.test/success");
    expect(stripe.createSession).not.toHaveBeenCalled();
    expect(stripe.createCoupon).not.toHaveBeenCalled();
  });

  it("[PR94] changes Starter to Professional on the existing subscription item", async () => {
    stripe.getSubscription.mockResolvedValue({
      id: "subscription-row",
      planId: "starter",
      billingCycle: "monthly",
      stripeSubscriptionId: "first-subscription",
    });
    stripe.retrieveSubscription.mockResolvedValue({
      items: { data: [{ id: "existing-item" }] },
    });
    const originalPrice = PLAN_PRICE_MAP.professional.monthly;
    PLAN_PRICE_MAP.professional.monthly = "price-professional";
    try {
      await changeSubscriptionPlan("company", { planId: "professional" });
      expect(stripe.updateStripeSubscription).toHaveBeenCalledExactlyOnceWith(
        "first-subscription",
        {
          items: [{ id: "existing-item", price: "price-professional", quantity: 1 }],
          proration_behavior: "create_prorations",
          metadata: { companyId: "company", planId: "professional", billingCycle: "monthly" },
        }
      );
      expect(stripe.updateSubscription).toHaveBeenCalledExactlyOnceWith(
        "subscription-row",
        expect.objectContaining({ planId: "professional", billingCycle: "monthly" })
      );
      expect(stripe.createSession).not.toHaveBeenCalled();
    } finally {
      PLAN_PRICE_MAP.professional.monthly = originalPrice;
    }
  });

  it.each([
    { scenario: "a returning customer", checkoutCompleted: true, checkoutAgeHours: 1 },
    { scenario: "an older pre-migration checkout", checkoutCompleted: false, checkoutAgeHours: 48 },
  ])("reconciles $scenario before creating a checkout session", async (testCase) => {
    const subscription = {
      companyId: "company",
      planId: "free",
      stripeCustomerId: "fixture-customer",
      stripeSubscriptionId: null,
      stripeCheckoutCompleted: testCase.checkoutCompleted,
    };
    stripe.getSubscription.mockResolvedValue(subscription);
    stripe.applyStripeCheckout.mockResolvedValue(true);
    stripe.listSubscriptions.mockReturnValue([
      {
        ...currentStripeSubscription,
        status: "active",
        created: (now.getTime() - testCase.checkoutAgeHours * hour) / 1000,
      },
    ]);
    await expect(
      createCheckoutSession(
        "company",
        "starter",
        "monthly",
        "https://example.test/success",
        "https://example.test/cancel"
      )
    ).resolves.toBe("https://example.test/success");
    expect(stripe.applyStripeCheckout).toHaveBeenCalledExactlyOnceWith(
      subscription,
      expect.objectContaining({
        planId: "professional",
        billingCycle: "yearly",
        status: "active",
        stripeSubscriptionId: "first-subscription",
        stripeCheckoutCompleted: true,
      })
    );
    expect(stripe.createSession).not.toHaveBeenCalled();
  });

  it("reserves before creating a session, even when overlapping requests read the same state", async () => {
    const subscription = {
      planId: "free",
      stripeCustomerId: "fixture-customer",
      trialEndsAt: new Date(now.getTime() + 96 * hour),
    };
    stripe.getSubscription.mockResolvedValue(subscription);
    const request = () =>
      createCheckoutSession(
        "company",
        "starter",
        "monthly",
        "https://example.test/success",
        "https://example.test/cancel"
      );
    const results = await Promise.allSettled([request(), request()]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.find((result) => result.status === "rejected")).toMatchObject({
      reason: { code: "STRIPE_CHECKOUT_IN_PROGRESS" },
    });
    expect(stripe.createSession).toHaveBeenCalledTimes(1);
    expect(stripe.createCoupon).toHaveBeenCalledTimes(1);
  });

  it.each(["expired", "complete", "open"] as const)(
    "checks the earlier Stripe session after the reservation expires (%s)",
    async (status) => {
      const subscription = {
        id: "subscription-row",
        companyId: "company",
        planId: "free",
        stripeCheckoutCompleted: false,
        stripeSubscriptionId: null,
        stripeCustomerId: "fixture-customer",
        trialEndsAt: new Date(now.getTime() + 96 * hour),
        invoicesCreatedThisMonth: 0,
      };
      const company = { id: "company", stripeFirstCheckoutExpiresAt: null as Date | null };
      stripe.getCompany.mockImplementation(async () => ({ ...company }));
      stripe.getSubscription.mockResolvedValue(subscription);
      stripe.applyStripeCheckout.mockImplementation(async (_subscription, patch) => {
        Object.assign(subscription, patch);
        return true;
      });
      stripe.pq.mockImplementation(async (query: string, params: [string, Date, Date | null]) => {
        if (/^UPDATE companies/.test(query)) {
          expect(params[2]).toEqual(company.stripeFirstCheckoutExpiresAt);
          company.stripeFirstCheckoutExpiresAt = params[1];
          return { rowCount: 1, rows: [] };
        }
        return {
          rows: [{ id: "referral", referee_reward_type: "discount", referee_reward_amount: 10 }],
        };
      });
      const request = () =>
        createCheckoutSession(
          "company",
          "starter",
          "monthly",
          "https://example.test/success",
          "https://example.test/cancel"
        );
      await request();
      const first = stripe.createSession.mock.calls[0][0];
      expect(first.expires_at).toBe(company.stripeFirstCheckoutExpiresAt!.getTime() / 1000);
      await expect(request()).rejects.toMatchObject({ code: "STRIPE_CHECKOUT_IN_PROGRESS" });

      vi.mocked(Date.now).mockReturnValue((first.expires_at + 1) * 1000);
      const session = {
        id: "first-session",
        mode: "subscription",
        status,
        customer: "fixture-customer",
        subscription: "first-subscription",
        metadata: first.metadata,
      };
      stripe.listSessions.mockReturnValue([session]);
      if (status === "expired") {
        await expect(request()).resolves.toBe("https://checkout.example.test");
        expect(stripe.createSession).toHaveBeenCalledTimes(2);
      } else if (status === "complete") {
        await expect(request()).resolves.toBe("https://example.test/success");
        expect(subscription).toMatchObject({
          planId: "professional",
          status: "trialing",
          billingCycle: "yearly",
          seatCount: 3,
          stripeCheckoutCompleted: true,
          stripeSubscriptionId: "first-subscription",
          trialEndsAt: new Date(currentStripeSubscription.trial_end * 1000),
          currentPeriodStart: new Date(currentStripeSubscription.current_period_start * 1000),
          currentPeriodEnd: new Date(currentStripeSubscription.current_period_end * 1000),
        });
        expect(stripe.retrieveSubscription).toHaveBeenCalledWith("first-subscription");
        subscription.invoicesCreatedThisMonth = 4;
        await handleWebhookEvent({
          id: "late-checkout-event",
          type: "checkout.session.completed",
          data: { object: session },
        } as unknown as Stripe.Event);
        await expect(request()).resolves.toBe("https://example.test/success");
        expect(subscription.invoicesCreatedThisMonth).toBe(4);
        expect(stripe.applyStripeCheckout).toHaveBeenCalledTimes(1);
        expect(stripe.createSession).toHaveBeenCalledTimes(1);
        expect(stripe.createCoupon).toHaveBeenCalledTimes(1);
      } else {
        await expect(request()).rejects.toMatchObject({ code: "STRIPE_CHECKOUT_IN_PROGRESS" });
        expect(stripe.createSession).toHaveBeenCalledTimes(1);
        expect(stripe.retrieveSubscription).not.toHaveBeenCalled();
      }
    }
  );

  it("keeps checkout history when the deletion webhook clears the active subscription", async () => {
    const subscription = {
      id: "subscription-row",
      companyId: "company",
      planId: "free",
      stripeSubscriptionId: null as string | null,
      stripeCustomerId: "fixture-customer",
      stripeCheckoutCompleted: false,
      trialEndsAt: new Date(now.getTime() + 96 * hour),
    };
    stripe.getSubscription.mockResolvedValue(subscription);
    stripe.applyStripeCheckout.mockImplementation(async (_subscription, patch) => {
      Object.assign(subscription, patch);
      return true;
    });
    stripe.updateSubscription.mockImplementation(async (_id, patch) =>
      Object.assign(subscription, patch)
    );
    await handleWebhookEvent({
      id: "checkout-event",
      type: "checkout.session.completed",
      data: {
        object: {
          metadata: { companyId: "company", planId: "starter", billingCycle: "monthly" },
          customer: "fixture-customer",
          subscription: "first-subscription",
        },
      },
    } as unknown as Stripe.Event);
    expect(subscription.stripeCheckoutCompleted).toBe(true);
    await handleWebhookEvent({
      id: "delete-event",
      type: "customer.subscription.deleted",
      data: { object: { id: "first-subscription", metadata: { companyId: "company" } } },
    } as unknown as Stripe.Event);
    expect(subscription).toMatchObject({
      planId: "free",
      stripeSubscriptionId: null,
      stripeCheckoutCompleted: true,
    });
    stripe.retrieveSubscription.mockResolvedValueOnce({
      ...currentStripeSubscription,
      status: "canceled",
    });
    await handleWebhookEvent({
      id: "late-completion-event",
      type: "checkout.session.completed",
      data: {
        object: {
          metadata: { companyId: "company", planId: "starter", billingCycle: "monthly" },
          customer: "fixture-customer",
          subscription: "first-subscription",
        },
      },
    } as unknown as Stripe.Event);
    expect(subscription.stripeSubscriptionId).toBeNull();
    expect(stripe.applyStripeCheckout).toHaveBeenCalledTimes(1);
    await createCheckoutSession(
      "company",
      "starter",
      "monthly",
      "https://example.test/success",
      "https://example.test/cancel"
    );
    const session = stripe.createSession.mock.calls[0][0];
    expect(session.subscription_data).not.toHaveProperty("trial_end");
    expect(session).not.toHaveProperty("discounts");
    expect(stripe.createCoupon).not.toHaveBeenCalled();
  });
});
