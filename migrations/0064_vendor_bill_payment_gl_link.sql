-- Wire vendor-bill payments into the GL.
--
-- Today vendor_bills approval/payment flows do not carry journal-entry
-- back-references. Approval now posts Dr expense/input VAT and Cr AP, and
-- payment posts Dr AP and Cr cash/bank. These links keep the accounting audit
-- trail navigable and prevent orphaned ledger entries.

ALTER TABLE "vendor_bills"
  ADD COLUMN IF NOT EXISTS "journal_entry_id" uuid REFERENCES "journal_entries"("id");

ALTER TABLE "bill_payments"
  ADD COLUMN IF NOT EXISTS "payment_account_id" uuid REFERENCES "accounts"("id"),
  ADD COLUMN IF NOT EXISTS "journal_entry_id" uuid REFERENCES "journal_entries"("id"),
  ADD COLUMN IF NOT EXISTS "created_by" uuid REFERENCES "users"("id");

CREATE UNIQUE INDEX IF NOT EXISTS "vendor_bills_journal_entry_id_unique"
  ON "vendor_bills"("journal_entry_id")
  WHERE "journal_entry_id" IS NOT NULL;

-- Look up a bill's recent payments quickly when generating the journal-link
-- view or reversing a partial-paid bill.
CREATE INDEX IF NOT EXISTS "idx_bill_payments_journal_entry_id"
  ON "bill_payments"("journal_entry_id");

CREATE UNIQUE INDEX IF NOT EXISTS "bill_payments_journal_entry_id_unique"
  ON "bill_payments"("journal_entry_id")
  WHERE "journal_entry_id" IS NOT NULL;
