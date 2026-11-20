-- 0124_e3_invoice_line_income (E3 launch fixes; W3-A sales): the income account an invoice line posts to.
-- Idempotent: ADD COLUMN IF NOT EXISTS only, so re-running the file changes nothing.
--
-- J1-r3: service lines on an invoice without a catalogue item posted to 4010 Product Sales. A
-- line may now name its income account (standard-rated lines only; zero-rated, exempt and
-- out-of-scope lines keep the accounts the VAT-to-GL reconciliation relies on). NULL keeps the
-- previous rule (service product -> 4020, everything else -> 4010).
ALTER TABLE invoice_lines ADD COLUMN IF NOT EXISTS revenue_account_id uuid
  REFERENCES accounts(id) ON DELETE SET NULL;
