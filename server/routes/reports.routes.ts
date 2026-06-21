import type { Express, Request, Response } from "express";
import { storage } from "../storage";
import { authMiddleware } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { db, pool } from "../db";
import { eq, and, gte, lte, inArray } from "drizzle-orm";
import {
  journalEntries,
  journalLines,
  accounts,
  invoices,
  invoiceLines,
  receipts,
} from "../../shared/schema";
import type { Account, JournalLine, Invoice, InvoiceLine, Receipt } from "../../shared/schema";
import { uaeDayStart, uaeDayEnd } from "../utils/date";
import { UAE_VAT_RATE } from "../constants";
import {
  buildReportCatalogDiscovery,
  isReportCatalogPersona,
} from "../services/report-catalog.service";

// Cash/bank account predicate — see dashboard.routes.ts for rationale.
function isCashOrBankAccount(a: {
  code?: string | null;
  nameEn: string;
  subType?: string | null;
}): boolean {
  if (a.subType === "cash" || a.subType === "bank") return true;
  const code = a.code ?? "";
  if (code >= "1010" && code <= "1039") return true;
  const name = a.nameEn.toLowerCase();
  return name.includes("cash") || name.includes("bank") || name.includes("petty");
}

/**
 * Register advanced report routes (cash flow, aging, period comparison).
 */
export function registerReportRoutes(app: Express) {
  app.get(
    "/api/reports/catalog",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const persona = req.query.persona;
      if (persona !== undefined && !isReportCatalogPersona(persona)) {
        return res
          .status(400)
          .json({ message: "persona must be owner, freelancer, or accountant" });
      }

      res.json(
        buildReportCatalogDiscovery({
          persona: isReportCatalogPersona(persona) ? persona : null,
        })
      );
    })
  );

  // =====================================
  // ADVANCED REPORTS
  // =====================================

  // Cash flow report - supports both path segment and query param for period
  app.get(
    "/api/reports/:companyId/cash-flow/:period?",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const userId = (req as any).user?.id;
      const { companyId, period: pathPeriod } = req.params;
      const period = pathPeriod || req.query.period || "quarter"; // Support path segment, query param, or default

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      // Cashflow must reflect only posted activity; drafts/voided entries
      // would otherwise distort inflow/outflow totals.
      const [journalEntriesRaw, accountsData] = await Promise.all([
        storage.getJournalEntriesByCompanyId(companyId),
        storage.getAccountsByCompanyId(companyId),
      ]);
      const journalEntriesData = journalEntriesRaw.filter((e) => e.status === "posted");
      // Pre-fetch lines for all posted entries in a single batch — the cash
      // flow report otherwise issues one round-trip per entry per period.
      const allLinesArr = await storage.getJournalLinesByEntryIds(
        journalEntriesData.map((e) => e.id)
      );
      const linesByEntryId = new Map<string, typeof allLinesArr>();
      for (const line of allLinesArr) {
        const list = linesByEntryId.get(line.entryId) ?? [];
        list.push(line);
        linesByEntryId.set(line.entryId, list);
      }

      // Cash flow must reflect actual movement of cash, not revenue/expense
      // recognition. Booking an unpaid sales invoice records revenue (and an
      // AR debit) but no cash has changed hands; the previous implementation
      // treated that as an "operating inflow", overstating cash flow on the
      // accrual side. We instead read movements on cash/bank accounts
      // directly: a debit to a cash account is an inflow, a credit is an
      // outflow. For each non-cash leg of the entry we classify by the
      // counterpart account type to bucket operating / investing / financing.
      const cashAccountIds = new Set(
        accountsData.filter((a) => a.type === "asset" && isCashOrBankAccount(a)).map((a) => a.id)
      );
      const accountById = new Map(accountsData.map((a) => [a.id, a]));

      const classifyCounterpart = (
        acct: Account | undefined
      ): "operating" | "investing" | "financing" => {
        if (!acct) return "operating";
        if (acct.type === "income" || acct.type === "expense") return "operating";
        // AR, AP, VAT, prepaid, inventory — working-capital changes are operating.
        if (acct.type === "asset" && acct.subType !== "fixed_asset") return "operating";
        if (acct.type === "liability" && acct.subType === "long_term_liability") return "financing";
        if (acct.type === "liability") return "operating";
        if (acct.type === "asset" && acct.subType === "fixed_asset") return "investing";
        if (acct.type === "equity") return "financing";
        return "operating";
      };

      // Build period buckets.
      const now = new Date();
      let startDate: Date;
      let periodLength: "month" | "quarter" | "year" = "quarter";

      switch (period) {
        case "month":
          startDate = new Date(now.getFullYear(), now.getMonth() - 6, 1);
          periodLength = "month";
          break;
        case "year":
          startDate = new Date(now.getFullYear() - 2, 0, 1);
          periodLength = "year";
          break;
        default:
          startDate = new Date(now.getFullYear() - 1, Math.floor(now.getMonth() / 3) * 3, 1);
          periodLength = "quarter";
      }

      // Establish opening cash balance: sum of all cash-account debits/credits
      // before the report window so the running balance is accurate, not
      // implicitly anchored at zero.
      let runningBalance = 0;
      {
        const priorEntries = journalEntriesData.filter((je) => new Date(je.date) < startDate);
        for (const entry of priorEntries) {
          const lines = linesByEntryId.get(entry.id) ?? [];
          for (const line of lines) {
            if (cashAccountIds.has(line.accountId)) {
              runningBalance += (line.debit || 0) - (line.credit || 0);
            }
          }
        }
      }

      const cashFlowData: any[] = [];
      const currentDate = new Date(startDate);

      while (currentDate <= now) {
        let periodEnd: Date;
        let periodLabel: string;

        if (periodLength === "month") {
          periodEnd = new Date(
            currentDate.getFullYear(),
            currentDate.getMonth() + 1,
            0,
            23,
            59,
            59,
            999
          );
          periodLabel = currentDate.toLocaleString("default", { month: "short", year: "2-digit" });
        } else if (periodLength === "quarter") {
          periodEnd = new Date(
            currentDate.getFullYear(),
            currentDate.getMonth() + 3,
            0,
            23,
            59,
            59,
            999
          );
          periodLabel = `Q${Math.floor(currentDate.getMonth() / 3) + 1} ${currentDate.getFullYear()}`;
        } else {
          periodEnd = new Date(currentDate.getFullYear(), 11, 31, 23, 59, 59, 999);
          periodLabel = currentDate.getFullYear().toString();
        }

        const periodEntries = journalEntriesData.filter((je) => {
          const jeDate = new Date(je.date);
          return jeDate >= currentDate && jeDate <= periodEnd;
        });

        let operatingInflow = 0;
        let operatingOutflow = 0;
        let investingInflow = 0;
        let investingOutflow = 0;
        let financingInflow = 0;
        let financingOutflow = 0;

        for (const entry of periodEntries) {
          const lines = linesByEntryId.get(entry.id) ?? [];
          const cashLines = lines.filter((l) => cashAccountIds.has(l.accountId));
          const nonCashLines = lines.filter((l) => !cashAccountIds.has(l.accountId));
          if (cashLines.length === 0) continue; // No cash movement — skip.

          // Classify the entry by its largest non-cash counterpart. Most
          // bookkeeping entries have a single non-cash leg, so the heuristic
          // is exact for them; for compound entries we attribute the entry's
          // net cash movement to the dominant counterpart category.
          type Category = ReturnType<typeof classifyCounterpart>;
          const categories: Category[] = ["operating", "investing", "financing"];
          const weightByCategory: Record<Category, number> = {
            operating: 0,
            investing: 0,
            financing: 0,
          };
          for (const l of nonCashLines) {
            const cat = classifyCounterpart(accountById.get(l.accountId));
            weightByCategory[cat] += Math.abs((l.debit || 0) - (l.credit || 0));
          }
          let dominant: Category = "operating";
          let dominantWeight = -1;
          for (const cat of categories) {
            if (weightByCategory[cat] > dominantWeight) {
              dominantWeight = weightByCategory[cat];
              dominant = cat;
            }
          }

          const inflow = cashLines.reduce((s, l) => s + (l.debit || 0), 0);
          const outflow = cashLines.reduce((s, l) => s + (l.credit || 0), 0);
          if (dominant === "investing") {
            investingInflow += inflow;
            investingOutflow += outflow;
          } else if (dominant === "financing") {
            financingInflow += inflow;
            financingOutflow += outflow;
          } else {
            operatingInflow += inflow;
            operatingOutflow += outflow;
          }
        }

        const netCashFlow =
          operatingInflow -
          operatingOutflow +
          (investingInflow - investingOutflow) +
          (financingInflow - financingOutflow);
        runningBalance += netCashFlow;

        cashFlowData.push({
          period: periodLabel,
          operatingInflow,
          operatingOutflow,
          investingInflow,
          investingOutflow,
          financingInflow,
          financingOutflow,
          netCashFlow,
          endingBalance: runningBalance,
        });

        if (periodLength === "month") {
          currentDate.setMonth(currentDate.getMonth() + 1);
        } else if (periodLength === "quarter") {
          currentDate.setMonth(currentDate.getMonth() + 3);
        } else {
          currentDate.setFullYear(currentDate.getFullYear() + 1);
        }
      }

      res.json(cashFlowData);
    })
  );

  // Aging report
  app.get(
    "/api/reports/:companyId/aging",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const userId = (req as any).user?.id;
      const { companyId } = req.params;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      const [receivableResult, payableResult] = await Promise.all([
        pool.query(
          `WITH payments AS (
            SELECT invoice_id, COALESCE(SUM(amount), 0) AS paid_amount
            FROM invoice_payments
            WHERE company_id = $1
            GROUP BY invoice_id
          ),
          open_invoices AS (
            SELECT
              COALESCE(NULLIF(TRIM(i.customer_name), ''), 'Unknown Customer') AS name,
              GREATEST(i.total - COALESCE(p.paid_amount, 0), 0)
                * COALESCE(NULLIF(i.exchange_rate, 0), 1) AS open_balance_aed,
              COALESCE(i.due_date, i.date + INTERVAL '30 days') AS due_date
            FROM invoices i
            LEFT JOIN payments p ON p.invoice_id = i.id
            WHERE i.company_id = $1
              AND i.status NOT IN ('paid', 'draft', 'void', 'cancelled')
              AND GREATEST(i.total - COALESCE(p.paid_amount, 0), 0) > 0
          )
          SELECT
            name,
            COALESCE(SUM(open_balance_aed) FILTER (WHERE due_date >= NOW()), 0)::float AS current_balance,
            COALESCE(SUM(open_balance_aed) FILTER (WHERE due_date < NOW() AND due_date >= NOW() - INTERVAL '30 days'), 0)::float AS days_30,
            COALESCE(SUM(open_balance_aed) FILTER (WHERE due_date < NOW() - INTERVAL '30 days' AND due_date >= NOW() - INTERVAL '60 days'), 0)::float AS days_60,
            COALESCE(SUM(open_balance_aed) FILTER (WHERE due_date < NOW() - INTERVAL '60 days' AND due_date >= NOW() - INTERVAL '90 days'), 0)::float AS days_90,
            COALESCE(SUM(open_balance_aed) FILTER (WHERE due_date < NOW() - INTERVAL '90 days'), 0)::float AS over_90,
            COALESCE(SUM(open_balance_aed), 0)::float AS total
          FROM open_invoices
          GROUP BY name
          ORDER BY total DESC, name ASC`,
          [companyId]
        ),
        pool.query(
          `WITH open_bills AS (
            SELECT
              COALESCE(NULLIF(TRIM(vendor_name), ''), 'Unknown Vendor') AS name,
              GREATEST(total_amount - COALESCE(amount_paid, 0), 0)
                * COALESCE(NULLIF(exchange_rate, 0), 1) AS open_balance_aed,
              due_date
            FROM vendor_bills
            WHERE company_id = $1
              AND COALESCE(status, 'pending') NOT IN ('paid', 'void', 'cancelled')
              AND GREATEST(total_amount - COALESCE(amount_paid, 0), 0) > 0
          )
          SELECT
            name,
            COALESCE(SUM(open_balance_aed) FILTER (WHERE due_date IS NULL OR due_date >= NOW()), 0)::float AS current_balance,
            COALESCE(SUM(open_balance_aed) FILTER (WHERE due_date < NOW() AND due_date >= NOW() - INTERVAL '30 days'), 0)::float AS days_30,
            COALESCE(SUM(open_balance_aed) FILTER (WHERE due_date < NOW() - INTERVAL '30 days' AND due_date >= NOW() - INTERVAL '60 days'), 0)::float AS days_60,
            COALESCE(SUM(open_balance_aed) FILTER (WHERE due_date < NOW() - INTERVAL '60 days' AND due_date >= NOW() - INTERVAL '90 days'), 0)::float AS days_90,
            COALESCE(SUM(open_balance_aed) FILTER (WHERE due_date < NOW() - INTERVAL '90 days'), 0)::float AS over_90,
            COALESCE(SUM(open_balance_aed), 0)::float AS total
          FROM open_bills
          GROUP BY name
          ORDER BY total DESC, name ASC`,
          [companyId]
        ),
      ]);

      const mapAgingRows = (rows: any[], type: "receivable" | "payable") =>
        rows.map((row) => ({
          id: `${type}:${row.name}`,
          name: row.name,
          type,
          current: Number(row.current_balance) || 0,
          days30: Number(row.days_30) || 0,
          days60: Number(row.days_60) || 0,
          days90: Number(row.days_90) || 0,
          over90: Number(row.over_90) || 0,
          total: Number(row.total) || 0,
          currency: "AED",
        }));

      res.json([
        ...mapAgingRows(receivableResult.rows, "receivable"),
        ...mapAgingRows(payableResult.rows, "payable"),
      ]);
    })
  );

  // Trial Balance report — all amounts in AED (base currency)
  // journal_lines.debit/credit are stored in AED; foreign currency
  // detail is in foreign_debit/foreign_credit/foreign_currency columns.
  app.get(
    "/api/companies/:id/reports/trial-balance",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const userId = (req as any).user?.id;
      const companyId = req.params.id;
      const { from, to } = req.query as { from?: string; to?: string };

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) return res.status(403).json({ message: "Access denied" });

      // Load all accounts for this company
      const companyAccounts = await db
        .select()
        .from(accounts)
        .where(eq(accounts.companyId, companyId));

      // Period filter for income/expense activity. Use UAE-day boundaries so
      // a transaction at, say, 23:00 UAE on Dec 31 is bucketed into Dec 31
      // rather than slipping into the next year via UTC conversion.
      const fromDate = from ? uaeDayStart(from) : undefined;
      const toDate = to ? uaeDayEnd(to) : undefined;

      // Period entries — used for income/expense balances which ARE
      // period-scoped (a P&L line in the trial balance reflects the
      // reporting period only).
      const periodCond = and(
        eq(journalEntries.companyId, companyId),
        eq(journalEntries.status, "posted"),
        fromDate ? gte(journalEntries.date, fromDate) : undefined,
        toDate ? lte(journalEntries.date, toDate) : undefined
      );

      const periodEntryRows: Array<{ id: string }> = await db
        .select({ id: journalEntries.id })
        .from(journalEntries)
        .where(periodCond);
      const periodEntryIds = periodEntryRows.map((e) => e.id);

      // Cumulative entries — used for asset/liability/equity (balance-sheet)
      // accounts. A trial balance for those carries the opening balance
      // through `to`, otherwise the trial balance won't tie to the balance
      // sheet and won't actually balance.
      const cumulativeCond = and(
        eq(journalEntries.companyId, companyId),
        eq(journalEntries.status, "posted"),
        toDate ? lte(journalEntries.date, toDate) : undefined
      );

      const cumulativeEntryRows: Array<{ id: string }> = await db
        .select({ id: journalEntries.id })
        .from(journalEntries)
        .where(cumulativeCond);
      const cumulativeEntryIds = cumulativeEntryRows.map((e) => e.id);

      const periodLines: JournalLine[] =
        periodEntryIds.length > 0
          ? await db
              .select()
              .from(journalLines)
              .where(inArray(journalLines.entryId, periodEntryIds))
          : [];

      const cumulativeLines: JournalLine[] =
        cumulativeEntryIds.length > 0
          ? await db
              .select()
              .from(journalLines)
              .where(inArray(journalLines.entryId, cumulativeEntryIds))
          : [];

      const periodTotals = new Map<
        string,
        { totalDebit: number; totalCredit: number; hasForeignLines: boolean }
      >();
      for (const line of periodLines) {
        const existing = periodTotals.get(line.accountId) ?? {
          totalDebit: 0,
          totalCredit: 0,
          hasForeignLines: false,
        };
        existing.totalDebit += line.debit ?? 0;
        existing.totalCredit += line.credit ?? 0;
        if (line.foreignCurrency) existing.hasForeignLines = true;
        periodTotals.set(line.accountId, existing);
      }

      const cumulativeTotals = new Map<
        string,
        { totalDebit: number; totalCredit: number; hasForeignLines: boolean }
      >();
      for (const line of cumulativeLines) {
        const existing = cumulativeTotals.get(line.accountId) ?? {
          totalDebit: 0,
          totalCredit: 0,
          hasForeignLines: false,
        };
        existing.totalDebit += line.debit ?? 0;
        existing.totalCredit += line.credit ?? 0;
        if (line.foreignCurrency) existing.hasForeignLines = true;
        cumulativeTotals.set(line.accountId, existing);
      }

      // Build result rows. For each account pick the correct slice:
      //  - Asset/Liability/Equity: cumulative through `to` (point-in-time)
      //  - Income/Expense: period activity only
      const rows = (companyAccounts as Account[])
        .sort((a: Account, b: Account) => (a.code ?? "").localeCompare(b.code ?? ""))
        .map((account: Account) => {
          const isBalanceSheet = ["asset", "liability", "equity"].includes(account.type);
          const { totalDebit, totalCredit, hasForeignLines } = (isBalanceSheet
            ? cumulativeTotals
            : periodTotals
          ).get(account.id) ?? { totalDebit: 0, totalCredit: 0, hasForeignLines: false };
          const balance = ["asset", "expense"].includes(account.type)
            ? totalDebit - totalCredit
            : totalCredit - totalDebit;
          return {
            accountId: account.id,
            accountName: account.nameEn,
            accountCode: account.code,
            accountType: account.type,
            totalDebit,
            totalCredit,
            balance,
            hasForeignLines,
          };
        });

      const sumDebits = rows.reduce((s: number, r) => s + r.totalDebit, 0);
      const sumCredits = rows.reduce((s: number, r) => s + r.totalCredit, 0);

      res.json({
        reportCurrency: "AED",
        rows,
        totals: {
          sumDebits,
          sumCredits,
          difference: Math.abs(sumDebits - sumCredits),
        },
      });
    })
  );

  // Current customer/vendor balance summaries. These are current open balances,
  // not historical as-of balances: vendor bills store only current amount_paid.
  app.get(
    "/api/companies/:id/reports/balance-summaries",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const userId = (req as any).user?.id;
      const companyId = req.params.id;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) return res.status(403).json({ message: "Access denied" });

      const [customerResult, vendorResult] = await Promise.all([
        pool.query(
          `WITH payments AS (
            SELECT invoice_id, COALESCE(SUM(amount), 0) AS paid_amount
            FROM invoice_payments
            WHERE company_id = $1
            GROUP BY invoice_id
          )
          SELECT
            i.customer_name,
            i.currency,
            COUNT(*)::int AS invoice_count,
            COALESCE(SUM(i.total), 0)::float AS total_invoiced,
            COALESCE(SUM(COALESCE(p.paid_amount, 0)), 0)::float AS paid_amount,
            COALESCE(SUM(GREATEST(i.total - COALESCE(p.paid_amount, 0), 0)), 0)::float AS open_balance,
            COALESCE(SUM(GREATEST(i.total - COALESCE(p.paid_amount, 0), 0) * COALESCE(NULLIF(i.exchange_rate, 0), 1)), 0)::float AS open_balance_aed,
            COALESCE(SUM(GREATEST(i.total - COALESCE(p.paid_amount, 0), 0)) FILTER (WHERE i.due_date < NOW()), 0)::float AS overdue_balance,
            COALESCE(SUM(GREATEST(i.total - COALESCE(p.paid_amount, 0), 0) * COALESCE(NULLIF(i.exchange_rate, 0), 1)) FILTER (WHERE i.due_date < NOW()), 0)::float AS overdue_balance_aed,
            MAX(CASE
              WHEN i.due_date < NOW()
                AND GREATEST(i.total - COALESCE(p.paid_amount, 0), 0) > 0
              THEN DATE_PART('day', NOW() - i.due_date)
              ELSE 0
            END)::int AS max_days_overdue
          FROM invoices i
          LEFT JOIN payments p ON p.invoice_id = i.id
          WHERE i.company_id = $1
            AND i.status NOT IN ('paid', 'draft', 'void', 'cancelled')
            AND GREATEST(i.total - COALESCE(p.paid_amount, 0), 0) > 0
          GROUP BY i.customer_name, i.currency
          ORDER BY open_balance DESC`,
          [companyId]
        ),
        pool.query(
          `SELECT
            vendor_name,
            currency,
            COUNT(*)::int AS bill_count,
            COALESCE(SUM(total_amount), 0)::float AS total_billed,
            COALESCE(SUM(amount_paid), 0)::float AS paid_amount,
            COALESCE(SUM(GREATEST(total_amount - amount_paid, 0)), 0)::float AS open_balance,
            COALESCE(SUM(GREATEST(total_amount - amount_paid, 0) * COALESCE(NULLIF(exchange_rate, 0), 1)), 0)::float AS open_balance_aed,
            COALESCE(SUM(GREATEST(total_amount - amount_paid, 0)) FILTER (WHERE due_date < NOW()), 0)::float AS overdue_balance,
            COALESCE(SUM(GREATEST(total_amount - amount_paid, 0) * COALESCE(NULLIF(exchange_rate, 0), 1)) FILTER (WHERE due_date < NOW()), 0)::float AS overdue_balance_aed,
            MAX(CASE
              WHEN due_date < NOW() AND GREATEST(total_amount - amount_paid, 0) > 0
              THEN DATE_PART('day', NOW() - due_date)
              ELSE 0
            END)::int AS max_days_overdue
          FROM vendor_bills
          WHERE company_id = $1
            AND status NOT IN ('paid')
            AND GREATEST(total_amount - amount_paid, 0) > 0
          GROUP BY vendor_name, currency
          ORDER BY open_balance DESC`,
          [companyId]
        ),
      ]);

      res.json({
        generatedAt: new Date().toISOString(),
        customers: customerResult.rows.map((row: any) => ({
          name: row.customer_name || "Unknown Customer",
          currency: row.currency || "AED",
          invoiceCount: Number(row.invoice_count) || 0,
          totalInvoiced: Number(row.total_invoiced) || 0,
          paidAmount: Number(row.paid_amount) || 0,
          openBalance: Number(row.open_balance) || 0,
          openBalanceAed: Number(row.open_balance_aed) || 0,
          overdueBalance: Number(row.overdue_balance) || 0,
          overdueBalanceAed: Number(row.overdue_balance_aed) || 0,
          maxDaysOverdue: Number(row.max_days_overdue) || 0,
        })),
        vendors: vendorResult.rows.map((row: any) => ({
          name: row.vendor_name || "Unknown Vendor",
          currency: row.currency || "AED",
          billCount: Number(row.bill_count) || 0,
          totalBilled: Number(row.total_billed) || 0,
          paidAmount: Number(row.paid_amount) || 0,
          openBalance: Number(row.open_balance) || 0,
          openBalanceAed: Number(row.open_balance_aed) || 0,
          overdueBalance: Number(row.overdue_balance) || 0,
          overdueBalanceAed: Number(row.overdue_balance_aed) || 0,
          maxDaysOverdue: Number(row.max_days_overdue) || 0,
        })),
      });
    })
  );

  // Sales by Product/Service report — groups issued invoice lines by line description.
  app.get(
    "/api/companies/:id/reports/sales-product-service",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const userId = (req as any).user?.id;
      const companyId = req.params.id;
      const { startDate, endDate, from, to } = req.query as {
        startDate?: string;
        endDate?: string;
        from?: string;
        to?: string;
      };

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) return res.status(403).json({ message: "Access denied" });

      const periodStart = startDate ?? from;
      const periodEnd = endDate ?? to;
      const fromDate = periodStart ? uaeDayStart(periodStart) : undefined;
      const toDate = periodEnd ? uaeDayEnd(periodEnd) : undefined;

      const invoiceRows: Invoice[] = (
        await db
          .select()
          .from(invoices)
          .where(
            and(
              eq(invoices.companyId, companyId),
              fromDate ? gte(invoices.date, fromDate) : undefined,
              toDate ? lte(invoices.date, toDate) : undefined
            )
          )
      ).filter(
        (invoice: Invoice) =>
          invoice.status !== "draft" && invoice.status !== "void" && invoice.status !== "cancelled"
      );

      const invoiceIds = invoiceRows.map((invoice) => invoice.id);
      const lineRows: InvoiceLine[] =
        invoiceIds.length > 0
          ? await db.select().from(invoiceLines).where(inArray(invoiceLines.invoiceId, invoiceIds))
          : [];
      const invoiceById = new Map(invoiceRows.map((invoice) => [invoice.id, invoice]));
      const groupedRows = new Map<
        string,
        {
          productService: string;
          invoiceIds: Set<string>;
          lineCount: number;
          quantity: number;
          amountAed: number;
          vatAed: number;
          supplyTypes: Set<string>;
        }
      >();

      for (const line of lineRows) {
        const invoice = invoiceById.get(line.invoiceId);
        if (!invoice) continue;

        const productService = line.description.trim().replace(/\s+/g, " ") || "Unlabeled item";
        const exchangeRate = Number(invoice.exchangeRate ?? 1);
        const rate = Number.isFinite(exchangeRate) && exchangeRate > 0 ? exchangeRate : 1;
        const quantity = Number(line.quantity ?? 0) || 0;
        const unitPrice = Number(line.unitPrice ?? 0) || 0;
        const vatRate = Number(line.vatRate ?? UAE_VAT_RATE) || 0;
        const amountAed = quantity * unitPrice * rate;
        const vatAed = amountAed * vatRate;
        const row = groupedRows.get(productService) ?? {
          productService,
          invoiceIds: new Set<string>(),
          lineCount: 0,
          quantity: 0,
          amountAed: 0,
          vatAed: 0,
          supplyTypes: new Set<string>(),
        };

        row.invoiceIds.add(line.invoiceId);
        row.lineCount += 1;
        row.quantity += quantity;
        row.amountAed += amountAed;
        row.vatAed += vatAed;
        row.supplyTypes.add(line.vatSupplyType ?? "standard_rated");
        groupedRows.set(productService, row);
      }

      const rows = Array.from(groupedRows.values())
        .map((row) => ({
          productService: row.productService,
          invoiceCount: row.invoiceIds.size,
          lineCount: row.lineCount,
          quantity: Math.round(row.quantity * 100) / 100,
          amountAed: Math.round(row.amountAed * 100) / 100,
          vatAed: Math.round(row.vatAed * 100) / 100,
          averageUnitPriceAed:
            row.quantity > 0 ? Math.round((row.amountAed / row.quantity) * 100) / 100 : 0,
          supplyTypes: Array.from(row.supplyTypes).sort(),
        }))
        .sort(
          (a, b) => b.amountAed - a.amountAed || a.productService.localeCompare(b.productService)
        );
      const totalAmountAed = rows.reduce((sum, row) => sum + row.amountAed, 0);

      res.json({
        period: {
          startDate: periodStart ?? null,
          endDate: periodEnd ?? null,
        },
        totals: {
          productServiceCount: rows.length,
          invoiceCount: invoiceRows.length,
          lineCount: lineRows.length,
          quantity: Math.round(rows.reduce((sum, row) => sum + row.quantity, 0) * 100) / 100,
          amountAed: Math.round(totalAmountAed * 100) / 100,
          vatAed: Math.round(rows.reduce((sum, row) => sum + row.vatAed, 0) * 100) / 100,
          topProductServiceShare:
            totalAmountAed > 0 && rows[0]
              ? Math.round((rows[0].amountAed / totalAmountAed) * 10000) / 100
              : 0,
        },
        rows,
      });
    })
  );

  // VAT Return report (UAE)
  app.get(
    "/api/companies/:id/reports/vat-return",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const userId = (req as any).user?.id;
      const companyId = req.params.id;
      const { from, to } = req.query as { from?: string; to?: string };

      if (!from || !to) {
        return res
          .status(400)
          .json({ message: "from and to date params are required (YYYY-MM-DD)" });
      }

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) return res.status(403).json({ message: "Access denied" });

      const fromDate = uaeDayStart(from);
      const toDate = uaeDayEnd(to);

      // Get all invoices in range — exclude drafts (not issued), voids, and
      // cancelled invoices so the VAT return only reports real supplies.
      const periodInvoices: Invoice[] = (
        await db
          .select()
          .from(invoices)
          .where(
            and(
              eq(invoices.companyId, companyId),
              gte(invoices.date, fromDate),
              lte(invoices.date, toDate)
            )
          )
      ).filter(
        (inv: Invoice) =>
          inv.status !== "draft" && inv.status !== "void" && inv.status !== "cancelled"
      );

      const invoiceIds = periodInvoices.map((i: Invoice) => i.id);

      const allLines: InvoiceLine[] =
        invoiceIds.length > 0
          ? await db.select().from(invoiceLines).where(inArray(invoiceLines.invoiceId, invoiceIds))
          : [];

      let standardRatedSupplies = 0;
      let zeroRatedSupplies = 0;
      let exemptSupplies = 0;

      // Build invoice lookup for exchange rates
      const invoiceRateMap = new Map<string, number>();
      for (const inv of periodInvoices) {
        invoiceRateMap.set(inv.id, inv.exchangeRate ?? 1);
      }

      for (const line of allLines) {
        // Convert line amounts to AED using the parent invoice's exchange rate
        const rate = invoiceRateMap.get(line.invoiceId) ?? 1;
        const lineTotal = line.quantity * line.unitPrice * rate;
        const supplyType = line.vatSupplyType ?? "standard_rated";
        if (supplyType === "zero_rated") {
          zeroRatedSupplies += lineTotal;
        } else if (supplyType === "exempt") {
          exemptSupplies += lineTotal;
        } else {
          // standard_rated and out_of_scope treated as standard for Box 1
          standardRatedSupplies += lineTotal;
        }
      }

      const outputVat = standardRatedSupplies * UAE_VAT_RATE;

      // Get expenses (receipts) in range with VAT.
      // Only posted receipts can be claimed for input VAT recovery.
      const periodReceipts: Receipt[] = (
        await db
          .select()
          .from(receipts)
          .where(
            and(
              eq(receipts.companyId, companyId),
              gte(receipts.date, fromDate),
              lte(receipts.date, toDate)
            )
          )
      ).filter((r: Receipt) => r.posted === true);

      const standardRatedExpenses = periodReceipts.reduce((s: number, r: Receipt) => {
        const rate = r.exchangeRate ?? 1;
        // receipts.amount is the net subtotal (excludes VAT); see convention
        // documented in receipts.routes.ts. Use it directly as the VAT base.
        return s + (r.amount ?? 0) * rate;
      }, 0);

      const inputVat = periodReceipts.reduce((s: number, r: Receipt) => {
        const rate = r.exchangeRate ?? 1;
        return s + (r.vatAmount ?? 0) * rate;
      }, 0);

      const billVatRes = await pool.query(
        `SELECT
           COALESCE(SUM(subtotal * COALESCE(exchange_rate, 1)), 0) AS subtotal,
           COALESCE(SUM(vat_amount * COALESCE(exchange_rate, 1)), 0) AS vat
         FROM vendor_bills
         WHERE company_id = $1
           AND bill_date >= $2::date
           AND bill_date <= $3::date
           AND status NOT IN ('void', 'cancelled', 'draft', 'pending')
           AND COALESCE(reverse_charge, false) = false`,
        [companyId, from, to]
      );
      const approvedBillExpenses = Number(billVatRes.rows[0]?.subtotal || 0);
      const approvedBillInputVat = Number(billVatRes.rows[0]?.vat || 0);

      const totalSupplies = standardRatedSupplies + zeroRatedSupplies + exemptSupplies;
      const totalStandardRatedExpenses = standardRatedExpenses + approvedBillExpenses;
      const totalInputVat = inputVat + approvedBillInputVat;
      const netVatDue = outputVat - totalInputVat;

      res.json({
        period: { from, to },
        box1_standardRatedSupplies: standardRatedSupplies,
        box2_zeroRatedSupplies: zeroRatedSupplies,
        box3_exemptSupplies: exemptSupplies,
        box4_totalSupplies: totalSupplies,
        box5_outputVat: outputVat,
        box6_standardRatedExpenses: totalStandardRatedExpenses,
        box7_inputVatRecoverable: totalInputVat,
        box8_netVatDue: netVatDue,
      });
    })
  );

  // Period comparison report - supports both path segment and query param for period
  app.get(
    "/api/reports/:companyId/comparison/:period?",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const userId = (req as any).user?.id;
      const { companyId, period: pathPeriod } = req.params;
      const period = pathPeriod || req.query.period || "quarter";

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      const invoices = await storage.getInvoicesByCompanyId(companyId);
      const receipts = await storage.getReceiptsByCompanyId(companyId);

      const now = new Date();
      let currentStart: Date, currentEnd: Date, previousStart: Date, previousEnd: Date;

      if (period === "month") {
        currentStart = new Date(now.getFullYear(), now.getMonth(), 1);
        currentEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
        previousStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        previousEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
      } else if (period === "year") {
        currentStart = new Date(now.getFullYear(), 0, 1);
        currentEnd = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);
        previousStart = new Date(now.getFullYear() - 1, 0, 1);
        previousEnd = new Date(now.getFullYear() - 1, 11, 31, 23, 59, 59, 999);
      } else {
        // quarter
        const currentQ = Math.floor(now.getMonth() / 3);
        currentStart = new Date(now.getFullYear(), currentQ * 3, 1);
        currentEnd = new Date(now.getFullYear(), (currentQ + 1) * 3, 0, 23, 59, 59, 999);
        previousStart = new Date(now.getFullYear(), (currentQ - 1) * 3, 1);
        previousEnd = new Date(now.getFullYear(), currentQ * 3, 0, 23, 59, 59, 999);
      }

      const excludedInvoiceStatuses = new Set(["draft", "void", "cancelled"]);
      const amountToAed = (amount: unknown, exchangeRate: unknown) =>
        (Number(amount) || 0) * (Number(exchangeRate) || 1);
      const currentInvoices = invoices.filter((inv) => {
        const d = new Date(inv.date);
        return (
          d >= currentStart && d <= currentEnd && !excludedInvoiceStatuses.has(inv.status ?? "")
        );
      });
      const previousInvoices = invoices.filter((inv) => {
        const d = new Date(inv.date);
        return (
          d >= previousStart && d <= previousEnd && !excludedInvoiceStatuses.has(inv.status ?? "")
        );
      });

      const currentReceipts = receipts.filter((rec) => {
        const d = new Date(rec.date || rec.createdAt);
        return d >= currentStart && d <= currentEnd;
      });
      const previousReceipts = receipts.filter((rec) => {
        const d = new Date(rec.date || rec.createdAt);
        return d >= previousStart && d <= previousEnd;
      });

      // Use subtotal/receipt amount (excl. VAT) to avoid inflating revenue or
      // expenses with collected/recoverable tax. Convert all values to AED for
      // like-for-like comparison.
      const currentRevenue = currentInvoices.reduce(
        (sum, inv) => sum + amountToAed(inv.subtotal, inv.exchangeRate),
        0
      );
      const previousRevenue = previousInvoices.reduce(
        (sum, inv) => sum + amountToAed(inv.subtotal, inv.exchangeRate),
        0
      );
      const currentExpenses = currentReceipts.reduce(
        (sum, rec) => sum + amountToAed(rec.amount, rec.exchangeRate),
        0
      );
      const previousExpenses = previousReceipts.reduce(
        (sum, rec) => sum + amountToAed(rec.amount, rec.exchangeRate),
        0
      );

      const comparison = [
        {
          metric: "Total Revenue",
          current: currentRevenue,
          previous: previousRevenue,
          change: currentRevenue - previousRevenue,
          changePercent: previousRevenue
            ? ((currentRevenue - previousRevenue) / previousRevenue) * 100
            : 0,
        },
        {
          metric: "Total Expenses",
          current: currentExpenses,
          previous: previousExpenses,
          change: currentExpenses - previousExpenses,
          changePercent: previousExpenses
            ? ((currentExpenses - previousExpenses) / previousExpenses) * 100
            : 0,
        },
        {
          metric: "Net Profit",
          current: currentRevenue - currentExpenses,
          previous: previousRevenue - previousExpenses,
          change: currentRevenue - currentExpenses - (previousRevenue - previousExpenses),
          changePercent:
            previousRevenue - previousExpenses
              ? ((currentRevenue - currentExpenses - (previousRevenue - previousExpenses)) /
                  Math.abs(previousRevenue - previousExpenses)) *
                100
              : 0,
        },
        {
          metric: "Invoice Count",
          current: currentInvoices.length,
          previous: previousInvoices.length,
          change: currentInvoices.length - previousInvoices.length,
          changePercent: previousInvoices.length
            ? ((currentInvoices.length - previousInvoices.length) / previousInvoices.length) * 100
            : 0,
        },
        {
          metric: "Avg Invoice Value",
          current: currentInvoices.length ? currentRevenue / currentInvoices.length : 0,
          previous: previousInvoices.length ? previousRevenue / previousInvoices.length : 0,
          change:
            (currentInvoices.length ? currentRevenue / currentInvoices.length : 0) -
            (previousInvoices.length ? previousRevenue / previousInvoices.length : 0),
          changePercent:
            previousInvoices.length && previousRevenue / previousInvoices.length
              ? (((currentInvoices.length ? currentRevenue / currentInvoices.length : 0) -
                  previousRevenue / previousInvoices.length) /
                  (previousRevenue / previousInvoices.length)) *
                100
              : 0,
        },
      ];

      res.json(comparison);
    })
  );
}
