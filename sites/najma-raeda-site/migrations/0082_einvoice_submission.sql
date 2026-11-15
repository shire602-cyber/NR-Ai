-- Provider-agnostic ASP submission tracking for e-invoicing (Option A seam).
-- Records which ASP a document was handed to, the ASP's message id (for status
-- polling / webhook correlation), when it was submitted, and the latest status
-- detail (e.g. a rejection reason). All nullable/additive.
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "einvoice_provider" text;
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "einvoice_provider_message_id" text;
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "einvoice_submitted_at" timestamp;
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "einvoice_status_detail" text;
