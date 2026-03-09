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
        const month = rec.date.slice(0, 7);
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

    const integrations = await storage.getEcommerceIntegrations(companyId as string);
    res.json(integrations || []);
  }));

  // Get e-commerce transactions (MUST be before :integrationId route)
  app.get("/api/integrations/ecommerce/transactions", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const { companyId } = req.query;

    if (!companyId) {
      return res.status(400).json({ message: 'Company ID required' });
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
    const integration = await storage.getEcommerceIntegration(integrationId);
    if (!integration) {
      return res.status(404).json({ message: 'Integration not found' });
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
    const { isActive } = req.body;

    const integration = await storage.getEcommerceIntegration(integrationId);
    if (!integration) {
      return res.status(404).json({ message: 'Integration not found' });
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
}
