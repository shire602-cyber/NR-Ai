-- Audit remediation foundation:
--   * VAT 201 line-level emirate allocation
--   * idempotent one-return-per-company-period VAT returns
--   * durable journal-entry number sequencing
--   * posting idempotency indexes for automated source documents

ALTER TABLE invoice_lines
  ADD COLUMN IF NOT EXISTS supply_emirate text DEFAULT 'dubai';

UPDATE invoice_lines il
SET supply_emirate = COALESCE(c.emirate, 'dubai')
FROM invoices i
JOIN companies c ON c.id = i.company_id
WHERE il.invoice_id = i.id
  AND il.supply_emirate IS NULL;

CREATE INDEX IF NOT EXISTS idx_invoice_lines_supply_emirate
  ON invoice_lines (supply_emirate);

CREATE TABLE IF NOT EXISTS journal_entry_number_sequences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  entry_date text NOT NULL,
  last_value integer NOT NULL DEFAULT 0,
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT journal_entry_number_sequences_company_date_unique
    UNIQUE (company_id, entry_date)
);

CREATE INDEX IF NOT EXISTS idx_journal_entry_number_sequences_company_date
  ON journal_entry_number_sequences (company_id, entry_date);

WITH parsed_entry_numbers AS (
  SELECT
    company_id,
    regexp_match(entry_number, '^JE-([0-9]{8})-([0-9]+)$') AS parts
  FROM journal_entries
  WHERE entry_number ~ '^JE-[0-9]{8}-[0-9]+$'
),
sequenced_entry_numbers AS (
  SELECT
    company_id,
    substring(parts[1] from 1 for 4) || '-' ||
      substring(parts[1] from 5 for 2) || '-' ||
      substring(parts[1] from 7 for 2) AS entry_date,
    MAX((parts[2])::integer) AS last_value
  FROM parsed_entry_numbers
  GROUP BY company_id, parts[1]
)
INSERT INTO journal_entry_number_sequences (company_id, entry_date, last_value)
SELECT company_id, entry_date, last_value
FROM sequenced_entry_numbers
ON CONFLICT (company_id, entry_date)
DO UPDATE SET
  last_value = GREATEST(journal_entry_number_sequences.last_value, EXCLUDED.last_value),
  updated_at = now();

CREATE UNIQUE INDEX IF NOT EXISTS idx_journal_entries_invoice_source_once
  ON journal_entries (company_id, source, source_id)
  WHERE source = 'invoice'
    AND source_id IS NOT NULL
    AND reversed_entry_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_journal_entries_receipt_source_once
  ON journal_entries (company_id, source, source_id)
  WHERE source = 'receipt'
    AND source_id IS NOT NULL
    AND reversed_entry_id IS NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM (
      SELECT
        company_id,
        period_start,
        period_end,
        COUNT(*) AS total_rows,
        COUNT(*) FILTER (WHERE status IN ('filed', 'submitted', 'amended')) AS authoritative_rows
      FROM vat_returns
      GROUP BY company_id, period_start, period_end
      HAVING COUNT(*) > 1
        AND COUNT(*) FILTER (WHERE status IN ('filed', 'submitted', 'amended')) > 1
    ) dup
  ) THEN
    RAISE EXCEPTION
      'Multiple submitted/filed/amended vat_returns company/period rows exist; resolve authoritative filing duplicates before applying vat_returns_company_period_unique';
  END IF;
END $$;

CREATE TEMP TABLE vat_return_duplicate_resolution ON COMMIT DROP AS
WITH duplicate_groups AS (
  SELECT company_id, period_start, period_end
  FROM vat_returns
  GROUP BY company_id, period_start, period_end
  HAVING COUNT(*) > 1
),
ranked_returns AS (
  SELECT
    vr.id,
    FIRST_VALUE(vr.id) OVER (
      PARTITION BY vr.company_id, vr.period_start, vr.period_end
      ORDER BY
        CASE vr.status
          WHEN 'filed' THEN 1
          WHEN 'submitted' THEN 2
          WHEN 'amended' THEN 3
          WHEN 'pending_review' THEN 4
          ELSE 5
        END,
        vr.updated_at DESC NULLS LAST,
        vr.created_at DESC NULLS LAST,
        vr.id DESC
    ) AS keep_id,
    ROW_NUMBER() OVER (
      PARTITION BY vr.company_id, vr.period_start, vr.period_end
      ORDER BY
        CASE vr.status
          WHEN 'filed' THEN 1
          WHEN 'submitted' THEN 2
          WHEN 'amended' THEN 3
          WHEN 'pending_review' THEN 4
          ELSE 5
        END,
        vr.updated_at DESC NULLS LAST,
        vr.created_at DESC NULLS LAST,
        vr.id DESC
    ) AS rn
  FROM vat_returns vr
  JOIN duplicate_groups dg
    ON dg.company_id = vr.company_id
   AND dg.period_start = vr.period_start
   AND dg.period_end = vr.period_end
)
SELECT id AS duplicate_id, keep_id
FROM ranked_returns
WHERE rn > 1;

DO $$
BEGIN
  IF to_regclass('public.vat_return_periods') IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'vat_return_periods'
        AND column_name = 'vat_return_id'
    )
  THEN
    EXECUTE $sql$
      UPDATE vat_return_periods p
      SET vat_return_id = r.keep_id
      FROM vat_return_duplicate_resolution r
      WHERE p.vat_return_id = r.duplicate_id
    $sql$;
  END IF;

  IF to_regclass('public.vat_workpapers') IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'vat_workpapers'
        AND column_name = 'generated_vat_return_id'
    )
  THEN
    EXECUTE $sql$
      UPDATE vat_workpapers w
      SET generated_vat_return_id = r.keep_id
      FROM vat_return_duplicate_resolution r
      WHERE w.generated_vat_return_id = r.duplicate_id
    $sql$;
  END IF;

  IF to_regclass('public.compliance_tasks') IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'compliance_tasks'
        AND column_name = 'related_vat_return_id'
    )
  THEN
    EXECUTE $sql$
      UPDATE compliance_tasks c
      SET related_vat_return_id = r.keep_id
      FROM vat_return_duplicate_resolution r
      WHERE c.related_vat_return_id = r.duplicate_id
    $sql$;
  END IF;
END $$;

DELETE FROM vat_returns vr
USING vat_return_duplicate_resolution r
WHERE vr.id = r.duplicate_id;

CREATE UNIQUE INDEX IF NOT EXISTS vat_returns_company_period_unique
  ON vat_returns (company_id, period_start, period_end);

CREATE UNIQUE INDEX IF NOT EXISTS referrals_code_email_unique
  ON referrals (referral_code_id, referee_email)
  WHERE referee_email IS NOT NULL;
