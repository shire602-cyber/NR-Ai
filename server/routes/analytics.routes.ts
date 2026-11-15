import type { Express, Request, Response } from "express";
import { storage } from "../storage";
import { adminMiddleware, authMiddleware, requireCustomer } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { strictBody } from "../http/strict-body";
import { parsedBody } from "../http/parsed-body";
import { DomainError } from "../errors";
import { zText, zUuid } from "../../shared/validators/primitives";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { db, pool } from "../db";
import { ecommerceIntegrations, ecommerceTransactions } from "../../shared/schema";
import { requirePermission } from "../middleware/companyRolePolicy";
import { connectIntegration, syncIntegration } from "../services/ecommerce";
import {
  companyQuery,
  connectBody,
  integrationFor,
  maskIntegrationSecrets,
  toggleBody,
} from "../services/ecommerce/routes";
import {
  addDays,
  agedReceivables,
  fiscalYearStart,
  loadCompany,
  profitAndLoss,
  uaeToday,
} from "../reporting";
import { assertReportAccess } from "../reporting/http";
import { generateCashFlowForecast } from "../services/cashflow-forecast.service";
import { getMonthlyTrends } from "../services/dashboard-stats.service";
import {
  computeBudgetVariance,
  findApprovedPlan,
  varianceFor,
} from "../services/budget-variance.service";

const analyticsEventBody = z.object({
  eventType: z.enum(["page_view", "feature_use", "error", "conversion", "custom"]),
  eventName: zText(100, { min: 1 }),
  companyId: zUuid.optional().nullable(),
  pageUrl: zText(2000).optional().nullable(),
  pageTitle: zText(500).optional().nullable(),
  properties: z
    .record(z.unknown())
    .refine((v) => JSON.stringify(v).length <= 5000, "properties is too large")
    .optional()
    .nullable(),
  value: z.number().finite().optional().nullable(),
  deviceType: zText(50).optional().nullable(),
  browser: zText(100).optional().nullable(),
  language: zText(10).optional().nullable(),
});

const generateForecastBody = z
  .object({
    companyId: zUuid,
    period: z.enum(["3months", "6months", "12months"]).optional(),
  })
  .strict();

type AnalyticsEventRow = Awaited<ReturnType<typeof storage.getAnalyticsEvents>>[number];

function summariseEvents(events: AnalyticsEventRow[]) {
  const eventsByName: Record<string, number> = {};
  const pagesByUrl: Record<string, number> = {};
  for (const e of events) {
    eventsByName[e.eventName] = (eventsByName[e.eventName] || 0) + 1;
    if (e.eventType === "page_view" && e.pageUrl) {
      pagesByUrl[e.pageUrl] = (pagesByUrl[e.pageUrl] || 0) + 1;
    }
  }
  return {
    summary: {
      totalPageViews: events.filter((e) => e.eventType === "page_view").length,
      totalFeatureUses: events.filter((e) => e.eventType === "feature_use").length,
      totalErrors: events.filter((e) => e.eventType === "error").length,
      totalEvents: events.length,
    },
    eventsByName,
    pagesByUrl,
    recentEvents: events.slice(0, 50),
  };
}

export function registerAnalyticsRoutes(app: Express) {
  // =====================================
  // Advanced Analytics Routes
  // =====================================

  // Get cash flow forecasts
  app.get(
    "/api/analytics/forecasts",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const userId = (req as any).user?.id;
      const { companyId, period } = req.query;

      if (!companyId) {
        return res.status(400).json({ message: "Company ID required" });
      }

      // Verify user access to company
      const companyUsers = await storage.getCompanyUsersByCompanyId(companyId as string);
      if (!companyUsers.some((cu) => cu.userId === userId)) {
        return res.status(403).json({ message: "Access denied to this company" });
      }

      // Get forecasts from storage
      const forecasts = await storage.getCashFlowForecasts(companyId as string);
      res.json(forecasts);
    })
  );

  // Generate a persisted monthly forecast from open documents and scheduled items.
  // Nothing is extrapolated from historical averages (R12-04): with no open
  // invoices, bills or scheduled items the endpoint answers 400 INSUFFICIENT_DATA.
  app.post(
    "/api/analytics/generate-forecast",
    authMiddleware,
    strictBody(generateForecastBody, { allowServerOwned: ["companyId"] }),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, period } = parsedBody<z.infer<typeof generateForecastBody>>(req);
      await assertReportAccess(req, companyId);
      const periodMonths = period === "3months" ? 3 : period === "6months" ? 6 : 12;
      const forecast = await generateCashFlowForecast(companyId, {
        days: Math.min(periodMonths * 30, 365),
      });
      if (forecast.insufficientData) {
        throw new DomainError(
          "INSUFFICIENT_DATA",
          400,
          { insights: forecast.insights },
          "Add invoices, vendor bills or scheduled cash items before generating a cash-flow forecast."
        );
      }
      await storage.deleteCashFlowForecastsByCompanyId(companyId);
      const byMonth = new Map<string, { inflow: number; outflow: number; balance: number }>();
      for (const p of forecast.projections) {
        const key = p.weekStart.slice(0, 7);
        const cur = byMonth.get(key) ?? { inflow: 0, outflow: 0, balance: 0 };
        cur.inflow += p.expectedInflows;
        cur.outflow += p.expectedOutflows;
        cur.balance = p.projectedBalance;
        byMonth.set(key, cur);
      }
      const forecasts = [];
      for (const [key, v] of byMonth) {
        forecasts.push(
          await storage.createCashFlowForecast({
            companyId,
            forecastDate: new Date(`${key}-01T00:00:00.000Z`),
            forecastType: "monthly",
            predictedInflow: Math.round(v.inflow * 100) / 100,
            predictedOutflow: Math.round(v.outflow * 100) / 100,
            predictedBalance: v.balance,
            confidenceLevel: null,
            factors: JSON.stringify({ basis: "documents_and_scheduled_items" }),
          })
        );
      }
      res.json({ message: "Forecasts generated", count: forecasts.length, forecasts });
    })
  );

  // Budget vs actual from the APPROVED budget plan (R13-12). Query: companyId,
  // year (fiscal year), month (1-12 or 0/all for the whole plan), budgetId.
  app.get(
    "/api/analytics/budget-vs-actual",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, year, month, budgetId } = req.query;
      if (typeof companyId !== "string" || !companyId) {
        return res.status(400).json({ message: "Company ID required" });
      }
      await assertReportAccess(req, companyId);
      const fiscalYear = year ? Number(year) : undefined;
      if (fiscalYear !== undefined && !Number.isInteger(fiscalYear)) {
        throw new DomainError("INVALID_FISCAL_YEAR", 400, undefined, "year must be a year");
      }
      const monthNum = month === undefined || month === "all" ? 0 : Number(month);
      if (!Number.isInteger(monthNum) || monthNum < 0 || monthNum > 12) {
        throw new DomainError("INVALID_MONTH", 400, undefined, "month must be 1-12 or 0 for all");
      }
      const plan = await findApprovedPlan(companyId, {
        budgetId: typeof budgetId === "string" ? budgetId : undefined,
        year: fiscalYear,
      });
      if (!plan) return res.json([]);
      const report = await computeBudgetVariance(plan);
      const accounts = await storage.getAccountsByCompanyId(companyId);
      const nameById = new Map(accounts.map((a) => [a.id, a.nameEn]));
      const rows = report.varianceLines
        .filter((l) => l.accountId)
        .map((l) => {
          const picked = Object.values(l.months).filter(
            (m) => monthNum === 0 || Number(m.periodKey.slice(5, 7)) === monthNum
          );
          const budgeted = Math.round(picked.reduce((s, m) => s + m.budget * 100, 0)) / 100;
          const actual = Math.round(picked.reduce((s, m) => s + m.actual * 100, 0)) / 100;
          return {
            budgetId: plan.id,
            lineId: l.id,
            accountId: l.accountId,
            accountName: nameById.get(l.accountId as string) ?? l.category,
            accountType: l.accountType,
            category: l.category,
            budgeted,
            actual,
            ...varianceFor(l.accountType, budgeted, actual),
          };
        })
        .filter((r) => r.budgeted !== 0 || r.actual !== 0);
      res.json(rows);
    })
  );

  // Get KPIs
  app.get(
    "/api/analytics/kpis",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const userId = (req as any).user?.id;
      const { companyId } = req.query;

      if (!companyId) {
        return res.status(400).json({ message: "Company ID required" });
      }

      const companyUsers = await storage.getCompanyUsersByCompanyId(companyId as string);
      if (!companyUsers.some((cu) => cu.userId === userId)) {
        return res.status(403).json({ message: "Access denied" });
      }

      // Get stored KPIs
      const kpis = await storage.getFinancialKpis(companyId as string);
      res.json(kpis);
    })
  );

  // Insights on the ledger basis: posted P&L (fiscal year to date) and open
  // receivable balances. Same figures as the dashboard and the P&L report.
  app.get(
    "/api/analytics/insights",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.query;
      if (typeof companyId !== "string" || !companyId) {
        return res.status(400).json({ message: "Company ID required" });
      }
      await assertReportAccess(req, companyId);
      const today = uaeToday();
      const company = await loadCompany(companyId);
      const [pl, ar] = await Promise.all([
        profitAndLoss({
          companyId,
          from: fiscalYearStart(today, company.fiscalYearStartMonth),
          to: today,
        }),
        agedReceivables({ companyId, asOf: today }),
      ]);

      const insights: Array<Record<string, unknown>> = [];
      if (pl.totalIncome > 0) {
        const margin = (pl.netProfit / pl.totalIncome) * 100;
        const basis = "net profit / revenue, fiscal year to date, posted ledger";
        if (margin > 20) {
          insights.push({
            id: "1",
            type: "trend",
            title: "Strong Profit Margin",
            description: `Your profit margin is ${margin.toFixed(1)}% (${basis}).`,
            impact: "Healthy financial position",
            priority: "low",
            actionable: false,
            margin,
          });
        } else if (margin < 10) {
          insights.push({
            id: "2",
            type: "warning",
            title: "Low Profit Margin Alert",
            description: `Your profit margin is ${margin.toFixed(1)}% (${basis}), below the 10% review line.`,
            impact: "May need cost optimization",
            priority: "high",
            actionable: true,
            action: "Review expenses",
            margin,
          });
        }
      }
      if (ar.totals.total > 0) {
        const overdue = ar.totals.days30 + ar.totals.days60 + ar.totals.days90 + ar.totals.over90;
        insights.push({
          id: "3",
          type: "opportunity",
          title: "Outstanding Collections",
          description: `You have AED ${ar.totals.total.toFixed(2)} in unpaid invoices (remaining balances of issued invoices).`,
          impact: `AED ${overdue.toFixed(2)} of it is overdue`,
          priority: ar.totals.total > 50000 ? "high" : "medium",
          actionable: true,
          action: "Send reminders",
        });
      }
      res.json(insights);
    })
  );

  // E-Commerce integrations: real adapters in server/services/ecommerce (W5-B, R19-03).
  registerEcommerceRoutes(app);

  // =====================================
  // ANALYTICS
  // =====================================

  // Track analytics event. The caller's user id is always recorded; a companyId is stored only
  // when the caller has access to that company.
  app.post(
    "/api/analytics/event",
    authMiddleware,
    // companyId is accepted here but only stored after an access check below.
    strictBody(analyticsEventBody, { allowServerOwned: ["companyId"] }),
    asyncHandler(async (req: Request, res: Response) => {
      const userId = (req as any).user?.id;
      const validated = parsedBody<z.output<typeof analyticsEventBody>>(req);

      if (validated.companyId && !(await storage.hasCompanyAccess(userId, validated.companyId))) {
        throw new DomainError("COMPANY_ACCESS_DENIED", 403, undefined, "Access denied");
      }

      const event = await storage.createAnalyticsEvent({
        userId,
        companyId: validated.companyId ?? null,
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
    })
  );

  // PLATFORM-WIDE analytics dashboard: platform admins only (R13-03). Customers use
  // /api/analytics/my-dashboard, which is scoped to their own companies.
  app.get(
    "/api/analytics/dashboard",
    authMiddleware,
    adminMiddleware,
    asyncHandler(async (_req: Request, res: Response) => {
      const events = await storage.getAnalyticsEvents({ limit: 5000 });
      const metrics = await storage.getFeatureUsageMetrics();
      res.json({ ...summariseEvents(events), featureMetrics: metrics });
    })
  );

  // User-scoped variant: only events recorded for the caller's accessible companies or by the
  // caller. Platform-wide feature metrics are not included.
  app.get(
    "/api/analytics/my-dashboard",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const { id: userId, firmRole } = (req as any).user;
      const companies = await storage.getAccessibleCompanies(userId, firmRole, false);
      const companyIds = companies.map((c) => c.id);
      const [byCompany, byUser] = await Promise.all([
        storage.getAnalyticsEvents({ companyIds, limit: 5000 }),
        storage.getAnalyticsEvents({ userId, limit: 5000 }),
      ]);
      const merged = new Map<string, AnalyticsEventRow>();
      for (const e of [...byCompany, ...byUser]) merged.set(e.id, e);
      const events = [...merged.values()].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      res.json({ ...summariseEvents(events), featureMetrics: [] });
    })
  );

  // Platform-wide feature usage: platform admins only (R13-03).
  app.get(
    "/api/analytics/feature-usage",
    authMiddleware,
    adminMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const feature = typeof req.query.feature === "string" ? req.query.feature : undefined;
      const metrics = await storage.getFeatureUsageMetrics(feature);
      res.json(metrics);
    })
  );

  // =====================================
  // Company-Scoped Financial Analytics
  // =====================================

  // GET /api/companies/:companyId/analytics/cash-forecast
  // 30/60/90 day cash positions from the document-driven forecast (no averages).
  app.get(
    "/api/companies/:companyId/analytics/cash-forecast",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      await assertReportAccess(req, companyId);
      const f = await generateCashFlowForecast(companyId, { days: 90 });
      const at = (days: number) => {
        const limit = addDays(f.asOf, days - 1);
        const upTo = f.items.filter((i) => i.date <= limit);
        const income = upTo
          .filter((i) => i.amount > 0)
          .reduce((sum, i) => sum + Math.round(i.amount * 100), 0);
        const expenses = upTo
          .filter((i) => i.amount < 0)
          .reduce((sum, i) => sum - Math.round(i.amount * 100), 0);
        return {
          days,
          projectedDate: addDays(f.asOf, days),
          projectedCash: (Math.round(f.currentBalance * 100) + income - expenses) / 100,
          projectedIncome: income / 100,
          projectedExpenses: expenses / 100,
        };
      };
      res.json({
        currentCash: f.currentBalance,
        weightedReceivables: f.summary.receivablesOpen,
        outstandingPayables: f.summary.payablesOpen,
        insufficientData: f.insufficientData,
        insights: f.insights,
        projections: [30, 60, 90].map(at),
      });
    })
  );

  // GET /api/companies/:companyId/analytics/profit-trend?months=12
  // Monthly revenue, expenses and net profit from the posted ledger (UAE months).
  app.get(
    "/api/companies/:companyId/analytics/profit-trend",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      await assertReportAccess(req, companyId);
      const monthCount = Math.min(Math.max(parseInt(req.query.months as string) || 12, 1), 36);
      const trend = await getMonthlyTrends(companyId, uaeToday(), monthCount);
      res.json(
        trend.map((t) => ({
          month: t.key,
          revenue: t.revenue,
          expenses: t.expenses,
          netProfit: t.netProfit,
        }))
      );
    })
  );

  // GET /api/companies/:companyId/analytics/top-customers?limit=10
  // Top customers by issued invoice value (draft/void/cancelled excluded);
  // outstanding = total less payments received (R13-02).
  app.get(
    "/api/companies/:companyId/analytics/top-customers",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      await assertReportAccess(req, companyId);
      const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 10, 1), 50);
      const { rows } = await pool.query(
        `WITH paid AS (
           SELECT invoice_id, SUM(amount) AS amt FROM invoice_payments WHERE company_id = $1 GROUP BY invoice_id
         )
         SELECT COALESCE(NULLIF(TRIM(i.customer_name), ''), 'Unknown') AS name,
                COUNT(*)::int AS invoice_count,
                SUM(ROUND(i.total * COALESCE(NULLIF(i.exchange_rate, 0), 1) * 100))::bigint AS total,
                SUM(ROUND(LEAST(COALESCE(p.amt, 0), i.total) * COALESCE(NULLIF(i.exchange_rate, 0), 1) * 100))::bigint AS paid
           FROM invoices i LEFT JOIN paid p ON p.invoice_id = i.id
          WHERE i.company_id = $1 AND i.status NOT IN ('draft', 'void', 'cancelled')
          GROUP BY 1 ORDER BY total DESC, name LIMIT $2`,
        [companyId, limit]
      );
      res.json(
        rows.map((r: Record<string, string | number>) => ({
          name: r.name,
          invoiceCount: r.invoice_count,
          total: Number(r.total) / 100,
          paidTotal: Number(r.paid) / 100,
          outstanding: (Number(r.total) - Number(r.paid)) / 100,
        }))
      );
    })
  );

  // GET /api/companies/:companyId/analytics/top-suppliers?limit=10
  // Top suppliers by approved vendor bills and receipts (void/cancelled/draft excluded).
  app.get(
    "/api/companies/:companyId/analytics/top-suppliers",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      await assertReportAccess(req, companyId);
      const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 10, 1), 50);
      const { rows } = await pool.query(
        `SELECT name, SUM(total)::bigint AS total, SUM(n)::int AS receipt_count FROM (
           SELECT COALESCE(NULLIF(TRIM(vendor_name), ''), 'Unknown') AS name,
                  SUM(ROUND(COALESCE(total_amount, 0) * COALESCE(NULLIF(exchange_rate, 0), 1) * 100)) AS total,
                  COUNT(*) AS n
             FROM vendor_bills
            WHERE company_id = $1 AND COALESCE(status, 'pending') NOT IN ('draft', 'pending', 'void', 'cancelled', 'rejected')
            GROUP BY 1
           UNION ALL
           SELECT COALESCE(NULLIF(TRIM(merchant), ''), 'Unknown') AS name,
                  SUM(ROUND((COALESCE(amount, 0) + COALESCE(vat_amount, 0)) * COALESCE(NULLIF(exchange_rate, 0), 1) * 100)) AS total,
                  COUNT(*) AS n
             FROM receipts WHERE company_id = $1
            GROUP BY 1
         ) s GROUP BY name ORDER BY total DESC, name LIMIT $2`,
        [companyId, limit]
      );
      res.json(
        rows.map((r: Record<string, string | number>) => ({
          name: r.name,
          total: Number(r.total) / 100,
          receiptCount: r.receipt_count,
        }))
      );
    })
  );
}

/** E-commerce integrations: real adapters in server/services/ecommerce (W5-B, R19-03, R19-08). */
function registerEcommerceRoutes(app: Express) {
  app.get(
    "/api/integrations/ecommerce",
    authMiddleware,
    requirePermission("reports.read"),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = companyQuery.parse(req.query);
      const rows = await db
        .select()
        .from(ecommerceIntegrations)
        .where(eq(ecommerceIntegrations.companyId, companyId))
        .orderBy(desc(ecommerceIntegrations.createdAt));
      res.json(rows.map(maskIntegrationSecrets));
    })
  );

  // MUST be before :integrationId routes
  app.get(
    "/api/integrations/ecommerce/transactions",
    authMiddleware,
    requirePermission("reports.read"),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = companyQuery.parse(req.query);
      const rows = await db
        .select()
        .from(ecommerceTransactions)
        .where(eq(ecommerceTransactions.companyId, companyId))
        .orderBy(desc(ecommerceTransactions.transactionDate))
        .limit(500);
      res.json(rows);
    })
  );

  app.post(
    "/api/integrations/ecommerce/connect",
    authMiddleware,
    requireCustomer,
    requirePermission("settings.company"),
    // companyId names the tenant (checked by requirePermission above), not a client-owned field.
    strictBody(connectBody, { allowServerOwned: ["companyId"] }),
    asyncHandler(async (req: Request, res: Response) => {
      const body = parsedBody<z.output<typeof connectBody>>(req);
      const integration = await connectIntegration(body.companyId, body);
      res.status(201).json(maskIntegrationSecrets(integration));
    })
  );

  app.post(
    "/api/integrations/ecommerce/:integrationId/sync",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const integration = await integrationFor(req, "settings.company");
      const result = await syncIntegration(integration, req.user!.id);
      res.json(result);
    })
  );

  app.patch(
    "/api/integrations/ecommerce/:integrationId/toggle",
    authMiddleware,
    requireCustomer,
    strictBody(toggleBody),
    asyncHandler(async (req: Request, res: Response) => {
      const integration = await integrationFor(req, "settings.company");
      const { isActive } = parsedBody<z.output<typeof toggleBody>>(req);
      if (isActive && integration.connectionStatus !== "connected") {
        throw new DomainError(
          "INTEGRATION_NOT_CONNECTED",
          409,
          undefined,
          "Reconnect with valid credentials before enabling this integration."
        );
      }
      await db
        .update(ecommerceIntegrations)
        .set({ isActive, updatedAt: new Date() })
        .where(
          and(
            eq(ecommerceIntegrations.id, integration.id),
            eq(ecommerceIntegrations.companyId, integration.companyId)
          )
        );
      res.json({ message: "Integration updated" });
    })
  );

  // Disconnect: credentials are destroyed; imported documents stay.
  app.delete(
    "/api/integrations/ecommerce/:integrationId",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const integration = await integrationFor(req, "settings.company");
      await db
        .update(ecommerceIntegrations)
        .set({
          isActive: false,
          accessToken: null,
          apiKey: null,
          refreshToken: null,
          connectionStatus: "not_connected",
          updatedAt: new Date(),
        })
        .where(eq(ecommerceIntegrations.id, integration.id));
      res.json({ message: "Integration disconnected" });
    })
  );
}
