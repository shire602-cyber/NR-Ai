-- 0118_x4_payroll (X4 launch fixes; W3-D payroll residual): settlement payment + unique employee identifiers.
-- (also W4-B fixed-asset residual: recoverable input VAT paid with a capitalised asset)
-- Idempotent: ADD COLUMN IF NOT EXISTS and guarded CREATE UNIQUE INDEX IF NOT EXISTS only, so
-- re-running the file changes nothing.
--
-- 1. A posted final settlement can be paid later (Dr 2030 / Cr bank): record the payment entry,
--    date and time on the settlement.
ALTER TABLE payroll_settlements ADD COLUMN IF NOT EXISTS payment_journal_entry_id uuid;
--> statement-breakpoint
ALTER TABLE payroll_settlements ADD COLUMN IF NOT EXISTS payment_date date;
--> statement-breakpoint
ALTER TABLE payroll_settlements ADD COLUMN IF NOT EXISTS paid_at timestamp;
--> statement-breakpoint
-- 2. One live employee per company per employee number / IBAN / Emirates ID (duplicate WPS
--    payments). The application checks first (409 EMPLOYEE_DUPLICATE); these partial unique
--    indexes are the race backstop. Existing duplicates are never deleted or rewritten: when a
--    company already has a duplicate the index is skipped (NOTICE) and the application check
--    still blocks new duplicates; the index can be created once the data is cleaned up.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM employees
     WHERE archived_at IS NULL AND employee_number IS NOT NULL AND btrim(employee_number) <> ''
     GROUP BY company_id, lower(btrim(employee_number)) HAVING count(*) > 1
  ) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS uq_employees_company_employee_number
      ON employees (company_id, lower(btrim(employee_number)))
      WHERE archived_at IS NULL AND employee_number IS NOT NULL AND btrim(employee_number) <> '';
  ELSE
    RAISE NOTICE '0118: duplicate employee numbers exist; uq_employees_company_employee_number not created';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM employees
     WHERE archived_at IS NULL AND status <> 'terminated' AND iban IS NOT NULL
       AND regexp_replace(iban, '\s', '', 'g') <> ''
     GROUP BY company_id, upper(regexp_replace(iban, '\s', '', 'g')) HAVING count(*) > 1
  ) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS uq_employees_company_iban
      ON employees (company_id, upper(regexp_replace(iban, '\s', '', 'g')))
      WHERE archived_at IS NULL AND status <> 'terminated' AND iban IS NOT NULL
        AND regexp_replace(iban, '\s', '', 'g') <> '';
  ELSE
    RAISE NOTICE '0118: duplicate employee IBANs exist; uq_employees_company_iban not created';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM employees
     WHERE archived_at IS NULL AND status <> 'terminated' AND emirates_id IS NOT NULL
       AND regexp_replace(emirates_id, '[^0-9]', '', 'g') <> ''
     GROUP BY company_id, regexp_replace(emirates_id, '[^0-9]', '', 'g') HAVING count(*) > 1
  ) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS uq_employees_company_emirates_id
      ON employees (company_id, regexp_replace(emirates_id, '[^0-9]', '', 'g'))
      WHERE archived_at IS NULL AND status <> 'terminated' AND emirates_id IS NOT NULL
        AND regexp_replace(emirates_id, '[^0-9]', '', 'g') <> '';
  ELSE
    RAISE NOTICE '0118: duplicate employee Emirates IDs exist; uq_employees_company_emirates_id not created';
  END IF;
END $$;
--> statement-breakpoint
-- 3. Recoverable input VAT paid with a capitalised fixed asset (Dr 1050 on the capitalisation
--    entry; VAT 201 Box 9 reads it from here).
ALTER TABLE fixed_assets ADD COLUMN IF NOT EXISTS acquisition_vat numeric(15,2) NOT NULL DEFAULT 0;
--> statement-breakpoint
-- 4. Gratuity provision already booked before go-live (opening balance in 2036): counted as
--    accrued, so the first payroll run does not charge the whole service history to one month.
ALTER TABLE employees ADD COLUMN IF NOT EXISTS opening_gratuity_provision numeric(15,2) NOT NULL DEFAULT 0;
