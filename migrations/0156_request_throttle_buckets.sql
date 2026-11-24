-- 0156_request_throttle_buckets (W2-C): Idempotent shared HTTP and credential throttling state.
CREATE TABLE IF NOT EXISTS request_throttle_buckets (
  namespace text NOT NULL,
  key_hash text NOT NULL,
  events jsonb NOT NULL DEFAULT '[]'::jsonb,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (namespace, key_hash)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS request_throttle_buckets_expiry_idx
  ON request_throttle_buckets (expires_at);
