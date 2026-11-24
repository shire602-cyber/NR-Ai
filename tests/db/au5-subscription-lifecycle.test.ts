import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useHarness } from "./harness";

const h = useHarness();
const { retrieveSubscription, updateSubscription, createPortal } = vi.hoisted(() => ({
  retrieveSubscription: vi.fn(),
  updateSubscription: vi.fn(),
  createPortal: vi.fn(),
}));

vi.mock("stripe", () => ({
  default: class {
    subscriptions = { retrieve: retrieveSubscription, update: updateSubscription };
    billingPortal = { sessions: { create: createPortal } };
  },
}));

vi.mock("../../server/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/config/env")>();
  return { ...actual, getEnv: () => ({ ...actual.getEnv(), STRIPE_SECRET_KEY: "fixture" }) };
});

const starterPrice = "price_au5_starter_monthly";
const professionalPrice = "price_au5_professional_yearly";
const enterprisePrice = "price_au5_enterprise_yearly";

beforeEach(async () => {
  vi.resetAllMocks();
  const { PLAN_PRICE_MAP } = await import("../../server/services/stripe.service");
  PLAN_PRICE_MAP.starter.monthly = starterPrice;
  PLAN_PRICE_MAP.professional.yearly = professionalPrice;
  PLAN_PRICE_MAP.enterprise.yearly = enterprisePrice;
});

interface StoredPlan {
  plan_id: string;
  billing_cycle: string;
  stripe_subscription_id: string | null;
  max_companies: number;
  max_invoices: number;
  max_receipts: number;
  ai_credits_per_month: number;
  max_storage_mb: number;
  seat_count: number;
}

async function subscribedCompany(linked = true) {
  const tenant = await h.createTenant(linked ? { planId: "starter" } : undefined);
  const companyId = tenant.company.id;
  const customer = `cus_${randomUUID()}`;
  const subscription = `sub_${randomUUID()}`;
  await h.sql(
    `UPDATE subscriptions SET stripe_customer_id = $2, stripe_subscription_id = $3,
        billing_cycle = 'monthly', status = 'active' WHERE company_id = $1`,
    [companyId, customer, linked ? subscription : null]
  );
  return { companyId, customer, subscription };
}

async function readPlan(companyId: string) {
  const [plan] = await h.sql<StoredPlan>(
    `SELECT plan_id, billing_cycle, stripe_subscription_id,
       max_companies, max_invoices, max_receipts, ai_credits_per_month, max_storage_mb, seat_count
     FROM subscriptions WHERE company_id = $1`,
    [companyId]
  );
  return plan;
}

function stripeSubscription(
  ids: { companyId: string; customer: string; subscription: string },
  priceId: string
) {
  const periodStart = Math.floor(Date.now() / 1000);
  return {
    id: ids.subscription,
    customer: ids.customer,
    status: "active",
    metadata: { companyId: ids.companyId, planId: "starter", billingCycle: "monthly" },
    current_period_start: periodStart,
    current_period_end: periodStart + 30 * 86_400,
    cancel_at_period_end: false,
    trial_end: null,
    items: { data: [{ id: "si_fixture", quantity: 1, price: { id: priceId } }] },
  };
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

  it("keeps the replacement subscription when a stale deletion resumes during checkout", async () => {
    const ids = await subscribedCompany(false);
    const replacement = stripeSubscription(ids, professionalPrice);
    const { storage } = await import("../../server/storage");
    const getSubscription = storage.getSubscription.bind(storage);
    let onDeletionRead!: (id: string | null | undefined) => void;
    const deletionRead = new Promise<string | null | undefined>((resolve) => {
      onDeletionRead = resolve;
    });
    let resumeDeletion!: () => void;
    const checkoutHasLock = new Promise<void>((resolve) => {
      resumeDeletion = resolve;
    });
    // Save the unlocked lookup so the deletion can resume with that snapshot even
    // on PGlite, where it shares a single connection with the checkout transaction.
    const lookup = vi
      .spyOn(storage, "getSubscription")
      .mockImplementationOnce(async (companyId) => {
        const row = await getSubscription(companyId);
        onDeletionRead(row?.stripeSubscriptionId);
        await checkoutHasLock;
        return row;
      });
    const deletion = deliver("customer.subscription.deleted", {
      id: `sub_${randomUUID()}`,
      customer: ids.customer,
      status: "canceled",
      metadata: { companyId: ids.companyId },
    });

    try {
      expect(await Promise.race([deletionRead, deletion])).toBeNull();
      retrieveSubscription.mockImplementationOnce(async () => {
        resumeDeletion();
        return replacement;
      });
      await deliver("checkout.session.completed", {
        id: `cs_${randomUUID()}`,
        customer: ids.customer,
        subscription: ids.subscription,
        metadata: replacement.metadata,
      });
      await deletion;

      expect(await readPlan(ids.companyId)).toMatchObject({
        stripe_subscription_id: ids.subscription,
        plan_id: "professional",
        billing_cycle: "yearly",
      });
    } finally {
      resumeDeletion();
      lookup.mockRestore();
      await Promise.allSettled([deletion]);
    }
  });

  it("reflects a change to the yearly Professional price in the Stripe customer portal", async () => {
    const ids = await subscribedCompany();
    const updated = stripeSubscription(ids, professionalPrice);
    retrieveSubscription.mockResolvedValue(updated);

    await deliver("customer.subscription.updated", updated);

    expect(await readPlan(ids.companyId)).toMatchObject({
      plan_id: "professional",
      billing_cycle: "yearly",
      max_companies: 3,
      ai_credits_per_month: 500,
      max_storage_mb: 25_600,
    });
  });

  it("keeps Starter limits when an older Enterprise update arrives after the downgrade", async () => {
    const ids = await subscribedCompany();
    const enterprise = stripeSubscription(ids, enterprisePrice);
    const starter = stripeSubscription(ids, starterPrice);

    retrieveSubscription.mockResolvedValue(enterprise);
    await deliver("customer.subscription.updated", enterprise);
    expect(await readPlan(ids.companyId)).toMatchObject({
      plan_id: "enterprise",
      billing_cycle: "yearly",
    });

    retrieveSubscription.mockResolvedValue(starter);
    await deliver("customer.subscription.updated", starter);
    // This is a different event from the same Enterprise period.
    await deliver("customer.subscription.updated", enterprise);

    expect(await readPlan(ids.companyId)).toMatchObject({
      plan_id: "starter",
      billing_cycle: "monthly",
      max_companies: 1,
      max_invoices: 200,
      max_receipts: 200,
      ai_credits_per_month: 50,
      max_storage_mb: 5_120,
    });
  });

  it("links checkout using the portal price when the portal update arrived before linking", async () => {
    const tenant = await h.createTenant();
    const companyId = tenant.company.id;
    const customer = `cus_${randomUUID()}`;
    const subscription = `sub_${randomUUID()}`;
    await h.sql("UPDATE subscriptions SET stripe_customer_id = $2 WHERE company_id = $1", [
      companyId,
      customer,
    ]);
    const portalUrl = "https://billing.example.test/portal";
    createPortal.mockResolvedValue({ url: portalUrl });
    const portal = await tenant.as.post(`/api/companies/${companyId}/billing/portal`);
    expect(portal.status).toBe(200);
    expect(portal.body).toEqual({ url: portalUrl });

    const updated = stripeSubscription({ companyId, customer, subscription }, professionalPrice);
    retrieveSubscription.mockResolvedValue(updated);
    await deliver("customer.subscription.updated", updated);
    expect(await readPlan(companyId)).toMatchObject({ stripe_subscription_id: null });

    await deliver("checkout.session.completed", {
      id: `cs_${randomUUID()}`,
      customer,
      subscription,
      metadata: updated.metadata,
    });

    expect(await readPlan(companyId)).toMatchObject({
      stripe_subscription_id: subscription,
      plan_id: "professional",
      billing_cycle: "yearly",
      max_companies: 3,
      ai_credits_per_month: 500,
      max_storage_mb: 25_600,
    });
  });

  it.for([true, false])(
    "reconciles a portal downgrade delivered during the checkout Stripe read (metadata: %s)",
    async (withMetadata, ctx) => {
      ctx.skip(!h.concurrencySupported);
      const ids = await subscribedCompany(false);
      const enterprise = stripeSubscription(ids, enterprisePrice);
      const starter = stripeSubscription(ids, starterPrice);
      const { storage } = await import("../../server/storage");
      const reconcile = storage.reconcileStripeSubscription.bind(storage);
      let downgrade: Promise<void> | undefined;
      let onReconcile!: () => void;
      const reconcilingDowngrade = new Promise<void>((resolve) => {
        onReconcile = resolve;
      });
      const reconciliation = vi
        .spyOn(storage, "reconcileStripeSubscription")
        .mockImplementation((row, readChanges) => {
          if (downgrade) onReconcile();
          return reconcile(row, readChanges);
        });

      retrieveSubscription.mockResolvedValue(starter).mockImplementationOnce(async () => {
        // Stripe has read Enterprise. Hold that response while the portal event is delivered.
        downgrade = deliver("customer.subscription.updated", {
          ...starter,
          metadata: withMetadata ? starter.metadata : {},
        });
        await Promise.race([reconcilingDowngrade, downgrade]);
        return enterprise;
      });

      try {
        await deliver("checkout.session.completed", {
          id: `cs_${randomUUID()}`,
          customer: ids.customer,
          subscription: ids.subscription,
          metadata: { companyId: ids.companyId, planId: "enterprise", billingCycle: "yearly" },
        });
        await downgrade;
        expect(await readPlan(ids.companyId)).toMatchObject({
          stripe_subscription_id: ids.subscription,
          plan_id: "starter",
          billing_cycle: "monthly",
          max_companies: 1,
          max_invoices: 200,
          max_receipts: 200,
          ai_credits_per_month: 50,
          max_storage_mb: 5_120,
        });
      } finally {
        reconciliation.mockRestore();
      }
    }
  );

  it("keeps the portal downgrade when an in-app change resumes after its Stripe update", async () => {
    const ids = await subscribedCompany();
    const enterprise = stripeSubscription(ids, enterprisePrice);
    enterprise.items.data[0].quantity = 4;
    const starter = stripeSubscription(ids, starterPrice);
    let current = stripeSubscription(ids, professionalPrice);
    retrieveSubscription.mockImplementation(async () => current);
    await deliver("customer.subscription.updated", current);
    expect(await readPlan(ids.companyId)).toMatchObject({ plan_id: "professional" });

    updateSubscription.mockImplementation(async () => {
      // Enterprise is the response to the in-app update. Finish the portal downgrade before returning it.
      current = starter;
      await deliver("customer.subscription.updated", starter);
      expect(await readPlan(ids.companyId)).toMatchObject({ plan_id: "starter", seat_count: 1 });
      return enterprise;
    });

    const { changeSubscriptionPlan } = await import("../../server/services/stripe.service");
    await expect(
      changeSubscriptionPlan(ids.companyId, {
        planId: "enterprise",
        billingCycle: "yearly",
        seats: 4,
      })
    ).resolves.toEqual({ planId: "starter", billingCycle: "monthly", seats: 1 });
    expect(updateSubscription).toHaveBeenCalledExactlyOnceWith(
      ids.subscription,
      expect.objectContaining({
        items: [{ id: "si_fixture", price: enterprisePrice, quantity: 4 }],
      })
    );
    expect(await readPlan(ids.companyId)).toMatchObject({
      stripe_subscription_id: ids.subscription,
      plan_id: "starter",
      billing_cycle: "monthly",
      max_companies: 1,
      max_invoices: 200,
      max_receipts: 200,
      ai_credits_per_month: 50,
      max_storage_mb: 5_120,
      seat_count: 1,
    });
  });
});
