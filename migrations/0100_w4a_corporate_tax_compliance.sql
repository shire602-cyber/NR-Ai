-- 0100_w4a_corporate_tax_compliance (W4-A): corporate-tax return lifecycle, CT profile
-- (QFZP / adviser confirmation / compliance settings), related-party register,
-- account tax tags, generated compliance calendar, month-end sign-offs and
-- reopen workflow. Idempotent; do not edit meta/_journal.json.

-- 1. Account tax tags (R08-18): drive account-based CT add-backs/deductions.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS tax_tag text;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'accounts_tax_tag_check') THEN
    ALTER TABLE accounts ADD CONSTRAINT accounts_tax_tag_check CHECK (
      tax_tag IS NULL OR tax_tag IN (
        'entertainment', 'fines_penalties', 'donations_non_qualifying', 'related_party',
        'exempt_income', 'interest', 'qfzp_qualifying_income', 'qfzp_non_qualifying_income',
        'corporate_tax_expense', 'corporate_tax_payable'
      )
    );
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_accounts_company_tax_tag
  ON accounts (company_id, tax_tag) WHERE tax_tag IS NOT NULL;

-- 2. Corporate tax return lifecycle (R08-04, R08-09, R08-19).
--    draft -> computed -> reviewed -> filed (-> paid) ; filed/paid -> amended
--    (the amendment is a new row with amends_return_id = original).
ALTER TABLE corporate_tax_returns
  ALTER COLUMN tax_rate TYPE numeric(6,4) USING tax_rate::numeric(6,4);
ALTER TABLE corporate_tax_returns
  ADD COLUMN IF NOT EXISTS prepared_by uuid,
  ADD COLUMN IF NOT EXISTS computed_at timestamp,
  ADD COLUMN IF NOT EXISTS reviewed_by uuid,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamp,
  ADD COLUMN IF NOT EXISTS filed_by uuid,
  ADD COLUMN IF NOT EXISTS filing_reference text,
  ADD COLUMN IF NOT EXISTS amends_return_id uuid REFERENCES corporate_tax_returns(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS superseded_by_id uuid REFERENCES corporate_tax_returns(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS amendment_number integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS provision_entry_id uuid REFERENCES journal_entries(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS provision_reversal_entry_id uuid REFERENCES journal_entries(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS interest_carried_forward numeric(15,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS updated_at timestamp;

UPDATE corporate_tax_returns
   SET status = 'draft'
 WHERE status IS NULL
    OR status NOT IN ('draft', 'computed', 'reviewed', 'filed', 'paid', 'amended', 'void');

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'corporate_tax_returns_status_check') THEN
    ALTER TABLE corporate_tax_returns ADD CONSTRAINT corporate_tax_returns_status_check CHECK (
      status IN ('draft', 'computed', 'reviewed', 'filed', 'paid', 'amended', 'void')
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'corporate_tax_returns_period_check') THEN
    ALTER TABLE corporate_tax_returns ADD CONSTRAINT corporate_tax_returns_period_check
      CHECK (tax_period_end > tax_period_start) NOT VALID;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_corporate_tax_returns_company_period
  ON corporate_tax_returns (company_id, tax_period_end);
CREATE UNIQUE INDEX IF NOT EXISTS uq_corporate_tax_returns_amends
  ON corporate_tax_returns (amends_return_id) WHERE amends_return_id IS NOT NULL;

-- 3. Company CT / compliance profile (R08-15, R08-17, R08-21): QFZP status,
--    MNE group revenue, adviser confirmation, and the compliance settings the
--    obligation generator reads (trade licence, excise, UBO, e-invoicing).
CREATE TABLE IF NOT EXISTS ct_company_profiles (
  company_id uuid PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  is_qfzp boolean NOT NULL DEFAULT false,
  free_zone text,
  mne_group_revenue numeric(15,2),
  incorporation_date date,
  trade_licence_expiry date,
  excise_registered boolean NOT NULL DEFAULT false,
  ubo_last_confirmed date,
  einvoicing_revenue_band text,
  adviser_confirmed_at timestamp,
  adviser_confirmed_by uuid,
  adviser_name text,
  adviser_note text,
  updated_by uuid,
  updated_at timestamp NOT NULL DEFAULT now(),
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT ct_company_profiles_einvoicing_band_check
    CHECK (einvoicing_revenue_band IS NULL OR einvoicing_revenue_band IN ('ge_50m', 'lt_50m'))
);

-- 4. Related-party and connected-person register (R08-17).
CREATE TABLE IF NOT EXISTS ct_related_parties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  relationship text NOT NULL,
  jurisdiction text,
  nature text,
  period_year integer,
  transaction_value numeric(15,2) NOT NULL DEFAULT 0,
  notes text,
  created_by uuid,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT ct_related_parties_relationship_check
    CHECK (relationship IN ('related_party', 'connected_person')),
  CONSTRAINT ct_related_parties_value_check CHECK (transaction_value >= 0)
);
CREATE INDEX IF NOT EXISTS idx_ct_related_parties_company ON ct_related_parties (company_id);

-- 5. Month-end close depth (R08-23): per-step sign-off and reopen workflow.
CREATE TABLE IF NOT EXISTS month_end_step_signoffs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  period_end date NOT NULL,
  step_key text NOT NULL,
  signed_off_by uuid NOT NULL,
  signed_off_at timestamp NOT NULL DEFAULT now(),
  note text,
  CONSTRAINT month_end_step_signoffs_unique UNIQUE (company_id, period_end, step_key)
);

CREATE TABLE IF NOT EXISTS month_end_reopen_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  period_end date NOT NULL,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  requested_by uuid NOT NULL,
  requested_at timestamp NOT NULL DEFAULT now(),
  decided_by uuid,
  decided_at timestamp,
  decision_note text,
  CONSTRAINT month_end_reopen_requests_status_check
    CHECK (status IN ('pending', 'approved', 'rejected'))
);
CREATE INDEX IF NOT EXISTS idx_month_end_reopen_requests_company
  ON month_end_reopen_requests (company_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS uq_month_end_reopen_pending
  ON month_end_reopen_requests (company_id, period_end) WHERE status = 'pending';

-- 6. Generated compliance obligations (R08-03, R08-21, R13-34).
ALTER TABLE compliance_calendar
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS obligation_key text,
  ADD COLUMN IF NOT EXISTS obligation_type text,
  ADD COLUMN IF NOT EXISTS title_ar text,
  ADD COLUMN IF NOT EXISTS period_start date,
  ADD COLUMN IF NOT EXISTS period_end date,
  ADD COLUMN IF NOT EXISTS related_entity_id uuid,
  ADD COLUMN IF NOT EXISTS legal_source text,
  ADD COLUMN IF NOT EXISTS reminders_sent text NOT NULL DEFAULT '';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'compliance_calendar_source_check') THEN
    ALTER TABLE compliance_calendar ADD CONSTRAINT compliance_calendar_source_check
      CHECK (source IN ('manual', 'generated'));
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS uq_compliance_calendar_obligation
  ON compliance_calendar (company_id, obligation_key) WHERE obligation_key IS NOT NULL;
