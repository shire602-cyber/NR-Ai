-- 0122_time_entries_timestamptz: timer instants are real instants. Idempotent.
--
-- time_entries.started_at / ended_at (0107) were `timestamp` columns holding UTC wall-clock values; a client or a
-- database in another time zone read them an offset out. They become timestamptz (the stored values are UTC, so the
-- conversion is AT TIME ZONE 'UTC'); the guard keeps a second run from shifting them again.

-- Also (final-settlement fix): whether the provision used on a settlement was typed by the user. A settlement whose
-- provision is not an override has it recomputed from the accrual to date when it is posted.
ALTER TABLE "employee_final_settlements" ADD COLUMN IF NOT EXISTS "provision_overridden" boolean NOT NULL DEFAULT false;

DO $$ BEGIN
  IF (SELECT data_type FROM information_schema.columns WHERE table_name = 'time_entries' AND column_name = 'started_at') = 'timestamp without time zone' THEN
    ALTER TABLE "time_entries" ALTER COLUMN "started_at" TYPE timestamptz USING "started_at" AT TIME ZONE 'UTC';
  END IF;
  IF (SELECT data_type FROM information_schema.columns WHERE table_name = 'time_entries' AND column_name = 'ended_at') = 'timestamp without time zone' THEN
    ALTER TABLE "time_entries" ALTER COLUMN "ended_at" TYPE timestamptz USING "ended_at" AT TIME ZONE 'UTC';
  END IF;
END $$;
