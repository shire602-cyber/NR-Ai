import type { Express, Request, Response } from "express";
import { storage } from "../storage";
import { authMiddleware } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { z } from "zod";

export function registerAnalyticsRoutes(app: Express) {
  // =====================================
  // Advanced Analytics Routes
  // =====================================

  // Get cash flow forecasts
  app.get("/api/analytics/forecasts", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    const { companyId, period } = req.query;

    if (!companyId) {
      return res.status(400).json({ message: 'Company ID required' });
    }

    // Verify user access to company
    const companyUsers = await storage.getCompanyUsersByCompanyId(companyId as string);
    if (!companyUsers.some(cu => cu.userId === userId)) {
      return res.status(403).json({ message: 'Access denied to this company' });
    }

    // Get forecasts from storage
    const forecasts = await storage.getCashFlowForecasts(companyId as string);
    res.json(forecasts);
  }));

  // Generate AI forecast
  app.post("/api/analytics/generate-forecast", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    const { companyId, period } = req.body;

    if (!companyId) {
      return res.status(400).json({ message: 'Company ID required' });
    }

    // Verify access
    const companyUsers = await storage.getCompanyUsersByCompanyId(companyId);
    if (!companyUsers.some(cu => cu.userId === userId)) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Get historical data
    const invoices = await storage.getInvoicesByCompanyId(companyId);
    const receipts = await storage.getReceiptsByCompanyId(companyId);
    const journalEntries = await storage.getJournalEntriesByCompanyId(companyId);

    // Calculate monthly trends
    const monthlyData: { [key: string]: { inflow: number; outflow: number } } = {};

    invoices.forEach(inv => {
      const month = new Date(inv.date).toISOString().slice(0, 7);
      if (!monthlyData[month]) monthlyData[month] = { inflow: 0, outflow: 0 };
      monthlyData[month].inflow += inv.total || 0;
    });

    receipts.forEach(rec => {
      if (rec.date) {
        const month = (rec.date instanceof Date ? rec.date.toISOString() : String(rec.date)).slice(0, 7);
        if (!monthlyData[month]) monthlyData[month] = { inflow: 0, outflow: 0 };
        monthlyData[month].outflow += (rec.amount || 0) + (rec.vatAmount || 0);
      }
    });

    // Generate simple forecast based on averages
    const months = Object.keys(monthlyData).sort();
    const avgInflow = months.length > 0
      ? months.reduce((sum, m) => sum + monthlyData[m].inflow, 0) / months.length
      : 0;
    const avgOutflow = months.length > 0
      ? months.reduce((sum, m) => sum + monthlyData[m].outflow, 0) / months.length
      : 0;

    // Create forecast for next 3 months
    const periodMonths = period === '3months' ? 3 : period === '6months' ? 6 : 12;
    const forecasts = [];
    let runningBalance = avgInflow - avgOutflow;

    for (let i = 1; i <= periodMonths; i++) {
      const forecastDate = new Date();
      forecastDate.setMonth(forecastDate.getMonth() + i);

      const forecast = await storage.createCashFlowForecast({
        companyId,
        forecastDate,
        forecastType: 'monthly',
        predictedInflow: avgInflow * (1 + Math.random() * 0.1 - 0.05), // +/- 5% variation
        predictedOutflow: avgOutflow * (1 + Math.random() * 0.1 - 0.05),
        predictedBalance: runningBalance,
        confidenceLevel: 0.85 - (i * 0.02), // Confidence decreases over time
      });

      forecasts.push(forecast);
      runningBalance += avgInflow - avgOutflow;
    }

    res.json({ message: 'Forecasts generated', count: forecasts.length });
  }));

  // Get budget vs actual
  app.get("/api/analytics/budget-vs-actual", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    const { companyId, year, month } = req.query;

    if (!companyId) {
      return res.status(400).json({ message: 'Company ID required' });
    }

    // Verify access
    const companyUsers = await storage.getCompanyUsersByCompanyId(companyId as string);
    if (!companyUsers.some(cu => cu.userId === userId)) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Get budgets and actuals
    const budgets = await storage.getBudgetsByCompanyId(companyId as string,
      parseInt(year as string) || new Date().getFullYear(),
      parseInt(month as string) || new Date().getMonth() + 1
    );

    const accounts = await storage.getAccountsByCompanyId(companyId as string);
    const journalLines = await storage.getJournalLinesByCompanyId(companyId as string);

    // Calculate actual amounts per account
    const actualsByAccount: { [key: string]: number } = {};
    journalLines.forEach(line => {
      if (!actualsByAccount[line.accountId]) actualsByAccount[line.accountId] = 0;
      actualsByAccount[line.accountId] += (line.debit || 0) - (line.credit || 0);
    });

    // Combine budget and actual data
    const result = accounts.map(account => {
      const budget = budgets.find(b => b.accountId === account.id);
      const actual = actualsByAccount[account.id] || 0;
      const budgeted = budget?.budgetAmount || 0;

      return {
        accountId: account.id,
        accountName: account.nameEn,
        accountType: account.type,
        budgeted,
        actual: Math.abs(actual),
        variance: Math.abs(actual) - budgeted,
        variancePercent: budgeted > 0 ? ((Math.abs(actual) - budgeted) / budgeted) * 100 : 0,
      };
    }).filter(a => a.budgeted > 0 || a.actual > 0);

    res.json(result);
  }));

  // Get KPIs
  app.get("/api/analytics/kpis", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    const { companyId } = req.query;

    if (!companyId) {
      return res.status(400).json({ message: 'Company ID required' });
    }

    const companyUsers = await storage.getCompanyUsersByCompanyId(companyId as string);
    if (!companyUsers.some(cu => cu.userId === userId)) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Get stored KPIs
    const kpis = await storage.getFinancialKpis(companyId as string);
    res.json(kpis);
  }));

  // Get AI insights
  app.get("/api/analytics/insights", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    const { companyId } = req.query;

    if (!companyId) {
      return res.status(400).json({ message: 'Company ID required' });
    }

    const companyUsers = await storage.getCompanyUsersByCompanyId(companyId as string);
    if (!companyUsers.some(cu => cu.userId === userId)) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Generate dynamic insights based on data
    const invoices = await storage.getInvoicesByCompanyId(companyId as string);
    const receipts = await storage.getReceiptsByCompanyId(companyId as string);

    const totalRevenue = invoices.reduce((sum, inv) => sum + (inv.total || 0), 0);
    const totalExpenses = receipts.reduce((sum, rec) => sum + ((rec.amount || 0) + (rec.vatAmount || 0)), 0);
    const outstanding = invoices.filter(inv => inv.status !== 'paid').reduce((sum, inv) => sum + (inv.total || 0), 0);

    const insights = [];

    // Profit margin insight
    if (totalRevenue > 0) {
      const margin = ((totalRevenue - totalExpenses) / totalRevenue) * 100;
      if (margin > 20) {
        insights.push({
          id: '1',
          type: 'trend',
          title: 'Strong Profit Margin',
          description: `Your profit margin of ${margin.toFixed(1)}% is above industry average.`,
          impact: 'Healthy financial position',
          priority: 'low',
          actionable: false,
        });
      } else if (margin < 10) {
        insights.push({
          id: '2',
          type: 'warning',
          title: 'Low Profit Margin Alert',
          description: `Your profit margin of ${margin.toFixed(1)}% is below recommended levels.`,
          impact: 'May need cost optimization',
          priority: 'high',
          actionable: true,
          action: 'Review expenses',
        });
      }
    }

    // Outstanding invoices insight
    if (outstanding > 0) {
      insights.push({
        id: '3',
        type: 'opportunity',
        title: 'Outstanding Collections',
        description: `You have AED ${outstanding.toFixed(2)} in unpaid invoices.`,
        impact: `Potential AED ${outstanding.toFixed(2)} recovery`,
        priority: outstanding > 50000 ? 'high' : 'medium',
        actionable: true,
        action: 'Send reminders',
      });
    }

    res.json(insights);
  }));

  // =====================================
  // E-Commerce Integration Routes
  // =====================================

  // Get e-commerce integrations
  app.get("/api/integrations/ecommerce", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    const { companyId } = req.query;

    if (!companyId) {
      return res.status(400).json({ message: 'Company ID required' });
    }

    const companyUsers = await storage.getCompanyUsersByCompanyId(companyId as string);
    if (!companyUsers.some(cu => cu.userId === userId)) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const integrations = await storage.getEcommerceIntegrations(companyId as string);
    res.json(integrations || []);
  }));

  // Get e-commerce transactions (MUST be before :integrationId route)
  app.get("/api/integrations/ecommerce/transactions", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    const { companyId } = req.query;

    if (!companyId) {
      return res.status(400).json({ message: 'Company ID required' });
    }

    const companyUsers = await storage.getCompanyUsersByCompanyId(companyId as string);
    if (!companyUsers.some(cu => cu.userId === userId)) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const transactions = await storage.getEcommerceTransactions(companyId as string);
    res.json(transactions || []);
  }));

  // Connect e-commerce integration
  app.post("/api/integrations/ecommerce/connect", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    const { companyId, platform, apiKey, shopDomain, accessToken } = req.body;

    if (!companyId || !platform) {
      return res.status(400).json({ message: 'Company ID and platform required' });
    }

    // Verify access
    const companyUsers = await storage.getCompanyUsersByCompanyId(companyId);
    if (!companyUsers.some(cu => cu.userId === userId)) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const integration = await storage.createEcommerceIntegration({
      companyId,
      platform,
      isActive: true,
      apiKey: apiKey || null,
      shopDomain: shopDomain || null,
      accessToken: accessToken || null,
      syncStatus: 'never',
    });

    res.json(integration);
  }));

  // Sync e-commerce integration
  app.post("/api/integrations/ecommerce/:integrationId/sync", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const { integrationId } = req.params;
    const userId = (req as any).user?.id;

    // Verify integration exists and user has access
    const integration = await storage.getEcommerceIntegrationById(integrationId);
    if (!integration) {
      return res.status(404).json({ message: 'Integration not found' });
    }

    const companyUsers = await storage.getCompanyUsersByCompanyId(integration.companyId);
    if (!companyUsers.some(cu => cu.userId === userId)) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Update sync status
    await storage.updateEcommerceIntegration(integrationId, {
      syncStatus: 'syncing',
      lastSyncAt: new Date(),
    });

    // In a real implementation, this would fetch data from the platform
    // For now, we'll simulate a successful sync
    setTimeout(async () => {
      await storage.updateEcommerceIntegration(integrationId, {
        syncStatus: 'success',
      });
    }, 2000);

    res.json({ message: 'Sync started' });
  }));

  // Toggle e-commerce integration
  app.patch("/api/integrations/ecommerce/:integrationId/toggle", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const { integrationId } = req.params;
    const userId = (req as any).user?.id;
    const { isActive } = req.body;

    const integration = await storage.getEcommerceIntegrationById(integrationId);
    if (!integration) {
      return res.status(404).json({ message: 'Integration not found' });
    }

    const companyUsers = await storage.getCompanyUsersByCompanyId(integration.companyId);
    if (!companyUsers.some(cu => cu.userId === userId)) {
      return res.status(403).json({ message: 'Access denied' });
    }

    await storage.updateEcommerceIntegration(integrationId, { isActive });
    res.json({ message: 'Integration updated' });
  }));

  // =====================================
  // ANALYTICS
  // =====================================

  // Track analytics event
  app.post("/api/analytics/event", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;

    // Validate input with comprehensive schema
    const validationSchema = z.object({
      eventType: z.enum(['page_view', 'feature_use', 'error', 'conversion', 'custom']),
      eventName: z.string().min(1).max(100),
      pageUrl: z.string().max(2000).optional().nullable(),
      pageTitle: z.string().max(500).optional().nullable(),
      properties: z.record(z.unknown()).optional().nullable(),
      value: z.number().optional().nullable(),
      deviceType: z.string().max(50).optional().nullable(),
      browser: z.string().max(100).optional().nullable(),
      language: z.string().max(10).optional().nullable(),
    });

    const validated = validationSchema.parse(req.body);

    const event = await storage.createAnalyticsEvent({
      userId,
      eventType: validated.eventType,
      eventName: validated.eventName,
      pageUrl: validated.pageUrl,
      pageTitle: validated.pageTitle,
      properties: validated.properties ? JSON.stringify(validated.properties) : null,
      value: validated.value,
      deviceType: validated.deviceType,
      browser: validated.browser,
      language: validated.language,
    });

    res.json(event);
  }));

  // Get analytics dashboard data
  app.get("/api/analytics/dashboard", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const { startDate, endDate } = req.query;

    // Get all events (in production, filter by date range)
    const events = await storage.getAnalyticsEvents();
    const metrics = await storage.getFeatureUsageMetrics();

    // Aggregate data for dashboard
    const pageViews = events.filter(e => e.eventType === 'page_view').length;
    const featureUses = events.filter(e => e.eventType === 'feature_use').length;
    const errors = events.filter(e => e.eventType === 'error').length;

    // Group by event name
    const eventsByName: Record<string, number> = {};
    events.forEach(e => {
      eventsByName[e.eventName] = (eventsByName[e.eventName] || 0) + 1;
    });

    // Group by page
    const pagesByUrl: Record<string, number> = {};
    events.filter(e => e.eventType === 'page_view').forEach(e => {
      if (e.pageUrl) {
        pagesByUrl[e.pageUrl] = (pagesByUrl[e.pageUrl] || 0) + 1;
      }
    });

    res.json({
      summary: {
        totalPageViews: pageViews,
        totalFeatureUses: featureUses,
        totalErrors: errors,
        totalEvents: events.length,
      },
      eventsByName,
      pagesByUrl,
      recentEvents: events.slice(0, 50),
      featureMetrics: metrics,
    });
  }));

  // Get feature usage report
  app.get("/api/analytics/feature-usage", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const { feature } = req.query;
    const metrics = await storage.getFeatureUsageMetrics(feature as string | undefined);
    res.json(metrics);
  }));

  // =====================================
  // Company-Scoped Financial Analytics
  // =====================================

  // GET /api/companies/:companyId/analytics/cash-forecast
  // Projects cash position at 30, 60, 90 days using historical averages + outstanding items
  app.get("/api/companies/:companyId/analytics/cash-forecast", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    const { companyId } = req.params;

    const companyUsers = await storage.getCompanyUsersByCompanyId(companyId);
    if (!companyUsers.some(cu => cu.userId === userId)) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const now = new Date();

    const [invoices, accounts, entries, allLines, receipts] = await Promise.all([
      storage.getInvoicesByCompanyId(companyId),
      storage.getAccountsByCompanyId(companyId),
      storage.getJournalEntriesByCompanyId(companyId),
      storage.getJournalLinesByCompanyId(companyId),
      storage.getReceiptsByCompanyId(companyId),
    ]);

    const entryDateMap = new Map<string, Date>(entries.map(e => [e.id, new Date(e.date)]));
    const accountMap = new Map(accounts.map(a => [a.id, a]));

    // Cash/bank account IDs
    const cashAccountIds = new Set(
      accounts.filter(a =>
        a.type === 'asset' && (
          a.subType === 'current_asset' ||
          a.nameEn.toLowerCase().includes('cash') ||
          a.nameEn.toLowerCase().includes('bank')
        )
      ).map(a => a.id)
    );

    // Current cash balance (all-time balance on cash/bank accounts)
    const allTimeBalance = new Map<string, number>();
    for (const line of allLines) {
      const account = accountMap.get(line.accountId);
      if (!account) continue;
      const prev = allTimeBalance.get(line.accountId) || 0;
      if (account.type === 'asset' || account.type === 'expense') {
        allTimeBalance.set(line.accountId, prev + (line.debit || 0) - (line.credit || 0));
      } else {
        allTimeBalance.set(line.accountId, prev + (line.credit || 0) - (line.debit || 0));
      }
    }

    let currentCash = 0;
    for (const [id, bal] of allTimeBalance) {
      if (cashAccountIds.has(id)) currentCash += bal;
    }

    // Average monthly income & expenses over last 3 completed months
    const monthlyIncome: number[] = [0, 0, 0];
    const monthlyExpenses: number[] = [0, 0, 0];

    for (const line of allLines) {
      const account = accountMap.get(line.accountId);
      if (!account) continue;
      const entryDate = entryDateMap.get(line.entryId);
      if (!entryDate) continue;

      for (let i = 1; i <= 3; i++) {
        const mStart = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const mEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 0, 23, 59, 59);
        if (entryDate >= mStart && entryDate <= mEnd) {
          if (account.type === 'income') monthlyIncome[i - 1] += (line.credit || 0) - (line.debit || 0);
          else if (account.type === 'expense') monthlyExpenses[i - 1] += (line.debit || 0) - (line.credit || 0);
        }
      }
    }

    const avgIncome = monthlyIncome.reduce((s, v) => s + v, 0) / 3;
    const avgExpenses = monthlyExpenses.reduce((s, v) => s + v, 0) / 3;
    const avgMonthlyNet = avgIncome - avgExpenses;

    // Outstanding receivables weighted by aging probability of collection
    const collectionProbability = { days0to30: 0.95, days31to60: 0.80, days61to90: 0.60, days90plus: 0.30 };
    let weightedReceivables = 0;
    const unpaidInvoices = invoices.filter(inv => inv.status === 'sent');
    for (const inv of unpaidInvoices) {
      const daysOld = Math.floor((now.getTime() - new Date(inv.date).getTime()) / 86400000);
      let prob: number;
      if (daysOld <= 30) prob = collectionProbability.days0to30;
      else if (daysOld <= 60) prob = collectionProbability.days31to60;
      else if (daysOld <= 90) prob = collectionProbability.days61to90;
      else prob = collectionProbability.days90plus;
      weightedReceivables += inv.total * prob;
    }

    // Outstanding payables (unposted receipts)
    const outstandingPayables = receipts
      .filter(rec => !rec.posted)
      .reduce((s, rec) => s + (rec.amount || 0) + (rec.vatAmount || 0), 0);

    // Build 30/60/90-day projections
    const projections = [30, 60, 90].map(days => {
      const months = days / 30;
      // Pro-rata income and expenses; receivables land mostly in month 1, payables in month 1
      const projectedIncome = avgIncome * months + weightedReceivables * (days <= 30 ? 1 : 1);
      const projectedExpenses = avgExpenses * months + (days <= 30 ? outstandingPayables : 0);
      const projectedCash = currentCash + projectedIncome - projectedExpenses;
      return {
        days,
        projectedDate: new Date(now.getTime() + days * 86400000).toISOString().slice(0, 10),
        projectedCash: Math.max(0, projectedCash),
        projectedIncome,
        projectedExpenses,
      };
    });

    res.json({
      currentCash,
      avgMonthlyIncome: avgIncome,
      avgMonthlyExpenses: avgExpenses,
      avgMonthlyNet,
      weightedReceivables,
      outstandingPayables,
      projections,
    });
  }));

  // GET /api/companies/:companyId/analytics/profit-trend?months=12
  // Returns monthly revenue, expenses, and net profit for last N months
  app.get("/api/companies/:companyId/analytics/profit-trend", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    const { companyId } = req.params;
    const monthCount = Math.min(Math.max(parseInt(req.query.months as string) || 12, 1), 36);

    const companyUsers = await storage.getCompanyUsersByCompanyId(companyId);
    if (!companyUsers.some(cu => cu.userId === userId)) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const now = new Date();

    const [accounts, entries, allLines] = await Promise.all([
      storage.getAccountsByCompanyId(companyId),
      storage.getJournalEntriesByCompanyId(companyId),
      storage.getJournalLinesByCompanyId(companyId),
    ]);

    const entryDateMap = new Map<string, Date>(entries.map(e => [e.id, new Date(e.date)]));
    const accountMap = new Map(accounts.map(a => [a.id, a]));

    // Build month buckets: key = "YYYY-MM"
    const buckets = new Map<string, { revenue: number; expenses: number }>();
    for (let i = monthCount - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      buckets.set(key, { revenue: 0, expenses: 0 });
    }

    for (const line of allLines) {
      const account = accountMap.get(line.accountId);
      if (!account || (account.type !== 'income' && account.type !== 'expense')) continue;
      const entryDate = entryDateMap.get(line.entryId);
      if (!entryDate) continue;

      const key = `${entryDate.getFullYear()}-${String(entryDate.getMonth() + 1).padStart(2, '0')}`;
      const bucket = buckets.get(key);
      if (!bucket) continue;

      if (account.type === 'income') bucket.revenue += (line.credit || 0) - (line.debit || 0);
      else if (account.type === 'expense') bucket.expenses += (line.debit || 0) - (line.credit || 0);
    }

    const trend = Array.from(buckets.entries()).map(([month, { revenue, expenses }]) => ({
      month,
      revenue: Math.max(0, revenue),
      expenses: Math.max(0, expenses),
      netProfit: revenue - expenses,
    }));

    res.json(trend);
  }));

  // GET /api/companies/:companyId/analytics/top-customers?limit=10
  // Returns top customers by total invoiced amount
  app.get("/api/companies/:companyId/analytics/top-customers", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    const { companyId } = req.params;
    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 10, 1), 50);

    const companyUsers = await storage.getCompanyUsersByCompanyId(companyId);
    if (!companyUsers.some(cu => cu.userId === userId)) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const invoices = await storage.getInvoicesByCompanyId(companyId);

    const customerTotals = new Map<string, { total: number; invoiceCount: number; paidTotal: number }>();
    for (const inv of invoices) {
      if (inv.status === 'void') continue;
      const name = inv.customerName || 'Unknown';
      const prev = customerTotals.get(name) || { total: 0, invoiceCount: 0, paidTotal: 0 };
      prev.total += inv.total;
      prev.invoiceCount += 1;
      if (inv.status === 'paid') prev.paidTotal += inv.total;
      customerTotals.set(name, prev);
    }

    const topCustomers = Array.from(customerTotals.entries())
      .map(([name, stats]) => ({ name, ...stats }))
      .sort((a, b) => b.total - a.total)
      .slice(0, limit);

    res.json(topCustomers);
  }));

  // GET /api/companies/:companyId/analytics/top-suppliers?limit=10
  // Returns top suppliers by total receipt/expense amount
  app.get("/api/companies/:companyId/analytics/top-suppliers", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    const { companyId } = req.params;
    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 10, 1), 50);

    const companyUsers = await storage.getCompanyUsersByCompanyId(companyId);
    if (!companyUsers.some(cu => cu.userId === userId)) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const receipts = await storage.getReceiptsByCompanyId(companyId);

    const supplierTotals = new Map<string, { total: number; receiptCount: number }>();
    for (const rec of receipts) {
      const name = rec.merchant || 'Unknown';
      const prev = supplierTotals.get(name) || { total: 0, receiptCount: 0 };
      prev.total += (rec.amount || 0) + (rec.vatAmount || 0);
      prev.receiptCount += 1;
      supplierTotals.set(name, prev);
    }

    const topSuppliers = Array.from(supplierTotals.entries())
      .map(([name, stats]) => ({ name, ...stats }))
      .sort((a, b) => b.total - a.total)
      .slice(0, limit);

    res.json(topSuppliers);
  }));
}
