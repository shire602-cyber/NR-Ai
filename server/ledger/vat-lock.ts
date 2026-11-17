/**
 * A1 (C1): a submitted or filed VAT return closes its period for VAT-affecting postings.
 *
 * The VAT 201 is computed from the documents and journals dated in the period, so a document
 * back-dated into a filed period would silently change a return that has already been declared
 * (FDL 8/2017 Art. 78 records must agree with the return). The kernel therefore refuses, with
 * 409 VAT_PERIOD_FILED, to post, reverse or void an entry that affects VAT when the entry (or,
 * for a reversal, the entry it undoes) is dated inside such a period. The refusal names the
 * correct path (Executive Regulation Art. 70):
 *   - date the document in the current open period: a net error up to AED 10,000 is corrected
 *     in the return for the period in which it is found;
 *   - above AED 10,000, open a voluntary disclosure first (POST /api/vat-returns/:id/amend).
 *     The amendment draft supersedes the filed return, which re-opens the period until the
 *     amended return is submitted.
 *
 * "Affects VAT": a line on a VAT control account (1050 / 2020 or any account flagged
 * is_vat_account), or a tax-document source the VAT engine reads (zero-rated and exempt invoices
 * post no VAT line but land in Box 4 / Box 5).
 */
import { sql } from "drizzle-orm";
import { DomainError } from "../errors";
import { rowsOf } from "./tx";
import type { LedgerTx } from "./types";

/** Journal sources whose documents the VAT engine reports, whatever their lines. */
export const VAT_DOCUMENT_SOURCES: ReadonlySet<string> = new Set([
  "invoice",
  "bill",
  "bill_reversal",
  "vendor_debit_note",
  "receipt",
  "vat_bad_debt_relief",
  "vat_partial_exemption",
]);

/**
 * Sources whose reversal the VAT engine reports on the reversal's own date, not by un-reporting
 * the original: a bad-debt relief recovered after payment (Art. 64(3)) is an output adjustment in
 * the period the payment is received. Reversing one whose claim sits in a filed period leaves that
 * return unchanged, so only the reversal's own date is checked.
 */
export const REVERSAL_REPORTED_ON_OWN_DATE: ReadonlySet<string> = new Set(["vat_bad_debt_relief"]);

/** Return statuses that close the period (an "amended" return is superseded by its draft). */
export const VAT_LOCKING_STATUSES = ["submitted", "filed"] as const;

/** Voluntary disclosure threshold (Exec. Reg. Art. 70): net tax difference in AED. */
export const VOLUNTARY_DISCLOSURE_THRESHOLD_AED = 10_000;

export interface FiledVatPeriod {
  vatReturnId: string;
  status: string;
  periodStart: string;
  periodEnd: string;
}

function nextDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** The submitted / filed VAT return whose period covers `isoDate`, or null. */
export async function findFiledVatPeriod(
  tx: LedgerTx,
  companyId: string,
  isoDate: string
): Promise<FiledVatPeriod | null> {
  const res = await tx.execute(sql`
    SELECT id, status, period_start::date::text AS ps, period_end::date::text AS pe
      FROM vat_returns
     WHERE company_id = ${companyId}
       AND status IN ('submitted', 'filed')
       AND ${isoDate}::date >= period_start::date
       AND ${isoDate}::date <= period_end::date
     ORDER BY period_end DESC
     LIMIT 1
  `);
  const r = rowsOf<Record<string, string>>(res)[0];
  if (!r) return null;
  return { vatReturnId: r.id, status: r.status, periodStart: r.ps, periodEnd: r.pe };
}

async function touchesVatAccount(
  tx: LedgerTx,
  companyId: string,
  accountIds: string[]
): Promise<boolean> {
  const ids = [...new Set(accountIds)].filter(Boolean);
  if (ids.length === 0) return false;
  const res = await tx.execute(sql`
    SELECT 1 FROM accounts
     WHERE company_id = ${companyId}
       AND id IN (${sql.join(
         ids.map((id) => sql`${id}::uuid`),
         sql`, `
       )})
       AND ((is_vat_account = true AND vat_type IN ('input', 'output')) OR code IN ('1050', '2020'))
     LIMIT 1
  `);
  return rowsOf(res).length > 0;
}

/** The 409 refusal, with the correction paths the user can take. */
export function vatPeriodFiledError(period: FiledVatPeriod, postingDate: string): DomainError {
  const nextOpen = nextDay(period.periodEnd);
  return new DomainError(
    "VAT_PERIOD_FILED",
    409,
    {
      vatReturnId: period.vatReturnId,
      returnStatus: period.status,
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      postingDate,
      nextOpenPeriodStart: nextOpen,
      correctionPaths: [
        {
          kind: "next_return_correction",
          dateOnOrAfter: nextOpen,
          maxNetTaxAed: VOLUNTARY_DISCLOSURE_THRESHOLD_AED,
          basis: "Executive Regulation Art. 70",
        },
        {
          kind: "voluntary_disclosure",
          endpoint: `/api/vat-returns/${period.vatReturnId}/amend`,
          aboveNetTaxAed: VOLUNTARY_DISCLOSURE_THRESHOLD_AED,
          basis: "Executive Regulation Art. 70; FTA Form 211",
        },
      ],
    },
    `The VAT return for ${period.periodStart} to ${period.periodEnd} has been ${period.status}, so this VAT period is closed. ` +
      `Date the document on or after ${nextOpen}: a net tax difference of up to AED 10,000 is corrected in that period's return (Executive Regulation Art. 70). ` +
      `Above AED 10,000, open a voluntary disclosure (amend the filed return) first; the period re-opens until the amended return is submitted.`
  );
}

/**
 * Throw 409 VAT_PERIOD_FILED when a posted entry affecting VAT is dated in (or, for a reversal,
 * undoes an entry dated in) a submitted / filed VAT period. Cheap when no return covers the
 * dates: one indexed lookup per date.
 */
export async function assertVatPeriodOpen(
  tx: LedgerTx,
  input: {
    companyId: string;
    dateIso: string;
    source: string | null;
    accountIds: string[];
    reversedEntryId?: string | null;
  }
): Promise<void> {
  const candidates: Array<{ date: string; source: string | null }> = [
    { date: input.dateIso, source: input.source },
  ];
  let originalSource: string | null = null;
  if (input.reversedEntryId) {
    const res = await tx.execute(sql`
      SELECT date::date::text AS d, source FROM journal_entries
       WHERE id = ${input.reversedEntryId} AND company_id = ${input.companyId}
    `);
    const o = rowsOf<Record<string, string | null>>(res)[0];
    if (o?.d && !REVERSAL_REPORTED_ON_OWN_DATE.has(o.source ?? "")) {
      originalSource = o.source ?? null;
      candidates.push({ date: o.d, source: originalSource });
    }
  }
  for (const c of candidates) {
    const period = await findFiledVatPeriod(tx, input.companyId, c.date);
    if (!period) continue;
    const docSource =
      VAT_DOCUMENT_SOURCES.has(input.source ?? "") ||
      VAT_DOCUMENT_SOURCES.has(originalSource ?? "");
    if (docSource || (await touchesVatAccount(tx, input.companyId, input.accountIds))) {
      throw vatPeriodFiledError(period, c.date);
    }
    return;
  }
}
