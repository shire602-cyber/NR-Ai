// Banking, inventory, fixed-asset and payroll reports over the existing tables (Phase 8 D4).
// Payroll reports are sensitive (owner / accountant / CFO or firm staff).

import { round2 } from "../../services/financial-statements";
import { dayBounds, dayEndTs, ymdSql } from "../dates";
import { SqlParams, accountBalances, money } from "../ledger";
import { registerReport, type ReportContext, type ReportOutput } from "../registry";
import { C, col, detail, moneyCol, pick, subtotal } from "./helpers";

const monthIndex = (ymd: string): number => Number(ymd.slice(0, 4)) * 12 + Number(ymd.slice(5, 7));

// ---------------------------------------------------------------------------------------------------------------
// Unreconciled Bank Items (range): bank transactions not yet matched
// ---------------------------------------------------------------------------------------------------------------

async function unreconciledBankItems(ctx: ReportContext): Promise<ReportOutput> {
  const { from, to } = ctx.window as { from: string; to: string };
  const { start, end } = dayBounds(from, to);
  const b = new SqlParams();
  const conds = [
    `t.company_id = ${b.p(ctx.companyId)}`,
    `COALESCE(t.is_reconciled, false) = false`,
    `t.transaction_date >= ${b.p(start)}::timestamp`,
    `t.transaction_date <= ${b.p(end)}::timestamp`,
  ];
  if (ctx.params.filters.bankAccountId) {
    // The ledger bank account (accounts.id) or the managed bank account (bank_accounts.id): both appear in the UI.
    const id = b.p(ctx.params.filters.bankAccountId);
    conds.push(`(t.bank_account_id = ${id}::uuid OR t.bank_statement_account_id = ${id}::uuid)`);
  }
  const { rows } = await ctx.q.query(
    `SELECT t.id, ${ymdSql("t.transaction_date")} AS d, COALESCE(ba.name_en, ga.name_en) AS bank, t.description, t.reference, t.amount::text AS amount
       FROM bank_transactions t
       LEFT JOIN bank_accounts ba ON ba.id = t.bank_statement_account_id AND ba.company_id = t.company_id
       LEFT JOIN accounts ga ON ga.id = t.bank_account_id AND ga.company_id = t.company_id
      WHERE ${conds.join(" AND ")} ORDER BY t.transaction_date, t.created_at LIMIT ${ctx.maxRows + 1}`,
    b.values
  );
  return {
    rows: rows.map((r) =>
      detail(`txn:${r.id}`, { date: r.d, bank: r.bank ?? "", description: r.description ?? "", reference: r.reference ?? "", amount: money(r.amount) }, { target: "bank_txn", id: String(r.id) })
    ),
  };
}

registerReport({
  id: "unreconciled-bank-items",
  filters: ["bankAccountId"],
  columns: [C.date, col("bank", "Bank account", "الحساب البنكي"), C.description, C.reference, moneyCol("amount", "Amount", "المبلغ", { sum: true })],
  run: unreconciledBankItems,
});

// ---------------------------------------------------------------------------------------------------------------
// Inventory valuation / summary (as of): today's stock, wound back through the movements after the as-of day
// ---------------------------------------------------------------------------------------------------------------

interface StockRow {
  id: string;
  sku: string;
  name: string;
  unit: string;
  threshold: number;
  qty: number;
  value: number;
}

let movementDateColumnKnown = false;
/**
 * The day a stock movement happened: the movement's OWN date (inventory_movements.movement_date, set from the bill, the
 * purchase order or the day the user entered) first; for older rows the date of the invoice it came from; created_at (when
 * the row was written) only as the last resort. The same date the COGS / inventory journal is posted on.
 */
async function movementDateExpr(ctx: ReportContext, movement = "im", invoice = "si"): Promise<string> {
  if (!movementDateColumnKnown) {
    const { rows } = await ctx.q.query(`SELECT 1 FROM information_schema.columns WHERE table_name = 'inventory_movements' AND column_name = 'movement_date'`);
    movementDateColumnKnown = rows.length > 0;
  }
  return movementDateColumnKnown ? `COALESCE(${movement}.movement_date, ${invoice}.date, ${movement}.created_at)` : `COALESCE(${invoice}.date, ${movement}.created_at)`;
}

async function stockAsOf(ctx: ReportContext): Promise<StockRow[]> {
  const asOf = ctx.window.asOf as string;
  const happened = await movementDateExpr(ctx);
  const b = new SqlParams();
  const { rows } = await ctx.q.query(
    `SELECT p.id, COALESCE(p.sku, '') AS sku, p.name, COALESCE(p.unit, '') AS unit, COALESCE(p.low_stock_threshold, 0) AS threshold,
            (p.current_stock - COALESCE(SUM(m.dq) FILTER (WHERE m.happened > ${b.p(dayEndTs(asOf))}::timestamp), 0))::text AS qty,
            (COALESCE(p.inventory_value, 0) - COALESCE(SUM(m.dv) FILTER (WHERE m.happened > ${b.p(dayEndTs(asOf))}::timestamp), 0))::text AS value
       FROM products p
       LEFT JOIN (
         -- A movement happened on its own date (see movementDateExpr); created_at is only when the row was written.
         SELECT im.product_id, ${happened} AS happened,
                CASE WHEN im.type IN ('purchase', 'return') THEN ABS(im.quantity) WHEN im.type = 'sale' THEN -ABS(im.quantity) ELSE im.quantity END AS dq,
                CASE WHEN im.type IN ('purchase', 'return') OR (im.type = 'adjustment' AND im.quantity > 0) THEN 1 ELSE -1 END
                  * ABS(COALESCE(im.total_cost, im.quantity * COALESCE(im.unit_cost, 0), 0)) AS dv
           FROM inventory_movements im LEFT JOIN invoices si ON si.id = im.source_invoice_id AND si.company_id = im.company_id
          WHERE im.company_id = ${b.p(ctx.companyId)}
       ) m ON m.product_id = p.id
      WHERE p.company_id = ${b.p(ctx.companyId)} AND p.track_inventory = true
      GROUP BY p.id ORDER BY p.name LIMIT ${ctx.maxRows + 1}`,
    b.values
  );
  return rows
    .map((r) => ({
      id: String(r.id),
      sku: r.sku,
      name: r.name,
      unit: r.unit,
      threshold: Number(r.threshold),
      qty: Number(r.qty),
      value: money(r.value),
    }))
    .filter((r) => r.qty !== 0 || r.value !== 0);
}

/** Negative stock is a data problem (a sale before its purchase, a missing receipt): never shown silently. */
function negativeStockWarning(ctx: ReportContext, stock: StockRow[]): string | null {
  const negative = stock.filter((s) => s.qty < 0);
  if (negative.length === 0) return null;
  const names = negative.slice(0, 5).map((s) => `${s.name} (${s.qty})`).join(", ") + (negative.length > 5 ? "…" : "");
  return pick(
    ctx,
    `${negative.length} product(s) have NEGATIVE stock on this date: ${names}. Something was sold or issued before it was received: check the dates of purchases and stock movements.`,
    `${negative.length} منتج(ات) برصيد مخزون سالب في هذا التاريخ: ${names}. تم بيع أو صرف شيء قبل استلامه: راجع تواريخ المشتريات وحركات المخزون.`
  );
}

async function inventoryValuation(ctx: ReportContext): Promise<ReportOutput> {
  const asOf = ctx.window.asOf as string;
  const stock = await stockAsOf(ctx);
  // The stock ledger must equal the inventory account: the total of the products against 1070 in the books on the same day.
  const ledger = (await accountBalances(ctx.q, ctx.companyId, { to: asOf })).find((a) => a.code === "1070");
  const ledgerValue = round2((ledger?.debit ?? 0) - (ledger?.credit ?? 0));
  const stockValue = round2(stock.reduce((sum, s) => sum + s.value, 0));
  const difference = round2(stockValue - ledgerValue);
  const warnings: string[] = [];
  const negative = negativeStockWarning(ctx, stock);
  if (negative) warnings.push(negative);
  if (Math.abs(difference) >= 0.005) {
    warnings.push(
      pick(
        ctx,
        `The stock ledger (${stockValue.toFixed(2)}) does not agree with the inventory account 1070 in the books (${ledgerValue.toFixed(2)}): difference ${difference.toFixed(2)}.`,
        `سجل المخزون (${stockValue.toFixed(2)}) لا يطابق حساب المخزون 1070 في الدفاتر (${ledgerValue.toFixed(2)}): الفرق ${difference.toFixed(2)}.`
      )
    );
  }
  return {
    rows: [
      ...stock.map((s) =>
        detail(`product:${s.id}`, { sku: s.sku, name: s.name, unit: s.unit, quantity: s.qty, avgCost: s.qty > 0 ? round2(s.value / s.qty) : 0, value: s.value }, { target: "product", id: s.id })
      ),
      subtotal("ledger-1070", { name: pick(ctx, "Inventory account 1070 in the books", "حساب المخزون 1070 في الدفاتر"), value: ledgerValue }),
      subtotal("difference", { name: pick(ctx, "Difference (stock ledger less books)", "الفرق (سجل المخزون ناقص الدفاتر)"), value: difference }),
    ],
    warnings: warnings.length ? warnings : undefined,
  };
}

registerReport({
  id: "inventory-valuation",
  noFutureAsOf: true,
  columns: [
    col("sku", "SKU", "الرمز"),
    col("name", "Product", "المنتج"),
    col("unit", "Unit", "الوحدة"),
    col("quantity", "Quantity", "الكمية", "number", { sum: true }),
    moneyCol("avgCost", "Average cost", "متوسط التكلفة"),
    moneyCol("value", "Value (AED)", "القيمة (درهم)", { sum: true }),
  ],
  run: inventoryValuation,
});

async function inventorySummary(ctx: ReportContext): Promise<ReportOutput> {
  const stock = await stockAsOf(ctx);
  const negative = negativeStockWarning(ctx, stock);
  return {
    warnings: negative ? [negative] : undefined,
    rows: stock.map((s) =>
      detail(
        `product:${s.id}`,
        {
          sku: s.sku,
          name: s.name,
          onHand: s.qty,
          threshold: s.threshold,
          level: s.qty <= 0 ? pick(ctx, "Out of stock", "نفد المخزون") : s.threshold > 0 && s.qty <= s.threshold ? pick(ctx, "Low", "منخفض") : pick(ctx, "OK", "جيد"),
          value: s.value,
        },
        { target: "product", id: s.id }
      )
    ),
  };
}

registerReport({
  id: "inventory-summary",
  noFutureAsOf: true,
  columns: [
    col("sku", "SKU", "الرمز"),
    col("name", "Product", "المنتج"),
    col("onHand", "On hand", "المتاح", "number", { sum: true }),
    col("threshold", "Low-stock level", "حد النقص", "number"),
    col("level", "Stock level", "مستوى المخزون"),
    moneyCol("value", "Value (AED)", "القيمة (درهم)", { sum: true }),
  ],
  run: inventorySummary,
});

async function inventoryMovement(ctx: ReportContext): Promise<ReportOutput> {
  const { from, to } = ctx.window as { from: string; to: string };
  const { start, end } = dayBounds(from, to);
  const happened = await movementDateExpr(ctx);
  const b = new SqlParams();
  const { rows } = await ctx.q.query(
    `SELECT im.id, p.id AS product_id, ${ymdSql(happened)} AS d, COALESCE(p.sku, '') AS sku, p.name, im.type,
            CASE WHEN im.type IN ('purchase', 'return') THEN ABS(im.quantity) WHEN im.type = 'sale' THEN -ABS(im.quantity) ELSE im.quantity END AS qty,
            COALESCE(im.unit_cost, 0)::text AS unit_cost, COALESCE(im.total_cost, 0)::text AS total_cost, im.reference
       FROM inventory_movements im JOIN products p ON p.id = im.product_id
       LEFT JOIN invoices si ON si.id = im.source_invoice_id AND si.company_id = im.company_id
      WHERE im.company_id = ${b.p(ctx.companyId)} AND p.company_id = im.company_id
        AND ${happened} >= ${b.p(start)}::timestamp AND ${happened} <= ${b.p(end)}::timestamp
      ORDER BY ${happened}, im.id LIMIT ${ctx.maxRows + 1}`,
    b.values
  );
  return {
    rows: rows.map((r) =>
      detail(
        `movement:${r.id}`,
        { date: r.d, sku: r.sku, name: r.name, type: r.type, quantity: Number(r.qty), unitCost: money(r.unit_cost), totalCost: money(r.total_cost), reference: r.reference ?? "" },
        { target: "product", id: String(r.product_id) }
      )
    ),
  };
}

registerReport({
  id: "inventory-movement",
  columns: [
    C.date,
    col("sku", "SKU", "الرمز"),
    col("name", "Product", "المنتج"),
    col("type", "Type", "النوع"),
    col("quantity", "Quantity", "الكمية", "number", { sum: true }),
    moneyCol("unitCost", "Unit cost", "تكلفة الوحدة"),
    moneyCol("totalCost", "Total cost", "إجمالي التكلفة"),
    C.reference,
  ],
  run: inventoryMovement,
});

// ---------------------------------------------------------------------------------------------------------------
// Fixed assets: register (as of), depreciation schedule (range), disposals (range)
// ---------------------------------------------------------------------------------------------------------------

async function fixedAssetRegister(ctx: ReportContext): Promise<ReportOutput> {
  const asOf = ctx.window.asOf as string;
  const b = new SqlParams();
  const ay = b.p(Number(asOf.slice(0, 4)));
  const am = b.p(Number(asOf.slice(5, 7)));
  const { rows } = await ctx.q.query(
    `SELECT a.id, COALESCE(a.asset_number, '') AS num, a.asset_name, COALESCE(a.category, '') AS category, ${ymdSql("a.purchase_date")} AS d,
            a.purchase_cost::text AS cost,
            COALESCE((SELECT SUM(ds.amount) FROM depreciation_schedules ds
                       WHERE ds.asset_id = a.id AND ds.posted_at IS NOT NULL AND (ds.period_year * 12 + ds.period_month) <= (${ay}::int * 12 + ${am}::int)), 0)::text AS accumulated
       FROM fixed_assets a
      WHERE a.company_id = ${b.p(ctx.companyId)} AND a.purchase_date <= ${b.p(dayEndTs(asOf))}::timestamp
        AND (a.disposal_date IS NULL OR a.disposal_date > ${b.p(dayEndTs(asOf))}::timestamp)
      ORDER BY a.asset_number NULLS LAST, a.asset_name LIMIT ${ctx.maxRows + 1}`,
    b.values
  );
  return {
    rows: rows.map((r) => {
      const cost = money(r.cost);
      const accumulated = money(r.accumulated);
      return detail(
        `asset:${r.id}`,
        { number: r.num, name: r.asset_name, category: r.category, date: r.d, cost, accumulated, nbv: round2(cost - accumulated) },
        { target: "asset", id: String(r.id) }
      );
    }),
  };
}

registerReport({
  id: "fixed-asset-register",
  noFutureAsOf: true,
  columns: [
    col("number", "Asset no.", "رقم الأصل"),
    col("name", "Asset", "الأصل"),
    col("category", "Category", "الفئة"),
    col("date", "Purchased", "تاريخ الشراء", "date"),
    moneyCol("cost", "Cost (AED)", "التكلفة (درهم)", { sum: true }),
    moneyCol("accumulated", "Accumulated depreciation", "مجمع الإهلاك", { sum: true }),
    moneyCol("nbv", "Net book value", "القيمة الدفترية", { sum: true }),
  ],
  run: fixedAssetRegister,
});

async function depreciationSchedule(ctx: ReportContext): Promise<ReportOutput> {
  const { from, to } = ctx.window as { from: string; to: string };
  const b = new SqlParams();
  const { rows } = await ctx.q.query(
    `SELECT ds.id, a.id AS asset_id, COALESCE(a.asset_number, '') AS num, a.asset_name, ds.period_year, ds.period_month, ds.amount::text AS amount, ds.posted_at
       FROM depreciation_schedules ds JOIN fixed_assets a ON a.id = ds.asset_id
      WHERE ds.company_id = ${b.p(ctx.companyId)} AND a.company_id = ds.company_id
        AND (ds.period_year * 12 + ds.period_month) >= ${b.p(monthIndex(from))}::int AND (ds.period_year * 12 + ds.period_month) <= ${b.p(monthIndex(to))}::int
      ORDER BY ds.period_year, ds.period_month, a.asset_name LIMIT ${ctx.maxRows + 1}`,
    b.values
  );
  return {
    rows: rows.map((r) =>
      detail(
        `dep:${r.id}`,
        {
          period: `${r.period_year}-${String(r.period_month).padStart(2, "0")}`,
          number: r.num,
          name: r.asset_name,
          status: r.posted_at ? pick(ctx, "Posted", "مرحّل") : pick(ctx, "Scheduled", "مجدول"),
          amount: money(r.amount),
        },
        { target: "asset", id: String(r.asset_id) }
      )
    ),
  };
}

registerReport({
  id: "depreciation-schedule",
  columns: [col("period", "Period", "الفترة"), col("number", "Asset no.", "رقم الأصل"), col("name", "Asset", "الأصل"), C.status, moneyCol("amount", "Depreciation (AED)", "الإهلاك (درهم)", { sum: true })],
  run: depreciationSchedule,
});

async function assetDisposals(ctx: ReportContext): Promise<ReportOutput> {
  const { from, to } = ctx.window as { from: string; to: string };
  const { start, end } = dayBounds(from, to);
  const b = new SqlParams();
  const { rows } = await ctx.q.query(
    `SELECT a.id, COALESCE(a.asset_number, '') AS num, a.asset_name, ${ymdSql("a.disposal_date")} AS d, a.purchase_cost::text AS cost,
            COALESCE(a.accumulated_depreciation, 0)::text AS accumulated, COALESCE(a.disposal_amount, 0)::text AS proceeds
       FROM fixed_assets a
      WHERE a.company_id = ${b.p(ctx.companyId)} AND a.disposal_date IS NOT NULL AND a.disposal_date >= ${b.p(start)}::timestamp AND a.disposal_date <= ${b.p(end)}::timestamp
      ORDER BY a.disposal_date, a.asset_name LIMIT ${ctx.maxRows + 1}`,
    b.values
  );
  return {
    rows: rows.map((r) => {
      const nbv = round2(money(r.cost) - money(r.accumulated));
      const proceeds = money(r.proceeds);
      return detail(
        `asset:${r.id}`,
        { date: r.d, number: r.num, name: r.asset_name, cost: money(r.cost), accumulated: money(r.accumulated), nbv, proceeds, gainLoss: round2(proceeds - nbv) },
        { target: "asset", id: String(r.id) }
      );
    }),
  };
}

registerReport({
  id: "asset-disposals",
  columns: [
    C.date,
    col("number", "Asset no.", "رقم الأصل"),
    col("name", "Asset", "الأصل"),
    moneyCol("cost", "Cost", "التكلفة", { sum: true }),
    moneyCol("accumulated", "Accumulated depreciation", "مجمع الإهلاك", { sum: true }),
    moneyCol("nbv", "Net book value", "القيمة الدفترية", { sum: true }),
    moneyCol("proceeds", "Proceeds", "المتحصلات", { sum: true }),
    moneyCol("gainLoss", "Gain / (loss)", "ربح / (خسارة)", { sum: true }),
  ],
  run: assetDisposals,
});

// ---------------------------------------------------------------------------------------------------------------
// Payroll: summary and WPS / SIF per run, and the per-employee register (sensitive)
// ---------------------------------------------------------------------------------------------------------------

function runFilter(ctx: ReportContext, b: SqlParams, alias = "r"): string[] {
  const { from, to } = ctx.window as { from: string; to: string };
  const conds = [
    `${alias}.company_id = ${b.p(ctx.companyId)}`,
    `(${alias}.period_year * 12 + ${alias}.period_month) >= ${b.p(monthIndex(from))}::int`,
    `(${alias}.period_year * 12 + ${alias}.period_month) <= ${b.p(monthIndex(to))}::int`,
  ];
  if (ctx.params.filters.payrollRunId) conds.push(`${alias}.id = ${b.p(ctx.params.filters.payrollRunId)}::uuid`);
  return conds;
}

async function payrollSummary(ctx: ReportContext): Promise<ReportOutput> {
  const b = new SqlParams();
  const { rows } = await ctx.q.query(
    `SELECT r.id, r.period_year, r.period_month, r.status, COALESCE(r.employee_count, 0) AS employees, COALESCE(r.total_basic, 0)::text AS basic,
            COALESCE(r.total_allowances, 0)::text AS allowances, COALESCE(r.total_deductions, 0)::text AS deductions, COALESCE(r.total_net, 0)::text AS net,
            COALESCE(r.total_pension_employer, 0)::text AS pension, COALESCE(r.total_gratuity_accrual, 0)::text AS gratuity
       FROM payroll_runs r WHERE ${runFilter(ctx, b).join(" AND ")} ORDER BY r.period_year, r.period_month, r.created_at`,
    b.values
  );
  return {
    rows: rows.map((r) =>
      detail(
        `run:${r.id}`,
        {
          period: `${r.period_year}-${String(r.period_month).padStart(2, "0")}`,
          status: r.status,
          employees: Number(r.employees),
          basic: money(r.basic),
          allowances: money(r.allowances),
          deductions: money(r.deductions),
          net: money(r.net),
          pension: money(r.pension),
          gratuity: money(r.gratuity),
        },
        { target: "payslip", id: String(r.id) }
      )
    ),
  };
}

registerReport({
  id: "payroll-summary",
  sensitive: true,
  filters: ["payrollRunId"],
  columns: [
    col("period", "Period", "الفترة"),
    C.status,
    col("employees", "Employees", "الموظفون", "number"),
    moneyCol("basic", "Basic", "الأساسي", { sum: true }),
    moneyCol("allowances", "Allowances", "البدلات", { sum: true }),
    moneyCol("deductions", "Deductions", "الخصومات", { sum: true }),
    moneyCol("net", "Net pay", "صافي الراتب", { sum: true }),
    moneyCol("pension", "Employer pension", "معاش صاحب العمل", { sum: true }),
    moneyCol("gratuity", "Gratuity accrual", "مخصص نهاية الخدمة", { sum: true }),
  ],
  run: payrollSummary,
});

async function wpsSummary(ctx: ReportContext): Promise<ReportOutput> {
  const b = new SqlParams();
  const { rows } = await ctx.q.query(
    `SELECT r.id, r.period_year, r.period_month, r.status, COALESCE(r.employee_count, 0) AS employees, COALESCE(r.total_net, 0)::text AS net,
            (r.sif_file_content IS NOT NULL AND r.sif_file_content <> '') AS has_sif, ${ymdSql("r.approved_at")} AS approved
       FROM payroll_runs r WHERE ${runFilter(ctx, b).join(" AND ")} ORDER BY r.period_year, r.period_month, r.created_at`,
    b.values
  );
  return {
    rows: rows.map((r) =>
      detail(
        `run:${r.id}`,
        {
          period: `${r.period_year}-${String(r.period_month).padStart(2, "0")}`,
          status: r.status,
          employees: Number(r.employees),
          net: money(r.net),
          sif: r.has_sif ? pick(ctx, "Generated", "تم إنشاؤه") : pick(ctx, "Not generated", "لم يُنشأ"),
          approved: r.approved ?? "",
        },
        { target: "payslip", id: String(r.id) }
      )
    ),
  };
}

registerReport({
  id: "wps-sif-summary",
  sensitive: true,
  filters: ["payrollRunId"],
  columns: [
    col("period", "Period", "الفترة"),
    C.status,
    col("employees", "Employees", "الموظفون", "number"),
    moneyCol("net", "SIF total (AED)", "إجمالي ملف SIF (درهم)", { sum: true }),
    col("sif", "SIF file", "ملف SIF"),
    col("approved", "Approved", "تاريخ الاعتماد", "date"),
  ],
  run: wpsSummary,
});

async function payrollRegister(ctx: ReportContext): Promise<ReportOutput> {
  const b = new SqlParams();
  const { rows } = await ctx.q.query(
    `SELECT pi.id, r.period_year, r.period_month, COALESCE(e.employee_number, '') AS num, e.full_name,
            COALESCE(pi.basic_salary, 0)::text AS basic,
            (COALESCE(pi.housing_allowance, 0) + COALESCE(pi.transport_allowance, 0) + COALESCE(pi.other_allowance, 0))::text AS allowances,
            COALESCE(pi.overtime, 0)::text AS overtime,
            -- every deduction (sundry, employee pension, leave, loan) so that basic + allowances + overtime - deductions = net
            (COALESCE(pi.deductions, 0) + COALESCE(pi.pension_employee, 0) + COALESCE(pi.leave_deduction, 0) + COALESCE(pi.loan_deduction, 0))::text AS deductions,
            COALESCE(pi.net_salary, 0)::text AS net
       FROM payroll_items pi
       JOIN payroll_runs r ON r.id = pi.payroll_run_id
       JOIN employees e ON e.id = pi.employee_id AND e.company_id = r.company_id
      -- the register is the approved payroll: a draft or calculated run appears only when it is picked by name
      WHERE ${runFilter(ctx, b).join(" AND ")}${ctx.params.filters.payrollRunId ? "" : " AND r.status IN ('approved', 'paid')"} ORDER BY r.period_year, r.period_month, e.employee_number, e.full_name LIMIT ${ctx.maxRows + 1}`,
    b.values
  );
  return {
    rows: rows.map((r) =>
      detail(
        `item:${r.id}`,
        {
          period: `${r.period_year}-${String(r.period_month).padStart(2, "0")}`,
          number: r.num,
          name: r.full_name,
          basic: money(r.basic),
          allowances: money(r.allowances),
          overtime: money(r.overtime),
          deductions: money(r.deductions),
          net: money(r.net),
        },
        { target: "payslip", id: String(r.id) }
      )
    ),
  };
}

registerReport({
  id: "payroll-register",
  sensitive: true,
  filters: ["payrollRunId"],
  columns: [
    col("period", "Period", "الفترة"),
    col("number", "Employee no.", "رقم الموظف"),
    col("name", "Employee", "الموظف"),
    moneyCol("basic", "Basic", "الأساسي", { sum: true }),
    moneyCol("allowances", "Allowances", "البدلات", { sum: true }),
    moneyCol("overtime", "Overtime", "العمل الإضافي", { sum: true }),
    moneyCol("deductions", "Deductions", "الخصومات", { sum: true }),
    moneyCol("net", "Net pay", "صافي الراتب", { sum: true }),
  ],
  run: payrollRegister,
});

