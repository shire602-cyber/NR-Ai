-- 0145_receipt_rate_and_capture (S2): Track receipt rate provenance and deduplicate capture requests.
-- Idempotent: existing receipts retain their rates and can be resolved when next edited.
ALTER TABLE receipts ADD COLUMN IF NOT EXISTS exchange_rate_source text;
ALTER TABLE receipts ADD COLUMN IF NOT EXISTS capture_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_receipts_company_capture ON receipts (company_id, capture_id);

-- Reconcile legacy receipt totals with their current payment-account posting.
UPDATE receipts AS r
SET base_currency_amount = payment.cash_paid
FROM (
  SELECT source.id, SUM(line.credit - line.debit) AS cash_paid
    FROM receipts AS source
    JOIN journal_entries AS entry ON entry.id = source.journal_entry_id
      AND entry.company_id = source.company_id AND entry.source = 'receipt'
    JOIN journal_lines AS line ON line.entry_id = entry.id
      AND line.account_id = source.payment_account_id
    WHERE source.posted
    GROUP BY source.id
) AS payment
WHERE r.id = payment.id AND r.base_currency_amount IS DISTINCT FROM payment.cash_paid;
