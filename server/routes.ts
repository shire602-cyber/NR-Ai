/**
 * Route Aggregator
 * ─────────────────
 * Registers all route modules with the Express app.
 * Each module is a self-contained domain with its own routes.
 *
 * Previously this was a 9,692-line monolith.
 * Now split into 24 focused modules.
 */

import type { Express } from 'express';
import { createServer, type Server } from 'http';
import { createLogger } from './config/logger';

// ─── Route modules ──────────────────────────────────────────
import { registerAuthRoutes } from './routes/auth.routes';
import { registerCompanyRoutes } from './routes/companies.routes';
import { registerAccountRoutes } from './routes/accounts.routes';
import { registerInvoiceRoutes } from './routes/invoices.routes';
import { registerChasingRoutes } from './routes/chasing.routes';
import { registerReceiptRoutes } from './routes/receipts.routes';
import { registerContactRoutes } from './routes/contacts.routes';
import { registerJournalRoutes } from './routes/journal.routes';
import { registerAIRoutes } from './routes/ai.routes';
import { registerDashboardRoutes } from './routes/dashboard.routes';
import { registerReportRoutes } from './routes/reports.routes';
import { registerIntegrationRoutes } from './routes/integrations.routes';
import { registerWhatsAppRoutes } from './routes/whatsapp.routes';
import { registerOCRRoutes } from './routes/ocr.routes';
import { registerAnalyticsRoutes } from './routes/analytics.routes';
import { registerNotificationRoutes } from './routes/notifications.routes';
import { registerReminderRoutes } from './routes/reminders.routes';
import { registerOnboardingRoutes } from './routes/onboarding.routes';
import { registerBackupRoutes } from './routes/backups.routes';
import { registerReferralRoutes } from './routes/referrals.routes';
import { registerFeedbackRoutes } from './routes/feedback.routes';
import { registerClientErrorRoutes } from './routes/client-errors.routes';
import { registerVATRoutes } from './routes/vat.routes';
import { registerVATAutopilotRoutes } from './routes/vat-autopilot.routes';
import { registerCorporateTaxRoutes } from './routes/corporate-tax.routes';
import { registerTeamRoutes } from './routes/team.routes';
import { registerPortalRoutes } from './routes/portal.routes';
import { registerPortalPublicRoutes } from './routes/portal.public.routes';
import { registerAdminRoutes } from './routes/admin.routes';
import { registerRecurringInvoiceRoutes } from './routes/recurring-invoices.routes';
import { registerInventoryRoutes } from './routes/inventory.routes';
import { registerPayrollRoutes } from './routes/payroll.routes';
import { registerBillPayRoutes } from './routes/bill-pay.routes';
import { registerFixedAssetRoutes } from './routes/fixed-assets.routes';
import { registerBudgetRoutes } from './routes/budgets.routes';
import { registerExpenseClaimRoutes } from './routes/expense-claims.routes';
import { registerCashFlowRoutes } from './routes/cashflow.routes';
import { registerAnomalyRoutes } from './routes/anomaly.routes';
import { registerAutoReconcileRoutes } from './routes/auto-reconcile.routes';
import { registerAIGLRoutes } from './routes/ai-gl.routes';
import { registerMonthEndRoutes } from './routes/month-end.routes';
import { registerAdminHealthRoutes } from './routes/admin-health.routes';
import { registerBankStatementRoutes } from './routes/bank-statements.routes';
import { registerExchangeRateRoutes } from './routes/exchange-rates.routes';
import { registerNRARoutes } from './routes/nra.routes';
import { registerFirmRoutes } from './routes/firm.routes';
import { registerFirmBulkRoutes } from './routes/firm-bulk.routes';
import { registerFirmCommsRoutes } from './routes/firm-comms.routes';
import { registerFirmAnalyticsRoutes } from './routes/firm-analytics.routes';
import { registerFirmCommandCenterRoutes } from './routes/firm-command-center.routes';
import { registerFirmValueOpsRoutes } from './routes/firm-value-ops.routes';
import { registerClientPortalRoutes } from './routes/client-portal.routes';
import { registerDocumentChasingRoutes } from './routes/document-chasing.routes';

const log = createLogger('routes');

export async function registerRoutes(app: Express): Promise<Server> {
  log.info('Registering route modules...');

  // ─── Core Accounting ────────────────────────────────────
  registerAuthRoutes(app);
  registerCompanyRoutes(app);
  registerAccountRoutes(app);
  registerInvoiceRoutes(app);
  registerRecurringInvoiceRoutes(app);
  registerChasingRoutes(app);
  registerReceiptRoutes(app);
  registerContactRoutes(app);
  registerJournalRoutes(app);
  registerInventoryRoutes(app);
  registerBankStatementRoutes(app);

  // ─── HR & Payroll ───────────────────────────────────────
  registerPayrollRoutes(app);
  registerExpenseClaimRoutes(app);

  // ─── Accounts Payable ───────────────────────────────────
  registerBillPayRoutes(app);

  // ─── Asset Management ───────────────────────────────────
  registerFixedAssetRoutes(app);
  registerBudgetRoutes(app);

  // ─── AI & Intelligence ──────────────────────────────────
  registerAIRoutes(app);
  registerOCRRoutes(app);
  registerCashFlowRoutes(app);
  registerAnomalyRoutes(app);
  registerAutoReconcileRoutes(app);
  registerAIGLRoutes(app);

  // ─── Month-End & Close ────────────────────────────────
  registerMonthEndRoutes(app);

  // ─── Reporting & Analytics ──────────────────────────────
  registerDashboardRoutes(app);
  registerReportRoutes(app);
  registerAnalyticsRoutes(app);

  // ─── Integrations ───────────────────────────────────────
  registerIntegrationRoutes(app);
  registerWhatsAppRoutes(app);

  // ─── Platform Features ──────────────────────────────────
  registerNotificationRoutes(app);
  registerReminderRoutes(app);
  registerDocumentChasingRoutes(app);
  registerOnboardingRoutes(app);
  registerBackupRoutes(app);
  registerReferralRoutes(app);
  registerFeedbackRoutes(app);
  registerClientErrorRoutes(app);

  // ─── UAE Compliance ─────────────────────────────────────
  registerVATRoutes(app);
  registerVATAutopilotRoutes(app);
  registerCorporateTaxRoutes(app);
  registerExchangeRateRoutes(app);

  // ─── Team & Client Portal ──────────────────────────────
  registerTeamRoutes(app);
  registerPortalRoutes(app);
  registerPortalPublicRoutes(app);
  registerClientPortalRoutes(app);

  // ─── Admin Panel ────────────────────────────────────────
  registerAdminHealthRoutes(app);
  registerAdminRoutes(app);

  // ─── NRA Management Center ──────────────────────────────
  registerNRARoutes(app);
  registerFirmRoutes(app);
  registerFirmBulkRoutes(app);
  registerFirmCommsRoutes(app);
  registerFirmAnalyticsRoutes(app);
  registerFirmCommandCenterRoutes(app);
  registerFirmValueOpsRoutes(app);

  log.info('All route modules registered');

  return createServer(app);
}
