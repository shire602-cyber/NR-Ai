-- 0114_s8_residuals (S8 final sweep; W5-A / S5 residual): delete report artifacts from object storage.
-- Idempotent: CREATE TABLE/INDEX IF NOT EXISTS, CREATE OR REPLACE FUNCTION and DROP TRIGGER IF
-- EXISTS, so re-running the file changes nothing.
--
-- A delivery artifact whose bytes live in object storage (storage_key) leaves an orphaned object
-- when its row is deleted, directly or by cascade from its run or company. The AFTER DELETE
-- trigger queues the key; the storage.objectDeletionSweep job deletes the object with retries and
-- backoff. The database delete never waits for (or fails because of) the object store.
CREATE TABLE IF NOT EXISTS object_storage_deletions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  storage_key text NOT NULL,
  source text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  next_attempt_at timestamp NOT NULL DEFAULT now(),
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_object_storage_deletions_due
  ON object_storage_deletions (status, next_attempt_at);

CREATE OR REPLACE FUNCTION s8_queue_report_artifact_object_deletion() RETURNS trigger AS $$
BEGIN
  IF OLD.storage_key IS NOT NULL AND OLD.storage_key <> '' THEN
    INSERT INTO object_storage_deletions (storage_key, source)
    VALUES (OLD.storage_key, 'company_report_delivery_artifacts');
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_report_artifacts_queue_object_deletion ON company_report_delivery_artifacts;
CREATE TRIGGER trg_report_artifacts_queue_object_deletion
  AFTER DELETE ON company_report_delivery_artifacts
  FOR EACH ROW EXECUTE FUNCTION s8_queue_report_artifact_object_deletion();
