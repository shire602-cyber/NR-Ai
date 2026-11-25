-- 0104_w4e_vat_engine (W4-E): one VAT engine, VAT-to-GL reconciliation, amended returns,
-- bad-debt relief, return adjustments (tourist refunds, import adjustments, corrections),
-- input-VAT recovery rules, receipt VAT treatment, VAT groups, firm workpaper maker-checker.
-- Idempotent: every statement can run twice.

-- ── vat_returns: amendments, reconciliation snapshot and override, readiness ────────────
ALTER TABLE "vat_returns" ADD COLUMN IF NOT EXISTS "amends_return_id" uuid;
ALTER TABLE "vat_returns" ADD COLUMN IF NOT EXISTS "amendment_diff" jsonb;
ALTER TABLE "vat_returns" ADD COLUMN IF NOT EXISTS "reconciliation_snapshot" jsonb;
ALTER TABLE "vat_returns" ADD COLUMN IF NOT EXISTS "reconciliation_override_reason" text;
ALTER TABLE "vat_returns" ADD COLUMN IF NOT EXISTS "reconciliation_override_by" uuid;
ALTER TABLE "vat_returns" ADD COLUMN IF NOT EXISTS "reconciliation_override_at" timestamp;
ALTER TABLE "vat_returns" ADD COLUMN IF NOT EXISTS "ready_by" uuid;
ALTER TABLE "vat_returns" ADD COLUMN IF NOT EXISTS "ready_at" timestamp;
ALTER TABLE "vat_returns" ADD COLUMN IF NOT EXISTS "engine_version" text;
ALTER TABLE "vat_returns" ADD COLUMN IF NOT EXISTS "vat_group_id" uuid;
ALTER TABLE "vat_returns" ADD COLUMN IF NOT EXISTS "partial_exemption_ratio" numeric(15,6);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vat_returns_amends_return_id_fk') THEN
    ALTER TABLE "vat_returns"
      ADD CONSTRAINT "vat_returns_amends_return_id_fk"
      FOREIGN KEY ("amends_return_id") REFERENCES "vat_returns"("id") ON DELETE SET NULL;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS "idx_vat_returns_amends" ON "vat_returns" ("amends_return_id");

-- ── vat_return_periods: reconciliation snapshot + override ──────────────────────────────
ALTER TABLE "vat_return_periods" ADD COLUMN IF NOT EXISTS "reconciliation_snapshot" jsonb;
ALTER TABLE "vat_return_periods" ADD COLUMN IF NOT EXISTS "reconciliation_override_reason" text;
ALTER TABLE "vat_return_periods" ADD COLUMN IF NOT EXISTS "reconciliation_override_by" uuid;

-- ── bad-debt relief (Art. 64): tracked claim, reversed on later payment ─────────────────
CREATE TABLE IF NOT EXISTS "bad_debt_relief_claims" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "invoice_id" uuid NOT NULL REFERENCES "invoices"("id") ON DELETE CASCADE,
  "claim_date" date NOT NULL,
  "emirate" text NOT NULL,
  "outstanding_amount" numeric(15,2) NOT NULL,
  "taxable_amount" numeric(15,2) NOT NULL,
  "vat_amount" numeric(15,2) NOT NULL,
  "written_off" boolean NOT NULL DEFAULT false,
  "customer_notified" boolean NOT NULL DEFAULT false,
  "customer_notified_at" date,
  "status" text NOT NULL DEFAULT 'claimed',
  "journal_entry_id" uuid REFERENCES "journal_entries"("id") ON DELETE SET NULL,
  "reversal_entry_id" uuid REFERENCES "journal_entries"("id") ON DELETE SET NULL,
  "reversed_at" date,
  "reversal_reason" text,
  "notes" text,
  "created_by" uuid,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "bad_debt_relief_status_check" CHECK ("status" IN ('claimed', 'reversed')),
  CONSTRAINT "bad_debt_relief_vat_check" CHECK ("vat_amount" > 0)
);
CREATE INDEX IF NOT EXISTS "idx_bad_debt_relief_company" ON "bad_debt_relief_claims" ("company_id", "claim_date");
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_bad_debt_relief_active_invoice"
  ON "bad_debt_relief_claims" ("invoice_id") WHERE "status" = 'claimed';

-- ── return adjustments: tourist refunds (Box 2), import adjustments (Box 7), corrections ─
CREATE TABLE IF NOT EXISTS "vat_return_adjustments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "period_start" date NOT NULL,
  "period_end" date NOT NULL,
  "kind" text NOT NULL,
  "emirate" text,
  "amount" numeric(15,2) NOT NULL DEFAULT 0,
  "vat_amount" numeric(15,2) NOT NULL DEFAULT 0,
  "reason" text NOT NULL,
  "reference" text,
  "corrects_period_start" date,
  "corrects_period_end" date,
  "created_by" uuid,
  "created_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "vat_return_adjustments_kind_check" CHECK ("kind" IN
    ('tourist_refund', 'import_adjustment', 'output_correction', 'input_correction', 'voluntary_disclosure_output', 'voluntary_disclosure_input'))
);
CREATE INDEX IF NOT EXISTS "idx_vat_return_adjustments_company_period"
  ON "vat_return_adjustments" ("company_id", "period_start", "period_end");

-- ── input-VAT recovery rules (blocked / partly recoverable categories, R05-28) ──────────
CREATE TABLE IF NOT EXISTS "vat_recovery_rules" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "match_type" text NOT NULL,
  "match_value" text NOT NULL,
  "recoverable_percent" numeric(5,2) NOT NULL,
  "label" text NOT NULL,
  "created_by" uuid,
  "created_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "vat_recovery_rules_match_check" CHECK ("match_type" IN ('category', 'account_code', 'account_id')),
  CONSTRAINT "vat_recovery_rules_pct_check" CHECK ("recoverable_percent" >= 0 AND "recoverable_percent" <= 100)
);
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_vat_recovery_rules_match"
  ON "vat_recovery_rules" ("company_id", "match_type", lower("match_value"));

-- ── VAT treatment recorded when a receipt posts (recoverable / blocked split) ───────────
CREATE TABLE IF NOT EXISTS "receipt_vat_treatments" (
  "receipt_id" uuid PRIMARY KEY REFERENCES "receipts"("id") ON DELETE CASCADE,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "supply_type" text NOT NULL DEFAULT 'standard_rated',
  "vat_base" numeric(15,2) NOT NULL DEFAULT 0,
  "recoverable_vat" numeric(15,2) NOT NULL DEFAULT 0,
  "non_recoverable_vat" numeric(15,2) NOT NULL DEFAULT 0,
  "net_base" numeric(15,2) NOT NULL DEFAULT 0,
  "rule_label" text,
  "lines" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_receipt_vat_treatments_company" ON "receipt_vat_treatments" ("company_id");

-- ── VAT groups (Art. 14): representative member files one aggregated return ────────────
CREATE TABLE IF NOT EXISTS "vat_groups" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "representative_company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "group_trn" text NOT NULL,
  "created_by" uuid,
  "created_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "vat_groups_representative_unique" UNIQUE ("representative_company_id")
);
CREATE TABLE IF NOT EXISTS "vat_group_members" (
  "group_id" uuid NOT NULL REFERENCES "vat_groups"("id") ON DELETE CASCADE,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "joined_at" timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_vat_group_members_company" ON "vat_group_members" ("company_id");

-- ── firm VAT workpapers: maker-checker (R15-02) ─────────────────────────────────────────
ALTER TABLE "vat_workpapers" ADD COLUMN IF NOT EXISTS "prepared_by" uuid;
ALTER TABLE "vat_workpapers" ADD COLUMN IF NOT EXISTS "prepared_at" timestamp;
ALTER TABLE "vat_workpapers" ADD COLUMN IF NOT EXISTS "reviewed_by" uuid;
ALTER TABLE "vat_workpapers" ADD COLUMN IF NOT EXISTS "reviewed_at" timestamp;
ALTER TABLE "vat_workpapers" ADD COLUMN IF NOT EXISTS "filed_by" uuid;
ALTER TABLE "vat_workpapers" ADD COLUMN IF NOT EXISTS "filed_at" timestamp;
ALTER TABLE "vat_workpapers" ADD COLUMN IF NOT EXISTS "locked_by" uuid;
ALTER TABLE "vat_workpapers" ADD COLUMN IF NOT EXISTS "locked_at" timestamp;
ALTER TABLE "vat_workpapers" ADD COLUMN IF NOT EXISTS "return_generated_at" timestamp;
-- Legacy free-form statuses map onto the new machine without claiming a review happened.
UPDATE "vat_workpapers" SET "status" = 'prepared'
 WHERE "status" IN ('in_review', 'ready', 'generated');
ALTER TABLE "vat_workpaper_rows" ADD COLUMN IF NOT EXISTS "vat_override_reason" text;
