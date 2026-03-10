-- Cross-Sell Campaigns table for admin-approved service promotions
CREATE TABLE IF NOT EXISTS "cross_sell_campaigns" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" text NOT NULL,
  "description" text,
  "service_name" text NOT NULL,
  "service_description" text NOT NULL,
  "target_criteria" text,
  "status" text NOT NULL DEFAULT 'draft',
  "approved_by" uuid REFERENCES "users"("id"),
  "approved_at" timestamp,
  "created_by" uuid REFERENCES "users"("id"),
  "target_count" integer NOT NULL DEFAULT 0,
  "sent_count" integer NOT NULL DEFAULT 0,
  "failed_count" integer NOT NULL DEFAULT 0,
  "responded_count" integer NOT NULL DEFAULT 0,
  "converted_count" integer NOT NULL DEFAULT 0,
  "scheduled_for" timestamp,
  "completed_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Cross-Sell Campaign Targets table for individual client targets
CREATE TABLE IF NOT EXISTS "cross_sell_targets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "campaign_id" uuid NOT NULL REFERENCES "cross_sell_campaigns"("id") ON DELETE CASCADE,
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "personalized_message" text,
  "status" text NOT NULL DEFAULT 'pending',
  "queue_item_id" uuid,
  "sent_at" timestamp,
  "responded_at" timestamp,
  "converted_at" timestamp,
  "last_error" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);
