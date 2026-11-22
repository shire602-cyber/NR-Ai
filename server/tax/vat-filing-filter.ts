import { and, inArray, isNotNull, ne, not, sql } from "drizzle-orm";
import { vatReturns } from "../../shared/schema";
import { VAT_RECORDED_STATUSES } from "../../shared/vat-filing-status";

export const vatFilingRecordedFilter = and(
  inArray(vatReturns.status, VAT_RECORDED_STATUSES),
  isNotNull(sql`NULLIF(BTRIM(${vatReturns.ftaReferenceNumber}), '')`)
)!;

/** Superseded returns are excluded even if the original draft had no filing evidence. */
export const activeVatReturnFilter = ne(vatReturns.status, "amended");

export const vatFilingOutstandingFilter = and(activeVatReturnFilter, not(vatFilingRecordedFilter))!;
