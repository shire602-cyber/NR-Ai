-- Add unique constraint on (company_id, entry_number) to prevent duplicate GL entry numbers
-- under concurrent writes. entry_number is auto-generated per-company (e.g. JE-20240101-001).

ALTER TABLE journal_entries
  ADD CONSTRAINT journal_entries_company_entry_number_unique UNIQUE (company_id, entry_number);
