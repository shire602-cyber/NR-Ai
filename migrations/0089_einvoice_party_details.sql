-- 0089_einvoice_party_details: party fields PINT AE needs on UAE e-invoices.
--
-- Complyance (and the FTA's PINT AE rules) require the buyer's emirate
-- (IBR-144-AE) and, for trade-licence registrations, the issuing authority
-- (IBR-101-AE). Companies already store emirate and trade-licence number;
-- contacts had neither. All columns are nullable: existing rows stay valid and
-- the e-invoicing validation gate reports what is missing.

ALTER TABLE companies ADD COLUMN IF NOT EXISTS trade_license_authority text;
ALTER TABLE customer_contacts ADD COLUMN IF NOT EXISTS emirate text;
ALTER TABLE customer_contacts ADD COLUMN IF NOT EXISTS trade_license_number text;
ALTER TABLE customer_contacts ADD COLUMN IF NOT EXISTS trade_license_authority text;
