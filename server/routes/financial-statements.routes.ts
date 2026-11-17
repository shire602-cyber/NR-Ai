import type { Express, Request, Response } from "express";
import { authMiddleware, requireCustomer } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { requireFeature } from "../middleware/featureGate";
import { DomainError } from "../errors";
import {
  balanceSheet,
  cashFlow,
  profitAndLoss,
  readAsOf,
  readRange,
  type BsCompareTo,
  type PlCompareTo,
  type StatementLine,
} from "../reporting";
import { assertReportAccess, deprecate } from "../reporting/http";

/**
 * Financial statements (FinancialStatements page). Served by the reporting
 * kernel — the single statement implementation (R11-05). The response shapes
 * are the historical ones, extended with comparatives, the equity split and
 * isBalanced. Canonical successors live under /api/companies/:id/reports/*.
 */

function breakdown(lines: StatementLine[]) {
  return lines.map((l) => ({
    accountId: l.accountId,
    accountCode: l.accountCode,
    accountName: l.accountName,
    accountNameAr: l.accountNameAr,
    amount: l.amount,
  }));
}

const PL_COMPARE = new Set(["prior_period", "prior_year", "budget"]);
const BS_COMPARE = new Set(["prior_year", "prior_period", "prior_year_end"]);

function readEnum<T extends string>(value: unknown, allowed: Set<string>, field: string): T | null {
  if (value === undefined || value === "") return null;
  if (typeof value !== "string" || !allowed.has(value)) {
    throw new DomainError(
      "INVALID_QUERY",
      400,
      { field },
      `${field} must be one of ${Array.from(allowed).join(", ")}`
    );
  }
  return value as T;
}

export function registerFinancialStatementRoutes(app: Express) {
  // Profit & Loss (Income Statement)
  app.get(
    "/api/companies/:companyId/financial-statements/profit-loss",
    authMiddleware,
    requireCustomer,
    requireFeature("advancedReports"),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      await assertReportAccess(req, companyId);
      deprecate(res, `/api/companies/${companyId}/reports/profit-loss`);
      const range = readRange(req.query as Record<string, unknown>, { requireFrom: true });
      const compareTo = readEnum<PlCompareTo>(req.query.compareTo, PL_COMPARE, "compareTo");
      const columns = readEnum<"total" | "monthly" | "quarterly">(
        req.query.columns,
        new Set(["total", "monthly", "quarterly"]),
        "columns"
      );
      const pl = await profitAndLoss({
        companyId,
        from: range.from,
        to: range.to,
        compareTo,
        budgetId: typeof req.query.budgetId === "string" ? req.query.budgetId : null,
        columns: columns ?? "total",
      });
      res.json({
        startDate: `${range.from}T00:00:00.000Z`,
        endDate: `${range.to}T23:59:59.999Z`,
        // Legacy totals: revenue = all income (incl. other income), so
        // revenue - expenses = netIncome still holds for old clients.
        revenue: pl.totalIncome,
        expenses: pl.totalExpenses,
        netIncome: pl.netProfit,
        breakdown: {
          revenue: breakdown([...pl.sections.revenue.lines, ...pl.sections.otherIncome.lines]),
          expenses: breakdown([
            ...pl.sections.costOfSales.lines,
            ...pl.sections.operatingExpenses.lines,
            ...pl.sections.otherExpenses.lines,
            ...pl.sections.incomeTax.lines,
          ]),
        },
        statement: pl,
      });
    })
  );

  // Balance Sheet
  app.get(
    "/api/companies/:companyId/financial-statements/balance-sheet",
    authMiddleware,
    requireCustomer,
    requireFeature("advancedReports"),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      await assertReportAccess(req, companyId);
      deprecate(res, `/api/companies/${companyId}/reports/balance-sheet`);
      if (!req.query.asOfDate && !req.query.asOf) {
        throw new DomainError("AS_OF_REQUIRED", 400, undefined, "asOfDate query param is required");
      }
      const asOf = readAsOf(req.query as Record<string, unknown>);
      const compareTo = readEnum<BsCompareTo>(req.query.compareTo, BS_COMPARE, "compareTo");
      const bs = await balanceSheet({ companyId, asOf, compareTo });
      res.json({
        asOfDate: `${asOf}T23:59:59.999Z`,
        assets: {
          total: bs.totalAssets,
          breakdown: breakdown([...bs.assets.current.lines, ...bs.assets.nonCurrent.lines]),
          current: bs.assets.current,
          nonCurrent: bs.assets.nonCurrent,
        },
        liabilities: {
          total: bs.totalLiabilities,
          breakdown: breakdown([
            ...bs.liabilities.current.lines,
            ...bs.liabilities.nonCurrent.lines,
          ]),
          current: bs.liabilities.current,
          nonCurrent: bs.liabilities.nonCurrent,
        },
        equity: {
          total: bs.totalEquity,
          breakdown: breakdown(bs.equity.lines),
          capital: bs.equity.capital,
          retainedEarningsBroughtForward: bs.equity.retainedEarningsBroughtForward,
          currentYearEarnings: bs.equity.currentYearEarnings,
        },
        totalLiabilitiesAndEquity: bs.totalLiabilitiesAndEquity,
        isBalanced: bs.isBalanced,
        difference: bs.difference,
        fiscalYearStart: bs.fiscalYearStart,
        statement: bs,
      });
    })
  );

  // Cash Flow Statement (indirect by default; ?method=direct)
  app.get(
    "/api/companies/:companyId/financial-statements/cash-flow",
    authMiddleware,
    requireCustomer,
    requireFeature("advancedReports"),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      await assertReportAccess(req, companyId);
      deprecate(res, `/api/companies/${companyId}/reports/cash-flow`);
      const range = readRange(req.query as Record<string, unknown>, { requireFrom: true });
      const method =
        readEnum<"indirect" | "direct">(
          req.query.method,
          new Set(["indirect", "direct"]),
          "method"
        ) ?? "indirect";
      const cf = await cashFlow({ companyId, from: range.from, to: range.to, method });
      res.json({
        startDate: `${range.from}T00:00:00.000Z`,
        endDate: `${range.to}T23:59:59.999Z`,
        ...cf,
      });
    })
  );
}
