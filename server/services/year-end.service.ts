/**
 * Financial-year close. One entry dated the last day of the year closes every
 * income and expense account to retained earnings (see year-end.ts), the twelve
 * months of the year are locked, and the close is recorded so it is idempotent
 * (a second attempt is a 409). An authorised user can reverse it with a reason
 * while no later year has a filed return and no later year is closed.
 *
 * The closing entry has source "year_end_close" so period profit-and-loss
 * reports can leave it out (otherwise a closed year would report zero profit);
 * the balance sheet keeps it, which is how retained earnings carry forward.
 */

import { and, eq, sql } from "drizzle-orm";
import type { Request } from "express";
import { db } from "../db";
import { storage } from "../storage";
import { AppError } from "../errors";
import { yearEndCloses, type YearEndClose } from "../../shared/schema";
import { lockPeriodInTx } from "./month-end.service";
import { recordAudit } from "./audit.service";
import { uaeTodayYmd } from "./vat-period-status.service";
import { assertFilingPermission, findAccountByCode, findAccountByName, missingAccountError, postSettlementJournal, type FilingActor } from "./tax-filing.service";
import { findFiledVatReturnsCoveringMonth } from "./vat-filing.service";
import { fromFils, toFils } from "./tax-filing-core";
import { buildYearEndClosingLines, fiscalYearContaining, fiscalYearRange, monthEndsOfFiscalYear } from "./year-end";

type Tx = any;

export const YEAR_END_SOURCE = "year_end_close";
export const YEAR_END_REVERSAL_SOURCE = "year_end_close_reversal";
/** Entry sources that period P&L reports leave out. */
export const CLOSING_SOURCES = [YEAR_END_SOURCE, YEAR_END_REVERSAL_SOURCE] as const;

const RETAINED = { name: "Retained Earnings", code: "3020", type: "equity" } as const;

async function fiscalStartMonth(companyId: string): Promise<number> {
  const company = await storage.getCompany(companyId);
  const m = Number(company?.fiscalYearStartMonth ?? 1);
  return m >= 1 && m <= 12 ? m : 1;
}

async function yearBalances(companyId: string, yearStart: string, yearEnd: string) {
  const res: any = await db.execute(sql`
    SELECT a.id AS account_id, a.type, SUM(jl.credit - jl.debit) AS credit_net
      FROM journal_lines jl
      JOIN journal_entries je ON je.id = jl.entry_id
      JOIN accounts a ON a.id = jl.account_id
     WHERE je.company_id = ${companyId} AND je.status = 'posted'
       AND je.date >= ${yearStart}::date AND je.date < (${yearEnd}::date + 1)
       AND a.type IN ('income', 'expense')
     GROUP BY a.id, a.type
    HAVING SUM(jl.credit - jl.debit) <> 0`);
  const rows = (res.rows ?? res) as Array<{ account_id: string; type: string; credit_net: string }>;
  return {
    income: rows.filter((r) => r.type === "income").map((r) => ({ accountId: r.account_id, balance: Number(r.credit_net) })),
    expense: rows.filter((r) => r.type === "expense").map((r) => ({ accountId: r.account_id, balance: -Number(r.credit_net) })),
  };
}

async function resolveRetained(tx: Tx, companyId: string) {
  const found =
    (await findAccountByCode(tx, companyId, RETAINED.code, ["equity"])) ??
    (await findAccountByName(tx, companyId, RETAINED.name, ["equity"]));
  if (!found) throw missingAccountError(RETAINED.name, RETAINED.code, RETAINED.type);
  return found;
}

export interface YearOverviewRow {
  yearStart: string;
  yearEnd: string;
  ended: boolean;
  status: "open" | "closed";
  closedAt: string | null;
  closingEntryId: string | null;
  netIncome: number;
  blockers: Array<{ code: string; message: string }>;
}

export async function getYearEndOverview(companyId: string): Promise<{ fiscalYearStartMonth: number; years: YearOverviewRow[] }> {
  const startMonth = await fiscalStartMonth(companyId);
  const today = uaeTodayYmd();
  const first: any = await db.execute(sql`SELECT to_char(MIN(date), 'YYYY-MM-DD') AS d FROM journal_entries WHERE company_id = ${companyId} AND status = 'posted'`);
  const firstDate: string | null = (first.rows ?? first)[0]?.d ?? null;
  const current = fiscalYearContaining(startMonth, today);
  const firstYear = firstDate ? Number(fiscalYearContaining(startMonth, firstDate).yearStart.slice(0, 4)) : Number(current.yearStart.slice(0, 4));
  const closes = await db.select().from(yearEndCloses).where(and(eq(yearEndCloses.companyId, companyId), eq(yearEndCloses.status, "closed")));
  const closedByEnd = new Map<string, YearEndClose>(closes.map((c: YearEndClose) => [String(c.yearEnd).slice(0, 10), c]));

  const years: YearOverviewRow[] = [];
  for (let y = Number(current.yearStart.slice(0, 4)); y >= firstYear; y--) {
    const range = fiscalYearRange(startMonth, y);
    const close = closedByEnd.get(range.yearEnd);
    const ended = range.yearEnd < today;
    const balances = await yearBalances(companyId, range.yearStart, range.yearEnd);
    const netFils =
      balances.income.reduce((s, r) => s + toFils(r.balance), 0) - balances.expense.reduce((s, r) => s + toFils(r.balance), 0);
    const blockers: YearOverviewRow["blockers"] = [];
    if (!close) {
      if (!ended) blockers.push({ code: "YEAR_NOT_ENDED", message: "The financial year has not ended yet." });
      const drafts: any = await db.execute(sql`SELECT count(*)::int AS n FROM journal_entries WHERE company_id = ${companyId} AND status = 'draft' AND date >= ${range.yearStart}::date AND date < (${range.yearEnd}::date + 1)`);
      const n = (drafts.rows ?? drafts)[0]?.n ?? 0;
      if (n > 0) blockers.push({ code: "DRAFT_ENTRIES_EXIST", message: `${n} draft journal entr${n === 1 ? "y is" : "ies are"} dated in this year. Post or delete them first.` });
    }
    years.push({
      yearStart: range.yearStart,
      yearEnd: range.yearEnd,
      ended,
      status: close ? "closed" : "open",
      closedAt: close ? new Date(close.closedAt).toISOString() : null,
      closingEntryId: close?.closingEntryId ?? null,
      netIncome: fromFils(netFils),
      blockers,
    });
  }
  return { fiscalYearStartMonth: startMonth, years };
}

export async function closeFinancialYear(args: { user: FilingActor; companyId: string; yearStart: unknown; req?: Request }) {
  const { user, companyId } = args;
  await assertFilingPermission(user, companyId, "write");
  const startMonth = await fiscalStartMonth(companyId);
  if (typeof args.yearStart !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(args.yearStart)) {
    throw new AppError({ message: "yearStart (YYYY-MM-DD) is required.", statusCode: 400, code: "YEAR_START_INVALID" });
  }
  const range = fiscalYearContaining(startMonth, args.yearStart);
  if (range.yearStart !== args.yearStart) {
    throw new AppError({
      message: `The financial year of this company starts on ${range.yearStart}: ${args.yearStart} is not a year start (year starts in month ${startMonth}).`,
      statusCode: 400,
      code: "YEAR_START_INVALID",
    });
  }
  if (!(range.yearEnd < uaeTodayYmd())) {
    throw new AppError({ message: "The financial year has not ended yet, so it cannot be closed.", statusCode: 422, code: "YEAR_NOT_ENDED" });
  }
  const drafts: any = await db.execute(sql`SELECT count(*)::int AS n FROM journal_entries WHERE company_id = ${companyId} AND status = 'draft' AND date >= ${range.yearStart}::date AND date < (${range.yearEnd}::date + 1)`);
  if (((drafts.rows ?? drafts)[0]?.n ?? 0) > 0) {
    throw new AppError({ message: "Draft journal entries dated in this year would be left out of the close. Post or delete them first.", statusCode: 409, code: "DRAFT_ENTRIES_EXIST" });
  }

  let result: { id: string; closingEntryId: string | null; netIncome: number };
  try {
    result = await db.transaction(async (tx: Tx) => {
      // Claim the slot first: the partial unique index makes a concurrent second close fail.
      const [row] = await tx
        .insert(yearEndCloses)
        .values({ companyId, yearStart: range.yearStart, yearEnd: range.yearEnd, status: "closed", closedBy: user.id })
        .returning();
      const balances = await yearBalances(companyId, range.yearStart, range.yearEnd);
      let entryId: string | null = null;
      let netIncome = 0;
      if (balances.income.length + balances.expense.length > 0) {
        const retained = await resolveRetained(tx, companyId);
        const built = buildYearEndClosingLines(balances, { retainedId: retained.id }, `Financial year ${range.yearStart} to ${range.yearEnd}`);
        netIncome = built.netIncome;
        entryId = await postSettlementJournal(tx, {
          companyId,
          ymd: range.yearEnd,
          memo: `Year-end close ${range.yearStart} to ${range.yearEnd}`,
          source: YEAR_END_SOURCE,
          sourceId: row.id,
          userId: user.id,
          lines: built.lines,
        });
        await tx.update(yearEndCloses).set({ closingEntryId: entryId }).where(eq(yearEndCloses.id, row.id));
      }
      for (const monthEnd of monthEndsOfFiscalYear(range.yearStart, range.yearEnd)) {
        await lockPeriodInTx(tx, companyId, monthEnd, user.id);
      }
      return { id: row.id, closingEntryId: entryId, netIncome };
    });
  } catch (err: any) {
    const code = err?.code ?? err?.cause?.code;
    if (code === "23505") {
      throw new AppError({ message: "This financial year is already closed.", statusCode: 409, code: "YEAR_ALREADY_CLOSED" });
    }
    throw err;
  }

  await recordAudit({
    userId: user.id,
    companyId,
    action: "year_end.close",
    entityType: "financial_year",
    entityId: result.id,
    after: { yearStart: range.yearStart, yearEnd: range.yearEnd, closingEntryId: result.closingEntryId, netIncome: result.netIncome },
    req: args.req,
  });
  return { ...range, ...result };
}

export async function reopenFinancialYear(args: { user: FilingActor; companyId: string; yearStart: unknown; reason: unknown; req?: Request }) {
  const { user, companyId } = args;
  if (!(await storage.hasCompanyAccess(user.id, companyId))) {
    throw new AppError({ message: "Access denied", statusCode: 403, code: "ACCESS_DENIED" });
  }
  // Same authority as unlocking a period: it re-opens closed months.
  if (!user.isAdmin && user.firmRole !== "firm_owner") {
    throw new AppError({ message: "Only a firm owner can reopen a closed financial year.", statusCode: 403, code: "REOPEN_FORBIDDEN" });
  }
  const reason = typeof args.reason === "string" ? args.reason.trim() : "";
  if (reason.length < 10) {
    throw new AppError({ message: "A reason of at least 10 characters is required to reopen a financial year.", statusCode: 400, code: "REASON_REQUIRED" });
  }
  if (typeof args.yearStart !== "string") throw new AppError({ message: "yearStart is required.", statusCode: 400, code: "YEAR_START_INVALID" });

  const rows = await db
    .select()
    .from(yearEndCloses)
    .where(and(eq(yearEndCloses.companyId, companyId), eq(yearEndCloses.status, "closed")));
  const close = rows.find((r: YearEndClose) => String(r.yearStart).slice(0, 10) === args.yearStart);
  if (!close) throw new AppError({ message: "That financial year is not closed.", statusCode: 404, code: "YEAR_NOT_CLOSED" });
  const yearStart = String(close.yearStart).slice(0, 10);
  const yearEnd = String(close.yearEnd).slice(0, 10);

  if (rows.some((r: YearEndClose) => String(r.yearStart).slice(0, 10) > yearEnd)) {
    throw new AppError({ message: "A later financial year is closed. Reopen the latest closed year first.", statusCode: 409, code: "LATER_YEAR_CLOSED" });
  }
  const filed: any = await db.execute(sql`
    SELECT 'vat' AS kind FROM tax_filings f JOIN vat_returns r ON r.id = f.return_id
      WHERE f.company_id = ${companyId} AND f.kind = 'vat' AND r.period_start::date > ${yearEnd}::date
    UNION ALL
    SELECT 'corporate_tax' FROM tax_filings f JOIN corporate_tax_returns r ON r.id = f.return_id
      WHERE f.company_id = ${companyId} AND f.kind = 'corporate_tax' AND r.tax_period_start::date > ${yearEnd}::date
    LIMIT 1`);
  if ((filed.rows ?? filed).length > 0) {
    throw new AppError({
      message: "A return has been filed for a period after this financial year, so the year can no longer be reopened.",
      statusCode: 409,
      code: "YEAR_REOPEN_BLOCKED_BY_FILED_RETURN",
    });
  }

  await db.transaction(async (tx: Tx) => {
    const locked: any = await tx.execute(sql`SELECT status FROM year_end_closes WHERE id = ${close.id} FOR UPDATE`);
    if ((locked.rows ?? locked)[0]?.status !== "closed") {
      throw new AppError({ message: "That financial year is not closed.", statusCode: 409, code: "YEAR_NOT_CLOSED" });
    }
    if (close.closingEntryId) {
      const original: any = await tx.execute(sql`SELECT account_id, debit, credit, description FROM journal_lines WHERE entry_id = ${close.closingEntryId}`);
      const reversalId = await postSettlementJournal(tx, {
        companyId,
        ymd: yearEnd,
        memo: `Reversal of year-end close ${yearStart} to ${yearEnd}: ${reason}`,
        source: YEAR_END_REVERSAL_SOURCE,
        sourceId: close.id,
        userId: user.id,
        lines: (original.rows ?? original).map((l: any) => ({
          accountId: l.account_id,
          debit: Number(l.credit),
          credit: Number(l.debit),
          description: `Reversal - ${l.description ?? "year-end close"}`,
        })),
      });
      if (reversalId) {
        await tx.execute(sql`UPDATE journal_entries SET reversed_entry_id = ${close.closingEntryId}, reversal_reason = ${reason} WHERE id = ${reversalId}`);
      }
    }
    // Unlock the months this close locked, except months a filed VAT return covers.
    for (const monthEnd of monthEndsOfFiscalYear(yearStart, yearEnd)) {
      const covering = await findFiledVatReturnsCoveringMonth(companyId, monthEnd);
      if (covering.length === 0) {
        await tx.execute(sql`UPDATE month_end_close SET status = 'open', updated_at = now() WHERE company_id = ${companyId} AND period_end = ${monthEnd}::date`);
      }
    }
    await tx
      .update(yearEndCloses)
      .set({ status: "reopened", reopenedBy: user.id, reopenedAt: new Date(), reopenReason: reason })
      .where(eq(yearEndCloses.id, close.id));
  });

  await recordAudit({
    userId: user.id,
    companyId,
    action: "year_end.reopen",
    entityType: "financial_year",
    entityId: close.id,
    before: { yearStart, yearEnd },
    extra: { reason },
    req: args.req,
  });
  return { reopened: true, yearStart, yearEnd };
}


