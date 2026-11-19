-- 0134_step3_remove_price_editor (STEP3): the unused admin price editor is removed (owner, 2026-11-19).
-- Plan prices live only in shared/plans.ts. Idempotent: guarded DROP TABLE IF EXISTS only. A table
-- that still holds rows is never dropped silently: the migration stops so the owner can export it.
DO $$
DECLARE n bigint;
BEGIN
  IF to_regclass('public.user_subscriptions') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM user_subscriptions' INTO n;
    IF n > 0 THEN RAISE EXCEPTION '0134: user_subscriptions holds % row(s); export and get owner sign-off first', n; END IF;
  END IF;
  IF to_regclass('public.subscription_plans') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM subscription_plans' INTO n;
    IF n > 0 THEN RAISE EXCEPTION '0134: subscription_plans holds % row(s); export and get owner sign-off first', n; END IF;
  END IF;
END $$;
--> statement-breakpoint
DROP TABLE IF EXISTS "user_subscriptions";
--> statement-breakpoint
DROP TABLE IF EXISTS "subscription_plans";
--> statement-breakpoint
