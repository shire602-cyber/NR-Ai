CREATE TABLE IF NOT EXISTS "company_report_automation_preferences" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "persona" text NOT NULL,
  "preferred_delivery_automation_command" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "company_report_automation_preferences_unique"
    UNIQUE ("company_id", "user_id", "persona")
);

CREATE INDEX IF NOT EXISTS "idx_company_report_automation_preferences_company_id"
  ON "company_report_automation_preferences" ("company_id");

CREATE INDEX IF NOT EXISTS "idx_company_report_automation_preferences_user_id"
  ON "company_report_automation_preferences" ("user_id");
