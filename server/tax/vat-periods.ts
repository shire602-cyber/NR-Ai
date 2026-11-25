/**
 * VAT return period rules (W4-E, R07-07). A return covers exactly one tax period of the
 * company's stagger: a calendar month (monthly filers) or a three-month quarter anchored on the
 * company's `vat_period_start_month` (quarterly filers). Any other range is 422. The return is
 * due 28 days after the period end.
 */
import { DomainError } from "../errors";

export type VatFrequency = "monthly" | "quarterly";

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseIsoDate(value: unknown, field: string): string {
  const s =
    typeof value === "string"
      ? value.slice(0, 10)
      : value instanceof Date
        ? value.toISOString().slice(0, 10)
        : "";
  const m = ISO.exec(s);
  if (!m) {
    throw new DomainError("INVALID_PERIOD", 422, { field }, `${field} must be a date (YYYY-MM-DD)`);
  }
  const d = new Date(`${s}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) {
    throw new DomainError("INVALID_PERIOD", 422, { field }, `${field} is not a real calendar date`);
  }
  return s;
}

export function lastDayOfMonth(year: number, month1: number): string {
  const d = new Date(Date.UTC(year, month1, 0));
  return d.toISOString().slice(0, 10);
}

export function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** FTA deadline: 28 days after the period end. */
export function vatDueDate(periodEnd: string): string {
  return addDaysIso(periodEnd, 28);
}

export function frequencyOf(value: string | null | undefined): VatFrequency {
  return String(value || "").toLowerCase() === "monthly" ? "monthly" : "quarterly";
}

/** The aligned period containing `date` for the stagger. */
export function periodContaining(
  date: string,
  frequency: VatFrequency,
  startMonth: number
): { from: string; to: string } {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  if (frequency === "monthly") {
    return { from: `${date.slice(0, 7)}-01`, to: lastDayOfMonth(y, m) };
  }
  const anchor = ((((startMonth || 1) - 1) % 12) + 12) % 12; // 0-based
  const since = (((m - 1 - anchor) % 12) + 12) % 12;
  const qStart0 = (anchor + Math.floor(since / 3) * 3) % 12;
  const year = qStart0 > m - 1 ? y - 1 : y;
  const from = `${year}-${String(qStart0 + 1).padStart(2, "0")}-01`;
  const endMonthAbs = qStart0 + 3; // 1..14 relative to `year`
  const endYear = year + Math.floor((endMonthAbs - 1) / 12);
  const endMonth = ((endMonthAbs - 1) % 12) + 1;
  return { from, to: lastDayOfMonth(endYear, endMonth) };
}

/**
 * Validate that [from, to] is exactly one tax period of the stagger. Returns the normalised
 * period with its due date; throws 422 PERIOD_NOT_ALIGNED otherwise.
 */
export function assertAlignedPeriod(input: {
  from: unknown;
  to: unknown;
  frequency: VatFrequency;
  startMonth: number;
}): { from: string; to: string; dueDate: string; frequency: VatFrequency } {
  const from = parseIsoDate(input.from, "periodStart");
  const to = parseIsoDate(input.to, "periodEnd");
  if (from > to) {
    throw new DomainError(
      "INVALID_PERIOD",
      422,
      { from, to },
      "periodStart must be on or before periodEnd"
    );
  }
  const expected = periodContaining(from, input.frequency, input.startMonth);
  if (expected.from !== from || expected.to !== to) {
    throw new DomainError(
      "PERIOD_NOT_ALIGNED",
      422,
      { from, to, frequency: input.frequency, expected },
      `A ${input.frequency} VAT return must cover ${expected.from} to ${expected.to} ` +
        `(the tax period of your stagger), not ${from} to ${to}.`
    );
  }
  return { from, to, dueDate: vatDueDate(to), frequency: input.frequency };
}
