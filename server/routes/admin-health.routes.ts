/**
 * Admin Health Routes
 * ───────────────────
 * Provides health overview and deadline tracking endpoints
 * for the enhanced admin dashboard.
 */

import type { Request, Response } from 'express';
import { Router } from 'express';
import type { Express } from 'express';

import { storage } from '../storage';
import { authMiddleware, adminMiddleware } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { createLogger } from '../config/logger';

const logger = createLogger('admin-health-routes');

export function registerAdminHealthRoutes(app: Express): void {
  const router = Router();

  // Apply auth + admin middleware only to /admin/* paths (not all /api/*)
  router.use('/admin', authMiddleware as any);
  router.use('/admin', adminMiddleware as any);

  // =========================================
  // GET /api/admin/clients/health-overview
  // Returns health status for all client companies
  // =========================================
  router.get(
    '/admin/clients/health-overview',
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
              if (inv.status === 'paid' || inv.status === 'void') return false;
              const invoiceDate = inv.date ? new Date(inv.date) : null;
              return invoiceDate && invoiceDate < thirtyDaysAgo;
            });

            // Count overdue compliance tasks
            const overdueTasks = complianceTasksList.filter((task) => {
              if (task.status === 'completed' || task.status === 'cancelled') return false;
              const dueDate = task.dueDate ? new Date(task.dueDate) : null;
              return dueDate && dueDate < now;
            });

            const totalOverdue = overdueInvoices.length + overdueTasks.length;

            // Determine health status
            let status: 'healthy' | 'attention' | 'critical';
            if (totalOverdue === 0) {
              status = 'healthy';
            } else if (totalOverdue <= 3) {
              status = 'attention';
            } else {
              status = 'critical';
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
                if (task.status === 'completed' || task.status === 'cancelled') return false;
                const dueDate = task.dueDate ? new Date(task.dueDate) : null;
                return dueDate && dueDate >= now;
              })
              .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());

            const nextDeadline = upcomingTasks.length > 0
              ? new Date(upcomingTasks[0].dueDate).toISOString()
              : null;

            return {
              companyId: company.id,
              companyName: company.name,
              status,
              outstandingInvoices: overdueInvoices.length,
              lastActivity,
              nextDeadline,
            };
          } catch (err: any) {
            logger.error({ companyId: company.id, error: err.message }, 'Error computing health for company');
            return {
              companyId: company.id,
              companyName: company.name,
              status: 'attention' as const,
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
    '/admin/deadlines',
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
            if (task.status === 'completed' || task.status === 'cancelled') continue;
            const dueDate = task.dueDate ? new Date(task.dueDate) : null;
            if (!dueDate) continue;
            if (dueDate > ninetyDaysFromNow) continue;

            const daysRemaining = Math.ceil(
              (dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
            );

            // Map category to deadline type label
            let deadlineType = 'Other';
            switch (task.category) {
              case 'vat_filing': deadlineType = 'VAT Filing'; break;
              case 'corporate_tax': deadlineType = 'Corporate Tax'; break;
              case 'document_upload': deadlineType = 'Document Upload'; break;
              case 'payment': deadlineType = 'Payment'; break;
              case 'review': deadlineType = 'Review'; break;
              default: deadlineType = task.category || 'Other';
            }

            let status = task.status || 'pending';
            if (daysRemaining < 0) status = 'overdue';

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
            if (vr.status === 'filed' || vr.status === 'submitted') continue;
            const dueDate = vr.dueDate ? new Date(vr.dueDate) : null;
            if (!dueDate) continue;
            if (dueDate > ninetyDaysFromNow) continue;

            const daysRemaining = Math.ceil(
              (dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
            );

            let status = vr.status || 'draft';
            if (daysRemaining < 0) status = 'overdue';

            allDeadlines.push({
              clientName: company.name,
              companyId: company.id,
              deadlineType: 'VAT Filing',
              dueDate: dueDate.toISOString(),
              daysRemaining,
              status,
            });
          }
        } catch (err: any) {
          logger.error({ companyId: company.id, error: err.message }, 'Error fetching deadlines for company');
        }
      }

      // Sort by urgency (soonest first, overdue at top)
      allDeadlines.sort((a, b) => a.daysRemaining - b.daysRemaining);

      res.json(allDeadlines);
    })
  );

  // Mount under /api
  app.use('/api', router);
}
