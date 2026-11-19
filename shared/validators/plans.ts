/**
 * WQ7 request bodies: plan assignment (NR admin), automation switches, onboarding progress and
 * document numbering settings.
 */
import { z } from "zod";
import {
  BILLING_CYCLES,
  PAID_PLAN_IDS,
  SIGNUP_PLAN_SOURCES,
  isBillingCycle,
  isPaidPlanId,
  type BillingCycle,
  type PaidPlanId,
  type PlanChoiceSource,
} from "../plans";

/** PUT /api/admin/companies/:companyId/plan — "none" removes the paid plan (trial, then read-only). */
export const adminSetPlanBody = z
  .object({
    planId: z.enum([...PAID_PLAN_IDS, "none"]),
    billingCycle: z.enum(["monthly", "yearly"]).optional(),
    /** Extend (or end) the trial of a company without a paid plan; ISO date-time or null. */
    trialEndsAt: z.string().datetime({ offset: true }).nullable().optional(),
    note: z.string().trim().max(500).optional(),
  })
  .strict();
export type AdminSetPlanBody = z.infer<typeof adminSetPlanBody>;

/** PUT /api/companies/:companyId/automations/:key */
export const automationSwitchBody = z.object({ enabled: z.boolean() }).strict();

export const ONBOARDING_STEPS = ["company", "starting-point", "first-task", "done"] as const;
export const ONBOARDING_FIRST_TASKS = ["invoice", "bank", "bill", "explore"] as const;
export const ONBOARDING_STARTING_POINTS = [
  "fresh",
  "migrating",
  "accountant",
  "opening-balances",
] as const;

/** PUT /api/companies/:companyId/onboarding/progress */
export const onboardingProgressBody = z
  .object({
    step: z.enum(ONBOARDING_STEPS).optional(),
    firstTask: z.enum(ONBOARDING_FIRST_TASKS).nullable().optional(),
    startingPoint: z.enum(ONBOARDING_STARTING_POINTS).nullable().optional(),
    industry: z.string().trim().min(1).max(60).nullable().optional(),
    cutoverDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .optional(),
    dismissedGettingStarted: z.boolean().optional(),
  })
  .strict();
export type OnboardingProgressBody = z.infer<typeof onboardingProgressBody>;

export const NUMBERED_DOC_TYPES = [
  "invoice",
  "cash_sale",
  "credit_note",
  "debit_note",
  "quote",
] as const;

/** PUT /api/companies/:companyId/numbering/:docType */
export const numberingSettingsBody = z
  .object({
    /** Letters, digits and - / only; 1–12 characters. */
    prefix: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9][A-Za-z0-9\-/]{0,11}$/),
    /** 3–8 digits of zero padding. */
    padding: z.number().int().min(3).max(8),
    /** Restart the counter each calendar year (the year is part of the number). */
    yearlyReset: z.boolean(),
    /** Next number to issue (this year's sequence); may only move forward. */
    nextNumber: z.number().int().min(1).max(99_999_999).optional(),
  })
  .strict();
export type NumberingSettingsBody = z.infer<typeof numberingSettingsBody>;

/**
 * STEP4: optional fields of POST /api/auth/register. A plan (or cycle, or source) outside these
 * lists is a 400 before any account exists. "free" and "none" are not plans a customer can choose.
 */
export const signupPlanFields = {
  plan: z.enum(PAID_PLAN_IDS).optional(),
  billingCycle: z.enum([...BILLING_CYCLES] as [BillingCycle, ...BillingCycle[]]).optional(),
  planSource: z.enum(SIGNUP_PLAN_SOURCES).optional(),
};

/** PUT /api/companies/:companyId/billing/chosen-plan */
export const chosenPlanBody = z
  .object({
    planId: z.enum(PAID_PLAN_IDS),
    billingCycle: z.enum([...BILLING_CYCLES] as [BillingCycle, ...BillingCycle[]]),
  })
  .strict();
export type ChosenPlanBody = z.infer<typeof chosenPlanBody>;

/** POST /api/companies/:companyId/billing/activation-request (plan and cycle come from the stored choice). */
export const activationRequestBody = z
  .object({ note: z.string().trim().max(500).optional() })
  .strict();
export type ActivationRequestBody = z.infer<typeof activationRequestBody>;

export interface SignupPlanChoice {
  planId: PaidPlanId;
  billingCycle: BillingCycle;
  source: PlanChoiceSource;
}

/**
 * Reads signup_plan / signup_cycle / signup_source from a (sanitised) post-OAuth path and returns a
 * validated choice, or null for anything missing, repeated or invalid. Never throws.
 */
export function parseSignupPlanFromPath(nextPath: string | null | undefined): SignupPlanChoice | null {
  if (typeof nextPath !== "string" || nextPath.length > 2048) return null;
  const q = nextPath.indexOf("?");
  if (q < 0) return null;
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(nextPath.slice(q + 1).split("#")[0]);
  } catch {
    return null;
  }
  const one = (k: string): string | null => {
    const all = params.getAll(k);
    return all.length === 1 ? all[0] : null;
  };
  const planId = one("signup_plan");
  if (!isPaidPlanId(planId)) return null;
  const cycle = one("signup_cycle");
  const source = one("signup_source");
  return {
    planId,
    billingCycle: isBillingCycle(cycle) ? cycle : "monthly",
    source: (SIGNUP_PLAN_SOURCES as readonly string[]).includes(source ?? "")
      ? (source as PlanChoiceSource)
      : "signup_picked",
  };
}
