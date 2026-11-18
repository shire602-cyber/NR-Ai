import { TRIAL_DAYS } from "../../shared/trial";
import {
  BILLING_CYCLES,
  NO_PLAN_LIMITS,
  PAID_PLAN_IDS,
  PLAN_DEFINITIONS,
  type PlanLimits as SharedPlanLimits,
} from "../../shared/plans";
import Stripe from "stripe";
import { storage } from "../storage";
import { createLogger } from "../config/logger";
import { getEnv } from "../config/env";
import { pq } from "./connectors/pq";
import { DomainError } from "../errors";
import { enqueueEmail } from "../outbox";

const log = createLogger("stripe");

let stripe: Stripe | null = null;

export function getStripe(): Stripe | null {
  if (stripe) return stripe;
  const env = getEnv();
  const key = env.STRIPE_SECRET_KEY;
  if (!key) {
    log.warn("Stripe not configured — STRIPE_SECRET_KEY not set");
    return null;
  }
  // Pinned to the API version the webhook handlers were written against, which is
  // older than the SDK's LatestApiVersion literal.
  stripe = new Stripe(key, {
    apiVersion: "2024-12-18.acacia" as unknown as Stripe.LatestApiVersion,
  });
  return stripe;
}

export function isStripeConfigured(): boolean {
  return !!getStripe();
}

/**
 * Stripe price ids per paid plan and cycle (shared/plans.ts ids and cycles), from
 * STRIPE_PRICE_<PLAN>_<CYCLE>. The Stripe prices must carry shared/plans.ts planPrice() amounts.
 */
export const PLAN_PRICE_MAP: Record<
  string,
  Record<string, string | undefined>
> = Object.fromEntries(
  PAID_PLAN_IDS.map((id) => [
    id,
    Object.fromEntries(
      BILLING_CYCLES.map((cycle) => [
        cycle,
        process.env[`STRIPE_PRICE_${id.toUpperCase()}_${cycle.toUpperCase()}`],
      ])
    ),
  ])
);

interface PlanLimits {
  maxUsers: number;
  maxInvoices: number;
  maxReceipts: number;
  aiCreditsRemaining: number;
  maxCompanies: number;
  maxStorageMb: number;
  aiCreditsPerMonth: number;
}

// Limits stored on the subscription row, from the one plan module (shared/plans.ts, WQ7). "free"
// is the stored id of a company without a paid plan (its trial, then read-only).
function storedLimits(l: SharedPlanLimits): PlanLimits {
  return {
    maxUsers: l.maxUsers,
    maxInvoices: l.maxInvoicesPerMonth,
    maxReceipts: l.maxReceiptsPerMonth,
    aiCreditsRemaining: l.aiCreditsPerMonth,
    maxCompanies: l.maxCompanies,
    maxStorageMb: l.maxStorageMb,
    aiCreditsPerMonth: l.aiCreditsPerMonth,
  };
}

const PLAN_LIMITS: Record<string, PlanLimits> = {
  free: storedLimits(NO_PLAN_LIMITS),
  ...Object.fromEntries(PLAN_DEFINITIONS.map((p) => [p.id, storedLimits(p.limits)])),
};

/** Trial length for a company's first paid subscription (STRIPE_TRIAL_DAYS, default 14; 0 = none). */
export function trialDays(): number {
  const n = Number(process.env.STRIPE_TRIAL_DAYS ?? TRIAL_DAYS);
  return Number.isFinite(n) && n >= 0 ? Math.min(Math.floor(n), 90) : TRIAL_DAYS;
}

/** Seats billed: company members (min 1). Plans priced per seat set STRIPE_PER_SEAT=true. */
export async function billableSeats(companyId: string): Promise<number> {
  const { rows } = await pq<{ n: string }>(
    `SELECT count(*) AS n FROM company_users WHERE company_id = $1`,
    [companyId]
  );
  return Math.max(1, Number(rows[0]?.n ?? 1));
}

const perSeat = () => process.env.STRIPE_PER_SEAT === "true";

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

  // Trial only for a company that never had a paid subscription.
  const firstSubscription =
    !subscription?.stripeSubscriptionId && (subscription?.planId ?? "free") === "free";
  const days = firstSubscription ? trialDays() : 0;
  const quantity = perSeat() ? await billableSeats(companyId) : 1;
  // Referee reward: a percent-off coupon applied to the first paid invoice.
  const coupon = firstSubscription ? await refereeCouponFor(companyId) : null;
  const vatTaxRate = process.env.STRIPE_TAX_RATE_VAT;

  const session = await stripeClient.checkout.sessions.create({
    customer: customerId,
    mode: "subscription",
    line_items: [{ price: priceId, quantity, ...(vatTaxRate ? { tax_rates: [vatTaxRate] } : {}) }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: { companyId, planId, billingCycle },
    ...(coupon ? { discounts: [{ coupon }] } : {}),
    ...(process.env.STRIPE_AUTOMATIC_TAX === "true" ? { automatic_tax: { enabled: true } } : {}),
    subscription_data: {
      metadata: { companyId, planId, billingCycle },
      ...(days > 0 ? { trial_period_days: days } : {}),
    },
  });

  return session.url;
}

/**
 * Plan / cycle / seat change on a live subscription with proration (Stripe
 * creates the prorated invoice items on the next invoice).
 */
export async function changeSubscriptionPlan(
  companyId: string,
  change: { planId?: string; billingCycle?: "monthly" | "yearly"; seats?: number }
): Promise<{ planId: string; billingCycle: string; seats: number }> {
  const stripeClient = getStripe();
  if (!stripeClient) throw new DomainError("STRIPE_NOT_CONFIGURED", 503);
  const subscription = await storage.getSubscription(companyId);
  if (!subscription?.stripeSubscriptionId) {
    throw new DomainError(
      "NO_PAID_SUBSCRIPTION",
      409,
      undefined,
      "Start a paid subscription through checkout first"
    );
  }
  const planId = change.planId ?? subscription.planId;
  const billingCycle = (change.billingCycle ?? subscription.billingCycle ?? "monthly") as
    | "monthly"
    | "yearly";
  const priceId = PLAN_PRICE_MAP[planId]?.[billingCycle];
  if (!priceId) throw new DomainError("NO_PRICE_FOR_PLAN", 422, { planId, billingCycle });
  const seats = change.seats ?? (perSeat() ? await billableSeats(companyId) : 1);
  const sub = await stripeClient.subscriptions.retrieve(subscription.stripeSubscriptionId);
  const itemId = sub.items.data[0]?.id;
  await stripeClient.subscriptions.update(subscription.stripeSubscriptionId, {
    items: [{ id: itemId, price: priceId, quantity: seats }],
    proration_behavior: "create_prorations",
    metadata: { companyId, planId, billingCycle },
  });
  const limits = PLAN_LIMITS[planId] || PLAN_LIMITS.free;
  await storage.updateSubscription(subscription.id, {
    planId,
    planName: planId.charAt(0).toUpperCase() + planId.slice(1),
    billingCycle,
    seatCount: seats,
    maxUsers: limits.maxUsers,
    maxInvoices: limits.maxInvoices,
    maxReceipts: limits.maxReceipts,
    maxCompanies: limits.maxCompanies,
    maxStorageMb: limits.maxStorageMb,
    aiCreditsPerMonth: limits.aiCreditsPerMonth,
  });
  return { planId, billingCycle, seats };
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

export async function handleWebhookEvent(event: Stripe.Event): Promise<void> {
  // Idempotency check
  const existing = await storage.getStripeEvent(event.id);
  if (existing) {
    log.info({ eventId: event.id }, "Duplicate Stripe event, skipping");
    return;
  }

  // Record event
  await storage.createStripeEvent(event.id, event.type);
  void {
    payload: JSON.stringify(event.data),
  };

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      await handleCheckoutCompleted(session);
      break;
    }
    case "customer.subscription.updated": {
      const sub = event.data.object as Stripe.Subscription;
      await handleSubscriptionUpdated(sub);
      break;
    }
    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      await handleSubscriptionDeleted(sub);
      break;
    }
    case "invoice.paid": {
      await handleInvoicePaid(event.data.object as Stripe.Invoice);
      break;
    }
    case "invoice.payment_failed": {
      await handlePaymentFailed(event.data.object as Stripe.Invoice);
      break;
    }
    default:
      log.info({ type: event.type }, "Unhandled Stripe event type");
  }
}

async function handleCheckoutCompleted(session: Stripe.Checkout.Session): Promise<void> {
  const companyId = session.metadata?.companyId;
  const planId = session.metadata?.planId;
  const billingCycle = session.metadata?.billingCycle as "monthly" | "yearly";

  if (!companyId || !planId) {
    log.warn({ sessionId: session.id }, "Checkout session missing metadata");
    return;
  }

  const subscription = await storage.getSubscription(companyId);
  if (!subscription) {
    log.warn({ companyId }, "No subscription found for company");
    return;
  }

  const limits = PLAN_LIMITS[planId] || PLAN_LIMITS.free;
  const now = new Date();
  const periodEnd = new Date(now);
  if (billingCycle === "yearly") {
    periodEnd.setFullYear(periodEnd.getFullYear() + 1);
  } else {
    periodEnd.setMonth(periodEnd.getMonth() + 1);
  }

  await storage.updateSubscription(subscription.id, {
    planId,
    planName: planId.charAt(0).toUpperCase() + planId.slice(1),
    status: "active",
    stripeCustomerId:
      typeof session.customer === "string" ? session.customer : session.customer?.id || undefined,
    stripeSubscriptionId:
      typeof session.subscription === "string"
        ? session.subscription
        : session.subscription?.id || undefined,
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

  log.info({ companyId, planId, billingCycle }, "Subscription upgraded via checkout");
}

async function handleSubscriptionUpdated(sub: Stripe.Subscription): Promise<void> {
  // The pinned API version still sends the period bounds on the subscription itself.
  const subPeriod = sub as Stripe.Subscription & {
    current_period_start: number;
    current_period_end: number;
  };
  const companyId = sub.metadata?.companyId;
  if (!companyId) return;

  const subscription = await storage.getSubscription(companyId);
  if (!subscription) return;

  const status =
    sub.status === "active"
      ? "active"
      : sub.status === "trialing"
        ? "trialing"
        : sub.status === "past_due" || sub.status === "unpaid"
          ? "past_due"
          : sub.status === "canceled"
            ? "cancelled"
            : "active";

  await storage.updateSubscription(subscription.id, {
    status,
    trialEndsAt: sub.trial_end ? new Date(sub.trial_end * 1000) : null,
    seatCount: sub.items?.data?.[0]?.quantity ?? subscription.seatCount ?? 1,
    cancelAtPeriodEnd: sub.cancel_at_period_end,
    currentPeriodStart: new Date(subPeriod.current_period_start * 1000),
    currentPeriodEnd: new Date(subPeriod.current_period_end * 1000),
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
    planId: "free",
    planName: "Free",
    status: "active",
    stripeSubscriptionId: null,
    billingCycle: "monthly",
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

  log.info({ companyId }, "Subscription cancelled, downgraded to free");
}

// ─── Subscription invoices, dunning, referral rewards (W5-B, R19-11, R19-16) ──

/** UAE VAT: Stripe subscription prices are VAT-inclusive; 5/105 of the total is VAT. */
export function splitVatInclusive(
  totalFils: number,
  ratePct = 5
): { netFils: number; vatFils: number } {
  const vatFils = Math.round((totalFils * ratePct) / (100 + ratePct));
  return { netFils: totalFils - vatFils, vatFils };
}

async function companyByStripeCustomer(customerId: string | null | undefined) {
  if (!customerId) return null;
  const { rows } = await pq<{
    company_id: string;
    plan_id: string;
    billing_cycle: string;
    seat_count: number;
  }>(
    `SELECT company_id, plan_id, billing_cycle, seat_count FROM subscriptions
      WHERE stripe_customer_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [customerId]
  );
  return rows[0] ?? null;
}

async function nextBillingNumber(kind: "invoice" | "receipt"): Promise<string> {
  const prefix = kind === "invoice" ? "MUH-INV" : "MUH-RCT";
  const year = new Date().getUTCFullYear();
  const { rows } = await pq<{ n: string }>(
    `SELECT count(*) + 1 AS n FROM billing_documents WHERE kind = $1 AND number LIKE $2`,
    [kind, `${prefix}-${year}-%`]
  );
  return `${prefix}-${year}-${String(rows[0]?.n ?? 1).padStart(6, "0")}`;
}

/**
 * Record a paid Stripe invoice as a VAT-inclusive tax invoice + receipt for
 * the customer (idempotent per Stripe invoice), clear dunning, and apply the
 * referral reward on the referred customer's first paid invoice.
 */
export async function recordPaidSubscriptionInvoice(invoice: {
  id: string;
  customer: string | null;
  total: number; // minor units (fils for AED)
  discountFils?: number;
  currency: string;
  periodStart?: number | null;
  periodEnd?: number | null;
}): Promise<{ companyId: string; invoiceNumber: string } | null> {
  const sub = await companyByStripeCustomer(invoice.customer);
  if (!sub) {
    log.warn({ invoiceId: invoice.id }, "Paid invoice for unknown Stripe customer");
    return null;
  }
  const { netFils, vatFils } = splitVatInclusive(invoice.total);
  let invoiceNumber = "";
  for (const kind of ["invoice", "receipt"] as const) {
    const number = await nextBillingNumber(kind);
    const { rows } = await pq<{ number: string }>(
      `INSERT INTO billing_documents (company_id, kind, number, stripe_invoice_id, plan_id, billing_cycle,
          seat_count, period_start, period_end, subtotal_fils, vat_fils, discount_fils, total_fils,
          currency, status, paid_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'paid', now())
       ON CONFLICT (stripe_invoice_id, kind) WHERE stripe_invoice_id IS NOT NULL DO NOTHING
       RETURNING number`,
      [
        sub.company_id,
        kind,
        number,
        invoice.id,
        sub.plan_id,
        sub.billing_cycle,
        sub.seat_count ?? 1,
        invoice.periodStart ? new Date(invoice.periodStart * 1000) : null,
        invoice.periodEnd ? new Date(invoice.periodEnd * 1000) : null,
        netFils,
        vatFils,
        invoice.discountFils ?? 0,
        invoice.total,
        invoice.currency.toUpperCase(),
      ]
    );
    if (kind === "invoice") invoiceNumber = rows[0]?.number ?? "";
  }
  await pq(
    `UPDATE subscriptions SET dunning_stage = 0, last_payment_failed_at = NULL,
            status = CASE WHEN status = 'past_due' THEN 'active' ELSE status END, updated_at = now()
      WHERE company_id = $1`,
    [sub.company_id]
  );
  await recordReferralConversion(sub.company_id, { stripeInvoiceId: invoice.id });
  return { companyId: sub.company_id, invoiceNumber };
}

function customerIdOf(invoice: Stripe.Invoice): string | null {
  const c = invoice.customer as unknown;
  if (typeof c === "string") return c;
  return (c as { id?: string } | null)?.id ?? null;
}

async function handleInvoicePaid(invoice: Stripe.Invoice): Promise<void> {
  if (!invoice.id) return;
  const discount = (invoice.total_discount_amounts ?? []).reduce(
    (s: number, d: { amount?: number }) => s + (d.amount ?? 0),
    0
  );
  await recordPaidSubscriptionInvoice({
    id: invoice.id,
    customer: customerIdOf(invoice),
    total: invoice.total ?? 0,
    discountFils: discount,
    currency: invoice.currency ?? "aed",
    periodStart: invoice.period_start,
    periodEnd: invoice.period_end,
  });
}

const DUNNING_COPY = [
  {
    subject: "Payment failed for your Muhasib.ai subscription",
    body: "We could not charge your card for your Muhasib.ai subscription. We will retry automatically. Please update your payment method in Billing to avoid interruption.",
  },
  {
    subject: "Second notice: your Muhasib.ai payment is still outstanding",
    body: "Your subscription payment has failed again. Update your payment method in Billing so your plan stays active.",
  },
  {
    subject: "Final notice: your Muhasib.ai plan will be downgraded",
    body: "We have not been able to collect your subscription payment. If it stays unpaid, your company moves to the Free plan when Stripe ends the subscription.",
  },
];

/** Failed payment: past_due + escalating dunning email through the outbox (one per attempt). */
export async function recordPaymentFailure(invoice: {
  id: string;
  customer: string | null;
  attemptCount?: number | null;
}): Promise<{ companyId: string; stage: number; emailed: boolean } | null> {
  const sub = await companyByStripeCustomer(invoice.customer);
  if (!sub) return null;
  const { rows } = await pq<{ dunning_stage: number }>(
    `UPDATE subscriptions SET status = 'past_due', dunning_stage = LEAST(dunning_stage + 1, 3),
            last_payment_failed_at = now(), updated_at = now()
      WHERE company_id = $1 RETURNING dunning_stage`,
    [sub.company_id]
  );
  const stage = rows[0]?.dunning_stage ?? 1;
  const { rows: to } = await pq<{ email: string | null }>(
    `SELECT COALESCE(c.contact_email, u.email) AS email
       FROM companies c
       LEFT JOIN company_users cu ON cu.company_id = c.id AND cu.role = 'owner'
       LEFT JOIN users u ON u.id = cu.user_id
      WHERE c.id = $1 LIMIT 1`,
    [sub.company_id]
  );
  const email = to[0]?.email;
  if (email) {
    const copy = DUNNING_COPY[Math.min(stage, DUNNING_COPY.length) - 1];
    await enqueueEmail({
      to: email,
      subject: copy.subject,
      html: `<p>${copy.body}</p>`,
      text: copy.body,
      companyId: sub.company_id,
      category: "billing_dunning",
      idempotencyKey: `dunning:${invoice.id}:${invoice.attemptCount ?? stage}`,
    });
  }
  return { companyId: sub.company_id, stage, emailed: !!email };
}

async function handlePaymentFailed(invoice: Stripe.Invoice): Promise<void> {
  if (!invoice.id) return;
  await recordPaymentFailure({
    id: invoice.id,
    customer: customerIdOf(invoice),
    attemptCount: invoice.attempt_count,
  });
}

interface PendingReferral {
  id: string;
  referral_code_id: string;
  referrer_id: string;
  referee_reward_amount: string | null;
  referrer_reward_amount: string | null;
  referee_reward_type: string | null;
}

async function pendingReferralForCompany(companyId: string): Promise<PendingReferral | null> {
  const { rows } = await pq<PendingReferral>(
    `SELECT r.id, r.referral_code_id, r.referrer_id, r.referee_reward_amount, r.referrer_reward_amount,
            rc.referee_reward_type
       FROM referrals r
       JOIN referral_codes rc ON rc.id = r.referral_code_id
       JOIN company_users cu ON cu.company_id = $1 AND cu.role = 'owner'
       JOIN users u ON u.id = cu.user_id
      WHERE r.status IN ('pending', 'signed_up', 'qualified')
        AND (r.referee_id = u.id OR lower(r.referee_email) = lower(u.email))
        AND r.referrer_id <> u.id
        AND (r.expires_at IS NULL OR r.expires_at > now())
      ORDER BY r.created_at ASC LIMIT 1`,
    [companyId]
  );
  return rows[0] ?? null;
}

/** Percent-off coupon for a referred company's first checkout. */
async function refereeCouponFor(companyId: string): Promise<string | null> {
  const stripeClient = getStripe();
  const referral = await pendingReferralForCompany(companyId);
  if (!stripeClient || !referral || referral.referee_reward_type !== "discount") return null;
  const pct = Number(referral.referee_reward_amount ?? 0);
  if (!(pct > 0 && pct <= 100)) return null;
  const coupon = await stripeClient.coupons.create({
    percent_off: pct,
    duration: "once",
    name: `Referral ${pct}% off first invoice`,
    metadata: { referralId: referral.id, companyId },
  });
  return coupon.id;
}

/**
 * Conversion = the referred customer's first paid subscription invoice.
 * Records both rewards in billing_credits (idempotent per referral and
 * beneficiary). The referrer's credit is applied as a Stripe customer
 * balance credit when Stripe is configured and the referrer's company has a
 * Stripe customer; otherwise it stays `ledgered` for manual application.
 */
export async function recordReferralConversion(
  companyId: string,
  opts: { stripeInvoiceId?: string | null } = {}
): Promise<{ referralId: string; credits: number } | null> {
  const referral = await pendingReferralForCompany(companyId);
  if (!referral) return null;
  const stripeClient = getStripe();
  const { rows: owner } = await pq<{ user_id: string }>(
    `SELECT user_id FROM company_users WHERE company_id = $1 AND role = 'owner' LIMIT 1`,
    [companyId]
  );
  let credits = 0;

  // Referee: percent off the first invoice (applied by the checkout coupon when Stripe is live).
  const refereeValue = Number(referral.referee_reward_amount ?? 0);
  if (refereeValue > 0) {
    const discount = referral.referee_reward_type === "discount";
    const status = stripeClient && opts.stripeInvoiceId ? "applied_stripe" : "ledgered";
    const res = await pq(
      `INSERT INTO billing_credits (company_id, user_id, referral_id, beneficiary, kind, percent_off,
          amount_fils, status, stripe_ref, note, applied_at)
       VALUES ($1, $2, $3, 'referee', $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (referral_id, beneficiary) WHERE referral_id IS NOT NULL DO NOTHING`,
      [
        companyId,
        owner[0]?.user_id ?? null,
        referral.id,
        discount ? "percent_off" : "credit",
        discount ? refereeValue : null,
        discount ? 0 : Math.round(refereeValue * 100),
        status,
        opts.stripeInvoiceId ?? null,
        "Referral welcome reward on the first paid invoice",
        status === "applied_stripe" ? new Date() : null,
      ]
    );
    credits += res.rowCount;
  }

  // Referrer: fixed AED credit on their own subscription.
  const referrerFils = Math.round(Number(referral.referrer_reward_amount ?? 0) * 100);
  if (referrerFils > 0) {
    const { rows: refCo } = await pq<{ company_id: string; stripe_customer_id: string | null }>(
      `SELECT s.company_id, s.stripe_customer_id FROM company_users cu
         JOIN subscriptions s ON s.company_id = cu.company_id
        WHERE cu.user_id = $1 AND cu.role = 'owner' ORDER BY s.stripe_customer_id NULLS LAST LIMIT 1`,
      [referral.referrer_id]
    );
    let status = "ledgered";
    let stripeRef: string | null = null;
    const customer = refCo[0]?.stripe_customer_id;
    if (stripeClient && customer) {
      try {
        const txn = await stripeClient.customers.createBalanceTransaction(customer, {
          amount: -referrerFils,
          currency: "aed",
          description: `Referral reward (${referral.id})`,
        });
        status = "applied_stripe";
        stripeRef = txn.id;
      } catch (err) {
        log.warn({ err, referralId: referral.id }, "Stripe credit failed; reward ledgered");
      }
    }
    const res = await pq(
      `INSERT INTO billing_credits (company_id, user_id, referral_id, beneficiary, kind, amount_fils,
          status, stripe_ref, note, applied_at)
       VALUES ($1, $2, $3, 'referrer', 'credit', $4, $5, $6, $7, $8)
       ON CONFLICT (referral_id, beneficiary) WHERE referral_id IS NOT NULL DO NOTHING`,
      [
        refCo[0]?.company_id ?? null,
        referral.referrer_id,
        referral.id,
        referrerFils,
        status,
        stripeRef,
        "Referral reward: a customer you referred started a paid plan",
        status === "applied_stripe" ? new Date() : null,
      ]
    );
    credits += res.rowCount;
  }

  await pq(
    `UPDATE referrals SET status = 'rewarded', qualified_at = COALESCE(qualified_at, now()),
            rewarded_at = now(), referee_reward_status = 'credited', referrer_reward_status = 'credited',
            referee_id = COALESCE(referee_id, $2)
      WHERE id = $1`,
    [referral.id, owner[0]?.user_id ?? null]
  );
  await pq(
    `UPDATE referral_codes SET successful_referrals = successful_referrals + 1,
            total_rewards_earned = total_rewards_earned + $2
      WHERE id = $1`,
    [referral.referral_code_id, referrerFils / 100]
  );
  return { referralId: referral.id, credits };
}
