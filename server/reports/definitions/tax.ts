// Tax reports (Phase 8 D4): VAT Summary, VAT Return (201), VAT Audit (sales and purchases detail), VAT control
// reconciliation, Corporate Tax Estimate and the CT computation workpaper.

import { supplyEmirate } from "../../services/vat-emirate";
import Decimal from "decimal.js";
import { PgDialect } from "drizzle-orm/pg-core";
import { CT_ADJUSTMENT_CATEGORIES, computeCtComputation, type CtBridgeAdjustment } from "../../../shared/ct-workpaper";
import { computeVatReturnForPeriod } from "../../services/vat-return-compute.service";
import { loadPeriodSalesDocuments } from "../../services/vat-period-documents.service";
import { loadVatJournalAdjustments } from "../../services/vat-adjustments.service";
import { loadPeriodPurchases, totalPurchases, type PurchaseDocKind } from "../../services/vat-period-purchases.service";
import { aggregateReturnSalesLines, allocateReturnSalesLines } from "../../services/vat-sales-lines";
import { round2 } from "../../services/financial-statements";
import { storage } from "../../storage";
import { UAE_VAT_RATE } from "../../constants";
import { dayBounds } from "../dates";
import { KPI_EXCLUDED_SOURCES, SqlParams, ledgerLinesSql, money, periodProfit, type Queryable } from "../ledger";
import { registerReport, type ReportContext, type ReportOutput } from "../registry";
import { C, col, detail, moneyCol, pick, subtotal, sumMoney } from "./helpers";

const RATE = (a: string) => `COALESCE(NULLIF(${a}.exchange_rate, 0), 1)`;
const dialect = new PgDialect();

/** Lets the Drizzle-`sql` loaders of the VAT services run on the report's snapshot connection. */
export const snapshotExecutor = (q: Queryable) => ({
  execute: async (query: any) => {
    const { sql: text, params } = dialect.sqlToQuery(query);
    return (await q.query(text, params)).rows;
  },
});

// ---------------------------------------------------------------------------------------------------------------
// VAT Summary (range): output and input VAT from documents
// ---------------------------------------------------------------------------------------------------------------

async function vatSummary(ctx: ReportContext): Promise<ReportOutput> {
  const { from, to } = ctx.window as { from: string; to: string };
  const target = (id: string) => ({ target: "report" as const, id });
  const build = (outNet: number, outVat: number, inNet: number, inVat: number, warnings?: string[]): ReportOutput => ({
    rows: [
      detail("sales", { name: pick(ctx, "Sales (output VAT)", "المبيعات (ضريبة المخرجات)"), net: round2(outNet), vat: round2(outVat) }, target("vat-audit-sales")),
      detail("purchases", { name: pick(ctx, "Purchases (input VAT)", "المشتريات (ضريبة المدخلات)"), net: round2(inNet), vat: round2(inVat) }, target("vat-audit-purchases")),
      subtotal("net", { name: pick(ctx, "Net VAT payable", "صافي الضريبة المستحقة"), vat: round2(outVat - inVat) }),
    ],
    totals: { vat: round2(outVat - inVat) },
    warnings,
  });
  try {
    // The VAT return's own computation: the same document selection (void rule), rounding, bills, receipts, vendor credits
    // and expense claims, so the net payable here IS box 14 of the return for the same period.
    const { returnValues: r } = await computeVatReturnForPeriod({ companyId: ctx.companyId, userId: ctx.userId ?? "", periodStart: from, periodEnd: to });
    const v = r as Record<string, any>;
    return build(Number(v.box8TotalAmount), Number(v.box12TotalDueTax), Number(v.box11TotalAmount), Number(v.box13RecoverableTax));
  } catch (err: any) {
    if (err?.code !== "NO_TRN" && err?.code !== "EMIRATE_NOT_SET") throw err;
  }
  // A company that cannot file a return (no TRN or emirate yet): the same loaders, without the box attribution.
  const sales = await loadPeriodSalesDocuments(snapshotExecutor(ctx.q), ctx.companyId, from, to);
  const st = aggregateReturnSalesLines(sales.lines as any[], sales.rateByInvoiceId);
  const start = new Date(from);
  const end = new Date(to);
  end.setUTCHours(23, 59, 59, 999);
  const pt = totalPurchases(await loadPeriodPurchases(snapshotExecutor(ctx.q), ctx.companyId, start, end));
  const outNet = st.standardRatedAmount + st.zeroRatedAmount + st.exemptAmount + pt.reverseChargeAmount;
  return build(outNet, st.standardRatedVat + pt.reverseChargeVatGross, pt.totalExpenses + pt.reverseChargeAmount, pt.inputTaxGross + pt.reverseChargeVatGross, [
    pick(ctx, "The company has no TRN or emirate yet, so this is the books' VAT without a return.", "ليس للشركة رقم ضريبي أو إمارة بعد، فهذه ضريبة الدفاتر دون إقرار."),
  ]);
}

registerReport({
  id: "vat-summary",
  columns: [col("name", "Item", "البند"), moneyCol("net", "Net (AED)", "الصافي (درهم)"), moneyCol("vat", "VAT (AED)", "الضريبة (درهم)")],
  run: vatSummary,
});

// ---------------------------------------------------------------------------------------------------------------
// VAT Return (201): the boxes, computed live from the books for the period
// ---------------------------------------------------------------------------------------------------------------

const EMIRATE_KEYS = ["box1aAbuDhabi", "box1bDubai", "box1cSharjah", "box1dAjman", "box1eUmmAlQuwain", "box1fRasAlKhaimah", "box1gFujairah"] as const;

async function vatReturn(ctx: ReportContext): Promise<ReportOutput> {
  const { from, to } = ctx.window as { from: string; to: string };
  const { returnValues: v } = await computeVatReturnForPeriod({ companyId: ctx.companyId, userId: ctx.userId ?? "", periodStart: from, periodEnd: to });
  const r = v as Record<string, any>;
  const sum = (suffix: string) => sumMoney(EMIRATE_KEYS.map((k) => Number(r[`${k}${suffix}`] ?? 0)));
  const target = { target: "report" as const, id: "vat-audit-sales" };
  const buy = { target: "report" as const, id: "vat-audit-purchases" };
  const box = (n: string, en: string, ar: string, amount: number | null, vat: number | null, adj: number | null, drill?: typeof target) =>
    detail(`box:${n}`, { box: n, name: pick(ctx, en, ar), amount, vat, adjustment: adj }, drill);
  // Box 1 by the emirate of each supply (1a-1g): a row for every emirate the period has supplies in.
  const EMIRATE_ROWS: Array<[string, string, string, string]> = [
    ["1a", "box1aAbuDhabi", "Abu Dhabi", "أبوظبي"],
    ["1b", "box1bDubai", "Dubai", "دبي"],
    ["1c", "box1cSharjah", "Sharjah", "الشارقة"],
    ["1d", "box1dAjman", "Ajman", "عجمان"],
    ["1e", "box1eUmmAlQuwain", "Umm Al Quwain", "أم القيوين"],
    ["1f", "box1fRasAlKhaimah", "Ras Al Khaimah", "رأس الخيمة"],
    ["1g", "box1gFujairah", "Fujairah", "الفجيرة"],
  ];
  const emirateRows = EMIRATE_ROWS.filter(([, key]) => Number(r[`${key}Amount`] ?? 0) !== 0 || Number(r[`${key}Vat`] ?? 0) !== 0 || Number(r[`${key}Adj`] ?? 0) !== 0).map(([n, key, en, ar]) =>
    detail(`box:${n}`, { box: n, name: pick(ctx, `Standard rated supplies: ${en}`, `التوريدات الخاضعة للنسبة الأساسية: ${ar}`), amount: Number(r[`${key}Amount`] ?? 0), vat: Number(r[`${key}Vat`] ?? 0), adjustment: Number(r[`${key}Adj`] ?? 0) }, target, 1)
  );
  const rows = [
    box("1", "Standard rated supplies", "التوريدات الخاضعة للنسبة الأساسية", sum("Amount"), sum("Vat"), sum("Adj"), target),
    ...emirateRows,
    box("3", "Reverse charge supplies", "التوريدات الخاضعة للاحتساب العكسي", r.box3ReverseChargeAmount, r.box3ReverseChargeVat, null, buy),
    box("4", "Zero rated supplies", "التوريدات الخاضعة لنسبة الصفر", r.box4ZeroRatedAmount, null, null, target),
    box("5", "Exempt supplies", "التوريدات المعفاة", r.box5ExemptAmount, null, null, target),
    box("8", "Total output", "إجمالي المخرجات", r.box8TotalAmount, r.box8TotalVat, r.box8TotalAdj),
    box("9", "Standard rated expenses", "المصروفات الخاضعة للنسبة الأساسية", r.box9ExpensesAmount, r.box9ExpensesVat, r.box9ExpensesAdj, buy),
    box("10", "Reverse charge (input)", "الاحتساب العكسي (المدخلات)", r.box10ReverseChargeAmount, r.box10ReverseChargeVat, null, buy),
    box("11", "Total input", "إجمالي المدخلات", r.box11TotalAmount, r.box11TotalVat, r.box11TotalAdj),
    box("12", "Total due tax", "إجمالي الضريبة المستحقة", null, r.box12TotalDueTax, null),
    box("13", "Recoverable tax", "الضريبة القابلة للاسترداد", null, r.box13RecoverableTax, null),
    box("14", "Payable tax", "الضريبة الواجبة السداد", null, r.box14PayableTax, null),
  ];
  return { rows, totals: { vat: Number(r.box14PayableTax) } };
}

registerReport({
  id: "vat-return",
  columns: [
    col("box", "Box", "الخانة"),
    col("name", "Description", "الوصف"),
    moneyCol("amount", "Amount (AED)", "المبلغ (درهم)"),
    moneyCol("vat", "VAT (AED)", "الضريبة (درهم)"),
    moneyCol("adjustment", "Adjustment (AED)", "التعديل (درهم)"),
  ],
  run: vatReturn,
});

// ---------------------------------------------------------------------------------------------------------------
// VAT Audit: Sales Detail: every supply line the period's return is built from (Σ standard VAT = box 1)
// ---------------------------------------------------------------------------------------------------------------

const SUPPLY_LABEL: Record<string, [string, string]> = {
  standard: ["Standard rated", "خاضع للنسبة الأساسية"],
  zero_rated: ["Zero rated", "خاضع لنسبة الصفر"],
  exempt: ["Exempt", "معفى"],
  excluded: ["Out of scope", "خارج النطاق"],
};

async function vatAuditSales(ctx: ReportContext): Promise<ReportOutput> {
  const { from, to } = ctx.window as { from: string; to: string };
  const sales = await loadPeriodSalesDocuments(snapshotExecutor(ctx.q), ctx.companyId, from, to);
  const invoiceById = new Map(sales.invoices.map((i) => [i.id, i]));
  const lines = (sales.lines as any[]).filter((l) => invoiceById.has(l.invoiceId));
  // The same allocation the return adds up (vat-sales-lines.ts): each row is exact fils and the rows add up to the return.
  const allocated = allocateReturnSalesLines(lines, sales.rateByInvoiceId);
  const rows: ReportOutput["rows"] = [];
  const buckets: Record<string, { amount: Decimal; vat: Decimal }> = {
    standard: { amount: new Decimal(0), vat: new Decimal(0) },
    zero_rated: { amount: new Decimal(0), vat: new Decimal(0) },
    exempt: { amount: new Decimal(0), vat: new Decimal(0) },
    excluded: { amount: new Decimal(0), vat: new Decimal(0) },
  };
  lines.forEach((line, n) => {
    const inv = invoiceById.get(line.invoiceId)!;
    const a = allocated[n];
    const rate = line.vatRate == null ? UAE_VAT_RATE : Number(line.vatRate);
    buckets[a.category].amount = buckets[a.category].amount.plus(a.amountAed);
    buckets[a.category].vat = buckets[a.category].vat.plus(a.vatAed);
    rows.push(
      detail(
        `line:${inv.id}:${n}`,
        {
          date: inv.effect === "reverse_in_period" && inv.voidedOn ? inv.voidedOn : inv.date,
          number: inv.number ?? "",
          customer: inv.customerName ?? "",
          trn: inv.customerTrn ?? "",
          description: (line.description ?? "") + (inv.effect === "reverse_in_period" ? ` (${pick(ctx, "cancelled", "ملغاة")})` : ""),
          supply: pick(ctx, SUPPLY_LABEL[a.category][0], SUPPLY_LABEL[a.category][1]),
          // the emirate of the supply: the document's own, else the company's (box 1a-1g of the return)
          emirate: supplyEmirate(inv.emirate, ctx.company.emirate),
          rate: round2(rate * 100),
          amount: a.amountAed,
          vat: a.vatAed,
        },
        { target: "invoice", id: inv.id }
      )
    );
  });
  // Taxable sales recorded by manual journal (Cr revenue + Cr 2020, no document): supplies of the return too (box 1).
  const journalSales = (await loadVatJournalAdjustments(snapshotExecutor(ctx.q), ctx.companyId, from, to, ctx.company.emirate)).sales;
  for (const sale of journalSales) {
    buckets.standard.amount = buckets.standard.amount.plus(sale.amount);
    buckets.standard.vat = buckets.standard.vat.plus(sale.vat);
    rows.push(
      detail(
        `journal:${sale.entryId}`,
        {
          date: sale.date,
          number: `${pick(ctx, "Journal", "قيد")} ${sale.entryNumber}`,
          customer: "",
          trn: "",
          description: sale.description,
          supply: pick(ctx, SUPPLY_LABEL.standard[0], SUPPLY_LABEL.standard[1]),
          emirate: ctx.company.emirate ?? "",
          rate: sale.amount === 0 ? round2(UAE_VAT_RATE * 100) : round2((sale.vat / sale.amount) * 100),
          amount: sale.amount,
          vat: sale.vat,
        },
        { target: "journal_entry", id: sale.entryId }
      )
    );
  }
  const subtotals = (["standard", "zero_rated", "exempt", "excluded"] as const)
    .filter((k) => !buckets[k].amount.isZero() || !buckets[k].vat.isZero())
    .map((k) => subtotal(`total:${k}`, { description: pick(ctx, SUPPLY_LABEL[k][0], SUPPLY_LABEL[k][1]), amount: buckets[k].amount.toNumber(), vat: buckets[k].vat.toNumber() }));
  const totalAmount = Object.values(buckets).reduce((acc, x) => acc.plus(x.amount), new Decimal(0));
  return { rows: [...rows, ...subtotals], totals: { amount: totalAmount.toNumber(), vat: buckets.standard.vat.toNumber() } };
}

registerReport({
  id: "vat-audit-sales",
  columns: [
    C.date,
    col("number", "Invoice", "الفاتورة"),
    C.customer,
    col("trn", "Customer TRN", "الرقم الضريبي للعميل"),
    C.description,
    col("supply", "Supply type", "نوع التوريد"),
    col("emirate", "Emirate", "الإمارة"),
    col("rate", "VAT %", "نسبة الضريبة %", "number"),
    moneyCol("amount", "Amount (AED)", "المبلغ (درهم)"),
    moneyCol("vat", "VAT (AED)", "الضريبة (درهم)"),
  ],
  run: vatAuditSales,
});

// ---------------------------------------------------------------------------------------------------------------
// VAT Audit: Purchases Detail: every purchase document of the period (Σ recoverable = box 9)
// ---------------------------------------------------------------------------------------------------------------

const KIND_LABEL: Record<PurchaseDocKind, [string, string]> = {
  receipt: ["Receipt", "إيصال"],
  bill: ["Bill", "فاتورة مورد"],
  vendor_credit: ["Vendor credit", "إشعار دائن مورد"],
  expense_claim: ["Expense claim", "مطالبة مصروفات"],
  journal: ["Journal", "قيد يومية"],
};
/** Where a purchase row leads, by document kind. The id is the document's own id (a claim row carries its claim, not the item). */
const KIND_DRILL: Record<PurchaseDocKind, "bill" | "vendor_credit" | "expense_claim" | "receipt" | "journal_entry"> = {
  bill: "bill",
  vendor_credit: "vendor_credit",
  expense_claim: "expense_claim",
  receipt: "receipt",
  journal: "journal_entry",
};

async function vatAuditPurchases(ctx: ReportContext): Promise<ReportOutput> {
  const { from, to } = ctx.window as { from: string; to: string };
  const startDate = new Date(from);
  const endDate = new Date(to);
  endDate.setUTCHours(23, 59, 59, 999);
  const docs = await loadPeriodPurchases(snapshotExecutor(ctx.q), ctx.companyId, startDate, endDate);
  const ratioRow = (await ctx.q.query(`SELECT exempt_supply_ratio FROM companies WHERE id = $1`, [ctx.companyId])).rows[0];
  const exempt = Math.min(1, Math.max(0, Number(ratioRow?.exempt_supply_ratio ?? 0) || 0));
  const recoverable = 1 - exempt;
  const rows = docs.map((d, i) => {
    const net = money(d.net);
    const vat = money(d.vat);
    const drillTarget = KIND_DRILL[d.kind];
    return detail(
      `doc:${d.kind}:${d.id}:${i}`,
      {
        date: d.date,
        type: pick(ctx, KIND_LABEL[d.kind][0], KIND_LABEL[d.kind][1]),
        number: d.number ?? "",
        vendor: d.vendor ?? "",
        trn: d.vendorTrn ?? "",
        treatment: d.blocked
          ? pick(ctx, "Blocked (Art. 53)", "محظور (المادة 53)")
          : d.reverseCharge ? pick(ctx, "Reverse charge", "احتساب عكسي") : pick(ctx, "Standard", "عادي"),
        net: d.reverseCharge ? null : net,
        vat: d.reverseCharge ? null : vat,
        // blocked input VAT is never recoverable: it is part of the expense and outside box 9
        recoverable: d.reverseCharge ? null : d.blocked ? 0 : round2(vat * recoverable),
        rcNet: d.reverseCharge ? net : null,
        rcVat: d.reverseCharge ? vat : null,
      },
      { target: drillTarget, id: d.documentId ?? d.id }
    );
  });
  const t = totalPurchases(docs);
  const purchaseWarnings: string[] = [];
  if (exempt > 0) purchaseWarnings.push(pick(ctx, `Partial exemption: ${round2(recoverable * 100)}% of input VAT is recoverable.`, `إعفاء جزئي: ${round2(recoverable * 100)}% من ضريبة المدخلات قابلة للاسترداد.`));
  if (docs.some((d) => d.blocked)) {
    purchaseWarnings.push(
      pick(ctx, "Blocked input VAT (Art. 53, e.g. entertainment) is listed but is not part of the totals or box 9: it is part of the expense.", "ضريبة المدخلات المحظورة (المادة 53، مثل الضيافة) مدرجة لكنها ليست ضمن الإجماليات ولا الخانة 9: فهي جزء من المصروف.")
    );
  }
  return {
    rows,
    totals: {
      net: round2(t.totalExpenses),
      vat: round2(t.inputTaxGross),
      recoverable: round2(t.inputTaxGross * recoverable),
      rcNet: round2(t.reverseChargeAmount),
      rcVat: round2(t.reverseChargeVatGross),
    },
    warnings: purchaseWarnings.length ? purchaseWarnings : undefined,
  };
}

registerReport({
  id: "vat-audit-purchases",
  columns: [
    C.date,
    col("type", "Type", "النوع"),
    col("number", "Number", "الرقم"),
    C.vendor,
    col("trn", "Vendor TRN", "الرقم الضريبي للمورد"),
    col("treatment", "Treatment", "المعالجة"),
    moneyCol("net", "Net (AED)", "الصافي (درهم)"),
    moneyCol("vat", "Input VAT (AED)", "ضريبة المدخلات (درهم)"),
    moneyCol("recoverable", "Recoverable (box 9)", "القابلة للاسترداد (الخانة 9)"),
    moneyCol("rcNet", "Reverse charge net", "صافي الاحتساب العكسي"),
    moneyCol("rcVat", "Reverse charge VAT", "ضريبة الاحتساب العكسي"),
  ],
  run: vatAuditPurchases,
});

// ---------------------------------------------------------------------------------------------------------------
// VAT control reconciliation: the VAT accounts in the ledger against each stored return
// ---------------------------------------------------------------------------------------------------------------

async function vatControl(ctx: ReportContext): Promise<ReportOutput> {
  const { from, to } = ctx.window as { from: string; to: string };
  const { rows: returns } = await ctx.q.query(
    `SELECT id, to_char(period_start, 'YYYY-MM-DD') AS ps, to_char(period_end, 'YYYY-MM-DD') AS pe, status,
            COALESCE(box12_total_due_tax, 0)::text AS due, COALESCE(box13_recoverable_tax, 0)::text AS rec
       FROM vat_returns
      WHERE company_id = $1 AND period_end::date >= $2::date AND period_end::date <= $3::date AND COALESCE(is_amendment, false) = false
      ORDER BY period_end::date`,
    [ctx.companyId, from, to]
  );
  const out: ReportOutput["rows"] = [];
  for (const r of returns) {
    const b = new SqlParams();
    const { rows } = await ctx.q.query(
      `WITH ${ledgerLinesSql(b, ctx.companyId, { from: String(r.ps), to: String(r.pe), excludeSources: ["vat_filing", "vat_payment"] })}
       SELECT COALESCE(SUM(l.credit - l.debit) FILTER (WHERE a.code = '2020'), 0)::text AS output_vat,
              COALESCE(SUM(l.debit - l.credit) FILTER (WHERE a.code = '1050'), 0)::text AS input_vat
         FROM ledger l JOIN accounts a ON a.id = l.account_id AND a.company_id = ${b.p(ctx.companyId)}`,
      b.values
    );
    const outputLedger = money(rows[0]?.output_vat);
    const inputLedger = money(rows[0]?.input_vat);
    const due = money(r.due);
    const rec = money(r.rec);
    out.push(
      detail(
        `return:${r.id}`,
        {
          period: `${r.ps} → ${r.pe}`,
          status: r.status,
          outputLedger,
          outputReturn: due,
          outputDiff: round2(due - outputLedger),
          inputLedger,
          inputReturn: rec,
          inputDiff: round2(rec - inputLedger),
        },
        { target: "account", id: "2020" }
      )
    );
  }
  return {
    rows: out,
    warnings: out.length === 0 ? [pick(ctx, "No VAT return was saved for a period ending in this range.", "لا يوجد إقرار ضريبة محفوظ لفترة تنتهي ضمن هذا النطاق.")] : undefined,
  };
}

registerReport({
  id: "vat-control-reconciliation",
  columns: [
    col("period", "Period", "الفترة"),
    C.status,
    moneyCol("outputLedger", "Output VAT in ledger (2020)", "ضريبة المخرجات في الدفاتر (2020)", { sum: true }),
    moneyCol("outputReturn", "Output VAT in return (box 12)", "ضريبة المخرجات في الإقرار (الخانة 12)", { sum: true }),
    moneyCol("outputDiff", "Difference", "الفرق", { sum: true }),
    moneyCol("inputLedger", "Input VAT in ledger (1050)", "ضريبة المدخلات في الدفاتر (1050)", { sum: true }),
    moneyCol("inputReturn", "Recoverable in return (box 13)", "القابلة للاسترداد في الإقرار (الخانة 13)", { sum: true }),
    moneyCol("inputDiff", "Difference", "الفرق", { sum: true }),
  ],
  run: vatControl,
});

// ---------------------------------------------------------------------------------------------------------------
// Corporate tax: the estimate (from the books) and the computation workpaper (from a saved return)
// ---------------------------------------------------------------------------------------------------------------

const BRIDGE_AR: Record<string, string> = {
  revenue: "إجمالي الإيرادات",
  expenses: "إجمالي المصروفات",
  accounting_profit: "الربح المحاسبي / (الخسارة)",
  adjusted_taxable_income: "الدخل الخاضع للضريبة قبل تخفيف الخسائر",
  small_business_relief: "إعفاء الأعمال الصغيرة المختار (القرار الوزاري 73/2023؛ إيرادات حتى 3,000,000 درهم): الدخل الخاضع للضريبة يُعتبر صفرًا",
  loss_relief: "الخسائر الضريبية المستخدمة",
  taxable_income: "الدخل الخاضع للضريبة",
  zero_band: "شريحة 0٪ (المادة 3: أول 375,000 درهم من الدخل الخاضع للضريبة)",
  taxable_amount: "الدخل الخاضع بنسبة 9٪",
  tax_payable: "ضريبة الشركات المستحقة",
  legacy_deductions: "خصومات أخرى",
};

function bridgeRows(ctx: ReportContext, bridge: Array<{ key: string; label: string; amount: number }>) {
  return bridge.map((line) => {
    const adjCategory = line.key.startsWith("adj_") ? (Object.keys(CT_ADJUSTMENT_CATEGORIES).find((c) => line.key.startsWith(`adj_${c}_`)) as keyof typeof CT_ADJUSTMENT_CATEGORIES | undefined) : undefined;
    const name = ctx.params.lang === "ar" ? (BRIDGE_AR[line.key] ?? (adjCategory ? CT_ADJUSTMENT_CATEGORIES[adjCategory].labelAr : line.label)) : line.label;
    const emphasised = ["accounting_profit", "taxable_income", "tax_payable"].includes(line.key);
    return (emphasised ? subtotal : detail)(`bridge:${line.key}`, { name, amount: line.amount });
  });
}

async function corporateTaxEstimate(ctx: ReportContext): Promise<ReportOutput> {
  const { from, to } = ctx.window as { from: string; to: string };
  // Accounting profit before the corporate-tax charge itself (the accrual is left out).
  const p = await periodProfit(ctx.q, ctx.companyId, from, to, KPI_EXCLUDED_SOURCES);
  // The election belongs to the tax period: the saved return covering these dates carries it (and its add-backs and deductions),
  // so the estimate is the return's computation on the books' figures. No return yet: no election, no adjustments.
  const saved = (
    await ctx.q.query(
      `SELECT small_business_relief, workpaper, loss_brought_forward FROM corporate_tax_returns
        WHERE company_id = $1 AND tax_period_start::date <= $3::date AND tax_period_end::date >= $2::date AND COALESCE(is_amendment, false) = false
          AND status <> 'void' ORDER BY tax_period_end DESC, created_at DESC LIMIT 1`,
      [ctx.companyId, from, to]
    )
  ).rows[0];
  const savedWp = (saved?.workpaper ?? {}) as { adjustments?: CtBridgeAdjustment[]; sbrElected?: boolean };
  const exceeded = await storage.getCtPriorPeriodRevenueExceededCap(ctx.companyId, new Date(from));
  const computation = computeCtComputation({
    totalRevenue: p.revenue,
    totalExpenses: p.expenses,
    adjustments: savedWp.adjustments ?? [],
    lossBroughtForward: Number(saved?.loss_brought_forward) || 0,
    smallBusinessReliefElected: typeof savedWp.sbrElected === "boolean" ? savedWp.sbrElected : saved?.small_business_relief === true,
    priorPeriodsExceededRevenueCap: exceeded,
    taxPeriodEnd: to,
  });
  return { rows: bridgeRows(ctx, computation.bridge), totals: { amount: computation.taxPayable } };
}

registerReport({
  id: "corporate-tax-estimate",
  columns: [col("name", "Item", "البند"), moneyCol("amount", "Amount (AED)", "المبلغ (درهم)")],
  run: corporateTaxEstimate,
});

async function ctWorkpaper(ctx: ReportContext): Promise<ReportOutput> {
  const { from, to } = ctx.window as { from: string; to: string };
  const taxYear = ctx.params.filters.taxYear;
  const conds = taxYear
    ? { sql: `EXTRACT(YEAR FROM tax_period_end) = $2`, value: Number(taxYear) as unknown }
    : { sql: `tax_period_start <= $3::date AND tax_period_end >= $2::date`, value: from as unknown };
  const params: unknown[] = [ctx.companyId, conds.value];
  if (!taxYear) params.push(to);
  const { rows } = await ctx.q.query(
    `SELECT id, to_char(tax_period_start, 'YYYY-MM-DD') AS ps, to_char(tax_period_end, 'YYYY-MM-DD') AS pe, total_revenue, total_expenses, total_deductions,
            exemption_threshold, tax_rate, small_business_relief, loss_brought_forward, workpaper, status
       FROM corporate_tax_returns WHERE company_id = $1 AND ${conds.sql} AND COALESCE(is_amendment, false) = false
      ORDER BY tax_period_end DESC, created_at DESC LIMIT 1`,
    params
  );
  const ret = rows[0];
  if (!ret) {
    return { rows: [], warnings: [pick(ctx, "No corporate tax return exists for this period yet.", "لا يوجد إقرار ضريبة شركات لهذه الفترة بعد.")] };
  }
  const wp = (ret.workpaper ?? {}) as { adjustments?: CtBridgeAdjustment[]; sbrElected?: boolean; computation?: { smallBusinessRelief?: { elected?: boolean } } };
  const exceeded = await storage.getCtPriorPeriodRevenueExceededCap(ctx.companyId, new Date(`${ret.ps}T00:00:00Z`), String(ret.id));
  const computation = computeCtComputation({
    totalRevenue: Number(ret.total_revenue) || 0,
    totalExpenses: Number(ret.total_expenses) || 0,
    totalDeductions: Number(ret.total_deductions) || 0,
    adjustments: wp.adjustments ?? [],
    lossBroughtForward: Number(ret.loss_brought_forward) || 0,
    smallBusinessReliefElected: typeof wp.sbrElected === "boolean" ? wp.sbrElected : (wp.computation?.smallBusinessRelief?.elected ?? ret.small_business_relief === true),
    priorPeriodsExceededRevenueCap: exceeded,
    exemptionThreshold: Number(ret.exemption_threshold) || undefined,
    taxRate: Number(ret.tax_rate) || undefined,
    taxPeriodEnd: String(ret.pe),
  });
  return {
    rows: bridgeRows(ctx, computation.bridge),
    totals: { amount: computation.taxPayable },
    warnings: [pick(ctx, `Return for ${ret.ps} to ${ret.pe} (${ret.status}).`, `إقرار الفترة ${ret.ps} إلى ${ret.pe} (${ret.status}).`)],
  };
}

registerReport({
  id: "ct-workpaper",
  filters: ["taxYear"],
  columns: [col("name", "Item", "البند"), moneyCol("amount", "Amount (AED)", "المبلغ (درهم)")],
  run: ctWorkpaper,
});

