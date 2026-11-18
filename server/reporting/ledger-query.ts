/**
 * The one place the reporting kernel reads the ledger. All sums are done in
 * SQL in integer fils (ROUND(x * 100)) so no float accumulation reaches a
 * report; conversion back to major units of the company's base currency happens once,
 * at the edge (`aed()`, kept for its historical name).
 */
import type { QueryResultRow } from "pg";
import { pool } from "../db";
import { DomainError } from "../errors";
import { baseCurrencyOf } from "../ledger/currency";
import type { IsoDate } from "./dates";

export interface Queryable {
  query: (text: string, params?: unknown[]) => Promise<{ rows: QueryResultRow[] }>;
}

/** Journal sources that mark closing / year-end entries. */
export const CLOSING_ENTRY_SOURCES = ["year_end_close", "closing", "period_close"] as const;
export const YEAR_END_CLOSE_SOURCE = "year_end_close";

/**
 * SQL predicate (alias `je`) that is TRUE for closing entries: the tagged
 * year-end close plus legacy month-end closings (source 'system', memo
 * "Closing entries for ..."). Statements are correct by computation, so these
 * entries are excluded from every statement query: they would otherwise zero
 * the P&L (R08-02) and be double counted by the retained-earnings roll-forward.
 */
export const CLOSING_ENTRY_SQL = `(je.source IN ('year_end_close','closing','period_close') OR (je.source = 'system' AND COALESCE(je.memo, '') LIKE 'Closing entries for %'))`;
export const NOT_CLOSING_SQL = `NOT ${CLOSING_ENTRY_SQL}`;

/**
 * D1 (N2): SQL predicate (alias `je`) that is TRUE for a go-live opening-balance entry: the opening
 * trial balance, the opening documents (open invoices / bills), the opening stock, the asset
 * register's opening capitalisation and the opening gratuity provision. They are all posted with
 * `entry_kind = 'opening'`; opening stock and opening register capitalisations posted before
 * D1 carry kind 'standard' and are recognised by their Opening Balance Equity (3040) leg. A
 * reversal of an opening entry is part of the opening position too. These entries are the
 * position the books start from, not transactions of the period: the cash-flow statement treats
 * them as the opening position (IAS 7.45: opening cash is the cash at the start).
 */
export const OPENING_ENTRY_SQL = `(je.entry_kind = 'opening'
  OR (je.source IN ('inventory', 'fixed_asset') AND EXISTS (
        SELECT 1 FROM journal_lines ol JOIN accounts oa ON oa.id = ol.account_id
         WHERE ol.entry_id = je.id AND oa.code = '3040'))
  OR (je.source = 'reversal' AND EXISTS (
        SELECT 1 FROM journal_entries oe
         WHERE oe.reversed_by_entry_id = je.id AND oe.entry_kind = 'opening')))`;

/** UAE-local calendar date of a journal entry (stored as UTC wall-clock). */
export const ENTRY_LOCAL_DATE_SQL = `((je.date + interval '4 hours')::date)`;

export type Fils = number;

/** Minor units -> major-unit number of the base currency, exactly 2dp (single division). */
export function aed(fils: Fils): number {
  const v = fils / 100;
  return Object.is(v, -0) ? 0 : v;
}

export interface ReportAccount {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string | null;
  type: "asset" | "liability" | "equity" | "income" | "expense" | string;
  subType: string | null;
  isActive: boolean;
}

export interface CompanyReportSettings {
  id: string;
  name: string;
  baseCurrency: string;
  fiscalYearStartMonth: number;
}

export async function loadCompany(
  companyId: string,
  q: Queryable = pool
): Promise<CompanyReportSettings> {
  const { rows } = await q.query(
    `SELECT id, name, base_currency,
            COALESCE(fiscal_year_start_month, 1) AS fsm
       FROM companies WHERE id = $1`,
    [companyId]
  );
  if (!rows[0]) throw new DomainError("COMPANY_NOT_FOUND", 404);
  return {
    id: rows[0].id,
    name: rows[0].name,
    baseCurrency: rows[0].base_currency,
    fiscalYearStartMonth: Number(rows[0].fsm) || 1,
  };
}

/** The currency a company's statements are expressed in: its base (functional) currency. */
export async function reportCurrencyOf(companyId: string, q: Queryable = pool): Promise<string> {
  return baseCurrencyOf(await loadCompany(companyId, q));
}

export async function loadAccounts(
  companyId: string,
  q: Queryable = pool
): Promise<ReportAccount[]> {
  const { rows } = await q.query(
    `SELECT id, code, name_en, name_ar, type, sub_type, is_active
       FROM accounts WHERE company_id = $1 ORDER BY code, name_en`,
    [companyId]
  );
  return rows.map((r) => ({
    id: r.id,
    code: r.code ?? "",
    nameEn: r.name_en,
    nameAr: r.name_ar ?? null,
    type: r.type,
    subType: r.sub_type ?? null,
    isActive: r.is_active !== false,
  }));
}

export interface AccountTotals {
  debit: Fils;
  credit: Fils;
  /** Any line carried a foreign currency. */
  hasForeign?: boolean;
}

export interface TotalsOptions {
  /** Inclusive UAE date; null = from inception. */
  from?: IsoDate | null;
  /** Inclusive UAE date; null = no upper bound. */
  to?: IsoDate | null;
  /** Default false: closing entries are excluded from statements. */
  includeClosing?: boolean;
  /**
   * D1 (N2): "exclude" leaves out the go-live opening-balance entries (OPENING_ENTRY_SQL),
   * "only" keeps just them; default: every entry.
   */
  opening?: "exclude" | "only";
}

/** Posted debit/credit totals (fils) per account for the range. */
export async function accountTotals(
  companyId: string,
  opts: TotalsOptions = {},
  q: Queryable = pool
): Promise<Map<string, AccountTotals>> {
  const { rows } = await q.query(
    `SELECT jl.account_id,
            COALESCE(SUM(ROUND(jl.debit * 100)), 0)::bigint AS d,
            COALESCE(SUM(ROUND(jl.credit * 100)), 0)::bigint AS c,
            COALESCE(bool_or(UPPER(COALESCE(jl.foreign_currency, '')) NOT IN
              ('', (SELECT UPPER(c.base_currency) FROM companies c WHERE c.id = $1))), false) AS f
       FROM journal_lines jl
       JOIN journal_entries je ON je.id = jl.entry_id
      WHERE je.company_id = $1
        AND je.status = 'posted'
        AND ($2::date IS NULL OR ${ENTRY_LOCAL_DATE_SQL} >= $2::date)
        AND ($3::date IS NULL OR ${ENTRY_LOCAL_DATE_SQL} <= $3::date)
        AND ($4::boolean OR ${NOT_CLOSING_SQL})
        ${opts.opening === "exclude" ? `AND NOT ${OPENING_ENTRY_SQL}` : opts.opening === "only" ? `AND ${OPENING_ENTRY_SQL}` : ""}
      GROUP BY jl.account_id`,
    [companyId, opts.from ?? null, opts.to ?? null, opts.includeClosing === true]
  );
  const out = new Map<string, AccountTotals>();
  for (const r of rows)
    out.set(r.account_id, { debit: Number(r.d), credit: Number(r.c), hasForeign: r.f === true });
  return out;
}

/** Signed natural balance in fils: debit-normal for asset/expense, credit-normal otherwise. */
export function naturalBalance(type: string, t: AccountTotals | undefined): Fils {
  if (!t) return 0;
  return type === "asset" || type === "expense" ? t.debit - t.credit : t.credit - t.debit;
}

/** income - expense (fils) over a totals map: positive = profit. */
export function netIncomeOf(accounts: ReportAccount[], totals: Map<string, AccountTotals>): Fils {
  let net = 0;
  for (const a of accounts) {
    const t = totals.get(a.id);
    if (!t) continue;
    if (a.type === "income") net += t.credit - t.debit;
    else if (a.type === "expense") net -= t.debit - t.credit;
  }
  return net;
}

export interface LedgerLineRow {
  entryId: string;
  entryNumber: string;
  date: IsoDate;
  memo: string | null;
  source: string;
  sourceId: string | null;
  accountId: string;
  description: string | null;
  debit: Fils;
  credit: Fils;
  isClosingEntry: boolean;
}

/** Posted lines in range (optionally for some accounts), ordered by date then entry number. */
export async function ledgerLines(
  companyId: string,
  opts: TotalsOptions & { accountIds?: string[] | null; limit?: number } = {},
  q: Queryable = pool
): Promise<LedgerLineRow[]> {
  const { rows } = await q.query(
    `SELECT je.id AS entry_id, je.entry_number, ${ENTRY_LOCAL_DATE_SQL}::text AS d, je.memo,
            je.source, je.source_id, jl.account_id, jl.description,
            ROUND(jl.debit * 100)::bigint AS dr, ROUND(jl.credit * 100)::bigint AS cr,
            ${CLOSING_ENTRY_SQL} AS is_closing
       FROM journal_lines jl
       JOIN journal_entries je ON je.id = jl.entry_id
      WHERE je.company_id = $1
        AND je.status = 'posted'
        AND ($2::date IS NULL OR ${ENTRY_LOCAL_DATE_SQL} >= $2::date)
        AND ($3::date IS NULL OR ${ENTRY_LOCAL_DATE_SQL} <= $3::date)
        AND ($4::boolean OR ${NOT_CLOSING_SQL})
        AND ($5::uuid[] IS NULL OR jl.account_id = ANY($5::uuid[]))
      ORDER BY je.date, je.entry_number, jl.id
      LIMIT $6`,
    [
      companyId,
      opts.from ?? null,
      opts.to ?? null,
      opts.includeClosing === true,
      opts.accountIds && opts.accountIds.length ? opts.accountIds : null,
      opts.limit ?? 50_000,
    ]
  );
  return rows.map((r) => ({
    entryId: r.entry_id,
    entryNumber: r.entry_number,
    date: r.d,
    memo: r.memo ?? null,
    source: r.source,
    sourceId: r.source_id ?? null,
    accountId: r.account_id,
    description: r.description ?? null,
    debit: Number(r.dr),
    credit: Number(r.cr),
    isClosingEntry: r.is_closing === true,
  }));
}
