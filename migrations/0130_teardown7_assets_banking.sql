-- 0130_teardown7_assets_banking: Teardown 7 fixes. Additive and idempotent.
--
-- fixed_assets.source_*: the purchase document an asset is recorded by. An asset created from a bill line, or linked later
-- to a posted bill or journal line on a fixed-asset account (12xx), is "recorded in the books": the register totals its
-- cost from that document and no capitalization journal is posted a second time. A bill is only linked by id (the
-- vendor_bills table is not installed everywhere), so there is no foreign key on it.
-- fixed_assets.disposal_*: who bought the asset, how the sale was taxed (standard | zero_rated | exempt; none = not a supply), the VAT
-- on it, and the sales invoice raised for it (a standard- or zero-rated sale is a supply: it needs a tax invoice and
-- reaches the VAT return through that invoice, with its emirate). The invoice credits the gain/loss account 4080, not
-- sales revenue, so the sale is not counted as revenue.
-- fixed_assets.disposal_depreciation_reversed: depreciation that had been posted after the disposal date and was reversed.

ALTER TABLE "fixed_assets"
  ADD COLUMN IF NOT EXISTS "source_bill_id" uuid,
  ADD COLUMN IF NOT EXISTS "source_journal_entry_id" uuid REFERENCES "journal_entries"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "source_journal_line_id" uuid REFERENCES "journal_lines"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "disposal_buyer_id" uuid,
  ADD COLUMN IF NOT EXISTS "disposal_buyer_name" text,
  ADD COLUMN IF NOT EXISTS "disposal_vat_treatment" text,
  ADD COLUMN IF NOT EXISTS "disposal_vat_amount" numeric(15,2),
  ADD COLUMN IF NOT EXISTS "disposal_invoice_id" uuid,
  ADD COLUMN IF NOT EXISTS "disposal_depreciation_reversed" numeric(15,2);

CREATE INDEX IF NOT EXISTS "idx_fixed_assets_source_line" ON "fixed_assets"("source_journal_line_id") WHERE "source_journal_line_id" IS NOT NULL;
