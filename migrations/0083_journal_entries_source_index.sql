-- S2: index for getJournalEntriesBySource(company_id, source, source_id), which
-- runs on every invoice void/payment, credit note, expense-claim posting, FX
-- revaluation, and their idempotency checks. Additive; safe.
CREATE INDEX IF NOT EXISTS "idx_journal_entries_company_source"
  ON "journal_entries" ("company_id", "source", "source_id");
