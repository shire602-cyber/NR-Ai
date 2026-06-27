-- Phase 6: Firm-Wide Command Center
-- Adds firm_alerts (surfaced critical items), firm_metrics_cache (expensive
-- aggregations memoized with a TTL), and a role column on firm_staff_assignments
-- so workload analytics can group by responsibility.

-- 1. firm_staff_assignments: add role column + supporting indexes
ALTER TABLE "firm_staff_assignments"
  ADD COLUMN IF NOT EXISTS "role" text NOT NULL DEFAULT 'accountant';

CREATE INDEX IF NOT EXISTS "idx_firm_staff_assignments_user_id"
  ON "firm_staff_assignments" ("user_id");

CREATE INDEX IF NOT EXISTS "idx_firm_staff_assignments_company_id"
  ON "firm_staff_assignments" ("company_id");

-- 2. firm_alerts: surfaced critical items across all firm-managed clients
CREATE TABLE IF NOT EXISTS "firm_alerts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "firm_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "company_id" uuid REFERENCES "companies"("id") ON DELETE CASCADE,
  "alert_type" text NOT NULL,
  "severity" text NOT NULL DEFAULT 'info',
  "message" text NOT NULL,
  "metadata" text,
  "is_read" boolean NOT NULL DEFAULT false,
  "resolved_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_firm_alerts_firm_id"
  ON "firm_alerts" ("firm_id");

CREATE INDEX IF NOT EXISTS "idx_firm_alerts_company_id"
  ON "firm_alerts" ("company_id");

CREATE INDEX IF NOT EXISTS "idx_firm_alerts_severity"
  ON "firm_alerts" ("severity");

CREATE INDEX IF NOT EXISTS "idx_firm_alerts_unread"
  ON "firm_alerts" ("firm_id", "is_read");

-- 3. firm_metrics_cache: memoized aggregations
CREATE TABLE IF NOT EXISTS "firm_metrics_cache" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "firm_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "metric_type" text NOT NULL,
  "metric_value" text NOT NULL,
  "period_start" timestamp,
  "period_end" timestamp,
  "calculated_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_firm_metrics_cache_firm_type"
  ON "firm_metrics_cache" ("firm_id", "metric_type");

-- Unique on (firm, type, period) for upsert semantics. Use COALESCE for nullable
-- timestamps so two rows with NULL periods of the same metric type collapse.
CREATE UNIQUE INDEX IF NOT EXISTS "firm_metrics_cache_firm_type_period_unique"
  ON "firm_metrics_cache" (
    "firm_id",
    "metric_type",
    COALESCE("period_start", 'epoch'::timestamp),
    COALESCE("period_end", 'epoch'::timestamp)
  );
