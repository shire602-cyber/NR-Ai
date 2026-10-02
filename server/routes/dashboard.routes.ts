import type { Express, Request, Response } from "express";
import { storage } from "../storage";
import { authMiddleware } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { pool } from "../db";
import { uaeDayStart, uaeDayEnd, uaeMonthStart, uaeMonthEnd, uaeYmdParts } from "../utils/date";
import { round2, roundRowsWithTotal, buildBalanceSheetTotals } from "../services/financial-statements";
import Decimal from "decimal.js";
import { computeDashboardKpis, resolveDashboardPeriod } from "../reports/kpis";
import { isYmd } from "../reports/dates";
import { PL_EXCLUDED_SOURCES, accountBalances, periodProfit } from "../reports/ledger";

// Summing float journal amounts leaks binary noise (3428.3300000000017) into
// responses; round money to fils at the response boundary.
const roundRows = <T extends Record<string, any>>(rows: T[], key: keyof T): T[] =>
  rows.map((r) => ({ ...r, [key]: round2(Number(r[key])) }));
const roundValues = <T extends Record<string, number>>(o: T): T =>
  Object.fromEntries(Object.entries(o).map(([k, v]) => [k, round2(v)])) as T;

// Identifies a "real cash" account — bank, cash on hand, or petty cash.
// Used by Cash Position and any other view that should ignore non-cash
// current assets like AR, VAT Receivable, Prepaid, or Inventory.
function isCashOrBankAccount(a: {
  code?: string | null;
  nameEn: string;
  subType?: string | null;
}): boolean {
  if (a.subType === "cash" || a.subType === "bank") return true;
  const code = a.code ?? "";
  // Default chart-of-accounts: 1010 Cash on Hand, 1020 Bank Accounts, 1030 Petty Cash
  if (code >= "1010" && code <= "1039") return true;
  const name = a.nameEn.toLowerCase();
  return name.includes("cash") || name.includes("bank") || name.includes("petty");
}

/**
 * Register all dashboard and basic report routes.
 */
export function registerDashboardRoutes(app: Express) {
  // =====================================
  // Dashboard Stats Routes
  // =====================================

  // Phase 8 D4: KPIs are computed in SQL by server/reports/kpis.ts over the shared ledger layer (docs/KPI_DEFINITIONS.md):
  // revenue and expenses are the SELECTED period (month to date by default, `period=ytd`, or `period=custom&from&to`);
  // there is no all-time option (422 INVALID_PERIOD). AR/AP come from the as-of ageing SQL, payables from posted bills.
  async function getEnhancedDashboardStats(companyId: string, query: Record<string, unknown> = {}) {
    const { rows } = await pool.query(`SELECT fiscal_year_start_month FROM companies WHERE id = $1`, [companyId]);
    const period = resolveDashboardPeriod(query, Number(rows[0]?.fiscal_year_start_month ?? 1) || 1);
    return computeDashboardKpis(companyId, period);
  }

  app.get(
    "/api/companies/:companyId/dashboard/stats",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const userId = (req as any).user?.id;
      const { companyId } = req.params;
      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) return res.status(403).json({ message: "Access denied" });
      res.json(await getEnhancedDashboardStats(companyId, req.query as Record<string, unknown>));
    })
  );

  app.get(
    "/api/companies/:companyId/dashboard/expense-breakdown",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const userId = (req as any).user?.id;
      const { companyId } = req.params;
      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) return res.status(403).json({ message: "Access denied" });

      // One grouped SQL pass over the posted lines (the shared ledger layer), never the whole ledger in memory.
      const accts = await accountBalances(pool, companyId, { excludeSources: PL_EXCLUDED_SOURCES });
      const breakdown = accts
        .filter((a) => a.type === "expense")
        .map((a) => ({ name: a.nameEn, value: a.debit - a.credit }))
        .filter((item) => item.value > 0)
        .sort((x, y) => y.value - x.value)
        .slice(0, 5);

      res.json(roundRows(breakdown, "value"));
    })
  );

  app.get(
    "/api/companies/:companyId/dashboard/monthly-trends",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const userId = (req as any).user?.id;
      const { companyId } = req.params;
      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) return res.status(403).json({ message: "Access denied" });

      const months = Array.from({ length: 6 }, (_, i) => {
        const date = new Date();
        date.setDate(1);
        date.setMonth(date.getMonth() - (5 - i));
        return {
          month: date.toLocaleDateString("en-US", { month: "short" }),
          key: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`,
        };
      });
      const since = `${months[0].key}-01`;

      // Two grouped queries for the six months instead of loading every invoice and journal line.
      // Drafts, voids and year-end closing entries stay out of the totals.
      const [rev, exp] = await Promise.all([
        pool.query(
          `SELECT to_char(date, 'YYYY-MM') AS ym, COALESCE(SUM(subtotal), 0) AS total
             FROM invoices
            WHERE company_id = $1 AND status NOT IN ('draft', 'void', 'cancelled') AND date >= $2::date
            GROUP BY 1`,
          [companyId, since]
        ),
        pool.query(
          `SELECT to_char(je.date, 'YYYY-MM') AS ym, COALESCE(SUM(jl.debit - jl.credit), 0) AS total
             FROM journal_lines jl
             JOIN journal_entries je ON je.id = jl.entry_id
             JOIN accounts a ON a.id = jl.account_id
            WHERE je.company_id = $1 AND je.status = 'posted' AND a.type = 'expense'
              AND je.source <> ALL($3::text[]) AND je.date >= $2::date
            GROUP BY 1`,
          [companyId, since, [...PL_EXCLUDED_SOURCES]]
        ),
      ]);
      const revenueBy = new Map<string, number>(rev.rows.map((r: any) => [r.ym as string, Number(r.total)]));
      const expensesBy = new Map<string, number>(exp.rows.map((r: any) => [r.ym as string, Number(r.total)]));
      const trends = months.map(({ month, key }) => ({
        month,
        revenue: round2(revenueBy.get(key) ?? 0),
        expenses: round2(expensesBy.get(key) ?? 0),
      }));

      res.json(trends);
    })
  );

  // =====================================
  // Reports Routes
  // =====================================

  // Phase 8 D4: P&L and balance sheet are read through the shared ledger layer (server/reports/ledger.ts, SQL sums over
  // posted lines), the same code the report engine and the dashboard KPIs use. Response shapes are unchanged.
  const optionalDay = (raw: unknown): string | undefined | "INVALID" => {
    if (raw === undefined || raw === null || raw === "") return undefined;
    const day = String(raw).slice(0, 10);
    return isYmd(day) ? day : "INVALID";
  };

  app.get(
    "/api/companies/:companyId/reports/pl",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const userId = (req as any).user?.id;
      const { companyId } = req.params;
      const from = optionalDay(req.query.startDate);
      const to = optionalDay(req.query.endDate);
      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) return res.status(403).json({ message: "Access denied" });
      if (from === "INVALID" || to === "INVALID") {
        return res.status(400).json({ message: "startDate and endDate must be YYYY-MM-DD", code: "INVALID_PARAMS" });
      }
      // P&L reflects posted entries only, and leaves out year-end close entries so a closed year still shows its profit.
      const accts = await accountBalances(pool, companyId, { from, to, excludeSources: PL_EXCLUDED_SOURCES });
      // Negative balances are legitimate (a refund is negative revenue, a vendor credit negative expense); only zero rows go.
      const revenue = accts
        .filter((a) => a.type === "income")
        .map((a) => ({ accountName: a.nameEn, amount: a.credit - a.debit }))
        .filter((item) => round2(item.amount) !== 0);
      const expenses = accts
        .filter((a) => a.type === "expense")
        .map((a) => ({ accountName: a.nameEn, amount: a.debit - a.credit }))
        .filter((item) => round2(item.amount) !== 0);

      // Rows rounded first; totals and net profit are sums of the rounded rows so the report ties to what it displays.
      const revenueRounded = roundRowsWithTotal(revenue);
      const expensesRounded = roundRowsWithTotal(expenses);

      res.json({
        reportCurrency: "AED",
        revenue: revenueRounded.rows,
        expenses: expensesRounded.rows,
        totalRevenue: revenueRounded.total,
        totalExpenses: expensesRounded.total,
        netProfit: new Decimal(revenueRounded.total).minus(expensesRounded.total).toNumber(),
      });
    })
  );

  app.get(
    "/api/companies/:companyId/reports/balance-sheet",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const userId = (req as any).user?.id;
      const { companyId } = req.params;
      const from = optionalDay(req.query.startDate);
      const to = optionalDay(req.query.endDate);
      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) return res.status(403).json({ message: "Access denied" });
      if (from === "INVALID" || to === "INVALID") {
        return res.status(400).json({ message: "startDate and endDate must be YYYY-MM-DD", code: "INVALID_PARAMS" });
      }
      // A balance sheet is a point-in-time snapshot: every asset, liability and equity balance is cumulative from the
      // start of the books through `endDate`, year-end close entries included (they carry profit into equity).
      // `startDate` only constrains the "current period" earnings line.
      const accts = await accountBalances(pool, companyId, { to });
      const balances = (type: string) =>
        accts
          .filter((a) => a.type === type)
          .map((a) => ({ accountName: a.nameEn, amount: type === "asset" ? a.debit - a.credit : a.credit - a.debit }));
      const assets = balances("asset");
      const liabilities = balances("liability");
      const equity = balances("equity");

      // Earnings still sitting in the P&L accounts (not yet carried into equity by a year-end close).
      const unclosed = round2(accts.filter((a) => a.type === "income" || a.type === "expense").reduce((sum, a) => sum + (a.credit - a.debit), 0));
      const periodNet = from ? (await periodProfit(pool, companyId, from, to, PL_EXCLUDED_SOURCES)).net : unclosed;
      const priorEarnings = round2(unclosed - periodNet);
      if (periodNet !== 0) equity.push({ accountName: "Current Period Net Income", amount: periodNet });
      if (priorEarnings !== 0) equity.push({ accountName: "Prior Period Earnings (not yet closed)", amount: priorEarnings });

      // Rows rounded first; every total is the sum of the rounded rows.
      const bs = buildBalanceSheetTotals({ assets, liabilities, equity });

      res.json({
        reportCurrency: "AED",
        assets: bs.assets.rows,
        liabilities: bs.liabilities.rows,
        equity: bs.equity.rows,
        totalAssets: bs.assets.total,
        totalLiabilities: bs.liabilities.total,
        totalEquity: bs.equity.total,
        totalLiabilitiesAndEquity: bs.totalLiabilitiesAndEquity,
        isBalanced: bs.isBalanced,
        currentPeriodNetIncome: round2(periodNet),
      });
    })
  );

  app.get(
    "/api/companies/:companyId/reports/vat-summary",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const userId = (req as any).user?.id;
      const { companyId } = req.params;
      const { startDate, endDate } = req.query;
      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) return res.status(403).json({ message: "Access denied" });
      let invoices = await storage.getInvoicesByCompanyId(companyId);
      let receipts = await storage.getReceiptsByCompanyId(companyId);

      if (startDate || endDate) {
        const start = startDate ? uaeDayStart(startDate as string) : null;
        const end = endDate ? uaeDayEnd(endDate as string) : null;

        invoices = invoices.filter((invoice) => {
          const invoiceDate = new Date(invoice.date);
          if (start && invoiceDate < start) return false;
          if (end && invoiceDate > end) return false;
          return true;
        });

        receipts = receipts.filter((receipt) => {
          if (!receipt.date) return true;
          const receiptDate = new Date(receipt.date);
          if (start && receiptDate < start) return false;
          if (end && receiptDate > end) return false;
          return true;
        });
      }

      let salesSubtotal = 0;
      let salesVAT = 0;
      for (const invoice of invoices) {
        // Drafts must be excluded — they have not been issued to customers
        // and so cannot give rise to a VAT obligation under UAE FTA rules.
        if (
          invoice.status !== "void" &&
          invoice.status !== "draft" &&
          invoice.status !== "cancelled"
        ) {
          const rate = invoice.exchangeRate ?? 1;
          salesSubtotal += invoice.subtotal * rate;
          salesVAT += invoice.vatAmount * rate;
        }
      }

      let purchasesSubtotal = 0;
      let purchasesVAT = 0;
      for (const receipt of receipts) {
        if (receipt.posted) {
          const rate = receipt.exchangeRate ?? 1;
          purchasesSubtotal += (receipt.amount || 0) * rate;
          purchasesVAT += (receipt.vatAmount || 0) * rate;
        }
      }

      const billVatParams: string[] = [companyId];
      const billVatFilters: string[] = [];
      if (startDate) {
        billVatParams.push(startDate as string);
        billVatFilters.push(`bill_date >= $${billVatParams.length}::date`);
      }
      if (endDate) {
        billVatParams.push(endDate as string);
        billVatFilters.push(`bill_date <= $${billVatParams.length}::date`);
      }
      const billVatRes = await pool.query(
        `SELECT
           COALESCE(SUM(subtotal * COALESCE(exchange_rate, 1)), 0) AS subtotal,
           COALESCE(SUM(vat_amount * COALESCE(exchange_rate, 1)), 0) AS vat
         FROM vendor_bills
         WHERE company_id = $1
           AND status NOT IN ('void', 'cancelled', 'draft', 'pending', 'pending_approval')
           AND COALESCE(reverse_charge, false) = false
           ${billVatFilters.length ? `AND ${billVatFilters.join(" AND ")}` : ""}`,
        billVatParams
      );
      purchasesSubtotal += Number(billVatRes.rows[0]?.subtotal || 0);
      purchasesVAT += Number(billVatRes.rows[0]?.vat || 0);

      res.json({
        reportCurrency: "AED",
        period: "Current Period",
        salesSubtotal: round2(salesSubtotal),
        salesVAT: round2(salesVAT),
        purchasesSubtotal: round2(purchasesSubtotal),
        purchasesVAT: round2(purchasesVAT),
        netVATPayable: round2(salesVAT - purchasesVAT),
      });
    })
  );

  // =====================================
  // Legacy / Global Dashboard Routes
  // =====================================

  app.get(
    "/api/dashboard/stats",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const userId = (req as any).user?.id;
      const { companyId } = req.query;
      if (!companyId) {
        return res.json({
          revenue: 0,
          expenses: 0,
          outstanding: 0,
          totalInvoices: 0,
          totalEntries: 0,
          cashPosition: 0,
          monthlyBurnRate: 0,
          cashRunway: null,
          arAging: { current: 0, days1to30: 0, days31to60: 0, days61to90: 0, days90plus: 0 },
          apAging: { current: 0, days1to30: 0, days31to60: 0, days61to90: 0, days90plus: 0 },
          revenueGrowth: null,
          expenseGrowth: null,
          topExpenseCategories: [],
        });
      }
      const hasAccess = await storage.hasCompanyAccess(userId, companyId as string);
      if (!hasAccess) return res.status(403).json({ message: "Access denied" });
      res.json(await getEnhancedDashboardStats(companyId as string, req.query as Record<string, unknown>));
    })
  );

  app.get(
    "/api/dashboard/summary",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const userId = (req as any).user?.id;
      const { companyId } = req.query;
      if (!companyId) {
        return res.json({
          revenue: 0,
          expenses: 0,
          outstanding: 0,
          totalInvoices: 0,
          totalEntries: 0,
          cashPosition: 0,
          monthlyBurnRate: 0,
          cashRunway: null,
          arAging: { current: 0, days1to30: 0, days31to60: 0, days61to90: 0, days90plus: 0 },
          apAging: { current: 0, days1to30: 0, days31to60: 0, days61to90: 0, days90plus: 0 },
          revenueGrowth: null,
          expenseGrowth: null,
          topExpenseCategories: [],
        });
      }
      const hasAccess = await storage.hasCompanyAccess(userId, companyId as string);
      if (!hasAccess) return res.status(403).json({ message: "Access denied" });
      res.json(await getEnhancedDashboardStats(companyId as string, req.query as Record<string, unknown>));
    })
  );

  app.get(
    "/api/dashboard/recent-invoices",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const userId = (req as any).user?.id;
      const { companyId } = req.query;
      if (!companyId) return res.json([]);
      const hasAccess = await storage.hasCompanyAccess(userId, companyId as string);
      if (!hasAccess) return res.status(403).json({ message: "Access denied" });
      const invoices = await storage.getInvoicesByCompanyId(companyId as string);
      res.json(invoices.slice(0, 5));
    })
  );

  app.get(
    "/api/dashboard/expense-breakdown",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const userId = (req as any).user?.id;
      const { companyId } = req.query;
      if (!companyId) return res.json([]);
      const hasAccess = await storage.hasCompanyAccess(userId, companyId as string);
      if (!hasAccess) return res.status(403).json({ message: "Access denied" });

      const [accounts, allEntries, allLines] = await Promise.all([
        storage.getAccountsByCompanyId(companyId as string),
        storage.getJournalEntriesByCompanyId(companyId as string, { excludeClosing: true }),
        storage.getJournalLinesByCompanyId(companyId as string),
      ]);
      const postedEntryIds = new Set(
        allEntries.filter((e) => e.status === "posted").map((e) => e.id)
      );
      const expenseAccounts = new Map(
        accounts.filter((a) => a.type === "expense").map((a) => [a.id, a])
      );

      const balances = new Map<string, { name: string; value: number }>();
      for (const line of allLines) {
        if (!postedEntryIds.has(line.entryId)) continue;
        const account = expenseAccounts.get(line.accountId);
        if (!account) continue;
        const current = balances.get(account.id) || { name: account.nameEn, value: 0 };
        current.value += line.debit - line.credit;
        balances.set(account.id, current);
      }

      res.json(
        Array.from(balances.values())
          .filter((item) => item.value > 0)
          .sort((a, b) => b.value - a.value)
          .slice(0, 5)
          .map((item) => ({ ...item, value: round2(item.value) }))
      );
    })
  );
}
