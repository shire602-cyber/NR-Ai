-- 0120_a2_purchases (A2 accounting round; W3-B purchases / W4-B assets residual): fixed assets from bills, control-account adjustments.
-- Idempotent: ADD COLUMN IF NOT EXISTS and CREATE INDEX IF NOT EXISTS only, so re-running the
-- file changes nothing.
--
-- 1. H9: a bill line coded to a fixed-asset account opens a draft register entry linked to the
--    bill and its line, completed by the user (useful life) before depreciation runs.
ALTER TABLE fixed_assets ADD COLUMN IF NOT EXISTS source_bill_id uuid;
--> statement-breakpoint
ALTER TABLE fixed_assets ADD COLUMN IF NOT EXISTS source_bill_line_id uuid;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_fixed_assets_source_bill ON fixed_assets (source_bill_id);
--> statement-breakpoint
-- 2. H8: a manual journal that touches a control account (A/R, A/P, inventory, VAT, GRNI,
--    payroll payables) needs an explicit adjustment reason; it is stamped on the entry and shown
--    as a reconciling item between the sub-ledger and the GL.
ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS control_adjustment_reason text;
--> statement-breakpoint
ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS control_adjustment_by uuid;
