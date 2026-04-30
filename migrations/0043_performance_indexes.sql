-- Sprint 4.1: performance indexes for tenant-scoped queries.
-- Every list endpoint filters by company_id. Without these indexes Postgres
-- falls back to a sequential scan once a tenant has more than a few hundred
-- rows, which is the dominant cause of slow dashboard / report loads in
-- larger environments. All statements are idempotent (IF NOT EXISTS) so the
-- migration is safe to re-run.

-- ── Core ledger ──────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "idx_accounts_company_id" ON "accounts" ("company_id");
CREATE INDEX IF NOT EXISTS "idx_journal_entries_company_date" ON "journal_entries" ("company_id", "date");
CREATE INDEX IF NOT EXISTS "idx_journal_entries_company_status" ON "journal_entries" ("company_id", "status");

-- invoice_lines.invoice_id is the join key for every invoice fetch — without
-- it, getInvoiceLinesByInvoiceIds (used by every invoice list with lines)
-- does a seq scan over the entire invoice_lines table per request.
CREATE INDEX IF NOT EXISTS "idx_invoice_lines_invoice_id" ON "invoice_lines" ("invoice_id");

-- ── Invoices / receipts / payments ───────────────────────────────────────
CREATE INDEX IF NOT EXISTS "idx_invoices_company_date" ON "invoices" ("company_id", "date");
CREATE INDEX IF NOT EXISTS "idx_invoices_company_status" ON "invoices" ("company_id", "status");
CREATE INDEX IF NOT EXISTS "idx_invoices_contact_id" ON "invoices" ("contact_id");
CREATE INDEX IF NOT EXISTS "idx_invoice_payments_company_id" ON "invoice_payments" ("company_id");
CREATE INDEX IF NOT EXISTS "idx_receipts_company_date" ON "receipts" ("company_id", "date");
CREATE INDEX IF NOT EXISTS "idx_receipts_company_posted" ON "receipts" ("company_id", "posted");
CREATE INDEX IF NOT EXISTS "idx_recurring_invoices_company_id" ON "recurring_invoices" ("company_id");
-- The recurring-invoice scheduler scans for (is_active=true AND next_run_date<=now)
CREATE INDEX IF NOT EXISTS "idx_recurring_invoices_next_run_active" ON "recurring_invoices" ("is_active", "next_run_date");

-- ── Customer / inventory ─────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "idx_customer_contacts_company_id" ON "customer_contacts" ("company_id");
CREATE INDEX IF NOT EXISTS "idx_products_company_id" ON "products" ("company_id");
CREATE INDEX IF NOT EXISTS "idx_inventory_movements_product_id" ON "inventory_movements" ("product_id");
CREATE INDEX IF NOT EXISTS "idx_inventory_movements_company_id" ON "inventory_movements" ("company_id");

-- ── Notifications / reminders / compliance / messages ────────────────────
CREATE INDEX IF NOT EXISTS "idx_notifications_user_id" ON "notifications" ("user_id");
CREATE INDEX IF NOT EXISTS "idx_notifications_user_unread" ON "notifications" ("user_id", "is_read");
CREATE INDEX IF NOT EXISTS "idx_notifications_company_id" ON "notifications" ("company_id");
CREATE INDEX IF NOT EXISTS "idx_reminder_settings_company_id" ON "reminder_settings" ("company_id");
CREATE INDEX IF NOT EXISTS "idx_reminder_logs_company_id" ON "reminder_logs" ("company_id");
CREATE INDEX IF NOT EXISTS "idx_reminder_logs_related_entity" ON "reminder_logs" ("related_entity_type", "related_entity_id");
CREATE INDEX IF NOT EXISTS "idx_compliance_tasks_company_id" ON "compliance_tasks" ("company_id");
CREATE INDEX IF NOT EXISTS "idx_compliance_tasks_company_status_due" ON "compliance_tasks" ("company_id", "status", "due_date");
CREATE INDEX IF NOT EXISTS "idx_messages_company_id" ON "messages" ("company_id");
CREATE INDEX IF NOT EXISTS "idx_messages_thread_id" ON "messages" ("thread_id");

-- ── Documents / archives / firm ──────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "idx_documents_company_id" ON "documents" ("company_id");
CREATE INDEX IF NOT EXISTS "idx_tax_return_archive_company_id" ON "tax_return_archive" ("company_id");
CREATE INDEX IF NOT EXISTS "idx_engagements_company_id" ON "engagements" ("company_id");
CREATE INDEX IF NOT EXISTS "idx_engagements_account_manager_id" ON "engagements" ("account_manager_id");
CREATE INDEX IF NOT EXISTS "idx_service_invoices_company_id" ON "service_invoices" ("company_id");
CREATE INDEX IF NOT EXISTS "idx_service_invoices_engagement_id" ON "service_invoices" ("engagement_id");
CREATE INDEX IF NOT EXISTS "idx_service_invoice_lines_service_invoice_id" ON "service_invoice_lines" ("service_invoice_id");
CREATE INDEX IF NOT EXISTS "idx_invitations_company_id" ON "invitations" ("company_id");
CREATE INDEX IF NOT EXISTS "idx_client_notes_company_id" ON "client_notes" ("company_id");
CREATE INDEX IF NOT EXISTS "idx_fta_emails_company_id" ON "fta_emails" ("company_id");
CREATE INDEX IF NOT EXISTS "idx_firm_leads_user_id" ON "firm_leads" ("user_id");
CREATE INDEX IF NOT EXISTS "idx_firm_leads_stage" ON "firm_leads" ("stage");

-- ── Subscriptions / backups / AI / communications ────────────────────────
CREATE INDEX IF NOT EXISTS "idx_subscriptions_company_id" ON "subscriptions" ("company_id");
CREATE INDEX IF NOT EXISTS "idx_backups_company_id" ON "backups" ("company_id");
CREATE INDEX IF NOT EXISTS "idx_ai_conversations_user_id" ON "ai_conversations" ("user_id");
CREATE INDEX IF NOT EXISTS "idx_ai_conversations_company_id" ON "ai_conversations" ("company_id");
CREATE INDEX IF NOT EXISTS "idx_client_communications_company_id" ON "client_communications" ("company_id");

-- ── Tax returns ──────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "idx_vat_returns_company_id" ON "vat_returns" ("company_id");
CREATE INDEX IF NOT EXISTS "idx_vat_returns_company_period" ON "vat_returns" ("company_id", "period_start");
CREATE INDEX IF NOT EXISTS "idx_corporate_tax_returns_company_id" ON "corporate_tax_returns" ("company_id");

-- ── Banking / cash flow / classifications / KPIs ─────────────────────────
CREATE INDEX IF NOT EXISTS "idx_bank_accounts_company_id" ON "bank_accounts" ("company_id");
CREATE INDEX IF NOT EXISTS "idx_bank_transactions_company_id" ON "bank_transactions" ("company_id");
CREATE INDEX IF NOT EXISTS "idx_bank_transactions_company_match" ON "bank_transactions" ("company_id", "match_status");
CREATE INDEX IF NOT EXISTS "idx_cash_flow_forecasts_company_id" ON "cash_flow_forecasts" ("company_id");
CREATE INDEX IF NOT EXISTS "idx_transaction_classifications_company_id" ON "transaction_classifications" ("company_id");
CREATE INDEX IF NOT EXISTS "idx_budgets_company_period" ON "budgets" ("company_id", "year", "month");
CREATE INDEX IF NOT EXISTS "idx_anomaly_alerts_company_id" ON "anomaly_alerts" ("company_id");
CREATE INDEX IF NOT EXISTS "idx_anomaly_alerts_company_resolved" ON "anomaly_alerts" ("company_id", "is_resolved");
CREATE INDEX IF NOT EXISTS "idx_financial_kpis_company_id" ON "financial_kpis" ("company_id");

-- ── Integrations / WhatsApp / e-commerce ─────────────────────────────────
CREATE INDEX IF NOT EXISTS "idx_integration_syncs_company_id" ON "integration_syncs" ("company_id");
CREATE INDEX IF NOT EXISTS "idx_whatsapp_configs_company_id" ON "whatsapp_configs" ("company_id");
CREATE INDEX IF NOT EXISTS "idx_whatsapp_messages_company_id" ON "whatsapp_messages" ("company_id");
CREATE INDEX IF NOT EXISTS "idx_ecommerce_integrations_company_id" ON "ecommerce_integrations" ("company_id");
CREATE INDEX IF NOT EXISTS "idx_ecommerce_transactions_company_id" ON "ecommerce_transactions" ("company_id");
CREATE INDEX IF NOT EXISTS "idx_ecommerce_transactions_integration_id" ON "ecommerce_transactions" ("integration_id");

-- ── Onboarding / audit ───────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "idx_user_onboarding_user_id" ON "user_onboarding" ("user_id");
CREATE INDEX IF NOT EXISTS "idx_audit_logs_user_id" ON "audit_logs" ("user_id");
