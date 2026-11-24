/**
 * E1 (J1-r2): the one rule for "does this VAT period belong to this company's books".
 *
 * A periodic return applies from the later of (a) the first day the books cover and (b) the VAT
 * registration effective date. A period applies when it ends on or after that date (the period
 * that contains the start date is the first one). The dashboard / compliance calendar and the
 * VAT Periods tab both read this, so a brand-new company never shows quarters from before it
 * existed as Overdue while the dashboard says On track.
 */
import { pool } from "../db";
import { uaeToday, type IsoDate } from "./corporate-tax/deadlines";

/**
 * X5 (J1 D4): the first date from which a periodic return applies: the later of the books
 * start and any registration / incorporation date.
 */
export function obligationsApplyFrom(
  booksStart: IsoDate,
  ...dates: Array<IsoDate | null | undefined>
): IsoDate {
  return dates.reduce<IsoDate>((m, d) => (d && d > m ? d : m), booksStart);
}

/** True when a period ending on `periodEnd` (YYYY-MM-DD) belongs to the books. */
export function periodApplies(periodEnd: IsoDate, applyFrom: IsoDate): boolean {
  return periodEnd >= applyFrom;
}

export { isVatFilingRecorded as isFiledReturnStatus } from "../../shared/vat-filing-status";

export interface VatApplicability {
  /** First day the books cover (earliest of creation, first posted journal, first invoice). */
  booksStart: IsoDate;
  /** VAT registration effective date, when recorded. */
  taxRegistrationDate: IsoDate | null;
  /** The date from which VAT periods apply. */
  applyFrom: IsoDate;
}

/** Load the books start and registration date for several companies in one query. */
export async function loadVatApplicability(
  companyIds: string[]
): Promise<Map<string, VatApplicability>> {
  const out = new Map<string, VatApplicability>();
  if (companyIds.length === 0) return out;
  const r = await pool.query(
    `SELECT c.id, c.created_at,
            ((c.tax_registration_date + interval '4 hours')::date)::text AS tax_registration_date,
            LEAST(
              ((c.created_at + interval '4 hours')::date),
              (SELECT MIN((je.date + interval '4 hours')::date) FROM journal_entries je
                WHERE je.company_id = c.id AND je.status = 'posted'),
              (SELECT MIN((i.date + interval '4 hours')::date) FROM invoices i
                WHERE i.company_id = c.id)
            )::text AS books_start
       FROM companies c WHERE c.id = ANY($1::uuid[])`,
    [companyIds]
  );
  for (const row of r.rows as Array<Record<string, string | Date | null>>) {
    const booksStart =
      (row.books_start as string | null) ?? uaeToday(new Date(row.created_at as Date));
    const taxRegistrationDate = (row.tax_registration_date as string | null) ?? null;
    out.set(String(row.id), {
      booksStart,
      taxRegistrationDate,
      applyFrom: obligationsApplyFrom(booksStart, taxRegistrationDate),
    });
  }
  return out;
}

export async function loadVatApplicabilityFor(companyId: string): Promise<VatApplicability | null> {
  return (await loadVatApplicability([companyId])).get(companyId) ?? null;
}
