-- 0117_report_fixes
-- Phase 8 D4 fix round. Idempotent. (0115 is applied on several databases and is never edited.)
--  * invoices(original_invoice_id): every open-invoice query sums its credit notes through this column; without an index each
--    invoice row scanned the whole table (dashboard and invoice list on a 10k-invoice company).
--  * audit_logs.company_id: the audit trail report shows financial activity (journals, bills, VAT, payments), which is written
--    to audit_logs by recordAudit, next to the activity_logs rows. Backfilled from the JSON `details` the rows already carry.

CREATE INDEX IF NOT EXISTS "idx_invoices_original_invoice_id" ON "invoices"("original_invoice_id") WHERE "original_invoice_id" IS NOT NULL;

ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "company_id" uuid;

UPDATE "audit_logs"
   SET "company_id" = ("details"::jsonb ->> 'companyId')::uuid
 WHERE "company_id" IS NULL
   AND "details" IS NOT NULL
   AND "details" LIKE '{%'
   AND ("details"::jsonb ->> 'companyId') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
   AND EXISTS (SELECT 1 FROM "companies" c WHERE c."id" = (("details"::jsonb ->> 'companyId')::uuid));

CREATE INDEX IF NOT EXISTS "idx_audit_logs_company_created" ON "audit_logs"("company_id", "created_at" DESC) WHERE "company_id" IS NOT NULL;
