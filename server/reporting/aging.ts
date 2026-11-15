/**
 * Aged receivables / payables reconstructed AS OF a date (R11-07, R11-15):
 * documents dated on or before asOf, less payments (and issued credit notes)
 * dated on or before asOf, converted at the document's booking rate and
 * rounded to fils per document. A reconciliation line ties the aging total to
 * the GL control account (1040 A/R, 2010 A/P) at the same date.
 */
import { pool } from "../db";
import { accountTotals, aed, loadAccounts, type Fils, type Queryable } from "./ledger-query";
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
  currency: "AED";
}

export interface AgingReport {
  reportCurrency: "AED";
  asOf: IsoDate;
  type: "receivable" | "payable";
  rows: AgingRow[];
  documents: AgingDocument[];
  totals: Omit<AgingRow, "id" | "name" | "type" | "currency">;
  reconciliation: {
    controlAccountCode: string | null;
    controlAccountName: string | null;
    glBalance: number;
    agingTotal: number;
    difference: number;
    isReconciled: boolean;
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
): Promise<{ code: string | null; name: string | null; fils: Fils }> {
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
  if (!acct) return { code: null, name: null, fils: 0 };
  const t = (await accountTotals(companyId, { to: asOf }, q)).get(acct.id);
  const fils = t ? (kind === "receivable" ? t.debit - t.credit : t.credit - t.debit) : 0;
  return { code: acct.code, name: acct.nameEn, fils };
}

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
  control: { code: string | null; name: string | null; fils: Fils }
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
      currency: "AED" as const,
    }))
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  const totalFils = sumB(tot);
  return {
    reportCurrency: "AED",
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
    reconciliation: {
      controlAccountCode: control.code,
      controlAccountName: control.name,
      glBalance: aed(control.fils),
      agingTotal: aed(totalFils),
      difference: aed(control.fils - totalFils),
      isReconciled: control.fils === totalFils,
    },
  };
}

const LOCAL = (col: string) => `((${col} + interval '4 hours')::date)`;

export async function agedReceivables(
  args: { companyId: string; asOf: IsoDate },
  q: Queryable = pool
): Promise<AgingReport> {
  const { companyId, asOf } = args;
  const [{ rows }, control] = await Promise.all([
    q.query(
      `WITH paid AS (
         SELECT invoice_id, SUM(amount) AS amt FROM invoice_payments
          WHERE company_id = $1 AND ${LOCAL("date")} <= $2::date GROUP BY invoice_id
       ), credited AS (
         SELECT invoice_id, SUM(total) AS amt FROM credit_notes
          WHERE company_id = $1 AND status = 'issued' AND invoice_id IS NOT NULL
            AND ${LOCAL("date")} <= $2::date GROUP BY invoice_id
       )
       SELECT i.id, i.number, COALESCE(NULLIF(TRIM(i.customer_name), ''), 'Unknown Customer') AS name,
              ${LOCAL("i.date")}::text AS date,
              COALESCE(${LOCAL("i.due_date")}, ${LOCAL("i.date")} + 30)::text AS due,
              COALESCE(i.currency, 'AED') AS currency,
              ($2::date - COALESCE(${LOCAL("i.due_date")}, ${LOCAL("i.date")} + 30)) AS days,
              ROUND(GREATEST(i.total - COALESCE(p.amt, 0) - COALESCE(c.amt, 0), 0)
                    * COALESCE(NULLIF(i.exchange_rate, 0), 1) * 100)::bigint AS open_fils
         FROM invoices i
         LEFT JOIN paid p ON p.invoice_id = i.id
         LEFT JOIN credited c ON c.invoice_id = i.id
        WHERE i.company_id = $1
          AND i.status NOT IN ('draft', 'void', 'cancelled')
          AND ${LOCAL("i.date")} <= $2::date
        ORDER BY i.date, i.number`,
      [companyId, asOf]
    ),
    controlBalance(companyId, asOf, "receivable", q),
  ]);
  return build("receivable", asOf, rows, control);
}

export async function agedPayables(
  args: { companyId: string; asOf: IsoDate },
  q: Queryable = pool
): Promise<AgingReport> {
  const { companyId, asOf } = args;
  const [{ rows }, control] = await Promise.all([
    q.query(
      `WITH paid AS (
         SELECT bp.bill_id, SUM(bp.amount) AS amt FROM bill_payments bp
           JOIN vendor_bills vb ON vb.id = bp.bill_id
          WHERE vb.company_id = $1 AND ${LOCAL("bp.payment_date")} <= $2::date GROUP BY bp.bill_id
       )
       SELECT b.id, b.bill_number AS number, COALESCE(NULLIF(TRIM(b.vendor_name), ''), 'Unknown Vendor') AS name,
              ${LOCAL("b.bill_date")}::text AS date,
              COALESCE(${LOCAL("b.due_date")}, ${LOCAL("b.bill_date")})::text AS due,
              COALESCE(b.currency, 'AED') AS currency,
              ($2::date - COALESCE(${LOCAL("b.due_date")}, ${LOCAL("b.bill_date")})) AS days,
              ROUND(GREATEST(COALESCE(b.total_amount, 0) - COALESCE(p.amt, 0), 0)
                    * COALESCE(NULLIF(b.exchange_rate, 0), 1) * 100)::bigint AS open_fils
         FROM vendor_bills b
         LEFT JOIN paid p ON p.bill_id = b.id
        WHERE b.company_id = $1
          AND COALESCE(b.status, 'pending') NOT IN ('draft', 'pending', 'void', 'cancelled', 'rejected')
          AND ${LOCAL("b.bill_date")} <= $2::date
        ORDER BY b.bill_date, b.bill_number`,
      [companyId, asOf]
    ),
    controlBalance(companyId, asOf, "payable", q),
  ]);
  return build("payable", asOf, rows, control);
}
