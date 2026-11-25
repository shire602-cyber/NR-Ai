-- 0135_step4_signup_plan_choice (STEP4 S4): the plan a customer chose at sign-up (or later) for after
-- the 14-day trial, and when they asked to activate it. Idempotent: ADD COLUMN IF NOT EXISTS and
-- guarded constraints. No backfill: NULL means "no choice yet" (every existing company).
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "chosen_plan_id" text;
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "chosen_billing_cycle" text;
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "chosen_plan_source" text;
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "chosen_plan_at" timestamp;
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "plan_activation_requested_at" timestamp;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'subscriptions_chosen_plan_chk') THEN
    ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_chosen_plan_chk"
      CHECK (chosen_plan_id IS NULL OR chosen_plan_id IN ('starter','professional','enterprise'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'subscriptions_chosen_cycle_chk') THEN
    ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_chosen_cycle_chk"
      CHECK (chosen_billing_cycle IS NULL OR chosen_billing_cycle IN ('monthly','yearly'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'subscriptions_chosen_source_chk') THEN
    ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_chosen_source_chk"
      CHECK (chosen_plan_source IS NULL OR chosen_plan_source IN
             ('signup_default','signup_picked','pricing_link','settings'));
  END IF;
END $$;
