-- Performance: companyId indexes for high-traffic, multi-tenant tables.
-- These all use IF NOT EXISTS so the migration is safe to re-run and
-- safe in environments that may have already added some of them by hand.

-- ── Tax-critical (high-traffic regulatory workflows) ──────────────────
CREATE INDEX IF NOT EXISTS idx_vat_returns_company_id ON vat_returns (company_id);
CREATE INDEX IF NOT EXISTS idx_corporate_tax_returns_company_id ON corporate_tax_returns (company_id);

-- ── Compliance / vault / messaging (frequent dashboard reads) ─────────
CREATE INDEX IF NOT EXISTS idx_documents_company_id ON documents (company_id);
CREATE INDEX IF NOT EXISTS idx_compliance_tasks_company_id ON compliance_tasks (company_id);
CREATE INDEX IF NOT EXISTS idx_messages_company_id ON messages (company_id);
CREATE INDEX IF NOT EXISTS idx_anomaly_alerts_company_id ON anomaly_alerts (company_id);
CREATE INDEX IF NOT EXISTS idx_ai_conversations_company_id ON ai_conversations (company_id);
CREATE INDEX IF NOT EXISTS idx_backups_company_id ON backups (company_id);

-- ── Firm CRM (engagements, notes, billing, invitations) ──────────────
CREATE INDEX IF NOT EXISTS idx_engagements_company_id ON engagements (company_id);
CREATE INDEX IF NOT EXISTS idx_client_notes_company_id ON client_notes (company_id);
CREATE INDEX IF NOT EXISTS idx_service_invoices_company_id ON service_invoices (company_id);
CREATE INDEX IF NOT EXISTS idx_invitations_company_id ON invitations (company_id);

-- ── Integrations / messaging ─────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_ecommerce_integrations_company_id ON ecommerce_integrations (company_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_configs_company_id ON whatsapp_configs (company_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_company_id ON whatsapp_messages (company_id);

-- ── Inventory / banking ──────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_products_company_id ON products (company_id);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_company_id ON inventory_movements (company_id);
CREATE INDEX IF NOT EXISTS idx_bank_accounts_company_id ON bank_accounts (company_id);

-- ── Recurring / subscriptions / cash flow / reminders ────────────────
CREATE INDEX IF NOT EXISTS idx_recurring_invoices_company_id ON recurring_invoices (company_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_company_id ON subscriptions (company_id);
CREATE INDEX IF NOT EXISTS idx_cash_flow_forecasts_company_id ON cash_flow_forecasts (company_id);
CREATE INDEX IF NOT EXISTS idx_reminder_settings_company_id ON reminder_settings (company_id);
CREATE INDEX IF NOT EXISTS idx_reminder_logs_company_id ON reminder_logs (company_id);
