-- Audit-grade document version history. Idempotent.
CREATE TABLE IF NOT EXISTS "document_versions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "document_type" text NOT NULL,
  "document_id" uuid NOT NULL,
  "version" integer NOT NULL,
  "change_description" text,
  "changed_by" uuid REFERENCES "users"("id"),
  "snapshot_data" text,
  "created_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_document_versions_document"
  ON "document_versions" ("company_id", "document_type", "document_id");
