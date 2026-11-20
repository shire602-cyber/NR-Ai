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
 * is_vat_account), a tax-document source the VAT engine reads (zero-rated and exempt invoices
 * post no VAT line but land in Box 4 / Box 5), or (B1: NH1) an entry the VAT engine reports from
 * its own record whatever its lines: a bank-line entry with a VAT treatment and a fixed-asset
 * disposal for consideration (`reportsVat` when posted; their match / register row when one of
 * them is reversed). An exempt bank-line receipt dated in a filed quarter would otherwise move
 * Box 5, and with partial exemption the recovery ratio, after the return was declared.
 *
 * Settlements of a filed return (B1: NL1) are not part of any period's boxes (the engine skips
 * them), so they and their reversals are never refused although they touch 2020 / 1050.
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
  "customer_deposit",
]);

/**
 * Sources whose reversal the VAT engine reports on the reversal's own date, not by un-reporting
 * the original: a bad-debt relief recovered after payment (Art. 64(3)) is an output adjustment in
 * the period the payment is received. Reversing one whose claim sits in a filed period leaves that
 * return unchanged, so only the reversal's own date is checked.
 */
export const REVERSAL_REPORTED_ON_OWN_DATE: ReadonlySet<string> = new Set(["vat_bad_debt_relief"]);

/**
 * NL1 (B1 + B2): sources that touch the VAT control accounts but are not VAT transactions of any
 * period: the payment / refund of a return (and its reversal) clears 2020 / 1050 and changes no
 * box (the VAT engine leaves it out), so no filed period is affected by it.
 */
export const VAT_LOCK_EXEMPT_SOURCES: ReadonlySet<string> = new Set(["vat_return_settlement"]);

/**
 * B1 (NH1): an entry the VAT engine reports from its own record (bank-line VAT treatment, a
 * fixed-asset disposal for consideration), checked when the entry is reversed or voided.
 */
async function reportedByVatEngine(
  tx: LedgerTx,
  companyId: string,
  entryId: string
): Promise<boolean> {
  const res = await tx.execute(sql`
    SELECT 1 FROM bank_transaction_matches
     WHERE company_id = ${companyId} AND journal_entry_id = ${entryId}
       AND vat_treatment IS NOT NULL
    UNION ALL
    SELECT 1 FROM fixed_assets
     WHERE company_id = ${companyId} AND disposal_entry_id = ${entryId}
       AND disposal_invoice_id IS NULL
       AND disposal_vat_treatment IS NOT NULL AND disposal_vat_treatment <> 'out_of_scope'
       AND COALESCE(disposal_amount, 0) <> 0
    UNION ALL
    SELECT 1 FROM journal_lines jl
     JOIN journal_entries je ON je.id = jl.entry_id
     WHERE je.company_id = ${companyId} AND je.id = ${entryId} AND jl.vat_treatment IS NOT NULL
    LIMIT 1
  `);
  return rowsOf(res).length > 0;
}

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

/**
 * Return mutations take the exclusive lock for the company. Journal writes take the shared
 * lock, so checking for a filed period and posting cannot straddle a filing commit.
 * One company lock also covers settlements on the same amendment chain.
 */
export async function lockVatReturns(
  tx: LedgerTx,
  companyId: string,
  mode: "shared" | "exclusive" = "exclusive"
): Promise<void> {
  const key = sql`hashtextextended('vat-returns:' || ${companyId}::uuid::text, 0)`;
  await tx.execute(
    mode === "shared"
      ? sql`SELECT pg_advisory_xact_lock_shared(${key})`
      : sql`SELECT pg_advisory_xact_lock(${key})`
  );
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
 * undoes an entry dated in) a submitted / filed VAT period. The caller holds the VAT return lock.
 */
export async function assertVatPeriodOpen(
  tx: LedgerTx,
  input: {
    companyId: string;
    dateIso: string;
    source: string | null;
    accountIds: string[];
    reversedEntryId?: string | null;
    /** The VAT engine reports this entry from its own record (see PostJournalInput). */
    reportsVat?: boolean;
    /** A draft being posted: reported by the engine when its bank match carries a treatment. */
    entryId?: string | null;
  }
): Promise<void> {
  if (VAT_LOCK_EXEMPT_SOURCES.has(input.source ?? "")) return;
  const dates = [input.dateIso];
  let originalSource: string | null = null;
  if (input.reversedEntryId) {
    const res = await tx.execute(sql`
      SELECT date::date::text AS d, source FROM journal_entries
       WHERE id = ${input.reversedEntryId} AND company_id = ${input.companyId}
    `);
    const original = rowsOf<Record<string, string | null>>(res)[0];
    if (VAT_LOCK_EXEMPT_SOURCES.has(original?.source ?? "")) return;
    if (original?.d && !REVERSAL_REPORTED_ON_OWN_DATE.has(original.source ?? "")) {
      originalSource = original.source;
      dates.push(original.d);
    }
  }
  for (const date of new Set(dates)) {
    const period = await findFiledVatPeriod(tx, input.companyId, date);
    if (!period) continue;
    const affectsVat =
      VAT_DOCUMENT_SOURCES.has(input.source ?? "") ||
      VAT_DOCUMENT_SOURCES.has(originalSource ?? "") ||
      input.reportsVat === true ||
      (await touchesVatAccount(tx, input.companyId, input.accountIds)) ||
      (!!input.reversedEntryId &&
        (await reportedByVatEngine(tx, input.companyId, input.reversedEntryId))) ||
      (!!input.entryId && (await reportedByVatEngine(tx, input.companyId, input.entryId)));
    if (affectsVat) throw vatPeriodFiledError(period, date);
    return;
  }
}
