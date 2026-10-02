// Wave 2 reports (Phase 8 D4): the reports that read tables owned by D1-D3: customer advances, sales orders, projects and
// time, approvals, leave, employee loans, end-of-service provision, the bank reconciliation statement and bank feed
// status. Each one reuses the owning domain's own calculation (one definition), then lays it out in the shared shape.

import { AppError } from "../../errors";
import { computeBankReconciliationStatement } from "../../services/bank-reconciliation.service";
import { calculateGratuityForEmployee, isUaeOrGccNational } from "../../services/gratuity";
import { getLeaveBalances } from "../../services/leave.service";
import { projectProfitability, unbilledSummary } from "../../services/project.service";
import { round2 } from "../../services/financial-statements";
import { dayBounds, dayEndTs, ymdSql } from "../dates";
import { SqlParams, accountBalances, money } from "../ledger";
import { registerReport, type ReportContext, type ReportOutput } from "../registry";
import { C, col, detail, moneyCol, pick, section, subtotal, sumMoney } from "./helpers";

const RATE = (a: string) => `COALESCE(NULLIF(${a}.exchange_rate, 0), 1)`;
const asOfOf = (ctx: ReportContext) => ctx.window.asOf as string;
const glBalance = async (ctx: ReportContext, code: string, to: string): Promise<{ debit: number; credit: number }> => {
  const a = (await accountBalances(ctx.q, ctx.companyId, { to })).find((x) => x.code === code);
  return { debit: a?.debit ?? 0, credit: a?.credit ?? 0 };
};

// ---------------------------------------------------------------------------------------------------------------
// Bank Reconciliation Statement (as of): computeBankReconciliationStatement, one calculation, laid out per account
// ---------------------------------------------------------------------------------------------------------------

async function bankReconciliationStatement(ctx: ReportContext): Promise<ReportOutput> {
  const asOf = asOfOf(ctx);
  const wanted = ctx.params.filters.bankAccountId;
  const { rows: accounts } = wanted
    ? await ctx.q.query(`SELECT id, name_en FROM bank_accounts WHERE id = $1 AND company_id = $2`, [wanted, ctx.companyId])
    : await ctx.q.query(`SELECT id, name_en FROM bank_accounts WHERE company_id = $1 AND COALESCE(is_active, true) ORDER BY name_en LIMIT 25`, [ctx.companyId]);
  if (wanted && accounts.length === 0) throw new AppError({ message: "Bank account not found", statusCode: 404, code: "BANK_ACCOUNT_NOT_FOUND" });
  const rows: ReportOutput["rows"] = [];
  const warnings: string[] = [];
  let differences = 0;
  for (const acct of accounts) {
    let st;
    try {
      st = await computeBankReconciliationStatement(ctx.companyId, String(acct.id), asOf);
    } catch (err: any) {
      if (wanted) throw err;
      warnings.push(`${acct.name_en}: ${err?.message ?? "not available"}`);
      continue;
    }
    const k = String(acct.id);
    rows.push(section(`bank:${k}`, { description: `${acct.name_en} (${st.currency})` }, 0, { target: "bank_account", id: k }));
    const line = (key: string, description: string, amount: number | null, extra: Record<string, string> = {}, drill?: { target: "bank_txn" | "journal_entry"; id: string }) =>
      detail(`${k}:${key}`, { description, ...extra, amount }, drill, 1);
    rows.push(line("stmt", pick(ctx, "Statement balance", "رصيد الكشف"), st.statementBalance));
    for (const i of st.items.depositsInTransit)
      rows.push(line(`dit:${i.entryId}`, `${pick(ctx, "Deposit in transit", "إيداع في الطريق")}: ${i.memo ?? i.entryNumber}`, Math.abs(i.amount), { date: i.date }, { target: "journal_entry", id: i.entryId }));
    for (const i of st.items.outstandingPayments)
      rows.push(line(`op:${i.entryId}`, `${pick(ctx, "Outstanding payment", "دفعة معلقة")}: ${i.memo ?? i.entryNumber}`, -Math.abs(i.amount), { date: i.date }, { target: "journal_entry", id: i.entryId }));
    rows.push(subtotal(`${k}:adj-stmt`, { description: pick(ctx, "Adjusted statement balance", "رصيد الكشف المعدّل"), amount: st.adjustedStatementBalance }));
    rows.push(line("ledger", pick(ctx, "Ledger balance", "رصيد الدفاتر"), st.ledgerBalance));
    for (const i of st.items.unreconciledCredits)
      rows.push(line(`uc:${i.transactionId}`, `${pick(ctx, "Unreconciled credit", "دائن غير مطابق")}: ${i.description}`, Math.abs(i.amount), { date: i.date, reference: i.reference ?? "" }, { target: "bank_txn", id: i.transactionId }));
    for (const i of st.items.unreconciledDebits)
      rows.push(line(`ud:${i.transactionId}`, `${pick(ctx, "Unreconciled debit", "مدين غير مطابق")}: ${i.description}`, -Math.abs(i.amount), { date: i.date, reference: i.reference ?? "" }, { target: "bank_txn", id: i.transactionId }));
    rows.push(subtotal(`${k}:adj-ledger`, { description: pick(ctx, "Adjusted ledger balance", "رصيد الدفاتر المعدّل"), amount: st.adjustedLedgerBalance }));
    rows.push(subtotal(`${k}:diff`, { description: pick(ctx, "Difference", "الفرق"), amount: st.difference }));
    differences = round2(differences + (st.difference ?? 0));
    if (st.statementBalance === null) warnings.push(`${acct.name_en}: ${pick(ctx, "no statement balance is known; import a statement or reconcile it first.", "لا يوجد رصيد كشف معروف؛ استورد كشفًا أو طابقه أولًا.")}`);
  }
  return { rows, totals: { amount: differences }, warnings: warnings.length ? warnings : undefined };
}

registerReport({
  id: "bank-reconciliation-statement",
  noFutureAsOf: true,
  filters: ["bankAccountId"],
  columns: [C.description, col("date", "Date", "التاريخ", "date"), C.reference, moneyCol("amount", "Amount", "المبلغ")],
  run: bankReconciliationStatement,
});

// ---------------------------------------------------------------------------------------------------------------
// Bank Feed Sync Status: connections, last sync, failures (no tokens ever leave the database)
// ---------------------------------------------------------------------------------------------------------------

async function bankFeedStatus(ctx: ReportContext): Promise<ReportOutput> {
  const { rows } = await ctx.q.query(
    `SELECT bc.id, COALESCE(NULLIF(bc.account_name, ''), bc.bank_name, bc.provider) AS name, bc.provider, bc.environment, bc.status, bc.auto_sync,
            to_char(bc.last_synced_at + INTERVAL '4 hours', 'YYYY-MM-DD HH24:MI') AS synced, COALESCE(bc.consecutive_failures, 0) AS failures, bc.last_error,
            (SELECT COUNT(*) FROM bank_transactions t WHERE t.bank_connection_id = bc.id AND t.company_id = bc.company_id AND COALESCE(t.is_reconciled, false) = false)::int AS unreconciled
       FROM bank_connections bc WHERE bc.company_id = $1 ORDER BY bc.created_at LIMIT 200`,
    [ctx.companyId]
  );
  return {
    rows: rows.map((r) =>
      detail(
        `conn:${r.id}`,
        {
          name: r.name ?? "",
          provider: r.provider ?? "",
          environment: r.environment ?? "",
          status: r.status ?? "",
          autoSync: r.auto_sync ? pick(ctx, "On", "مفعّل") : pick(ctx, "Off", "متوقف"),
          lastSynced: r.synced ?? pick(ctx, "Never", "أبدًا"),
          failures: Number(r.failures),
          lastError: r.last_error ?? "",
          unreconciled: Number(r.unreconciled),
        },
        { target: "report", id: "unreconciled-bank-items" }
      )
    ),
    warnings: rows.length === 0 ? [pick(ctx, "No bank feed is connected. Statements are imported manually.", "لا توجد تغذية بنكية متصلة. تُستورد الكشوف يدويًا.")] : undefined,
  };
}

registerReport({
  id: "bank-feed-status",
  columns: [
    col("name", "Connection", "الاتصال"),
    col("provider", "Provider", "المزوّد"),
    col("environment", "Environment", "البيئة"),
    C.status,
    col("autoSync", "Auto sync", "المزامنة التلقائية"),
    col("lastSynced", "Last synced (Dubai)", "آخر مزامنة (دبي)"),
    col("failures", "Consecutive failures", "إخفاقات متتالية", "number"),
    col("lastError", "Last error", "آخر خطأ"),
    col("unreconciled", "Unreconciled lines", "بنود غير مطابقة", "number", { sum: true }),
  ],
  run: bankFeedStatus,
});

// ---------------------------------------------------------------------------------------------------------------
// Sales Orders Status (range)
// ---------------------------------------------------------------------------------------------------------------

async function salesOrdersStatus(ctx: ReportContext): Promise<ReportOutput> {
  const { from, to } = ctx.window as { from: string; to: string };
  const { start, end } = dayBounds(from, to);
  const b = new SqlParams();
  const { rows } = await ctx.q.query(
    `SELECT so.id, so.number, COALESCE(NULLIF(TRIM(so.customer_name), ''), 'Unknown Customer') AS customer, ${ymdSql("so.date")} AS d,
            ${ymdSql("so.expected_date")} AS expected, so.status, so.currency, (so.total * ${RATE("so")})::text AS total_aed,
            COALESCE((SELECT SUM(i.total * ${RATE("i")}) FROM invoices i
                       WHERE i.sales_order_id = so.id AND i.company_id = so.company_id AND i.invoice_type NOT IN ('credit_note', 'advance')
                         AND i.status NOT IN ('draft', 'void', 'cancelled')), 0)::text AS invoiced_aed
       FROM sales_orders so
      WHERE so.company_id = ${b.p(ctx.companyId)} AND so.date >= ${b.p(start)}::timestamp AND so.date <= ${b.p(end)}::timestamp
      ORDER BY so.date, so.number LIMIT ${ctx.maxRows + 1}`,
    b.values
  );
  return {
    rows: rows.map((r) => {
      const total = money(r.total_aed);
      const invoiced = money(r.invoiced_aed);
      return detail(
        `so:${r.id}`,
        { date: r.d, number: r.number, customer: r.customer, expected: r.expected ?? "", status: r.status, currency: r.currency, total, invoiced, remaining: Math.max(0, round2(total - invoiced)) },
        { target: "sales_order", id: String(r.id) }
      );
    }),
  };
}

registerReport({
  id: "sales-orders-status",
  columns: [
    C.date,
    C.number,
    C.customer,
    col("expected", "Expected", "المتوقع", "date"),
    C.status,
    C.currency,
    moneyCol("total", "Total (AED)", "الإجمالي (درهم)", { sum: true }),
    moneyCol("invoiced", "Invoiced (AED)", "المفوتر (درهم)", { sum: true }),
    moneyCol("remaining", "Still to invoice (AED)", "المتبقي للفوترة (درهم)", { sum: true }),
  ],
  run: salesOrdersStatus,
});

// ---------------------------------------------------------------------------------------------------------------
// Customer Advances and Deposits (as of): unapplied balance per advance, tied to account 2055
// ---------------------------------------------------------------------------------------------------------------

async function customerAdvances(ctx: ReportContext): Promise<ReportOutput> {
  const asOf = asOfOf(ctx);
  const end = dayEndTs(asOf);
  const { rows } = await ctx.q.query(
    `SELECT a.id, a.number, a.kind, COALESCE(c.name, 'Unknown Customer') AS customer, ${ymdSql("i.date")} AS d, a.net_amount::text AS net, a.vat_amount::text AS vat,
            -- Dated by the DOCUMENT that moved the money, as the ledger dates it: an application by its invoice's date (a draft invoice
            -- has not moved 2055 yet), a refund by its credit note's date. When the row was written is irrelevant.
            COALESCE((SELECT SUM(x.net_amount) FROM customer_advance_applications x JOIN invoices ai ON ai.id = x.invoice_id AND ai.company_id = x.company_id
                       WHERE x.advance_id = a.id AND x.kind = 'application' AND x.status = 'active' AND ai.status <> 'draft' AND ai.date <= $3::timestamp), 0)::text AS applied,
            COALESCE((SELECT SUM(x.net_amount) FROM customer_advance_applications x LEFT JOIN invoices cn ON cn.id = x.invoice_id AND cn.company_id = x.company_id
                       WHERE x.advance_id = a.id AND x.kind = 'refund' AND x.status IN ('active', 'pending') AND COALESCE(cn.date, x.created_at) <= $3::timestamp), 0)::text AS refunded
       FROM customer_advances a
       JOIN invoices i ON i.id = a.invoice_id AND i.company_id = a.company_id
       LEFT JOIN customer_contacts c ON c.id = a.contact_id AND c.company_id = a.company_id
      WHERE a.company_id = $1 AND a.status <> 'void' AND i.status NOT IN ('draft', 'void', 'cancelled') AND i.date <= $3::timestamp AND $2::date IS NOT NULL
      ORDER BY i.date, a.number LIMIT ${ctx.maxRows + 1}`,
    [ctx.companyId, asOf, end]
  );
  const list = rows.map((r) => {
    const net = money(r.net);
    const applied = money(r.applied);
    const refunded = money(r.refunded);
    return detail(
      `adv:${r.id}`,
      { date: r.d, number: r.number, customer: r.customer, kind: r.kind === "deposit" ? pick(ctx, "Deposit", "تأمين") : pick(ctx, "Advance", "دفعة مقدمة"), net, applied, refunded, unapplied: round2(net - applied - refunded) },
      { target: "advance", id: String(r.id) }
    );
  });
  const unapplied = sumMoney(list.map((r) => r.cells.unapplied as number));
  const gl = await glBalance(ctx, "2055", asOf);
  const glBal = round2(gl.credit - gl.debit);
  const out: ReportOutput = { rows: [...list, subtotal("tie:2055", { customer: pick(ctx, "Ledger balance of account 2055", "رصيد الحساب 2055 في الدفاتر"), unapplied: glBal })], totals: { net: sumMoney(list.map((r) => r.cells.net as number)), applied: sumMoney(list.map((r) => r.cells.applied as number)), refunded: sumMoney(list.map((r) => r.cells.refunded as number)), unapplied } };
  if (Math.abs(glBal - unapplied) >= 0.005) {
    out.warnings = [pick(ctx, `Unapplied advances (${unapplied.toFixed(2)}) differ from account 2055 (${glBal.toFixed(2)}): overpayments held in the same account, or a manual entry.`, `الدفعات المقدمة غير المطبّقة (${unapplied.toFixed(2)}) تختلف عن الحساب 2055 (${glBal.toFixed(2)}).`)];
  }
  return out;
}

registerReport({
  id: "customer-advances",
  noFutureAsOf: true,
  columns: [
    C.date,
    C.number,
    C.customer,
    col("kind", "Kind", "النوع"),
    moneyCol("net", "Net received (AED)", "الصافي المستلم (درهم)", { sum: true }),
    moneyCol("applied", "Applied", "المطبّق", { sum: true }),
    moneyCol("refunded", "Refunded", "المسترد", { sum: true }),
    moneyCol("unapplied", "Unapplied balance", "الرصيد غير المطبّق", { sum: true }),
  ],
  run: customerAdvances,
});

// ---------------------------------------------------------------------------------------------------------------
// Projects: profitability (range), time summary (range), unbilled time and expenses (as of)
// ---------------------------------------------------------------------------------------------------------------

const PROJECT_SELECT = `SELECT p.id::text AS id, p.code, p.name, c.name AS "contactName", p.status, p.billing_method AS "billingMethod",
        p.hourly_rate::float8 AS "hourlyRate", p.currency, p.budget_amount::float8 AS "budgetAmount", p.budget_hours::float8 AS "budgetHours"
   FROM projects p LEFT JOIN customer_contacts c ON c.id = p.contact_id AND c.company_id = p.company_id`;

async function loadProjects(ctx: ReportContext): Promise<any[]> {
  const id = ctx.params.filters.projectId;
  const { rows } = await ctx.q.query(
    `${PROJECT_SELECT} WHERE p.company_id = $1 ${id ? "AND p.id = $2::uuid" : ""} ORDER BY p.code NULLS LAST, p.name LIMIT 200`,
    id ? [ctx.companyId, id] : [ctx.companyId]
  );
  return rows;
}

async function projectProfitabilityReport(ctx: ReportContext): Promise<ReportOutput> {
  const { from, to } = ctx.window as { from: string; to: string };
  const out: ReportOutput["rows"] = [];
  for (const p of await loadProjects(ctx)) {
    const x = await projectProfitability(ctx.companyId, p, { from, to });
    if (x.revenue === 0 && x.costs === 0 && x.hours.total === 0) continue;
    out.push(
      detail(
        `project:${p.id}`,
        {
          code: p.code ?? "",
          name: p.name,
          customer: p.contactName ?? "",
          status: p.status,
          revenue: x.revenue,
          costs: x.costs,
          margin: x.margin,
          marginPct: x.marginPct,
          hours: x.hours.total,
          budget: x.budget.amount,
          budgetUsedPct: x.budget.usedPct,
        },
        { target: "project", id: p.id }
      )
    );
  }
  return { rows: out };
}

registerReport({
  id: "project-profitability",
  filters: ["projectId"],
  columns: [
    col("code", "Code", "الرمز"),
    col("name", "Project", "المشروع"),
    C.customer,
    C.status,
    moneyCol("revenue", "Revenue", "الإيرادات", { sum: true }),
    moneyCol("costs", "Costs", "التكاليف", { sum: true }),
    moneyCol("margin", "Margin", "الهامش", { sum: true }),
    col("marginPct", "Margin %", "الهامش %", "percent"),
    col("hours", "Hours", "الساعات", "number", { sum: true }),
    moneyCol("budget", "Budget", "الموازنة"),
    col("budgetUsedPct", "Budget used %", "المستهلك من الموازنة %", "percent"),
  ],
  run: projectProfitabilityReport,
});

async function timeSummary(ctx: ReportContext): Promise<ReportOutput> {
  const { from, to } = ctx.window as { from: string; to: string };
  const f = ctx.params.filters;
  const b = new SqlParams();
  const conds = [`te.company_id = ${b.p(ctx.companyId)}`, `te.entry_date >= ${b.p(from)}::date`, `te.entry_date <= ${b.p(to)}::date`, `NOT (te.started_at IS NOT NULL AND te.ended_at IS NULL)`];
  if (f.projectId) conds.push(`te.project_id = ${b.p(f.projectId)}::uuid`);
  if (f.userId) conds.push(`te.user_id = ${b.p(f.userId)}::uuid`);
  // Billable and unbilled follow project-billing.ts: hourly project, billable entry and task; billed means an invoice that still stands.
  const { rows } = await ctx.q.query(
    `WITH e AS (
       SELECT te.project_id, te.user_id, te.minutes,
              (p.billing_method = 'hourly' AND te.is_billable AND COALESCE(t.is_billable, true)) AS billable,
              (te.billed_invoice_id IS NOT NULL AND COALESCE(bi.status, '') NOT IN ('void', 'cancelled')) AS billed,
              ROUND(te.minutes / 60.0, 4) AS hours, COALESCE(te.rate, t.hourly_rate, p.hourly_rate, 0) AS rate
         FROM time_entries te
         JOIN projects p ON p.id = te.project_id AND p.company_id = te.company_id
         LEFT JOIN project_tasks t ON t.id = te.task_id
         LEFT JOIN invoices bi ON bi.id = te.billed_invoice_id
        WHERE ${conds.join(" AND ")}
     )
     SELECT p.id::text AS project_id, p.code, p.name, COALESCE(u.name, u.email, '') AS who, e.user_id,
            COALESCE(SUM(e.hours), 0)::text AS hours,
            COALESCE(SUM(e.hours) FILTER (WHERE e.billable), 0)::text AS billable_hours,
            COALESCE(SUM(e.hours) FILTER (WHERE e.billable AND e.billed), 0)::text AS billed_hours,
            COALESCE(SUM(ROUND(e.hours * e.rate, 2)) FILTER (WHERE e.billable), 0)::text AS billable_amount
       FROM e JOIN projects p ON p.id = e.project_id LEFT JOIN users u ON u.id = e.user_id
      GROUP BY p.id, p.code, p.name, u.name, u.email, e.user_id ORDER BY p.code NULLS LAST, p.name, who`,
    b.values
  );
  return {
    rows: rows.map((r) =>
      detail(
        `ts:${r.project_id}:${r.user_id ?? "none"}`,
        { code: r.code ?? "", name: r.name, user: r.who, hours: money(r.hours), billableHours: money(r.billable_hours), billedHours: money(r.billed_hours), billableAmount: money(r.billable_amount) },
        { target: "project", id: String(r.project_id) }
      )
    ),
  };
}

registerReport({
  id: "time-summary",
  filters: ["projectId", "userId"],
  columns: [
    col("code", "Code", "الرمز"),
    col("name", "Project", "المشروع"),
    col("user", "User", "المستخدم"),
    col("hours", "Hours", "الساعات", "number", { sum: true }),
    col("billableHours", "Billable hours", "الساعات القابلة للفوترة", "number", { sum: true }),
    col("billedHours", "Billed hours", "الساعات المفوترة", "number", { sum: true }),
    moneyCol("billableAmount", "Billable amount", "المبلغ القابل للفوترة", { sum: true }),
  ],
  run: timeSummary,
});

async function unbilledTimeExpenses(ctx: ReportContext): Promise<ReportOutput> {
  const asOf = asOfOf(ctx);
  const out: ReportOutput["rows"] = [];
  for (const p of await loadProjects(ctx)) {
    const u = await unbilledSummary(ctx.companyId, p);
    const time = (u.timeEntries as any[]).filter((e) => String(e.entryDate) <= asOf);
    const expenses = (u.expenses as any[]).filter((e) => String(e.expenseDate) <= asOf);
    const target = { target: "project" as const, id: p.id };
    for (const e of time) {
      out.push(detail(`time:${e.id}`, { project: `${p.code ? p.code + " " : ""}${p.name}`, type: pick(ctx, "Time", "وقت"), date: e.entryDate, description: e.notes ?? "", hours: round2(Number(e.minutes) / 60), amount: Number(e.amount) }, target));
    }
    for (const e of expenses) {
      out.push(detail(`exp:${e.id}`, { project: `${p.code ? p.code + " " : ""}${p.name}`, type: pick(ctx, "Expense", "مصروف"), date: e.expenseDate, description: e.description ?? "", hours: null, amount: Number(e.amountAed) }, target));
    }
  }
  return { rows: out };
}

registerReport({
  id: "unbilled-time-expenses",
  noFutureAsOf: true,
  filters: ["projectId"],
  columns: [
    col("project", "Project", "المشروع"),
    col("type", "Type", "النوع"),
    C.date,
    C.description,
    col("hours", "Hours", "الساعات", "number", { sum: true }),
    moneyCol("amount", "Amount (AED)", "المبلغ (درهم)", { sum: true }),
  ],
  run: unbilledTimeExpenses,
});

// ---------------------------------------------------------------------------------------------------------------
// Approval History (range): every request with its steps
// ---------------------------------------------------------------------------------------------------------------

const APPROVAL_DRILL: Record<string, "bill" | "expense_claim" | "purchase_order" | "journal_entry" | "payslip"> = {
  bill: "bill",
  expense_claim: "expense_claim",
  purchase_order: "purchase_order",
  manual_journal: "journal_entry",
  payroll_run: "payslip",
};

async function approvalHistory(ctx: ReportContext): Promise<ReportOutput> {
  const { from, to } = ctx.window as { from: string; to: string };
  const { start, end } = dayBounds(from, to);
  const f = ctx.params.filters;
  const b = new SqlParams();
  const conds = [`r.company_id = ${b.p(ctx.companyId)}`, `r.created_at >= ${b.p(start)}::timestamp`, `r.created_at <= ${b.p(end)}::timestamp`];
  if (f.entityType) conds.push(`r.document_type = ${b.p(f.entityType)}`);
  if (f.userId) conds.push(`r.requested_by = ${b.p(f.userId)}::uuid`);
  const { rows: requests } = await ctx.q.query(
    `SELECT r.id, r.document_type, r.document_id, r.rule_name, r.amount_aed::text AS amount, r.status, r.completed_steps, r.required_steps,
            ${ymdSql("r.created_at")} AS d, COALESCE(u.name, u.email, '') AS requester
       FROM approval_requests r LEFT JOIN users u ON u.id = r.requested_by
      WHERE ${conds.join(" AND ")} ORDER BY r.created_at DESC, r.id LIMIT 2000`,
    b.values
  );
  const ids = requests.map((r) => String(r.id));
  const { rows: steps } = ids.length
    ? await ctx.q.query(
        `SELECT s.request_id, s.step_number, s.required_role, s.decision, s.comment, ${ymdSql("s.decided_at")} AS d, COALESCE(u.name, u.email, '') AS who
           FROM approval_steps s LEFT JOIN users u ON u.id = s.decided_by
          WHERE s.company_id = $1 AND s.request_id = ANY($2::uuid[]) ORDER BY s.request_id, s.step_number`,
        [ctx.companyId, ids]
      )
    : { rows: [] as any[] };
  const out: ReportOutput["rows"] = [];
  for (const r of requests) {
    const target = APPROVAL_DRILL[String(r.document_type)];
    out.push(
      detail(
        `req:${r.id}`,
        { date: r.d, type: r.document_type, rule: r.rule_name ?? "", requestedBy: r.requester, status: `${r.status} ${r.completed_steps}/${r.required_steps}`, amount: money(r.amount) },
        target ? { target, id: String(r.document_id) } : { target: "approval", id: String(r.id) }
      )
    );
    for (const s of steps.filter((x) => String(x.request_id) === String(r.id))) {
      out.push(
        detail(
          `step:${r.id}:${s.step_number}`,
          { date: s.d ?? "", type: `${pick(ctx, "Step", "الخطوة")} ${s.step_number}`, rule: s.required_role, requestedBy: s.who, status: s.decision ?? pick(ctx, "waiting", "بانتظار"), amount: null, note: s.comment ?? "" },
          undefined,
          1
        )
      );
    }
  }
  return { rows: out };
}

registerReport({
  id: "approval-history",
  filters: ["entityType", "userId"],
  columns: [
    C.date,
    col("type", "Document / step", "المستند / الخطوة"),
    col("rule", "Rule / role", "القاعدة / الدور"),
    col("requestedBy", "By", "بواسطة"),
    C.status,
    moneyCol("amount", "Amount (AED)", "المبلغ (درهم)", { sum: true }),
    col("note", "Comment", "تعليق"),
  ],
  run: approvalHistory,
});

// ---------------------------------------------------------------------------------------------------------------
// Payroll side (sensitive): leave balances, end-of-service provision, employee loans
// ---------------------------------------------------------------------------------------------------------------

async function leaveBalancesReport(ctx: ReportContext): Promise<ReportOutput> {
  const rows = await getLeaveBalances(ctx.companyId, { asOfYmd: asOfOf(ctx), employeeId: ctx.params.filters.employeeId });
  const { rows: types } = await ctx.q.query(`SELECT id, name_en, name_ar FROM leave_types WHERE company_id = $1`, [ctx.companyId]);
  const typeName = new Map(types.map((t: any) => [String(t.id), pick(ctx, t.name_en, t.name_ar ?? t.name_en)]));
  return {
    rows: rows.map((r) =>
      detail(
        `lb:${r.employeeId}:${r.leaveTypeId}`,
        { employee: r.employeeName, type: typeName.get(r.leaveTypeId) ?? r.code, year: r.year, opening: r.opening, accrued: r.accrued, adjustment: r.adjustment, taken: r.taken, pending: r.pending, balance: r.balance, available: r.available },
        { target: "employee", id: r.employeeId }
      )
    ),
  };
}

registerReport({
  id: "leave-balances",
  sensitive: true,
  noFutureAsOf: true,
  filters: ["employeeId"],
  columns: [
    col("employee", "Employee", "الموظف"),
    col("type", "Leave type", "نوع الإجازة"),
    col("year", "Year", "السنة", "number"),
    col("opening", "Opening", "الافتتاحي", "number"),
    col("accrued", "Accrued", "المستحق", "number"),
    col("adjustment", "Adjustment", "التعديل", "number"),
    col("taken", "Taken", "المأخوذ", "number"),
    col("pending", "Pending", "المعلّق", "number"),
    col("balance", "Balance", "الرصيد", "number"),
    col("available", "Available", "المتاح", "number"),
  ],
  run: leaveBalancesReport,
});

async function eosProvision(ctx: ReportContext): Promise<ReportOutput> {
  const asOf = asOfOf(ctx);
  const { rows } = await ctx.q.query(
    `SELECT id, COALESCE(employee_number, '') AS num, full_name, nationality, ${ymdSql("join_date")} AS joined, join_date,
            COALESCE(basic_salary, 0)::float8 AS basic,
            GREATEST(COALESCE(total_salary, 0), COALESCE(basic_salary, 0) + COALESCE(housing_allowance, 0) + COALESCE(transport_allowance, 0) + COALESCE(other_allowance, 0))::float8 AS total_wage
       FROM employees WHERE company_id = $1 AND join_date IS NOT NULL AND join_date <= $3::timestamp AND COALESCE(status, 'active') = 'active' AND $2::date IS NOT NULL
      ORDER BY employee_number NULLS LAST, full_name LIMIT ${ctx.maxRows + 1}`,
    [ctx.companyId, asOf, dayEndTs(asOf)]
  );
  const end = new Date(`${asOf}T00:00:00Z`);
  const list = rows.map((e) => {
    const g = calculateGratuityForEmployee({
      joinDate: new Date(String(e.joined) + "T00:00:00Z"),
      endDate: end,
      basicSalary: Number(e.basic),
      totalWage: Number(e.total_wage),
      isGccNational: isUaeOrGccNational(e.nationality),
    });
    return detail(
      `eos:${e.id}`,
      { number: e.num, employee: e.full_name, joined: e.joined, years: round2(g.yearsOfService), basic: round2(Number(e.basic)), entitlement: round2(g.totalGratuity), note: g.eligible ? "" : g.reason === "gcc_national" ? pick(ctx, "GCC national (pension)", "مواطن خليجي (معاش)") : pick(ctx, "Under one year", "أقل من سنة") },
      { target: "employee", id: String(e.id) }
    );
  });
  const entitlement = sumMoney(list.map((r) => r.cells.entitlement as number));
  const gl = await glBalance(ctx, "2036", asOf);
  const provision = round2(gl.credit - gl.debit);
  const diff = round2(provision - entitlement);
  return {
    rows: [
      ...list,
      subtotal("tie:2036", { employee: pick(ctx, "Provision in the ledger (account 2036)", "المخصص في الدفاتر (الحساب 2036)"), entitlement: provision }),
      subtotal("tie:diff", { employee: pick(ctx, "Provision over / (under) entitlement", "المخصص زائد / (ناقص) عن الاستحقاق"), entitlement: diff }),
    ],
    totals: { entitlement },
    warnings: Math.abs(diff) >= 0.005 ? [pick(ctx, `The provision differs from the entitlement by ${Math.abs(diff).toFixed(2)}.`, `يختلف المخصص عن الاستحقاق بمقدار ${Math.abs(diff).toFixed(2)}.`)] : undefined,
  };
}

registerReport({
  id: "eos-provision",
  sensitive: true,
  noFutureAsOf: true,
  columns: [
    col("number", "Employee no.", "رقم الموظف"),
    col("employee", "Employee", "الموظف"),
    col("joined", "Joined", "تاريخ الالتحاق", "date"),
    col("years", "Years of service", "سنوات الخدمة", "number"),
    moneyCol("basic", "Basic salary", "الراتب الأساسي"),
    moneyCol("entitlement", "Gratuity entitlement", "مستحقات نهاية الخدمة", { sum: true }),
    col("note", "Note", "ملاحظة"),
  ],
  run: eosProvision,
});

async function employeeLoansReport(ctx: ReportContext): Promise<ReportOutput> {
  const asOf = asOfOf(ctx);
  const month = Number(asOf.slice(0, 4)) * 12 + Number(asOf.slice(5, 7));
  const { rows } = await ctx.q.query(
    `SELECT l.id, l.loan_number, l.kind, l.status, e.full_name, l.principal::text AS principal, l.instalment_count, to_char(l.disbursement_date, 'YYYY-MM-DD') AS disbursed,
            COALESCE(SUM(i.amount) FILTER (WHERE i.status = 'deducted' AND (i.period_year * 12 + i.period_month) <= $3), 0)::text AS deducted,
            COALESCE(SUM(i.amount) FILTER (WHERE i.status IN ('scheduled', 'reserved') OR (i.status = 'deducted' AND (i.period_year * 12 + i.period_month) > $3)), 0)::text AS outstanding
       FROM employee_loans l JOIN employees e ON e.id = l.employee_id AND e.company_id = l.company_id
       LEFT JOIN employee_loan_installments i ON i.loan_id = l.id AND i.company_id = l.company_id
      WHERE l.company_id = $1 AND l.status <> 'cancelled' AND l.disbursement_date <= $2::date
      GROUP BY l.id, e.full_name ORDER BY l.disbursement_date, l.loan_number LIMIT ${ctx.maxRows + 1}`,
    [ctx.companyId, asOf, month]
  );
  const list = rows.map((r) =>
    detail(
      `loan:${r.id}`,
      { number: r.loan_number, employee: r.full_name, kind: r.kind, disbursed: r.disbursed, principal: money(r.principal), instalments: Number(r.instalment_count), deducted: money(r.deducted), outstanding: money(r.outstanding), status: r.status },
      { target: "loan", id: String(r.id) }
    )
  );
  const outstanding = sumMoney(list.map((r) => r.cells.outstanding as number));
  const gl = await glBalance(ctx, "1080", asOf);
  const glBal = round2(gl.debit - gl.credit);
  return {
    rows: [...list, subtotal("tie:1080", { employee: pick(ctx, "Ledger balance of account 1080", "رصيد الحساب 1080 في الدفاتر"), outstanding: glBal })],
    totals: { principal: sumMoney(list.map((r) => r.cells.principal as number)), deducted: sumMoney(list.map((r) => r.cells.deducted as number)), outstanding },
    warnings: Math.abs(glBal - outstanding) >= 0.005 ? [pick(ctx, `Outstanding loans (${outstanding.toFixed(2)}) differ from account 1080 (${glBal.toFixed(2)}).`, `القروض المستحقة (${outstanding.toFixed(2)}) تختلف عن الحساب 1080 (${glBal.toFixed(2)}).`)] : undefined,
  };
}

registerReport({
  id: "employee-loans",
  sensitive: true,
  noFutureAsOf: true,
  columns: [
    col("number", "Loan no.", "رقم القرض"),
    col("employee", "Employee", "الموظف"),
    col("kind", "Kind", "النوع"),
    col("disbursed", "Disbursed", "تاريخ الصرف", "date"),
    moneyCol("principal", "Principal", "الأصل", { sum: true }),
    col("instalments", "Instalments", "الأقساط", "number"),
    moneyCol("deducted", "Deducted", "المخصوم", { sum: true }),
    moneyCol("outstanding", "Outstanding", "المتبقي", { sum: true }),
    C.status,
  ],
  run: employeeLoansReport,
});

