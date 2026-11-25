-- 0113_s5_platform (S5 final sweep; W5-B / W5-A residuals): Free plan default + report artifact object storage.
-- Idempotent: CREATE OR REPLACE FUNCTION, DROP TRIGGER IF EXISTS, ADD COLUMN IF NOT EXISTS and
-- NOT EXISTS-guarded inserts, so re-running the file changes nothing.
--
-- 1. FAIL-OPEN FIX (W5-B): with billing enforcement on, a company without a subscription row was
--    never tier-gated. Every company now gets a Free subscription row when it is created
--    (AFTER INSERT trigger on companies), and existing companies without one are backfilled.
--    Plan gates (server/middleware/featureGate.ts) also treat a missing row as Free.
CREATE OR REPLACE FUNCTION s5_default_free_subscription() RETURNS trigger AS $$
BEGIN
  INSERT INTO subscriptions (company_id, plan_id, plan_name, status, current_period_start,
                             current_period_end, max_users, max_invoices, max_receipts,
                             ai_credits_remaining)
  SELECT NEW.id, 'free', 'Free', 'active', now(), now() + interval '100 years', 1, 20, 20, 10
   WHERE NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.company_id = NEW.id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_companies_default_free_subscription ON companies;
CREATE TRIGGER trg_companies_default_free_subscription
  AFTER INSERT ON companies
  FOR EACH ROW EXECUTE FUNCTION s5_default_free_subscription();

INSERT INTO subscriptions (company_id, plan_id, plan_name, status, current_period_start,
                           current_period_end, max_users, max_invoices, max_receipts,
                           ai_credits_remaining)
SELECT c.id, 'free', 'Free', 'active', now(), now() + interval '100 years', 1, 20, 20, 10
  FROM companies c
 WHERE NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.company_id = c.id);

-- 2. Report delivery artifacts (W5-A residual): bytes go to object storage through
--    server/services/fileStorage.ts when it is configured; `storage_key` names the object and
--    `content` stays NULL. Without object storage (dev/test) the bytes stay in `content`.
ALTER TABLE company_report_delivery_artifacts ADD COLUMN IF NOT EXISTS storage_key text;
ALTER TABLE company_report_delivery_artifacts ALTER COLUMN content DROP NOT NULL;
