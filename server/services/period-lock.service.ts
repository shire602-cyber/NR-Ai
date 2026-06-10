import { isPeriodLocked } from './month-end.service';
import { AppError } from '../middleware/errorHandler';

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
): Promise<void> {
  if (!companyId) return;
  if (!date) return;

  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return;

  const isoDate = d.toISOString().slice(0, 10);

  const locked = await isPeriodLocked(companyId, isoDate);
  if (!locked) return;

  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const year = d.getUTCFullYear();

  throw new AppError(
    `Cannot post to locked period (${month}/${year}). Unlock the period first.`,
    403,
  );
}
