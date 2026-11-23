import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";

const stripe = vi.hoisted(() => ({
  createSession: vi.fn().mockResolvedValue({ url: "https://checkout.example.test" }),
  createCoupon: vi.fn().mockResolvedValue({ id: "referral-discount" }),
  getSubscription: vi.fn(),
  updateSubscription: vi.fn(),
  createStripeEvent: vi.fn().mockResolvedValue(true),
  pq: vi.fn().mockResolvedValue({
    rows: [{ id: "referral", referee_reward_type: "discount", referee_reward_amount: 10 }],
  }),
}));

vi.mock("stripe", () => ({
  default: class {
    checkout = { sessions: { create: stripe.createSession } };
    coupons = { create: stripe.createCoupon };
  },
}));
vi.mock("../../server/config/env", () => ({ getEnv: () => ({ STRIPE_SECRET_KEY: "fixture" }) }));
vi.mock("../../server/storage", () => ({
  storage: {
    getSubscription: stripe.getSubscription,
    updateSubscription: stripe.updateSubscription,
    createStripeEvent: stripe.createStripeEvent,
  },
}));
vi.mock("../../server/services/connectors/pq", () => ({ pq: stripe.pq }));

import {
  createCheckoutSession,
  handleWebhookEvent,
  PLAN_PRICE_MAP,
} from "../../server/services/stripe.service";

const now = new Date("2026-11-23T10:00:00.000Z");
const hour = 60 * 60 * 1000;

describe("Stripe checkout product trial and referral", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Date, "now").mockReturnValue(now.getTime());
    PLAN_PRICE_MAP.starter.monthly = "price_fixture";
  });

  afterEach(() => vi.restoreAllMocks());

  it.each([
    { scenario: "mid-trial", hours: 96, previous: false, trial: true },
    { scenario: "exactly 48 hours left", hours: 48, previous: false, trial: true },
    { scenario: "less than 48 hours left", hours: 47, previous: false, trial: false },
    { scenario: "expired", hours: -24, previous: false, trial: false },
    { scenario: "missing original deadline", hours: null, previous: false, trial: false },
    { scenario: "legacy active subscription ID", hours: 96, previous: true, trial: false },
  ])("sends the right checkout parameters for $scenario", async ({ hours, previous, trial }) => {
    const trialEndsAt = hours === null ? null : new Date(now.getTime() + hours * hour);
    stripe.getSubscription.mockResolvedValue({
      planId: "free",
      stripeSubscriptionId: previous ? "previous-subscription" : null,
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
    if (previous) {
      expect(stripe.createCoupon).not.toHaveBeenCalled();
      expect(session).not.toHaveProperty("discounts");
    } else {
      expect(stripe.createCoupon).toHaveBeenCalledWith(
        expect.objectContaining({ duration: "once" })
      );
      expect(session.discounts).toEqual([{ coupon: "referral-discount" }]);
    }
  });

  it("keeps checkout history when the deletion webhook clears the active subscription", async () => {
    const subscription = {
      id: "subscription-row",
      planId: "free",
      stripeSubscriptionId: null as string | null,
      stripeCustomerId: "fixture-customer",
      stripeCheckoutCompleted: false,
      trialEndsAt: new Date(now.getTime() + 96 * hour),
    };
    stripe.getSubscription.mockResolvedValue(subscription);
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
