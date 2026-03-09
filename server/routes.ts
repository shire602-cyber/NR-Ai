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
import { registerVATRoutes } from './routes/vat.routes';
import { registerTeamRoutes } from './routes/team.routes';
import { registerPortalRoutes } from './routes/portal.routes';
import { registerAdminRoutes } from './routes/admin.routes';

const log = createLogger('routes');

export async function registerRoutes(app: Express): Promise<Server> {
  log.info('Registering route modules...');

  // ─── Core Accounting ────────────────────────────────────
  registerAuthRoutes(app);
  registerCompanyRoutes(app);
  registerAccountRoutes(app);
  registerInvoiceRoutes(app);
  registerReceiptRoutes(app);
  registerContactRoutes(app);
  registerJournalRoutes(app);

  // ─── AI & Intelligence ──────────────────────────────────
  registerAIRoutes(app);
  registerOCRRoutes(app);

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
  registerOnboardingRoutes(app);
  registerBackupRoutes(app);
  registerReferralRoutes(app);
  registerFeedbackRoutes(app);

  // ─── UAE Compliance ─────────────────────────────────────
  registerVATRoutes(app);

  // ─── Team & Client Portal ──────────────────────────────
  registerTeamRoutes(app);
  registerPortalRoutes(app);

  // ─── Admin Panel ────────────────────────────────────────
  registerAdminRoutes(app);

  log.info('All route modules registered');

  return createServer(app);
}
