import type { Express, Request, Response } from 'express';
import { authMiddleware, requireCustomer } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { storage } from '../storage';

export function registerComplianceDashboardRoutes(app: Express) {
  // =====================================
  // COMPLIANCE DASHBOARD (UAE Overview)
  // =====================================

  // Get compliance overview for a company
  app.get("/api/companies/:companyId/compliance/overview", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).user.id;
    const { companyId } = req.params;

    const hasAccess = await storage.hasCompanyAccess(userId, companyId);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // --- VAT Status ---
    let vatStatus: {
      lastReturn: string | null;
      nextDue: string | null;
      filingStatus: 'up_to_date' | 'overdue' | 'due_soon';
    } = { lastReturn: null, nextDue: null, filingStatus: 'up_to_date' };

    try {
      const vatReturns = await storage.getVatReturnsByCompanyId(companyId);
      if (vatReturns.length > 0) {
        // Sort by period end descending to find the latest
        const sorted = [...vatReturns].sort((a, b) =>
          new Date(b.periodEnd).getTime() - new Date(a.periodEnd).getTime()
        );
        const latest = sorted[0];
        vatStatus.lastReturn = new Date(latest.periodEnd).toISOString();

        // Estimate next due: 28 days after the latest period end
        const nextDue = new Date(latest.periodEnd);
        nextDue.setDate(nextDue.getDate() + 28);
        vatStatus.nextDue = nextDue.toISOString();

        const now = new Date();
        if (nextDue < now) {
          vatStatus.filingStatus = 'overdue';
        } else {
          const daysUntilDue = Math.ceil((nextDue.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
          vatStatus.filingStatus = daysUntilDue <= 14 ? 'due_soon' : 'up_to_date';
        }
      }
    } catch {
      // Storage method may not exist; keep defaults
    }

    // --- Corporate Tax Status ---
    let corporateTaxStatus: {
      lastReturn: string | null;
      nextDue: string | null;
      status: 'up_to_date' | 'overdue' | 'due_soon';
    } = { lastReturn: null, nextDue: null, status: 'up_to_date' };

    try {
      const taxReturns = await storage.getCorporateTaxReturnsByCompanyId(companyId);
      if (taxReturns.length > 0) {
        const sorted = [...taxReturns].sort((a, b) =>
          new Date(b.taxPeriodEnd).getTime() - new Date(a.taxPeriodEnd).getTime()
        );
        const latest = sorted[0];
        corporateTaxStatus.lastReturn = new Date(latest.taxPeriodEnd).toISOString();

        // UAE corporate tax: 9 months after financial year-end
        const nextDue = new Date(latest.taxPeriodEnd);
        nextDue.setMonth(nextDue.getMonth() + 9);
        corporateTaxStatus.nextDue = nextDue.toISOString();

        const now = new Date();
        if (nextDue < now) {
          corporateTaxStatus.status = 'overdue';
        } else {
          const daysUntilDue = Math.ceil((nextDue.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
          corporateTaxStatus.status = daysUntilDue <= 30 ? 'due_soon' : 'up_to_date';
        }
      }
    } catch {
      // Storage method may not exist; keep defaults
    }

    // --- Document Completeness ---
    let documentCompleteness = { totalDocuments: 0, withVersionHistory: 0 };

    try {
      const invoices = await storage.getInvoicesByCompanyId(companyId);
      const receipts = await storage.getReceiptsByCompanyId(companyId);
      documentCompleteness.totalDocuments = invoices.length + receipts.length;

      // Check how many have at least one version tracked
      let withVersions = 0;
      for (const inv of invoices) {
        const count = await storage.getDocumentVersionCount(companyId, 'invoice', inv.id);
        if (count > 0) withVersions++;
      }
      for (const rec of receipts) {
        const count = await storage.getDocumentVersionCount(companyId, 'receipt', rec.id);
        if (count > 0) withVersions++;
      }
      documentCompleteness.withVersionHistory = withVersions;
    } catch {
      // Keep defaults
    }

    // --- Audit Readiness Score ---
    let auditScore = 0;
    const issues: string[] = [];

    // 20pts: VAT filed
    try {
      const vatReturns = await storage.getVatReturnsByCompanyId(companyId);
      if (vatReturns.length > 0) {
        auditScore += 20;
      } else {
        issues.push('No VAT returns filed');
      }
    } catch {
      issues.push('Unable to check VAT returns');
    }

    // 20pts: Chart of accounts exists
    try {
      const accounts = await storage.getAccountsByCompanyId(companyId);
      if (accounts.length > 0) {
        auditScore += 20;
      } else {
        issues.push('No chart of accounts configured');
      }
    } catch {
      issues.push('Unable to check chart of accounts');
    }

    // 20pts: Recent journal entries (within last 90 days)
    try {
      const entries = await storage.getJournalEntriesByCompanyId(companyId);
      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
      const recentEntries = entries.filter(e => new Date(e.date) >= ninetyDaysAgo);
      if (recentEntries.length > 0) {
        auditScore += 20;
      } else {
        issues.push('No journal entries in the last 90 days');
      }
    } catch {
      issues.push('Unable to check journal entries');
    }

    // 20pts: Bank reconciliation (check if reconciliation rules exist as proxy)
    try {
      const rules = await storage.getReconciliationRulesByCompanyId(companyId);
      if (rules.length > 0) {
        auditScore += 20;
      } else {
        issues.push('No bank reconciliation rules configured');
      }
    } catch {
      issues.push('Bank reconciliation not set up');
    }

    // 20pts: Document backups exist
    try {
      const backups = await storage.getBackupsByCompanyId(companyId);
      const completedBackups = backups.filter(b => b.status === 'completed');
      if (completedBackups.length > 0) {
        auditScore += 20;
      } else {
        issues.push('No completed data backups');
      }
    } catch {
      issues.push('Unable to check backups');
    }

    const auditReadiness = {
      score: auditScore,
      issues,
    };

    res.json({
      vatStatus,
      corporateTaxStatus,
      documentCompleteness,
      auditReadiness,
    });
  }));
}
