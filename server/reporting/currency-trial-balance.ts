/**
 * Trial balance by currency (W5-C: R14-16, R11-18 residual).
 *
 * Groups posted journal lines (closing entries excluded, like every statement) by the
 * currency they were transacted in: lines tagged with a foreign currency report their
 * foreign_debit / foreign_credit alongside the base amounts; untagged lines (and lines tagged
 * with the base currency) are base-currency lines. Balance-sheet accounts are cumulative
 * through `to`; income and expense accounts cover [from, to] when `from` is given.
 *
 * Per foreign currency the base columns need not balance (FX differences sit in base-only
 * lines); the base totals across every currency always do.
 */
import { pool } from "../db";
import {
  ENTRY_LOCAL_DATE_SQL,
  NOT_CLOSING_SQL,
  aed,
  reportCurrencyOf,
  type Queryable,
} from "./ledger-query";
import type { IsoDate } from "./dates";

export interface CurrencyTrialBalanceRow {
  accountId: string;
  accountCode: string;
  accountName: string;
  accountType: string;
  /** Amounts in the transaction currency (equal to base for base-currency lines). */
  debit: number;
  credit: number;
  balance: number;
  /** Amounts in the company's base currency. */
  baseDebit: number;
  baseCredit: number;
  baseBalance: number;
}

export interface CurrencyTrialBalanceGroup {
  currency: string;
  isBase: boolean;
  rows: CurrencyTrialBalanceRow[];
  totals: { debit: number; credit: number; baseDebit: number; baseCredit: number };
}

export interface CurrencyTrialBalance {
  reportCurrency: string;
  from: IsoDate | null;
  to: IsoDate;
  currencies: CurrencyTrialBalanceGroup[];
  baseTotals: { debit: number; credit: number; difference: number };
  isBalanced: boolean;
}

export async function trialBalanceByCurrency(
  args: { companyId: string; from?: IsoDate | null; to: IsoDate },
  q: Queryable = pool
): Promise<CurrencyTrialBalance> {
  const base = await reportCurrencyOf(args.companyId, q);
  const from = args.from ?? null;
  const { rows } = await q.query(
    `SELECT jl.account_id, a.code, a.name_en, a.type,
            CASE WHEN COALESCE(jl.foreign_currency, '') = '' OR UPPER(jl.foreign_currency) = $4
                 THEN $4 ELSE UPPER(jl.foreign_currency) END AS cur,
            COALESCE(SUM(ROUND(jl.debit * 100)), 0)::bigint AS d,
            COALESCE(SUM(ROUND(jl.credit * 100)), 0)::bigint AS c,
            COALESCE(SUM(ROUND(COALESCE(jl.foreign_debit, 0) * 100)), 0)::bigint AS fd,
            COALESCE(SUM(ROUND(COALESCE(jl.foreign_credit, 0) * 100)), 0)::bigint AS fc
       FROM journal_lines jl
       JOIN journal_entries je ON je.id = jl.entry_id
       JOIN accounts a ON a.id = jl.account_id
      WHERE je.company_id = $1
        AND je.status = 'posted'
        AND ${NOT_CLOSING_SQL}
        AND ${ENTRY_LOCAL_DATE_SQL} <= $3::date
        AND ($2::date IS NULL OR a.type IN ('asset', 'liability', 'equity')
             OR ${ENTRY_LOCAL_DATE_SQL} >= $2::date)
      GROUP BY jl.account_id, a.code, a.name_en, a.type, cur
      ORDER BY cur, a.code`,
    [args.companyId, from, args.to, base]
  );
  const groups = new Map<string, CurrencyTrialBalanceGroup & { f: number[] }>();
  let baseD = 0;
  let baseC = 0;
  for (const r of rows) {
    const cur = String(r.cur);
    const isBase = cur === base;
    let g = groups.get(cur);
    if (!g) {
      g = {
        currency: cur,
        isBase,
        rows: [],
        totals: { debit: 0, credit: 0, baseDebit: 0, baseCredit: 0 },
        f: [0, 0, 0, 0],
      };
      groups.set(cur, g);
    }
    const d = Number(r.d);
    const c = Number(r.c);
    const fd = isBase ? d : Number(r.fd);
    const fc = isBase ? c : Number(r.fc);
    baseD += d;
    baseC += c;
    g.f[0] += fd;
    g.f[1] += fc;
    g.f[2] += d;
    g.f[3] += c;
    const debitNormal = r.type === "asset" || r.type === "expense";
    g.rows.push({
      accountId: r.account_id,
      accountCode: r.code ?? "",
      accountName: r.name_en,
      accountType: r.type,
      debit: aed(fd),
      credit: aed(fc),
      balance: aed(debitNormal ? fd - fc : fc - fd),
      baseDebit: aed(d),
      baseCredit: aed(c),
      baseBalance: aed(debitNormal ? d - c : c - d),
    });
  }
  const currencies = [...groups.values()]
    .map(({ f, ...g }) => ({
      ...g,
      totals: { debit: aed(f[0]), credit: aed(f[1]), baseDebit: aed(f[2]), baseCredit: aed(f[3]) },
    }))
    .sort((a, b) =>
      a.isBase === b.isBase ? a.currency.localeCompare(b.currency) : a.isBase ? -1 : 1
    );
  return {
    reportCurrency: base,
    from,
    to: args.to,
    currencies,
    baseTotals: { debit: aed(baseD), credit: aed(baseC), difference: aed(Math.abs(baseD - baseC)) },
    isBalanced: baseD === baseC,
  };
}

/**
 * X6a (council REQUIRED 7): the debit-normal balance of one account in a given currency as at
 * `to`, in fils of that currency (same rule as server/services/fx/bank-balances.ts):
 *  - `currency` is the report currency: debit - credit of every line (the GL figure);
 *  - a foreign currency: foreign_debit - foreign_credit of lines tagged with that currency
 *    (lines without a foreign amount, e.g. a revaluation adjustment, change the base only).
 */
export async function accountBalanceInCurrency(
  args: { companyId: string; accountId: string; currency: string; to: IsoDate },
  q: Queryable = pool
): Promise<number> {
  const base = (await reportCurrencyOf(args.companyId, q)).toUpperCase();
  const cur = args.currency.toUpperCase();
  const { rows } = await q.query(
    `SELECT COALESCE(SUM(CASE WHEN $4 = $5
                              THEN ROUND(jl.debit * 100) - ROUND(jl.credit * 100)
                              WHEN UPPER(COALESCE(jl.foreign_currency, '')) = $4
                              THEN ROUND(COALESCE(jl.foreign_debit, 0) * 100)
                                 - ROUND(COALESCE(jl.foreign_credit, 0) * 100)
                              ELSE 0 END), 0)::bigint AS fils
       FROM journal_lines jl
       JOIN journal_entries je ON je.id = jl.entry_id
      WHERE je.company_id = $1
        AND jl.account_id = $2
        AND je.status = 'posted'
        AND ${NOT_CLOSING_SQL}
        AND ${ENTRY_LOCAL_DATE_SQL} <= $3::date`,
    [args.companyId, args.accountId, args.to, cur, base]
  );
  return Number(rows[0]?.fils ?? 0);
}
