-- Invoice branding templates. Idempotent.
CREATE TABLE IF NOT EXISTS "invoice_templates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "layout" text NOT NULL DEFAULT 'classic',
  "primary_color" text DEFAULT '#0D5C3D',
  "accent_color" text DEFAULT '#C19E50',
  "header_text" text,
  "footer_text" text,
  "show_logo" boolean NOT NULL DEFAULT true,
  "show_stamp" boolean NOT NULL DEFAULT false,
  "is_default" boolean NOT NULL DEFAULT false,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_invoice_templates_company_id" ON "invoice_templates" ("company_id");
