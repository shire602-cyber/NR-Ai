import { isPeriodLocked } from "./month-end.service";
import { AppError } from "../middleware/errorHandler";

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
  date: Date | string | null | undefined
): Promise<void> {
  if (!companyId) return;
  if (!date) return;

  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return;

  const isoDate = d.toISOString().slice(0, 10);

  const locked = await isPeriodLocked(companyId, isoDate);
  if (!locked) return;

  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const year = d.getUTCFullYear();

  throw new AppError(
    `Cannot post to locked period (${month}/${year}). Unlock the period first.`,
    403
  );
}

/**
 * Pure predicate: is `date` after the end of (now + graceDays) in UTC?
 * Exposed for unit testing.
 */
export function isFutureDate(date: Date, now: Date, graceDays = 0): boolean {
  const limit = new Date(now);
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
