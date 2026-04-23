import type { Express, Request, Response } from "express";
import { storage } from "../storage";
import { authMiddleware } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { db } from "../db";
import { eq, and, gte, lte, inArray, type SQL } from "drizzle-orm";
import { journalEntries, journalLines, accounts, invoices, invoiceLines, receipts } from "../../shared/schema";
import type { Account, JournalLine, Invoice, InvoiceLine, Receipt } from "../../shared/schema";

/**
 * Register advanced report routes (cash flow, aging, period comparison).
 */
export function registerReportRoutes(app: Express) {
  // =====================================
  // ADVANCED REPORTS
  // =====================================

  // Cash flow report - supports both path segment and query param for period
  app.get("/api/reports/:companyId/cash-flow/:period?", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    const { companyId, period: pathPeriod } = req.params;
    const period = pathPeriod || req.query.period || 'quarter'; // Support path segment, query param, or default

    const hasAccess = await storage.hasCompanyAccess(userId, companyId);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const journalEntries = await storage.getJournalEntriesByCompanyId(companyId);
    const accounts = await storage.getAccountsByCompanyId(companyId);

    // Group entries by period
    const now = new Date();
    let startDate: Date;
    let periodLength: 'month' | 'quarter' | 'year' = 'quarter';

    switch (period) {
      case 'month':
        startDate = new Date(now.getFullYear(), now.getMonth() - 6, 1);
        periodLength = 'month';
        break;
      case 'year':
        startDate = new Date(now.getFullYear() - 2, 0, 1);
        periodLength = 'year';
        break;
      default:
        startDate = new Date(now.getFullYear() - 1, Math.floor(now.getMonth() / 3) * 3, 1);
        periodLength = 'quarter';
    }

    const cashFlowData: any[] = [];
    let currentDate = new Date(startDate);
    let runningBalance = 0;

    while (currentDate <= now) {
      let periodEnd: Date;
      let periodLabel: string;

      if (periodLength === 'month') {
        periodEnd = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);
        periodLabel = currentDate.toLocaleString('default', { month: 'short', year: '2-digit' });
      } else if (periodLength === 'quarter') {
        periodEnd = new Date(currentDate.getFullYear(), currentDate.getMonth() + 3, 0);
        periodLabel = `Q${Math.floor(currentDate.getMonth() / 3) + 1} ${currentDate.getFullYear()}`;
      } else {
        periodEnd = new Date(currentDate.getFullYear(), 11, 31);
        periodLabel = currentDate.getFullYear().toString();
      }

      // Get entries for this period
      const periodEntries = journalEntries.filter(je => {
        const jeDate = new Date(je.date);
        return jeDate >= currentDate && jeDate <= periodEnd;
      });

      // Calculate cash flows (simplified)
      let operatingInflow = 0;
      let operatingOutflow = 0;

      for (const entry of periodEntries) {
        const lines = await storage.getJournalLinesByEntryId(entry.id);
        for (const line of lines) {
          const account = accounts.find(a => a.id === line.accountId);
          if (account) {
            if (account.type === 'income') {
              operatingInflow += line.credit;
            } else if (account.type === 'expense') {
              operatingOutflow += line.debit;
            }
          }
        }
      }

      const netCashFlow = operatingInflow - operatingOutflow;
      runningBalance += netCashFlow;

      cashFlowData.push({
        period: periodLabel,
        operatingInflow,
        operatingOutflow,
        investingInflow: 0,
        investingOutflow: 0,
        financingInflow: 0,
        financingOutflow: 0,
        netCashFlow,
        endingBalance: runningBalance,
      });

      // Move to next period
      if (periodLength === 'month') {
        currentDate.setMonth(currentDate.getMonth() + 1);
      } else if (periodLength === 'quarter') {
        currentDate.setMonth(currentDate.getMonth() + 3);
      } else {
        currentDate.setFullYear(currentDate.getFullYear() + 1);
      }
    }

    res.json(cashFlowData);
  }));

  // Aging report
  app.get("/api/reports/:companyId/aging", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    const { companyId } = req.params;

    const hasAccess = await storage.hasCompanyAccess(userId, companyId);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const invoices = await storage.getInvoicesByCompanyId(companyId);
    const now = new Date();
    const agingData: any[] = [];

    // Group unpaid invoices by customer
    const unpaidInvoices = invoices.filter(inv => inv.status !== 'paid');
    const customerTotals: Record<string, any> = {};

    for (const inv of unpaidInvoices) {
      const invDate = new Date(inv.date);
      const daysOld = Math.floor((now.getTime() - invDate.getTime()) / (1000 * 60 * 60 * 24));

      if (!customerTotals[inv.customerName]) {
        customerTotals[inv.customerName] = {
          id: inv.id,
          name: inv.customerName,
          type: 'receivable',
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

      if (daysOld <= 0) {
        customer.current += inv.total;
      } else if (daysOld <= 30) {
        customer.days30 += inv.total;
      } else if (daysOld <= 60) {
        customer.days60 += inv.total;
      } else if (daysOld <= 90) {
        customer.days90 += inv.total;
      } else {
        customer.over90 += inv.total;
      }
    }

    agingData.push(...Object.values(customerTotals));
    res.json(agingData);
  }));

  // Trial Balance report
  app.get("/api/companies/:id/reports/trial-balance", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    const companyId = req.params.id;
    const { from, to } = req.query as { from?: string; to?: string };

    const hasAccess = await storage.hasCompanyAccess(userId, companyId);
    if (!hasAccess) return res.status(403).json({ message: 'Access denied' });

    // Load all accounts for this company
    const companyAccounts = await db
      .select()
      .from(accounts)
      .where(eq(accounts.companyId, companyId));

    // Build date filter conditions for entries
    const baseCond = and(
      eq(journalEntries.companyId, companyId),
      eq(journalEntries.status, 'posted'),
      from ? gte(journalEntries.date, new Date(from)) : undefined,
      to ? lte(journalEntries.date, new Date(to)) : undefined,
    );

    const filteredEntries: Array<{ id: string }> = await db
      .select({ id: journalEntries.id })
      .from(journalEntries)
      .where(baseCond);

    const entryIds = filteredEntries.map((e: { id: string }) => e.id);

    // Load all lines for these entries in one query
    const lines: JournalLine[] = entryIds.length > 0
      ? await db.select().from(journalLines).where(inArray(journalLines.entryId, entryIds))
      : [];

    // Aggregate by account
    const totalsMap = new Map<string, { totalDebit: number; totalCredit: number }>();
    for (const line of lines) {
      const existing = totalsMap.get(line.accountId) ?? { totalDebit: 0, totalCredit: 0 };
      existing.totalDebit += line.debit ?? 0;
      existing.totalCredit += line.credit ?? 0;
      totalsMap.set(line.accountId, existing);
    }

    // Build result rows for all accounts (including zero-activity accounts)
    const rows = (companyAccounts as Account[])
      .sort((a: Account, b: Account) => (a.code ?? '').localeCompare(b.code ?? ''))
      .map((account: Account) => {
        const { totalDebit, totalCredit } = totalsMap.get(account.id) ?? { totalDebit: 0, totalCredit: 0 };
        // Normal balance: debit-normal for asset/expense, credit-normal for liability/equity/income
        const balance = ['asset', 'expense'].includes(account.type)
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
        };
      });

    const sumDebits = rows.reduce((s: number, r) => s + r.totalDebit, 0);
    const sumCredits = rows.reduce((s: number, r) => s + r.totalCredit, 0);

    res.json({
      rows,
      totals: {
        sumDebits,
        sumCredits,
        difference: Math.abs(sumDebits - sumCredits),
      },
    });
  }));

  // VAT Return report (UAE)
  app.get("/api/companies/:id/reports/vat-return", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    const companyId = req.params.id;
    const { from, to } = req.query as { from?: string; to?: string };

    if (!from || !to) {
      return res.status(400).json({ message: 'from and to date params are required (YYYY-MM-DD)' });
    }

    const hasAccess = await storage.hasCompanyAccess(userId, companyId);
    if (!hasAccess) return res.status(403).json({ message: 'Access denied' });

    const fromDate = new Date(from);
    const toDate = new Date(to);

    // Get all invoices in range
    const periodInvoices: Invoice[] = await db
      .select()
      .from(invoices)
      .where(and(
        eq(invoices.companyId, companyId),
        gte(invoices.date, fromDate),
        lte(invoices.date, toDate),
      ));

    const invoiceIds = periodInvoices.map((i: Invoice) => i.id);

    const allLines: InvoiceLine[] = invoiceIds.length > 0
      ? await db.select().from(invoiceLines).where(inArray(invoiceLines.invoiceId, invoiceIds))
      : [];

    let standardRatedSupplies = 0;
    let zeroRatedSupplies = 0;
    let exemptSupplies = 0;

    for (const line of allLines) {
      const lineTotal = line.quantity * line.unitPrice;
      const supplyType = line.vatSupplyType ?? 'standard_rated';
      if (supplyType === 'zero_rated') {
        zeroRatedSupplies += lineTotal;
      } else if (supplyType === 'exempt') {
        exemptSupplies += lineTotal;
      } else {
        // standard_rated and out_of_scope treated as standard for Box 1
        standardRatedSupplies += lineTotal;
      }
    }

    const outputVat = standardRatedSupplies * 0.05;

    // Get expenses (receipts) in range with VAT — receipts.date is text (YYYY-MM-DD)
    const periodReceipts: Receipt[] = await db
      .select()
      .from(receipts)
      .where(and(
        eq(receipts.companyId, companyId),
        gte(receipts.date, from),
        lte(receipts.date, to),
      ));

    const standardRatedExpenses = periodReceipts.reduce((s: number, r: Receipt) => {
      const amount = r.amount ?? 0;
      // Exclude VAT from base if vatAmount is recorded separately
      const base = r.vatAmount ? amount - r.vatAmount : amount;
      return s + base;
    }, 0);

    const inputVat = periodReceipts.reduce((s: number, r: Receipt) => s + (r.vatAmount ?? 0), 0);

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
  }));

  // Period comparison report - supports both path segment and query param for period
  app.get("/api/reports/:companyId/comparison/:period?", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    const { companyId, period: pathPeriod } = req.params;
    const period = pathPeriod || req.query.period || 'quarter';

    const hasAccess = await storage.hasCompanyAccess(userId, companyId);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const invoices = await storage.getInvoicesByCompanyId(companyId);
    const receipts = await storage.getReceiptsByCompanyId(companyId);

    const now = new Date();
    let currentStart: Date, currentEnd: Date, previousStart: Date, previousEnd: Date;

    if (period === 'month') {
      currentStart = new Date(now.getFullYear(), now.getMonth(), 1);
      currentEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      previousStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      previousEnd = new Date(now.getFullYear(), now.getMonth(), 0);
    } else if (period === 'year') {
      currentStart = new Date(now.getFullYear(), 0, 1);
      currentEnd = new Date(now.getFullYear(), 11, 31);
      previousStart = new Date(now.getFullYear() - 1, 0, 1);
      previousEnd = new Date(now.getFullYear() - 1, 11, 31);
    } else { // quarter
      const currentQ = Math.floor(now.getMonth() / 3);
      currentStart = new Date(now.getFullYear(), currentQ * 3, 1);
      currentEnd = new Date(now.getFullYear(), (currentQ + 1) * 3, 0);
      previousStart = new Date(now.getFullYear(), (currentQ - 1) * 3, 1);
      previousEnd = new Date(now.getFullYear(), currentQ * 3, 0);
    }

    const currentInvoices = invoices.filter(inv => {
      const d = new Date(inv.date);
      return d >= currentStart && d <= currentEnd;
    });
    const previousInvoices = invoices.filter(inv => {
      const d = new Date(inv.date);
      return d >= previousStart && d <= previousEnd;
    });

    const currentReceipts = receipts.filter(rec => {
      const d = new Date(rec.date || rec.createdAt);
      return d >= currentStart && d <= currentEnd;
    });
    const previousReceipts = receipts.filter(rec => {
      const d = new Date(rec.date || rec.createdAt);
      return d >= previousStart && d <= previousEnd;
    });

    const currentRevenue = currentInvoices.reduce((sum, inv) => sum + inv.total, 0);
    const previousRevenue = previousInvoices.reduce((sum, inv) => sum + inv.total, 0);
    const currentExpenses = currentReceipts.reduce((sum, rec) => sum + (rec.amount || 0), 0);
    const previousExpenses = previousReceipts.reduce((sum, rec) => sum + (rec.amount || 0), 0);

    const comparison = [
      {
        metric: 'Total Revenue',
        current: currentRevenue,
        previous: previousRevenue,
        change: currentRevenue - previousRevenue,
        changePercent: previousRevenue ? ((currentRevenue - previousRevenue) / previousRevenue) * 100 : 0,
      },
      {
        metric: 'Total Expenses',
        current: currentExpenses,
        previous: previousExpenses,
        change: currentExpenses - previousExpenses,
        changePercent: previousExpenses ? ((currentExpenses - previousExpenses) / previousExpenses) * 100 : 0,
      },
      {
        metric: 'Net Profit',
        current: currentRevenue - currentExpenses,
        previous: previousRevenue - previousExpenses,
        change: (currentRevenue - currentExpenses) - (previousRevenue - previousExpenses),
        changePercent: (previousRevenue - previousExpenses) ? (((currentRevenue - currentExpenses) - (previousRevenue - previousExpenses)) / Math.abs(previousRevenue - previousExpenses)) * 100 : 0,
      },
      {
        metric: 'Invoice Count',
        current: currentInvoices.length,
        previous: previousInvoices.length,
        change: currentInvoices.length - previousInvoices.length,
        changePercent: previousInvoices.length ? ((currentInvoices.length - previousInvoices.length) / previousInvoices.length) * 100 : 0,
      },
      {
        metric: 'Avg Invoice Value',
        current: currentInvoices.length ? currentRevenue / currentInvoices.length : 0,
        previous: previousInvoices.length ? previousRevenue / previousInvoices.length : 0,
        change: (currentInvoices.length ? currentRevenue / currentInvoices.length : 0) - (previousInvoices.length ? previousRevenue / previousInvoices.length : 0),
        changePercent: (previousInvoices.length && previousRevenue / previousInvoices.length) ? (((currentInvoices.length ? currentRevenue / currentInvoices.length : 0) - (previousRevenue / previousInvoices.length)) / (previousRevenue / previousInvoices.length)) * 100 : 0,
      },
    ];

    res.json(comparison);
  }));
}
