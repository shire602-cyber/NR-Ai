-- Sprint 3.3: Sequential invoice numbering with no gaps (FTA requirement)
-- One sequence row per (company, document type, year). Allocation uses an
-- INSERT ... ON CONFLICT DO UPDATE ... RETURNING pattern, which is atomic
-- under concurrent transactions and guarantees gap-free monotonic numbers.

CREATE TABLE IF NOT EXISTS "invoice_number_sequences" (
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "doc_type" text NOT NULL,
  "year" integer NOT NULL,
  "last_value" bigint NOT NULL DEFAULT 0,
  "updated_at" timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY ("company_id", "doc_type", "year")
);

CREATE INDEX IF NOT EXISTS "idx_invoice_number_sequences_company"
  ON "invoice_number_sequences"("company_id");
