// The database half of vat-void-history.ts: the cutover of the date-based void rule, the filed
// returns of a company with the time each was recorded, and the set of voided documents that were
// NEVER DECLARED. The VAT return engines and the ledger reading of the filing gate both use
// `neverDeclaredVoidedInvoiceIds`, so the return and the ledger cannot disagree.

import { dubaiDaySql, dubaiDayTextSql } from "./vat-dubai-day";
import { sql } from "drizzle-orm";
import { db } from "../db";
import { periodYmd } from "./vat-period-status.service";
import { VOID_DATE_LATERAL_SQL } from "./vat-document-effect";
import { voidedDocumentNeverDeclared, type FiledVatReturnRecord } from "./vat-void-history";

type Executor = { execute: (query: any) => Promise<any> };
const rowsOf = (res: any): any[] => (res?.rows ?? res) as any[];

export const VAT_DATE_RULE_CUTOVER_KEY = "vat_date_based_voids_from";

let cachedCutoverMs: number | null = null;

/**
 * The moment the date-based void rule took effect on this installation (the time migration 0097
 * ran), read once and cached. A database without the key (created after this release, migration
 * not applied yet) has no old-rule filings: the cutover is then the epoch, so every filing counts
 * as a new-rule filing. The epoch is not cached, so a later migration is picked up.
 */
export async function getVatDateRuleCutover(ex: Executor = db as unknown as Executor): Promise<Date> {
  if (cachedCutoverMs !== null) return new Date(cachedCutoverMs);
  const res = await ex.execute(sql`SELECT value FROM system_settings WHERE key = ${VAT_DATE_RULE_CUTOVER_KEY}`);
  const parsed = Date.parse(String(rowsOf(res)[0]?.value ?? ""));
  if (!Number.isFinite(parsed)) return new Date(0);
  cachedCutoverMs = parsed;
  return new Date(parsed);
}

/** Test hook: forget the cached cutover. */
export function resetVatDateRuleCutoverCache(): void {
  cachedCutoverMs = null;
}

/**
 * Every FILED return of the company (originals, amendments, legacy) with the time it was recorded:
 *  - a filing recorded by the filing flow: tax_filings.created_at (the moment its figures froze);
 *  - a legacy return (snapshot.legacy, or no filing record yet): vat_returns.submitted_at, else
 *    updated_at, else created_at, as vat-legacy-filings.service.ts does. tax_filings.created_at of
 *    a legacy snapshot is the day it was first read, which says nothing about the return.
 * `submitted` and `accepted` count as well as `filed`: a return may have been filed on EmaraTax
 * without the reference ever being recorded here. When in doubt a void is NOT deducted, because
 * deducting a sale that was never declared claims tax back that was never paid.
 */
export async function loadFiledVatReturnRecords(ex: Executor, companyId: string): Promise<FiledVatReturnRecord[]> {
  const res = await ex.execute(sql`
    SELECT to_char(r.period_start, 'YYYY-MM-DD') AS period_start, to_char(r.period_end, 'YYYY-MM-DD') AS period_end,
           (extract(epoch from CASE
              WHEN f.id IS NOT NULL AND COALESCE((f.snapshot->>'legacy')::boolean, false) = false THEN f.created_at
              ELSE COALESCE(r.submitted_at, r.updated_at, r.created_at) END) * 1000)::float8 AS recorded_ms
      FROM vat_returns r
      LEFT JOIN tax_filings f ON f.kind = 'vat' AND f.return_id = r.id
     WHERE r.company_id = ${companyId} AND r.status IN ('filed', 'submitted', 'accepted')`);
  return rowsOf(res).map((r) => ({
    periodStart: String(r.period_start),
    periodEnd: String(r.period_end),
    recordedAtMs: r.recorded_ms === null || r.recorded_ms === undefined ? null : Number(r.recorded_ms),
  }));
}

export interface VoidedDocumentRef {
  id: string;
  /** Calendar day of the document. */
  date: string | Date;
  status: string;
  voidedOn?: string | Date | null;
  voidedAtMs?: number | null;
}

/** The ids among `docs` (void / cancelled, with a reversal entry) that were never declared. */
export async function neverDeclaredAmong(ex: Executor, companyId: string, docs: readonly VoidedDocumentRef[]): Promise<Set<string>> {
  const voided = docs.filter((d) => (d.status === "void" || d.status === "cancelled") && d.voidedOn);
  const out = new Set<string>();
  if (voided.length === 0) return out;
  const [filedReturns, cutover] = await Promise.all([loadFiledVatReturnRecords(ex, companyId), getVatDateRuleCutover(ex)]);
  for (const d of voided) {
    if (
      voidedDocumentNeverDeclared({
        documentDate: d.date,
        voidedOn: d.voidedOn as string | Date,
        voidedAtMs: d.voidedAtMs ?? null,
        filedReturns,
        cutoverMs: cutover.getTime(),
      })
    ) {
      out.add(d.id);
    }
  }
  return out;
}

/**
 * Ids of voided invoices / credit notes that were never declared and that touch [startYmd, endYmd]
 * (dated in it, or voided in it). The ledger reading of the filing gate leaves ALL entries of these
 * documents out, the same documents the return leaves out, so they cannot disagree.
 */
export async function neverDeclaredVoidedInvoiceIds(ex: Executor, companyId: string, startYmd: string, endYmd: string): Promise<string[]> {
  const start = periodYmd(startYmd);
  const end = periodYmd(endYmd);
  const res = await ex.execute(sql`
    SELECT i.id, ${sql.raw(dubaiDayTextSql("i.date"))} AS date_ymd, i.status, to_char(rev.d, 'YYYY-MM-DD') AS voided_on, rev.at_ms
      FROM invoices i ${sql.raw(VOID_DATE_LATERAL_SQL)}
     WHERE i.company_id = ${companyId} AND i.status IN ('void', 'cancelled') AND rev.d IS NOT NULL
       AND COALESCE(i.is_opening_balance, false) = false
       AND ((${sql.raw(dubaiDaySql("i.date"))} >= ${start}::date AND ${sql.raw(dubaiDaySql("i.date"))} <= ${end}::date)
         OR (rev.d >= ${start}::date AND rev.d <= ${end}::date))`);
  const docs = rowsOf(res).map((r) => ({
    id: String(r.id),
    date: String(r.date_ymd),
    status: String(r.status),
    voidedOn: r.voided_on as string,
    voidedAtMs: r.at_ms === null || r.at_ms === undefined ? null : Number(r.at_ms),
  }));
  return [...(await neverDeclaredAmong(ex, companyId, docs))];
}
