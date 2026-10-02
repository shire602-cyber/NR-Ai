// Purchases and payables reports (Phase 8 D4). A vendor bill counts only once it is posted (approved, partial, paid,
// overdue); pending bills are listed apart in Payables Detail and left out of every total, so payables ageing ties to
// account 2010. Vendors group by their name until D2 adds vendor_id (grouping by COALESCE(vendor_id, name) later).

import {
  asOfParams,
  billDueDateSql,
  billOutstandingAsOfSql,
  payableAgingAsOfSql,
  postedBillSql,
  unappliedCreditAsOfSql,
} from "../../services/aging-as-of.service";
import { round2 } from "../../services/financial-statements";
import { dayBounds, dayEndTs, ymdSql } from "../dates";
import { PL_EXCLUDED_SOURCES, SqlParams, accountBalances, money } from "../ledger";
import { registerReport, type ReportContext, type ReportOutput } from "../registry";
import { C, acctName, col, detail, moneyCol, pick, section, sumMoney } from "./helpers";
import { agingColumns, agingRows } from "./sales";

const RATE = (a: string) => `COALESCE(NULLIF(${a}.exchange_rate, 0), 1)`;
const VENDOR = (a: string) => `COALESCE(NULLIF(TRIM(${a}.vendor_name), ''), 'Unknown Vendor')`;
/** Latest approval request of a bill: pending / approved / rejected / cancelled, with the steps done (e.g. "pending 1/2"). */
const APPROVAL_SQL = (b: string) =>
  `(SELECT ar.status || CASE WHEN ar.status = 'pending' THEN ' ' || ar.completed_steps || '/' || ar.required_steps ELSE '' END
      FROM approval_requests ar WHERE ar.document_type = 'bill' AND ar.document_id = ${b}.id AND ar.company_id = ${b}.company_id
     ORDER BY ar.created_at DESC LIMIT 1)`;
const asOfOf = (ctx: ReportContext) => ctx.window.asOf as string;
const agingParams = (ctx: ReportContext) => asOfParams(ctx.companyId, { ymd: asOfOf(ctx), dayEnd: dayEndTs(asOfOf(ctx)) });

// ---------------------------------------------------------------------------------------------------------------
// A/P Aging and Vendor Balance Summary
// ---------------------------------------------------------------------------------------------------------------

async function apAging(ctx: ReportContext): Promise<ReportOutput> {
  const { rows } = await ctx.q.query(payableAgingAsOfSql(), agingParams(ctx));
  return { rows: agingRows(rows, "vendor") };
}

registerReport({ id: "ap-aging", noFutureAsOf: true, columns: agingColumns("vendor"), run: apAging });

async function vendorBalances(ctx: ReportContext): Promise<ReportOutput> {
  const { rows } = await ctx.q.query(payableAgingAsOfSql(), agingParams(ctx));
  return {
    rows: rows.map((r) => {
      const notDue = money(r.current_balance);
      const overdue = round2(money(r.days_30) + money(r.days_60) + money(r.days_90) + money(r.over_90));
      return detail(
        `vendor:${String(r.name).toLowerCase()}`,
        { vendor: r.name, notDue, overdue, open: round2(notDue + overdue) },
        { target: "vendor", id: String(r.name) }
      );
    }),
  };
}

registerReport({
  id: "vendor-balances",
  noFutureAsOf: true,
  columns: [
    C.vendor,
    moneyCol("notDue", "Not yet due (AED)", "غير مستحق (درهم)", { sum: true }),
    moneyCol("overdue", "Overdue (AED)", "متأخر (درهم)", { sum: true }),
    moneyCol("open", "Open balance (AED)", "الرصيد المفتوح (درهم)", { sum: true }),
  ],
  run: vendorBalances,
});

// ---------------------------------------------------------------------------------------------------------------
// Payables Detail (as of): open posted bills, and the bills still awaiting approval in their own section
// ---------------------------------------------------------------------------------------------------------------

async function payablesDetail(ctx: ReportContext): Promise<ReportOutput> {
  const params = agingParams(ctx);
  const posted = await ctx.q.query(
    `SELECT id, bill_number, vendor, currency, status, ${ymdSql("bill_date")} AS d, to_char(due, 'YYYY-MM-DD') AS due_ymd, rate, open_doc,
            GREATEST($2::date - due, 0)::int AS days_overdue, approval
       FROM (
         SELECT b.id, b.bill_number, ${VENDOR("b")} AS vendor, b.currency, b.status, b.bill_date, ${billDueDateSql("b")} AS due, ${RATE("b")} AS rate,
                ${billOutstandingAsOfSql("b")} AS open_doc, ${APPROVAL_SQL("b")} AS approval
           FROM vendor_bills b
          WHERE b.company_id = $1 AND ${postedBillSql("b")} AND b.bill_date <= $3::timestamp
       ) x WHERE open_doc > 0 ORDER BY due, bill_number LIMIT ${ctx.maxRows + 1}`,
    params
  );
  const pending = await ctx.q.query(
    `SELECT b.id, b.bill_number, ${VENDOR("b")} AS vendor, b.currency, b.status, ${ymdSql("b.bill_date")} AS d,
            to_char(${billDueDateSql("b")}, 'YYYY-MM-DD') AS due_ymd, ${RATE("b")} AS rate,
            GREATEST(COALESCE(b.total_amount, 0) - COALESCE(b.amount_paid, 0), 0) AS open_doc, ${APPROVAL_SQL("b")} AS approval
       FROM vendor_bills b
      WHERE b.company_id = $1 AND COALESCE(b.status, 'pending') IN ('pending', 'pending_approval') AND b.bill_date <= $3::timestamp
        AND $2::date IS NOT NULL
      ORDER BY b.bill_date, b.bill_number LIMIT ${ctx.maxRows + 1}`,
    params
  );
  // Approved vendor credits not (or not fully) applied are part of accounts payable (negative): the report must equal AP ageing and 2010.
  const credits = await ctx.q.query(
    `SELECT id, number, vendor, currency, d, rate, open_doc FROM (
       SELECT c.id, c.number, ${VENDOR("c")} AS vendor, c.currency, to_char(c."date", 'YYYY-MM-DD') AS d, ${RATE("c")} AS rate,
              ${unappliedCreditAsOfSql("c")} AS open_doc
         FROM vendor_credit_notes c WHERE c.company_id = $1 AND c.status = 'approved' AND c."date" <= $2::date AND $3::text IS NOT NULL
     ) x WHERE open_doc <> 0 ORDER BY d, number LIMIT ${ctx.maxRows + 1}`,
    params
  );
  const mk = (r: any, pendingBill: boolean) => {
    const docOpen = money(r.open_doc);
    const aedOpen = round2(docOpen * Number(r.rate));
    return detail(
      `bill:${r.id}`,
      {
        date: r.d,
        number: r.bill_number ?? "",
        vendor: r.vendor,
        due: r.due_ymd,
        daysOverdue: pendingBill ? 0 : Number(r.days_overdue),
        status: r.status,
        approval: r.approval ?? "",
        currency: r.currency,
        docOpen,
        open: pendingBill ? null : aedOpen,
        awaiting: pendingBill ? aedOpen : null,
      },
      { target: "bill", id: String(r.id) },
      1
    );
  };
  const creditRows = credits.rows.map((r) => {
    const docOpen = money(r.open_doc);
    return detail(
      `credit:${r.id}`,
      { date: r.d, number: r.number ?? "", vendor: r.vendor, due: "", daysOverdue: 0, status: pick(ctx, "Vendor credit", "إشعار دائن"), approval: "", currency: r.currency, docOpen, open: round2(docOpen * Number(r.rate)), awaiting: null },
      { target: "vendor_credit", id: String(r.id) },
      1
    );
  });
  const postedRows = [...posted.rows.map((r) => mk(r, false)), ...creditRows];
  const pendingRows = pending.rows.map((r) => mk(r, true));
  const rows = [...postedRows];
  if (pendingRows.length > 0) {
    rows.push(
      section("section:awaiting", { number: pick(ctx, "Awaiting approval (not in the totals)", "بانتظار الموافقة (غير مشمولة في الإجماليات)") }),
      ...pendingRows
    );
  }
  return { rows, totals: { open: sumMoney(postedRows.map((r) => r.cells.open as number)) } };
}

registerReport({
  id: "payables-detail",
  noFutureAsOf: true,
  columns: [
    C.date,
    col("number", "Bill", "الفاتورة"),
    C.vendor,
    col("due", "Due date", "تاريخ الاستحقاق", "date"),
    col("daysOverdue", "Days overdue", "أيام التأخر", "number"),
    C.status,
    col("approval", "Approval", "الموافقة"),
    C.currency,
    moneyCol("docOpen", "Open (document)", "المفتوح (المستند)"),
    moneyCol("open", "Open (AED)", "المفتوح (درهم)", { sum: true }),
    moneyCol("awaiting", "Awaiting approval (AED)", "بانتظار الموافقة (درهم)"),
  ],
  run: payablesDetail,
});

// ---------------------------------------------------------------------------------------------------------------
// Expenses by Vendor / Purchases by Vendor / Purchases by Item (range, comparable)
// ---------------------------------------------------------------------------------------------------------------

async function expensesByVendor(ctx: ReportContext): Promise<ReportOutput> {
  const { from, to } = ctx.window as { from: string; to: string };
  const { start, end } = dayBounds(from, to);
  const b = new SqlParams();
  const cid = b.p(ctx.companyId);
  const s = b.p(start);
  const e = b.p(end);
  const { rows } = await ctx.q.query(
    `SELECT vendor, COUNT(*)::int AS docs, COALESCE(SUM(net), 0)::text AS net, COALESCE(SUM(vat), 0)::text AS vat FROM (
       SELECT ${VENDOR("b")} AS vendor, b.subtotal * ${RATE("b")} AS net, b.vat_amount * ${RATE("b")} AS vat
         FROM vendor_bills b WHERE b.company_id = ${cid} AND ${postedBillSql("b")} AND COALESCE(b.is_opening_balance, false) = false
          AND b.bill_date >= ${s}::timestamp AND b.bill_date <= ${e}::timestamp
       UNION ALL
       SELECT COALESCE(NULLIF(TRIM(r.merchant), ''), 'Unknown Vendor'), r.amount * ${RATE("r")}, COALESCE(r.vat_amount, 0) * ${RATE("r")}
         FROM receipts r WHERE r.company_id = ${cid} AND r.posted = true AND r.date >= ${s}::timestamp AND r.date <= ${e}::timestamp
     ) x GROUP BY vendor ORDER BY SUM(net) DESC, vendor`,
    b.values
  );
  return {
    rows: rows.map((r) =>
      detail(`vendor:${String(r.vendor).toLowerCase()}`, { vendor: r.vendor, documents: Number(r.docs), amount: money(r.net), vat: money(r.vat) }, { target: "vendor", id: String(r.vendor) })
    ),
  };
}

registerReport({
  id: "expenses-vendor",
  columns: [
    C.vendor,
    col("documents", "Documents", "المستندات", "number", { sum: true }),
    moneyCol("amount", "Expenses (AED, net of VAT)", "المصروفات (درهم، قبل الضريبة)", { comparable: true, sum: true }),
    moneyCol("vat", "VAT (AED)", "الضريبة (درهم)", { sum: true }),
  ],
  run: expensesByVendor,
});

async function expensesByCategory(ctx: ReportContext): Promise<ReportOutput> {
  const { from, to } = ctx.window as { from: string; to: string };
  const accts = await accountBalances(ctx.q, ctx.companyId, { from, to, excludeSources: PL_EXCLUDED_SOURCES });
  const rows = accts
    .filter((a) => a.type === "expense")
    .map((a) => ({ a, amount: round2(a.debit - a.credit) }))
    .filter((r) => r.amount !== 0)
    .sort((x, y) => y.amount - x.amount)
    .map((r) => detail(`acct:${r.a.accountId}`, { code: r.a.code, name: acctName(ctx, r.a), amount: r.amount }, { target: "account", id: r.a.accountId }));
  return { rows };
}

registerReport({
  id: "expenses-category",
  columns: [C.code, C.account, moneyCol("amount", "Expenses (AED)", "المصروفات (درهم)", { comparable: true, sum: true })],
  run: expensesByCategory,
});

async function purchasesByVendor(ctx: ReportContext): Promise<ReportOutput> {
  const { from, to } = ctx.window as { from: string; to: string };
  const { start, end } = dayBounds(from, to);
  const b = new SqlParams();
  // One vendor is one contact (vendor_id) when the bill has it, else its typed name: bills entered before vendor ids
  // group by name exactly as they always did.
  const { rows } = await ctx.q.query(
    `SELECT COALESCE(b.vendor_id::text, lower(trim(b.vendor_name))) AS vkey, b.vendor_id,
            COALESCE(MAX(c.name), MAX(${VENDOR("b")})) AS vendor, COUNT(*)::int AS bills, COALESCE(SUM(b.subtotal * ${RATE("b")}), 0)::text AS net,
            COALESCE(SUM(b.vat_amount * ${RATE("b")}), 0)::text AS vat, COALESCE(SUM(b.total_amount * ${RATE("b")}), 0)::text AS total
       FROM vendor_bills b LEFT JOIN customer_contacts c ON c.id = b.vendor_id AND c.company_id = b.company_id
      WHERE b.company_id = ${b.p(ctx.companyId)} AND ${postedBillSql("b")} AND b.bill_date >= ${b.p(start)}::timestamp AND b.bill_date <= ${b.p(end)}::timestamp
      GROUP BY 1, b.vendor_id ORDER BY SUM(b.subtotal * ${RATE("b")}) DESC, 3`,
    b.values
  );
  return {
    rows: rows.map((r) =>
      detail(
        `vendor:${r.vkey}`,
        { vendor: r.vendor, bills: Number(r.bills), net: money(r.net), vat: money(r.vat), total: money(r.total) },
        { target: "vendor", id: String(r.vendor_id ?? r.vendor) }
      )
    ),
  };
}

registerReport({
  id: "purchases-vendor",
  columns: [
    C.vendor,
    col("bills", "Bills", "الفواتير", "number", { sum: true }),
    moneyCol("net", "Net (AED)", "الصافي (درهم)", { comparable: true, sum: true }),
    moneyCol("vat", "VAT (AED)", "الضريبة (درهم)", { sum: true }),
    moneyCol("total", "Total (AED)", "الإجمالي (درهم)", { sum: true }),
  ],
  run: purchasesByVendor,
});

async function purchasesByItem(ctx: ReportContext): Promise<ReportOutput> {
  const { from, to } = ctx.window as { from: string; to: string };
  const { start, end } = dayBounds(from, to);
  const b = new SqlParams();
  const { rows } = await ctx.q.query(
    `SELECT COALESCE(NULLIF(regexp_replace(trim(li.description), '\\s+', ' ', 'g'), ''), 'Unlabeled item') AS item,
            COUNT(DISTINCT li.bill_id)::int AS bills, COALESCE(SUM(li.quantity), 0)::text AS qty,
            COALESCE(SUM(COALESCE(li.amount, li.quantity * li.unit_price) * ${RATE("b")}), 0)::text AS net
       FROM bill_line_items li JOIN vendor_bills b ON b.id = li.bill_id
      WHERE b.company_id = ${b.p(ctx.companyId)} AND ${postedBillSql("b")} AND b.bill_date >= ${b.p(start)}::timestamp AND b.bill_date <= ${b.p(end)}::timestamp
      GROUP BY 1 ORDER BY SUM(COALESCE(li.amount, li.quantity * li.unit_price) * ${RATE("b")}) DESC, 1`,
    b.values
  );
  return {
    rows: rows.map((r) => detail(`item:${String(r.item).toLowerCase()}`, { item: r.item, bills: Number(r.bills), quantity: money(r.qty), net: money(r.net) })),
  };
}

registerReport({
  id: "purchases-item",
  columns: [
    col("item", "Item", "البند"),
    col("bills", "Bills", "الفواتير", "number"),
    col("quantity", "Quantity", "الكمية", "number"),
    moneyCol("net", "Net (AED)", "الصافي (درهم)", { comparable: true, sum: true }),
  ],
  run: purchasesByItem,
});

// ---------------------------------------------------------------------------------------------------------------
// Payments Made (range)
// ---------------------------------------------------------------------------------------------------------------

async function paymentsMade(ctx: ReportContext): Promise<ReportOutput> {
  const { from, to } = ctx.window as { from: string; to: string };
  const { start, end } = dayBounds(from, to);
  const b = new SqlParams();
  const { rows } = await ctx.q.query(
    `SELECT p.id, b.id AS bill_id, b.bill_number, ${VENDOR("b")} AS vendor, ${ymdSql("p.payment_date")} AS d, p.payment_method AS method,
            p.reference, b.currency, p.amount::text AS amount, ${RATE("b")}::text AS rate
       FROM bill_payments p JOIN vendor_bills b ON b.id = p.bill_id
      WHERE b.company_id = ${b.p(ctx.companyId)} AND p.payment_date >= ${b.p(start)}::timestamp AND p.payment_date <= ${b.p(end)}::timestamp
        AND COALESCE(b.status, 'pending') NOT IN ('void', 'cancelled')
      ORDER BY p.payment_date, p.created_at LIMIT ${ctx.maxRows + 1}`,
    b.values
  );
  return {
    rows: rows.map((r) =>
      detail(
        `payment:${r.id}`,
        {
          date: r.d,
          number: r.bill_number ?? "",
          vendor: r.vendor,
          method: r.method ?? "",
          reference: r.reference ?? "",
          currency: r.currency,
          docAmount: money(r.amount),
          amount: round2(money(r.amount) * Number(r.rate)),
        },
        { target: "bill", id: String(r.bill_id) }
      )
    ),
  };
}

registerReport({
  id: "payments-made",
  columns: [
    C.date,
    col("number", "Bill", "الفاتورة"),
    C.vendor,
    col("method", "Method", "الطريقة"),
    C.reference,
    C.currency,
    moneyCol("docAmount", "Amount (document)", "المبلغ (المستند)"),
    moneyCol("amount", "Amount (AED)", "المبلغ (درهم)", { sum: true }),
  ],
  run: paymentsMade,
});

// ---------------------------------------------------------------------------------------------------------------
// Purchase Orders Status, Vendor Credits, Expense Claims (range)
// ---------------------------------------------------------------------------------------------------------------

async function purchaseOrdersStatus(ctx: ReportContext): Promise<ReportOutput> {
  const { from, to } = ctx.window as { from: string; to: string };
  const { start, end } = dayBounds(from, to);
  const b = new SqlParams();
  const { rows } = await ctx.q.query(
    `SELECT po.id, po.number, ${VENDOR("po")} AS vendor, ${ymdSql("po.date")} AS d, ${ymdSql("po.expected_delivery_date")} AS expected,
            po.currency, po.status, po.total::text AS total
       FROM purchase_orders po
      WHERE po.company_id = ${b.p(ctx.companyId)} AND po.date >= ${b.p(start)}::timestamp AND po.date <= ${b.p(end)}::timestamp
      ORDER BY po.date, po.number LIMIT ${ctx.maxRows + 1}`,
    b.values
  );
  return {
    rows: rows.map((r) =>
      detail(
        `po:${r.id}`,
        { date: r.d, number: r.number, vendor: r.vendor, expected: r.expected ?? "", status: r.status, currency: r.currency, total: money(r.total) },
        { target: "purchase_order", id: String(r.id) }
      )
    ),
  };
}

registerReport({
  id: "purchase-orders-status",
  columns: [
    C.date,
    C.number,
    C.vendor,
    col("expected", "Expected delivery", "التسليم المتوقع", "date"),
    C.status,
    C.currency,
    moneyCol("total", "Total (document)", "الإجمالي (المستند)"),
  ],
  run: purchaseOrdersStatus,
});

async function vendorCredits(ctx: ReportContext): Promise<ReportOutput> {
  const { from, to } = ctx.window as { from: string; to: string };
  const b = new SqlParams();
  const { rows } = await ctx.q.query(
    `SELECT c.id, c.number, ${VENDOR("c")} AS vendor, to_char(c."date", 'YYYY-MM-DD') AS d, bl.bill_number, c.status,
            (c.total * ${RATE("c")})::text AS total_aed,
            (COALESCE((SELECT SUM(a.amount) FROM vendor_credit_applications a WHERE a.credit_note_id = c.id), 0) * ${RATE("c")})::text AS applied_aed
       FROM vendor_credit_notes c LEFT JOIN vendor_bills bl ON bl.id = c.bill_id
      WHERE c.company_id = ${b.p(ctx.companyId)} AND c."date" >= ${b.p(from)}::date AND c."date" <= ${b.p(to)}::date AND c.status = 'approved'
      ORDER BY c."date", c.number LIMIT ${ctx.maxRows + 1}`,
    b.values
  );
  return {
    rows: rows.map((r) => {
      const total = money(r.total_aed);
      const applied = money(r.applied_aed);
      return detail(
        `credit:${r.id}`,
        { date: r.d, number: r.number, vendor: r.vendor, bill: r.bill_number ?? "", total, applied, remaining: round2(total - applied) },
        { target: "vendor_credit", id: String(r.id) }
      );
    }),
  };
}

registerReport({
  id: "vendor-credits",
  columns: [
    C.date,
    C.number,
    C.vendor,
    col("bill", "Bill", "الفاتورة"),
    moneyCol("total", "Credit (AED)", "الإشعار (درهم)", { sum: true }),
    moneyCol("applied", "Applied (AED)", "المطبّق (درهم)", { sum: true }),
    moneyCol("remaining", "Unapplied (AED)", "غير المطبّق (درهم)", { sum: true }),
  ],
  run: vendorCredits,
});

async function expenseClaims(ctx: ReportContext): Promise<ReportOutput> {
  const { from, to } = ctx.window as { from: string; to: string };
  const { start, end } = dayBounds(from, to);
  const b = new SqlParams();
  const { rows } = await ctx.q.query(
    `SELECT c.id, c.claim_number, c.title, COALESCE(u.name, u.email, '') AS who, ${ymdSql("COALESCE(c.submitted_at, c.created_at)")} AS d,
            c.status, c.currency, c.total_amount::text AS total
       FROM expense_claims c LEFT JOIN users u ON u.id = c.submitted_by
      WHERE c.company_id = ${b.p(ctx.companyId)} AND COALESCE(c.submitted_at, c.created_at) >= ${b.p(start)}::timestamp
        AND COALESCE(c.submitted_at, c.created_at) <= ${b.p(end)}::timestamp
      ORDER BY COALESCE(c.submitted_at, c.created_at), c.claim_number LIMIT ${ctx.maxRows + 1}`,
    b.values
  );
  return {
    rows: rows.map((r) =>
      detail(
        `claim:${r.id}`,
        { date: r.d, number: r.claim_number ?? "", description: r.title ?? "", submittedBy: r.who, status: r.status, currency: r.currency ?? "AED", total: money(r.total) },
        { target: "expense_claim", id: String(r.id) }
      )
    ),
  };
}

registerReport({
  id: "expense-claims",
  columns: [
    C.date,
    C.number,
    C.description,
    col("submittedBy", "Submitted by", "قدّمها"),
    C.status,
    C.currency,
    moneyCol("total", "Total", "الإجمالي", { sum: true }),
  ],
  run: expenseClaims,
});

