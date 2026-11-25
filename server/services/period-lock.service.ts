import { isPeriodLocked } from "./month-end.service";
import { AppError } from "../middleware/errorHandler";
import { toAccountingDate, type AccountingDate } from "../../shared/accounting-date";

/**
 * Period lock guard for financial write paths.
 *
 * UAE FTA compliance: once a month-end is locked via month_end_close,
 * no journal entries (or any record that posts a JE) may be created or
 * updated with a date inside that closed period.
 *
 * Throws a 403 AppError if the date falls inside a locked period.
 *
 * @param companyId  UUID of the company.
 * @param date       The transaction/posting date being asserted.
 */
export async function assertPeriodNotLocked(
  companyId: string,
  date: Date | string | null | undefined,
  opts?: { storesBusinessDate?: boolean }
): Promise<AccountingDate | null> {
  if (!companyId) return null;
  if (!date) return null;

  // F06: lock lookup uses the accounting business date — date-only input is
  // preserved; instants are converted to Asia/Dubai first.
  const accounting = toAccountingDate(date);
  if (!accounting) return null;

  const candidates = [accounting.businessDate];
  // Callers that still persist the raw instant (rather than the normalised
  // business date) would have the entry read back by UTC date. Until every
  // caller stores the business date, also refuse if that UTC date is locked,
  // so a locked period can never be mutated under either reading.
  if (!opts?.storesBusinessDate) {
    const raw = date instanceof Date ? date : new Date(date);
    if (!isNaN(raw.getTime())) {
      const utcDate = raw.toISOString().slice(0, 10);
      if (utcDate !== accounting.businessDate) candidates.push(utcDate);
    }
  }

  for (const isoDate of candidates) {
    if (await isPeriodLocked(companyId, isoDate)) {
      const [year, month] = isoDate.split("-");
      throw new AppError(
        `Cannot post to locked period (${month}/${year}). Unlock the period first.`,
        403
      );
    }
  }
  return accounting;
}

/**
 * Pure predicate: is `date` after the end of (now + graceDays) in UTC?
 * Exposed for unit testing.
 */
export function isFutureDate(date: Date, now: Date, graceDays = 0): boolean {
  // F06: "today" is the accounting (Asia/Dubai) business date, which is never
  // earlier than the UTC date. Posting dates are stored as UTC midnight of the
  // business date, so between 00:00 and 04:00 Dubai today's date must not be
  // rejected as "future" just because UTC is still on the previous day.
  const today = toAccountingDate(now);
  const limit = today ? new Date(today.date) : new Date(now);
  limit.setUTCDate(limit.getUTCDate() + graceDays);
  limit.setUTCHours(23, 59, 59, 999);
  return date.getTime() > limit.getTime();
}

/**
 * A-4: Future-date guard for financial posting paths. UAE/IFRS practice is
 * that posted journal entries must not be dated in the future (back-dating to
 * an open period is allowed; forward-dating is not). Rejects a posting date
 * after the end of today (UTC) plus an optional grace window.
 *
 * Throws a 422 AppError when the date is in the future.
 */
export function assertNotFutureDate(
  date: Date | string | null | undefined,
  opts?: { graceDays?: number; now?: Date }
): void {
  if (!date) return;
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return;
  const now = opts?.now ?? new Date();
  if (isFutureDate(d, now, opts?.graceDays ?? 0)) {
    throw new AppError(
      `Cannot post an entry dated in the future (${d
        .toISOString()
        .slice(0, 10)}). Posting dates must be on or before today.`,
      422
    );
  }
}
