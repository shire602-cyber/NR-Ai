// Pure rules behind the month-end checklist (teardown 6): which VAT period a month belongs to, and whether a month
// can be closed before its VAT return is due. Kept apart from the SQL so it is unit tested.

export type VatFrequency = "monthly" | "quarterly" | "annually";

export function normaliseVatFrequency(value: string | null | undefined): VatFrequency {
  const v = (value ?? "").trim().toLowerCase();
  if (v === "monthly") return "monthly";
  if (v === "annually" || v === "annual" || v === "yearly") return "annually";
  return "quarterly";
}

const lengthOf = (f: VatFrequency): number => (f === "monthly" ? 1 : f === "annually" ? 12 : 3);

/**
 * Is `month` (1-12) the last month of its VAT period? A quarterly filer whose periods start in January closes
 * March, June, September and December; one whose periods start in February closes April, July, October and January.
 */
export function isLastMonthOfVatPeriod(
  frequency: VatFrequency,
  periodStartMonth: number,
  month: number
): boolean {
  const length = lengthOf(frequency);
  const start = Math.min(12, Math.max(1, Math.trunc(periodStartMonth) || 1));
  const offset = (((month - start) % 12) + 12) % 12;
  return offset % length === length - 1;
}

/** The VAT item of the checklist: a return covers the month, or the month is not yet the end of a quarterly/annual period. */
export function vatChecklistVerdict(input: {
  coveringReturns: number;
  frequency: VatFrequency;
  periodStartMonth: number;
  month: number;
}): { complete: boolean; reason: "covered" | "period_not_ended" | "missing" } {
  if (input.coveringReturns > 0) return { complete: true, reason: "covered" };
  if (!isLastMonthOfVatPeriod(input.frequency, input.periodStartMonth, input.month))
    return { complete: true, reason: "period_not_ended" };
  return { complete: false, reason: "missing" };
}
