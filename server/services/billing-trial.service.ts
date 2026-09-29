// Trial lifecycle for companies. One idempotent entry point: every company gets
// exactly one subscription row; a company with none is given a trial counted
// from its own creation date (so companies that predate billing start already
// expired - the owner grandfathers them with BILLING_GRANDFATHER_BEFORE).

import { storage } from "../storage";
import { createLogger } from "../config/logger";
import { subscriptionLimitFields } from "./stripe.service";
import { TRIAL_PLAN, buildTrialWindow } from "./billing-plan";
import type { Subscription } from "../../shared/schema";

const log = createLogger("billing-trial");

interface CompanyLike {
  id?: string;
  createdAt?: Date | string | null;
  companyType?: string | null;
}

/**
 * Return the company's subscription, creating a trial row if it has none.
 * Safe to call repeatedly and concurrently (unique index on company_id makes
 * the losing insert fall back to a read).
 */
export async function ensureSubscription(
  companyId: string,
  opts: {
    company?: CompanyLike | null;
    /** Start the trial at this instant (brand-new companies: "now"). Default: the company's creation time. */
    startsAt?: Date;
  } = {}
): Promise<Subscription | undefined> {
  const existing = await storage.getSubscription(companyId);
  if (existing) return existing;

  const company = opts.company ?? (await storage.getCompany(companyId));
  if (!company) return undefined;

  const anchor = opts.startsAt ?? (company.createdAt ? new Date(company.createdAt) : new Date());
  const { start, end } = buildTrialWindow(anchor);

  try {
    return await storage.createSubscription({
      companyId,
      planId: TRIAL_PLAN,
      planName: TRIAL_PLAN.charAt(0).toUpperCase() + TRIAL_PLAN.slice(1),
      status: "trialing",
      trialEndsAt: end,
      currentPeriodStart: start,
      currentPeriodEnd: end,
      billingCycle: "monthly",
      ...subscriptionLimitFields(TRIAL_PLAN),
    } as any);
  } catch (err) {
    // Lost a race with a concurrent creator: the row exists now.
    const raced = await storage.getSubscription(companyId);
    if (raced) return raced;
    log.error({ err, companyId }, "Failed to create trial subscription");
    throw err;
  }
}
