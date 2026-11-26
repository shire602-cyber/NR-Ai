/**
 * Aged receivables / payables reconstructed AS OF a date (R11-07, R11-15):
 * documents dated on or before asOf, less settlements dated on or before asOf
 * (the one settlement rule in ./settlement.ts, D5c), converted at the
 * document's booking rate and rounded to fils per document. Credit that
 * reduced the control account without settling a document (unapplied vendor
 * debit notes, credit notes with no original invoice) is `unappliedCredits`.
 * A reconciliation line ties the net aging total (documents less unapplied
 * credits) to the GL control account (1040 A/R, 2010 A/P) at the same date.
 */
import { getPoolStats, pool } from "../db";
import { DomainError } from "../errors";
import { baseCurrencyOf } from "../ledger/currency";
import {
  localDateOnOrBeforeSql,
  localDateSql,
  payableOpenBaseFilsSql,
  payableStatusSql,
  receivableOpenBaseFilsSql,
  receivableStatusSql,
  unappliedPayableCreditsFilsSql,
  unappliedReceivableCreditsFilsSql,
} from "./settlement";
import {
  NOT_CLOSING_SQL,
  aed,
  reportCurrencyOf,
  runReportReads,
  type Fils,
  type Queryable,
} from "./ledger-query";
import type { IsoDate } from "./dates";
import { FX_REVALUATION_SOURCES, allowanceForDoubtfulDebtsFils } from "./ifrs-adjustments";

const FX_SOURCES_SQL = FX_REVALUATION_SOURCES.map((s) => `'${s}'`).join(", ");

export interface AgingDocument {
  documentId: string;
  number: string | null;
  name: string;
  date: IsoDate;
  dueDate: IsoDate;
  currency: string;
  daysPastDue: number;
  bucket: AgingBucket;
  open: number;
}

export type AgingBucket = "current" | "days30" | "days60" | "days90" | "over90";

export interface AgingRow {
  id: string;
  name: string;
  type: "receivable" | "payable";
  current: number;
  days30: number;
  days60: number;
  days90: number;
  over90: number;
  total: number;
  /** The company's base (functional) currency (W5-C). */
  currency: string;
}

export interface AgingReport {
  reportCurrency: string;
  asOf: IsoDate;
  type: "receivable" | "payable";
  rows: AgingRow[];
  documents: AgingDocument[];
  totals: Omit<AgingRow, "id" | "name" | "type" | "currency">;
  /**
   * Credit that reduced the control account without settling a document (positive, base
   * currency): unapplied vendor debit notes (A/P), credit notes with no original invoice (A/R).
   */
  unappliedCredits: number;
  /** What is owed net of unapplied credits: totals.total − unappliedCredits (= the GL balance). */
  netTotal: number;
  /**
   * A3 (H6): unrealised FX revaluation carried on the control account at asOf (base currency;
   * + increases the control balance). Documents age at their booking rate (the one settlement
   * rule); the revaluation is the reconciling item to GL (IAS 21.23).
   */
  fxRevaluation: number;
  /**
   * A3 (H1/M5, receivables only): the allowance for doubtful debts (IFRS 9 simplified-approach
   * loss allowance, 1045). It sits on its own contra account, so it never breaks the aging-to-GL
   * tie; it is shown to arrive at the net carrying amount of trade receivables.
   */
  allowanceForDoubtfulDebts: number;
  /** netTotal + fxRevaluation − allowanceForDoubtfulDebts. */
  netCarryingAmount: number;
  reconciliation: {
    controlAccountCode: string | null;
    controlAccountName: string | null;
    glBalance: number;
    /** Documents less unapplied credits (= netTotal). */
    agingTotal: number;
    /** A3 (H6): reconciling items between agingTotal and glBalance. */
    reconcilingItems: Array<{
      key: "fx_revaluation";
      label: string;
      labelAr: string;
      amount: number;
    }>;
    /** agingTotal + reconciling items. */
    adjustedAgingTotal: number;
    difference: number;
    isReconciled: boolean;
    /**
     * A2 (H8): manual control-account adjustments (posted with a reason) included in the GL
     * balance; they explain that much of `difference`. `unexplainedDifference` is the rest.
     */
    controlAdjustments: number;
    unexplainedDifference: number;
  };
}

function bucketOf(days: number): AgingBucket {
  if (days <= 0) return "current";
  if (days <= 30) return "days30";
  if (days <= 60) return "days60";
  if (days <= 90) return "days90";
  return "over90";
}

const CONTROL_ACCOUNT = {
  receivable: ["1040", "asset", "receivable"],
  payable: ["2010", "liability", "payable"],
} as const;

// Look up the standard code by (company_id, code). The fallback chart search
// only runs when the standard account is missing.
// Closing entries are excluded from the control balance and FX totals. The manual
// adjustments include all posted entries with an adjustment reason. The asOf cutoff is the
// sargable form of the Gulf-local date test ((je.date + 4h)::date <= asOf), so journal_entries
// date indexes stay usable; the selected entries are identical. An account with no journal
// lines takes the zero branch of the CASE, so the ledger join is never executed. OFFSET 0 stops
// the planner flattening the subquery and repeating the aggregate once per output column.
const CONTROL_BALANCE_SQL = `WITH standard_account AS (
       SELECT id, code, name_en FROM accounts WHERE company_id = $1 AND code = $3
     ), acct AS (
       SELECT id, code, name_en FROM standard_account
       UNION ALL
       (SELECT id, code, name_en FROM accounts
         WHERE company_id = $1 AND type = $4 AND name_en ~* $5 AND name_en !~* 'vat|tax'
           AND NOT EXISTS (SELECT 1 FROM standard_account)
         ORDER BY code, name_en
         LIMIT 1))
     SELECT acct.id, acct.code, acct.name_en,
            s.v->>'d' AS d, s.v->>'c' AS c, s.v->>'fx' AS fx, s.v->>'adj' AS adj
       FROM acct
       CROSS JOIN LATERAL (
        SELECT CASE WHEN EXISTS (SELECT 1 FROM journal_lines WHERE account_id = acct.id)
        THEN (SELECT row_to_json(totals) FROM (
         SELECT COALESCE(SUM(ROUND(jl.debit * 100)) FILTER (WHERE ${NOT_CLOSING_SQL}), 0)::bigint AS d,
                COALESCE(SUM(ROUND(jl.credit * 100)) FILTER (WHERE ${NOT_CLOSING_SQL}), 0)::bigint AS c,
                COALESCE(SUM(ROUND(jl.debit * 100) - ROUND(jl.credit * 100))
                  FILTER (WHERE ${NOT_CLOSING_SQL} AND je.source IN (${FX_SOURCES_SQL})), 0)::bigint AS fx,
                COALESCE(SUM(ROUND(jl.debit * 100) - ROUND(jl.credit * 100))
                  FILTER (WHERE je.control_adjustment_reason IS NOT NULL), 0)::bigint AS adj
           FROM journal_lines jl
           JOIN journal_entries je ON je.id = jl.entry_id
          WHERE je.company_id = $1 AND je.status = 'posted' AND jl.account_id = acct.id
            AND ${localDateOnOrBeforeSql("je.date", "$2::date")}) totals)
        ELSE '{"d":0,"c":0,"fx":0,"adj":0}'::json END AS v
        OFFSET 0) s`;

type ControlBalanceRow = {
  id: string;
  code: string;
  name_en: string;
  d: string;
  c: string;
  fx: string;
  adj: string;
};

function readControlBalance(
  r: ControlBalanceRow | null | undefined,
  kind: keyof typeof CONTROL_ACCOUNT
) {
  if (!r) return { id: null, code: null, name: null, fils: 0, fxFils: 0, adjustmentsFils: 0 };
  const debit = Number(r.d);
  const credit = Number(r.c);
  const fils = kind === "receivable" ? debit - credit : credit - debit;
  const fxDr = Number(r.fx);
  const fxFils = kind === "receivable" ? fxDr : -fxDr;
  const net = Number(r.adj);
  const adjustmentsFils = kind === "receivable" ? net : -net;
  return { id: r.id, code: r.code, name: r.name_en, fils, fxFils, adjustmentsFils };
}

async function controlBalance(
  companyId: string,
  asOf: IsoDate,
  kind: keyof typeof CONTROL_ACCOUNT,
  q: Queryable
) {
  const { rows } = await q.query(CONTROL_BALANCE_SQL, [companyId, asOf, ...CONTROL_ACCOUNT[kind]]);
  return readControlBalance(rows[0] as ControlBalanceRow | undefined, kind);
}

/** Open-document rows the aging SQL returns (typed at the driver boundary). */
type AgingDocRows = Parameters<typeof build>[2];
type PayableAgingRow = {
  base_currency: string | null;
  control_balance: ControlBalanceRow | null;
  unapplied_fils: string;
  payable_documents: Array<AgingDocRows[number] & { vendor_id: string | null }>;
};

function build(
  kind: "receivable" | "payable",
  asOf: IsoDate,
  docs: Array<{
    id: string;
    number: string | null;
    name: string;
    date: string;
    due: string;
    currency: string;
    days: number;
    open_fils: string;
  }>,
  control: {
    code: string | null;
    name: string | null;
    fils: Fils;
    fxFils: Fils;
    adjustmentsFils: Fils;
  },
  reportCurrency: string,
  unappliedFils: Fils,
  allowanceFils: Fils = 0
): AgingReport {
  const byName = new Map<string, Record<AgingBucket, Fils>>();
  const documents: AgingDocument[] = [];
  const tot: Record<AgingBucket, Fils> = { current: 0, days30: 0, days60: 0, days90: 0, over90: 0 };
  for (const d of docs) {
    const open = Number(d.open_fils);
    if (open <= 0) continue;
    const bucket = bucketOf(Number(d.days));
    const row = byName.get(d.name) ?? { current: 0, days30: 0, days60: 0, days90: 0, over90: 0 };
    row[bucket] += open;
    tot[bucket] += open;
    byName.set(d.name, row);
    documents.push({
      documentId: d.id,
      number: d.number,
      name: d.name,
      date: d.date,
      dueDate: d.due,
      currency: d.currency,
      daysPastDue: Math.max(0, Number(d.days)),
      bucket,
      open: aed(open),
    });
  }
  const sumB = (r: Record<AgingBucket, Fils>) =>
    r.current + r.days30 + r.days60 + r.days90 + r.over90;
  const rows: AgingRow[] = Array.from(byName.entries())
    .map(([name, r]) => ({
      id: `${kind}:${name}`,
      name,
      type: kind,
      current: aed(r.current),
      days30: aed(r.days30),
      days60: aed(r.days60),
      days90: aed(r.days90),
      over90: aed(r.over90),
      total: aed(sumB(r)),
      currency: reportCurrency,
    }))
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  const totalFils = sumB(tot);
  const netFils = totalFils - unappliedFils;
  const adjustedFils = netFils + control.fxFils;
  return {
    reportCurrency,
    asOf,
    type: kind,
    rows,
    documents,
    totals: {
      current: aed(tot.current),
      days30: aed(tot.days30),
      days60: aed(tot.days60),
      days90: aed(tot.days90),
      over90: aed(tot.over90),
      total: aed(totalFils),
    },
    unappliedCredits: aed(unappliedFils),
    netTotal: aed(netFils),
    fxRevaluation: aed(control.fxFils),
    allowanceForDoubtfulDebts: aed(allowanceFils),
    netCarryingAmount: aed(adjustedFils - allowanceFils),
    reconciliation: {
      controlAccountCode: control.code,
      controlAccountName: control.name,
      glBalance: aed(control.fils),
      agingTotal: aed(netFils),
      reconcilingItems:
        control.fxFils !== 0
          ? [
              {
                key: "fx_revaluation",
                label: "Unrealised FX revaluation at the report date",
                labelAr: "إعادة تقييم العملات الأجنبية غير المحققة في تاريخ التقرير",
                amount: aed(control.fxFils),
              },
            ]
          : [],
      adjustedAgingTotal: aed(adjustedFils),
      difference: aed(control.fils - adjustedFils),
      isReconciled: control.fils === adjustedFils,
      controlAdjustments: aed(control.adjustmentsFils),
      unexplainedDifference: aed(control.fils - adjustedFils - control.adjustmentsFils),
    },
  };
}

const LOCAL = localDateSql;
const AS_OF = { asOf: "$2::date" };

const AGED_PAYABLES_SQL = `SELECT co.base_currency,
            (SELECT row_to_json(control) FROM (${CONTROL_BALANCE_SQL}) control) AS control_balance,
            (${unappliedPayableCreditsFilsSql("$1", AS_OF)})::text AS unapplied_fils,
            COALESCE((
              SELECT json_agg(doc) FROM (
                SELECT b.id, b.vendor_id, b.bill_number AS number,
                       COALESCE(NULLIF(TRIM(b.vendor_name), ''), 'Unknown Vendor') AS name,
                       ${LOCAL("b.bill_date")}::text AS date,
                       COALESCE(${LOCAL("b.due_date")}, ${LOCAL("b.bill_date")})::text AS due,
                       COALESCE(b.currency, co.base_currency) AS currency,
                       ($2::date - COALESCE(${LOCAL("b.due_date")}, ${LOCAL("b.bill_date")})) AS days,
                       (${payableOpenBaseFilsSql("b", AS_OF)})::text AS open_fils
                  FROM vendor_bills b
                 WHERE b.company_id = co.id
                   AND ${payableStatusSql("b")}
                   AND ${LOCAL("b.bill_date")} <= $2::date
                 ORDER BY b.bill_date, b.bill_number
              ) doc
            ), '[]'::json) AS payable_documents
       FROM companies co WHERE co.id = $1`;

async function unappliedFils(
  expr: string,
  companyId: string,
  asOf: IsoDate,
  q: Queryable
): Promise<Fils> {
  const { rows } = await q.query(`SELECT (${expr})::text AS fils`, [companyId, asOf]);
  return Number((rows[0] as { fils?: string } | undefined)?.fils ?? 0);
}

export async function agedReceivables(
  args: { companyId: string; asOf: IsoDate },
  q: Queryable = pool
): Promise<AgingReport> {
  const { companyId, asOf } = args;
  const [{ rows }, control, unapplied, allowance, reportCurrency] = await runReportReads(
    q,
    () =>
      q.query(
        `SELECT i.id, i.number, COALESCE(NULLIF(TRIM(i.customer_name), ''), 'Unknown Customer') AS name,
              ${LOCAL("i.date")}::text AS date,
              COALESCE(${LOCAL("i.due_date")}, ${LOCAL("i.date")} + 30)::text AS due,
              COALESCE(i.currency, co.base_currency) AS currency,
              ($2::date - COALESCE(${LOCAL("i.due_date")}, ${LOCAL("i.date")} + 30)) AS days,
              ${receivableOpenBaseFilsSql("i", AS_OF)} AS open_fils
         FROM invoices i
         JOIN companies co ON co.id = i.company_id
        WHERE i.company_id = $1
          AND ${receivableStatusSql("i")}
          AND COALESCE(i.invoice_type, 'invoice') <> 'credit_note'
          AND ${LOCAL("i.date")} <= $2::date
        ORDER BY i.date, i.number`,
        [companyId, asOf]
      ),
    () => controlBalance(companyId, asOf, "receivable", q),
    () => unappliedFils(unappliedReceivableCreditsFilsSql("$1", AS_OF), companyId, asOf, q),
    () => allowanceForDoubtfulDebtsFils(companyId, asOf, q),
    () => reportCurrencyOf(companyId, q)
  );
  return build(
    "receivable",
    asOf,
    rows as AgingDocRows,
    control,
    reportCurrency,
    unapplied,
    allowance
  );
}

export async function agedPayables(
  args: { companyId: string; asOf: IsoDate },
  q: Queryable = pool
): Promise<AgingReport> {
  return (await agedPayablesWithVendors(args, q)).report;
}

/**
 * agedPayables plus the vendor id of each aged bill (document id -> vendor id, bills with a
 * vendor record only). The vendor id rides the aging query itself, so the by-vendor A/P view
 * needs no second read of the bills table (PERF-AGING).
 */
export async function agedPayablesWithVendors(
  args: { companyId: string; asOf: IsoDate },
  q: Queryable = pool
): Promise<{ report: AgingReport; vendorOf: Map<string, string> }> {
  const { companyId, asOf } = args;
  // Share a pool checkout and statement snapshot across the bills, credits and ledger totals.
  const values = [companyId, asOf, ...CONTROL_ACCOUNT.payable];
  // Let PostgreSQL reuse parsing and, when it selects a generic plan, planning on pooled sessions.
  const { rows } =
    q === pool && getPoolStats().driver === "pg"
      ? await pool.query({ name: "aged_payables_with_vendors", text: AGED_PAYABLES_SQL, values })
      : await q.query(AGED_PAYABLES_SQL, values);
  const result = rows[0] as PayableAgingRow | undefined;
  if (!result) throw new DomainError("COMPANY_NOT_FOUND", 404);

  const report = build(
    "payable",
    asOf,
    result.payable_documents,
    readControlBalance(result.control_balance, "payable"),
    baseCurrencyOf({ baseCurrency: result.base_currency }),
    Number(result.unapplied_fils)
  );
  const vendorOf = new Map<string, string>();
  for (const r of result.payable_documents) {
    if (r.vendor_id) vendorOf.set(r.id, r.vendor_id);
  }
  return { report, vendorOf };
}
