-- 0092_trials_and_stored_files
--
-- 1. Free-trial support: subscriptions.trial_ends_at. Status 'trialing' has
--    existed for a while but nothing recorded when a trial ends.
-- 2. One subscription row per company, so trial creation is idempotent under
--    concurrent requests. Only created when no duplicates exist (a duplicate
--    would make the index fail, and this migration must never block a deploy).
-- 3. stored_files ledger: one row per object written to file storage, so
--    per-company storage usage is a real SUM instead of a hard-coded 0.
--
-- Idempotent: every statement is guarded.

ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS trial_ends_at timestamp;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = current_schema() AND indexname = 'uq_subscriptions_company_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM subscriptions GROUP BY company_id HAVING COUNT(*) > 1
  ) THEN
    CREATE UNIQUE INDEX uq_subscriptions_company_id ON subscriptions (company_id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS stored_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  storage_key text NOT NULL,
  category text NOT NULL,
  filename text NOT NULL,
  content_type text NOT NULL,
  size_bytes integer NOT NULL,
  uploaded_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stored_files_company_id ON stored_files (company_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_stored_files_storage_key ON stored_files (storage_key);
