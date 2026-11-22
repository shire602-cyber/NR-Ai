import { and, inArray, isNotNull, sql } from "drizzle-orm";
import { vatReturns } from "../../shared/schema";
import { VAT_RECORDED_STATUSES } from "../../shared/vat-filing-status";

export const vatFilingRecordedFilter = and(
  inArray(vatReturns.status, VAT_RECORDED_STATUSES),
  isNotNull(sql`NULLIF(BTRIM(${vatReturns.ftaReferenceNumber}), '')`)
)!;
