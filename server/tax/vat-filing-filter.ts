import { and, desc, inArray, isNotNull, not, sql } from "drizzle-orm";
import { vatReturns } from "../../shared/schema";
import { VAT_RECORDED_STATUSES } from "../../shared/vat-filing-status";

export const vatFilingRecordedFilter = and(
  inArray(vatReturns.status, VAT_RECORDED_STATUSES),
  isNotNull(sql`NULLIF(BTRIM(${vatReturns.ftaReferenceNumber}), '')`)
)!;

const periodMatches = sql`related.company_id = ${vatReturns.companyId}
  AND related.period_start::date = ${vatReturns.periodStart}::date
  AND related.period_end::date = ${vatReturns.periodEnd}::date`;

/** A predecessor recorded as amended still represents the filing while its amendment is open. */
export const effectiveVatFilingStatus = sql<string>`CASE
  WHEN ${vatReturns.status} = 'amended'
    AND EXISTS (
      SELECT 1 FROM vat_returns related
      WHERE related.amends_return_id = vat_returns.id AND ${periodMatches}
        AND related.status IN ('draft', 'pending_review', 'ready')
    )
    AND NOT EXISTS (
      SELECT 1 FROM vat_returns related
      WHERE related.amends_return_id = vat_returns.id AND ${periodMatches}
        AND related.status IN ('submitted', 'filed', 'paid', 'accepted', 'amended')
    )
  THEN CASE WHEN NULLIF(BTRIM(${vatReturns.ftaReferenceNumber}), '') IS NULL
    THEN 'submitted' ELSE 'filed' END
  ELSE ${vatReturns.status}
END`;

/** An open amendment is still editable, while its predecessor represents the filing. */
export const activeVatReturnFilter = sql`${effectiveVatFilingStatus} <> 'amended'
  AND NOT (
    ${vatReturns.status} IN ('draft', 'pending_review', 'ready')
    AND EXISTS (
      SELECT 1 FROM vat_returns related
      WHERE related.id = ${vatReturns.amendsReturnId} AND ${periodMatches}
        AND related.status IN ('submitted', 'filed', 'paid', 'accepted', 'amended')
    )
  )`;

export const vatFilingVersionOrder = [
  desc(sql`(${effectiveVatFilingStatus} IN ('submitted', 'filed', 'paid', 'accepted'))`),
  desc(vatReturns.createdAt),
  desc(vatReturns.id),
] as const;

export const vatFilingOutstandingFilter = and(activeVatReturnFilter, not(vatFilingRecordedFilter))!;
