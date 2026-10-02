// The shared ledger layer of the report engine (Phase 8 D4). Every ledger-based report, the P&L and balance
// sheet routes, the trial balance and the dashboard KPIs read journal lines through this one module, so they
// agree by construction (dashboard revenue = P&L revenue).
//
// Rules (design D4 section 3):
//  * posted entries only; amounts are AED from journal_lines.debit/credit, summed in SQL and rounded once;
//  * P&L-type reads leave out year-end close entries (and their reversals); KPI reads also leave out the
//    corporate-tax accrual; balance reads include everything;
//  * day boundaries are Dubai days (dates.ts).
// It is a TypeScript SQL fragment on purpose, not a database view: a view over journal_lines would block other
// domains' ALTER COLUMN TYPE migrations.

import { round2 } from "../services/financial-statements";
import { dayEndTs, dayStartTs, ymdSql } from "./dates";

export interface Queryable {
  query: (text: string, values?: unknown[]) => Promise<{ rows: any[] }>;
}

/** Entries that carry a closed year's profit into equity: P&L reads skip them so a closed year still shows its profit. */
export const PL_EXCLUDED_SOURCES: readonly string[] = ["year_end_close", "year_end_close_reversal"];
/** The dashboard KPIs also skip the corporate-tax accrual (it is a tax charge, not an operating cost). */
export const KPI_EXCLUDED_SOURCES: readonly string[] = [...PL_EXCLUDED_SOURCES, "corporate_tax_filing"];

/** SQL predicate for a cash / bank account (mirrors isCashOrBankAccount in financial-statements.ts). */
export const cashAccountSql = (a: string): string =>
  `(${a}.type = 'asset' AND (${a}.sub_type IN ('cash', 'bank') OR (${a}.code >= '1010' AND ${a}.code <= '1039')
     OR lower(${a}.name_en) LIKE '%cash%' OR lower(${a}.name_en) LIKE '%bank%' OR lower(${a}.name_en) LIKE '%petty%'))`;

/** Positional-parameter collector: `b.p(value)` returns the `$n` placeholder for the value. */
export class SqlParams {
  readonly values: unknown[] = [];
  p(value: unknown): string {
    this.values.push(value);
    return `$${this.values.length}`;
  }
}

export const toFils = (n: number): number => Math.round((Number(n) + Number.EPSILON) * 100);
export const fromFils = (f: number): number => f / 100;
export const money = (v: unknown): number => round2(Number(v ?? 0) || 0);

export interface LedgerFilter {
  /** First Dubai day included. */
  from?: string;
  /** Last Dubai day included. */
  to?: string;
  excludeSources?: readonly string[];
  accountId?: string;
  accountIds?: readonly string[];
  costCenterId?: string;
  source?: string;
}

/** WHERE conditions (without the keyword) restricting `je` (journal_entries) and `jl` (journal_lines). */
function ledgerConditions(b: SqlParams, companyId: string, f: LedgerFilter): { je: string[]; jl: string[] } {
  const je = [`je.company_id = ${b.p(companyId)}`, `je.status = 'posted'`];
  const jl: string[] = [];
  if (f.from) je.push(`je.date >= ${b.p(dayStartTs(f.from))}::timestamp`);
  if (f.to) je.push(`je.date <= ${b.p(dayEndTs(f.to))}::timestamp`);
  if (f.excludeSources?.length) je.push(`je.source <> ALL(${b.p([...f.excludeSources])}::text[])`);
  if (f.source) je.push(`je.source = ${b.p(f.source)}`);
  if (f.accountId) jl.push(`jl.account_id = ${b.p(f.accountId)}::uuid`);
  if (f.accountIds) jl.push(`jl.account_id = ANY(${b.p([...f.accountIds])}::uuid[])`);
  if (f.costCenterId) jl.push(`jl.cost_center_id = ${b.p(f.costCenterId)}::uuid`);
  return { je, jl };
}

/**
 * The ledger as one CTE: one row per posted journal line with its entry columns. Callers `WITH ${...}` it and
 * select from `ledger`. `b` collects the parameters, so the fragment can sit inside a larger statement.
 *
 * The join order is FIXED, not left to the planner: the entries of the company and window drive, and each entry's
 * lines are fetched through the entry_id index (a LATERAL subquery with OFFSET 0 cannot be flattened into a join
 * the planner may reorder). With stale statistics (a bulk load not yet analysed) the planner estimated a handful of
 * rows for a 26,000-entry company and chose a nested loop that rescanned the entries once per line: 23 s for a
 * 52,000-line ledger. Now the cost is one index probe per entry whatever the statistics say. MATERIALIZED keeps the
 * result from being folded into the joins of the callers.
 */
export function ledgerLinesSql(b: SqlParams, companyId: string, f: LedgerFilter = {}): string {
  const c = ledgerConditions(b, companyId, f);
  const lineWhere = ["jl.entry_id = je.id", ...c.jl].join(" AND ");
  return `ledger AS MATERIALIZED (
    SELECT jl.id AS line_id, jl.account_id, jl.cost_center_id, jl.debit, jl.credit, jl.description AS line_description, jl.foreign_currency,
           je.id AS entry_id, je.entry_number, je.date AS entry_date, je.source, je.source_id, je.memo, je.created_at
      FROM (SELECT je.id, je.entry_number, je.date, je.source, je.source_id, je.memo, je.created_at
              FROM journal_entries je WHERE ${c.je.join(" AND ")} OFFSET 0) je
      CROSS JOIN LATERAL (
        SELECT jl.id, jl.account_id, jl.cost_center_id, jl.debit, jl.credit, jl.description, jl.foreign_currency
          FROM journal_lines jl WHERE ${lineWhere} OFFSET 0) jl
  )`;
}

export interface AccountTotal {
  accountId: string;
  code: string;
  nameEn: string;
  nameAr: string | null;
  type: string;
  subType: string | null;
  intercompanyCompanyId: string | null;
  debit: number;
  credit: number;
}

/** Debit and credit totals per account over the filter (accounts with no activity are left out). */
export async function accountBalances(q: Queryable, companyId: string, f: LedgerFilter = {}): Promise<AccountTotal[]> {
  const b = new SqlParams();
  const { rows } = await q.query(
    `WITH ${ledgerLinesSql(b, companyId, f)}
     , agg AS (SELECT l.account_id, SUM(l.debit) AS d, SUM(l.credit) AS c FROM ledger l GROUP BY l.account_id)
     SELECT a.id AS account_id, a.code, a.name_en, a.name_ar, a.type, a.sub_type, a.intercompany_company_id,
            COALESCE(agg.d, 0)::text AS debit, COALESCE(agg.c, 0)::text AS credit
       FROM agg JOIN accounts a ON a.id = agg.account_id AND a.company_id = ${b.p(companyId)}
      ORDER BY a.code`,
    b.values
  );
  return rows.map((r) => ({
    accountId: String(r.account_id),
    code: String(r.code),
    nameEn: String(r.name_en),
    nameAr: r.name_ar ?? null,
    type: String(r.type),
    subType: r.sub_type ?? null,
    intercompanyCompanyId: r.intercompany_company_id ?? null,
    debit: money(r.debit),
    credit: money(r.credit),
  }));
}

export interface AccountMovement extends AccountTotal {
  openingDebit: number;
  openingCredit: number;
  movementDebit: number;
  movementCredit: number;
}

/**
 * Opening (before `from`), movement (`from`..`to`) and closing (through `to`) per account, in one pass.
 * Closing = opening + movement. Balance-sheet accounts carry history; P&L accounts are returned the same way
 * and the caller decides (a comparative trial balance shows them cumulative, like the books).
 */
export async function openingMovementClosing(
  q: Queryable,
  companyId: string,
  from: string,
  to: string,
  excludeSources?: readonly string[]
): Promise<AccountMovement[]> {
  const b = new SqlParams();
  const fromTs = b.p(dayStartTs(from));
  const rows = (
    await q.query(
      `WITH ${ledgerLinesSql(b, companyId, { to, excludeSources })}
       , agg AS (
         SELECT l.account_id,
                SUM(l.debit) FILTER (WHERE l.entry_date < ${fromTs}::timestamp) AS od, SUM(l.credit) FILTER (WHERE l.entry_date < ${fromTs}::timestamp) AS oc,
                SUM(l.debit) FILTER (WHERE l.entry_date >= ${fromTs}::timestamp) AS md, SUM(l.credit) FILTER (WHERE l.entry_date >= ${fromTs}::timestamp) AS mc
           FROM ledger l GROUP BY l.account_id)
       SELECT a.id AS account_id, a.code, a.name_en, a.name_ar, a.type, a.sub_type, a.intercompany_company_id,
              COALESCE(agg.od, 0)::text AS od, COALESCE(agg.oc, 0)::text AS oc, COALESCE(agg.md, 0)::text AS md, COALESCE(agg.mc, 0)::text AS mc
         FROM agg JOIN accounts a ON a.id = agg.account_id AND a.company_id = ${b.p(companyId)}
        ORDER BY a.code`,
      b.values
    )
  ).rows;
  return rows.map((r) => {
    const openingDebit = money(r.od);
    const openingCredit = money(r.oc);
    const movementDebit = money(r.md);
    const movementCredit = money(r.mc);
    return {
      accountId: String(r.account_id),
      code: String(r.code),
      nameEn: String(r.name_en),
      nameAr: r.name_ar ?? null,
      type: String(r.type),
      subType: r.sub_type ?? null,
      intercompanyCompanyId: r.intercompany_company_id ?? null,
      openingDebit,
      openingCredit,
      movementDebit,
      movementCredit,
      debit: round2(openingDebit + movementDebit),
      credit: round2(openingCredit + movementCredit),
    };
  });
}

export interface PeriodProfit {
  revenue: number;
  expenses: number;
  net: number;
}

/**
 * Revenue (credit - debit of income accounts), expenses (debit - credit of expense accounts) and net profit for a
 * Dubai-day range. The P&L report, the P&L / balance-sheet routes and the dashboard KPIs all call this.
 */
export async function periodProfit(
  q: Queryable,
  companyId: string,
  from: string | undefined,
  to: string | undefined,
  excludeSources: readonly string[] = PL_EXCLUDED_SOURCES
): Promise<PeriodProfit> {
  const b = new SqlParams();
  const { rows } = await q.query(
    `WITH ${ledgerLinesSql(b, companyId, { from, to, excludeSources })}
     , agg AS (SELECT l.account_id, SUM(l.debit) AS d, SUM(l.credit) AS c FROM ledger l GROUP BY l.account_id)
     SELECT COALESCE(SUM(agg.c - agg.d) FILTER (WHERE a.type = 'income'), 0)::text AS revenue,
            COALESCE(SUM(agg.d - agg.c) FILTER (WHERE a.type = 'expense'), 0)::text AS expenses
       FROM agg JOIN accounts a ON a.id = agg.account_id AND a.company_id = ${b.p(companyId)}`,
    b.values
  );
  const revenue = money(rows[0]?.revenue);
  const expenses = money(rows[0]?.expenses);
  return { revenue, expenses, net: round2(revenue - expenses) };
}

/** Net balance of the cash and bank accounts through `to` (debit minus credit), AED. */
export async function cashBalance(q: Queryable, companyId: string, to?: string): Promise<number> {
  const b = new SqlParams();
  const { rows } = await q.query(
    `WITH ${ledgerLinesSql(b, companyId, { to })}
     , agg AS (SELECT l.account_id, SUM(l.debit - l.credit) AS net FROM ledger l GROUP BY l.account_id)
     SELECT COALESCE(SUM(agg.net), 0)::text AS net
       FROM agg JOIN accounts a ON a.id = agg.account_id AND a.company_id = ${b.p(companyId)}
      WHERE ${cashAccountSql("a")}`,
    b.values
  );
  return money(rows[0]?.net);
}

export interface LedgerLine {
  lineId: string;
  accountId: string;
  code: string;
  nameEn: string;
  nameAr: string | null;
  type: string;
  entryId: string;
  entryNumber: string;
  date: string;
  source: string;
  sourceId: string | null;
  memo: string | null;
  lineDescription: string | null;
  debit: number;
  credit: number;
}

/** Posted journal lines of the filter, ordered by account code then date. `limit` caps the row count (the caller asks for one over). */
export async function ledgerLines(
  q: Queryable,
  companyId: string,
  f: LedgerFilter & { limit?: number; offset?: number }
): Promise<LedgerLine[]> {
  const b = new SqlParams();
  const limit = `${f.limit ? `LIMIT ${Math.trunc(f.limit)}` : ""} ${f.offset ? `OFFSET ${Math.trunc(f.offset)}` : ""}`;
  const { rows } = await q.query(
    `WITH ${ledgerLinesSql(b, companyId, f)}
     SELECT l.line_id, l.account_id, a.code, a.name_en, a.name_ar, a.type, l.entry_id, l.entry_number, ${ymdSql("l.entry_date")} AS d,
            l.source, l.source_id, l.memo, l.line_description, l.debit::text AS debit, l.credit::text AS credit
       FROM ledger l JOIN accounts a ON a.id = l.account_id AND a.company_id = ${b.p(companyId)}
      ORDER BY a.code, l.entry_date, l.created_at, l.entry_number, l.line_id ${limit}`,
    b.values
  );
  return rows.map((r) => ({
    lineId: String(r.line_id),
    accountId: String(r.account_id),
    code: String(r.code),
    nameEn: String(r.name_en),
    nameAr: r.name_ar ?? null,
    type: String(r.type),
    entryId: String(r.entry_id),
    entryNumber: String(r.entry_number),
    date: String(r.d),
    source: String(r.source),
    sourceId: r.source_id ?? null,
    memo: r.memo ?? null,
    lineDescription: r.line_description ?? null,
    debit: money(r.debit),
    credit: money(r.credit),
  }));
}

/** Natural-side balance: debit - credit for assets and expenses, credit - debit for the rest. */
export const naturalBalance = (type: string, debit: number, credit: number): number =>
  type === "asset" || type === "expense" ? round2(debit - credit) : round2(credit - debit);

/** Opening balance (before `from`) per account, as debit and credit totals; one account or all of them. */
export async function openingBalances(
  q: Queryable,
  companyId: string,
  from: string,
  filter: { accountId?: string; accountIds?: readonly string[]; costCenterId?: string; excludeSources?: readonly string[] } = {}
): Promise<Map<string, { debit: number; credit: number }>> {
  const b = new SqlParams();
  const { rows } = await q.query(
    `WITH ${ledgerLinesSql(b, companyId, { ...filter, to: undefined })}
     SELECT l.account_id, COALESCE(SUM(l.debit), 0)::text AS d, COALESCE(SUM(l.credit), 0)::text AS c
       FROM ledger l WHERE l.entry_date < ${b.p(dayStartTs(from))}::timestamp GROUP BY l.account_id`,
    b.values
  );
  return new Map(rows.map((r) => [String(r.account_id), { debit: money(r.d), credit: money(r.c) }]));
}

export interface LedgerCount {
  count: number;
  debit: number;
  credit: number;
}

/** Number of lines and their debit / credit totals over the filter: the totals of a paged ledger, from SQL, never from the rows of the page. */
export async function ledgerCount(q: Queryable, companyId: string, f: LedgerFilter = {}): Promise<LedgerCount> {
  const b = new SqlParams();
  const { rows } = await q.query(
    `WITH ${ledgerLinesSql(b, companyId, f)}
     SELECT COUNT(*)::text AS n, COALESCE(SUM(l.debit), 0)::text AS dr, COALESCE(SUM(l.credit), 0)::text AS cr FROM ledger l`,
    b.values
  );
  return { count: Number(rows[0]?.n ?? 0), debit: money(rows[0]?.dr), credit: money(rows[0]?.cr) };
}

export interface LedgerAccountCount extends LedgerCount {
  accountId: string;
  code: string;
  type: string;
}

/** Per account, in code order: the line count and debit / credit totals over the filter. */
export async function ledgerCountsByAccount(q: Queryable, companyId: string, f: LedgerFilter = {}): Promise<LedgerAccountCount[]> {
  const b = new SqlParams();
  const { rows } = await q.query(
    `WITH ${ledgerLinesSql(b, companyId, f)}
     , agg AS (SELECT l.account_id, COUNT(*) AS n, SUM(l.debit) AS dr, SUM(l.credit) AS cr FROM ledger l GROUP BY l.account_id)
     SELECT a.id AS account_id, a.code, a.type, agg.n::text AS n, COALESCE(agg.dr, 0)::text AS dr, COALESCE(agg.cr, 0)::text AS cr
       FROM agg JOIN accounts a ON a.id = agg.account_id AND a.company_id = ${b.p(companyId)} ORDER BY a.code`,
    b.values
  );
  return rows.map((r) => ({ accountId: String(r.account_id), code: String(r.code), type: String(r.type), count: Number(r.n), debit: money(r.dr), credit: money(r.cr) }));
}

/** Debit / credit totals of the first `n` lines (in ledgerLines order) of one account: the base of a running balance that starts mid-account. */
export async function ledgerFirstLinesTotal(q: Queryable, companyId: string, f: LedgerFilter, n: number): Promise<{ debit: number; credit: number }> {
  if (n <= 0) return { debit: 0, credit: 0 };
  const b = new SqlParams();
  const { rows } = await q.query(
    `WITH ${ledgerLinesSql(b, companyId, f)}
     SELECT COALESCE(SUM(t.debit), 0)::text AS dr, COALESCE(SUM(t.credit), 0)::text AS cr
       FROM (SELECT l.debit, l.credit FROM ledger l ORDER BY l.entry_date, l.created_at, l.entry_number, l.line_id LIMIT ${Math.trunc(n)}) t`,
    b.values
  );
  return { debit: money(rows[0]?.dr), credit: money(rows[0]?.cr) };
}
