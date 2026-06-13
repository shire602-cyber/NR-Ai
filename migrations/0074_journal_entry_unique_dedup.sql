-- Self-healing: the unique (company_id, entry_number) constraint on
-- journal_entries (migration 0018) is missing on baselined production DBs, so
-- concurrent journal creation could insert duplicate entry numbers. Re-number
-- any existing duplicates to fresh per-(company, date) sequence values, then
-- add the constraint. Idempotent: the de-dup loop is a no-op when there are no
-- duplicates and the constraint is only added when absent.

-- 1) Re-number duplicate (company_id, entry_number) rows, keeping the earliest.
DO $dedup$
DECLARE
  dup RECORD;
  new_seq INT;
  prefix TEXT;
BEGIN
  FOR dup IN
    SELECT id, company_id, entry_number, date
    FROM (
      SELECT id, company_id, entry_number, date,
             ROW_NUMBER() OVER (
               PARTITION BY company_id, entry_number
               ORDER BY created_at NULLS FIRST, id
             ) AS rn
      FROM journal_entries
      WHERE (company_id, entry_number) IN (
        SELECT company_id, entry_number
        FROM journal_entries
        GROUP BY company_id, entry_number
        HAVING COUNT(*) > 1
      )
    ) ranked
    WHERE rn > 1
  LOOP
    prefix := 'JE-' || to_char(dup.date, 'YYYYMMDD');
    SELECT COALESCE(MAX(CAST(SUBSTRING(entry_number FROM 13) AS INTEGER)), 0) + 1
      INTO new_seq
      FROM journal_entries
      WHERE company_id = dup.company_id
        AND entry_number LIKE prefix || '-%'
        AND entry_number ~ ('^' || prefix || '-[0-9]+$');
    UPDATE journal_entries
      SET entry_number = prefix || '-' || LPAD(new_seq::text, 3, '0')
      WHERE id = dup.id;
  END LOOP;
END
$dedup$;

-- 2) Add the unique constraint if it isn't already present.
DO $constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'journal_entries_company_entry_number_unique'
  ) THEN
    ALTER TABLE journal_entries
      ADD CONSTRAINT journal_entries_company_entry_number_unique
      UNIQUE (company_id, entry_number);
  END IF;
END
$constraint$;
