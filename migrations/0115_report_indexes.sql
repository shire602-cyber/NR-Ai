-- 0115_report_indexes
-- Phase 8 D4: indexes the report engine and the audit trail read through.
-- journal_lines(account_id) and journal_entries(company_id, date) already exist.

CREATE INDEX IF NOT EXISTS "idx_activity_logs_company_created" ON "activity_logs"("company_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_vendor_bills_company_bill_date" ON "vendor_bills"("company_id", "bill_date");
CREATE INDEX IF NOT EXISTS "idx_invoice_payments_company_date" ON "invoice_payments"("company_id", "date");
