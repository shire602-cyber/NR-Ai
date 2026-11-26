-- 0158_s4_einvoice_asp_appointments S4 Idempotent
CREATE TABLE IF NOT EXISTS einvoice_asp_appointments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  provider text NOT NULL,
  terms_version text NOT NULL,
  terms_accepted_at timestamp NOT NULL,
  terms_accepted_by uuid REFERENCES users(id) ON DELETE SET NULL,
  emaratax_confirmed_at timestamp,
  emaratax_confirmed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  revoked_at timestamp,
  revoked_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT einvoice_asp_appointments_company_provider_unique UNIQUE (company_id, provider)
);
