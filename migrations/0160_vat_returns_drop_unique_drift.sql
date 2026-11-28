-- 0160_vat_returns_drop_unique_drift (F02 staging drift). Idempotent: drops any UNIQUE index or constraint on vat_returns other than its primary key.
-- The repo declares none; an out-of-repo one (for example from an old db:push) makes every amendment (same company and period as the original) fail with 23505. No-op on a clean database.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT i.relname AS index_name, c.conname AS constraint_name
    FROM pg_index x
    JOIN pg_class t ON t.oid = x.indrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    JOIN pg_class i ON i.oid = x.indexrelid
    LEFT JOIN pg_constraint c ON c.conindid = x.indexrelid AND c.contype = 'u'
    WHERE n.nspname = 'public'
      AND t.relname = 'vat_returns'
      AND x.indisunique
      AND NOT x.indisprimary
  LOOP
    IF r.constraint_name IS NOT NULL THEN
      RAISE NOTICE 'vat_returns: dropping unique constraint %', r.constraint_name;
      EXECUTE format('ALTER TABLE public.vat_returns DROP CONSTRAINT IF EXISTS %I', r.constraint_name);
    ELSE
      RAISE NOTICE 'vat_returns: dropping unique index %', r.index_name;
      EXECUTE format('DROP INDEX IF EXISTS public.%I', r.index_name);
    END IF;
  END LOOP;
END $$;
CREATE INDEX IF NOT EXISTS idx_vat_returns_company_period ON public.vat_returns (company_id, period_start);
