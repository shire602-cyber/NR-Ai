// Sales and receivables reports (Phase 8 D4): ageing, balances, open items, status, revenue by customer, sales by line,
// payments received, credit notes and refunds, quotes and recurring invoices. Documents are read in the company's
// currency (AED) at the rate booked on each document; open balances use the as-of rules of aging-as-of.service.ts.

import { asOfParams, invoiceOutstandingAsOfSql, receivableAgingAsOfSql, standingSql } from "../../services/aging-as-of.service";
import { getRefundSummary } from "../../services/customer-refund.service";
import { round2 } from "../../services/financial-statements";
import { dayBounds, dayEndTs, ymdSql } from "../dates";
import { SqlParams, money } from "../ledger";
import { registerReport, type ReportContext, type ReportOutput } from "../registry";
import { C, col, detail, moneyCol, pick, section, subtotal, sumMoney } from "./helpers";

const RATE = (a: string) => `COALESCE(NULLIF(${a}.exchange_rate, 0), 1)`;
const asOfOf = (ctx: ReportContext) => ctx.window.asOf as string;
const agingParams = (ctx: ReportContext) => asOfParams(ctx.companyId, { ymd: asOfOf(ctx), dayEnd: dayEndTs(asOfOf(ctx)) });

// ---------------------------------------------------------------------------------------------------------------
// A/R Aging (by customer) and A/P Aging share one shape
// ---------------------------------------------------------------------------------------------------------------

export const agingColumns = (who: "customer" | "vendor") => [
  col(who, who === "customer" ? "Customer" : "Vendor", who === "customer" ? "العميل" : "المورد"),
  moneyCol("current", "Current", "حالي", { sum: true }),
  moneyCol("days1to30", "1-30 days", "1-30 يوماً", { sum: true }),
  moneyCol("days31to60", "31-60 days", "31-60 يوماً", { sum: true }),
  moneyCol("days61to90", "61-90 days", "61-90 يوماً", { sum: true }),
  moneyCol("days90plus", "Over 90 days", "أكثر من 90 يوماً", { sum: true }),
  moneyCol("total", "Total", "الإجمالي", { sum: true }),
];

export function agingRows(rows: any[], who: "customer" | "vendor"): ReportOutput["rows"] {
  return rows.map((r) => {
    const current = money(r.current_balance);
    const d30 = money(r.days_30);
    const d60 = money(r.days_60);
    const d90 = money(r.days_90);
    const over = money(r.over_90);
    return detail(
      `${who}:${String(r.name).toLowerCase()}`,
      { [who]: r.name, current, days1to30: d30, days31to60: d60, days61to90: d90, days90plus: over, total: round2(current + d30 + d60 + d90 + over) },
      { target: who, id: String(r.name) }
    );
  });
}

async function arAging(ctx: ReportContext): Promise<ReportOutput> {
  const { rows } = await ctx.q.query(receivableAgingAsOfSql(), agingParams(ctx));
  return { rows: agingRows(rows, "customer") };
}

registerReport({ id: "ar-aging", noFutureAsOf: true, columns: agingColumns("customer"), run: arAging });

// ---------------------------------------------------------------------------------------------------------------
// Customer Balance Summary (as of): open balance and overdue per customer
// ---------------------------------------------------------------------------------------------------------------

export function openInvoicesCte(): string {
  return `open_invoices AS (
    SELECT i.id, i.number, COALESCE(NULLIF(TRIM(i.customer_name), ''), 'Unknown Customer') AS name, i.currency, i.total,
           i.date AS inv_date, ${RATE("i")} AS rate,
           ${invoiceOutstandingAsOfSql("i")} AS open_doc,
           COALESCE(i.due_date, i.date + INTERVAL '30 days')::date AS due
      FROM invoices i
     WHERE i.company_id = $1 AND i.invoice_type <> 'credit_note' AND i.status <> 'draft' AND i.date <= $3::timestamp
       AND ${standingSql("i")}
  )`;
}

async function customerBalances(ctx: ReportContext): Promise<ReportOutput> {
  const { rows } = await ctx.q.query(
    `WITH ${openInvoicesCte()}
     SELECT name, COUNT(*) FILTER (WHERE open_doc > 0)::int AS open_count,
            COALESCE(SUM(total * rate), 0)::text AS invoiced,
            COALESCE(SUM(open_doc * rate), 0)::text AS open_aed,
            COALESCE(SUM(open_doc * rate) FILTER (WHERE due < $2::date), 0)::text AS overdue_aed
       FROM open_invoices GROUP BY name HAVING SUM(open_doc * rate) > 0 ORDER BY SUM(open_doc * rate) DESC, name`,
    agingParams(ctx)
  );
  return {
    rows: rows.map((r) =>
      detail(`customer:${String(r.name).toLowerCase()}`, { customer: r.name, invoices: Number(r.open_count), invoiced: money(r.invoiced), open: money(r.open_aed), overdue: money(r.overdue_aed) }, { target: "customer", id: String(r.name) })
    ),
  };
}

registerReport({
  id: "customer-balances",
  noFutureAsOf: true,
  columns: [C.customer, col("invoices", "Open invoices", "فواتير مفتوحة", "number"), moneyCol("invoiced", "Invoiced", "المفوتر"), moneyCol("open", "Open balance (AED)", "الرصيد المفتوح (درهم)", { sum: true }), moneyCol("overdue", "Overdue (AED)", "المتأخر (درهم)", { sum: true })],
  run: customerBalances,
});

// ---------------------------------------------------------------------------------------------------------------
// Receivables Detail (as of): every open invoice
// ---------------------------------------------------------------------------------------------------------------

async function receivablesDetail(ctx: ReportContext): Promise<ReportOutput> {
  const { rows } = await ctx.q.query(
    `WITH ${openInvoicesCte()}
     SELECT id, number, name, currency, total, ${ymdSql("inv_date")} AS d, to_char(due, 'YYYY-MM-DD') AS due_ymd, rate, open_doc,
            GREATEST($2::date - due, 0)::int AS days_overdue
       FROM open_invoices WHERE open_doc > 0 ORDER BY due, number LIMIT ${ctx.maxRows + 1}`,
    agingParams(ctx)
  );
  return {
    rows: rows.map((r) =>
      detail(
        `invoice:${r.id}`,
        {
          date: r.d,
          number: r.number,
          customer: r.name,
          due: r.due_ymd,
          daysOverdue: Number(r.days_overdue),
          currency: r.currency,
          docOpen: money(r.open_doc),
          open: round2(money(r.open_doc) * Number(r.rate)),
        },
        { target: "invoice", id: String(r.id) }
      )
    ),
  };
}

registerReport({
  id: "receivables-detail",
  noFutureAsOf: true,
  columns: [
    C.date,
    C.number,
    C.customer,
    col("due", "Due date", "تاريخ الاستحقاق", "date"),
    col("daysOverdue", "Days overdue", "أيام التأخر", "number"),
    C.currency,
    moneyCol("docOpen", "Open (document)", "المفتوح (المستند)"),
    moneyCol("open", "Open (AED)", "المفتوح (درهم)", { sum: true }),
  ],
  run: receivablesDetail,
});

// ---------------------------------------------------------------------------------------------------------------
// Invoice Status (range): counts and AED totals by status
// ---------------------------------------------------------------------------------------------------------------

async function invoiceStatus(ctx: ReportContext): Promise<ReportOutput> {
  const { from, to } = ctx.window as { from: string; to: string };
  const { start, end } = dayBounds(from, to);
  const b = new SqlParams();
  const { rows } = await ctx.q.query(
    `SELECT i.status, COUNT(*)::int AS cnt, COALESCE(SUM(i.total * ${RATE("i")}), 0)::text AS total_aed
       FROM invoices i
      WHERE i.company_id = ${b.p(ctx.companyId)} AND i.invoice_type NOT IN ('credit_note', 'advance') AND i.date >= ${b.p(start)}::timestamp AND i.date <= ${b.p(end)}::timestamp
      GROUP BY i.status ORDER BY i.status`,
    b.values
  );
  return { rows: rows.map((r) => detail(`status:${r.status}`, { status: r.status, count: Number(r.cnt), total: money(r.total_aed) })) };
}

registerReport({
  id: "invoice-status",
  columns: [C.status, col("count", "Invoices", "الفواتير", "number", { sum: true }), moneyCol("total", "Total (AED)", "الإجمالي (درهم)", { sum: true })],
  run: invoiceStatus,
});

// ---------------------------------------------------------------------------------------------------------------
// Revenue by Customer and Sales by Product/Service (range, comparable): invoice rows net of credit notes
// ---------------------------------------------------------------------------------------------------------------

/**
 * An invoice that counts as revenue of a period ending `$2`: issued (not a draft, not an opening balance) and standing at that day by
 * the date-based void rule of aging-as-of.service.ts: voided on or before the day it no longer counts, voided AFTER it, it did.
 */
const LIVE_INVOICE = (a: string) => `${a}.status <> 'draft' AND COALESCE(${a}.is_opening_balance, false) = false AND ${standingSql(a)}`;

async function revenueByCustomer(ctx: ReportContext): Promise<ReportOutput> {
  const { from, to } = ctx.window as { from: string; to: string };
  const { start, end } = dayBounds(from, to);
  // Revenue is the item, discount and shipping lines. An advance tax invoice is not revenue (it credits 2055) and the
  // advance line on a final invoice only moves 2055 to revenue: both stay out.
  const { rows } = await ctx.q.query(
    `SELECT name, COUNT(DISTINCT id) FILTER (WHERE invoice_type <> 'credit_note')::int AS cnt,
            COALESCE(SUM(net * rate), 0)::text AS revenue, COALESCE(SUM(net * rate * vat_rate), 0)::text AS vat
       FROM (
         SELECT i.id, i.invoice_type, COALESCE(NULLIF(TRIM(i.customer_name), ''), 'Unknown Customer') AS name,
                il.quantity * il.unit_price AS net, COALESCE(il.vat_rate, 0) AS vat_rate, ${RATE("i")} AS rate
           FROM invoices i JOIN invoice_lines il ON il.invoice_id = i.id
          WHERE i.company_id = $1 AND i.invoice_type <> 'advance' AND COALESCE(il.line_kind, 'item') <> 'advance'
            AND ${LIVE_INVOICE("i")} AND i.date >= $3::timestamp AND i.date <= $4::timestamp
       ) x GROUP BY name ORDER BY SUM(net * rate) DESC, name`,
    [ctx.companyId, to, start, end]
  );
  return {
    rows: rows.map((r) =>
      detail(`customer:${String(r.name).toLowerCase()}`, { customer: r.name, invoices: Number(r.cnt), revenue: money(r.revenue), vat: money(r.vat) }, { target: "customer", id: String(r.name) })
    ),
  };
}

registerReport({
  id: "revenue-customer",
  columns: [
    C.customer,
    col("invoices", "Invoices", "الفواتير", "number", { sum: true }),
    moneyCol("revenue", "Revenue (AED, net of credit notes)", "الإيرادات (درهم، بعد إشعارات الدائن)", { comparable: true, sum: true }),
    moneyCol("vat", "VAT (AED)", "الضريبة (درهم)", { sum: true }),
  ],
  run: revenueByCustomer,
});

async function salesProductService(ctx: ReportContext): Promise<ReportOutput> {
  const { from, to } = ctx.window as { from: string; to: string };
  const { start, end } = dayBounds(from, to);
  // A line discount is netted into the item it discounts (parent_line_id); the advance deduction is not a sale.
  const { rows } = await ctx.q.query(
    `SELECT COALESCE(NULLIF(regexp_replace(trim(COALESCE(parent.description, il.description)), '\\s+', ' ', 'g'), ''), 'Unlabeled item') AS item,
            COUNT(DISTINCT il.invoice_id)::int AS invoices,
            COALESCE(SUM(il.quantity) FILTER (WHERE COALESCE(il.line_kind, 'item') = 'item'), 0)::text AS qty,
            COALESCE(SUM(il.quantity * il.unit_price * ${RATE("i")}), 0)::text AS amount,
            COALESCE(SUM(il.quantity * il.unit_price * ${RATE("i")} * COALESCE(il.vat_rate, 0)), 0)::text AS vat
       FROM invoice_lines il
       JOIN invoices i ON i.id = il.invoice_id
       LEFT JOIN invoice_lines parent ON parent.id = il.parent_line_id AND parent.invoice_id = il.invoice_id
      WHERE i.company_id = $1 AND i.invoice_type <> 'advance' AND COALESCE(il.line_kind, 'item') <> 'advance'
        AND ${LIVE_INVOICE("i")} AND i.date >= $3::timestamp AND i.date <= $4::timestamp
      GROUP BY 1 ORDER BY SUM(il.quantity * il.unit_price * ${RATE("i")}) DESC, 1`,
    [ctx.companyId, to, start, end]
  );
  return {
    rows: rows.map((r) =>
      detail(`item:${String(r.item).toLowerCase()}`, { item: r.item, invoices: Number(r.invoices), quantity: money(r.qty), amount: money(r.amount), vat: money(r.vat) })
    ),
  };
}

registerReport({
  id: "sales-product-service",
  columns: [
    col("item", "Product / service", "المنتج / الخدمة"),
    col("invoices", "Invoices", "الفواتير", "number"),
    col("quantity", "Quantity", "الكمية", "number", { comparable: true }),
    moneyCol("amount", "Sales (AED)", "المبيعات (درهم)", { comparable: true, sum: true }),
    moneyCol("vat", "VAT (AED)", "الضريبة (درهم)", { sum: true }),
  ],
  run: salesProductService,
});

// ---------------------------------------------------------------------------------------------------------------
// Payments Received (range)
// ---------------------------------------------------------------------------------------------------------------

async function paymentsReceived(ctx: ReportContext): Promise<ReportOutput> {
  const { from, to } = ctx.window as { from: string; to: string };
  const { start, end } = dayBounds(from, to);
  const b = new SqlParams();
  const conds = [`ip.company_id = ${b.p(ctx.companyId)}`, `ip.date >= ${b.p(start)}::timestamp`, `ip.date <= ${b.p(end)}::timestamp`, `i.status <> 'draft'`];
  if (ctx.params.filters.contactId) conds.push(`i.contact_id = ${b.p(ctx.params.filters.contactId)}::uuid`);
  const { rows } = await ctx.q.query(
    `SELECT ip.id, i.id AS invoice_id, i.number, COALESCE(NULLIF(TRIM(i.customer_name), ''), 'Unknown Customer') AS customer,
            ${ymdSql("ip.date")} AS d, ip.method, ip.reference, i.currency, ip.amount::text AS amount,
            COALESCE(NULLIF(ip.exchange_rate, 0), NULLIF(i.exchange_rate, 0), 1)::text AS rate
       FROM invoice_payments ip JOIN invoices i ON i.id = ip.invoice_id
      WHERE ${conds.join(" AND ")} ORDER BY ip.date, ip.created_at LIMIT ${ctx.maxRows + 1}`,
    b.values
  );
  return {
    rows: rows.map((r) =>
      detail(
        `payment:${r.id}`,
        {
          date: r.d,
          number: r.number,
          customer: r.customer,
          method: r.method ?? "",
          reference: r.reference ?? "",
          currency: r.currency,
          docAmount: money(r.amount),
          amount: round2(money(r.amount) * Number(r.rate)),
        },
        { target: "invoice", id: String(r.invoice_id) }
      )
    ),
  };
}

registerReport({
  id: "payments-received",
  filters: ["contactId"],
  columns: [
    C.date,
    col("number", "Invoice", "الفاتورة"),
    C.customer,
    col("method", "Method", "الطريقة"),
    C.reference,
    C.currency,
    moneyCol("docAmount", "Amount (document)", "المبلغ (المستند)"),
    moneyCol("amount", "Amount (AED)", "المبلغ (درهم)", { sum: true }),
  ],
  run: paymentsReceived,
});

// ---------------------------------------------------------------------------------------------------------------
// Credit Notes and Refunds (range)
// ---------------------------------------------------------------------------------------------------------------

async function creditNotesRefunds(ctx: ReportContext): Promise<ReportOutput> {
  const { from, to } = ctx.window as { from: string; to: string };
  const { start, end } = dayBounds(from, to);
  const b = new SqlParams();
  const cid = b.p(ctx.companyId);
  const s = b.p(start);
  const e = b.p(end);
  const cns = await ctx.q.query(
    `SELECT cn.id, cn.number, ${ymdSql("cn.date")} AS d, COALESCE(NULLIF(TRIM(cn.customer_name), ''), 'Unknown Customer') AS customer,
            o.number AS original_number, ABS(cn.total * ${RATE("cn")})::text AS amount, ${RATE("cn")}::text AS rate,
            COALESCE((SELECT SUM(r.amount * COALESCE(NULLIF(r.exchange_rate, 0), 1)) FROM customer_refunds r
                       WHERE r.credit_note_id = cn.id AND r.voided_at IS NULL), 0)::text AS refunded
       FROM invoices cn LEFT JOIN invoices o ON o.id = cn.original_invoice_id
      WHERE cn.company_id = ${cid} AND cn.invoice_type = 'credit_note' AND cn.status NOT IN ('void', 'cancelled', 'draft')
        AND cn.date >= ${s}::timestamp AND cn.date <= ${e}::timestamp ORDER BY cn.date, cn.number`,
    b.values
  );
  const b2 = new SqlParams();
  const refunds = await ctx.q.query(
    `SELECT r.id, to_char(r.refund_date, 'YYYY-MM-DD') AS d, r.reference, cn.id AS cn_id, cn.number,
            COALESCE(NULLIF(TRIM(cn.customer_name), ''), 'Unknown Customer') AS customer,
            (r.amount * COALESCE(NULLIF(r.exchange_rate, 0), 1))::text AS amount
       FROM customer_refunds r JOIN invoices cn ON cn.id = r.credit_note_id
      WHERE r.company_id = ${b2.p(ctx.companyId)} AND r.voided_at IS NULL
        AND r.refund_date >= ${b2.p(from)}::date AND r.refund_date <= ${b2.p(to)}::date ORDER BY r.refund_date, r.created_at`,
    b2.values
  );
  // "Still to refund" is the refund route's own figure (getRefundSummary): a credit note on an unpaid invoice offsets the
  // receivable and has nothing to pay back, whatever its total.
  const cnRows = [];
  for (const r of cns.rows) {
    const amount = money(r.amount);
    const refunded = money(r.refunded);
    let remaining = round2(amount - refunded);
    try {
      remaining = round2(Number((await getRefundSummary(ctx.companyId, String(r.id))).refundable) * Number(r.rate));
    } catch {
      /* no refund accounts yet: fall back to total less refunds */
    }
    cnRows.push(detail(
      `cn:${r.id}`,
      { date: r.d, number: r.number, customer: r.customer, reference: r.original_number ?? "", amount, refunded, remaining },
      { target: "credit_note", id: String(r.id) },
      1
    ));
  }
  const refundRows = refunds.rows.map((r) =>
    detail(`refund:${r.id}`, { date: r.d, number: r.number, customer: r.customer, reference: r.reference ?? "", refundAmount: money(r.amount) }, { target: "refund", id: String(r.cn_id) }, 1)
  );
  return {
    rows: [
      section("section:credit-notes", { number: pick(ctx, "Credit notes", "إشعارات الدائن") }),
      ...cnRows,
      section("section:refunds", { number: pick(ctx, "Refunds paid", "المبالغ المستردة المدفوعة") }),
      ...refundRows,
    ],
    totals: {
      amount: sumMoney(cnRows.map((r) => r.cells.amount as number)),
      remaining: sumMoney(cnRows.map((r) => r.cells.remaining as number)),
      refundAmount: sumMoney(refundRows.map((r) => r.cells.refundAmount as number)),
    },
  };
}

registerReport({
  id: "credit-notes-refunds",
  columns: [
    C.date,
    C.number,
    C.customer,
    col("reference", "Original invoice / reference", "الفاتورة الأصلية / المرجع"),
    moneyCol("amount", "Credit note (AED)", "إشعار الدائن (درهم)", { sum: true }),
    moneyCol("refunded", "Refunded (AED)", "المسترد (درهم)"),
    moneyCol("remaining", "Not yet refunded (AED)", "غير المسترد (درهم)", { sum: true }),
    moneyCol("refundAmount", "Refund paid (AED)", "المسترد المدفوع (درهم)", { sum: true }),
  ],
  run: creditNotesRefunds,
});

// ---------------------------------------------------------------------------------------------------------------
// Quotes Status and Conversion (range)
// ---------------------------------------------------------------------------------------------------------------

async function quotesConversion(ctx: ReportContext): Promise<ReportOutput> {
  const { from, to } = ctx.window as { from: string; to: string };
  const { start, end } = dayBounds(from, to);
  const b = new SqlParams();
  const { rows } = await ctx.q.query(
    `SELECT q.id, q.number, ${ymdSql("q.date")} AS d, ${ymdSql("q.expiry_date")} AS exp, COALESCE(NULLIF(TRIM(q.customer_name), ''), 'Unknown Customer') AS customer,
            q.status, q.total::text AS total_aed, i.id AS invoice_id, i.number AS invoice_number
       FROM quotes q LEFT JOIN invoices i ON i.id = q.converted_invoice_id
      WHERE q.company_id = ${b.p(ctx.companyId)} AND q.date >= ${b.p(start)}::timestamp AND q.date <= ${b.p(end)}::timestamp
      ORDER BY q.date, q.number LIMIT ${ctx.maxRows + 1}`,
    b.values
  );
  const detailRows = rows.map((r) =>
    detail(
      `quote:${r.id}`,
      { date: r.d, number: r.number, customer: r.customer, expiry: r.exp ?? "", status: r.status, total: money(r.total_aed), invoice: r.invoice_number ?? "" },
      { target: "quote", id: String(r.id) }
    )
  );
  const converted = rows.filter((r) => r.status === "converted" || r.invoice_id).length;
  const rate = rows.length ? round2((converted / rows.length) * 100) : 0;
  const summary = pick(ctx, `Converted ${converted} of ${rows.length} quotes (${rate}%)`, `تم تحويل ${converted} من ${rows.length} عرض سعر (${rate}%)`);
  return { rows: [...detailRows, subtotal("summary:conversion", { customer: summary })] };
}

registerReport({
  id: "quotes-conversion",
  columns: [
    C.date,
    C.number,
    C.customer,
    col("expiry", "Expiry", "الانتهاء", "date"),
    C.status,
    moneyCol("total", "Total (AED)", "الإجمالي (درهم)", { sum: true }),
    col("invoice", "Invoice", "الفاتورة"),
  ],
  run: quotesConversion,
});

// ---------------------------------------------------------------------------------------------------------------
// Recurring Invoice Schedule (range): templates active in the range
// ---------------------------------------------------------------------------------------------------------------

function templateAmount(linesJson: unknown): number {
  try {
    const lines = JSON.parse(typeof linesJson === "string" ? linesJson : JSON.stringify(linesJson));
    if (!Array.isArray(lines)) return 0;
    let total = 0;
    for (const l of lines) {
      const net = Number(l.quantity ?? 1) * Number(l.unitPrice ?? l.unit_price ?? 0);
      total += net * (1 + Number(l.vatRate ?? l.vat_rate ?? 0));
    }
    return round2(total);
  } catch {
    return 0;
  }
}

async function recurringSchedule(ctx: ReportContext): Promise<ReportOutput> {
  const { from, to } = ctx.window as { from: string; to: string };
  const { start, end } = dayBounds(from, to);
  const b = new SqlParams();
  const { rows } = await ctx.q.query(
    `SELECT r.id, COALESCE(NULLIF(TRIM(r.customer_name), ''), 'Unknown Customer') AS customer, r.frequency, r.currency,
            ${ymdSql("r.start_date")} AS start_d, ${ymdSql("r.next_run_date")} AS next_d, ${ymdSql("r.end_date")} AS end_d,
            r.is_active, COALESCE(r.total_generated, 0)::int AS generated, r.last_generated_invoice_id, r.lines_json
       FROM recurring_invoices r
      WHERE r.company_id = ${b.p(ctx.companyId)} AND r.start_date <= ${b.p(end)}::timestamp AND (r.end_date IS NULL OR r.end_date >= ${b.p(start)}::timestamp)
      ORDER BY r.next_run_date NULLS LAST, r.customer_name LIMIT ${ctx.maxRows + 1}`,
    b.values
  );
  return {
    rows: rows.map((r) =>
      detail(
        `recurring:${r.id}`,
        {
          customer: r.customer,
          frequency: r.frequency,
          start: r.start_d ?? "",
          next: r.next_d ?? "",
          end: r.end_d ?? "",
          status: r.is_active ? pick(ctx, "Active", "نشط") : pick(ctx, "Paused", "متوقف"),
          generated: Number(r.generated),
          amount: templateAmount(r.lines_json),
        },
        r.last_generated_invoice_id ? { target: "invoice", id: String(r.last_generated_invoice_id) } : undefined
      )
    ),
  };
}

registerReport({
  id: "recurring-schedule",
  columns: [
    C.customer,
    col("frequency", "Frequency", "التكرار"),
    col("start", "Start", "البداية", "date"),
    col("next", "Next run", "التشغيل التالي", "date"),
    col("end", "End", "النهاية", "date"),
    C.status,
    col("generated", "Generated", "المُنشأة", "number"),
    moneyCol("amount", "Per invoice (incl. VAT)", "للفاتورة (شاملة الضريبة)"),
  ],
  run: recurringSchedule,
});
