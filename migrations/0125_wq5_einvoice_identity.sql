-- 0125_wq5_einvoice_identity (WQ5 e-invoicing identity and contacts; W4-C e-invoicing): seller tax identity, unified contacts, approver links.
-- Idempotent: ADD COLUMN IF NOT EXISTS / CREATE ... IF NOT EXISTS only, so re-running the file changes nothing.
--
-- Company: a stored, validated TIN (10 digits, the first 10 of the CT TRN), the seller legal
-- identifier type and number (trade licence, Emirates ID, passport, Cabinet decision), the rest of
-- the structured address, Arabic legal name and address, the chosen accredited partner (no default)
-- and the self-confirmed appointment fallback. Contacts: customer and/or supplier role (the vendor
-- row stays the purchasing record and is linked), business/individual, free zone, structured
-- address, typed tax registrations, default accounts / VAT treatment / cost centre. Approver links:
-- single-purpose, expiring, revocable tokens (stored hashed) for the no-login EmaraTax step page.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS einvoice_tin text;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS seller_id_type text;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS seller_id_number text;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS seller_id_country text;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS address_district text;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS address_po_box text;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS legal_name_ar text;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS address_ar text;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS einvoice_partner text;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS einvoice_appointment_confirmed_at timestamp;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS einvoice_appointment_confirmed_by uuid;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS einvoice_tax_ready_prompted_at timestamp;

ALTER TABLE customer_contacts ADD COLUMN IF NOT EXISTS is_customer boolean NOT NULL DEFAULT true;
ALTER TABLE customer_contacts ADD COLUMN IF NOT EXISTS is_supplier boolean NOT NULL DEFAULT false;
ALTER TABLE customer_contacts ADD COLUMN IF NOT EXISTS vendor_id uuid
  REFERENCES vendors(id) ON DELETE SET NULL;
ALTER TABLE customer_contacts ADD COLUMN IF NOT EXISTS party_type text NOT NULL DEFAULT 'business';
ALTER TABLE customer_contacts ADD COLUMN IF NOT EXISTS free_zone boolean NOT NULL DEFAULT false;
ALTER TABLE customer_contacts ADD COLUMN IF NOT EXISTS address_street text;
ALTER TABLE customer_contacts ADD COLUMN IF NOT EXISTS address_building text;
ALTER TABLE customer_contacts ADD COLUMN IF NOT EXISTS address_district text;
ALTER TABLE customer_contacts ADD COLUMN IF NOT EXISTS postal_code text;
ALTER TABLE customer_contacts ADD COLUMN IF NOT EXISTS tax_registrations jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE customer_contacts ADD COLUMN IF NOT EXISTS default_revenue_account_id uuid
  REFERENCES accounts(id) ON DELETE SET NULL;
ALTER TABLE customer_contacts ADD COLUMN IF NOT EXISTS default_expense_account_id uuid
  REFERENCES accounts(id) ON DELETE SET NULL;
ALTER TABLE customer_contacts ADD COLUMN IF NOT EXISTS default_vat_treatment text;
ALTER TABLE customer_contacts ADD COLUMN IF NOT EXISTS default_cost_center_id uuid
  REFERENCES cost_centers(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS customer_contacts_vendor_unique
  ON customer_contacts (company_id, vendor_id) WHERE vendor_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS einvoice_approver_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  approver_name text,
  approver_email text,
  created_by uuid,
  expires_at timestamp NOT NULL,
  revoked_at timestamp,
  completed_at timestamp,
  last_viewed_at timestamp,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS einvoice_approver_links_token_unique
  ON einvoice_approver_links (token_hash);
CREATE INDEX IF NOT EXISTS idx_einvoice_approver_links_company
  ON einvoice_approver_links (company_id);
