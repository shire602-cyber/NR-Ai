// F06 — one rule for turning a posting input into an accounting business date.
//
//  * A date-only string ("2026-12-01") is a business date: preserved as given.
//  * An instant (Date, or an ISO string with a time) is converted to the
//    calendar date in the company accounting time zone (UAE: Asia/Dubai,
//    UTC+4, no DST) before any period lookup.
//
// The normalised Date is UTC midnight of that business date, so storing it in
// a timestamp column and reading it back with UTC date functions yields the
// same business date the lock check used.

export const DEFAULT_ACCOUNTING_TIME_ZONE = "Asia/Dubai";

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

export interface AccountingDate {
  /** YYYY-MM-DD in the accounting time zone. */
  businessDate: string;
  /** UTC midnight of businessDate — the value to persist. */
  date: Date;
  /** True when the input was an instant that was converted. */
  convertedFromInstant: boolean;
}

function isValidYmd(y: number, m: number, d: number): boolean {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function toAccountingDate(
  input: Date | string | null | undefined,
  timeZone: string = DEFAULT_ACCOUNTING_TIME_ZONE
): AccountingDate | null {
  if (input === null || input === undefined || input === "") return null;
  if (typeof input === "string") {
    const m = DATE_ONLY.exec(input.trim());
    if (m) {
      const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
      if (!isValidYmd(y, mo, d)) return null;
      return {
        businessDate: input.trim(),
        date: new Date(Date.UTC(y, mo - 1, d)),
        convertedFromInstant: false,
      };
    }
  }
  const instant = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(instant.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const y = get("year");
  const mo = get("month");
  const d = get("day");
  return {
    businessDate: `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
    date: new Date(Date.UTC(y, mo - 1, d)),
    convertedFromInstant: true,
  };
}

/** Current business date in the accounting time zone (Asia/Dubai). */
export function todayDubai(timeZone: string = DEFAULT_ACCOUNTING_TIME_ZONE): string {
  return toAccountingDate(new Date(), timeZone)!.businessDate;
}
