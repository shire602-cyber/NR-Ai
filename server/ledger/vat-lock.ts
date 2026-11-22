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
import type { JournalLineVatTreatment } from "../../shared/journal-line-treatments";
import { uaeToday } from "../../shared/uae-date";
import { DomainError } from "../errors";
import { ENTRY_LOCAL_DATE_SQL } from "../reporting/ledger-query";
import { rowsOf } from "./tx";
import type { LedgerTx } from "./types";
import {
  resolveFilingVatGroup,
  UNVERIFIED_VAT_GROUP,
  vatGroupVerificationRequiredError,
} from "./vat-group-scope";

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

const VAT201_JOURNAL_TREATMENTS: readonly JournalLineVatTreatment[] = [
  "standard",
  "zero_rated",
  "exempt",
];

export function isVat201JournalTreatment(
  treatment: JournalLineVatTreatment | null | undefined
): boolean {
  return treatment != null && VAT201_JOURNAL_TREATMENTS.includes(treatment);
}

/**
 * B1 (NH1): an entry the VAT engine reports from its own record (bank-line VAT treatment, a
 * fixed-asset disposal for consideration, or treated manual journal), checked when the entry
 * is posted from a draft, reversed or voided.
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
     WHERE je.company_id = ${companyId} AND je.id = ${entryId}
       AND jl.vat_treatment IN (${sql.join(
         VAT201_JOURNAL_TREATMENTS.map((treatment) => sql`${treatment}`),
         sql`, `
       )})
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

type VatPeriodClosure = FiledVatPeriod | typeof UNVERIFIED_VAT_GROUP;

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

/** Lock the companies in the same order for group filing and group membership edits. */
export async function lockVatReturnCompanies(tx: LedgerTx, companyIds: string[]): Promise<void> {
  for (const id of [...new Set(companyIds.map((id) => id.toLowerCase()))].sort()) {
    await lockVatReturns(tx, id);
  }
}

/** Serialize a representative's filing scope selection and membership changes before locking companies. */
export async function lockVatGroupMembership(
  tx: LedgerTx,
  representativeId: string
): Promise<void> {
  const key = sql`hashtextextended('vat-group-membership:' || ${representativeId}::uuid::text, 0)`;
  await tx.execute(sql`SELECT pg_advisory_xact_lock(${key})`);
}

/** Find the submitted or filed company or group return that overlaps the given dates. */
export async function findFiledVatPeriod(
  tx: LedgerTx,
  companyId: string,
  from: string,
  to = from,
  excludingReturnId?: string
): Promise<VatPeriodClosure | null> {
  const memberId = companyId.toLowerCase();
  const withMember = sql`jsonb_build_array(${memberId}::text, g.representative_company_id::text)`;
  const auditMembers = sql`jsonb_build_array(${memberId}::text, a.company_id::text)`;
  // Find evidence linking this company to a group before resolving any of its filings.
  // Dated snapshot evidence includes amended ancestors, which keep the original period.
  const res = await tx.execute(sql`
    WITH own_return AS (
      SELECT * FROM vat_returns
       WHERE company_id = ${companyId}
         AND (${excludingReturnId ?? null}::uuid IS NULL OR id <> ${excludingReturnId ?? null}::uuid)
         AND status IN ('submitted', 'filed')
         AND period_end >= ${from}::date
         AND period_start < ${to}::date + interval '1 day'
       ORDER BY period_end DESC LIMIT 1
    ),
    linked_audits AS MATERIALIZED (
      SELECT a.company_id, a.resource_id,
             min(a.created_at) FILTER (WHERE CASE WHEN pg_input_is_valid(a.details, 'jsonb')
                          THEN (a.details::jsonb #>> '{after,memberAuthority}') = 'settings.company'
                            AND lower((a.details::jsonb #> '{after,members}')::text)::jsonb @> ${auditMembers}
                          ELSE false END) AS authorized_since
        FROM audit_logs a
       WHERE a.resource_type = 'vat_group'
         AND a.action = 'vat.group.upsert'
         -- Match the release GIN expression and verify exact JSON membership below.
         AND CASE WHEN octet_length(a.details) <= 2048
                  THEN string_to_array(lower(a.details), '"')
                  ELSE regexp_split_to_array(lower(a.details), '"|[^"]{37,}')
             END @> ARRAY[${memberId}::text]
         AND CASE WHEN pg_input_is_valid(a.details, 'jsonb')
                  THEN lower((a.details::jsonb #> '{before,members}')::text)::jsonb @> ${auditMembers}
                    OR lower((a.details::jsonb #> '{after,members}')::text)::jsonb @> ${auditMembers}
                  ELSE false END
       GROUP BY a.company_id, a.resource_id
    ),
    linked_groups AS MATERIALIZED (
      SELECT g.id, g.representative_company_id, a.authorized_since
        FROM vat_groups g
        LEFT JOIN linked_audits a ON a.company_id = g.representative_company_id AND a.resource_id = g.id::text
       WHERE NOT EXISTS (SELECT 1 FROM own_return)
         AND g.representative_company_id <> ${companyId}
         AND (
           EXISTS (
             SELECT 1 FROM vat_group_members m
              WHERE m.company_id = ${companyId} AND m.group_id = g.id
           )
           OR EXISTS (
             SELECT 1 FROM vat_returns h
              WHERE h.company_id = g.representative_company_id
                AND h.status IN ('submitted', 'filed', 'amended')
                AND h.period_end >= ${from}::date
                AND h.period_start < ${to}::date + interval '1 day'
                AND lower(h.reconciliation_snapshot #>> '{filingVatGroup,groupId}') = g.id::text
                AND lower((h.reconciliation_snapshot #> '{filingVatGroup,memberIds}')::text)::jsonb
                    @> ${withMember}
           )
           OR a.resource_id IS NOT NULL
         )
    )
    SELECT id, status, company_id AS "companyId", amends_return_id AS "amendsReturnId",
           vat_group_id AS "vatGroupId",
           authorized_member AS "authorizedMember",
           jsonb_build_object('filingVatGroup', reconciliation_snapshot -> 'filingVatGroup') AS "reconciliationSnapshot",
           period_start::date::text AS ps, period_end::date::text AS pe
      FROM (
        SELECT id, status, company_id, amends_return_id, vat_group_id, reconciliation_snapshot,
               period_start, period_end, false AS authorized_member
          FROM own_return
        UNION ALL
        SELECT r.id, r.status, r.company_id, r.amends_return_id, r.vat_group_id,
               r.reconciliation_snapshot, r.period_start, r.period_end,
               COALESCE(g.authorized_since <= r.created_at, false)
          FROM linked_groups g
          CROSS JOIN LATERAL (
            SELECT * FROM vat_returns r
             WHERE r.company_id = g.representative_company_id
               AND (${excludingReturnId ?? null}::uuid IS NULL OR r.id <> ${excludingReturnId ?? null}::uuid)
               AND (r.vat_group_id = g.id OR (r.vat_group_id IS NULL AND r.amends_return_id IS NOT NULL))
               AND r.status IN ('submitted', 'filed')
               AND r.period_end >= ${from}::date
               AND r.period_start < ${to}::date + interval '1 day'
             OFFSET 0
          ) r
      ) candidate
     ORDER BY period_end DESC
  `);
  const candidates = rowsOf<{
    id: string;
    status: string;
    companyId: string;
    amendsReturnId: string | null;
    vatGroupId: string | null;
    authorizedMember: boolean;
    reconciliationSnapshot: unknown;
    ps: string;
    pe: string;
  }>(res);
  let unresolved = false;
  for (const r of candidates) {
    const ownReturn = r.companyId === memberId;
    const group = await resolveFilingVatGroup(tx, r, null);
    if (group === UNVERIFIED_VAT_GROUP) {
      unresolved ||= ownReturn || r.authorizedMember;
      continue;
    }
    if (
      ownReturn ||
      (group?.memberAuthority === "settings.company" && group.memberIds.includes(memberId))
    ) {
      return {
        vatReturnId: r.id,
        status: r.status,
        periodStart: r.ps,
        periodEnd: r.pe,
      };
    }
  }
  // These candidates already have a membership link. An unresolved candidate requires
  // verification, while a verified snapshot decides membership by itself.
  return unresolved ? UNVERIFIED_VAT_GROUP : null;
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
export function vatPeriodFiledError(period: VatPeriodClosure, postingDate: string): DomainError {
  if (period === UNVERIFIED_VAT_GROUP) return vatGroupVerificationRequiredError();
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
 * Throw 409 VAT_PERIOD_FILED when a posted entry affecting VAT falls in (or, for a reversal,
 * undoes an entry in) a submitted / filed UAE reporting period. The caller holds the VAT return lock.
 */
export async function assertVatPeriodOpen(
  tx: LedgerTx,
  input: {
    companyId: string;
    date: Date;
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
  const dates = [uaeToday(input.date)];
  let originalSource: string | null = null;
  if (input.reversedEntryId) {
    const res = await tx.execute(sql`
      SELECT ${sql.raw(ENTRY_LOCAL_DATE_SQL)}::text AS d, je.source FROM journal_entries je
       WHERE je.id = ${input.reversedEntryId} AND je.company_id = ${input.companyId}
    `);
    const original = rowsOf<Record<string, string | null>>(res)[0];
    if (VAT_LOCK_EXEMPT_SOURCES.has(original?.source ?? "")) return;
    if (original?.d && !REVERSAL_REPORTED_ON_OWN_DATE.has(original.source ?? "")) {
      originalSource = original.source;
      dates.push(original.d);
    }
  }
  const affectsVat =
    VAT_DOCUMENT_SOURCES.has(input.source ?? "") ||
    VAT_DOCUMENT_SOURCES.has(originalSource ?? "") ||
    input.reportsVat === true ||
    (await touchesVatAccount(tx, input.companyId, input.accountIds)) ||
    (!!input.reversedEntryId &&
      (await reportedByVatEngine(tx, input.companyId, input.reversedEntryId))) ||
    (!!input.entryId && (await reportedByVatEngine(tx, input.companyId, input.entryId)));
  if (!affectsVat) return;
  for (const date of new Set(dates)) {
    const period = await findFiledVatPeriod(tx, input.companyId, date);
    if (period) throw vatPeriodFiledError(period, date);
  }
}
