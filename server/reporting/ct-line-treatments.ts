/**
 * WQ3 (9.16): corporate-tax treatments set on individual journal lines, summed per account and
 * treatment for a tax period. Same policy as every other reporting read: posted entries only,
 * closing entries excluded, UAE calendar dates, integer fils summed in SQL. A reversal copies the
 * line's treatment (server/ledger/kernel.ts), so a reversed line nets to zero here too.
 *
 * Amounts are in the account's natural sign: an expense line is debit - credit, an income line
 * credit - debit. A non-deductible line contributes `amount * pct / 100` (rounded once per
 * account and share) to `disallowedFils`.
 */
import { pool } from "../db";
import { ENTRY_LOCAL_DATE_SQL, NOT_CLOSING_SQL, type Fils, type Queryable } from "./ledger-query";

export interface CtLineTreatmentTotal {
  accountId: string;
  accountCode: string;
  accountName: string;
  accountType: string;
  treatment: "deductible" | "non_deductible" | "exempt_income";
  /** Share in percent for non_deductible lines (null otherwise). */
  pct: number | null;
  /** Natural-sign net amount of the lines (fils). */
  amountFils: Fils;
  /** non_deductible: the added-back part; exempt_income: the deducted amount; deductible: 0. */
  adjustmentFils: Fils;
}

export async function ctLineTreatmentTotals(
  companyId: string,
  range: { from: string; to: string },
  q: Queryable = pool
): Promise<CtLineTreatmentTotal[]> {
  const { rows } = await q.query(
    `SELECT jl.account_id, a.code, a.name_en, a.type, jl.ct_treatment,
            COALESCE(jl.ct_disallowed_pct, 0)::text AS pct,
            COALESCE(SUM(ROUND(jl.debit * 100)), 0)::bigint AS d,
            COALESCE(SUM(ROUND(jl.credit * 100)), 0)::bigint AS c
       FROM journal_lines jl
       JOIN journal_entries je ON je.id = jl.entry_id
       JOIN accounts a ON a.id = jl.account_id AND a.company_id = je.company_id
      WHERE je.company_id = $1
        AND je.status = 'posted'
        AND jl.ct_treatment IS NOT NULL
        AND ${ENTRY_LOCAL_DATE_SQL} >= $2::date
        AND ${ENTRY_LOCAL_DATE_SQL} <= $3::date
        AND ${NOT_CLOSING_SQL}
      GROUP BY jl.account_id, a.code, a.name_en, a.type, jl.ct_treatment, jl.ct_disallowed_pct
      ORDER BY a.code, jl.ct_treatment`,
    [companyId, range.from, range.to]
  );
  const out: CtLineTreatmentTotal[] = [];
  for (const r of rows as Array<Record<string, string>>) {
    const d = Number(r.d);
    const c = Number(r.c);
    const amountFils = r.type === "income" ? c - d : d - c;
    if (amountFils === 0) continue;
    const treatment = r.ct_treatment as CtLineTreatmentTotal["treatment"];
    const pct = treatment === "non_deductible" ? Number(r.pct) : null;
    const adjustmentFils =
      treatment === "non_deductible"
        ? Math.round((amountFils * Number(r.pct)) / 100)
        : treatment === "exempt_income"
          ? amountFils
          : 0;
    out.push({
      accountId: r.account_id,
      accountCode: r.code,
      accountName: r.name_en,
      accountType: r.type,
      treatment,
      pct,
      amountFils,
      adjustmentFils,
    });
  }
  return out;
}
