import Stripe from "stripe";
import { storage } from "../storage";
import { createLogger } from "../config/logger";
import { getEnv } from "../config/env";

const log = createLogger("stripe");

let stripe: Stripe | null = null;

export function getStripe(): Stripe | null {
  if (stripe) return stripe;
  const env = getEnv();
  const key = (env as any).STRIPE_SECRET_KEY;
  if (!key) {
    log.warn("Stripe not configured — STRIPE_SECRET_KEY not set");
    return null;
  }
  stripe = new Stripe(key, { apiVersion: "2024-12-18.acacia" as any });
  return stripe;
}

export function isStripeConfigured(): boolean {
  return !!getStripe();
}

const PLAN_PRICE_MAP: Record<string, Record<string, string | undefined>> = {
  starter: {
    monthly: process.env.STRIPE_PRICE_STARTER_MONTHLY,
    yearly: process.env.STRIPE_PRICE_STARTER_YEARLY,
  },
  professional: {
    monthly: process.env.STRIPE_PRICE_PROFESSIONAL_MONTHLY,
    yearly: process.env.STRIPE_PRICE_PROFESSIONAL_YEARLY,
  },
  enterprise: {
    monthly: process.env.STRIPE_PRICE_ENTERPRISE_MONTHLY,
    yearly: process.env.STRIPE_PRICE_ENTERPRISE_YEARLY,
  },
};

const PLAN_LIMITS: Record<string, any> = {
  free: {
    maxUsers: 1,
    maxInvoices: 20,
    maxReceipts: 20,
    aiCreditsRemaining: 10,
    maxCompanies: 1,
    maxStorageMb: 500,
    aiCreditsPerMonth: 10,
  },
  starter: {
    maxUsers: 3,
    maxInvoices: 200,
    maxReceipts: 200,
    aiCreditsRemaining: 50,
    maxCompanies: 1,
    maxStorageMb: 5120,
    aiCreditsPerMonth: 50,
  },
  professional: {
    maxUsers: 10,
    maxInvoices: -1,
    maxReceipts: -1,
    aiCreditsRemaining: 500,
    maxCompanies: 3,
    maxStorageMb: 25600,
    aiCreditsPerMonth: 500,
  },
  enterprise: {
    maxUsers: -1,
    maxInvoices: -1,
    maxReceipts: -1,
    aiCreditsRemaining: -1,
    maxCompanies: -1,
    maxStorageMb: -1,
    aiCreditsPerMonth: -1,
  },
};

export async function createCheckoutSession(
  companyId: string,
  planId: string,
  billingCycle: "monthly" | "yearly",
  successUrl: string,
  cancelUrl: string
): Promise<string | null> {
  const stripeClient = getStripe();
  if (!stripeClient) throw new Error("Stripe not configured");

  const priceId = PLAN_PRICE_MAP[planId]?.[billingCycle];
  if (!priceId) throw new Error(`No Stripe price configured for ${planId} ${billingCycle}`);

  // Get or create Stripe customer
  const subscription = await storage.getSubscription(companyId);
  let customerId = subscription?.stripeCustomerId;

  if (!customerId) {
    const company = await storage.getCompany(companyId);
    const customer = await stripeClient.customers.create({
      metadata: { companyId, planId },
      name: company?.name || undefined,
      email: company?.contactEmail || undefined,
    });
    customerId = customer.id;
    if (subscription) {
      await storage.updateSubscription(subscription.id, { stripeCustomerId: customerId });
    }
  }

  const session = await stripeClient.checkout.sessions.create({
    customer: customerId,
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: { companyId, planId, billingCycle },
    subscription_data: {
      metadata: { companyId, planId, billingCycle },
    },
  });

  return session.url;
}

export async function createPortalSession(
  stripeCustomerId: string,
  returnUrl: string
): Promise<string> {
  const stripeClient = getStripe();
  if (!stripeClient) throw new Error("Stripe not configured");

  const session = await stripeClient.billingPortal.sessions.create({
    customer: stripeCustomerId,
    return_url: returnUrl,
  });

  return session.url;
}

// ─── Webhook handling ────────────────────────────────────────────────────────
//
// Idempotent and retry-safe:
//  - the event id is CLAIMED first (insert, conflict = already handled), so a
//    redelivery or a concurrent duplicate is applied exactly once;
//  - if processing throws, the claim is released before the error propagates, so
//    the 5xx makes Stripe retry and the retry is actually processed (recording
//    the id before processing used to swallow failed events forever);
//  - every handler sets state rather than incrementing, so re-application is harmless.

/** The storage surface the webhook needs (lets tests use a fake, no DB). */
export interface BillingStore {
  claimStripeEvent(id: string, type: string): Promise<boolean>;
  releaseStripeEvent(id: string): Promise<void>;
  getSubscription(companyId: string): Promise<any | undefined>;
  getSubscriptionByStripeCustomerId(customerId: string): Promise<any | undefined>;
  getSubscriptionByStripeSubscriptionId(subscriptionId: string): Promise<any | undefined>;
  createSubscription(data: any): Promise<any>;
  updateSubscription(id: string, data: any): Promise<any>;
}

type SubscriptionStatus = "active" | "past_due" | "cancelled";

/** Stripe status -> our status. null = leave the row unchanged (not yet a real subscription). */
export function mapStripeStatus(status: string | undefined): SubscriptionStatus | null {
  switch (status) {
    case "active":
    case "trialing": // we run our own trials; a Stripe-side trial is still access
      return "active";
    case "past_due":
      return "past_due";
    case "canceled":
    case "unpaid":
    case "incomplete_expired":
      return "cancelled";
    default:
      return null; // incomplete, paused, unknown
  }
}

const idOf = (value: unknown): string | undefined =>
  typeof value === "string" ? value : (value as { id?: string } | null | undefined)?.id || undefined;

const fromUnix = (seconds: unknown): Date | undefined =>
  typeof seconds === "number" && Number.isFinite(seconds) ? new Date(seconds * 1000) : undefined;

function planFromPrice(sub: any): string | undefined {
  const priceId = sub?.items?.data?.[0]?.price?.id;
  if (!priceId) return undefined;
  for (const [planId, cycles] of Object.entries(PLAN_PRICE_MAP)) {
    if (Object.values(cycles).includes(priceId)) return planId;
  }
  return undefined;
}

export function subscriptionLimitFields(planId: string) {
  const limits = PLAN_LIMITS[planId] || PLAN_LIMITS.free;
  return {
    maxUsers: limits.maxUsers,
    maxInvoices: limits.maxInvoices,
    maxReceipts: limits.maxReceipts,
    aiCreditsRemaining: limits.aiCreditsRemaining,
    maxCompanies: limits.maxCompanies,
    maxStorageMb: limits.maxStorageMb,
    aiCreditsPerMonth: limits.aiCreditsPerMonth,
  };
}

async function findSubscriptionRow(
  store: BillingStore,
  ids: { companyId?: string; subscriptionId?: string; customerId?: string }
) {
  if (ids.companyId) {
    const byCompany = await store.getSubscription(ids.companyId);
    if (byCompany) return byCompany;
  }
  if (ids.subscriptionId) {
    const bySub = await store.getSubscriptionByStripeSubscriptionId(ids.subscriptionId);
    if (bySub) return bySub;
  }
  if (ids.customerId) return store.getSubscriptionByStripeCustomerId(ids.customerId);
  return undefined;
}

export async function handleWebhookEvent(
  event: Stripe.Event,
  store: BillingStore = storage as unknown as BillingStore
): Promise<void> {
  const firstDelivery = await store.claimStripeEvent(event.id, event.type);
  if (!firstDelivery) {
    log.info({ eventId: event.id }, "Duplicate Stripe event, skipping");
    return;
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
        await handleCheckoutCompleted(store, event.data.object as Stripe.Checkout.Session);
        break;
      case "customer.subscription.created":
      case "customer.subscription.updated":
        await handleSubscriptionChanged(store, event.data.object as Stripe.Subscription);
        break;
      case "customer.subscription.deleted":
        await handleSubscriptionDeleted(store, event.data.object as Stripe.Subscription);
        break;
      case "invoice.payment_failed":
        await handleInvoiceOutcome(store, event.data.object as Stripe.Invoice, "past_due");
        break;
      case "invoice.paid":
        await handleInvoiceOutcome(store, event.data.object as Stripe.Invoice, "active");
        break;
      default:
        log.info({ type: event.type }, "Unhandled Stripe event type");
    }
  } catch (err) {
    // Let Stripe's retry through: forget we saw this event.
    await store.releaseStripeEvent(event.id).catch((releaseErr) =>
      log.error({ eventId: event.id, err: releaseErr }, "Failed to release Stripe event claim")
    );
    throw err;
  }
}

async function handleCheckoutCompleted(
  store: BillingStore,
  session: Stripe.Checkout.Session
): Promise<void> {
  const companyId = session.metadata?.companyId;
  const planId = session.metadata?.planId;
  const billingCycle = (session.metadata?.billingCycle as "monthly" | "yearly") || "monthly";

  if (!companyId || !planId) {
    log.warn({ sessionId: session.id }, "Checkout session missing metadata");
    return;
  }

  const now = new Date();
  const periodEnd = new Date(now);
  if (billingCycle === "yearly") periodEnd.setFullYear(periodEnd.getFullYear() + 1);
  else periodEnd.setMonth(periodEnd.getMonth() + 1);

  const paid = {
    planId,
    planName: planId.charAt(0).toUpperCase() + planId.slice(1),
    status: "active",
    trialEndsAt: null, // paying ends the trial
    stripeCustomerId: idOf(session.customer),
    stripeSubscriptionId: idOf(session.subscription),
    billingCycle,
    cancelAtPeriodEnd: false,
    currentPeriodStart: now,
    currentPeriodEnd: periodEnd,
    ...subscriptionLimitFields(planId),
    invoicesCreatedThisMonth: 0,
    receiptsCreatedThisMonth: 0,
    aiCreditsUsedThisMonth: 0,
    usagePeriodStart: now,
  };

  const existing = await store.getSubscription(companyId);
  if (existing) {
    await store.updateSubscription(existing.id, paid);
  } else {
    await store.createSubscription({ companyId, ...paid });
  }
  log.info({ companyId, planId, billingCycle }, "Subscription activated via checkout");
}

async function handleSubscriptionChanged(store: BillingStore, sub: Stripe.Subscription): Promise<void> {
  const row = await findSubscriptionRow(store, {
    companyId: sub.metadata?.companyId,
    subscriptionId: sub.id,
    customerId: idOf(sub.customer),
  });
  const status = mapStripeStatus(sub.status);
  if (!row || !status) {
    if (!row) log.warn({ subscriptionId: sub.id }, "Stripe subscription event for unknown company");
    return;
  }

  const planId = sub.metadata?.planId || planFromPrice(sub) || row.planId;
  const item = (sub as any).items?.data?.[0];
  const start = fromUnix((sub as any).current_period_start ?? item?.current_period_start);
  const end = fromUnix((sub as any).current_period_end ?? item?.current_period_end);

  await store.updateSubscription(row.id, {
    planId,
    planName: planId.charAt(0).toUpperCase() + planId.slice(1),
    status,
    // A real Stripe subscription supersedes the free trial.
    trialEndsAt: null,
    stripeCustomerId: idOf(sub.customer) ?? row.stripeCustomerId,
    stripeSubscriptionId: sub.id,
    cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end),
    ...(planId !== row.planId ? subscriptionLimitFields(planId) : {}),
    ...(start ? { currentPeriodStart: start } : {}),
    ...(end ? { currentPeriodEnd: end } : {}),
  });
}

async function handleSubscriptionDeleted(store: BillingStore, sub: Stripe.Subscription): Promise<void> {
  const row = await findSubscriptionRow(store, {
    companyId: sub.metadata?.companyId,
    subscriptionId: sub.id,
    customerId: idOf(sub.customer),
  });
  if (!row) return;

  const now = new Date();
  const farFuture = new Date(now);
  farFuture.setFullYear(farFuture.getFullYear() + 100);

  await store.updateSubscription(row.id, {
    planId: "free",
    planName: "Free",
    status: "active",
    trialEndsAt: null,
    stripeSubscriptionId: null,
    billingCycle: "monthly",
    cancelAtPeriodEnd: false,
    currentPeriodStart: now,
    currentPeriodEnd: farFuture,
    ...subscriptionLimitFields("free"),
  });
  log.info({ companyId: row.companyId }, "Subscription cancelled, downgraded to free");
}

/** invoice.payment_failed -> past_due (7-day grace is applied by resolveEffectivePlan); invoice.paid -> active. */
async function handleInvoiceOutcome(
  store: BillingStore,
  invoice: Stripe.Invoice,
  status: "past_due" | "active"
): Promise<void> {
  const row = await findSubscriptionRow(store, {
    subscriptionId: idOf((invoice as any).subscription),
    customerId: idOf(invoice.customer),
  });
  if (!row) {
    log.warn({ invoiceId: invoice.id }, "Stripe invoice event for unknown subscription");
    return;
  }

  const period = (invoice as any).lines?.data?.[0]?.period;
  const start = fromUnix(period?.start);
  const end = fromUnix(period?.end);

  await store.updateSubscription(row.id, {
    status,
    ...(status === "active" && start ? { currentPeriodStart: start } : {}),
    ...(status === "active" && end ? { currentPeriodEnd: end } : {}),
  });
}
