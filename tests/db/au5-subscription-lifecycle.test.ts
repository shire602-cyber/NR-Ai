import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import { describe, expect, it } from "vitest";
import { useHarness } from "./harness";

const h = useHarness();

interface StoredPlan {
  plan_id: string;
  billing_cycle: string;
  stripe_subscription_id: string | null;
}

async function subscribedCompany() {
  const tenant = await h.createTenant({ planId: "starter" });
  const companyId = tenant.company.id;
  const customer = `cus_${randomUUID()}`;
  const subscription = `sub_${randomUUID()}`;
  await h.sql(
    `UPDATE subscriptions SET stripe_customer_id = $2, stripe_subscription_id = $3,
        billing_cycle = 'monthly', status = 'active' WHERE company_id = $1`,
    [companyId, customer, subscription]
  );
  return { companyId, customer, subscription };
}

async function readPlan(companyId: string) {
  const [plan] = await h.sql<StoredPlan>(
    "SELECT plan_id, billing_cycle, stripe_subscription_id FROM subscriptions WHERE company_id = $1",
    [companyId]
  );
  return plan;
}

// These are already-authenticated provider event objects at the dispatch boundary.
// The signature and raw HTTP body are exercised by stripe-webhook-raw-body.test.ts.
async function deliver(type: Stripe.Event.Type, subscription: object) {
  const { handleWebhookEvent } = await import("../../server/services/stripe.service");
  await handleWebhookEvent({
    id: `evt_${randomUUID()}`,
    type,
    data: { object: subscription },
  } as Stripe.Event);
}

describe("AU5 subscription lifecycle", () => {
  it("keeps the customer's current subscription when a previous one is cancelled", async () => {
    const { companyId, customer, subscription } = await subscribedCompany();
    await deliver("customer.subscription.deleted", {
      id: `sub_${randomUUID()}`,
      customer,
      status: "canceled",
      metadata: { companyId },
    });
    expect(await readPlan(companyId)).toMatchObject({
      plan_id: "starter",
      stripe_subscription_id: subscription,
    });
  });

  it("reflects a change to the yearly Professional price in the Stripe customer portal", async () => {
    const { companyId, customer, subscription } = await subscribedCompany();
    const { PLAN_PRICE_MAP } = await import("../../server/services/stripe.service");
    const priceId = "price_au5_professional_yearly";
    const previousPrice = PLAN_PRICE_MAP.professional.yearly;
    PLAN_PRICE_MAP.professional.yearly = priceId;
    try {
      const periodStart = Math.floor(Date.now() / 1000);
      await deliver("customer.subscription.updated", {
        id: subscription,
        customer,
        status: "active",
        metadata: { companyId, planId: "starter", billingCycle: "monthly" },
        current_period_start: periodStart,
        current_period_end: periodStart + 365 * 86400,
        cancel_at_period_end: false,
        trial_end: null,
        items: {
          data: [{ quantity: 1, price: { id: priceId, recurring: { interval: "year" } } }],
        },
      });
      expect(await readPlan(companyId)).toMatchObject({
        plan_id: "professional",
        billing_cycle: "yearly",
      });
    } finally {
      PLAN_PRICE_MAP.professional.yearly = previousPrice;
    }
  });
});
