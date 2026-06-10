import Stripe from 'stripe';
import { storage } from '../storage';
import { createLogger } from '../config/logger';
import { getEnv } from '../config/env';

const log = createLogger('stripe');

let stripe: Stripe | null = null;

export function getStripe(): Stripe | null {
  if (stripe) return stripe;
  const env = getEnv();
  const key = (env as any).STRIPE_SECRET_KEY;
  if (!key) {
    log.warn('Stripe not configured — STRIPE_SECRET_KEY not set');
    return null;
  }
  stripe = new Stripe(key, { apiVersion: '2024-12-18.acacia' as any });
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
  free: { maxUsers: 1, maxInvoices: 20, maxReceipts: 20, aiCreditsRemaining: 10, maxCompanies: 1, maxStorageMb: 500, aiCreditsPerMonth: 10 },
  starter: { maxUsers: 3, maxInvoices: 200, maxReceipts: 200, aiCreditsRemaining: 50, maxCompanies: 1, maxStorageMb: 5120, aiCreditsPerMonth: 50 },
  professional: { maxUsers: 10, maxInvoices: -1, maxReceipts: -1, aiCreditsRemaining: 500, maxCompanies: 3, maxStorageMb: 25600, aiCreditsPerMonth: 500 },
  enterprise: { maxUsers: -1, maxInvoices: -1, maxReceipts: -1, aiCreditsRemaining: -1, maxCompanies: -1, maxStorageMb: -1, aiCreditsPerMonth: -1 },
};

export async function createCheckoutSession(
  companyId: string,
  planId: string,
  billingCycle: 'monthly' | 'yearly',
  successUrl: string,
  cancelUrl: string
): Promise<string | null> {
  const stripeClient = getStripe();
  if (!stripeClient) throw new Error('Stripe not configured');

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
    mode: 'subscription',
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
  if (!stripeClient) throw new Error('Stripe not configured');

  const session = await stripeClient.billingPortal.sessions.create({
    customer: stripeCustomerId,
    return_url: returnUrl,
  });

  return session.url;
}

export async function handleWebhookEvent(event: Stripe.Event): Promise<void> {
  // Idempotency check
  const existing = await storage.getStripeEvent(event.id);
  if (existing) {
    log.info({ eventId: event.id }, 'Duplicate Stripe event, skipping');
    return;
  }

  // Record event
  await storage.createStripeEvent({
    stripeEventId: event.id,
    eventType: event.type,
    payload: JSON.stringify(event.data),
  });

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      await handleCheckoutCompleted(session);
      break;
    }
    case 'customer.subscription.updated': {
      const sub = event.data.object as Stripe.Subscription;
      await handleSubscriptionUpdated(sub);
      break;
    }
    case 'customer.subscription.deleted': {
      const sub = event.data.object as Stripe.Subscription;
      await handleSubscriptionDeleted(sub);
      break;
    }
    default:
      log.info({ type: event.type }, 'Unhandled Stripe event type');
  }
}

async function handleCheckoutCompleted(session: Stripe.Checkout.Session): Promise<void> {
  const companyId = session.metadata?.companyId;
  const planId = session.metadata?.planId;
  const billingCycle = session.metadata?.billingCycle as 'monthly' | 'yearly';

  if (!companyId || !planId) {
    log.warn({ sessionId: session.id }, 'Checkout session missing metadata');
    return;
  }

  const subscription = await storage.getSubscription(companyId);
  if (!subscription) {
    log.warn({ companyId }, 'No subscription found for company');
    return;
  }

  const limits = PLAN_LIMITS[planId] || PLAN_LIMITS.free;
  const now = new Date();
  const periodEnd = new Date(now);
  if (billingCycle === 'yearly') {
    periodEnd.setFullYear(periodEnd.getFullYear() + 1);
  } else {
    periodEnd.setMonth(periodEnd.getMonth() + 1);
  }

  await storage.updateSubscription(subscription.id, {
    planId,
    planName: planId.charAt(0).toUpperCase() + planId.slice(1),
    status: 'active',
    stripeCustomerId: typeof session.customer === 'string' ? session.customer : (session.customer as any)?.id || undefined,
    stripeSubscriptionId: typeof session.subscription === 'string' ? session.subscription : (session.subscription as any)?.id || undefined,
    billingCycle,
    currentPeriodStart: now,
    currentPeriodEnd: periodEnd,
    maxUsers: limits.maxUsers,
    maxInvoices: limits.maxInvoices,
    maxReceipts: limits.maxReceipts,
    aiCreditsRemaining: limits.aiCreditsRemaining,
    maxCompanies: limits.maxCompanies,
    maxStorageMb: limits.maxStorageMb,
    aiCreditsPerMonth: limits.aiCreditsPerMonth,
    invoicesCreatedThisMonth: 0,
    receiptsCreatedThisMonth: 0,
    aiCreditsUsedThisMonth: 0,
    usagePeriodStart: now,
  });

  log.info({ companyId, planId, billingCycle }, 'Subscription upgraded via checkout');
}

async function handleSubscriptionUpdated(sub: Stripe.Subscription): Promise<void> {
  const companyId = sub.metadata?.companyId;
  if (!companyId) return;

  const subscription = await storage.getSubscription(companyId);
  if (!subscription) return;

  const status = sub.status === 'active' ? 'active'
    : sub.status === 'past_due' ? 'past_due'
    : sub.status === 'canceled' ? 'cancelled'
    : 'active';

  await storage.updateSubscription(subscription.id, {
    status,
    cancelAtPeriodEnd: sub.cancel_at_period_end,
    currentPeriodStart: new Date((sub as any).current_period_start * 1000),
    currentPeriodEnd: new Date((sub as any).current_period_end * 1000),
  });
}

async function handleSubscriptionDeleted(sub: Stripe.Subscription): Promise<void> {
  const companyId = sub.metadata?.companyId;
  if (!companyId) return;

  const subscription = await storage.getSubscription(companyId);
  if (!subscription) return;

  // Downgrade to free
  const freeLimits = PLAN_LIMITS.free;
  const now = new Date();
  const periodEnd = new Date(now);
  periodEnd.setFullYear(periodEnd.getFullYear() + 100);

  await storage.updateSubscription(subscription.id, {
    planId: 'free',
    planName: 'Free',
    status: 'active',
    stripeSubscriptionId: null,
    billingCycle: 'monthly',
    cancelAtPeriodEnd: false,
    currentPeriodStart: now,
    currentPeriodEnd: periodEnd,
    maxUsers: freeLimits.maxUsers,
    maxInvoices: freeLimits.maxInvoices,
    maxReceipts: freeLimits.maxReceipts,
    aiCreditsRemaining: freeLimits.aiCreditsRemaining,
    maxCompanies: freeLimits.maxCompanies,
    maxStorageMb: freeLimits.maxStorageMb,
    aiCreditsPerMonth: freeLimits.aiCreditsPerMonth,
  });

  log.info({ companyId }, 'Subscription cancelled, downgraded to free');
}
