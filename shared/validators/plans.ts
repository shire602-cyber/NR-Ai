/**
 * WQ7 request bodies: plan assignment (NR admin), automation switches, onboarding progress and
 * document numbering settings.
 */
import { z } from "zod";
import { PAID_PLAN_IDS } from "../plans";

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

export const NUMBERED_DOC_TYPES = ["invoice", "credit_note", "debit_note", "quote"] as const;

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
