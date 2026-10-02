-- 0131_vat_books_start: "Muhasib books start from <period>". The first day of the first VAT period whose return this company prepares in
-- Muhasib. Autopilot and the VAT filing list show only periods starting on or after it; earlier periods were filed elsewhere (or are not
-- Muhasib's to prepare) and are recorded with "Filed outside Muhasib" when the user wants them shown as filed. NULL = no trimming.
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "vat_books_start" date;
