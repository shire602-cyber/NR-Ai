-- Link a VAT workpaper row to the journal entry it posted, so a manually
-- entered VAT row can be reflected in the general ledger (and reversed when the
-- row is deleted). Additive + nullable; safe.

ALTER TABLE "vat_workpaper_rows"
  ADD COLUMN IF NOT EXISTS "journal_entry_id" uuid REFERENCES "journal_entries"("id") ON DELETE SET NULL;
