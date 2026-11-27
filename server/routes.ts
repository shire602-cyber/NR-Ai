/**
 * Route Aggregator
 * ─────────────────
 * Registers all route modules with the Express app.
 * Each module is a self-contained domain with its own routes.
 *
 * Previously this was a 9,692-line monolith.
 * Now split into 24 focused modules.
 */

import type { Express } from "express";
import { createLogger } from "./config/logger";
import { companyRolePolicy } from "./middleware/companyRolePolicy";
import { rejectApiKeysOutsidePublicApi } from "./middleware/api-key-auth";
import { planFeaturePolicy, storageLimitPolicy, usageLimitPolicy } from "./middleware/featureGate";
import { trialAccessPolicy } from "./middleware/trialAccessPolicy";
import { registerPublicApiRoutes } from "./routes/public-api.routes";
import { registerImportRoutes } from "./routes/import.routes";

// ─── Route modules ──────────────────────────────────────────
import { registerAuthRoutes } from "./routes/auth.routes";
import { registerAuditRoutes } from "./routes/audit.routes";
import { securityPolicyMiddleware } from "./services/security/policy";
import { registerCompanyRoutes } from "./routes/companies.routes";
import { registerAccountRoutes } from "./routes/accounts.routes";
import { registerInvoiceRoutes } from "./routes/invoices.routes";
import { registerEInvoiceRoutes } from "./routes/einvoice.routes";
import { registerEInvoiceAcubeRoutes } from "./routes/einvoice-acube.routes";
import { registerEInvoiceComplyanceRoutes } from "./routes/einvoice-complyance.routes";
import { registerEInvoiceProviderRoutes } from "./routes/einvoice-provider.routes";
import { registerEInvoiceIdentityRoutes } from "./routes/einvoice-identity.routes";
import { registerEInvoicePartnerRoutes } from "./routes/einvoice-partner.routes";
import { registerInvoiceShareRoutes } from "./routes/invoice-share.routes";
import { registerSalesReceiptRoutes } from "./routes/sales-receipts.routes";
import { registerInvoiceDocumentRoutes } from "./routes/invoice-documents.routes";
import { registerChasingRoutes } from "./routes/chasing.routes";
import { registerReceiptRoutes } from "./routes/receipts.routes";
import { registerContactRoutes } from "./routes/contacts.routes";
import { registerJournalRoutes } from "./routes/journal.routes";
import { registerAIRoutes } from "./routes/ai.routes";
import { registerDashboardRoutes } from "./routes/dashboard.routes";
import { registerReportRoutes } from "./routes/reports.routes";
import { registerReportDeliveryRoutes } from "./routes/report-delivery.routes";
import { registerIntegrationRoutes } from "./routes/integrations.routes";
import { registerWhatsAppRoutes } from "./routes/whatsapp.routes";
import { registerOCRRoutes } from "./routes/ocr.routes";
import { registerAnalyticsRoutes } from "./routes/analytics.routes";
import { registerNotificationRoutes } from "./routes/notifications.routes";
import { registerReminderRoutes } from "./routes/reminders.routes";
import { registerOnboardingRoutes } from "./routes/onboarding.routes";
import { registerBackupRoutes } from "./routes/backups.routes";
import { registerReferralRoutes } from "./routes/referrals.routes";
import { registerFeedbackRoutes } from "./routes/feedback.routes";
import { registerMarketingRoutes } from "./routes/marketing.routes";
import { registerNajmaHandoffRoutes } from "./routes/najma-handoff.routes";
import { registerClientErrorRoutes } from "./routes/client-errors.routes";
import { registerVATRoutes } from "./routes/vat.routes";
import { registerVATAutopilotRoutes } from "./routes/vat-autopilot.routes";
import { registerCorporateTaxRoutes } from "./routes/corporate-tax.routes";
import { registerTeamRoutes } from "./routes/team.routes";
import { registerPortalRoutes } from "./routes/portal.routes";
import { registerPortalPublicRoutes } from "./routes/portal.public.routes";
import { registerAdminRoutes } from "./routes/admin.routes";
import { registerRecurringInvoiceRoutes } from "./routes/recurring-invoices.routes";
import { registerInventoryRoutes } from "./routes/inventory.routes";
import { registerPayrollRoutes } from "./routes/payroll.routes";
import { registerBillPayRoutes } from "./routes/bill-pay.routes";
import { registerVendorRoutes } from "./routes/vendors.routes";
import { registerFixedAssetRoutes } from "./routes/fixed-assets.routes";
import { registerBudgetRoutes } from "./routes/budgets.routes";
import { registerExpenseClaimRoutes } from "./routes/expense-claims.routes";
import { registerCashFlowRoutes } from "./routes/cashflow.routes";
import { registerAnomalyRoutes } from "./routes/anomaly.routes";
import { registerNewsRoutes } from "./routes/news.routes";
import { registerAutoReconcileRoutes } from "./routes/auto-reconcile.routes";
import { registerAIGLRoutes } from "./routes/ai-gl.routes";
import { registerMonthEndRoutes } from "./routes/month-end.routes";
import { periodLockContextMiddleware } from "./services/period-lock.service";
import { registerComplianceDashboardRoutes } from "./routes/compliance-dashboard.routes";
import { registerQuoteRoutes } from "./routes/quotes.routes";
import { registerCreditNoteRoutes } from "./routes/credit-notes.routes";
import { registerPurchaseOrderRoutes } from "./routes/purchase-orders.routes";
import { registerCostCenterRoutes } from "./routes/cost-centers.routes";
import { registerFinancialStatementRoutes } from "./routes/financial-statements.routes";
import { registerReconciliationRuleRoutes } from "./routes/reconciliation-rules.routes";
import { registerInvoiceTemplateRoutes } from "./routes/invoice-templates.routes";
import { registerBankRoutes } from "./routes/bank.routes";
import { registerDocumentVersionRoutes } from "./routes/document-versions.routes";
import { registerApiKeyRoutes } from "./routes/api-keys.routes";
import { registerBillingRoutes } from "./routes/billing.routes";
import { registerCompanyAutomationRoutes } from "./routes/company-automations.routes";
import { registerPushRoutes } from "./routes/push.routes";
import { registerWebhookRoutes } from "./routes/webhooks.routes";
import { registerIntegrationStatusRoutes } from "./routes/integration-status.routes";
import { registerEmailIntakeRoutes } from "./routes/email-intake.routes";
import { registerAdminHealthRoutes } from "./routes/admin-health.routes";
import { registerBankStatementRoutes } from "./routes/bank-statements.routes";
import { registerExchangeRateRoutes } from "./routes/exchange-rates.routes";
import { registerConsolidationRoutes } from "./routes/consolidation.routes";
import { registerNRARoutes } from "./routes/nra.routes";
import { registerFirmRoutes } from "./routes/firm.routes";
import { registerFirmPracticeRoutes } from "./routes/firm-practice.routes";
import { registerFirmBulkRoutes } from "./routes/firm-bulk.routes";
import { registerFirmCommsRoutes } from "./routes/firm-comms.routes";
import { registerFirmAnalyticsRoutes } from "./routes/firm-analytics.routes";
import { registerFirmCommandCenterRoutes } from "./routes/firm-command-center.routes";
import { registerFirmValueOpsRoutes } from "./routes/firm-value-ops.routes";
import { registerFirmGrowthRoutes } from "./routes/firm-growth.routes";
import { registerFirmVatWorkspaceRoutes } from "./routes/firm-vat-workspace.routes";
import { registerClientPortalRoutes } from "./routes/client-portal.routes";
import { registerPortalInvitationRoutes } from "./routes/portal-invitations.routes";
import { registerPaymentLinkRoutes } from "./routes/payment-links.routes";
import { registerPublicPaymentRoutes } from "./routes/public-payments.routes";
import { registerOutboxRoutes } from "./outbox";
import { registerDocumentChasingRoutes } from "./routes/document-chasing.routes";
import { registerComplianceCalendarRoutes } from "./routes/compliance-calendar.routes";
import { complianceObligationRefreshObserver } from "./routes/compliance-obligation-refresh";
import { registerEvidenceCenterRoutes } from "./routes/evidence-center.routes";

const log = createLogger("routes");

export async function registerRoutes(app: Express, { retireBankingOnStartup = true } = {}) {
  log.info("Registering route modules...");
  app.use(periodLockContextMiddleware); // W2-B: soft-lock override reason visible to write paths

  // ─── Public API (W5-B, R19-01) ──────────────────────────
  // API keys authenticate /api/v1 only; anywhere else a key is refused.
  app.use("/api", rejectApiKeysOutsidePublicApi);
  registerPublicApiRoutes(app);

  // ─── Central company-role policy (W2-C, R01-02) ─────────
  // Runs before every route module: resolves the permission for METHOD+path
  // and the company the request acts on, then checks the caller's
  // company_users role. See server/middleware/companyRolePolicy.ts.
  app.use("/api", companyRolePolicy);
  app.use("/api", securityPolicyMiddleware); // W5-E: MFA policy, step-up, email verification

  // ─── Plan gates and usage meter (W5-B, R19-04, R19-05) ──
  // METHOD + path tables in server/middleware/featureGate.ts: feature flags
  // (403 TIER_LOCKED) and monthly quotas (402 USAGE_LIMIT_REACHED).
  app.use("/api", trialAccessPolicy, planFeaturePolicy, usageLimitPolicy, storageLimitPolicy);
  // S4: refresh the stored compliance calendar after writes that change its inputs.
  app.use("/api", complianceObligationRefreshObserver);

  // ─── Core Accounting ────────────────────────────────────
  registerAuthRoutes(app);
  registerAuditRoutes(app); // W5-E: audit trail, chain verify/export, MFA policy
  registerCompanyRoutes(app);
  registerAccountRoutes(app);
  registerInvoiceRoutes(app);
  registerEInvoiceRoutes(app);
  registerEInvoiceProviderRoutes(app); // E2: which accredited provider is configured
  registerEInvoiceAcubeRoutes(app); // E1: A-Cube onboarding + signed webhooks
  registerEInvoiceComplyanceRoutes(app); // E2: Complyance onboarding + signed webhooks
  registerEInvoiceIdentityRoutes(app); // WQ5: tax identity, partner choice, approver links
  registerEInvoicePartnerRoutes(app); // S04: per-company ASP appointment gate
  registerInvoiceShareRoutes(app);
  registerSalesReceiptRoutes(app);
  registerInvoiceDocumentRoutes(app);
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
  registerVendorRoutes(app);

  // ─── Asset Management ───────────────────────────────────
  registerFixedAssetRoutes(app);
  registerBudgetRoutes(app);

  // ─── AI & Intelligence ──────────────────────────────────
  registerAIRoutes(app);
  registerOCRRoutes(app);
  registerCashFlowRoutes(app);
  registerAnomalyRoutes(app);
  registerNewsRoutes(app);
  registerAutoReconcileRoutes(app);
  registerAIGLRoutes(app);

  // ─── Month-End & Close ────────────────────────────────
  registerMonthEndRoutes(app);
  registerComplianceDashboardRoutes(app);
  registerQuoteRoutes(app);
  registerCreditNoteRoutes(app);
  registerPurchaseOrderRoutes(app);
  registerCostCenterRoutes(app);
  registerFinancialStatementRoutes(app);
  registerReconciliationRuleRoutes(app);
  registerInvoiceTemplateRoutes(app);
  await registerBankRoutes(app, retireBankingOnStartup);
  registerDocumentVersionRoutes(app);
  registerApiKeyRoutes(app);
  registerBillingRoutes(app);
  registerCompanyAutomationRoutes(app);
  registerPushRoutes(app);
  registerWebhookRoutes(app);
  registerIntegrationStatusRoutes(app);
  registerEmailIntakeRoutes(app);

  // ─── Reporting & Analytics ──────────────────────────────
  registerDashboardRoutes(app);
  registerReportRoutes(app);
  registerReportDeliveryRoutes(app);
  registerAnalyticsRoutes(app);

  // ─── Integrations ───────────────────────────────────────
  registerIntegrationRoutes(app);
  registerWhatsAppRoutes(app);

  // ─── Platform Features ──────────────────────────────────
  registerNotificationRoutes(app);
  registerReminderRoutes(app);
  registerDocumentChasingRoutes(app);
  registerComplianceCalendarRoutes(app);
  registerEvidenceCenterRoutes(app);
  registerOnboardingRoutes(app);
  registerBackupRoutes(app);
  registerImportRoutes(app);
  registerReferralRoutes(app);
  registerFeedbackRoutes(app);
  registerMarketingRoutes(app);
  registerNajmaHandoffRoutes(app);
  registerClientErrorRoutes(app);

  // ─── UAE Compliance ─────────────────────────────────────
  registerVATRoutes(app);
  registerVATAutopilotRoutes(app);
  registerCorporateTaxRoutes(app);
  registerExchangeRateRoutes(app);
  registerConsolidationRoutes(app);

  // ─── Team & Client Portal ──────────────────────────────
  registerTeamRoutes(app);
  registerPortalRoutes(app);
  registerPortalPublicRoutes(app);
  registerClientPortalRoutes(app);
  registerPortalInvitationRoutes(app);
  registerPaymentLinkRoutes(app);
  registerPublicPaymentRoutes(app);
  registerOutboxRoutes(app);

  // ─── Admin Panel ────────────────────────────────────────
  registerAdminHealthRoutes(app);
  registerAdminRoutes(app);

  // ─── NRA Management Center ──────────────────────────────
  registerNRARoutes(app);
  registerFirmRoutes(app);
  registerFirmPracticeRoutes(app);
  registerFirmBulkRoutes(app);
  registerFirmCommsRoutes(app);
  registerFirmAnalyticsRoutes(app);
  registerFirmCommandCenterRoutes(app);
  registerFirmValueOpsRoutes(app);
  registerFirmGrowthRoutes(app);
  registerFirmVatWorkspaceRoutes(app);

  log.info("All route modules registered");
}
