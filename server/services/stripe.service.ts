import {
  BILLING_CYCLES,
  NO_PLAN_LIMITS,
  PAID_PLAN_IDS,
  PLAN_DEFINITIONS,
  isBillingCycle,
  isPaidPlanId,
  type BillingCycle,
  type PlanLimits as SharedPlanLimits,
} from "../../shared/plans";
import Stripe from "stripe";
import type { Company, Subscription } from "../../shared/schema";
import { storage } from "../storage";
import { createLogger } from "../config/logger";
import { getEnv } from "../config/env";
import { pq } from "./connectors/pq";
import { DomainError, errorMessage } from "../errors";
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

function planForStripePrice(priceId: string | undefined) {
  if (!priceId) return;
  for (const planId of PAID_PLAN_IDS) {
    const billingCycle = BILLING_CYCLES.find((cycle) => PLAN_PRICE_MAP[planId][cycle] === priceId);
    if (billingCycle) return { planId, billingCycle };
  }
}

function subscriptionPlanChangeFields(planId: string, billingCycle: BillingCycle) {
  const limits = PLAN_LIMITS[planId] || PLAN_LIMITS.free;
  return {
    planId,
    planName: planId.charAt(0).toUpperCase() + planId.slice(1),
    billingCycle,
    maxUsers: limits.maxUsers,
    maxInvoices: limits.maxInvoices,
    maxReceipts: limits.maxReceipts,
    maxCompanies: limits.maxCompanies,
    maxStorageMb: limits.maxStorageMb,
    aiCreditsPerMonth: limits.aiCreditsPerMonth,
  };
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

const CHECKOUT_MIN_TRIAL_SECONDS = 48 * 60 * 60;
const CHECKOUT_SESSION_LOOKBACK_SECONDS = 24 * 60 * 60;
// Stripe requires at least 30 minutes. Include time for the coupon and session API calls.
const CHECKOUT_RESERVATION_SECONDS = 35 * 60;

function checkoutInProgress() {
  return new DomainError(
    "STRIPE_CHECKOUT_IN_PROGRESS",
    409,
    undefined,
    "A checkout is already in progress. Complete it in its original tab or try again after it expires."
  );
}

/** Returns null when a previous checkout has already activated the subscription. */
async function reserveCheckout(
  stripeClient: Stripe,
  company: Company,
  subscription: Subscription,
  customerId: string,
  legacySessionCutoff: number
): Promise<number | null> {
  const previous = company.stripeFirstCheckoutExpiresAt ?? null;

  // Check Stripe even if creation lost its response or the completion webhook is delayed.
  // With no reservation, also check for sessions created before this guard was deployed.
  const previousExpiry = previous ? Math.floor(previous.getTime() / 1000) : null;
  const createdAfter =
    previousExpiry === null
      ? legacySessionCutoff
      : previousExpiry - CHECKOUT_SESSION_LOOKBACK_SECONDS;
  let stripeExpired = false;
  for await (const session of stripeClient.checkout.sessions.list({
    customer: customerId,
    created: { gte: createdAfter },
  })) {
    if (session.mode !== "subscription" || session.metadata?.companyId !== company.id) continue;
    // Open sessions also include checkouts created before returning customers were reserved.
    if (session.status === "open") throw checkoutInProgress();
    // A legacy session can complete after the subscription list was read.
    if (session.status === "complete") {
      const result = await reconcileCheckout(stripeClient, session, subscription);
      if (result === "applied") return null;
      if (result !== "closed") throw checkoutInProgress();
    }
    const matchesReservation =
      previousExpiry !== null && session.metadata.firstCheckoutExpiry === String(previousExpiry);
    if (previousExpiry !== null && !matchesReservation) continue;
    if (session.status !== "complete" && session.status !== "expired") {
      throw checkoutInProgress();
    }
    if (matchesReservation) stripeExpired = true;
  }
  if (previous && previous.getTime() > Date.now() && !stripeExpired) throw checkoutInProgress();
  const expiresAt = Math.max(
    Math.floor(Date.now() / 1000) + CHECKOUT_RESERVATION_SECONDS,
    (previousExpiry ?? 0) + 1
  );
  const result = await pq(
    `UPDATE companies
        SET stripe_first_checkout_expires_at = $2
      WHERE id = $1 AND stripe_first_checkout_expires_at IS NOT DISTINCT FROM $3
        AND EXISTS (
          SELECT 1 FROM subscriptions WHERE company_id = $1
            AND stripe_subscription_id IS NULL AND stripe_checkout_completed = $4
        )`,
    [company.id, new Date(expiresAt * 1000), previous, subscription.stripeCheckoutCompleted]
  );
  if (!result.rowCount) throw checkoutInProgress();
  return expiresAt;
}

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
  let subscription = await storage.getSubscription(companyId);
  if (!subscription) throw new DomainError("SUBSCRIPTION_NOT_FOUND", 404);
  if (subscription.stripeSubscriptionId) return successUrl;
  const company = await storage.getCompany(companyId);
  if (!company) throw new DomainError("COMPANY_NOT_FOUND", 404);
  let customerId = subscription.stripeCustomerId;
  const legacySessionCutoff = Math.floor(Date.now() / 1000) - CHECKOUT_SESSION_LOOKBACK_SECONDS;

  if (!customerId) {
    const customer = await stripeClient.customers.create(
      {
        metadata: { companyId },
        name: company.name || undefined,
        email: company.contactEmail || undefined,
      },
      { idempotencyKey: "checkout-customer:" + companyId }
    );
    customerId = customer.id;
    subscription = await storage.updateSubscription(subscription.id, {
      stripeCustomerId: customerId,
    });
    if (subscription.stripeSubscriptionId) return successUrl;
  } else if (await recoverStripeSubscription(stripeClient, subscription, customerId)) {
    return successUrl;
  }

  // A first paid invoice can earn a referral discount even after the product trial ends.
  const firstSubscription = !subscription.stripeCheckoutCompleted && subscription.planId === "free";
  const checkoutExpiry = await reserveCheckout(
    stripeClient,
    company,
    subscription,
    customerId,
    legacySessionCutoff
  );
  if (checkoutExpiry === null) return successUrl;
  const quantity = perSeat() ? await billableSeats(companyId) : 1;
  // Referee reward: a percent-off coupon applied to the first paid invoice.
  const coupon = firstSubscription ? await refereeCouponFor(companyId) : null;
  const vatTaxRate = process.env.STRIPE_TAX_RATE_VAT;

  const trialEnd =
    firstSubscription && subscription.trialEndsAt
      ? Math.floor(subscription.trialEndsAt.getTime() / 1000)
      : 0;
  const hasRemainingTrial = trialEnd >= Math.ceil(Date.now() / 1000) + CHECKOUT_MIN_TRIAL_SECONDS;

  const session = await stripeClient.checkout.sessions.create(
    {
      customer: customerId,
      mode: "subscription",
      line_items: [
        { price: priceId, quantity, ...(vatTaxRate ? { tax_rates: [vatTaxRate] } : {}) },
      ],
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        companyId,
        planId,
        billingCycle,
        firstCheckoutExpiry: String(checkoutExpiry),
      },
      expires_at: checkoutExpiry,
      ...(coupon ? { discounts: [{ coupon }] } : {}),
      ...(process.env.STRIPE_AUTOMATIC_TAX === "true" ? { automatic_tax: { enabled: true } } : {}),
      subscription_data: {
        metadata: { companyId, planId, billingCycle },
        ...(hasRemainingTrial ? { trial_end: trialEnd } : {}),
      },
    },
    { idempotencyKey: `checkout-session:${companyId}:${checkoutExpiry}` }
  );

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
  const stripeSubscriptionId = subscription.stripeSubscriptionId;
  const sub = await stripeClient.subscriptions.retrieve(stripeSubscriptionId);
  const itemId = sub.items.data[0]?.id;
  await stripeClient.subscriptions.update(stripeSubscriptionId, {
    items: [{ id: itemId, price: priceId, quantity: seats }],
    proration_behavior: "create_prorations",
    metadata: { companyId, planId, billingCycle },
  });
  const reconciled = await reconcileLinkedStripeSubscription(
    stripeClient,
    subscription,
    stripeSubscriptionId
  );
  if (!reconciled) throw new DomainError("NO_PAID_SUBSCRIPTION", 409);
  return reconciled;
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
  // Idempotency: claim the event id atomically. A failed handler releases the claim and
  // rethrows (the route answers 5xx), so Stripe's retry is processed instead of being
  // skipped as a duplicate of a delivery that never took effect.
  const claimed = await storage.createStripeEvent(event.id, event.type);
  if (!claimed) {
    log.info({ eventId: event.id }, "Duplicate Stripe event, skipping");
    return;
  }

  try {
    await dispatchWebhookEvent(event);
  } catch (err) {
    await storage
      .releaseStripeEvent(event.id)
      .catch((releaseErr: unknown) =>
        log.error(
          { eventId: event.id, err: errorMessage(releaseErr) },
          "Could not release a failed Stripe event"
        )
      );
    throw err;
  }
}

async function dispatchWebhookEvent(event: Stripe.Event): Promise<void> {
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
  if (!companyId) {
    log.warn({ sessionId: session.id }, "Checkout session missing metadata");
    return;
  }

  const subscription = await storage.getSubscription(companyId);
  if (!subscription) {
    log.warn({ companyId }, "No subscription found for company");
    return;
  }

  const stripeClient = getStripe();
  if (stripeClient) await reconcileCheckout(stripeClient, session, subscription);
}

async function reconcileCheckout(
  stripeClient: Stripe,
  session: Stripe.Checkout.Session,
  subscription: Subscription
): Promise<CheckoutReconciliation> {
  const stripeSubscriptionId = stripeObjectId(session.subscription);
  if (
    !stripeSubscriptionId ||
    !subscription.stripeCustomerId ||
    stripeObjectId(session.customer) !== subscription.stripeCustomerId ||
    session.metadata?.companyId !== subscription.companyId
  ) {
    return "unresolved";
  }
  return reconcileStripeCheckout(
    stripeClient,
    subscription,
    stripeSubscriptionId,
    session.metadata
  );
}

function stripeObjectId(value: string | { id: string } | null | undefined) {
  return typeof value === "string" ? value : value?.id;
}

function stripeSubscriptionClosed(current: Stripe.Subscription) {
  return current.status === "canceled" || current.status === "incomplete_expired";
}

function stripeSubscriptionMatches(current: Stripe.Subscription, subscription: Subscription) {
  return (
    stripeObjectId(current.customer) === subscription.stripeCustomerId &&
    (!current.metadata?.companyId || current.metadata.companyId === subscription.companyId)
  );
}

async function recoverStripeSubscription(
  stripeClient: Stripe,
  subscription: Subscription,
  customerId: string
): Promise<boolean> {
  // A completed session can outlive the reservation lookup window.
  for await (const candidate of stripeClient.subscriptions.list({
    customer: customerId,
    status: "all",
  })) {
    if (stripeSubscriptionClosed(candidate)) continue;
    const result = await reconcileStripeCheckout(stripeClient, subscription, candidate.id);
    if (result === "applied") return true;
    if (result === "closed") continue;
    if (
      stripeSubscriptionMatches(candidate, subscription) &&
      (!candidate.metadata?.planId || !candidate.metadata?.billingCycle)
    ) {
      for await (const session of stripeClient.checkout.sessions.list({
        subscription: candidate.id,
      })) {
        if (
          session.mode === "subscription" &&
          session.status === "complete" &&
          session.metadata?.companyId === subscription.companyId &&
          stripeObjectId(session.customer) === customerId &&
          stripeObjectId(session.subscription) === candidate.id &&
          (await reconcileCheckout(stripeClient, session, subscription)) === "applied"
        ) {
          return true;
        }
      }
    }
    // An incomplete or unrecognized subscription must not lead to a second charge.
    throw checkoutInProgress();
  }
  return false;
}

type CheckoutReconciliation = "applied" | "closed" | "unresolved";

async function reconcileStripeCheckout(
  stripeClient: Stripe,
  subscription: Subscription,
  stripeSubscriptionId: string,
  checkoutMetadata?: Stripe.Metadata | null
): Promise<CheckoutReconciliation> {
  // A webhook that arrives during this Stripe read waits for linking to commit.
  const result = await storage.reconcileStripeSubscription<CheckoutReconciliation>(
    subscription,
    async (locked) => {
      if (locked.stripeSubscriptionId) {
        return {
          result: locked.stripeSubscriptionId === stripeSubscriptionId ? "applied" : "unresolved",
        };
      }

      const current = await stripeClient.subscriptions.retrieve(stripeSubscriptionId);
      if (current.id !== stripeSubscriptionId || !stripeSubscriptionMatches(current, locked)) {
        return { result: "unresolved" };
      }
      const item = current.items?.data?.[0];
      // Checkout metadata can still describe the old price after a portal plan change.
      const billedPlan = planForStripePrice(item?.price?.id);
      const planId = billedPlan?.planId ?? (current.metadata?.planId || checkoutMetadata?.planId);
      const billingCycle =
        billedPlan?.billingCycle ??
        (current.metadata?.billingCycle || checkoutMetadata?.billingCycle);
      const knownPlan = isPaidPlanId(planId) && isBillingCycle(billingCycle);
      if (stripeSubscriptionClosed(current)) {
        return {
          result: "closed",
          data:
            knownPlan && !locked.stripeCheckoutCompleted
              ? { stripeCheckoutCompleted: true }
              : undefined,
        };
      }
      if (
        !knownPlan ||
        !["active", "trialing", "past_due", "unpaid", "paused"].includes(current.status)
      ) {
        return { result: "unresolved" };
      }

      return {
        result: "applied",
        data: {
          ...subscriptionPlanChangeFields(planId, billingCycle),
          ...stripeSubscriptionState(current),
          stripeCheckoutCompleted: true,
          stripeSubscriptionId,
          seatCount: item?.quantity ?? locked.seatCount ?? 1,
          aiCreditsRemaining: PLAN_LIMITS[planId].aiCreditsRemaining,
          invoicesCreatedThisMonth: 0,
          receiptsCreatedThisMonth: 0,
          aiCreditsUsedThisMonth: 0,
          usagePeriodStart: new Date(),
        },
      };
    }
  );
  return result ?? "unresolved";
}

function stripeSubscriptionState(sub: Stripe.Subscription) {
  // The pinned API version still sends the period bounds on the subscription itself.
  const subPeriod = sub as Stripe.Subscription & {
    current_period_start: number;
    current_period_end: number;
  };
  const status =
    sub.status === "active"
      ? "active"
      : sub.status === "trialing"
        ? "trialing"
        : sub.status === "past_due" || sub.status === "unpaid"
          ? "past_due"
          : sub.status === "canceled"
            ? "cancelled"
            : sub.status === "paused"
              ? "paused"
              : "active";

  return {
    status,
    trialEndsAt: sub.trial_end ? new Date(sub.trial_end * 1000) : null,
    cancelAtPeriodEnd: sub.cancel_at_period_end,
    currentPeriodStart: new Date(subPeriod.current_period_start * 1000),
    currentPeriodEnd: new Date(subPeriod.current_period_end * 1000),
  };
}

async function resolveWebhookSubscription(sub: Stripe.Subscription, includeUnlinked = false) {
  const companyId = sub.metadata?.companyId;
  const customerId = stripeObjectId(sub.customer);
  if (!customerId) return;
  if (!companyId) return storage.getSubscriptionByStripeIds(sub.id, customerId, includeUnlinked);

  const subscription = await storage.getSubscription(companyId);
  if (subscription?.stripeCustomerId === customerId) return subscription;
}

async function handleSubscriptionUpdated(sub: Stripe.Subscription): Promise<void> {
  const subscription = await resolveWebhookSubscription(sub, true);
  if (!subscription) return;

  const stripeClient = getStripe();
  if (!stripeClient) throw new Error("Stripe not configured");

  await reconcileLinkedStripeSubscription(stripeClient, subscription, sub.id);
}

async function reconcileLinkedStripeSubscription(
  stripeClient: Stripe,
  subscription: Subscription,
  stripeSubscriptionId: string
) {
  // Serialize the Stripe read and local write so overlapping deliveries cannot
  // commit their results in reverse order.
  return storage.reconcileStripeSubscription(subscription, async (locked) => {
    if (locked.stripeSubscriptionId !== stripeSubscriptionId) return { result: undefined };

    const current = await stripeClient.subscriptions.retrieve(stripeSubscriptionId);
    if (
      current.id !== stripeSubscriptionId ||
      !stripeSubscriptionMatches(current, locked) ||
      stripeSubscriptionClosed(current)
    ) {
      return { result: undefined };
    }
    const item = current.items.data[0];
    const plan = planForStripePrice(item?.price?.id);
    const seats = item?.quantity ?? locked.seatCount ?? 1;
    return {
      result: {
        planId: plan?.planId ?? locked.planId,
        billingCycle: plan?.billingCycle ?? locked.billingCycle,
        seats,
      },
      data: {
        ...stripeSubscriptionState(current),
        ...(plan && subscriptionPlanChangeFields(plan.planId, plan.billingCycle)),
        seatCount: seats,
      },
    };
  });
}

async function handleSubscriptionDeleted(sub: Stripe.Subscription): Promise<void> {
  const subscription = await resolveWebhookSubscription(sub);
  if (!subscription) {
    const customerId = stripeObjectId(sub.customer);
    if (customerId && !sub.metadata?.companyId) {
      // Session-only recovery may link this subscription after the first lookup.
      const { rows } = await pq(
        `SELECT 1 FROM subscriptions WHERE stripe_customer_id = $1
           AND (stripe_subscription_id IS NULL OR stripe_subscription_id = $2) LIMIT 1`,
        [customerId, sub.id]
      );
      if (rows.length)
        throw new Error("Stripe subscription deletion arrived before recovery linked it");
    }
    return;
  }

  // Downgrade to free
  if (subscription.stripeSubscriptionId && subscription.stripeSubscriptionId !== sub.id) return;
  const freeLimits = PLAN_LIMITS.free;
  const now = new Date();
  const periodEnd = new Date(now);
  periodEnd.setFullYear(periodEnd.getFullYear() + 100);

  await storage.updateSubscription(subscription.id, {
    planId: "free",
    planName: "Free",
    status: "active",
    stripeSubscriptionId: null,
    stripeCheckoutCompleted: true,
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

  log.info({ companyId: subscription.companyId }, "Subscription cancelled, downgraded to free");
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
    body: "We have not been able to collect your subscription payment. If it stays unpaid, your company loses access to paid features and its books become read-only when Stripe ends the subscription.",
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
