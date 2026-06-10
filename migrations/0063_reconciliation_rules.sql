-- Reconciliation rules for auto-categorizing bank transactions. Idempotent.
CREATE TABLE IF NOT EXISTS "reconciliation_rules" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "match_field" text NOT NULL DEFAULT 'description',
  "match_type" text NOT NULL DEFAULT 'contains',
  "match_value" text NOT NULL,
  "category" text,
  "memo" text,
  "priority" integer NOT NULL DEFAULT 0,
  "is_active" boolean NOT NULL DEFAULT true,
  "times_applied" integer NOT NULL DEFAULT 0,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_reconciliation_rules_company_id" ON "reconciliation_rules" ("company_id");
