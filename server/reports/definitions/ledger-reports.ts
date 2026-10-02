// Ledger-detail reports: General Ledger, Account Transactions, Journal Report and FX Gains and Losses (Phase 8 D4).

import { round2 } from "../../services/financial-statements";
import { ACCOUNT_CODES } from "../../constants";
import { dayBounds, ymdSql } from "../dates";
import {
  SqlParams,
  ledgerCount,
  ledgerCountsByAccount,
  ledgerFirstLinesTotal,
  ledgerLines,
  money,
  naturalBalance,
  openingBalances,
  type LedgerLine,
} from "../ledger";
import { registerReport, type ReportContext, type ReportOutput } from "../registry";
import { C, acctName, col, detail, moneyCol, pick, section, subtotal, sumMoney } from "./helpers";

const lineName = (ctx: ReportContext, l: LedgerLine) => `${l.code} ${acctName(ctx, l)}`;
const lineDescription = (l: LedgerLine) => l.lineDescription || l.memo || "";

// ---------------------------------------------------------------------------------------------------------------
// General Ledger: opening balance, lines with a running balance, closing balance per account
// ---------------------------------------------------------------------------------------------------------------

/**
 * One page of the general ledger, read in SQL. The report is a flat sequence: per account (in code order) a heading row, its
 * lines, a closing row. Per-account counts and totals come from one aggregate; only the accounts the page touches are read, with
 * OFFSET / LIMIT, and the running balance of a page that starts mid-account is based on the SQL total of the lines before it.
 */
async function generalLedgerPage(ctx: ReportContext, page: { offset: number; limit: number }): Promise<ReportOutput> {
  const { from, to } = ctx.window as { from: string; to: string };
  const f = ctx.params.filters;
  const scope = { accountId: f.accountId, costCenterId: f.costCenterId, source: f.source };
  const counts = await ledgerCountsByAccount(ctx.q, ctx.companyId, { from, to, ...scope });
  const openings = await openingBalances(ctx.q, ctx.companyId, from, { accountId: f.accountId, costCenterId: f.costCenterId });
  const total = counts.reduce((sum, c) => sum + c.count + 2, 0);
  const names = new Map<string, { code: string; nameEn: string; nameAr: string | null }>();
  if (counts.length) {
    const { rows } = await ctx.q.query(`SELECT id, code, name_en, name_ar FROM accounts WHERE company_id = $1 AND id = ANY($2::uuid[])`, [ctx.companyId, counts.map((c) => c.accountId)]);
    for (const r of rows) names.set(String(r.id), { code: String(r.code), nameEn: String(r.name_en), nameAr: r.name_ar ?? null });
  }
  const rows: ReportOutput["rows"] = [];
  const end = page.offset + page.limit;
  let cursor = 0;
  for (const c of counts) {
    const size = c.count + 2;
    const lo = Math.max(page.offset - cursor, 0);
    const hi = Math.min(end - cursor, size);
    const blockStart = cursor;
    cursor += size;
    if (hi <= lo) {
      if (blockStart >= end) break;
      continue;
    }
    const nm = names.get(c.accountId)!;
    const open = openings.get(c.accountId) ?? { debit: 0, credit: 0 };
    const title = `${nm.code} ${acctName(ctx, nm)}`;
    if (lo === 0) rows.push(section(`acct:${c.accountId}`, { description: title, balance: naturalBalance(c.type, open.debit, open.credit) }, 0, { target: "account", id: c.accountId }));
    const lineFrom = Math.max(lo, 1) - 1;
    const lineTo = Math.min(hi, c.count + 1) - 1;
    if (lineTo > lineFrom) {
      const before = await ledgerFirstLinesTotal(ctx.q, ctx.companyId, { from, to, ...scope, accountId: c.accountId }, lineFrom);
      let balance = naturalBalance(c.type, open.debit + before.debit, open.credit + before.credit);
      const lines = await ledgerLines(ctx.q, ctx.companyId, { from, to, ...scope, accountId: c.accountId, limit: lineTo - lineFrom, offset: lineFrom });
      for (const l of lines) {
        balance = round2(balance + naturalBalance(c.type, l.debit, l.credit));
        rows.push(
          detail(
            `line:${l.lineId}`,
            { date: l.date, number: l.entryNumber, description: lineDescription(l), source: l.source, debit: l.debit, credit: l.credit, balance },
            { target: "journal_entry", id: l.entryId },
            1
          )
        );
      }
    }
    if (hi > c.count + 1) {
      rows.push(
        subtotal(`close:${c.accountId}`, {
          description: pick(ctx, "Closing balance", "الرصيد الختامي"),
          debit: c.debit,
          credit: c.credit,
          balance: naturalBalance(c.type, open.debit + c.debit, open.credit + c.credit),
        })
      );
    }
  }
  return { rows, total, totals: { debit: round2(counts.reduce((a, c) => a + c.debit, 0)), credit: round2(counts.reduce((a, c) => a + c.credit, 0)) } };
}

async function generalLedger(ctx: ReportContext): Promise<ReportOutput> {
  if (ctx.page) return generalLedgerPage(ctx, ctx.page);
  const { from, to } = ctx.window as { from: string; to: string };
  const f = ctx.params.filters;
  const scope = { accountId: f.accountId, costCenterId: f.costCenterId, source: f.source };
  const lines = await ledgerLines(ctx.q, ctx.companyId, { from, to, ...scope, limit: ctx.maxRows + 1 });
  const openings = await openingBalances(ctx.q, ctx.companyId, from, { accountId: f.accountId, costCenterId: f.costCenterId });

  const groups = new Map<string, LedgerLine[]>();
  for (const l of lines) groups.set(l.accountId, [...(groups.get(l.accountId) ?? []), l]);
  const rows: ReportOutput["rows"] = [];
  for (const [accountId, list] of groups) {
    const head = list[0];
    const open = openings.get(accountId) ?? { debit: 0, credit: 0 };
    let balance = naturalBalance(head.type, open.debit, open.credit);
    rows.push(
      section(`acct:${accountId}`, { description: lineName(ctx, head), balance }, 0, { target: "account", id: accountId })
    );
    let drTotal = 0;
    let crTotal = 0;
    for (const l of list) {
      balance = round2(balance + naturalBalance(head.type, l.debit, l.credit));
      drTotal += Math.round(l.debit * 100);
      crTotal += Math.round(l.credit * 100);
      rows.push(
        detail(
          `line:${l.lineId}`,
          { date: l.date, number: l.entryNumber, description: lineDescription(l), source: l.source, debit: l.debit, credit: l.credit, balance },
          { target: "journal_entry", id: l.entryId },
          1
        )
      );
    }
    rows.push(
      subtotal(`close:${accountId}`, {
        description: pick(ctx, "Closing balance", "الرصيد الختامي"),
        debit: drTotal / 100,
        credit: crTotal / 100,
        balance,
      })
    );
  }
  return { rows };
}

registerReport({
  id: "general-ledger",
  paged: true,
  filters: ["accountId", "costCenterId", "source"],
  columns: [
    C.date,
    col("number", "Entry", "القيد"),
    C.description,
    col("source", "Source", "المصدر"),
    C.debit(),
    C.credit(),
    moneyCol("balance", "Balance", "الرصيد"),
  ],
  run: generalLedger,
});

// ---------------------------------------------------------------------------------------------------------------
// Account Transactions: the same lines as a flat list
// ---------------------------------------------------------------------------------------------------------------

async function accountTransactions(ctx: ReportContext): Promise<ReportOutput> {
  const { from, to } = ctx.window as { from: string; to: string };
  const f = ctx.params.filters;
  const scope = { from, to, accountId: f.accountId, costCenterId: f.costCenterId, source: f.source };
  const lines = await ledgerLines(ctx.q, ctx.companyId, ctx.page ? { ...scope, limit: ctx.page.limit, offset: ctx.page.offset } : { ...scope, limit: ctx.maxRows + 1 });
  const paged = ctx.page ? await ledgerCount(ctx.q, ctx.companyId, scope) : null;
  return {
    ...(paged ? { total: paged.count, totals: { debit: paged.debit, credit: paged.credit } } : {}),
    rows: lines.map((l) =>
      detail(
        `line:${l.lineId}`,
        {
          date: l.date,
          number: l.entryNumber,
          code: l.code,
          name: acctName(ctx, l),
          description: lineDescription(l),
          debit: l.debit,
          credit: l.credit,
        },
        { target: "journal_entry", id: l.entryId }
      )
    ),
  };
}

registerReport({
  id: "account-transactions",
  paged: true,
  filters: ["accountId", "costCenterId", "source"],
  columns: [C.date, col("number", "Entry", "القيد"), C.code, C.account, C.description, C.debit(), C.credit()],
  run: accountTransactions,
});

// ---------------------------------------------------------------------------------------------------------------
// Journal Report: one row per posted entry, filterable by source and creator
// ---------------------------------------------------------------------------------------------------------------

async function journalReport(ctx: ReportContext): Promise<ReportOutput> {
  const { from, to } = ctx.window as { from: string; to: string };
  const f = ctx.params.filters;
  const b = new SqlParams();
  const { start, end } = dayBounds(from, to);
  const conds = [
    `je.company_id = ${b.p(ctx.companyId)}`,
    `je.status = 'posted'`,
    `je.date >= ${b.p(start)}::timestamp`,
    `je.date <= ${b.p(end)}::timestamp`,
  ];
  if (f.source) conds.push(`je.source = ${b.p(f.source)}`);
  if (f.userId) conds.push(`je.created_by = ${b.p(f.userId)}::uuid`);
  const { rows } = await ctx.q.query(
    `SELECT je.id, je.entry_number, ${ymdSql("je.date")} AS d, je.memo, je.source, COALESCE(u.name, u.email) AS creator,
            COALESCE(SUM(jl.debit), 0)::text AS debit, COALESCE(SUM(jl.credit), 0)::text AS credit
       FROM journal_entries je
       LEFT JOIN journal_lines jl ON jl.entry_id = je.id
       LEFT JOIN users u ON u.id = je.created_by
      WHERE ${conds.join(" AND ")}
      GROUP BY je.id, u.name, u.email
      ORDER BY je.date, je.created_at, je.entry_number ${ctx.page ? `LIMIT ${Math.trunc(ctx.page.limit)} OFFSET ${Math.trunc(ctx.page.offset)}` : `LIMIT ${ctx.maxRows + 1}`}`,
    b.values
  );
  let paged: { total: number; totals: { debit: number; credit: number } } | null = null;
  if (ctx.page) {
    const c = (
      await ctx.q.query(
        `SELECT COUNT(DISTINCT je.id)::text AS n, COALESCE(SUM(jl.debit), 0)::text AS dr, COALESCE(SUM(jl.credit), 0)::text AS cr
           FROM journal_entries je LEFT JOIN journal_lines jl ON jl.entry_id = je.id WHERE ${conds.join(" AND ")}`,
        b.values.slice(0, b.values.length)
      )
    ).rows[0];
    paged = { total: Number(c.n), totals: { debit: money(c.dr), credit: money(c.cr) } };
  }
  return {
    ...(paged ? { total: paged.total, totals: paged.totals } : {}),
    rows: rows.map((r) =>
      detail(
        `entry:${r.id}`,
        {
          date: r.d,
          number: r.entry_number,
          description: r.memo ?? "",
          source: r.source,
          user: r.creator ?? "",
          debit: money(r.debit),
          credit: money(r.credit),
        },
        { target: "journal_entry", id: String(r.id) }
      )
    ),
  };
}

registerReport({
  id: "journal-report",
  paged: true,
  filters: ["source", "userId"],
  columns: [C.date, col("number", "Entry", "القيد"), C.description, col("source", "Source", "المصدر"), col("user", "Created by", "أنشأه"), C.debit(), C.credit()],
  run: journalReport,
});

// ---------------------------------------------------------------------------------------------------------------
// FX Gains and Losses: every posted line on the FX gain / loss accounts (realised on payment, unrealised on revaluation)
// ---------------------------------------------------------------------------------------------------------------

async function fxGainsLosses(ctx: ReportContext): Promise<ReportOutput> {
  const { from, to } = ctx.window as { from: string; to: string };
  const b = new SqlParams();
  const { rows: accts } = await ctx.q.query(
    `SELECT id FROM accounts WHERE company_id = ${b.p(ctx.companyId)} AND code = ANY(${b.p([ACCOUNT_CODES.FX_GAIN, ACCOUNT_CODES.FX_LOSS, ACCOUNT_CODES.FX_UNREALISED])}::text[])`,
    b.values
  );
  const ids = accts.map((a) => String(a.id));
  if (ids.length === 0) return { rows: [], totals: { gain: 0, loss: 0, net: 0 } };
  const lines = await ledgerLines(ctx.q, ctx.companyId, { from, to, accountIds: ids, limit: ctx.maxRows + 1 });
  const rows = lines
    .map((l) => {
      const gain = round2(l.credit - l.debit);
      return {
        l,
        gain: gain > 0 ? gain : 0,
        loss: gain < 0 ? round2(-gain) : 0,
      };
    })
    .filter((r) => r.gain !== 0 || r.loss !== 0)
    .map((r) =>
      detail(
        `line:${r.l.lineId}`,
        {
          date: r.l.date,
          number: r.l.entryNumber,
          description: lineDescription(r.l),
          kind: r.l.source.startsWith("fx_revaluation") ? pick(ctx, "Unrealised", "غير محققة") : pick(ctx, "Realised", "محققة"),
          gain: r.gain,
          loss: r.loss,
        },
        { target: "journal_entry", id: r.l.entryId }
      )
    );
  const gain = sumMoney(rows.map((r) => r.cells.gain as number));
  const loss = sumMoney(rows.map((r) => r.cells.loss as number));
  return { rows, totals: { gain, loss, net: round2(gain - loss) } };
}

registerReport({
  id: "fx-gains-losses",
  columns: [
    C.date,
    col("number", "Entry", "القيد"),
    C.description,
    col("kind", "Kind", "النوع"),
    moneyCol("gain", "Gain", "ربح", { sum: true }),
    moneyCol("loss", "Loss", "خسارة", { sum: true }),
  ],
  run: fxGainsLosses,
});
