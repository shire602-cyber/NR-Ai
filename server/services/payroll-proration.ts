// Pro-rating of a joiner's or leaver's month. Pure: no database.
//
// Days are counted inclusively on the calendar: joining on the 15th of a 31-day month means working the 15th to the 31st,
// 17 days. Pay is days / 30 of the monthly wage (daily wage = wage / 30, the Labour Law's month), at most a full
// month: 31 calendar days, or 30 of 31, is a full month. A 28-day February is its own month (a joiner of 15 Feb works 14
// of 28 days). A leaver is paid from the 1st to the last day worked; a leaver on the last day of the month is a full
// month. Nobody is paid for a month that ended before they joined or that started after they left.

export type ProrationReason = "full" | "joined" | "left" | "not_yet_joined" | "already_left";

export interface Proration {
  /** Calendar days from the start to the end of employment in the month, inclusive (what the SIF row reports). */
  daysWorked: number;
  /** Days in the month. */
  daysInMonth: number;
  /** The month's pay basis in days: 30, or fewer for a short February. */
  basis: number;
  /** Share of the monthly wage paid, 0 to 1. */
  factor: number;
  /** True when employment covers only part of the month (daysWorked < daysInMonth). */
  partial: boolean;
  reason: ProrationReason;
}

const lastDay = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();
const pad = (n: number) => String(n).padStart(2, "0");

export function prorateMonth(args: { joinYmd?: string | null; terminationYmd?: string | null; year: number; month: number }): Proration {
  const daysInMonth = lastDay(args.year, args.month);
  const basis = Math.min(30, daysInMonth);
  const periodStart = `${args.year}-${pad(args.month)}-01`;
  const periodEnd = `${args.year}-${pad(args.month)}-${pad(daysInMonth)}`;
  const join = args.joinYmd ?? null;
  const left = args.terminationYmd ?? null;
  const none = (reason: ProrationReason): Proration => ({ daysWorked: 0, daysInMonth, basis, factor: 0, partial: true, reason });

  if (join && join > periodEnd) return none("not_yet_joined");
  if (left && left < periodStart) return none("already_left");

  const joined = !!join && join > periodStart;
  const leftInPeriod = !!left && left < periodEnd;
  const startDay = joined ? Number(join!.slice(8, 10)) : 1;
  const endDay = leftInPeriod ? Number(left!.slice(8, 10)) : daysInMonth;
  const daysWorked = Math.max(0, endDay - startDay + 1);
  if (daysWorked === 0) return none(joined ? "not_yet_joined" : "already_left");
  const partial = daysWorked < daysInMonth;
  const reason: ProrationReason = !partial ? "full" : joined ? "joined" : "left";
  return { daysWorked, daysInMonth, basis, factor: Math.min(1, daysWorked / basis), partial, reason };
}

const r2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;

/** A pay component for a part month, to the fils. */
export function prorate(amount: number, factor: number): number {
  return r2(amount * factor);
}

/**
 * The components of a part month rounded ONCE as a line: the total is the wage x factor to 2 dp, each component is
 * its own rounded share, and any fils the rounding left over go to the basic salary, so the parts add up to the total
 * exactly (no 0.01 conjured by rounding five components separately).
 */
export function prorateComponents<T extends Record<string, number>>(components: T, factor: number): T {
  const entries = Object.entries(components) as Array<[keyof T, number]>;
  const total = r2(entries.reduce((s, [, v]) => s + v, 0) * factor);
  const out: Record<string, number> = {};
  for (const [k, v] of entries) out[k as string] = r2(v * factor);
  const sum = r2(Object.values(out).reduce((s, v) => s + v, 0));
  const first = entries[0]?.[0] as string | undefined;
  if (first !== undefined && sum !== total) out[first] = r2(out[first] + (total - sum));
  return out as T;
}
