import { PLAN_MONTHLY_PRICES, type PaidPlanId } from "@shared/plans";
import { COMPARATORS, type CompetitorId } from "./competitor-prices";

/**
 * Savings model. Pure and deterministic; money is integer fils, hours are whole minutes.
 *
 * TODO(owner): confirm assumption values. These are Muhasib's own illustrative assumptions, shown
 * in the UI as assumptions (not measured results). Nothing here is a customer statistic.
 */
export const ASSUMPTIONS = {
  minutesPerInvoice: 4,
  minutesPerReceipt: 3,
  /** Hours saved can never exceed this share of the hours entered. */
  capShare: 0.6,
} as const;

export interface SliderSpec {
  min: number;
  max: number;
  step: number;
  default: number;
}

export const SLIDERS = {
  invoices: { min: 0, max: 500, step: 5, default: 40 },
  receipts: { min: 0, max: 500, step: 5, default: 60 },
  hours: { min: 0, max: 160, step: 1, default: 20 },
  rate: { min: 20, max: 500, step: 5, default: 120 },
} as const satisfies Record<string, SliderSpec>;

export const DEFAULT_COMPARATOR: CompetitorId = "wafeq";
export const DEFAULT_PLAN: PaidPlanId = "professional";

export interface SavingsInput {
  invoices: number;
  receipts: number;
  hours: number;
  rate: number;
  comparator: CompetitorId;
  plan: PaidPlanId;
}

export interface SavingsResult {
  rawMinutes: number;
  capMinutes: number;
  savedMinutes: number;
  hoursSaved: number;
  valueMonthFils: number;
  valueYearFils: number;
  software: {
    /** Annual list price of their software (AED), or null when there is no AED price. */
    theirsYearAed: number | null;
    oursYearAed: number;
    /** theirs - ours: positive = Muhasib cheaper, negative = Muhasib dearer; null without a price. */
    diffAed: number | null;
  };
}

function clampWhole(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

export function computeSavings(input: SavingsInput): SavingsResult {
  const invoices = clampWhole(input.invoices, 0, SLIDERS.invoices.max);
  const receipts = clampWhole(input.receipts, 0, SLIDERS.receipts.max);
  const hours = clampWhole(input.hours, 0, SLIDERS.hours.max);
  const rate = clampWhole(input.rate, 0, SLIDERS.rate.max);

  const rawMinutes =
    invoices * ASSUMPTIONS.minutesPerInvoice + receipts * ASSUMPTIONS.minutesPerReceipt;
  const capMinutes = Math.floor(hours * 60 * ASSUMPTIONS.capShare);
  const savedMinutes = Math.min(rawMinutes, capMinutes);
  // minutes x AED/hour x 100 fils / 60 minutes, rounded to whole fils.
  const valueMonthFils = Math.round((savedMinutes * rate * 100) / 60);

  const comparator = COMPARATORS.find((c) => c.id === input.comparator);
  const theirsYearAed =
    comparator && comparator.perMonth !== null ? comparator.perMonth * 12 : null;
  const oursYearAed = PLAN_MONTHLY_PRICES[input.plan] * 12;
  return {
    rawMinutes,
    capMinutes,
    savedMinutes,
    hoursSaved: savedMinutes / 60,
    valueMonthFils,
    valueYearFils: valueMonthFils * 12,
    software: {
      theirsYearAed,
      oursYearAed,
      diffAed: theirsYearAed === null ? null : theirsYearAed - oursYearAed,
    },
  };
}

/** "1,234" - whole AED with grouping and Western digits in every locale. */
export function formatAedWhole(fils: number): string {
  const aed = Math.round(fils / 100);
  const grouped = String(Math.abs(aed)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return aed < 0 ? `-${grouped}` : grouped;
}

export function formatAmount(aed: number): string {
  return formatAedWhole(aed * 100);
}

/** One decimal, Western digits, trailing ".0" dropped: 5.7, 12. */
export function formatHours(hours: number): string {
  const rounded = Math.round(hours * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}
