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
import { pool } from "../db";
import {
  localDateSql,
  payableOpenBaseFilsSql,
  payableStatusSql,
  receivableOpenBaseFilsSql,
  receivableStatusSql,
  unappliedPayableCreditsFilsSql,
  unappliedReceivableCreditsFilsSql,
} from "./settlement";
import {
  ENTRY_LOCAL_DATE_SQL,
  accountTotals,
  aed,
  loadAccounts,
  reportCurrencyOf,
  type Fils,
  type Queryable,
} from "./ledger-query";
import type { IsoDate } from "./dates";

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
  reconciliation: {
    controlAccountCode: string | null;
    controlAccountName: string | null;
    glBalance: number;
    agingTotal: number;
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

async function controlBalance(
  companyId: string,
  asOf: IsoDate,
  kind: "receivable" | "payable",
  q: Queryable
): Promise<{ code: string | null; name: string | null; fils: Fils; adjustmentsFils: Fils }> {
  const accounts = await loadAccounts(companyId, q);
  const code = kind === "receivable" ? "1040" : "2010";
  const re = kind === "receivable" ? /receivable/i : /payable/i;
  const acct =
    accounts.find((a) => a.code === code) ??
    accounts.find(
      (a) =>
        a.type === (kind === "receivable" ? "asset" : "liability") &&
        re.test(a.nameEn) &&
        !/vat|tax/i.test(a.nameEn)
    );
  if (!acct) return { code: null, name: null, fils: 0, adjustmentsFils: 0 };
  const [totals, adj] = await Promise.all([
    accountTotals(companyId, { to: asOf }, q),
    q.query(
      `SELECT COALESCE(SUM(ROUND(jl.debit * 100) - ROUND(jl.credit * 100)), 0)::text AS fils
         FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
        WHERE je.company_id = $1 AND je.status = 'posted' AND jl.account_id = $2
          AND je.control_adjustment_reason IS NOT NULL
          AND ${ENTRY_LOCAL_DATE_SQL} <= $3::date`,
      [companyId, acct.id, asOf]
    ),
  ]);
  const t = totals.get(acct.id);
  const fils = t ? (kind === "receivable" ? t.debit - t.credit : t.credit - t.debit) : 0;
  const net = Number((adj.rows[0] as { fils?: string } | undefined)?.fils ?? 0);
  const adjustmentsFils = kind === "receivable" ? net : -net;
  return { code: acct.code, name: acct.nameEn, fils, adjustmentsFils };
}

/** Open-document rows the aging SQL returns (typed at the driver boundary). */
type AgingDocRows = Parameters<typeof build>[2];

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
  control: { code: string | null; name: string | null; fils: Fils; adjustmentsFils: Fils },
  reportCurrency: string,
  unappliedFils: Fils
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
    reconciliation: {
      controlAccountCode: control.code,
      controlAccountName: control.name,
      glBalance: aed(control.fils),
      agingTotal: aed(netFils),
      difference: aed(control.fils - netFils),
      isReconciled: control.fils === netFils,
      controlAdjustments: aed(control.adjustmentsFils),
      unexplainedDifference: aed(control.fils - netFils - control.adjustmentsFils),
    },
  };
}

const LOCAL = localDateSql;
const AS_OF = { asOf: "$2::date" };

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
  const [{ rows }, control, unapplied] = await Promise.all([
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
    controlBalance(companyId, asOf, "receivable", q),
    unappliedFils(unappliedReceivableCreditsFilsSql("$1", AS_OF), companyId, asOf, q),
  ]);
  return build(
    "receivable",
    asOf,
    rows as AgingDocRows,
    control,
    await reportCurrencyOf(companyId, q),
    unapplied
  );
}

export async function agedPayables(
  args: { companyId: string; asOf: IsoDate },
  q: Queryable = pool
): Promise<AgingReport> {
  const { companyId, asOf } = args;
  const [{ rows }, control, unapplied] = await Promise.all([
    q.query(
      `SELECT b.id, b.bill_number AS number, COALESCE(NULLIF(TRIM(b.vendor_name), ''), 'Unknown Vendor') AS name,
              ${LOCAL("b.bill_date")}::text AS date,
              COALESCE(${LOCAL("b.due_date")}, ${LOCAL("b.bill_date")})::text AS due,
              COALESCE(b.currency, co.base_currency) AS currency,
              ($2::date - COALESCE(${LOCAL("b.due_date")}, ${LOCAL("b.bill_date")})) AS days,
              ${payableOpenBaseFilsSql("b", AS_OF)} AS open_fils
         FROM vendor_bills b
         JOIN companies co ON co.id = b.company_id
        WHERE b.company_id = $1
          AND ${payableStatusSql("b")}
          AND ${LOCAL("b.bill_date")} <= $2::date
        ORDER BY b.bill_date, b.bill_number`,
      [companyId, asOf]
    ),
    controlBalance(companyId, asOf, "payable", q),
    unappliedFils(unappliedPayableCreditsFilsSql("$1", AS_OF), companyId, asOf, q),
  ]);
  return build(
    "payable",
    asOf,
    rows as AgingDocRows,
    control,
    await reportCurrencyOf(companyId, q),
    unapplied
  );
}
