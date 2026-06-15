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
  invoicePayments,
  receipts,
} from "../../shared/schema";
import type {
  Account,
  JournalEntry,
  JournalLine,
  Invoice,
  InvoiceLine,
  InvoicePayment,
  Receipt,
} from "../../shared/schema";
import { uaeDayStart, uaeDayEnd } from "../utils/date";
import { UAE_CT_EXEMPTION_THRESHOLD, UAE_VAT_RATE } from "../constants";
import {
  buildReportPackRunWorkbook,
  compatibleReportPackRecipientCount,
  getReportPackDeliveryHistory,
  getReportPackRunHistory,
  getReportPackSchedules,
  prepareReportPackSchedule,
  reportPackIds,
  reportPackScheduleSchema,
  saveReportPackSchedule,
  type ReportPackId,
} from "../services/report-pack-schedules.service";

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

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function signedAccountMovement(accountType: string, debit: number, credit: number): number {
  return ["asset", "expense"].includes(accountType) ? debit - credit : credit - debit;
}

function isReportableInvoice(inv: Invoice): boolean {
  return inv.status !== "draft" && inv.status !== "void" && inv.status !== "cancelled";
}

function invoiceOpenAmount(inv: Invoice, paidAmount: number): number {
  if (inv.status === "paid") return 0;
  return Math.max(0, (inv.total ?? 0) - paidAmount);
}

function reportWindow(
  from?: string,
  to?: string
): {
  fromDate?: Date;
  toDate: Date;
  previousFromDate?: Date;
  previousToDate?: Date;
} {
  const fromDate = from ? uaeDayStart(from) : undefined;
  const toDate = to ? uaeDayEnd(to) : new Date();
  if (!fromDate) return { fromDate, toDate };

  const periodMs = toDate.getTime() - fromDate.getTime();
  const previousToDate = new Date(fromDate.getTime() - 1);
  const previousFromDate = new Date(previousToDate.getTime() - periodMs);
  return { fromDate, toDate, previousFromDate, previousToDate };
}

function inWindow(date: Date, fromDate: Date | undefined, toDate: Date): boolean {
  return (!fromDate || date >= fromDate) && date <= toDate;
}

function percentChange(current: number, previous: number): number {
  if (!previous) return current ? 100 : 0;
  return ((current - previous) / Math.abs(previous)) * 100;
}

/**
 * Register advanced report routes (cash flow, aging, period comparison).
 */
export function registerReportRoutes(app: Express) {
  // =====================================
  // REPORT PACK SCHEDULES
  // =====================================

  app.get(
    "/api/companies/:id/report-pack-schedules",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const userId = (req as any).user?.id;
      const { id: companyId } = req.params;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      res.json(await getReportPackSchedules(companyId));
    })
  );

  app.get(
    "/api/companies/:id/report-pack-deliveries",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const userId = (req as any).user?.id;
      const { id: companyId } = req.params;
      const limit = Number(req.query.limit ?? 50);

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      res.json(await getReportPackDeliveryHistory(companyId, limit));
    })
  );

  app.get(
    "/api/companies/:id/report-pack-runs",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const userId = (req as any).user?.id;
      const { id: companyId } = req.params;
      const limit = Number(req.query.limit ?? 25);

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      res.json(await getReportPackRunHistory(companyId, limit));
    })
  );

  app.get(
    "/api/companies/:id/report-pack-runs/:runId/export",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const userId = (req as any).user?.id;
      const { id: companyId, runId } = req.params;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      const workbook = await buildReportPackRunWorkbook(companyId, runId);
      if (!workbook) {
        return res.status(404).json({ message: "Report pack run not found" });
      }

      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      res.setHeader("Content-Disposition", `attachment; filename="${workbook.filename}"`);
      res.send(workbook.buffer);
    })
  );

  app.put(
    "/api/companies/:id/report-pack-schedules/:packId",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const userId = (req as any).user?.id;
      const { id: companyId, packId } = req.params;

      if (!reportPackIds.includes(packId as ReportPackId)) {
        return res.status(404).json({ message: "Report pack not found" });
      }

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      const parsed = reportPackScheduleSchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ message: "Invalid report pack schedule", issues: parsed.error.issues });
      }

      if (parsed.data.enabled && parsed.data.recipients.length === 0) {
        return res
          .status(400)
          .json({ message: "At least one recipient is required to enable a schedule" });
      }

      if (
        parsed.data.enabled &&
        compatibleReportPackRecipientCount(parsed.data.channel, parsed.data.recipients) === 0
      ) {
        return res.status(400).json({
          message: "Add at least one recipient compatible with the selected delivery channel",
        });
      }

      res.json(await saveReportPackSchedule(companyId, packId as ReportPackId, parsed.data));
    })
  );

  app.post(
    "/api/companies/:id/report-pack-schedules/:packId/prepare",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const userId = (req as any).user?.id;
      const { id: companyId, packId } = req.params;

      if (!reportPackIds.includes(packId as ReportPackId)) {
        return res.status(404).json({ message: "Report pack not found" });
      }

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      res.json(await prepareReportPackSchedule(companyId, packId as ReportPackId, userId));
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

      const invoices = await storage.getInvoicesByCompanyId(companyId);
      const now = new Date();
      const agingData: any[] = [];

      // Group unpaid invoices by customer — exclude drafts (not yet billed),
      // voids, and cancelled invoices so aging only reflects real receivables.
      const unpaidInvoices = invoices.filter(
        (inv) =>
          inv.status !== "paid" &&
          inv.status !== "draft" &&
          inv.status !== "void" &&
          inv.status !== "cancelled"
      );
      const customerTotals: Record<string, any> = {};

      for (const inv of unpaidInvoices) {
        // Aging is measured from due date, not issue date — otherwise a
        // freshly-issued net-60 invoice would land in the 30+ bucket the day
        // after issuance. Default to issue date + 30 (net-30) when dueDate
        // is missing.
        const due = inv.dueDate
          ? new Date(inv.dueDate)
          : new Date(new Date(inv.date).getTime() + 30 * 86400000);
        const daysPastDue = Math.floor((now.getTime() - due.getTime()) / (1000 * 60 * 60 * 24));

        if (!customerTotals[inv.customerName]) {
          customerTotals[inv.customerName] = {
            id: inv.id,
            name: inv.customerName,
            type: "receivable",
            current: 0,
            days30: 0,
            days60: 0,
            days90: 0,
            over90: 0,
            total: 0,
          };
        }

        const customer = customerTotals[inv.customerName];
        customer.total += inv.total;

        if (daysPastDue <= 0) {
          customer.current += inv.total;
        } else if (daysPastDue <= 30) {
          customer.days30 += inv.total;
        } else if (daysPastDue <= 60) {
          customer.days60 += inv.total;
        } else if (daysPastDue <= 90) {
          customer.days90 += inv.total;
        } else {
          customer.over90 += inv.total;
        }
      }

      agingData.push(...Object.values(customerTotals));
      const billsResult = await pool.query(
        `SELECT
          id,
          vendor_name,
          due_date,
          total_amount,
          amount_paid
         FROM vendor_bills
         WHERE company_id = $1
           AND status NOT IN ('paid', 'cancelled')
           AND GREATEST(total_amount - amount_paid, 0) > 0`,
        [companyId]
      );
      const vendorTotals: Record<string, any> = {};

      for (const bill of billsResult.rows) {
        const vendorName = bill.vendor_name || "Unknown Vendor";
        const due = bill.due_date ? new Date(bill.due_date) : now;
        const daysPastDue = Math.floor((now.getTime() - due.getTime()) / (1000 * 60 * 60 * 24));
        const openAmount = Math.max(
          0,
          Number(bill.total_amount || 0) - Number(bill.amount_paid || 0)
        );

        if (!vendorTotals[vendorName]) {
          vendorTotals[vendorName] = {
            id: bill.id,
            name: vendorName,
            type: "payable",
            current: 0,
            days30: 0,
            days60: 0,
            days90: 0,
            over90: 0,
            total: 0,
          };
        }

        const vendor = vendorTotals[vendorName];
        vendor.total += openAmount;

        if (daysPastDue <= 0) {
          vendor.current += openAmount;
        } else if (daysPastDue <= 30) {
          vendor.days30 += openAmount;
        } else if (daysPastDue <= 60) {
          vendor.days60 += openAmount;
        } else if (daysPastDue <= 90) {
          vendor.days90 += openAmount;
        } else {
          vendor.over90 += openAmount;
        }
      }

      agingData.push(...Object.values(vendorTotals));
      res.json(agingData);
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

  // General Ledger report — posted journal lines by account with running balances.
  app.get(
    "/api/companies/:id/reports/general-ledger",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const userId = (req as any).user?.id;
      const companyId = req.params.id;
      const { from, to, accountId } = req.query as {
        from?: string;
        to?: string;
        accountId?: string;
      };

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) return res.status(403).json({ message: "Access denied" });

      const fromDate = from ? uaeDayStart(from) : undefined;
      const toDate = to ? uaeDayEnd(to) : undefined;

      const companyAccounts: Account[] = await db
        .select()
        .from(accounts)
        .where(eq(accounts.companyId, companyId));
      const accountById = new Map(companyAccounts.map((account: Account) => [account.id, account]));

      if (accountId && !accountById.has(accountId)) {
        return res.status(404).json({ message: "Account not found for this company" });
      }

      const selectedAccountIds = accountId
        ? new Set([accountId])
        : new Set(companyAccounts.map((account: Account) => account.id));

      const entryCond = and(
        eq(journalEntries.companyId, companyId),
        eq(journalEntries.status, "posted"),
        toDate ? lte(journalEntries.date, toDate) : undefined
      );

      const postedEntries: JournalEntry[] = await db.select().from(journalEntries).where(entryCond);
      const entryIds = postedEntries.map((entry: JournalEntry) => entry.id);
      const entryById = new Map(postedEntries.map((entry: JournalEntry) => [entry.id, entry]));

      const allLines: JournalLine[] =
        entryIds.length > 0
          ? await db.select().from(journalLines).where(inArray(journalLines.entryId, entryIds))
          : [];
      const reportLines = allLines.filter((line: JournalLine) =>
        selectedAccountIds.has(line.accountId)
      );

      const openingByAccount = new Map<string, number>();
      const periodTotalsByAccount = new Map<string, { debit: number; credit: number }>();
      const transactionsByAccount = new Map<
        string,
        Array<{
          lineId: string;
          entryId: string;
          entryNumber: string;
          date: Date;
          source: string;
          sourceId: string | null;
          memo: string | null;
          description: string | null;
          debit: number;
          credit: number;
          foreignCurrency: string | null;
          foreignDebit: number | null;
          foreignCredit: number | null;
          exchangeRate: number | null;
        }>
      >();

      for (const line of reportLines) {
        const entry = entryById.get(line.entryId);
        const account = accountById.get(line.accountId);
        if (!entry || !account) continue;

        const debit = line.debit ?? 0;
        const credit = line.credit ?? 0;
        const entryDate = new Date(entry.date);
        const movement = signedAccountMovement(account.type, debit, credit);

        if (fromDate && entryDate < fromDate) {
          openingByAccount.set(
            line.accountId,
            roundMoney((openingByAccount.get(line.accountId) ?? 0) + movement)
          );
          continue;
        }

        const totals = periodTotalsByAccount.get(line.accountId) ?? { debit: 0, credit: 0 };
        totals.debit += debit;
        totals.credit += credit;
        periodTotalsByAccount.set(line.accountId, totals);

        const accountTransactions = transactionsByAccount.get(line.accountId) ?? [];
        accountTransactions.push({
          lineId: line.id,
          entryId: entry.id,
          entryNumber: entry.entryNumber,
          date: entry.date,
          source: entry.source,
          sourceId: entry.sourceId ?? null,
          memo: entry.memo ?? null,
          description: line.description ?? null,
          debit,
          credit,
          foreignCurrency: line.foreignCurrency ?? null,
          foreignDebit: line.foreignDebit ?? null,
          foreignCredit: line.foreignCredit ?? null,
          exchangeRate: line.exchangeRate ?? null,
        });
        transactionsByAccount.set(line.accountId, accountTransactions);
      }

      const accountRows = companyAccounts
        .filter((account: Account) => selectedAccountIds.has(account.id))
        .sort((a: Account, b: Account) => (a.code ?? "").localeCompare(b.code ?? ""))
        .map((account: Account) => {
          const periodTotals = periodTotalsByAccount.get(account.id) ?? { debit: 0, credit: 0 };
          const openingBalance = openingByAccount.get(account.id) ?? 0;
          let runningBalance = openingBalance;
          const transactions = (transactionsByAccount.get(account.id) ?? [])
            .sort(
              (a, b) =>
                new Date(a.date).getTime() - new Date(b.date).getTime() ||
                a.entryNumber.localeCompare(b.entryNumber)
            )
            .map((transaction) => {
              runningBalance = roundMoney(
                runningBalance +
                  signedAccountMovement(account.type, transaction.debit, transaction.credit)
              );
              return { ...transaction, balance: runningBalance };
            });
          const closingBalance = roundMoney(
            openingBalance +
              signedAccountMovement(account.type, periodTotals.debit, periodTotals.credit)
          );

          return {
            accountId: account.id,
            accountCode: account.code,
            accountName: account.nameEn,
            accountType: account.type,
            openingBalance,
            periodDebit: roundMoney(periodTotals.debit),
            periodCredit: roundMoney(periodTotals.credit),
            closingBalance,
            transactionCount: transactions.length,
            transactions,
          };
        })
        .filter(
          (row) =>
            accountId ||
            row.transactionCount > 0 ||
            Math.abs(row.openingBalance) > 0.005 ||
            Math.abs(row.closingBalance) > 0.005
        );

      res.json({
        reportCurrency: "AED",
        period: { from: from ?? null, to: to ?? null },
        accounts: accountRows,
        totals: {
          totalDebits: roundMoney(
            accountRows.reduce((sum: number, row) => sum + row.periodDebit, 0)
          ),
          totalCredits: roundMoney(
            accountRows.reduce((sum: number, row) => sum + row.periodCredit, 0)
          ),
          accountCount: accountRows.length,
          transactionCount: accountRows.reduce((sum: number, row) => sum + row.transactionCount, 0),
        },
      });
    })
  );

  // Customer Balance Summary — invoice balances as of the selected end date.
  app.get(
    "/api/companies/:id/reports/customer-balances",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const userId = (req as any).user?.id;
      const companyId = req.params.id;
      const { from, to } = req.query as { from?: string; to?: string };

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) return res.status(403).json({ message: "Access denied" });

      const fromDate = from ? uaeDayStart(from) : undefined;
      const asOf = to ? uaeDayEnd(to) : new Date();

      const [companyInvoices, companyPayments]: [Invoice[], InvoicePayment[]] = await Promise.all([
        storage.getInvoicesByCompanyId(companyId),
        db
          .select()
          .from(invoicePayments)
          .where(and(eq(invoicePayments.companyId, companyId), lte(invoicePayments.date, asOf))),
      ]);

      const paymentsByInvoice = new Map<string, number>();
      const lastPaymentByInvoice = new Map<string, Date>();
      for (const payment of companyPayments) {
        paymentsByInvoice.set(
          payment.invoiceId,
          roundMoney((paymentsByInvoice.get(payment.invoiceId) ?? 0) + (payment.amount ?? 0))
        );
        const paymentDate = new Date(payment.date);
        const currentLast = lastPaymentByInvoice.get(payment.invoiceId);
        if (!currentLast || paymentDate > currentLast) {
          lastPaymentByInvoice.set(payment.invoiceId, paymentDate);
        }
      }

      const customerRows = new Map<
        string,
        {
          customerName: string;
          invoiceCount: number;
          openInvoiceCount: number;
          overdueInvoiceCount: number;
          totalInvoiced: number;
          paidAmount: number;
          openBalance: number;
          overdueBalance: number;
          currentBalance: number;
          lastInvoiceDate: Date | null;
          lastPaymentDate: Date | null;
          chaseSuggested: boolean;
        }
      >();

      for (const inv of companyInvoices.filter(isReportableInvoice)) {
        const invoiceDate = new Date(inv.date);
        if (invoiceDate > asOf) continue;

        const customerName = inv.customerName || "Unknown Customer";
        const row = customerRows.get(customerName) ?? {
          customerName,
          invoiceCount: 0,
          openInvoiceCount: 0,
          overdueInvoiceCount: 0,
          totalInvoiced: 0,
          paidAmount: 0,
          openBalance: 0,
          overdueBalance: 0,
          currentBalance: 0,
          lastInvoiceDate: null,
          lastPaymentDate: null,
          chaseSuggested: false,
        };

        const inSelectedPeriod = (!fromDate || invoiceDate >= fromDate) && invoiceDate <= asOf;
        const paidAmount = paymentsByInvoice.get(inv.id) ?? (inv.status === "paid" ? inv.total : 0);
        const openAmount = invoiceOpenAmount(inv, paidAmount);
        const dueDate = inv.dueDate
          ? new Date(inv.dueDate)
          : new Date(invoiceDate.getTime() + 30 * 86400000);
        const isOverdue = openAmount > 0 && dueDate < asOf;

        if (inSelectedPeriod) {
          row.invoiceCount += 1;
          row.totalInvoiced += inv.total ?? 0;
        }
        row.paidAmount += paidAmount;
        row.openBalance += openAmount;
        if (openAmount > 0) {
          row.openInvoiceCount += 1;
          if (isOverdue) {
            row.overdueInvoiceCount += 1;
            row.overdueBalance += openAmount;
            row.chaseSuggested = row.chaseSuggested || !inv.doNotChase;
          } else {
            row.currentBalance += openAmount;
          }
        }
        if (!row.lastInvoiceDate || invoiceDate > row.lastInvoiceDate)
          row.lastInvoiceDate = invoiceDate;
        const lastPayment = lastPaymentByInvoice.get(inv.id);
        if (lastPayment && (!row.lastPaymentDate || lastPayment > row.lastPaymentDate)) {
          row.lastPaymentDate = lastPayment;
        }

        customerRows.set(customerName, row);
      }

      const rows = Array.from(customerRows.values())
        .map((row) => ({
          ...row,
          totalInvoiced: roundMoney(row.totalInvoiced),
          paidAmount: roundMoney(row.paidAmount),
          openBalance: roundMoney(row.openBalance),
          overdueBalance: roundMoney(row.overdueBalance),
          currentBalance: roundMoney(row.currentBalance),
        }))
        .sort(
          (a, b) => b.openBalance - a.openBalance || a.customerName.localeCompare(b.customerName)
        );

      res.json({
        reportCurrency: "AED",
        period: { from: from ?? null, to: to ?? null, asOf: asOf.toISOString() },
        rows,
        totals: {
          customerCount: rows.length,
          invoiceCount: rows.reduce((sum: number, row) => sum + row.invoiceCount, 0),
          openInvoiceCount: rows.reduce((sum: number, row) => sum + row.openInvoiceCount, 0),
          overdueInvoiceCount: rows.reduce((sum: number, row) => sum + row.overdueInvoiceCount, 0),
          totalInvoiced: roundMoney(rows.reduce((sum: number, row) => sum + row.totalInvoiced, 0)),
          paidAmount: roundMoney(rows.reduce((sum: number, row) => sum + row.paidAmount, 0)),
          openBalance: roundMoney(rows.reduce((sum: number, row) => sum + row.openBalance, 0)),
          overdueBalance: roundMoney(
            rows.reduce((sum: number, row) => sum + row.overdueBalance, 0)
          ),
        },
      });
    })
  );

  // Vendor Balance Summary — vendor-bill balances as of the selected end date.
  app.get(
    "/api/companies/:id/reports/vendor-balances",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const userId = (req as any).user?.id;
      const companyId = req.params.id;
      const { from, to } = req.query as { from?: string; to?: string };

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) return res.status(403).json({ message: "Access denied" });

      const periodStart = from ? uaeDayStart(from) : new Date("1970-01-01T00:00:00.000Z");
      const asOf = to ? uaeDayEnd(to) : new Date();

      const result = await pool.query(
        `SELECT
        COALESCE(NULLIF(TRIM(vendor_name), ''), 'Unknown Vendor') AS vendor_name,
        COUNT(*) FILTER (WHERE bill_date >= $2 AND bill_date <= $3) AS bill_count,
        COALESCE(SUM(total_amount) FILTER (WHERE bill_date >= $2 AND bill_date <= $3), 0) AS total_billed,
        COALESCE(SUM(amount_paid), 0) AS paid_amount,
        COUNT(*) FILTER (WHERE status <> 'paid' AND GREATEST(total_amount - amount_paid, 0) > 0) AS open_bill_count,
        COUNT(*) FILTER (WHERE due_date < $3 AND status <> 'paid' AND GREATEST(total_amount - amount_paid, 0) > 0) AS overdue_bill_count,
        COALESCE(SUM(GREATEST(total_amount - amount_paid, 0)) FILTER (WHERE status <> 'paid'), 0) AS open_balance,
        COALESCE(SUM(GREATEST(total_amount - amount_paid, 0)) FILTER (
          WHERE due_date < $3 AND status <> 'paid'
        ), 0) AS overdue_balance,
        COALESCE(SUM(GREATEST(total_amount - amount_paid, 0)) FILTER (
          WHERE (due_date >= $3 OR due_date IS NULL) AND status <> 'paid'
        ), 0) AS current_balance,
        MAX(bill_date) AS last_bill_date,
        MIN(due_date) FILTER (WHERE due_date >= $3 AND status <> 'paid') AS next_due_date
      FROM vendor_bills
      WHERE company_id = $1
        AND bill_date <= $3
      GROUP BY COALESCE(NULLIF(TRIM(vendor_name), ''), 'Unknown Vendor')
      ORDER BY open_balance DESC, vendor_name ASC`,
        [companyId, periodStart.toISOString(), asOf.toISOString()]
      );

      type VendorBalanceRow = {
        vendorName: string;
        billCount: number;
        openBillCount: number;
        overdueBillCount: number;
        totalBilled: number;
        paidAmount: number;
        openBalance: number;
        overdueBalance: number;
        currentBalance: number;
        lastBillDate: Date | string | null;
        nextDueDate: Date | string | null;
        paymentSuggested: boolean;
      };

      const rows: VendorBalanceRow[] = result.rows.map((row: any) => ({
        vendorName: row.vendor_name,
        billCount: Number(row.bill_count) || 0,
        openBillCount: Number(row.open_bill_count) || 0,
        overdueBillCount: Number(row.overdue_bill_count) || 0,
        totalBilled: roundMoney(Number(row.total_billed) || 0),
        paidAmount: roundMoney(Number(row.paid_amount) || 0),
        openBalance: roundMoney(Number(row.open_balance) || 0),
        overdueBalance: roundMoney(Number(row.overdue_balance) || 0),
        currentBalance: roundMoney(Number(row.current_balance) || 0),
        lastBillDate: row.last_bill_date ?? null,
        nextDueDate: row.next_due_date ?? null,
        paymentSuggested: (Number(row.overdue_balance) || 0) > 0,
      }));

      res.json({
        reportCurrency: "AED",
        period: { from: from ?? null, to: to ?? null, asOf: asOf.toISOString() },
        rows,
        totals: {
          vendorCount: rows.length,
          billCount: rows.reduce((sum: number, row) => sum + row.billCount, 0),
          openBillCount: rows.reduce((sum: number, row) => sum + row.openBillCount, 0),
          overdueBillCount: rows.reduce((sum: number, row) => sum + row.overdueBillCount, 0),
          totalBilled: roundMoney(rows.reduce((sum: number, row) => sum + row.totalBilled, 0)),
          paidAmount: roundMoney(rows.reduce((sum: number, row) => sum + row.paidAmount, 0)),
          openBalance: roundMoney(rows.reduce((sum: number, row) => sum + row.openBalance, 0)),
          overdueBalance: roundMoney(
            rows.reduce((sum: number, row) => sum + row.overdueBalance, 0)
          ),
        },
      });
    })
  );

  // Revenue by Customer — current period with matching prior-period comparison.
  app.get(
    "/api/companies/:id/reports/revenue-by-customer",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const userId = (req as any).user?.id;
      const companyId = req.params.id;
      const { from, to } = req.query as { from?: string; to?: string };

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) return res.status(403).json({ message: "Access denied" });

      const window = reportWindow(from, to);
      const companyInvoices = (await storage.getInvoicesByCompanyId(companyId)).filter(
        isReportableInvoice
      );
      const rowsByCustomer = new Map<
        string,
        {
          customerName: string;
          invoiceCount: number;
          revenue: number;
          vatAmount: number;
          totalAmount: number;
          previousRevenue: number;
          lastInvoiceDate: Date | null;
        }
      >();

      for (const inv of companyInvoices) {
        const invoiceDate = new Date(inv.date);
        const customerName = inv.customerName || "Unknown Customer";
        const row = rowsByCustomer.get(customerName) ?? {
          customerName,
          invoiceCount: 0,
          revenue: 0,
          vatAmount: 0,
          totalAmount: 0,
          previousRevenue: 0,
          lastInvoiceDate: null,
        };
        const rate = inv.exchangeRate ?? 1;
        const revenue = (inv.subtotal ?? 0) * rate;

        if (inWindow(invoiceDate, window.fromDate, window.toDate)) {
          row.invoiceCount += 1;
          row.revenue += revenue;
          row.vatAmount += (inv.vatAmount ?? 0) * rate;
          row.totalAmount += (inv.total ?? 0) * rate;
          if (!row.lastInvoiceDate || invoiceDate > row.lastInvoiceDate)
            row.lastInvoiceDate = invoiceDate;
        } else if (
          window.previousFromDate &&
          window.previousToDate &&
          inWindow(invoiceDate, window.previousFromDate, window.previousToDate)
        ) {
          row.previousRevenue += revenue;
        }

        rowsByCustomer.set(customerName, row);
      }

      const currentRevenue = Array.from(rowsByCustomer.values()).reduce(
        (sum, row) => sum + row.revenue,
        0
      );
      const rows = Array.from(rowsByCustomer.values())
        .filter((row) => row.revenue > 0 || row.previousRevenue > 0)
        .map((row) => {
          const change = row.revenue - row.previousRevenue;
          const revenueShare = currentRevenue ? (row.revenue / currentRevenue) * 100 : 0;
          return {
            ...row,
            revenue: roundMoney(row.revenue),
            vatAmount: roundMoney(row.vatAmount),
            totalAmount: roundMoney(row.totalAmount),
            previousRevenue: roundMoney(row.previousRevenue),
            change: roundMoney(change),
            changePercent: percentChange(row.revenue, row.previousRevenue),
            averageInvoiceValue: row.invoiceCount ? roundMoney(row.revenue / row.invoiceCount) : 0,
            revenueShare,
            concentrationRisk: revenueShare >= 35,
          };
        })
        .sort((a, b) => b.revenue - a.revenue || a.customerName.localeCompare(b.customerName));

      res.json({
        reportCurrency: "AED",
        period: { from: from ?? null, to: to ?? null, asOf: window.toDate.toISOString() },
        rows,
        totals: {
          customerCount: rows.length,
          invoiceCount: rows.reduce((sum: number, row) => sum + row.invoiceCount, 0),
          revenue: roundMoney(rows.reduce((sum: number, row) => sum + row.revenue, 0)),
          previousRevenue: roundMoney(
            rows.reduce((sum: number, row) => sum + row.previousRevenue, 0)
          ),
          vatAmount: roundMoney(rows.reduce((sum: number, row) => sum + row.vatAmount, 0)),
          totalAmount: roundMoney(rows.reduce((sum: number, row) => sum + row.totalAmount, 0)),
        },
      });
    })
  );

  // Sales by Product/Service — invoice-line descriptions grouped as services.
  app.get(
    "/api/companies/:id/reports/sales-by-service",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const userId = (req as any).user?.id;
      const companyId = req.params.id;
      const { from, to } = req.query as { from?: string; to?: string };

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) return res.status(403).json({ message: "Access denied" });

      const window = reportWindow(from, to);
      const companyInvoices = (await storage.getInvoicesByCompanyId(companyId)).filter(
        isReportableInvoice
      );
      const relevantInvoices = companyInvoices.filter((inv) => {
        const date = new Date(inv.date);
        return (
          inWindow(date, window.fromDate, window.toDate) ||
          Boolean(
            window.previousFromDate &&
              window.previousToDate &&
              inWindow(date, window.previousFromDate, window.previousToDate)
          )
        );
      });
      const lines: InvoiceLine[] = relevantInvoices.length
        ? await db
            .select()
            .from(invoiceLines)
            .where(
              inArray(
                invoiceLines.invoiceId,
                relevantInvoices.map((inv) => inv.id)
              )
            )
        : [];
      const invoiceById = new Map(relevantInvoices.map((inv) => [inv.id, inv]));
      const rowsByService = new Map<
        string,
        {
          serviceName: string;
          quantity: number;
          lineCount: number;
          revenue: number;
          vatAmount: number;
          previousRevenue: number;
          lastSoldDate: Date | null;
        }
      >();

      for (const line of lines) {
        const inv = invoiceById.get(line.invoiceId);
        if (!inv) continue;
        const invoiceDate = new Date(inv.date);
        const serviceName = line.description?.trim() || "Unspecified Service";
        const row = rowsByService.get(serviceName) ?? {
          serviceName,
          quantity: 0,
          lineCount: 0,
          revenue: 0,
          vatAmount: 0,
          previousRevenue: 0,
          lastSoldDate: null,
        };
        const rate = inv.exchangeRate ?? 1;
        const lineRevenue = (line.quantity ?? 0) * (line.unitPrice ?? 0) * rate;
        const lineVat = lineRevenue * (line.vatRate ?? UAE_VAT_RATE);

        if (inWindow(invoiceDate, window.fromDate, window.toDate)) {
          row.quantity += line.quantity ?? 0;
          row.lineCount += 1;
          row.revenue += lineRevenue;
          row.vatAmount += lineVat;
          if (!row.lastSoldDate || invoiceDate > row.lastSoldDate) row.lastSoldDate = invoiceDate;
        } else if (
          window.previousFromDate &&
          window.previousToDate &&
          inWindow(invoiceDate, window.previousFromDate, window.previousToDate)
        ) {
          row.previousRevenue += lineRevenue;
        }

        rowsByService.set(serviceName, row);
      }

      const rows = Array.from(rowsByService.values())
        .filter((row) => row.revenue > 0 || row.previousRevenue > 0)
        .map((row) => ({
          ...row,
          quantity: roundMoney(row.quantity),
          revenue: roundMoney(row.revenue),
          vatAmount: roundMoney(row.vatAmount),
          previousRevenue: roundMoney(row.previousRevenue),
          change: roundMoney(row.revenue - row.previousRevenue),
          changePercent: percentChange(row.revenue, row.previousRevenue),
          averageUnitRevenue: row.quantity ? roundMoney(row.revenue / row.quantity) : 0,
          marginReviewSuggested:
            row.revenue > 0 && row.quantity > 0 && row.revenue / row.quantity < 100,
        }))
        .sort((a, b) => b.revenue - a.revenue || a.serviceName.localeCompare(b.serviceName));

      res.json({
        reportCurrency: "AED",
        period: { from: from ?? null, to: to ?? null, asOf: window.toDate.toISOString() },
        rows,
        totals: {
          serviceCount: rows.length,
          lineCount: rows.reduce((sum: number, row) => sum + row.lineCount, 0),
          quantity: roundMoney(rows.reduce((sum: number, row) => sum + row.quantity, 0)),
          revenue: roundMoney(rows.reduce((sum: number, row) => sum + row.revenue, 0)),
          previousRevenue: roundMoney(
            rows.reduce((sum: number, row) => sum + row.previousRevenue, 0)
          ),
          vatAmount: roundMoney(rows.reduce((sum: number, row) => sum + row.vatAmount, 0)),
        },
      });
    })
  );

  // Expenses by Vendor — posted receipt spend by merchant.
  app.get(
    "/api/companies/:id/reports/expenses-by-vendor",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const userId = (req as any).user?.id;
      const companyId = req.params.id;
      const { from, to } = req.query as { from?: string; to?: string };

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) return res.status(403).json({ message: "Access denied" });

      const window = reportWindow(from, to);
      const companyReceipts = (await storage.getReceiptsByCompanyId(companyId)).filter(
        (receipt) => receipt.posted
      );
      const rowsByVendor = new Map<
        string,
        {
          vendorName: string;
          receiptCount: number;
          expenseAmount: number;
          vatAmount: number;
          totalSpend: number;
          previousExpenseAmount: number;
          lastReceiptDate: Date | null;
        }
      >();

      for (const receipt of companyReceipts) {
        const receiptDate = new Date(receipt.date ?? receipt.createdAt);
        const vendorName = receipt.merchant?.trim() || "Unknown Vendor";
        const row = rowsByVendor.get(vendorName) ?? {
          vendorName,
          receiptCount: 0,
          expenseAmount: 0,
          vatAmount: 0,
          totalSpend: 0,
          previousExpenseAmount: 0,
          lastReceiptDate: null,
        };
        const rate = receipt.exchangeRate ?? 1;
        const expenseAmount = (receipt.amount ?? 0) * rate;
        const vatAmount = (receipt.vatAmount ?? 0) * rate;

        if (inWindow(receiptDate, window.fromDate, window.toDate)) {
          row.receiptCount += 1;
          row.expenseAmount += expenseAmount;
          row.vatAmount += vatAmount;
          row.totalSpend += expenseAmount + vatAmount;
          if (!row.lastReceiptDate || receiptDate > row.lastReceiptDate)
            row.lastReceiptDate = receiptDate;
        } else if (
          window.previousFromDate &&
          window.previousToDate &&
          inWindow(receiptDate, window.previousFromDate, window.previousToDate)
        ) {
          row.previousExpenseAmount += expenseAmount;
        }

        rowsByVendor.set(vendorName, row);
      }

      const rows = Array.from(rowsByVendor.values())
        .filter((row) => row.expenseAmount > 0 || row.previousExpenseAmount > 0)
        .map((row) => {
          const change = row.expenseAmount - row.previousExpenseAmount;
          const changePct = percentChange(row.expenseAmount, row.previousExpenseAmount);
          return {
            ...row,
            expenseAmount: roundMoney(row.expenseAmount),
            vatAmount: roundMoney(row.vatAmount),
            totalSpend: roundMoney(row.totalSpend),
            previousExpenseAmount: roundMoney(row.previousExpenseAmount),
            change: roundMoney(change),
            changePercent: changePct,
            averageReceiptValue: row.receiptCount
              ? roundMoney(row.expenseAmount / row.receiptCount)
              : 0,
            spendReviewSuggested: change > 1000 && changePct > 25,
          };
        })
        .sort(
          (a, b) => b.expenseAmount - a.expenseAmount || a.vendorName.localeCompare(b.vendorName)
        );

      res.json({
        reportCurrency: "AED",
        period: { from: from ?? null, to: to ?? null, asOf: window.toDate.toISOString() },
        rows,
        totals: {
          vendorCount: rows.length,
          receiptCount: rows.reduce((sum: number, row) => sum + row.receiptCount, 0),
          expenseAmount: roundMoney(rows.reduce((sum: number, row) => sum + row.expenseAmount, 0)),
          previousExpenseAmount: roundMoney(
            rows.reduce((sum: number, row) => sum + row.previousExpenseAmount, 0)
          ),
          vatAmount: roundMoney(rows.reduce((sum: number, row) => sum + row.vatAmount, 0)),
          totalSpend: roundMoney(rows.reduce((sum: number, row) => sum + row.totalSpend, 0)),
        },
      });
    })
  );

  // Expenses by Category — posted receipt spend by expense category.
  app.get(
    "/api/companies/:id/reports/expenses-by-category",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const userId = (req as any).user?.id;
      const companyId = req.params.id;
      const { from, to } = req.query as { from?: string; to?: string };

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) return res.status(403).json({ message: "Access denied" });

      const window = reportWindow(from, to);
      const companyReceipts = (await storage.getReceiptsByCompanyId(companyId)).filter(
        (receipt) => receipt.posted
      );
      const rowsByCategory = new Map<
        string,
        {
          categoryName: string;
          receiptCount: number;
          expenseAmount: number;
          vatAmount: number;
          totalSpend: number;
          previousExpenseAmount: number;
          lastReceiptDate: Date | null;
        }
      >();

      for (const receipt of companyReceipts) {
        const receiptDate = new Date(receipt.date ?? receipt.createdAt);
        const categoryName = receipt.category?.trim() || "Uncategorized";
        const row = rowsByCategory.get(categoryName) ?? {
          categoryName,
          receiptCount: 0,
          expenseAmount: 0,
          vatAmount: 0,
          totalSpend: 0,
          previousExpenseAmount: 0,
          lastReceiptDate: null,
        };
        const rate = receipt.exchangeRate ?? 1;
        const expenseAmount = (receipt.amount ?? 0) * rate;
        const vatAmount = (receipt.vatAmount ?? 0) * rate;

        if (inWindow(receiptDate, window.fromDate, window.toDate)) {
          row.receiptCount += 1;
          row.expenseAmount += expenseAmount;
          row.vatAmount += vatAmount;
          row.totalSpend += expenseAmount + vatAmount;
          if (!row.lastReceiptDate || receiptDate > row.lastReceiptDate)
            row.lastReceiptDate = receiptDate;
        } else if (
          window.previousFromDate &&
          window.previousToDate &&
          inWindow(receiptDate, window.previousFromDate, window.previousToDate)
        ) {
          row.previousExpenseAmount += expenseAmount;
        }

        rowsByCategory.set(categoryName, row);
      }

      const rows = Array.from(rowsByCategory.values())
        .filter((row) => row.expenseAmount > 0 || row.previousExpenseAmount > 0)
        .map((row) => {
          const change = row.expenseAmount - row.previousExpenseAmount;
          const changePct = percentChange(row.expenseAmount, row.previousExpenseAmount);
          return {
            ...row,
            expenseAmount: roundMoney(row.expenseAmount),
            vatAmount: roundMoney(row.vatAmount),
            totalSpend: roundMoney(row.totalSpend),
            previousExpenseAmount: roundMoney(row.previousExpenseAmount),
            change: roundMoney(change),
            changePercent: changePct,
            averageReceiptValue: row.receiptCount
              ? roundMoney(row.expenseAmount / row.receiptCount)
              : 0,
            budgetReviewSuggested: change > 1000 && changePct > 25,
          };
        })
        .sort(
          (a, b) =>
            b.expenseAmount - a.expenseAmount || a.categoryName.localeCompare(b.categoryName)
        );

      res.json({
        reportCurrency: "AED",
        period: { from: from ?? null, to: to ?? null, asOf: window.toDate.toISOString() },
        rows,
        totals: {
          categoryCount: rows.length,
          receiptCount: rows.reduce((sum: number, row) => sum + row.receiptCount, 0),
          expenseAmount: roundMoney(rows.reduce((sum: number, row) => sum + row.expenseAmount, 0)),
          previousExpenseAmount: roundMoney(
            rows.reduce((sum: number, row) => sum + row.previousExpenseAmount, 0)
          ),
          vatAmount: roundMoney(rows.reduce((sum: number, row) => sum + row.vatAmount, 0)),
          totalSpend: roundMoney(rows.reduce((sum: number, row) => sum + row.totalSpend, 0)),
        },
      });
    })
  );

  // Invoice Status — issued invoice mix, open balances, and reminder queue.
  app.get(
    "/api/companies/:id/reports/invoice-status",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const userId = (req as any).user?.id;
      const companyId = req.params.id;
      const { from, to } = req.query as { from?: string; to?: string };

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) return res.status(403).json({ message: "Access denied" });

      const window = reportWindow(from, to);
      const companyInvoices = (await storage.getInvoicesByCompanyId(companyId)).filter(
        isReportableInvoice
      );
      const companyPayments: InvoicePayment[] = await db
        .select()
        .from(invoicePayments)
        .where(
          and(eq(invoicePayments.companyId, companyId), lte(invoicePayments.date, window.toDate))
        );
      const paymentsByInvoice = new Map<string, number>();
      for (const payment of companyPayments) {
        paymentsByInvoice.set(
          payment.invoiceId,
          roundMoney((paymentsByInvoice.get(payment.invoiceId) ?? 0) + (payment.amount ?? 0))
        );
      }

      const rowsByStatus = new Map<
        string,
        {
          status: string;
          invoiceCount: number;
          subtotal: number;
          vatAmount: number;
          totalAmount: number;
          paidAmount: number;
          openBalance: number;
          overdueBalance: number;
          reminderQueue: number;
          previousTotalAmount: number;
        }
      >();

      const rowFor = (status: string) => {
        const key = status || "unknown";
        const existing = rowsByStatus.get(key);
        if (existing) return existing;
        const row = {
          status: key,
          invoiceCount: 0,
          subtotal: 0,
          vatAmount: 0,
          totalAmount: 0,
          paidAmount: 0,
          openBalance: 0,
          overdueBalance: 0,
          reminderQueue: 0,
          previousTotalAmount: 0,
        };
        rowsByStatus.set(key, row);
        return row;
      };

      for (const inv of companyInvoices) {
        const invoiceDate = new Date(inv.date);
        const paidAmount = paymentsByInvoice.get(inv.id) ?? (inv.status === "paid" ? inv.total : 0);
        const openAmount = invoiceOpenAmount(inv, paidAmount);
        const dueDate = inv.dueDate
          ? new Date(inv.dueDate)
          : new Date(invoiceDate.getTime() + 30 * 86400000);
        const isOverdue = openAmount > 0 && dueDate < window.toDate;
        const displayStatus = isOverdue ? "overdue" : inv.status;
        const row = rowFor(displayStatus);

        if (inWindow(invoiceDate, window.fromDate, window.toDate)) {
          const rate = inv.exchangeRate ?? 1;
          row.invoiceCount += 1;
          row.subtotal += (inv.subtotal ?? 0) * rate;
          row.vatAmount += (inv.vatAmount ?? 0) * rate;
          row.totalAmount += (inv.total ?? 0) * rate;
          row.paidAmount += paidAmount;
          row.openBalance += openAmount;
          if (isOverdue) {
            row.overdueBalance += openAmount;
            if (!inv.doNotChase) row.reminderQueue += 1;
          }
        } else if (
          window.previousFromDate &&
          window.previousToDate &&
          inWindow(invoiceDate, window.previousFromDate, window.previousToDate)
        ) {
          row.previousTotalAmount += (inv.total ?? 0) * (inv.exchangeRate ?? 1);
        }
      }

      const rows = Array.from(rowsByStatus.values())
        .filter((row) => row.invoiceCount > 0 || row.previousTotalAmount > 0)
        .map((row) => ({
          ...row,
          subtotal: roundMoney(row.subtotal),
          vatAmount: roundMoney(row.vatAmount),
          totalAmount: roundMoney(row.totalAmount),
          paidAmount: roundMoney(row.paidAmount),
          openBalance: roundMoney(row.openBalance),
          overdueBalance: roundMoney(row.overdueBalance),
          previousTotalAmount: roundMoney(row.previousTotalAmount),
          change: roundMoney(row.totalAmount - row.previousTotalAmount),
          changePercent: percentChange(row.totalAmount, row.previousTotalAmount),
        }))
        .sort((a, b) => b.openBalance - a.openBalance || b.totalAmount - a.totalAmount);

      res.json({
        reportCurrency: "AED",
        period: { from: from ?? null, to: to ?? null, asOf: window.toDate.toISOString() },
        rows,
        totals: {
          invoiceCount: rows.reduce((sum: number, row) => sum + row.invoiceCount, 0),
          subtotal: roundMoney(rows.reduce((sum: number, row) => sum + row.subtotal, 0)),
          vatAmount: roundMoney(rows.reduce((sum: number, row) => sum + row.vatAmount, 0)),
          totalAmount: roundMoney(rows.reduce((sum: number, row) => sum + row.totalAmount, 0)),
          paidAmount: roundMoney(rows.reduce((sum: number, row) => sum + row.paidAmount, 0)),
          openBalance: roundMoney(rows.reduce((sum: number, row) => sum + row.openBalance, 0)),
          overdueBalance: roundMoney(
            rows.reduce((sum: number, row) => sum + row.overdueBalance, 0)
          ),
          reminderQueue: rows.reduce((sum: number, row) => sum + row.reminderQueue, 0),
        },
      });
    })
  );

  // Budget vs Actual — best matching budget plan against posted actuals.
  app.get(
    "/api/companies/:id/reports/budget-vs-actual",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const userId = (req as any).user?.id;
      const companyId = req.params.id;
      const { from, to } = req.query as { from?: string; to?: string };

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) return res.status(403).json({ message: "Access denied" });

      const asOf = to ? uaeDayEnd(to) : new Date();
      const requestedStart = from
        ? uaeDayStart(from)
        : new Date(Date.UTC(asOf.getUTCFullYear(), 0, 1));

      const budgetResult = await pool.query(
        `SELECT *
         FROM budget_plans
         WHERE company_id = $1
           AND start_date <= $3
           AND end_date >= $2
         ORDER BY
           CASE status WHEN 'approved' THEN 0 WHEN 'draft' THEN 1 ELSE 2 END,
           end_date DESC,
           created_at DESC
         LIMIT 1`,
        [companyId, requestedStart.toISOString(), asOf.toISOString()]
      );

      if (budgetResult.rows.length === 0) {
        return res.json({
          reportCurrency: "AED",
          budgetAvailable: false,
          budget: null,
          period: { from: requestedStart.toISOString(), to: to ?? null, asOf: asOf.toISOString() },
          rows: [],
          totals: {
            lineCount: 0,
            budget: 0,
            actual: 0,
            variance: 0,
            variancePercent: 0,
            favorableCount: 0,
            unfavorableCount: 0,
            automationCount: 0,
            unmappedLineCount: 0,
          },
        });
      }

      const budget = budgetResult.rows[0];
      const budgetStart = new Date(budget.start_date);
      const budgetEnd = new Date(budget.end_date);
      const periodStart = requestedStart > budgetStart ? requestedStart : budgetStart;
      const periodEnd = asOf < budgetEnd ? asOf : budgetEnd;

      const budgetLinesResult = await pool.query(
        `SELECT * FROM budget_lines WHERE budget_id = $1 ORDER BY category, created_at`,
        [budget.id]
      );
      const budgetLines = budgetLinesResult.rows;

      const monthNames = [
        "jan",
        "feb",
        "mar",
        "apr",
        "may",
        "jun",
        "jul",
        "aug",
        "sep",
        "oct",
        "nov",
        "dec",
      ];
      const selectedMonthIndexes: number[] = [];
      const cursor = new Date(Date.UTC(periodStart.getUTCFullYear(), periodStart.getUTCMonth(), 1));
      const endMonth = new Date(Date.UTC(periodEnd.getUTCFullYear(), periodEnd.getUTCMonth(), 1));
      while (cursor <= endMonth) {
        selectedMonthIndexes.push(cursor.getUTCMonth());
        cursor.setUTCMonth(cursor.getUTCMonth() + 1);
      }

      const allAccounts = await storage.getAccountsByCompanyId(companyId);
      const accountMap = new Map(allAccounts.map((account) => [account.id, account]));
      const postedEntries = (await storage.getJournalEntriesByCompanyId(companyId)).filter(
        (entry) => {
          const entryDate = new Date(entry.date);
          return entry.status === "posted" && entryDate >= periodStart && entryDate <= periodEnd;
        }
      );
      const entryDateById = new Map(postedEntries.map((entry) => [entry.id, new Date(entry.date)]));
      const periodLines = postedEntries.length
        ? await storage.getJournalLinesByEntryIds(postedEntries.map((entry) => entry.id))
        : [];

      const actualsByAccount = new Map<string, number>();
      for (const line of periodLines) {
        const account = accountMap.get(line.accountId);
        const entryDate = entryDateById.get(line.entryId);
        if (!account || !entryDate) continue;

        const signedActual =
          account.type === "income"
            ? (line.credit || 0) - (line.debit || 0)
            : account.type === "expense"
              ? (line.debit || 0) - (line.credit || 0)
              : (line.debit || 0) - (line.credit || 0);
        actualsByAccount.set(
          line.accountId,
          (actualsByAccount.get(line.accountId) ?? 0) + signedActual
        );
      }

      type BudgetVsActualRow = {
        id: string;
        category: string | null;
        description: string | null;
        accountId: string | null;
        accountCode: string | null;
        accountName: string | null;
        accountType: string | null;
        monthCount: number;
        budget: number;
        actual: number;
        variance: number;
        variancePercent: number;
        varianceTone: "neutral" | "favorable" | "unfavorable";
        unfavorable: boolean;
        automationSuggested: boolean;
      };

      const rows: BudgetVsActualRow[] = budgetLines.map((line: any): BudgetVsActualRow => {
        const account = line.account_id ? accountMap.get(line.account_id) : undefined;
        const budgetAmount = selectedMonthIndexes.reduce(
          (sum, monthIndex) => sum + (Number(line[monthNames[monthIndex]]) || 0),
          0
        );
        const actualAmount = line.account_id
          ? Math.abs(actualsByAccount.get(line.account_id) ?? 0)
          : 0;
        const isIncome = account?.type === "income";
        const variance = isIncome ? actualAmount - budgetAmount : budgetAmount - actualAmount;
        const variancePercent = budgetAmount ? (variance / Math.abs(budgetAmount)) * 100 : 0;
        const unfavorable = isIncome ? actualAmount < budgetAmount : actualAmount > budgetAmount;
        const automationSuggested =
          unfavorable && (Math.abs(variance) >= 1000 || Math.abs(variancePercent) >= 10);

        return {
          id: line.id,
          category: line.category,
          description: line.description,
          accountId: line.account_id,
          accountCode: account?.code ?? null,
          accountName: account?.nameEn ?? null,
          accountType: account?.type ?? null,
          monthCount: selectedMonthIndexes.length,
          budget: roundMoney(budgetAmount),
          actual: roundMoney(actualAmount),
          variance: roundMoney(variance),
          variancePercent: Math.round(variancePercent * 10) / 10,
          varianceTone:
            Math.abs(variance) < 0.01 ? "neutral" : variance >= 0 ? "favorable" : "unfavorable",
          unfavorable,
          automationSuggested,
        };
      });

      const totalBudget = roundMoney(rows.reduce((sum: number, row) => sum + row.budget, 0));
      const totalActual = roundMoney(rows.reduce((sum: number, row) => sum + row.actual, 0));
      const totalVariance = roundMoney(rows.reduce((sum: number, row) => sum + row.variance, 0));

      res.json({
        reportCurrency: "AED",
        budgetAvailable: true,
        budget: {
          id: budget.id,
          name: budget.name,
          fiscalYear: budget.fiscal_year,
          startDate: budget.start_date,
          endDate: budget.end_date,
          status: budget.status,
        },
        period: { from: periodStart.toISOString(), to: to ?? null, asOf: periodEnd.toISOString() },
        rows,
        totals: {
          lineCount: rows.length,
          budget: totalBudget,
          actual: totalActual,
          variance: totalVariance,
          variancePercent: totalBudget
            ? Math.round((totalVariance / Math.abs(totalBudget)) * 1000) / 10
            : 0,
          favorableCount: rows.filter((row) => row.variance > 0).length,
          unfavorableCount: rows.filter((row) => row.unfavorable).length,
          automationCount: rows.filter((row) => row.automationSuggested).length,
          unmappedLineCount: rows.filter((row) => !row.accountId).length,
        },
      });
    })
  );

  // Payroll Summary - payroll run totals, prior-period comparison, and WPS/posting flags.
  app.get(
    "/api/companies/:id/reports/payroll-summary",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const userId = (req as any).user?.id;
      const companyId = req.params.id;
      const { from, to } = req.query as { from?: string; to?: string };

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) return res.status(403).json({ message: "Access denied" });

      const asOf = to ? uaeDayEnd(to) : new Date();
      const periodStart = from
        ? uaeDayStart(from)
        : new Date(Date.UTC(asOf.getUTCFullYear(), 0, 1));
      const periodDurationMs = Math.max(1, asOf.getTime() - periodStart.getTime());
      const previousEnd = new Date(periodStart.getTime() - 1);
      const previousStart = new Date(previousEnd.getTime() - periodDurationMs);

      type PayrollSummaryRow = {
        runId: string;
        periodMonth: number;
        periodYear: number;
        periodLabel: string;
        runDate: string | Date | null;
        employeeCount: number;
        totalBasic: number;
        totalAllowances: number;
        totalDeductions: number;
        totalNet: number;
        totalPensionEmployee: number;
        totalPensionEmployer: number;
        totalGratuityAccrual: number;
        totalEmployerCost: number;
        status: string;
        sifGenerated: boolean;
        wpsReady: boolean;
        journalEntryId: string | null;
        approvedAt: string | Date | null;
        needsApproval: boolean;
        sifSuggested: boolean;
        postingSuggested: boolean;
      };

      type PayrollSummaryNumericKey =
        | "employeeCount"
        | "totalBasic"
        | "totalAllowances"
        | "totalDeductions"
        | "totalNet"
        | "totalPensionEmployee"
        | "totalPensionEmployer"
        | "totalGratuityAccrual"
        | "totalEmployerCost";

      const loadRows = async (startDate: Date, endDate: Date): Promise<PayrollSummaryRow[]> => {
        const result = await pool.query(
          `SELECT
            id,
            period_month,
            period_year,
            run_date,
            total_basic,
            total_allowances,
            total_deductions,
            total_net,
            total_pension_employee,
            total_pension_employer,
            total_gratuity_accrual,
            employee_count,
            status,
            sif_file_content,
            journal_entry_id,
            approved_at,
            created_at
           FROM payroll_runs
           WHERE company_id = $1
             AND make_date(period_year, period_month, 1) >= date_trunc('month', $2::date)
             AND make_date(period_year, period_month, 1) <= date_trunc('month', $3::date)
           ORDER BY period_year DESC, period_month DESC`,
          [companyId, startDate.toISOString(), endDate.toISOString()]
        );

        return result.rows.map((row: any): PayrollSummaryRow => {
          const totalBasic = Number(row.total_basic) || 0;
          const totalAllowances = Number(row.total_allowances) || 0;
          const totalDeductions = Number(row.total_deductions) || 0;
          const totalNet = Number(row.total_net) || 0;
          const totalPensionEmployee = Number(row.total_pension_employee) || 0;
          const totalPensionEmployer = Number(row.total_pension_employer) || 0;
          const totalGratuityAccrual = Number(row.total_gratuity_accrual) || 0;
          const status = String(row.status || "draft");
          const sifGenerated = Boolean(row.sif_file_content);
          const wpsReady = ["calculated", "approved", "paid"].includes(status) && totalNet > 0;

          return {
            runId: row.id,
            periodMonth: Number(row.period_month),
            periodYear: Number(row.period_year),
            periodLabel: `${String(row.period_month).padStart(2, "0")}/${row.period_year}`,
            runDate: row.run_date,
            employeeCount: Number(row.employee_count) || 0,
            totalBasic: roundMoney(totalBasic),
            totalAllowances: roundMoney(totalAllowances),
            totalDeductions: roundMoney(totalDeductions),
            totalNet: roundMoney(totalNet),
            totalPensionEmployee: roundMoney(totalPensionEmployee),
            totalPensionEmployer: roundMoney(totalPensionEmployer),
            totalGratuityAccrual: roundMoney(totalGratuityAccrual),
            totalEmployerCost: roundMoney(totalNet + totalPensionEmployer + totalGratuityAccrual),
            status,
            sifGenerated,
            wpsReady,
            journalEntryId: row.journal_entry_id,
            approvedAt: row.approved_at,
            needsApproval: status === "draft" || status === "calculated",
            sifSuggested: wpsReady && !sifGenerated,
            postingSuggested: status === "approved" && !row.journal_entry_id,
          };
        });
      };

      const [rows, previousRows] = await Promise.all([
        loadRows(periodStart, asOf),
        loadRows(previousStart, previousEnd),
      ]);

      const totalFor = (items: PayrollSummaryRow[], key: PayrollSummaryNumericKey) =>
        roundMoney(items.reduce((sum, row) => sum + Number(row[key] ?? 0), 0));
      const totalNet = totalFor(rows, "totalNet");
      const previousTotalNet = totalFor(previousRows, "totalNet");

      res.json({
        reportCurrency: "AED",
        period: {
          from: periodStart.toISOString(),
          to: to ?? null,
          asOf: asOf.toISOString(),
          previousFrom: previousStart.toISOString(),
          previousTo: previousEnd.toISOString(),
        },
        rows,
        totals: {
          runCount: rows.length,
          employeeCount: rows.reduce((sum, row) => sum + row.employeeCount, 0),
          totalBasic: totalFor(rows, "totalBasic"),
          totalAllowances: totalFor(rows, "totalAllowances"),
          totalDeductions: totalFor(rows, "totalDeductions"),
          totalNet,
          totalPensionEmployee: totalFor(rows, "totalPensionEmployee"),
          totalPensionEmployer: totalFor(rows, "totalPensionEmployer"),
          totalGratuityAccrual: totalFor(rows, "totalGratuityAccrual"),
          totalEmployerCost: totalFor(rows, "totalEmployerCost"),
          approvedRunCount: rows.filter((row) => row.status === "approved" || row.status === "paid")
            .length,
          pendingApprovalCount: rows.filter((row) => row.needsApproval).length,
          sifGeneratedCount: rows.filter((row) => row.sifGenerated).length,
          sifPendingCount: rows.filter((row) => row.sifSuggested).length,
          journalMissingCount: rows.filter((row) => row.postingSuggested).length,
          previousTotalNet,
          netChange: roundMoney(totalNet - previousTotalNet),
          netChangePercent: percentChange(totalNet, previousTotalNet),
        },
      });
    })
  );

  // Corporate Tax Estimate — UAE 9% estimate from posted income/expense activity.
  app.get(
    "/api/companies/:id/reports/corporate-tax-estimate",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const userId = (req as any).user?.id;
      const companyId = req.params.id;
      const { from, to } = req.query as { from?: string; to?: string };

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) return res.status(403).json({ message: "Access denied" });

      const asOf = to ? uaeDayEnd(to) : new Date();
      const periodStart = from
        ? uaeDayStart(from)
        : new Date(Date.UTC(asOf.getUTCFullYear(), 0, 1));
      const allAccounts = await storage.getAccountsByCompanyId(companyId);
      const accountMap = new Map(allAccounts.map((account) => [account.id, account]));
      const postedEntries = (await storage.getJournalEntriesByCompanyId(companyId)).filter(
        (entry) =>
          entry.status === "posted" &&
          new Date(entry.date) >= periodStart &&
          new Date(entry.date) <= asOf
      );
      const lines = await storage.getJournalLinesByEntryIds(postedEntries.map((entry) => entry.id));

      let totalRevenue = 0;
      let totalExpenses = 0;
      const rowsByType = new Map<
        string,
        { type: string; amount: number; accountCount: Set<string> }
      >();

      for (const line of lines) {
        const account = accountMap.get(line.accountId);
        if (!account) continue;
        if (account.type !== "income" && account.type !== "expense") continue;

        const amount =
          account.type === "income"
            ? (line.credit || 0) - (line.debit || 0)
            : (line.debit || 0) - (line.credit || 0);
        if (account.type === "income") totalRevenue += amount;
        if (account.type === "expense") totalExpenses += amount;

        const row = rowsByType.get(account.type) ?? {
          type: account.type,
          amount: 0,
          accountCount: new Set<string>(),
        };
        row.amount += amount;
        row.accountCount.add(account.id);
        rowsByType.set(account.type, row);
      }

      totalRevenue = Math.max(0, totalRevenue);
      totalExpenses = Math.max(0, totalExpenses);
      const taxableIncome = totalRevenue - totalExpenses;
      const exemptionThreshold = UAE_CT_EXEMPTION_THRESHOLD;
      const taxableAmount = Math.max(0, taxableIncome - exemptionThreshold);
      const taxRate = 0.09;
      const taxPayable = taxableAmount * taxRate;

      res.json({
        reportCurrency: "AED",
        period: { from: periodStart.toISOString(), to: to ?? null, asOf: asOf.toISOString() },
        rows: Array.from(rowsByType.values()).map((row) => ({
          type: row.type,
          accountCount: row.accountCount.size,
          amount: roundMoney(Math.max(0, row.amount)),
        })),
        totals: {
          totalRevenue: roundMoney(totalRevenue),
          totalExpenses: roundMoney(totalExpenses),
          taxableIncome: roundMoney(taxableIncome),
          exemptionThreshold,
          taxableAmount: roundMoney(taxableAmount),
          taxRate,
          taxPayable: roundMoney(taxPayable),
          journalEntriesProcessed: postedEntries.length,
          filingReviewSuggested: taxPayable > 0 || taxableIncome > exemptionThreshold * 0.8,
        },
      });
    })
  );

  // Fixed Asset Register — asset carrying values as of the selected end date.
  app.get(
    "/api/companies/:id/reports/fixed-asset-register",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const userId = (req as any).user?.id;
      const companyId = req.params.id;
      const { to } = req.query as { to?: string };

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) return res.status(403).json({ message: "Access denied" });

      const exists = await pool.query(
        `SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'fixed_assets') AS exists`
      );
      if (!exists.rows[0]?.exists) {
        return res.json({
          reportCurrency: "AED",
          tableAvailable: false,
          period: { asOf: (to ? uaeDayEnd(to) : new Date()).toISOString() },
          rows: [],
          totals: {
            assetCount: 0,
            purchaseCost: 0,
            accumulatedDepreciation: 0,
            netBookValue: 0,
            capitalizationQueue: 0,
          },
        });
      }

      const asOf = to ? uaeDayEnd(to) : new Date();
      const result = await pool.query(
        `SELECT *
       FROM fixed_assets
       WHERE company_id = $1
         AND purchase_date <= $2
       ORDER BY category ASC, asset_name ASC`,
        [companyId, asOf.toISOString()]
      );

      type FixedAssetRegisterRow = {
        assetId: string;
        assetName: string;
        assetNumber: string | null;
        category: string | null;
        status: string | null;
        purchaseDate: Date | string;
        purchaseCost: number;
        salvageValue: number;
        usefulLifeYears: number | null;
        depreciationMethod: string | null;
        accumulatedDepreciation: number;
        netBookValue: number;
        location: string | null;
        needsCapitalizationJe: boolean;
      };

      const rows: FixedAssetRegisterRow[] = result.rows.map((asset: any) => ({
        assetId: asset.id,
        assetName: asset.asset_name,
        assetNumber: asset.asset_number,
        category: asset.category,
        status: asset.status,
        purchaseDate: asset.purchase_date,
        purchaseCost: roundMoney(Number(asset.purchase_cost) || 0),
        salvageValue: roundMoney(Number(asset.salvage_value) || 0),
        usefulLifeYears: asset.useful_life_years === null ? null : Number(asset.useful_life_years),
        depreciationMethod: asset.depreciation_method,
        accumulatedDepreciation: roundMoney(Number(asset.accumulated_depreciation) || 0),
        netBookValue: roundMoney(Number(asset.net_book_value) || 0),
        location: asset.location,
        needsCapitalizationJe: Boolean(asset.needs_capitalization_je),
      }));

      res.json({
        reportCurrency: "AED",
        tableAvailable: true,
        period: { asOf: asOf.toISOString() },
        rows,
        totals: {
          assetCount: rows.length,
          purchaseCost: roundMoney(rows.reduce((sum: number, row) => sum + row.purchaseCost, 0)),
          accumulatedDepreciation: roundMoney(
            rows.reduce((sum: number, row) => sum + row.accumulatedDepreciation, 0)
          ),
          netBookValue: roundMoney(rows.reduce((sum: number, row) => sum + row.netBookValue, 0)),
          capitalizationQueue: rows.filter((row) => row.needsCapitalizationJe).length,
        },
      });
    })
  );

  // Depreciation Schedule — posted depreciation rows by period.
  app.get(
    "/api/companies/:id/reports/depreciation-schedule",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const userId = (req as any).user?.id;
      const companyId = req.params.id;
      const { from, to } = req.query as { from?: string; to?: string };

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) return res.status(403).json({ message: "Access denied" });

      const exists = await pool.query(
        `SELECT
        EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'fixed_assets') AS assets_exists,
        EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'depreciation_schedules') AS schedules_exists`
      );
      const asOf = to ? uaeDayEnd(to) : new Date();
      const periodStart = from
        ? uaeDayStart(from)
        : new Date(Date.UTC(asOf.getUTCFullYear(), 0, 1));
      if (!exists.rows[0]?.assets_exists || !exists.rows[0]?.schedules_exists) {
        return res.json({
          reportCurrency: "AED",
          tableAvailable: false,
          period: { from: periodStart.toISOString(), to: to ?? null, asOf: asOf.toISOString() },
          rows: [],
          totals: {
            scheduleCount: 0,
            postedCount: 0,
            unpostedCount: 0,
            depreciationAmount: 0,
            postingQueue: 0,
          },
        });
      }

      const result = await pool.query(
        `SELECT
        ds.id,
        ds.asset_id,
        ds.period_year,
        ds.period_month,
        ds.amount,
        ds.journal_entry_id,
        fa.asset_name,
        fa.asset_number,
        fa.category
       FROM depreciation_schedules ds
       JOIN fixed_assets fa ON fa.id = ds.asset_id
       WHERE ds.company_id = $1
         AND make_date(ds.period_year, ds.period_month, 1) >= date_trunc('month', $2::date)
         AND make_date(ds.period_year, ds.period_month, 1) <= date_trunc('month', $3::date)
       ORDER BY ds.period_year DESC, ds.period_month DESC, fa.asset_name ASC`,
        [companyId, periodStart.toISOString(), asOf.toISOString()]
      );

      type DepreciationScheduleRow = {
        scheduleId: string;
        assetId: string;
        assetName: string;
        assetNumber: string | null;
        category: string | null;
        periodYear: number;
        periodMonth: number;
        periodLabel: string;
        amount: number;
        journalEntryId: string | null;
        posted: boolean;
      };

      const rows: DepreciationScheduleRow[] = result.rows.map((row: any) => ({
        scheduleId: row.id,
        assetId: row.asset_id,
        assetName: row.asset_name,
        assetNumber: row.asset_number,
        category: row.category,
        periodYear: Number(row.period_year),
        periodMonth: Number(row.period_month),
        periodLabel: `${String(row.period_month).padStart(2, "0")}/${row.period_year}`,
        amount: roundMoney(Number(row.amount) || 0),
        journalEntryId: row.journal_entry_id,
        posted: Boolean(row.journal_entry_id),
      }));

      res.json({
        reportCurrency: "AED",
        tableAvailable: true,
        period: { from: periodStart.toISOString(), to: to ?? null, asOf: asOf.toISOString() },
        rows,
        totals: {
          scheduleCount: rows.length,
          postedCount: rows.filter((row) => row.posted).length,
          unpostedCount: rows.filter((row) => !row.posted).length,
          depreciationAmount: roundMoney(rows.reduce((sum: number, row) => sum + row.amount, 0)),
          postingQueue: rows.filter((row) => !row.posted).length,
        },
      });
    })
  );

  // Inventory Valuation — stock on hand, carrying value, retail value, and reorder flags.
  app.get(
    "/api/companies/:id/reports/inventory-valuation",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const userId = (req as any).user?.id;
      const companyId = req.params.id;
      const { to } = req.query as { to?: string };

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) return res.status(403).json({ message: "Access denied" });

      const asOf = to ? uaeDayEnd(to) : new Date();
      const [productsList, movements] = await Promise.all([
        storage.getProductsByCompanyId(companyId),
        storage.getInventoryMovementsByCompanyId(companyId),
      ]);

      const movementDelta = (movement: { type: string; quantity: number }): number => {
        const quantity = Number(movement.quantity) || 0;
        if (movement.type === "purchase" || movement.type === "return") return Math.abs(quantity);
        if (movement.type === "sale") return -Math.abs(quantity);
        return quantity;
      };

      const movementsByProduct = new Map<string, typeof movements>();
      for (const movement of movements) {
        const productMovements = movementsByProduct.get(movement.productId) ?? [];
        productMovements.push(movement);
        movementsByProduct.set(movement.productId, productMovements);
      }

      type InventoryValuationRow = {
        productId: string;
        productName: string;
        sku: string | null;
        unit: string;
        stockOnHand: number;
        unitCost: number;
        unitPrice: number;
        inventoryValue: number;
        retailValue: number;
        grossMarginValue: number;
        grossMarginPercent: number;
        lowStockThreshold: number;
        lowStock: boolean;
        negativeStock: boolean;
        reorderSuggested: boolean;
        movementCount: number;
        lastMovementAt: Date | string | null;
      };

      const rows: InventoryValuationRow[] = productsList
        .filter((product) => product.isActive)
        .map((product) => {
          const productMovements = movementsByProduct.get(product.id) ?? [];
          const movementsAfterAsOf = productMovements.filter(
            (movement) => new Date(movement.createdAt) > asOf
          );
          const currentStock = Number(product.currentStock) || 0;
          const stockOnHand =
            currentStock -
            movementsAfterAsOf.reduce((sum, movement) => sum + movementDelta(movement), 0);
          const costedMovements = productMovements.filter((movement) => {
            const unitCost = Number(movement.unitCost) || 0;
            const quantity = Math.abs(Number(movement.quantity) || 0);
            return new Date(movement.createdAt) <= asOf && unitCost > 0 && quantity > 0;
          });
          const weightedCostQuantity = costedMovements.reduce(
            (sum, movement) => sum + Math.abs(Number(movement.quantity) || 0),
            0
          );
          const weightedCost = weightedCostQuantity
            ? costedMovements.reduce(
                (sum, movement) =>
                  sum + Math.abs(Number(movement.quantity) || 0) * (Number(movement.unitCost) || 0),
                0
              ) / weightedCostQuantity
            : 0;
          const unitCost = Number(product.costPrice) > 0 ? Number(product.costPrice) : weightedCost;
          const unitPrice = Number(product.unitPrice) || 0;
          const inventoryValue = stockOnHand * unitCost;
          const retailValue = stockOnHand * unitPrice;
          const grossMarginValue = retailValue - inventoryValue;
          const lowStockThreshold = Number(product.lowStockThreshold) || 0;
          const datedMovements = productMovements
            .filter((movement) => new Date(movement.createdAt) <= asOf)
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

          return {
            productId: product.id,
            productName: product.name,
            sku: product.sku,
            unit: product.unit,
            stockOnHand,
            unitCost: roundMoney(unitCost),
            unitPrice: roundMoney(unitPrice),
            inventoryValue: roundMoney(inventoryValue),
            retailValue: roundMoney(retailValue),
            grossMarginValue: roundMoney(grossMarginValue),
            grossMarginPercent: retailValue ? (grossMarginValue / Math.abs(retailValue)) * 100 : 0,
            lowStockThreshold,
            lowStock: stockOnHand <= lowStockThreshold,
            negativeStock: stockOnHand < 0,
            reorderSuggested: stockOnHand <= lowStockThreshold,
            movementCount: datedMovements.length,
            lastMovementAt: datedMovements[0]?.createdAt ?? null,
          };
        })
        .sort(
          (a, b) =>
            b.inventoryValue - a.inventoryValue || a.productName.localeCompare(b.productName)
        );

      res.json({
        reportCurrency: "AED",
        period: { asOf: asOf.toISOString() },
        rows,
        totals: {
          productCount: rows.length,
          stockUnits: roundMoney(rows.reduce((sum: number, row) => sum + row.stockOnHand, 0)),
          inventoryValue: roundMoney(
            rows.reduce((sum: number, row) => sum + row.inventoryValue, 0)
          ),
          retailValue: roundMoney(rows.reduce((sum: number, row) => sum + row.retailValue, 0)),
          grossMarginValue: roundMoney(
            rows.reduce((sum: number, row) => sum + row.grossMarginValue, 0)
          ),
          lowStockCount: rows.filter((row) => row.lowStock).length,
          negativeStockCount: rows.filter((row) => row.negativeStock).length,
          reorderSuggestions: rows.filter((row) => row.reorderSuggested).length,
          movementCount: rows.reduce((sum: number, row) => sum + row.movementCount, 0),
        },
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

      const totalSupplies = standardRatedSupplies + zeroRatedSupplies + exemptSupplies;
      const netVatDue = outputVat - inputVat;

      res.json({
        period: { from, to },
        box1_standardRatedSupplies: standardRatedSupplies,
        box2_zeroRatedSupplies: zeroRatedSupplies,
        box3_exemptSupplies: exemptSupplies,
        box4_totalSupplies: totalSupplies,
        box5_outputVat: outputVat,
        box6_standardRatedExpenses: standardRatedExpenses,
        box7_inputVatRecoverable: inputVat,
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
        currentEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        previousStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        previousEnd = new Date(now.getFullYear(), now.getMonth(), 0);
      } else if (period === "year") {
        currentStart = new Date(now.getFullYear(), 0, 1);
        currentEnd = new Date(now.getFullYear(), 11, 31);
        previousStart = new Date(now.getFullYear() - 1, 0, 1);
        previousEnd = new Date(now.getFullYear() - 1, 11, 31);
      } else {
        // quarter
        const currentQ = Math.floor(now.getMonth() / 3);
        currentStart = new Date(now.getFullYear(), currentQ * 3, 1);
        currentEnd = new Date(now.getFullYear(), (currentQ + 1) * 3, 0);
        previousStart = new Date(now.getFullYear(), (currentQ - 1) * 3, 1);
        previousEnd = new Date(now.getFullYear(), currentQ * 3, 0);
      }

      const currentInvoices = invoices.filter((inv) => {
        const d = new Date(inv.date);
        return d >= currentStart && d <= currentEnd;
      });
      const previousInvoices = invoices.filter((inv) => {
        const d = new Date(inv.date);
        return d >= previousStart && d <= previousEnd;
      });

      const currentReceipts = receipts.filter((rec) => {
        const d = new Date(rec.date || rec.createdAt);
        return d >= currentStart && d <= currentEnd;
      });
      const previousReceipts = receipts.filter((rec) => {
        const d = new Date(rec.date || rec.createdAt);
        return d >= previousStart && d <= previousEnd;
      });

      // Use subtotal (excl. VAT) to avoid inflating revenue with collected tax
      const currentRevenue = currentInvoices.reduce((sum, inv) => sum + inv.subtotal, 0);
      const previousRevenue = previousInvoices.reduce((sum, inv) => sum + inv.subtotal, 0);
      const currentExpenses = currentReceipts.reduce((sum, rec) => sum + (rec.amount || 0), 0);
      const previousExpenses = previousReceipts.reduce((sum, rec) => sum + (rec.amount || 0), 0);

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
