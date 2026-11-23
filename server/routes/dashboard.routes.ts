import type { Express, Request, Response } from "express";
import { authMiddleware } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { pool } from "../db";
import {
  getDashboardStats,
  getExpenseBreakdown,
  getMonthlyTrends,
} from "../services/dashboard-stats.service";
import { DomainError } from "../errors";
import {
  balanceSheet,
  parseReportDate,
  profitAndLoss,
  readRange,
  type BsCompareTo,
  type StatementLine,
} from "../reporting";
import { assertReportAccess, readFormat, sendTabular } from "../reporting/http";

/**
 * Register all dashboard and basic report routes.
 */
export function registerDashboardRoutes(app: Express) {
  // =====================================
  // Dashboard Stats Routes (W3-E: SQL-aggregated, ledger basis)
  // =====================================

  app.get(
    "/api/companies/:companyId/dashboard/stats",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      await assertReportAccess(req, companyId);
      res.json(await getDashboardStats(companyId, req.query));
    })
  );

  // Period-scoped expense breakdown from the P&L (same figures as the stats tile).
  app.get(
    "/api/companies/:companyId/dashboard/expense-breakdown",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      await assertReportAccess(req, companyId);
      res.json(await getExpenseBreakdown(companyId, req.query));
    })
  );

  app.get(
    "/api/companies/:companyId/dashboard/monthly-trends",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      await assertReportAccess(req, companyId);
      res.json(await getMonthlyTrends(companyId));
    })
  );

  // =====================================
  // Reports Routes
  // =====================================

  // P&L and Balance Sheet for the Reports page. Both are served by the
  // reporting kernel (server/reporting) — the same implementation as the
  // canonical /reports/profit-loss and /financial-statements routes (R11-05).
  // Response shapes are extended, never renamed.
  app.get(
    "/api/companies/:companyId/reports/pl",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      await assertReportAccess(req, companyId);
      const range = readRange(req.query as Record<string, unknown>);
      const pl = await profitAndLoss({ companyId, from: range.from, to: range.to });
      const tag = (section: string) => (l: StatementLine) => ({
        accountId: l.accountId,
        accountCode: l.accountCode,
        accountName: l.accountName,
        accountNameAr: l.accountNameAr,
        amount: l.amount,
        section,
      });
      // Legacy arrays keep every income/expense line (totals unchanged:
      // totalRevenue = total income). The split (revenue vs other income,
      // cost of sales, gross profit) is in `sections` and the extra totals.
      res.json({
        reportCurrency: pl.reportCurrency,
        from: pl.from,
        to: pl.to,
        revenue: [
          ...pl.sections.revenue.lines.map(tag("revenue")),
          ...pl.sections.otherIncome.lines.map(tag("other_income")),
        ],
        expenses: [
          ...pl.sections.costOfSales.lines.map(tag("cost_of_sales")),
          ...pl.sections.operatingExpenses.lines.map(tag("operating_expenses")),
          ...pl.sections.otherExpenses.lines.map(tag("other_expenses")),
          ...pl.sections.incomeTax.lines.map(tag("income_tax")),
        ],
        totalRevenue: pl.totalIncome,
        totalExpenses: pl.totalExpenses,
        netProfit: pl.netProfit,
        operatingRevenue: pl.revenue,
        costOfSales: pl.costOfSales,
        grossProfit: pl.grossProfit,
        operatingExpenses: pl.operatingExpenses,
        operatingProfit: pl.operatingProfit,
        otherIncome: pl.otherIncome,
        otherExpenses: pl.otherExpenses,
        sections: pl.sections,
      });
    })
  );

  app.get(
    "/api/companies/:companyId/reports/balance-sheet",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      await assertReportAccess(req, companyId);
      // A balance sheet is a point-in-time snapshot as of endDate (or asOf).
      // startDate only scopes `currentPeriodNetIncome`; equity always carries
      // retained earnings brought forward + current-year earnings, so the
      // statement balances for every preset range (R11-01).
      const range = readRange(req.query as Record<string, unknown>);
      const asOf = parseReportDate(req.query.asOf, "asOf") ?? range.to;
      const compareTo = req.query.compareTo;
      if (
        compareTo !== undefined &&
        compareTo !== "" &&
        !["prior_year", "prior_period", "prior_year_end"].includes(String(compareTo))
      ) {
        throw new DomainError(
          "INVALID_COMPARE_TO",
          400,
          undefined,
          "compareTo must be prior_year, prior_period or prior_year_end"
        );
      }
      const bs = await balanceSheet({
        companyId,
        asOf,
        compareTo: compareTo ? (compareTo as BsCompareTo) : null,
      });
      const periodNetIncome = range.from
        ? (await profitAndLoss({ companyId, from: range.from, to: asOf })).netProfit
        : bs.equity.currentYearEarnings;
      const asItem = (l: StatementLine) => ({
        accountId: l.accountId,
        accountCode: l.accountCode,
        accountName: l.accountName,
        accountNameAr: l.accountNameAr,
        amount: l.amount,
      });
      const body = {
        reportCurrency: bs.reportCurrency,
        asOf: bs.asOf,
        fiscalYearStart: bs.fiscalYearStart,
        assets: [...bs.assets.current.lines, ...bs.assets.nonCurrent.lines].map(asItem),
        liabilities: [...bs.liabilities.current.lines, ...bs.liabilities.nonCurrent.lines].map(
          asItem
        ),
        equity: bs.equity.lines.map(asItem),
        totalAssets: bs.totalAssets,
        totalLiabilities: bs.totalLiabilities,
        totalEquity: bs.totalEquity,
        totalLiabilitiesAndEquity: bs.totalLiabilitiesAndEquity,
        currentPeriodNetIncome: periodNetIncome,
        retainedEarningsBroughtForward: bs.equity.retainedEarningsBroughtForward,
        currentYearEarnings: bs.equity.currentYearEarnings,
        ...(bs.warnings?.length ? { warnings: bs.warnings } : {}),
        isBalanced: bs.isBalanced,
        difference: bs.difference,
        statement: bs,
      };
      const format = readFormat(req.query.format);
      if (format === "json") return res.json(body);
      const rows: Record<string, unknown>[] = [];
      const add = (label: string, lines: StatementLine[], total: number) => {
        rows.push({ account: label.toUpperCase() });
        for (const l of lines)
          rows.push({ code: l.accountCode, account: l.accountName, amount: l.amount });
        rows.push({ account: `Total ${label}`, amount: total });
      };
      add("Current assets", bs.assets.current.lines, bs.assets.current.total);
      add("Non-current assets", bs.assets.nonCurrent.lines, bs.assets.nonCurrent.total);
      rows.push({ account: "TOTAL ASSETS", amount: bs.totalAssets });
      add("Current liabilities", bs.liabilities.current.lines, bs.liabilities.current.total);
      add(
        "Non-current liabilities",
        bs.liabilities.nonCurrent.lines,
        bs.liabilities.nonCurrent.total
      );
      add("Equity", bs.equity.lines, bs.totalEquity);
      rows.push({ account: "TOTAL LIABILITIES AND EQUITY", amount: bs.totalLiabilitiesAndEquity });
      await sendTabular(res, format, `balance-sheet-${asOf}`, [
        {
          sheetName: "Balance Sheet",
          columns: [
            { header: "Code", key: "code", width: 10 },
            { header: "Account", key: "account", width: 36 },
            { header: "Amount (AED)", key: "amount" },
          ],
          rows,
        },
      ]);
    })
  );

  // VAT summary moved to reports.routes.ts onto the VAT engine (W4-E, W2-B carry-over).

  // =====================================
  // Legacy / Global Dashboard Routes
  // =====================================

  const EMPTY_STATS = {
    revenue: 0,
    expenses: 0,
    outstanding: 0,
    totalInvoices: 0,
    totalEntries: 0,
    cashPosition: 0,
    monthlyBurnRate: 0,
    cashRunway: null,
    arAging: { current: 0, days0to30: 0, days31to60: 0, days61to90: 0, days90plus: 0 },
    apAging: { current: 0, days0to30: 0, days31to60: 0, days61to90: 0, days90plus: 0 },
    revenueGrowth: null,
    expenseGrowth: null,
    topExpenseCategories: [],
  };

  for (const path of ["/api/dashboard/stats", "/api/dashboard/summary"]) {
    app.get(
      path,
      authMiddleware,
      asyncHandler(async (req: Request, res: Response) => {
        const { companyId } = req.query;
        if (!companyId || typeof companyId !== "string") return res.json(EMPTY_STATS);
        await assertReportAccess(req, companyId);
        res.json(await getDashboardStats(companyId, req.query));
      })
    );
  }

  app.get(
    "/api/dashboard/recent-invoices",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.query;
      if (!companyId || typeof companyId !== "string") return res.json([]);
      await assertReportAccess(req, companyId);
      const { rows } = await pool.query(
        `SELECT id, number, customer_name AS "customerName", date, due_date AS "dueDate",
                total, status, currency
           FROM invoices WHERE company_id = $1 ORDER BY date DESC, created_at DESC LIMIT 5`,
        [companyId]
      );
      res.json(rows);
    })
  );

  app.get(
    "/api/dashboard/expense-breakdown",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.query;
      if (!companyId || typeof companyId !== "string") return res.json([]);
      await assertReportAccess(req, companyId);
      res.json(await getExpenseBreakdown(companyId, req.query));
    })
  );
}
