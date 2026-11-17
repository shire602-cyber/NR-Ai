/**
 * Rule-based anomaly detection (W3-E: R13-14, R13-15, R13-30, R13-31).
 *
 * Every rule is a set-based SQL query (no per-entry round trips) and returns
 * real transaction facts: amount, transaction date, related entity. This is a
 * deterministic rules engine; it does not use machine learning. The
 * cross-period rule compares the current month against a trailing-month
 * z-score baseline.
 */
import { pool } from "../db";
import { anomalyCopy, type CopyDescriptor } from "../../shared/server-copy";
import {
  ENTRY_LOCAL_DATE_SQL,
  NOT_CLOSING_SQL,
  aed,
  monthStart,
  addMonths,
  uaeToday,
  type Queryable,
} from "../reporting";

const db: Queryable = pool as unknown as Queryable;

export type AnomalySeverity = "critical" | "warning" | "info";

export type AnomalyRule =
  | "duplicate_amount"
  | "unusual_amount"
  | "weekend_transaction"
  | "round_number"
  | "duplicate_vendor"
  | "duplicate_supplier_invoice"
  | "vat_rate_mismatch"
  | "trn_missing"
  | "trn_malformed"
  | "cross_period_baseline";

export interface Anomaly {
  id: string;
  type: AnomalyRule;
  rule: AnomalyRule;
  severity: AnomalySeverity;
  /** English sentence (stored on the alert and kept in the API for compatibility). */
  description: string;
  /** The same sentence as a message key + params; the client renders it from its catalogs. */
  message: CopyDescriptor;
  /** Real transaction amount in AED. */
  amount: number;
  /** Real transaction date (UAE calendar date, YYYY-MM-DD). */
  date: string;
  relatedId: string | null;
  relatedType: "journal_entry" | "receipt" | "invoice" | "vendor_bill" | "account";
  /** Stable per transaction + rule so rescans never duplicate alerts. */
  dedupeKey: string;
}

export interface AnomalySummary {
  total: number;
  critical: number;
  warning: number;
  info: number;
}

export interface AnomalyDetectionResult {
  anomalies: Anomaly[];
  summary: AnomalySummary;
  scannedAt: string;
}

// Thresholds chosen to clear typical operational noise while still catching
// material accounting errors.
export const THRESHOLDS = {
  MIN_DUPLICATE_AMOUNT: 100,
  UNUSUAL_RECEIPT_RATIO: 5,
  UNUSUAL_INVOICE_RATIO: 4,
  MIN_UNUSUAL_ABSOLUTE: 1000,
  MIN_SAMPLE: 5,
  MIN_WEEKEND_AMOUNT: 1000,
  MIN_ROUND_NUMBER_AMOUNT: 5000,
  DUPLICATE_VENDOR_DAYS: 7,
  ZSCORE: 2,
  MIN_BASELINE_MONTHS: 3,
  MIN_BASELINE_MEAN: 1000,
  VAT_TOLERANCE: 0.02,
} as const;

/** `{ description, message }` for one anomaly: the English sentence and its key + params. */
const copy = (key: string, params: Record<string, string | number>) => {
  const { text, message } = anomalyCopy(key, params);
  return { description: text, message };
};

const money = (n: number) =>
  n.toLocaleString("en-AE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ds = (v: unknown) => String(v).slice(0, 10);

/** Pure: z-score of `value` against a trailing baseline, or null when the baseline is unusable. */
export function zScore(
  baseline: number[],
  value: number
): { z: number; mean: number; std: number } | null {
  if (baseline.length < THRESHOLDS.MIN_BASELINE_MONTHS) return null;
  const mean = baseline.reduce((a, b) => a + b, 0) / baseline.length;
  const variance = baseline.reduce((a, b) => a + (b - mean) ** 2, 0) / baseline.length;
  const std = Math.sqrt(variance);
  if (std === 0) return null;
  return { z: (value - mean) / std, mean, std };
}

/** receipts.date is a timestamp; compare on the UAE calendar date. */
const RECEIPT_DATE_SQL = `((date + interval '4 hours')::date)`;

async function duplicateAmounts(companyId: string, out: Anomaly[]) {
  const receipts = await db.query(
    `SELECT ${RECEIPT_DATE_SQL}::text AS d, amount, COUNT(*)::int AS n, (array_agg(id ORDER BY created_at))[1] AS first_id,
            string_agg(COALESCE(merchant, 'Unknown'), ', ') AS merchants
       FROM receipts
      WHERE company_id = $1 AND amount >= $2 AND date IS NOT NULL
      GROUP BY ${RECEIPT_DATE_SQL}, amount HAVING COUNT(*) > 1`,
    [companyId, THRESHOLDS.MIN_DUPLICATE_AMOUNT]
  );
  for (const r of receipts.rows) {
    out.push({
      id: "",
      type: "duplicate_amount",
      rule: "duplicate_amount",
      severity: "warning",
      ...copy("anomaly.duplicateReceipts", {
        n: r.n,
        amount: money(Number(r.amount)),
        date: ds(r.d),
        merchants: r.merchants,
      }),
      amount: Number(r.amount),
      date: ds(r.d),
      relatedId: r.first_id,
      relatedType: "receipt",
      dedupeKey: `duplicate_amount:receipt:${r.first_id}`,
    });
  }
  const invoices = await db.query(
    `SELECT ((date + interval '4 hours')::date)::text AS d, total, COUNT(*)::int AS n,
            (array_agg(id ORDER BY created_at))[1] AS first_id,
            string_agg(customer_name, ', ') AS customers
       FROM invoices
      WHERE company_id = $1 AND total >= $2 AND status NOT IN ('void', 'cancelled', 'draft')
      GROUP BY 1, total HAVING COUNT(*) > 1`,
    [companyId, THRESHOLDS.MIN_DUPLICATE_AMOUNT]
  );
  for (const r of invoices.rows) {
    out.push({
      id: "",
      type: "duplicate_amount",
      rule: "duplicate_amount",
      severity: "warning",
      ...copy("anomaly.duplicateInvoices", {
        n: r.n,
        amount: money(Number(r.total)),
        date: ds(r.d),
        customers: r.customers,
      }),
      amount: Number(r.total),
      date: ds(r.d),
      relatedId: r.first_id,
      relatedType: "invoice",
      dedupeKey: `duplicate_amount:invoice:${r.first_id}`,
    });
  }
}

async function unusualAmounts(companyId: string, out: Anomaly[]) {
  const receipts = await db.query(
    `WITH s AS (
       SELECT AVG(amount) AS avg_amt, COUNT(*) AS n FROM receipts WHERE company_id = $1 AND amount > 0
     )
     SELECT r.id, r.merchant, r.amount, ((r.date + interval '4 hours')::date)::text AS d, s.avg_amt
       FROM receipts r, s
      WHERE r.company_id = $1 AND s.n >= $2 AND r.amount > GREATEST(s.avg_amt * $3, $4)`,
    [
      companyId,
      THRESHOLDS.MIN_SAMPLE,
      THRESHOLDS.UNUSUAL_RECEIPT_RATIO,
      THRESHOLDS.MIN_UNUSUAL_ABSOLUTE,
    ]
  );
  for (const r of receipts.rows) {
    out.push({
      id: "",
      type: "unusual_amount",
      rule: "unusual_amount",
      severity: "critical",
      ...copy("anomaly.unusualReceipt", {
        merchant: r.merchant || "Unknown",
        amount: money(Number(r.amount)),
        ratio: (Number(r.amount) / Number(r.avg_amt)).toFixed(1),
        average: money(Number(r.avg_amt)),
      }),
      amount: Number(r.amount),
      date: r.d ? ds(r.d) : uaeToday(),
      relatedId: r.id,
      relatedType: "receipt",
      dedupeKey: `unusual_amount:receipt:${r.id}`,
    });
  }
  const invoices = await db.query(
    `WITH s AS (
       SELECT AVG(total) AS avg_amt, COUNT(*) AS n FROM invoices
        WHERE company_id = $1 AND total > 0 AND status NOT IN ('void', 'cancelled', 'draft')
     )
     SELECT i.id, i.number, i.customer_name, i.total, ((i.date + interval '4 hours')::date)::text AS d, s.avg_amt
       FROM invoices i, s
      WHERE i.company_id = $1 AND s.n >= $2 AND i.status NOT IN ('void', 'cancelled', 'draft')
        AND i.total > GREATEST(s.avg_amt * $3, $4)`,
    [
      companyId,
      THRESHOLDS.MIN_SAMPLE,
      THRESHOLDS.UNUSUAL_INVOICE_RATIO,
      THRESHOLDS.MIN_UNUSUAL_ABSOLUTE,
    ]
  );
  for (const r of invoices.rows) {
    out.push({
      id: "",
      type: "unusual_amount",
      rule: "unusual_amount",
      severity: "warning",
      ...copy("anomaly.unusualInvoice", {
        number: r.number,
        customer: r.customer_name,
        amount: money(Number(r.total)),
        ratio: (Number(r.total) / Number(r.avg_amt)).toFixed(1),
      }),
      amount: Number(r.total),
      date: ds(r.d),
      relatedId: r.id,
      relatedType: "invoice",
      dedupeKey: `unusual_amount:invoice:${r.id}`,
    });
  }
}

async function weekendEntries(companyId: string, out: Anomaly[]) {
  // UAE weekend is Saturday/Sunday since January 2022; dates are UAE local.
  const { rows } = await db.query(
    `SELECT je.id, je.entry_number, ${ENTRY_LOCAL_DATE_SQL}::text AS d,
            EXTRACT(DOW FROM ${ENTRY_LOCAL_DATE_SQL})::int AS dow,
            SUM(jl.debit) AS total_debit
       FROM journal_entries je JOIN journal_lines jl ON jl.entry_id = je.id
      WHERE je.company_id = $1 AND je.status = 'posted' AND ${NOT_CLOSING_SQL}
        AND EXTRACT(DOW FROM ${ENTRY_LOCAL_DATE_SQL}) IN (0, 6)
      GROUP BY je.id, je.entry_number, ${ENTRY_LOCAL_DATE_SQL}
     HAVING SUM(jl.debit) >= $2`,
    [companyId, THRESHOLDS.MIN_WEEKEND_AMOUNT]
  );
  for (const r of rows) {
    out.push({
      id: "",
      type: "weekend_transaction",
      rule: "weekend_transaction",
      severity: "info",
      ...copy(r.dow === 6 ? "anomaly.weekendSaturday" : "anomaly.weekendSunday", {
        number: r.entry_number,
        date: ds(r.d),
        amount: money(Number(r.total_debit)),
      }),
      amount: Number(r.total_debit),
      date: ds(r.d),
      relatedId: r.id,
      relatedType: "journal_entry",
      dedupeKey: `weekend_transaction:journal_entry:${r.id}`,
    });
  }
}

async function roundNumbers(companyId: string, out: Anomaly[]) {
  const { rows } = await db.query(
    `SELECT id, merchant, amount, ((date + interval '4 hours')::date)::text AS d FROM receipts
      WHERE company_id = $1 AND amount >= $2 AND MOD(amount::numeric, 1000) = 0`,
    [companyId, THRESHOLDS.MIN_ROUND_NUMBER_AMOUNT]
  );
  for (const r of rows) {
    out.push({
      id: "",
      type: "round_number",
      rule: "round_number",
      severity: "info",
      ...copy("anomaly.roundReceipt", {
        merchant: r.merchant || "Unknown",
        amount: money(Number(r.amount)),
      }),
      amount: Number(r.amount),
      date: r.d ? ds(r.d) : uaeToday(),
      relatedId: r.id,
      relatedType: "receipt",
      dedupeKey: `round_number:receipt:${r.id}`,
    });
  }
}

async function duplicateVendors(companyId: string, out: Anomaly[]) {
  const { rows } = await db.query(
    `SELECT id, merchant, amount, d, gap FROM (
       SELECT id, merchant, amount, ${RECEIPT_DATE_SQL}::text AS d,
              ${RECEIPT_DATE_SQL} - LAG(${RECEIPT_DATE_SQL}) OVER (PARTITION BY LOWER(TRIM(merchant)), amount ORDER BY ${RECEIPT_DATE_SQL}) AS gap
         FROM receipts
        WHERE company_id = $1 AND merchant IS NOT NULL AND TRIM(merchant) <> ''
          AND amount >= $2 AND ${RECEIPT_DATE_SQL} IS NOT NULL
     ) t WHERE gap IS NOT NULL AND ABS(gap) <= $3`,
    [companyId, THRESHOLDS.MIN_DUPLICATE_AMOUNT, THRESHOLDS.DUPLICATE_VENDOR_DAYS]
  );
  for (const r of rows) {
    out.push({
      id: "",
      type: "duplicate_vendor",
      rule: "duplicate_vendor",
      severity: "warning",
      ...copy("anomaly.duplicateCharge", {
        merchant: r.merchant,
        amount: money(Number(r.amount)),
        days: Math.ceil(Math.abs(Number(r.gap))),
      }),
      amount: Number(r.amount),
      date: ds(r.d),
      relatedId: r.id,
      relatedType: "receipt",
      dedupeKey: `duplicate_vendor:receipt:${r.id}`,
    });
  }
}

async function duplicateSupplierInvoices(companyId: string, out: Anomaly[]) {
  const { rows } = await db.query(
    `SELECT id, vendor_name, bill_number, total_amount, d FROM (
       SELECT id, vendor_name, bill_number, total_amount, ((bill_date + interval '4 hours')::date)::text AS d,
              ROW_NUMBER() OVER (PARTITION BY LOWER(TRIM(vendor_name)), LOWER(TRIM(bill_number)) ORDER BY created_at, id) AS rn
         FROM vendor_bills
        WHERE company_id = $1 AND bill_number IS NOT NULL AND TRIM(bill_number) <> ''
          AND COALESCE(status, 'pending') NOT IN ('void', 'cancelled', 'rejected')
     ) t WHERE rn > 1`,
    [companyId]
  );
  for (const r of rows) {
    out.push({
      id: "",
      type: "duplicate_supplier_invoice",
      rule: "duplicate_supplier_invoice",
      severity: "critical",
      ...copy("anomaly.duplicateSupplierInvoice", {
        number: r.bill_number,
        vendor: r.vendor_name,
        amount: money(Number(r.total_amount)),
      }),
      amount: Number(r.total_amount),
      date: ds(r.d),
      relatedId: r.id,
      relatedType: "vendor_bill",
      dedupeKey: `duplicate_supplier_invoice:vendor_bill:${r.id}`,
    });
  }
}

async function vatAndTrn(companyId: string, out: Anomaly[]) {
  // UAE standard VAT is 5%; zero-rated and exempt supplies carry no VAT, so only
  // a non-zero VAT amount that is not 5% of the net is a mismatch.
  const tol = THRESHOLDS.VAT_TOLERANCE;
  const inv = await db.query(
    `SELECT id, number, customer_name, subtotal, vat_amount, ((date + interval '4 hours')::date)::text AS d
       FROM invoices
      WHERE company_id = $1 AND status NOT IN ('void', 'cancelled', 'draft')
        AND vat_amount <> 0 AND ABS(vat_amount::numeric - ROUND(subtotal::numeric * 0.05, 2)) > $2`,
    [companyId, tol]
  );
  for (const r of inv.rows) {
    out.push({
      id: "",
      type: "vat_rate_mismatch",
      rule: "vat_rate_mismatch",
      severity: "warning",
      ...copy("anomaly.vatMismatchInvoice", {
        number: r.number,
        customer: r.customer_name,
        vat: money(Number(r.vat_amount)),
        net: money(Number(r.subtotal)),
        expected: money(Math.round(Number(r.subtotal) * 5) / 100),
      }),
      amount: Number(r.vat_amount),
      date: ds(r.d),
      relatedId: r.id,
      relatedType: "invoice",
      dedupeKey: `vat_rate_mismatch:invoice:${r.id}`,
    });
  }
  const rec = await db.query(
    `SELECT id, merchant, amount, vat_amount, ${RECEIPT_DATE_SQL}::text AS d FROM receipts
      WHERE company_id = $1 AND COALESCE(vat_amount, 0) <> 0
        AND ABS(vat_amount::numeric - ROUND(amount::numeric * 0.05, 2)) > $2`,
    [companyId, tol]
  );
  for (const r of rec.rows) {
    out.push({
      id: "",
      type: "vat_rate_mismatch",
      rule: "vat_rate_mismatch",
      severity: "warning",
      ...copy("anomaly.vatMismatchReceipt", {
        merchant: r.merchant || "Unknown",
        vat: money(Number(r.vat_amount)),
        net: money(Number(r.amount)),
      }),
      amount: Number(r.vat_amount),
      date: r.d ? ds(r.d) : uaeToday(),
      relatedId: r.id,
      relatedType: "receipt",
      dedupeKey: `vat_rate_mismatch:receipt:${r.id}`,
    });
  }
  const bills = await db.query(
    `SELECT id, vendor_name, vendor_trn, subtotal, vat_amount, total_amount,
            ((bill_date + interval '4 hours')::date)::text AS d
       FROM vendor_bills
      WHERE company_id = $1 AND COALESCE(status, 'pending') NOT IN ('void', 'cancelled', 'rejected')
        AND COALESCE(vat_amount, 0) <> 0 AND COALESCE(reverse_charge, false) = false
        AND ABS(vat_amount::numeric - ROUND(COALESCE(subtotal, 0)::numeric * 0.05, 2)) > $2`,
    [companyId, tol]
  );
  for (const r of bills.rows) {
    out.push({
      id: "",
      type: "vat_rate_mismatch",
      rule: "vat_rate_mismatch",
      severity: "warning",
      ...copy("anomaly.vatMismatchBill", {
        vendor: r.vendor_name,
        vat: money(Number(r.vat_amount)),
        net: money(Number(r.subtotal)),
      }),
      amount: Number(r.vat_amount),
      date: ds(r.d),
      relatedId: r.id,
      relatedType: "vendor_bill",
      dedupeKey: `vat_rate_mismatch:vendor_bill:${r.id}`,
    });
  }

  // Input VAT claimed without a supplier TRN, and malformed TRNs.
  const trnBills = await db.query(
    `SELECT id, vendor_name, vendor_trn, vat_amount, total_amount, ((bill_date + interval '4 hours')::date)::text AS d
       FROM vendor_bills
      WHERE company_id = $1 AND COALESCE(status, 'pending') NOT IN ('void', 'cancelled', 'rejected')
        AND (
          (COALESCE(vat_amount, 0) > 0 AND (vendor_trn IS NULL OR TRIM(vendor_trn) = ''))
          OR (vendor_trn IS NOT NULL AND TRIM(vendor_trn) <> '' AND vendor_trn !~ '^[0-9]{15}$')
        )`,
    [companyId]
  );
  for (const r of trnBills.rows) {
    const missing = !r.vendor_trn || String(r.vendor_trn).trim() === "";
    const rule: AnomalyRule = missing ? "trn_missing" : "trn_malformed";
    out.push({
      id: "",
      type: rule,
      rule,
      severity: missing ? "warning" : "warning",
      ...(missing
        ? copy("anomaly.trnMissingBill", {
            vendor: r.vendor_name,
            vat: money(Number(r.vat_amount)),
          })
        : copy("anomaly.trnMalformedBill", { vendor: r.vendor_name, trn: r.vendor_trn })),
      amount: Number(r.total_amount ?? 0),
      date: ds(r.d),
      relatedId: r.id,
      relatedType: "vendor_bill",
      dedupeKey: `${rule}:vendor_bill:${r.id}`,
    });
  }
  const trnInv = await db.query(
    `SELECT id, number, customer_name, customer_trn, total, ((date + interval '4 hours')::date)::text AS d
       FROM invoices
      WHERE company_id = $1 AND status NOT IN ('void', 'cancelled', 'draft')
        AND customer_trn IS NOT NULL AND TRIM(customer_trn) <> '' AND customer_trn !~ '^[0-9]{15}$'`,
    [companyId]
  );
  for (const r of trnInv.rows) {
    out.push({
      id: "",
      type: "trn_malformed",
      rule: "trn_malformed",
      severity: "warning",
      ...copy("anomaly.trnMalformedInvoice", {
        number: r.number,
        customer: r.customer_name,
        trn: r.customer_trn,
      }),
      amount: Number(r.total),
      date: ds(r.d),
      relatedId: r.id,
      relatedType: "invoice",
      dedupeKey: `trn_malformed:invoice:${r.id}`,
    });
  }
}

/**
 * Cross-period baseline: each expense account's current-month total against
 * the mean and standard deviation of the trailing completed months.
 */
async function crossPeriodBaseline(companyId: string, out: Anomaly[]) {
  const today = uaeToday();
  const currentKey = today.slice(0, 7);
  const from = addMonths(monthStart(today), -6);
  const { rows } = await db.query(
    `SELECT a.id AS account_id, a.name_en, to_char(${ENTRY_LOCAL_DATE_SQL}, 'YYYY-MM') AS ym,
            COALESCE(SUM(ROUND((jl.debit - jl.credit) * 100)), 0)::bigint AS fils
       FROM journal_lines jl
       JOIN journal_entries je ON je.id = jl.entry_id
       JOIN accounts a ON a.id = jl.account_id
      WHERE je.company_id = $1 AND je.status = 'posted' AND a.type = 'expense' AND ${NOT_CLOSING_SQL}
        AND ${ENTRY_LOCAL_DATE_SQL} >= $2::date AND ${ENTRY_LOCAL_DATE_SQL} <= $3::date
      GROUP BY 1, 2, 3`,
    [companyId, from, today]
  );
  const byAccount = new Map<string, { name: string; months: Map<string, number> }>();
  for (const r of rows) {
    const e = byAccount.get(r.account_id) ?? { name: r.name_en, months: new Map() };
    e.months.set(r.ym, aed(Number(r.fils)));
    byAccount.set(r.account_id, e);
  }
  // Trailing baseline = the months with activity among the six completed months before this one.
  const baselineKeys: string[] = [];
  for (let i = 1; i <= 6; i++) baselineKeys.push(addMonths(monthStart(today), -i).slice(0, 7));
  for (const [accountId, e] of byAccount) {
    const current = e.months.get(currentKey) ?? 0;
    const present = baselineKeys.filter((k) => e.months.has(k));
    const baseline = present.map((k) => e.months.get(k) ?? 0);
    if (present.length < THRESHOLDS.MIN_BASELINE_MONTHS) continue;
    const z = zScore(baseline, current);
    if (!z || z.mean < THRESHOLDS.MIN_BASELINE_MEAN || z.z < THRESHOLDS.ZSCORE) continue;
    out.push({
      id: "",
      type: "cross_period_baseline",
      rule: "cross_period_baseline",
      severity: z.z >= 3 ? "critical" : "warning",
      ...copy("anomaly.baselineSpike", {
        account: e.name,
        amount: money(current),
        z: z.z.toFixed(1),
        months: baseline.length,
        mean: money(z.mean),
      }),
      amount: current,
      date: today,
      relatedId: accountId,
      relatedType: "account",
      dedupeKey: `cross_period_baseline:account:${accountId}:${currentKey}`,
    });
  }
}

export async function detectAnomalies(companyId: string): Promise<AnomalyDetectionResult> {
  const anomalies: Anomaly[] = [];
  await Promise.all([
    duplicateAmounts(companyId, anomalies),
    unusualAmounts(companyId, anomalies),
    weekendEntries(companyId, anomalies),
    roundNumbers(companyId, anomalies),
    duplicateVendors(companyId, anomalies),
    duplicateSupplierInvoices(companyId, anomalies),
    vatAndTrn(companyId, anomalies),
    crossPeriodBaseline(companyId, anomalies),
  ]);

  const severityOrder: Record<AnomalySeverity, number> = { critical: 0, warning: 1, info: 2 };
  anomalies.sort(
    (a, b) => severityOrder[a.severity] - severityOrder[b.severity] || b.date.localeCompare(a.date)
  );
  anomalies.forEach((a, i) => {
    a.id = `anomaly-${i + 1}`;
  });
  return {
    anomalies,
    summary: {
      total: anomalies.length,
      critical: anomalies.filter((a) => a.severity === "critical").length,
      warning: anomalies.filter((a) => a.severity === "warning").length,
      info: anomalies.filter((a) => a.severity === "info").length,
    },
    scannedAt: new Date().toISOString(),
  };
}
