/**
 * Admin Health Routes
 * ───────────────────
 * Provides health overview and deadline tracking endpoints
 * for the enhanced admin dashboard.
 */

import type { Request, Response } from "express";
import { Router } from "express";
import type { Express } from "express";

import { storage } from "../storage";
import { authMiddleware, adminMiddleware, optionalAuthUser } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { createLogger } from "../config/logger";
import { getPoolStats, pingDb, pool } from "../db";
import { monitoringConfigured, monitoringDsnIgnored } from "../services/monitoring";
import { ssoStatus } from "./auth.routes";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import * as schema from "../../shared/schema";
import { errorMessage } from "../errors";

const logger = createLogger("admin-health-routes");

export function registerAdminHealthRoutes(app: Express): void {
  const router = Router();

  // Apply auth + admin middleware only to /admin/* paths (not all /api/*)
  router.use("/admin", authMiddleware);
  router.use("/admin", adminMiddleware);

  // =========================================
  // GET /api/admin/schema-health
  // Diffs the live database against the Drizzle schema (plus the raw-SQL
  // bill-pay tables). Surfaces tables/columns that exist in code but not in
  // the database — the recurring failure mode of baselined migration ledgers
  // where a migration is marked applied without ever running.
  // =========================================
  router.get(
    "/admin/schema-health",
    asyncHandler(async (_req: Request, res: Response) => {
      // Expected shape from the Drizzle schema definitions.
      const expected = new Map<string, Set<string>>();
      for (const exported of Object.values(schema)) {
        let cfg;
        try {
          cfg = getTableConfig(exported as PgTable);
        } catch {
          continue; // not a pgTable export (relation, enum, zod schema, ...)
        }
        const cols = new Set<string>(cfg.columns.map((c) => c.name));
        expected.set(cfg.name, cols);
      }
      // Raw-SQL tables managed outside Drizzle.
      expected.set(
        "vendor_bills",
        new Set(["id", "company_id", "reverse_charge", "retention_expires_at"])
      );
      expected.set("bill_line_items", new Set(["id", "bill_id", "reverse_charge"]));
      expected.set("bill_payments", new Set(["id", "bill_id", "retention_expires_at"]));
      expected.set(
        "invoice_number_sequences",
        new Set(["company_id", "doc_type", "year", "last_value"])
      );
      // Raw-SQL module tables (created by migrations, not in Drizzle).
      for (const t of [
        "fixed_assets",
        "depreciation_schedules",
        "employees",
        "payroll_runs",
        "payroll_items",
        "budget_plans",
        "budget_lines",
        "expense_claims",
        "expense_claim_items",
        "ai_company_rules",
        "ai_gl_queue",
      ]) {
        expected.set(t, new Set(["id"]));
      }

      const live = await pool.query(
        `SELECT table_name, column_name, is_nullable, column_default, data_type
         FROM information_schema.columns WHERE table_schema = 'public'`
      );
      const liveCols = new Map<
        string,
        Map<string, { nullable: boolean; hasDefault: boolean; type: string }>
      >();
      for (const row of live.rows) {
        if (!liveCols.has(row.table_name)) liveCols.set(row.table_name, new Map());
        liveCols.get(row.table_name)!.set(row.column_name, {
          nullable: row.is_nullable === "YES",
          hasDefault: row.column_default !== null,
          type: row.data_type,
        });
      }

      const missingTables: string[] = [];
      const missingColumns: Record<string, string[]> = {};
      // Live columns the code schema doesn't know about. A legacy NOT NULL
      // extra column without a default breaks every INSERT through the ORM —
      // the inverse failure mode of a missing column.
      const extraColumnsBlockingInserts: Record<string, string[]> = {};
      for (const [table, cols] of expected) {
        const liveSet = liveCols.get(table);
        if (!liveSet) {
          missingTables.push(table);
          continue;
        }
        const missing = [...cols].filter((c) => !liveSet.has(c));
        if (missing.length) missingColumns[table] = missing;
        const blockers = [...liveSet.entries()]
          .filter(([name, meta]) => !cols.has(name) && !meta.nullable && !meta.hasDefault)
          .map(([name, meta]) => `${name} (${meta.type})`);
        if (blockers.length) extraColumnsBlockingInserts[table] = blockers;
      }

      // Optional drill-down: full live column spec for one table.
      const tableParam = typeof _req.query.table === "string" ? _req.query.table : null;
      const tableDetail = tableParam
        ? [...(liveCols.get(tableParam) ?? new Map()).entries()].map(([name, meta]) => ({
            name,
            ...meta,
          }))
        : undefined;

      res.json({
        healthy:
          missingTables.length === 0 &&
          Object.keys(missingColumns).length === 0 &&
          Object.keys(extraColumnsBlockingInserts).length === 0,
        expectedTables: expected.size,
        liveTables: liveCols.size,
        missingTables: missingTables.sort(),
        missingColumns,
        extraColumnsBlockingInserts,
        ...(tableDetail ? { tableDetail: { table: tableParam, columns: tableDetail } } : {}),
      });
    })
  );

  // =========================================
  // GET /api/admin/clients/health-overview
  // Returns health status for all client companies
  // =========================================
  router.get(
    "/admin/clients/health-overview",
    asyncHandler(async (req: Request, res: Response) => {
      const companies = await storage.getAllCompanies();

      const healthData = await Promise.all(
        companies.map(async (company) => {
          try {
            const invoices = await storage.getInvoicesByCompanyId(company.id);
            const complianceTasksList = await storage.getComplianceTasks(company.id);

            // Count overdue invoices (status is not 'paid' or 'void', and invoice date is past 30 days)
            const now = new Date();
            const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
            const overdueInvoices = invoices.filter((inv) => {
              if (inv.status === "paid" || inv.status === "void") return false;
              const invoiceDate = inv.date ? new Date(inv.date) : null;
              return invoiceDate && invoiceDate < thirtyDaysAgo;
            });

            // Count overdue compliance tasks
            const overdueTasks = complianceTasksList.filter((task) => {
              if (task.status === "completed" || task.status === "cancelled") return false;
              const dueDate = task.dueDate ? new Date(task.dueDate) : null;
              return dueDate && dueDate < now;
            });

            const totalOverdue = overdueInvoices.length + overdueTasks.length;

            // Determine health status
            let status: "healthy" | "attention" | "critical";
            if (totalOverdue === 0) {
              status = "healthy";
            } else if (totalOverdue <= 3) {
              status = "attention";
            } else {
              status = "critical";
            }

            // Find last activity (most recent invoice or task update)
            const allDates: Date[] = [];
            invoices.forEach((inv) => {
              if (inv.createdAt) allDates.push(new Date(inv.createdAt));
            });
            complianceTasksList.forEach((task) => {
              if (task.createdAt) allDates.push(new Date(task.createdAt));
            });
            allDates.sort((a, b) => b.getTime() - a.getTime());
            const lastActivity = allDates.length > 0 ? allDates[0].toISOString() : null;

            // Find next deadline from compliance tasks
            const upcomingTasks = complianceTasksList
              .filter((task) => {
                if (task.status === "completed" || task.status === "cancelled") return false;
                const dueDate = task.dueDate ? new Date(task.dueDate) : null;
                return dueDate && dueDate >= now;
              })
              .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());

            const nextDeadline =
              upcomingTasks.length > 0 ? new Date(upcomingTasks[0].dueDate).toISOString() : null;

            return {
              companyId: company.id,
              companyName: company.name,
              status,
              outstandingInvoices: overdueInvoices.length,
              lastActivity,
              nextDeadline,
            };
          } catch (err: unknown) {
            logger.error(
              { companyId: company.id, error: errorMessage(err) },
              "Error computing health for company"
            );
            return {
              companyId: company.id,
              companyName: company.name,
              status: "attention" as const,
              outstandingInvoices: 0,
              lastActivity: null,
              nextDeadline: null,
            };
          }
        })
      );

      res.json(healthData);
    })
  );

  // =========================================
  // GET /api/admin/deadlines
  // Returns upcoming deadlines across all clients (next 90 days)
  // =========================================
  router.get(
    "/admin/deadlines",
    asyncHandler(async (req: Request, res: Response) => {
      const companies = await storage.getAllCompanies();
      const now = new Date();
      const ninetyDaysFromNow = new Date();
      ninetyDaysFromNow.setDate(ninetyDaysFromNow.getDate() + 90);

      const allDeadlines: Array<{
        clientName: string;
        companyId: string;
        deadlineType: string;
        dueDate: string;
        daysRemaining: number;
        status: string;
      }> = [];

      for (const company of companies) {
        try {
          // Get compliance tasks deadlines
          const tasks = await storage.getComplianceTasks(company.id);
          for (const task of tasks) {
            if (task.status === "completed" || task.status === "cancelled") continue;
            const dueDate = task.dueDate ? new Date(task.dueDate) : null;
            if (!dueDate) continue;
            if (dueDate > ninetyDaysFromNow) continue;

            const daysRemaining = Math.ceil(
              (dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
            );

            // Map category to deadline type label
            let deadlineType = "Other";
            switch (task.category) {
              case "vat_filing":
                deadlineType = "VAT Filing";
                break;
              case "corporate_tax":
                deadlineType = "Corporate Tax";
                break;
              case "document_upload":
                deadlineType = "Document Upload";
                break;
              case "payment":
                deadlineType = "Payment";
                break;
              case "review":
                deadlineType = "Review";
                break;
              default:
                deadlineType = task.category || "Other";
            }

            let status = task.status || "pending";
            if (daysRemaining < 0) status = "overdue";

            allDeadlines.push({
              clientName: company.name,
              companyId: company.id,
              deadlineType,
              dueDate: dueDate.toISOString(),
              daysRemaining,
              status,
            });
          }

          // Get VAT return deadlines
          const vatReturns = await storage.getVatReturnsByCompanyId(company.id);
          for (const vr of vatReturns) {
            if (vr.status === "filed" || vr.status === "submitted") continue;
            const dueDate = vr.dueDate ? new Date(vr.dueDate) : null;
            if (!dueDate) continue;
            if (dueDate > ninetyDaysFromNow) continue;

            const daysRemaining = Math.ceil(
              (dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
            );

            let status = vr.status || "draft";
            if (daysRemaining < 0) status = "overdue";

            allDeadlines.push({
              clientName: company.name,
              companyId: company.id,
              deadlineType: "VAT Filing",
              dueDate: dueDate.toISOString(),
              daysRemaining,
              status,
            });
          }
        } catch (err: unknown) {
          logger.error(
            { companyId: company.id, error: errorMessage(err) },
            "Error fetching deadlines for company"
          );
        }
      }

      // Sort by urgency (soonest first, overdue at top)
      allDeadlines.sort((a, b) => a.daysRemaining - b.daysRemaining);

      res.json(allDeadlines);
    })
  );

  // =========================================
  // GET /api/admin/auth/sso-status (R01-15)
  // OAuth provider configuration and the SAML capability (requires_external).
  // =========================================
  router.get(
    "/admin/auth/sso-status",
    asyncHandler(async (_req: Request, res: Response) => {
      res.json(ssoStatus());
    })
  );

  // Mount under /api
  app.use("/api", router);
}

/**
 * GET /health (R17-13). Anonymous callers (load balancers, uptime checks)
 * get only `{ status }`; node version, pid, memory and pool internals are
 * returned to authenticated platform admins only.
 */
export function createHealthHandler(environment: string) {
  return async (req: Request, res: Response): Promise<void> => {
    const ping = await pingDb();
    const status = ping.ok ? "ok" : "degraded";
    const code = ping.ok ? 200 : 503;
    const viewer = await optionalAuthUser(req).catch(() => null);
    if (!viewer?.isAdmin) {
      res.status(code).json({ status });
      return;
    }
    const mem = process.memoryUsage();
    res.status(code).json({
      status,
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment,
      version: process.env.APP_VERSION || "1.0.0",
      node: process.version,
      pid: process.pid,
      memory: {
        rssMB: Math.round(mem.rss / 1024 / 1024),
        heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024),
        heapTotalMB: Math.round(mem.heapTotal / 1024 / 1024),
      },
      checks: {
        database: ping.ok ? "ok" : "error",
        databaseLatencyMs: ping.latencyMs,
        databaseError: ping.error,
        pool: getPoolStats(),
        errorTracking: monitoringConfigured() ? "configured" : "logs-only",
        errorTrackingNote: monitoringDsnIgnored()
          ? "DSN is set but no error forwarder is wired; errors are logged only"
          : undefined,
      },
    });
  };
}
