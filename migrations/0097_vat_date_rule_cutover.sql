-- 0097_vat_date_rule_cutover
-- Records the moment the date-based VAT void rule took effect on this installation, so that VAT
-- returns filed BEFORE it (computed by the old rule: a void invoice never counted) can be told
-- apart from returns filed after it. Fully idempotent; re-running never moves the cutover.
--
--  * system_settings: a tiny key/value table for installation-wide facts.
--  * key vat_date_based_voids_from: the execution time of this migration (UTC, ISO 8601).

CREATE TABLE IF NOT EXISTS "system_settings" (
  "key" text PRIMARY KEY,
  "value" text NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

INSERT INTO "system_settings" ("key", "value")
VALUES ('vat_date_based_voids_from', to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
ON CONFLICT ("key") DO NOTHING;
