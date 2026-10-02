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
import { createServer, type Server } from "http";
import { createLogger } from "./config/logger";

// ─── Route modules ──────────────────────────────────────────
import { registerAuthRoutes } from "./routes/auth.routes";
import { registerTwoFactorRoutes } from "./routes/two-factor.routes";
import { registerApiV1 } from "./api-v1";
import { refusedActionAudit } from "./middleware/refused-action-audit";
import { employeeDenialContext } from "./middleware/employee-denial";
import { registerCompanyLifecycleRoutes } from "./routes/company-lifecycle.routes";
import { registerImportJobRoutes } from "./routes/import-jobs.routes";
import { registerCompanyRoutes } from "./routes/companies.routes";
import { registerAccountRoutes } from "./routes/accounts.routes";
import { registerInvoiceRoutes } from "./routes/invoices.routes";
import { registerChasingRoutes } from "./routes/chasing.routes";
import { registerReceiptRoutes } from "./routes/receipts.routes";
import { registerContactRoutes } from "./routes/contacts.routes";
import { registerJournalRoutes } from "./routes/journal.routes";
import { registerAIRoutes } from "./routes/ai.routes";
import { registerDashboardRoutes } from "./routes/dashboard.routes";
import { registerReportRoutes } from "./routes/reports.routes";
import { registerReportAccessGate } from "./routes/report-access";
import { registerReportRunRoutes } from "./routes/report-run.routes";
import { registerReportScheduleRoutes } from "./routes/report-schedules.routes";
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
import { registerClientErrorRoutes } from "./routes/client-errors.routes";
import { registerVATRoutes } from "./routes/vat.routes";
import { registerVATAutopilotRoutes } from "./routes/vat-autopilot.routes";
import { registerCorporateTaxRoutes } from "./routes/corporate-tax.routes";
import { registerTaxFilingRoutes } from "./routes/tax-filing.routes";
import { registerFafRoutes } from "./routes/faf.routes";
import { registerOpeningBalanceRoutes } from "./routes/opening-balance.routes";
import { registerYearEndRoutes } from "./routes/year-end.routes";
import { registerTeamRoutes } from "./routes/team.routes";
import { registerPortalRoutes } from "./routes/portal.routes";
import { registerDocumentRoutes } from "./routes/documents.routes";
import { registerPortalPublicRoutes } from "./routes/portal.public.routes";
import { registerAdminRoutes } from "./routes/admin.routes";
import { registerRecurringInvoiceRoutes } from "./routes/recurring-invoices.routes";
import { registerInventoryRoutes } from "./routes/inventory.routes";
import { registerPayrollRoutes } from "./routes/payroll.routes";
import { registerBillPayRoutes } from "./routes/bill-pay.routes";
import { registerVendorCreditRoutes } from "./routes/vendor-credits.routes";
import { registerFixedAssetRoutes } from "./routes/fixed-assets.routes";
import { registerFixedAssetReportRoutes } from "./routes/fixed-asset-reports.routes";
import { registerBudgetRoutes } from "./routes/budgets.routes";
import { registerExpenseClaimRoutes } from "./routes/expense-claims.routes";
import { registerCashFlowRoutes } from "./routes/cashflow.routes";
import { registerAnomalyRoutes } from "./routes/anomaly.routes";
import { registerAutoReconcileRoutes } from "./routes/auto-reconcile.routes";
import { registerAIGLRoutes } from "./routes/ai-gl.routes";
import { registerMonthEndRoutes } from "./routes/month-end.routes";
import { registerComplianceDashboardRoutes } from "./routes/compliance-dashboard.routes";
import { registerQuoteRoutes } from "./routes/quotes.routes";
import { registerStatementRoutes } from "./routes/statements.routes";
import { registerVendorStatementRoutes } from "./routes/vendor-statements.routes";
import { registerApprovalRoutes } from "./routes/approvals.routes";
import { registerProjectRoutes } from "./routes/projects.routes";
import { registerLeaveRoutes } from "./routes/leave.routes";
import { registerEmployeeLoanRoutes } from "./routes/employee-loans.routes";
import { registerFinalSettlementRoutes } from "./routes/final-settlements.routes";
import { registerCreditNoteRoutes } from "./routes/credit-notes.routes";
import { registerCustomerRefundRoutes } from "./routes/customer-refunds.routes";
import { registerCustomerAdvanceRoutes } from "./routes/customer-advances.routes";
import { registerCustomFieldRoutes } from "./routes/custom-fields.routes";
import { registerPublicQuoteRoutes } from "./routes/public-quotes.routes";
import { registerSalesOrderRoutes } from "./routes/sales-orders.routes";
import { registerPaymentGatewayRoutes } from "./routes/payment-gateway.routes";
import { registerPriceListRoutes } from "./routes/price-lists.routes";
import { registerPurchaseOrderRoutes } from "./routes/purchase-orders.routes";
import { registerCostCenterRoutes } from "./routes/cost-centers.routes";
import { registerFinancialStatementRoutes } from "./routes/financial-statements.routes";
import { registerReconciliationRuleRoutes } from "./routes/reconciliation-rules.routes";
import { registerInvoiceTemplateRoutes } from "./routes/invoice-templates.routes";
import { registerBankRoutes } from "./routes/bank.routes";
import { registerDocumentVersionRoutes } from "./routes/document-versions.routes";
import { registerApiKeyRoutes } from "./routes/api-keys.routes";
import { registerBillingRoutes } from "./routes/billing.routes";
import { registerPushRoutes } from "./routes/push.routes";
import { registerWebhookRoutes } from "./routes/webhooks.routes";
import { registerIntegrationStatusRoutes } from "./routes/integration-status.routes";
import { registerEmailIntakeRoutes } from "./routes/email-intake.routes";
import { registerAdminHealthRoutes } from "./routes/admin-health.routes";
import { registerBankStatementRoutes } from "./routes/bank-statements.routes";
import { registerBankStatementImportRoutes } from "./routes/bank-statement-imports.routes";
import { registerBankFeedRoutes } from "./routes/bank-feeds.routes";
import { registerBankReconciliationRoutes } from "./routes/bank-reconciliations.routes";
import { registerExchangeRateRoutes } from "./routes/exchange-rates.routes";
import { registerNRARoutes } from "./routes/nra.routes";
import { registerFirmRoutes } from "./routes/firm.routes";
import { registerFirmBulkRoutes } from "./routes/firm-bulk.routes";
import { registerFirmCommsRoutes } from "./routes/firm-comms.routes";
import { registerFirmAnalyticsRoutes } from "./routes/firm-analytics.routes";
import { registerFirmCommandCenterRoutes } from "./routes/firm-command-center.routes";
import { registerFirmValueOpsRoutes } from "./routes/firm-value-ops.routes";
import { registerFirmGrowthRoutes } from "./routes/firm-growth.routes";
import { registerFirmVatWorkspaceRoutes } from "./routes/firm-vat-workspace.routes";
import { registerClientPortalRoutes } from "./routes/client-portal.routes";
import { registerPortalInviteRoutes } from "./routes/portal-invites.routes";
import { registerDocumentChasingRoutes } from "./routes/document-chasing.routes";
import { registerEvidenceCenterRoutes } from "./routes/evidence-center.routes";

const log = createLogger("routes");

export async function registerRoutes(app: Express): Promise<Server> {
  log.info("Registering route modules...");

  // An employee-role member is limited to their own HR records: a refusal of that role answers 403 ROLE_REQUIRED everywhere.
  app.use("/api", employeeDenialContext);
  // ─── Public API v1 (mounted first: it hands writes to the routes below) ───
  registerApiV1(app);
  // Refused attempts on money routes go to the audit trail (after v1, which logs its own requests).
  app.use("/api", refusedActionAudit);
  registerReportAccessGate(app);

  // ─── Core Accounting ────────────────────────────────────
  registerAuthRoutes(app);
  registerTwoFactorRoutes(app);
  registerCompanyLifecycleRoutes(app);
  registerImportJobRoutes(app);
  registerCompanyRoutes(app);
  registerAccountRoutes(app);
  registerInvoiceRoutes(app);
  registerRecurringInvoiceRoutes(app);
  registerChasingRoutes(app);
  registerReceiptRoutes(app);
  registerContactRoutes(app);
  registerJournalRoutes(app);
  registerSalesOrderRoutes(app); // before the inventory routes: /products/availability must beat /products/:id
  registerInventoryRoutes(app);
  registerBankStatementRoutes(app);
  registerBankStatementImportRoutes(app);
  registerBankFeedRoutes(app);
  registerBankReconciliationRoutes(app);

  // ─── HR & Payroll ───────────────────────────────────────
  registerPayrollRoutes(app);
  registerExpenseClaimRoutes(app);

  // ─── Accounts Payable ───────────────────────────────────
  registerBillPayRoutes(app);
  registerVendorCreditRoutes(app);

  // ─── Asset Management ───────────────────────────────────
  registerFixedAssetReportRoutes(app);
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
  registerComplianceDashboardRoutes(app);
  registerQuoteRoutes(app);
  registerStatementRoutes(app);
  registerVendorStatementRoutes(app);
  registerApprovalRoutes(app);
  registerProjectRoutes(app);
  registerLeaveRoutes(app);
  registerEmployeeLoanRoutes(app);
  registerFinalSettlementRoutes(app);
  registerCreditNoteRoutes(app);
  registerCustomerRefundRoutes(app);
  registerCustomerAdvanceRoutes(app);
  registerCustomFieldRoutes(app);
  registerPublicQuoteRoutes(app);
  registerPaymentGatewayRoutes(app);
  registerPriceListRoutes(app);
  registerPurchaseOrderRoutes(app);
  registerCostCenterRoutes(app);
  registerFinancialStatementRoutes(app);
  registerReconciliationRuleRoutes(app);
  registerInvoiceTemplateRoutes(app);
  registerBankRoutes(app);
  registerDocumentVersionRoutes(app);
  registerApiKeyRoutes(app);
  registerBillingRoutes(app);
  registerPushRoutes(app);
  registerWebhookRoutes(app);
  registerIntegrationStatusRoutes(app);
  registerEmailIntakeRoutes(app);

  // ─── Reporting & Analytics ──────────────────────────────
  registerDashboardRoutes(app);
  registerReportRoutes(app);
  registerReportRunRoutes(app);
  registerReportScheduleRoutes(app);
  registerReportDeliveryRoutes(app);
  registerAnalyticsRoutes(app);

  // ─── Integrations ───────────────────────────────────────
  registerIntegrationRoutes(app);
  registerWhatsAppRoutes(app);

  // ─── Platform Features ──────────────────────────────────
  registerNotificationRoutes(app);
  registerReminderRoutes(app);
  registerDocumentChasingRoutes(app);
  registerEvidenceCenterRoutes(app);
  registerOnboardingRoutes(app);
  registerBackupRoutes(app);
  registerReferralRoutes(app);
  registerFeedbackRoutes(app);
  registerClientErrorRoutes(app);

  // ─── UAE Compliance ─────────────────────────────────────
  registerVATRoutes(app);
  registerVATAutopilotRoutes(app);
  registerCorporateTaxRoutes(app);
  registerTaxFilingRoutes(app);
  registerFafRoutes(app);
  registerOpeningBalanceRoutes(app);
  registerYearEndRoutes(app);
  registerExchangeRateRoutes(app);

  // ─── Team & Client Portal ──────────────────────────────
  registerTeamRoutes(app);
  registerPortalRoutes(app);
  registerDocumentRoutes(app);
  registerPortalPublicRoutes(app);
  registerClientPortalRoutes(app);
  registerPortalInviteRoutes(app);

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
  registerFirmGrowthRoutes(app);
  registerFirmVatWorkspaceRoutes(app);

  log.info("All route modules registered");

  return createServer(app);
}
