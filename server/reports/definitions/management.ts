// Management and control reports (Phase 8 D4): Budget vs Actual, Cost Centre P&L, Cash Flow Forecast, Month-End Close
// Status, the Audit Trail over activity_logs and the firm consolidation (consolidated-statements).

import { AppError } from "../../errors";
import { invoiceOutstandingAsOfSql, billOutstandingAsOfSql, billDueDateSql, postedBillSql, standingSql } from "../../services/aging-as-of.service";
import { round2 } from "../../services/financial-statements";
import { addDays, dayBounds, dayEndTs, daysBetween, endOfMonth, startOfMonth, todayYmd, ymdSql } from "../dates";
import { PL_EXCLUDED_SOURCES, SqlParams, accountBalances, cashBalance, ledgerLinesSql, money } from "../ledger";
import { consolidate, type ConsolidationEntity } from "../consolidation";
import { registerReport, type DefColumn, type ReportContext, type ReportOutput } from "../registry";
import { C, acctName, col, detail, moneyCol, pick, section, subtotal, sumMoney } from "./helpers";

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"] as const;

// ---------------------------------------------------------------------------------------------------------------
// Budget vs Actual (range): the company's budget plan lines for the months in range against the ledger
// ---------------------------------------------------------------------------------------------------------------

function monthsIn(from: string, to: string): Array<{ year: number; month: number }> {
  const out: Array<{ year: number; month: number }> = [];
  let cursor = startOfMonth(from);
  while (cursor <= to && out.length < 60) {
    out.push({ year: Number(cursor.slice(0, 4)), month: Number(cursor.slice(5, 7)) });
    cursor = addDays(endOfMonth(cursor), 1);
  }
  return out;
}

async function budgetActual(ctx: ReportContext): Promise<ReportOutput> {
  const { from, to } = ctx.window as { from: string; to: string };
  const planId = ctx.params.filters.budgetPlanId;
  const plan = (
    planId
      ? await ctx.q.query(`SELECT id, name, fiscal_year FROM budget_plans WHERE id = $1 AND company_id = $2`, [planId, ctx.companyId])
      : await ctx.q.query(
          `SELECT id, name, fiscal_year FROM budget_plans WHERE company_id = $1 ORDER BY (status = 'approved') DESC, created_at DESC LIMIT 1`,
          [ctx.companyId]
        )
  ).rows[0];
  if (!plan) {
    return { rows: [], warnings: [pick(ctx, "No budget plan exists yet.", "لا توجد خطة موازنة بعد.")] };
  }
  const lines = (await ctx.q.query(`SELECT * FROM budget_lines WHERE budget_id = $1 ORDER BY category, created_at`, [plan.id])).rows;
  const months = monthsIn(from, to).filter((m) => m.year === Number(plan.fiscal_year));
  const accts = await accountBalances(ctx.q, ctx.companyId, { from, to, excludeSources: PL_EXCLUDED_SOURCES });
  const actualByAccount = new Map(
    accts.map((a) => [a.accountId, a.type === "income" ? round2(a.credit - a.debit) : a.type === "expense" ? round2(a.debit - a.credit) : round2(a.debit - a.credit)])
  );
  const accountById = new Map(accts.map((a) => [a.accountId, a]));
  const rows = lines.map((l: any) => {
    const budget = round2(months.reduce((s, m) => s + Number(l[MONTHS[m.month - 1]] ?? 0), 0));
    const actual = l.account_id ? Math.abs(actualByAccount.get(String(l.account_id)) ?? 0) : 0;
    const variance = round2(budget - actual);
    const acct = l.account_id ? accountById.get(String(l.account_id)) : undefined;
    return detail(
      `line:${l.id}`,
      {
        category: l.category ?? "",
        description: l.description ?? "",
        account: acct ? `${acct.code} ${acctName(ctx, acct)}` : "",
        budget,
        actual: round2(actual),
        variance,
        variancePct: budget === 0 ? null : round2((variance / budget) * 100),
      },
      l.account_id ? { target: "account", id: String(l.account_id) } : undefined
    );
  });
  return { rows, warnings: [pick(ctx, `Budget plan: ${plan.name}`, `خطة الموازنة: ${plan.name}`)] };
}

registerReport({
  id: "budget-actual",
  budgetComparison: true,
  filters: ["budgetPlanId"],
  columns: [
    col("category", "Category", "الفئة"),
    C.description,
    col("account", "Account", "الحساب"),
    moneyCol("budget", "Budget", "الموازنة", { sum: true }),
    moneyCol("actual", "Actual", "الفعلي", { sum: true }),
    moneyCol("variance", "Variance", "الفرق", { sum: true }),
    col("variancePct", "Variance %", "الفرق %", "percent"),
  ],
  run: budgetActual,
});

// ---------------------------------------------------------------------------------------------------------------
// Cost Centre P&L (range, comparable): income and expense lines by cost centre
// ---------------------------------------------------------------------------------------------------------------

async function costCenterProfitability(ctx: ReportContext): Promise<ReportOutput> {
  const { from, to } = ctx.window as { from: string; to: string };
  const b = new SqlParams();
  const { rows } = await ctx.q.query(
    `WITH ${ledgerLinesSql(b, ctx.companyId, { from, to, excludeSources: PL_EXCLUDED_SOURCES, costCenterId: ctx.params.filters.costCenterId })}
     SELECT cc.id, COALESCE(cc.code || ' ' || cc.name, 'Unallocated') AS name,
            COALESCE(SUM(l.credit - l.debit) FILTER (WHERE a.type = 'income'), 0)::text AS revenue,
            COALESCE(SUM(l.debit - l.credit) FILTER (WHERE a.type = 'expense'), 0)::text AS expenses
       FROM ledger l
       JOIN accounts a ON a.id = l.account_id AND a.company_id = ${b.p(ctx.companyId)}
       LEFT JOIN cost_centers cc ON cc.id = l.cost_center_id AND cc.company_id = ${b.p(ctx.companyId)}
      WHERE a.type IN ('income', 'expense') GROUP BY cc.id, cc.code, cc.name ORDER BY cc.code NULLS LAST`,
    b.values
  );
  return {
    rows: rows.map((r) => {
      const revenue = money(r.revenue);
      const expenses = money(r.expenses);
      return detail(`cc:${r.id ?? "none"}`, { name: r.id ? r.name : pick(ctx, "Unallocated", "غير موزع"), revenue, expenses, profit: round2(revenue - expenses) });
    }),
  };
}

registerReport({
  id: "cost-center-profitability",
  filters: ["costCenterId"],
  columns: [
    col("name", "Cost centre", "مركز التكلفة"),
    moneyCol("revenue", "Revenue", "الإيرادات", { comparable: true, sum: true }),
    moneyCol("expenses", "Expenses", "المصروفات", { comparable: true, sum: true }),
    moneyCol("profit", "Profit", "الربح", { comparable: true, sum: true }),
  ],
  run: costCenterProfitability,
});

// ---------------------------------------------------------------------------------------------------------------
// Cash Flow Forecast (range): open invoices and bills by due week against today's cash
// ---------------------------------------------------------------------------------------------------------------

const FORECAST_DAYS = 90;

async function cashFlowForecast(ctx: ReportContext): Promise<ReportOutput> {
  const today = todayYmd(ctx.now);
  const requested = ctx.window as { from: string; to: string };
  const futureHorizon = requested.to > today;
  const start = requested.from > today ? requested.from : today;
  const end = futureHorizon ? requested.to : addDays(today, FORECAST_DAYS);
  const warnings = futureHorizon ? undefined : [pick(ctx, `The range ended before today, so the next ${FORECAST_DAYS} days are forecast.`, `انتهى النطاق قبل اليوم، لذا تم توقع الأيام الـ ${FORECAST_DAYS} القادمة.`)];
  const params = [ctx.companyId, today, dayEndTs(today)];
  const inflows = await ctx.q.query(
    `SELECT i.id, to_char(COALESCE(i.due_date, i.date + INTERVAL '30 days')::date, 'YYYY-MM-DD') AS due,
            (${invoiceOutstandingAsOfSql("i")} * COALESCE(NULLIF(i.exchange_rate, 0), 1))::text AS open_aed
       FROM invoices i
      WHERE i.company_id = $1 AND i.invoice_type <> 'credit_note' AND i.status <> 'draft' AND i.date <= $3::timestamp AND ${standingSql("i")}`,
    params
  );
  const outflows = await ctx.q.query(
    `SELECT b.id, to_char(${billDueDateSql("b")}, 'YYYY-MM-DD') AS due,
            (${billOutstandingAsOfSql("b")} * COALESCE(NULLIF(b.exchange_rate, 0), 1))::text AS open_aed
       FROM vendor_bills b WHERE b.company_id = $1 AND ${postedBillSql("b")} AND b.bill_date <= $3::timestamp`,
    params
  );
  const weeks = Math.ceil((daysBetween(start, end) + 1) / 7);
  const buckets = Array.from({ length: weeks }, (_, i) => ({ from: addDays(start, i * 7), to: addDays(start, i * 7 + 6) > end ? end : addDays(start, i * 7 + 6), in: 0, out: 0 }));
  const place = (due: string, amount: number, kind: "in" | "out") => {
    if (amount <= 0 || due > end) return;
    const idx = due <= start ? 0 : Math.min(weeks - 1, Math.floor(daysBetween(start, due) / 7));
    buckets[idx][kind] = round2(buckets[idx][kind] + amount);
  };
  for (const r of inflows.rows) place(String(r.due), money(r.open_aed), "in");
  for (const r of outflows.rows) place(String(r.due), money(r.open_aed), "out");
  let balance = await cashBalance(ctx.q, ctx.companyId, today);
  const opening = balance;
  const rows = buckets.map((w, i) => {
    balance = round2(balance + w.in - w.out);
    return detail(`week:${i}`, { period: `${w.from} → ${w.to}`, inflow: w.in, outflow: w.out, net: round2(w.in - w.out), balance });
  });
  return {
    rows: [subtotal("opening", { period: pick(ctx, "Cash today", "النقد اليوم"), balance: opening }), ...rows],
    totals: { inflow: sumMoney(rows.map((r) => r.cells.inflow as number)), outflow: sumMoney(rows.map((r) => r.cells.outflow as number)), net: sumMoney(rows.map((r) => r.cells.net as number)) },
    warnings,
  };
}

registerReport({
  id: "cash-flow-forecast",
  columns: [
    col("period", "Week", "الأسبوع"),
    moneyCol("inflow", "Expected receipts", "المقبوضات المتوقعة", { sum: true }),
    moneyCol("outflow", "Expected payments", "المدفوعات المتوقعة", { sum: true }),
    moneyCol("net", "Net", "الصافي", { sum: true }),
    moneyCol("balance", "Projected cash", "النقد المتوقع"),
  ],
  run: cashFlowForecast,
});

// ---------------------------------------------------------------------------------------------------------------
// Month-End Close Status (range): every month in the range with its close record
// ---------------------------------------------------------------------------------------------------------------

async function monthEndStatus(ctx: ReportContext): Promise<ReportOutput> {
  const { from, to } = ctx.window as { from: string; to: string };
  const months = monthsIn(from, to);
  const { rows } = await ctx.q.query(
    `SELECT to_char(period_start, 'YYYY-MM') AS ym, status, ${ymdSql("closed_at")} AS closed_on, notes
       FROM month_end_close WHERE company_id = $1 AND period_start >= $2::timestamp AND period_start <= $3::timestamp`,
    [ctx.companyId, `${startOfMonth(from)}T00:00:00`, dayEndTs(to)]
  );
  const byMonth = new Map(rows.map((r) => [String(r.ym), r]));
  return {
    rows: months.map((m) => {
      const ym = `${m.year}-${String(m.month).padStart(2, "0")}`;
      const rec = byMonth.get(ym);
      return detail(`month:${ym}`, { period: ym, status: rec?.status ?? pick(ctx, "open", "مفتوح"), closedOn: rec?.closed_on ?? "", notes: rec?.notes ?? "" });
    }),
  };
}

registerReport({
  id: "month-end-close-status",
  columns: [col("period", "Month", "الشهر"), C.status, col("closedOn", "Closed on", "أُقفل في", "date"), col("notes", "Notes", "ملاحظات")],
  run: monthEndStatus,
});

// ---------------------------------------------------------------------------------------------------------------
// Audit Trail (range): activity_logs of the company, newest first, sensitive roles only
// ---------------------------------------------------------------------------------------------------------------

const short = (v: unknown): string => {
  if (v === null || v === undefined) return "-";
  const t = typeof v === "object" ? JSON.stringify(v) : String(v);
  return t.length > 120 ? `${t.slice(0, 117)}...` : t;
};

/**
 * What an audit_logs row says happened, for a human: for a change, only the fields that moved
 * ("billDate: 2026-09-10 -> 2026-09-25"); for a creation or a deletion, the record's figures.
 * The full before and after stay in audit_logs.details (a regenerated VAT draft keeps every box).
 */
export function describeAudit(details: string): string {
  let d: any;
  try {
    d = JSON.parse(details);
  } catch {
    return "";
  }
  const before = d?.before && typeof d.before === "object" ? d.before : null;
  const after = d?.after && typeof d.after === "object" ? d.after : null;
  if (before && after) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
    const moved = keys.filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
    if (moved.length === 0) return "no field changed";
    return moved.map((k) => `${k}: ${short(before[k])} -> ${short(after[k])}`).join("; ").slice(0, 900);
  }
  if (before) return `was ${short(before)}`.slice(0, 600);
  if (after) return Object.entries(after).map(([k, v]) => `${k}: ${short(v)}`).join("; ").slice(0, 600);
  return "";
}

async function auditTrail(ctx: ReportContext): Promise<ReportOutput> {
  const { from, to } = ctx.window as { from: string; to: string };
  const { start, end } = dayBounds(from, to);
  const f = ctx.params.filters;
  const b = new SqlParams();
  const cid = b.p(ctx.companyId);
  const s = b.p(start);
  const e = b.p(end);
  const outer: string[] = [];
  if (f.userId) outer.push(`x.user_id = ${b.p(f.userId)}::uuid`);
  if (f.entityType) outer.push(`x.entity_type = ${b.p(f.entityType)}`);
  if (f.action) outer.push(`x.action = ${b.p(f.action)}`);
  // Two sources, one shape: activity_logs (what people did on documents and settings) and audit_logs (financial activity:
  // journals, bills, payments, VAT and corporate-tax filings, written by recordAudit and carrying company_id since 0117).
  const { rows } = await ctx.q.query(
    `SELECT x.src, x.id, to_char(x.created_at + INTERVAL '4 hours', 'YYYY-MM-DD HH24:MI') AS at, COALESCE(u.name, u.email, '') AS who, x.action,
            x.entity_type, x.entity_id, x.description, x.ip
       FROM (
         SELECT 'log' AS src, al.id::text AS id, al.created_at, al.user_id, al.action, COALESCE(al.entity_type, '') AS entity_type, COALESCE(al.entity_id, '') AS entity_id,
                COALESCE(al.description, '') AS description, COALESCE(al.ip_address, '') AS ip
           FROM activity_logs al WHERE al.company_id = ${cid} AND al.created_at >= ${s}::timestamp AND al.created_at <= ${e}::timestamp
         UNION ALL
         SELECT 'audit', au.id::text, au.created_at, au.user_id, au.action, COALESCE(au.resource_type, ''), COALESCE(au.resource_id, ''),
                CASE WHEN au.details LIKE '{%' THEN au.details ELSE '' END, COALESCE(au.ip_address, '')
           FROM audit_logs au WHERE au.company_id = ${cid} AND au.created_at >= ${s}::timestamp AND au.created_at <= ${e}::timestamp
         UNION ALL
         -- Security events belong to a person, not a company (sign-ins, 2FA, sessions, password changes): they show in the
         -- trail of every company the person is a member of, labelled "security".
         SELECT 'security', au.id::text, au.created_at, au.user_id, au.action, COALESCE(au.resource_type, ''), COALESCE(au.resource_id, ''), '', COALESCE(au.ip_address, '')
           FROM audit_logs au
          WHERE au.company_id IS NULL AND au.created_at >= ${s}::timestamp AND au.created_at <= ${e}::timestamp
            AND (au.action IN ('login', 'logout') OR au.action LIKE '2fa.%' OR au.action LIKE 'session.%' OR au.action LIKE 'password.%' OR au.action LIKE 'auth.%')
            AND au.user_id IN (SELECT cu.user_id FROM company_users cu WHERE cu.company_id = ${cid})
       ) x LEFT JOIN users u ON u.id = x.user_id
      ${outer.length ? "WHERE " + outer.join(" AND ") : ""}
      ORDER BY x.created_at DESC, x.id LIMIT ${ctx.maxRows + 1}`,
    b.values
  );
  return {
    rows: rows.map((r) =>
      detail(
        `${r.src}:${r.id}`,
        { at: r.at, user: r.who, action: r.action, entityType: r.entity_type, entityId: r.entity_id, description: r.src === "audit" ? describeAudit(r.description) : r.description, ip: r.ip },
        r.entity_type && r.entity_id ? { target: "activity", id: `${r.entity_type}:${r.entity_id}` } : undefined
      )
    ),
  };
}

registerReport({
  id: "audit-trail",
  sensitive: true,
  filters: ["userId", "entityType", "action"],
  columns: [
    col("at", "When (Dubai)", "الوقت (دبي)"),
    col("user", "User", "المستخدم"),
    col("action", "Action", "الإجراء"),
    col("entityType", "Entity", "الكيان"),
    col("entityId", "Entity id", "معرّف الكيان"),
    C.description,
    col("ip", "IP address", "عنوان IP"),
  ],
  run: auditTrail,
});

// ---------------------------------------------------------------------------------------------------------------
// Management Roll-up / consolidated statements (range, as-of): P&L or balance sheet across companies, with eliminations
// ---------------------------------------------------------------------------------------------------------------

async function consolidated(ctx: ReportContext): Promise<ReportOutput> {
  const { from, to, asOf } = ctx.window as { from: string; to: string; asOf: string };
  const statement = (ctx.params.filters.statement ?? "pl") as "pl" | "bs";
  const requested = ctx.params.filters.companyIds ? ctx.params.filters.companyIds.split(",").map((s) => s.trim()).filter(Boolean) : [ctx.companyId];
  const ids = [...new Set(requested)];
  for (const id of ids) {
    if (!(await ctx.canAccessCompany(id))) {
      throw new AppError({ message: "You do not have access to one of the companies.", statusCode: 403, code: "COMPANY_ACCESS_DENIED" });
    }
  }
  const { rows: companyRows } = await ctx.q.query(`SELECT id, name, base_currency FROM companies WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL`, [ids]);
  if (companyRows.length !== ids.length) {
    throw new AppError({ message: "One of the companies was not found.", statusCode: 404, code: "COMPANY_NOT_FOUND" });
  }
  const currencies = new Set(companyRows.map((c) => String(c.base_currency ?? "AED")));
  if (currencies.size > 1) {
    throw new AppError({
      message: "The companies have different base currencies. Consolidation does not translate currencies.",
      statusCode: 422,
      code: "MIXED_BASE_CURRENCY",
    });
  }
  const order = new Map(ids.map((id, i) => [id, i]));
  const entities: ConsolidationEntity[] = [];
  for (const c of [...companyRows].sort((x, y) => order.get(String(x.id))! - order.get(String(y.id))!)) {
    const accounts = await accountBalances(
      ctx.q,
      String(c.id),
      statement === "pl" ? { from, to, excludeSources: PL_EXCLUDED_SOURCES } : { to: asOf }
    );
    entities.push({ id: String(c.id), name: String(c.name), accounts });
  }
  const result = consolidate(entities, statement, { strict: ctx.params.filters.strict === "1" });
  const columns: DefColumn[] = [
    C.code,
    col("name", "Account", "الحساب"),
    ...entities.map((e, i) => moneyCol(`entity_${i}`, e.name, e.name)),
    moneyCol("elimination", "Eliminations", "الاستبعادات"),
    moneyCol("consolidated", "Consolidated", "الموحّد"),
  ];
  const cells = (amounts: number[], elimination: number, consolidatedValue: number) => {
    const out: Record<string, number> = { elimination, consolidated: consolidatedValue };
    amounts.forEach((v, i) => (out[`entity_${i}`] = v));
    return out;
  };
  const sectionRows = (types: string[], key: string, en: string, ar: string) => {
    const list = result.rows.filter((r) => types.includes(r.type));
    const totals = entities.map((_, i) => sumMoney(list.map((r) => r.amounts[i])));
    const elim = sumMoney(list.map((r) => r.elimination));
    const cons = sumMoney(list.map((r) => r.consolidated));
    return {
      totals,
      elim,
      cons,
      rows: [
        section(`section:${key}`, { name: pick(ctx, en, ar) }),
        ...list.map((r) => detail(`acct:${r.code}`, { code: r.code, name: ctx.params.lang === "ar" && r.nameAr ? r.nameAr : r.name, ...cells(r.amounts, r.elimination, r.consolidated) }, { target: "account", id: r.code }, 1)),
        subtotal(`subtotal:${key}`, { name: pick(ctx, `Total ${en.toLowerCase()}`, `إجمالي ${ar}`), ...cells(totals, elim, cons) }),
      ],
    };
  };
  const rows: ReportOutput["rows"] = [];
  let net: ReturnType<typeof sectionRows>;
  if (statement === "pl") {
    const rev = sectionRows(["income"], "revenue", "Revenue", "الإيرادات");
    const exp = sectionRows(["expense"], "expenses", "Expenses", "المصروفات");
    rows.push(...rev.rows, ...exp.rows);
    const profit = entities.map((_, i) => round2(rev.totals[i] - exp.totals[i]));
    net = { totals: profit, elim: round2(rev.elim - exp.elim), cons: round2(rev.cons - exp.cons), rows: [] };
    rows.push(subtotal("subtotal:net", { name: pick(ctx, "Net profit", "صافي الربح"), ...cells(net.totals, net.elim, net.cons) }));
  } else {
    const assets = sectionRows(["asset"], "asset", "Assets", "الأصول");
    const liabilities = sectionRows(["liability"], "liability", "Liabilities", "الالتزامات");
    const equity = sectionRows(["equity"], "equity", "Equity", "حقوق الملكية");
    rows.push(...assets.rows, ...liabilities.rows, ...equity.rows);
    const earn = result.earnings!;
    rows.push(detail("earnings", { code: "", name: pick(ctx, "Current-year earnings", "أرباح السنة الحالية"), ...cells(earn.amounts, 0, earn.consolidated) }, undefined, 1));
    const eq = entities.map((_, i) => round2(equity.totals[i] + earn.amounts[i]));
    rows.push(subtotal("subtotal:le", { name: pick(ctx, "Total liabilities and equity", "إجمالي الالتزامات وحقوق الملكية"), ...cells(entities.map((_, i) => round2(liabilities.totals[i] + eq[i])), round2(liabilities.elim + equity.elim), round2(liabilities.cons + equity.cons + earn.consolidated)) }));
    net = assets;
  }
  // Pairs whose two sides disagree are not eliminated: say so, with the amount, instead of refusing the whole statement.
  const warnings: string[] = [];
  if (result.unmatched.length > 0) {
    const difference = sumMoney(result.unmatched.map((u) => u.difference));
    rows.push(subtotal("unmatched:intercompany", { name: pick(ctx, "Unmatched intercompany (not eliminated)", "أرصدة بين الشركات غير متطابقة (لم تُستبعد)"), consolidated: difference }));
    warnings.push(
      pick(
        ctx,
        `Intercompany balances do not match: the companies' books differ by ${difference.toFixed(2)}. Those balances were not eliminated; correct them, or pass strict=1 to refuse the statement.`,
        `أرصدة الشركات المرتبطة غير متطابقة: الفرق ${difference.toFixed(2)}. لم تُستبعد هذه الأرصدة؛ صحّحها أو مرّر strict=1 لرفض القائمة.`
      )
    );
  }
  return { columns, rows, totals: { consolidated: net.cons }, ...(warnings.length ? { warnings } : {}) };
}

registerReport({
  id: "consolidated-statements",
  filters: ["companyIds", "statement"],
  columns: [C.code, col("name", "Account", "الحساب"), moneyCol("consolidated", "Consolidated", "الموحّد")],
  run: consolidated,
});
