-- 0088_emirate_no_default: stop silently defaulting a company's emirate to Dubai.
--
-- Box 1a–1g of the FTA VAT 201 attributes standard-rated supplies to a specific
-- emirate. The column carried DEFAULT 'dubai', so a company created through
-- signup (which does not ask for an emirate) silently reported its entire
-- turnover under Box 1b — wrong for every business outside Dubai, and wrong in a
-- way nobody would notice until an FTA audit.
--
-- Dropping the default makes new companies start with NULL, and VAT 201
-- generation now refuses with EMIRATE_NOT_SET until the emirate is stated
-- explicitly (onboarding asks for it).
--
-- Existing rows are left untouched: we cannot retroactively distinguish "the
-- user chose Dubai" from "the default was applied", and clearing them would
-- break returns for genuine Dubai companies.

ALTER TABLE companies ALTER COLUMN emirate DROP DEFAULT;
