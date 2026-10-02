// Financial statements over the shared ledger layer: Profit & Loss, Balance Sheet, Cash Flow (indirect and direct),
// Trial Balance, Comparative Trial Balance, Equity Movement and Period Comparison (Phase 8 D4).

import { AppError } from "../../errors";
import { classifyBalanceSheetAccount, round2 } from "../../services/financial-statements";
import { addDays, fiscalYearStart } from "../dates";
import {
  PL_EXCLUDED_SOURCES,
  SqlParams,
  accountBalances,
  cashAccountSql,
  cashBalance,
  ledgerLinesSql,
  money,
  openingMovementClosing,
  periodProfit,
} from "../ledger";
import { registerReport, type ReportContext, type ReportOutput } from "../registry";
import { C, acctName, col, detail, moneyCol, pick, section, subtotal, sumMoney } from "./helpers";

const nameCol = col("name", "Account", "الحساب");
const amountCol = moneyCol("amount", "Amount (AED)", "المبلغ (درهم)", { comparable: true });

// ---------------------------------------------------------------------------------------------------------------
// Profit & Loss
// ---------------------------------------------------------------------------------------------------------------

async function profitLoss(ctx: ReportContext): Promise<ReportOutput> {
  const { from, to } = ctx.window;
  const accts = await accountBalances(ctx.q, ctx.companyId, { from, to, excludeSources: PL_EXCLUDED_SOURCES });
  const revenue = accts
    .filter((a) => a.type === "income")
    .map((a) => ({ a, amount: round2(a.credit - a.debit) }))
    .filter((r) => r.amount !== 0);
  const expenses = accts
    .filter((a) => a.type === "expense")
    .map((a) => ({ a, amount: round2(a.debit - a.credit) }))
    .filter((r) => r.amount !== 0);
  const totalRevenue = sumMoney(revenue.map((r) => r.amount));
  const totalExpenses = sumMoney(expenses.map((r) => r.amount));
  const net = round2(totalRevenue - totalExpenses);
  const rows = [
    section("section:revenue", { name: pick(ctx, "Revenue", "الإيرادات") }),
    ...revenue.map((r) =>
      detail(`acct:${r.a.accountId}`, { code: r.a.code, name: acctName(ctx, r.a), amount: r.amount }, { target: "account", id: r.a.accountId }, 1)
    ),
    subtotal("subtotal:revenue", { name: pick(ctx, "Total revenue", "إجمالي الإيرادات"), amount: totalRevenue }),
    section("section:expenses", { name: pick(ctx, "Expenses", "المصروفات") }),
    ...expenses.map((r) =>
      detail(`acct:${r.a.accountId}`, { code: r.a.code, name: acctName(ctx, r.a), amount: r.amount }, { target: "account", id: r.a.accountId }, 1)
    ),
    subtotal("subtotal:expenses", { name: pick(ctx, "Total expenses", "إجمالي المصروفات"), amount: totalExpenses }),
    subtotal("subtotal:net", { name: pick(ctx, "Net profit", "صافي الربح"), amount: net }),
  ];
  return { rows, totals: { amount: net } };
}

registerReport({
  id: "profit-loss",
  columns: [C.code, nameCol, amountCol],
  run: profitLoss,
});

// ---------------------------------------------------------------------------------------------------------------
// Balance Sheet
// ---------------------------------------------------------------------------------------------------------------

async function balanceSheet(ctx: ReportContext): Promise<ReportOutput> {
  const asOf = ctx.window.asOf;
  const accts = await accountBalances(ctx.q, ctx.companyId, { to: asOf });
  type Line = { a: (typeof accts)[number]; amount: number };
  const groups: Record<"asset" | "liability" | "equity", Line[]> = { asset: [], liability: [], equity: [] };
  let earnings = 0;
  for (const a of accts) {
    const c = classifyBalanceSheetAccount({ type: a.type, debitTotal: a.debit, creditTotal: a.credit, code: a.code });
    if (c.section === "income" || c.section === "expense") {
      earnings = round2(earnings + c.amount);
      continue;
    }
    if (c.amount === 0) continue;
    groups[c.section].push({ a, amount: c.amount });
  }
  const block = (key: "asset" | "liability" | "equity", en: string, ar: string) => {
    const list = groups[key];
    const total = sumMoney(list.map((l) => l.amount));
    return {
      total,
      rows: [
        section(`section:${key}`, { name: pick(ctx, en, ar) }),
        ...list.map((l) =>
          detail(`acct:${l.a.accountId}`, { code: l.a.code, name: acctName(ctx, l.a), amount: l.amount }, { target: "account", id: l.a.accountId }, 1)
        ),
      ],
    };
  };
  const assets = block("asset", "Assets", "الأصول");
  const liabilities = block("liability", "Liabilities", "الالتزامات");
  const equity = block("equity", "Equity", "حقوق الملكية");
  const equityRows = [...equity.rows];
  if (earnings !== 0) {
    equityRows.push(
      detail("earnings", { code: "", name: pick(ctx, "Current-year earnings", "أرباح السنة الحالية"), amount: earnings }, undefined, 1)
    );
  }
  const totalEquity = round2(equity.total + earnings);
  const totalLE = round2(liabilities.total + totalEquity);
  const rows = [
    ...assets.rows,
    subtotal("subtotal:asset", { name: pick(ctx, "Total assets", "إجمالي الأصول"), amount: assets.total }),
    ...liabilities.rows,
    subtotal("subtotal:liability", { name: pick(ctx, "Total liabilities", "إجمالي الالتزامات"), amount: liabilities.total }),
    ...equityRows,
    subtotal("subtotal:equity", { name: pick(ctx, "Total equity", "إجمالي حقوق الملكية"), amount: totalEquity }),
    subtotal("subtotal:le", { name: pick(ctx, "Total liabilities and equity", "إجمالي الالتزامات وحقوق الملكية"), amount: totalLE }),
  ];
  const warnings = Math.abs(assets.total - totalLE) >= 0.005 ? [pick(ctx, "The balance sheet does not balance.", "الميزانية العمومية غير متوازنة.")] : undefined;
  return { rows, totals: { amount: assets.total }, warnings };
}

registerReport({
  id: "balance-sheet",
  columns: [C.code, nameCol, amountCol],
  run: balanceSheet,
});

// ---------------------------------------------------------------------------------------------------------------
// Trial Balance (cumulative as of a day) and the comparative version
// ---------------------------------------------------------------------------------------------------------------

const drCr = (net: number): { debit: number; credit: number } => ({ debit: net > 0 ? net : 0, credit: net < 0 ? round2(-net) : 0 });

async function trialBalance(ctx: ReportContext): Promise<ReportOutput> {
  const accts = await accountBalances(ctx.q, ctx.companyId, { to: ctx.window.asOf });
  const rows = accts
    .map((a) => ({ a, net: round2(a.debit - a.credit) }))
    .filter((r) => r.net !== 0)
    .map((r) =>
      detail(
        `acct:${r.a.accountId}`,
        { code: r.a.code, name: acctName(ctx, r.a), type: r.a.type, ...drCr(r.net) },
        { target: "account", id: r.a.accountId }
      )
    );
  const debit = sumMoney(rows.map((r) => r.cells.debit as number));
  const credit = sumMoney(rows.map((r) => r.cells.credit as number));
  return {
    rows,
    totals: { debit, credit },
    warnings: debit !== credit ? [pick(ctx, "Debits and credits do not balance.", "المدين والدائن غير متوازنين.")] : undefined,
  };
}

registerReport({
  id: "trial-balance",
  columns: [C.code, nameCol, col("type", "Type", "النوع"), C.debit(), C.credit()],
  run: trialBalance,
});

async function comparativeTrialBalance(ctx: ReportContext): Promise<ReportOutput> {
  const closing = ctx.window.asOf as string;
  const cmp = ctx.params.compare;
  const opening =
    cmp.mode === "none" || cmp.mode === "budget"
      ? addDays(fiscalYearStart(closing, ctx.company.fiscalYearStartMonth), -1)
      : (cmp.asOf as string);
  if (opening >= closing) {
    throw new AppError({ message: "The comparison day must be before the as-of day.", statusCode: 422, code: "INVALID_RANGE" });
  }
  const accts = await openingMovementClosing(ctx.q, ctx.companyId, addDays(opening, 1), closing);
  const rows = accts
    .map((a) => {
      const openingNet = round2(a.openingDebit - a.openingCredit);
      const closingNet = round2(a.debit - a.credit);
      return { a, openingNet, closingNet };
    })
    .filter((r) => r.openingNet !== 0 || r.closingNet !== 0 || r.a.movementDebit !== 0 || r.a.movementCredit !== 0)
    .map((r) => {
      const o = drCr(r.openingNet);
      const c = drCr(r.closingNet);
      return detail(
        `acct:${r.a.accountId}`,
        {
          code: r.a.code,
          name: acctName(ctx, r.a),
          openingDebit: o.debit,
          openingCredit: o.credit,
          movementDebit: r.a.movementDebit,
          movementCredit: r.a.movementCredit,
          closingDebit: c.debit,
          closingCredit: c.credit,
        },
        { target: "account", id: r.a.accountId }
      );
    });
  const total = (key: string) => sumMoney(rows.map((r) => r.cells[key] as number));
  const totals = {
    openingDebit: total("openingDebit"),
    openingCredit: total("openingCredit"),
    movementDebit: total("movementDebit"),
    movementCredit: total("movementCredit"),
    closingDebit: total("closingDebit"),
    closingCredit: total("closingCredit"),
  };
  const warnings: string[] = [];
  if (totals.openingDebit !== totals.openingCredit || totals.closingDebit !== totals.closingCredit) {
    warnings.push(pick(ctx, "Debits and credits do not balance.", "المدين والدائن غير متوازنين."));
  }
  warnings.push(pick(ctx, `Opening balances are as of ${opening}.`, `الأرصدة الافتتاحية كما في ${opening}.`));
  return { rows, totals, warnings };
}

registerReport({
  id: "comparative-trial-balance",
  ownComparison: true,
  columns: [
    C.code,
    nameCol,
    moneyCol("openingDebit", "Opening debit", "افتتاحي مدين", { sum: true }),
    moneyCol("openingCredit", "Opening credit", "افتتاحي دائن", { sum: true }),
    moneyCol("movementDebit", "Movement debit", "حركة مدين", { sum: true }),
    moneyCol("movementCredit", "Movement credit", "حركة دائن", { sum: true }),
    moneyCol("closingDebit", "Closing debit", "ختامي مدين", { sum: true }),
    moneyCol("closingCredit", "Closing credit", "ختامي دائن", { sum: true }),
  ],
  run: comparativeTrialBalance,
});

// ---------------------------------------------------------------------------------------------------------------
// Cash flow, indirect: net profit plus the movement of every balance-sheet account, so net cash change ties to cash
// ---------------------------------------------------------------------------------------------------------------

type CfSection = "operating" | "investing" | "financing";

function cfSection(a: { type: string; subType: string | null; code: string }): CfSection {
  if (a.type === "equity") return "financing";
  if (a.type === "asset" && a.subType === "fixed_asset" && a.code !== "1240") return "investing";
  if (a.type === "liability" && a.subType === "long_term_liability") return "financing";
  return "operating";
}

async function cashFlowIndirect(ctx: ReportContext): Promise<ReportOutput> {
  const { from, to } = ctx.window as { from: string; to: string };
  const profit = await periodProfit(ctx.q, ctx.companyId, from, to);
  const accts = await openingMovementClosing(ctx.q, ctx.companyId, from, to, PL_EXCLUDED_SOURCES);
  const isCash = await cashAccountIds(ctx);
  const buckets: Record<CfSection, Array<{ a: (typeof accts)[number]; amount: number }>> = { operating: [], investing: [], financing: [] };
  for (const a of accts) {
    if (a.type === "income" || a.type === "expense" || isCash.has(a.accountId)) continue;
    const delta = round2(a.movementDebit - a.movementCredit); // change in (debit - credit)
    // An increase in an asset uses cash; an increase in a liability or equity provides it: effect = -(change in debit - credit).
    const effect = round2(-delta);
    if (effect === 0) continue;
    buckets[cfSection(a)].push({ a, amount: effect });
  }
  const label = (a: { nameEn: string; nameAr: string | null }, section: CfSection) =>
    section === "operating"
      ? pick(ctx, `Change in ${a.nameEn}`, `التغير في ${a.nameAr ?? a.nameEn}`)
      : acctName(ctx, a);
  const rows = [section("section:operating", { name: pick(ctx, "Operating activities", "الأنشطة التشغيلية") })];
  rows.push(detail("net-profit", { name: pick(ctx, "Net profit", "صافي الربح"), amount: profit.net }, undefined, 1));
  const out: Record<CfSection, number> = { operating: profit.net, investing: 0, financing: 0 };
  const heading: Record<CfSection, [string, string, string, string]> = {
    operating: ["Operating activities", "الأنشطة التشغيلية", "Net cash from operating activities", "صافي النقد من الأنشطة التشغيلية"],
    investing: ["Investing activities", "الأنشطة الاستثمارية", "Net cash from investing activities", "صافي النقد من الأنشطة الاستثمارية"],
    financing: ["Financing activities", "الأنشطة التمويلية", "Net cash from financing activities", "صافي النقد من الأنشطة التمويلية"],
  };
  for (const s of ["operating", "investing", "financing"] as CfSection[]) {
    if (s !== "operating") rows.push(section(`section:${s}`, { name: pick(ctx, heading[s][0], heading[s][1]) }));
    for (const l of buckets[s]) {
      rows.push(detail(`acct:${l.a.accountId}`, { code: l.a.code, name: label(l.a, s), amount: l.amount }, { target: "account", id: l.a.accountId }, 1));
    }
    out[s] = round2(out[s] + sumMoney(buckets[s].map((l) => l.amount)));
    rows.push(subtotal(`subtotal:${s}`, { name: pick(ctx, heading[s][2], heading[s][3]), amount: out[s] }));
  }
  const net = round2(out.operating + out.investing + out.financing);
  const dayBefore = addDays(from, -1);
  const openingCash = await cashBalance(ctx.q, ctx.companyId, dayBefore);
  const closingCash = await cashBalance(ctx.q, ctx.companyId, to);
  rows.push(subtotal("subtotal:net", { name: pick(ctx, "Net change in cash", "صافي التغير في النقد"), amount: net }));
  rows.push(subtotal("cash:opening", { name: pick(ctx, "Cash at start of period", "النقد في بداية الفترة"), amount: openingCash }));
  rows.push(subtotal("cash:closing", { name: pick(ctx, "Cash at end of period", "النقد في نهاية الفترة"), amount: closingCash }));
  const warnings = Math.abs(round2(openingCash + net) - closingCash) >= 0.005 ? [pick(ctx, "Net change does not tie to the cash balance.", "صافي التغير لا يطابق رصيد النقد.")] : undefined;
  return { rows, totals: { amount: net }, warnings };
}

async function cashAccountIds(ctx: ReportContext): Promise<Set<string>> {
  const b = new SqlParams();
  const { rows } = await ctx.q.query(`SELECT a.id FROM accounts a WHERE a.company_id = ${b.p(ctx.companyId)} AND ${cashAccountSql("a")}`, b.values);
  return new Set(rows.map((r) => String(r.id)));
}

registerReport({
  id: "cash-flow",
  columns: [C.code, nameCol, amountCol],
  run: cashFlowIndirect,
});

// ---------------------------------------------------------------------------------------------------------------
// Cash flow, direct: gross receipts and payments per counterpart account of every entry that moved cash
// ---------------------------------------------------------------------------------------------------------------

async function cashFlowDirect(ctx: ReportContext): Promise<ReportOutput> {
  const { from, to } = ctx.window as { from: string; to: string };
  const b = new SqlParams();
  const { rows: raw } = await ctx.q.query(
    `WITH ${ledgerLinesSql(b, ctx.companyId, { from, to, excludeSources: PL_EXCLUDED_SOURCES })},
     cash_entries AS (
       SELECT DISTINCT l.entry_id FROM ledger l JOIN accounts ca ON ca.id = l.account_id WHERE ${cashAccountSql("ca")}
     )
     SELECT a.id, a.code, a.name_en, a.name_ar, a.type, a.sub_type,
            COALESCE(SUM(GREATEST(l.credit - l.debit, 0)), 0)::text AS receipts,
            COALESCE(SUM(GREATEST(l.debit - l.credit, 0)), 0)::text AS payments
       FROM ledger l JOIN accounts a ON a.id = l.account_id
      WHERE l.entry_id IN (SELECT entry_id FROM cash_entries) AND NOT ${cashAccountSql("a")}
      GROUP BY a.id ORDER BY a.code`,
    b.values
  );
  const lines = raw.map((r) => ({
    id: String(r.id),
    code: String(r.code),
    nameEn: String(r.name_en),
    nameAr: (r.name_ar as string | null) ?? null,
    type: String(r.type),
    subType: (r.sub_type as string | null) ?? null,
    receipts: money(r.receipts),
    payments: money(r.payments),
  }));
  const heading: Record<CfSection, [string, string]> = {
    operating: ["Operating activities", "الأنشطة التشغيلية"],
    investing: ["Investing activities", "الأنشطة الاستثمارية"],
    financing: ["Financing activities", "الأنشطة التمويلية"],
  };
  const out: ReportOutput["rows"] = [];
  let net = 0;
  for (const s of ["operating", "investing", "financing"] as CfSection[]) {
    const list = lines.filter((l) => cfSection(l) === s && (l.receipts !== 0 || l.payments !== 0));
    out.push(section(`section:${s}`, { name: pick(ctx, heading[s][0], heading[s][1]) }));
    for (const l of list) {
      out.push(
        detail(
          `acct:${l.id}`,
          { code: l.code, name: acctName(ctx, l), receipts: l.receipts, payments: l.payments, amount: round2(l.receipts - l.payments) },
          { target: "account", id: l.id },
          1
        )
      );
    }
    const subtotalAmount = sumMoney(list.map((l) => round2(l.receipts - l.payments)));
    net = round2(net + subtotalAmount);
    out.push(
      subtotal(`subtotal:${s}`, {
        name: pick(ctx, `Net cash from ${s} activities`, `صافي النقد من الأنشطة ${s === "operating" ? "التشغيلية" : s === "investing" ? "الاستثمارية" : "التمويلية"}`),
        receipts: sumMoney(list.map((l) => l.receipts)),
        payments: sumMoney(list.map((l) => l.payments)),
        amount: subtotalAmount,
      })
    );
  }
  const openingCash = await cashBalance(ctx.q, ctx.companyId, addDays(from, -1));
  const closingCash = await cashBalance(ctx.q, ctx.companyId, to);
  out.push(subtotal("subtotal:net", { name: pick(ctx, "Net change in cash", "صافي التغير في النقد"), amount: net }));
  out.push(subtotal("cash:opening", { name: pick(ctx, "Cash at start of period", "النقد في بداية الفترة"), amount: openingCash }));
  out.push(subtotal("cash:closing", { name: pick(ctx, "Cash at end of period", "النقد في نهاية الفترة"), amount: closingCash }));
  const warnings = Math.abs(round2(openingCash + net) - closingCash) >= 0.005 ? [pick(ctx, "Net change does not tie to the cash balance.", "صافي التغير لا يطابق رصيد النقد.")] : undefined;
  return { rows: out, totals: { amount: net }, warnings };
}

registerReport({
  id: "cash-flow-direct",
  columns: [
    C.code,
    nameCol,
    moneyCol("receipts", "Receipts", "المقبوضات", { comparable: true }),
    moneyCol("payments", "Payments", "المدفوعات", { comparable: true }),
    amountCol,
  ],
  run: cashFlowDirect,
});

// ---------------------------------------------------------------------------------------------------------------
// Equity movement: opening, additions, reductions, closing per equity account, with unclosed earnings as its own line
// ---------------------------------------------------------------------------------------------------------------

async function equityMovement(ctx: ReportContext): Promise<ReportOutput> {
  const { from, to } = ctx.window as { from: string; to: string };
  const accts = await openingMovementClosing(ctx.q, ctx.companyId, from, to);
  const equity = accts
    .filter((a) => a.type === "equity")
    .map((a) => ({
      a,
      opening: round2(a.openingCredit - a.openingDebit),
      additions: a.movementCredit,
      reductions: a.movementDebit,
      closing: round2(a.credit - a.debit),
    }))
    .filter((r) => r.opening !== 0 || r.additions !== 0 || r.reductions !== 0);
  const rows = equity.map((r) =>
    detail(
      `acct:${r.a.accountId}`,
      { code: r.a.code, name: acctName(ctx, r.a), opening: r.opening, additions: r.additions, reductions: r.reductions, closing: r.closing },
      { target: "account", id: r.a.accountId }
    )
  );
  // Earnings not yet carried into equity by a year-end close: P&L accounts through the day, closing entries included.
  const pl = accts.filter((a) => a.type === "income" || a.type === "expense");
  const eOpening = sumMoney(pl.map((a) => round2(a.openingCredit - a.openingDebit)));
  const eMoveCr = sumMoney(pl.map((a) => a.movementCredit));
  const eMoveDr = sumMoney(pl.map((a) => a.movementDebit));
  const eClosing = sumMoney(pl.map((a) => round2(a.credit - a.debit)));
  const netMove = round2(eMoveCr - eMoveDr);
  if (eOpening !== 0 || netMove !== 0) {
    rows.push(
      detail("earnings", {
        code: "",
        name: pick(ctx, "Current-year earnings (not yet closed)", "أرباح السنة الحالية (غير مقفلة)"),
        opening: eOpening,
        additions: netMove > 0 ? netMove : 0,
        reductions: netMove < 0 ? round2(-netMove) : 0,
        closing: eClosing,
      })
    );
  }
  const total = (key: string) => sumMoney(rows.map((r) => r.cells[key] as number));
  return {
    rows,
    totals: { opening: total("opening"), additions: total("additions"), reductions: total("reductions"), closing: total("closing") },
  };
}

registerReport({
  id: "equity-movement",
  columns: [
    C.code,
    nameCol,
    moneyCol("opening", "Opening", "الافتتاحي", { sum: true }),
    moneyCol("additions", "Additions", "الإضافات", { sum: true }),
    moneyCol("reductions", "Reductions", "التخفيضات", { sum: true }),
    moneyCol("closing", "Closing", "الختامي", { sum: true }),
  ],
  run: equityMovement,
});

// ---------------------------------------------------------------------------------------------------------------
// Period Comparison: the three headline P&L figures against the prior period (a comparison run by default)
// ---------------------------------------------------------------------------------------------------------------

async function periodComparison(ctx: ReportContext): Promise<ReportOutput> {
  const { from, to } = ctx.window;
  const p = await periodProfit(ctx.q, ctx.companyId, from, to);
  const target = { target: "report" as const, id: "profit-loss" };
  return {
    rows: [
      detail("revenue", { name: pick(ctx, "Revenue", "الإيرادات"), amount: p.revenue }, target),
      detail("expenses", { name: pick(ctx, "Expenses", "المصروفات"), amount: p.expenses }, target),
      detail("net", { name: pick(ctx, "Net profit", "صافي الربح"), amount: p.net }, target),
    ],
    totals: { amount: p.net },
  };
}

registerReport({
  id: "period-comparison",
  defaultCompare: "priorPeriod",
  columns: [nameCol, amountCol],
  run: periodComparison,
});

