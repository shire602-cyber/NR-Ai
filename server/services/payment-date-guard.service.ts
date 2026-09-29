import { AppError } from "../middleware/errorHandler";
import { assertPeriodNotLocked } from "./period-lock.service";
import { resolvePaymentDate, type ResolvePaymentDateInput } from "./payment-date.service";

/**
 * Route-facing wrapper around resolvePaymentDate: validates the payment date
 * (future / malformed) and then refuses to post into a
 * locked period. Returns the Date the journal entry must be posted on (and its UAE calendar
 * day as YYYY-MM-DD, for raw-SQL columns).
 */
export async function resolveSettlementDate(
  companyId: string,
  input: ResolvePaymentDateInput
): Promise<{ date: Date; ymd: string }> {
  const result = resolvePaymentDate(input);
  if (!result.ok) throw new AppError({ message: result.message, statusCode: result.status, code: result.code });
  await assertPeriodNotLocked(companyId, result.date);
  return { date: result.date, ymd: result.ymd };
}
