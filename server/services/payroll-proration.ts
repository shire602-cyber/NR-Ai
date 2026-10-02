// Pro-rating of a joiner's or leaver's month. Pure: no database.
//
// Pay runs on the 30-day month the Labour Law uses (daily wage = wage / 30). A person who joins on day d of a month
// is paid for days d to 30 (join on the 15th = 16 days = 16/30 of the wage), a person who leaves before the last day
// of the month is paid from the 1st to that day (capped at 30), nobody is paid for a month that ended before they
// joined or that started after they left. A joiner on the 31st has no paid day in that month.

export type ProrationReason = "full" | "joined" | "left" | "not_yet_joined" | "already_left";

export interface Proration {
  /** Days paid on the 30-day basis, 0 to 30. */
  daysWorked: number;
  /** daysWorked / 30. */
  factor: number;
  reason: ProrationReason;
}

const lastDay = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();
const pad = (n: number) => String(n).padStart(2, "0");

export function prorateMonth(args: { joinYmd?: string | null; terminationYmd?: string | null; year: number; month: number }): Proration {
  const periodStart = `${args.year}-${pad(args.month)}-01`;
  const periodEnd = `${args.year}-${pad(args.month)}-${pad(lastDay(args.year, args.month))}`;
  const join = args.joinYmd ?? null;
  const left = args.terminationYmd ?? null;

  if (join && join > periodEnd) return { daysWorked: 0, factor: 0, reason: "not_yet_joined" };
  if (left && left < periodStart) return { daysWorked: 0, factor: 0, reason: "already_left" };

  const joined = !!join && join >= periodStart;
  const leftInPeriod = !!left && left <= periodEnd && left !== periodEnd;
  const startDay = joined ? Number(join!.slice(8, 10)) : 1;
  const endDay = leftInPeriod ? Math.min(30, Number(left!.slice(8, 10))) : 30;
  const daysWorked = Math.max(0, Math.min(30, endDay - startDay + 1));
  const reason: ProrationReason = daysWorked >= 30 ? "full" : joined && startDay > 1 ? "joined" : leftInPeriod ? "left" : "full";
  return { daysWorked, factor: daysWorked / 30, reason: daysWorked === 0 ? (joined ? "not_yet_joined" : "already_left") : reason };
}

/** A pay component for a part month, to the fils. */
export function prorate(amount: number, factor: number): number {
  return Math.round((amount * factor + Number.EPSILON) * 100) / 100;
}
