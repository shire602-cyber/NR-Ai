-- 0124_wq3_journal_line_fields (WQ3 accounting core gaps): per-line contact, VAT and CT treatment on journal lines.
-- Idempotent: ADD COLUMN IF NOT EXISTS and CREATE INDEX IF NOT EXISTS only, so re-running the
-- file changes nothing.
--
-- 9.4 / 9.16: a manual journal line carries the contact it concerns (customer or supplier), the
-- VAT treatment the user chose (the VAT leg is derived by the server and flagged system_vat so
-- the control-account gate still holds for every other VAT line) and its corporate-tax
-- treatment (non-deductible with a share, exempt income, deductible), which the CT workpaper
-- reads through server/reporting. Reversals copy these columns so a reversed line nets to zero.
ALTER TABLE journal_lines ADD COLUMN IF NOT EXISTS contact_type text;
--> statement-breakpoint
ALTER TABLE journal_lines ADD COLUMN IF NOT EXISTS contact_id uuid;
--> statement-breakpoint
ALTER TABLE journal_lines ADD COLUMN IF NOT EXISTS vat_treatment text;
--> statement-breakpoint
ALTER TABLE journal_lines ADD COLUMN IF NOT EXISTS system_vat boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE journal_lines ADD COLUMN IF NOT EXISTS ct_treatment text;
--> statement-breakpoint
ALTER TABLE journal_lines ADD COLUMN IF NOT EXISTS ct_disallowed_pct numeric(5,2);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_journal_lines_ct_treatment
  ON journal_lines (ct_treatment) WHERE ct_treatment IS NOT NULL;
