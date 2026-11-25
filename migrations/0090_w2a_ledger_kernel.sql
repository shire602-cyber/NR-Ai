-- 0090_w2a_ledger_kernel: ledger posting kernel, owned by workstream W2-A.
-- Idempotent: every statement is safe to re-run. Never edits posted amounts or
-- statuses; integrity problems in existing books are written to
-- ledger_repair_findings instead of failing the migration.

-- (a) journal_entries: kernel columns ------------------------------------
ALTER TABLE "journal_entries" ADD COLUMN IF NOT EXISTS "idempotency_key" text;
ALTER TABLE "journal_entries" ADD COLUMN IF NOT EXISTS "reversed_by_entry_id" uuid;
ALTER TABLE "journal_entries" ADD COLUMN IF NOT EXISTS "reversal_kind" text;
ALTER TABLE "journal_entries" ADD COLUMN IF NOT EXISTS "entry_kind" text NOT NULL DEFAULT 'standard';
ALTER TABLE "journal_entries" ADD COLUMN IF NOT EXISTS "is_duplicate_reversal" boolean NOT NULL DEFAULT false;
ALTER TABLE "journal_entries" ADD COLUMN IF NOT EXISTS "reference" text;
ALTER TABLE "journal_entries" ADD COLUMN IF NOT EXISTS "approval_status" text;
ALTER TABLE "journal_entries" ADD COLUMN IF NOT EXISTS "approved_by" uuid;
ALTER TABLE "journal_entries" ADD COLUMN IF NOT EXISTS "approved_at" timestamp;
ALTER TABLE "journal_entries" ADD COLUMN IF NOT EXISTS "auto_reverse_on" date;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'journal_entries_entry_kind_check') THEN
    ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_entry_kind_check"
      CHECK ("entry_kind" IN ('standard','reversal','closing','year_end_close','opening','revaluation'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'journal_entries_reversal_kind_check') THEN
    ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_reversal_kind_check"
      CHECK ("reversal_kind" IS NULL OR "reversal_kind" IN ('reversed','voided'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'journal_entries_reversed_by_fk') THEN
    ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_reversed_by_fk"
      FOREIGN KEY ("reversed_by_entry_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'journal_entries_approved_by_fk') THEN
    ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_approved_by_fk"
      FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE SET NULL;
  END IF;
END $$;

-- (b) findings table -----------------------------------------------------
CREATE TABLE IF NOT EXISTS "ledger_repair_findings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid,
  "kind" text NOT NULL,
  "entry_id" uuid NOT NULL,
  "details" jsonb,
  "found_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "uq_ledger_repair_findings_kind_entry" UNIQUE ("kind", "entry_id")
);

-- (c) entry_kind backfill ------------------------------------------------
-- A legacy row with reversed_entry_id is a true reversal when it came from the
-- reverse endpoint (source = 'reversal') or its per-account net exactly mirrors
-- the original's. Partial credit notes also carried reversed_entry_id; they stay
-- 'standard' so several of them can reference one invoice entry.
WITH net AS (
  SELECT entry_id, account_id, SUM(debit - credit) AS n
    FROM journal_lines
   GROUP BY entry_id, account_id
),
candidates AS (
  SELECT r.id, r.reversed_entry_id AS orig_id, r.source
    FROM journal_entries r
   WHERE r.reversed_entry_id IS NOT NULL AND r.entry_kind = 'standard'
),
mirrors AS (
  SELECT c.id
    FROM candidates c
   WHERE c.source = 'reversal'
      OR NOT EXISTS (
        SELECT 1
          FROM (SELECT account_id, n FROM net WHERE entry_id = c.id) rn
          FULL OUTER JOIN (SELECT account_id, -n AS n FROM net WHERE entry_id = c.orig_id) onet
            ON onet.account_id = rn.account_id
         WHERE rn.account_id IS NULL OR onet.account_id IS NULL OR rn.n <> onet.n
      )
)
UPDATE journal_entries je SET entry_kind = 'reversal' FROM mirrors m WHERE je.id = m.id;

UPDATE journal_entries
   SET entry_kind = CASE
         WHEN memo ILIKE '%year%end%' THEN 'year_end_close'
         ELSE 'closing'
       END
 WHERE entry_kind = 'standard'
   AND source = 'system'
   AND (memo ILIKE '%closing%' OR memo ILIKE '%year%end%clos%');

-- (d) duplicate reversals: keep the earliest, flag the rest, record findings --
WITH ranked AS (
  SELECT id, company_id, reversed_entry_id, entry_number, created_at,
         ROW_NUMBER() OVER (PARTITION BY reversed_entry_id ORDER BY created_at, id) AS rn
    FROM journal_entries
   WHERE entry_kind = 'reversal' AND reversed_entry_id IS NOT NULL
)
UPDATE journal_entries je SET is_duplicate_reversal = true
  FROM ranked
 WHERE je.id = ranked.id AND ranked.rn > 1 AND je.is_duplicate_reversal = false;

INSERT INTO ledger_repair_findings (company_id, kind, entry_id, details)
SELECT je.company_id, 'duplicate_reversal', je.id,
       jsonb_build_object('reversedEntryId', je.reversed_entry_id, 'entryNumber', je.entry_number,
                          'status', je.status)
  FROM journal_entries je
 WHERE je.is_duplicate_reversal
ON CONFLICT ("kind", "entry_id") DO NOTHING;

-- (e) link originals to their (single valid) reversal -------------------------
UPDATE journal_entries o
   SET reversed_by_entry_id = r.id,
       reversal_kind = COALESCE(o.reversal_kind, 'reversed')
  FROM journal_entries r
 WHERE r.reversed_entry_id = o.id
   AND r.entry_kind = 'reversal'
   AND NOT r.is_duplicate_reversal
   AND o.reversed_by_entry_id IS NULL;

-- (f) unbalanced entries (pre-kernel 0.01 tolerance) -> findings ---------------
INSERT INTO ledger_repair_findings (company_id, kind, entry_id, details)
SELECT je.company_id, 'unbalanced_entry', je.id,
       jsonb_build_object('entryNumber', je.entry_number, 'status', je.status,
                          'debit', t.d::text, 'credit', t.c::text, 'difference', (t.d - t.c)::text)
  FROM journal_entries je
  JOIN (SELECT entry_id, SUM(debit) AS d, SUM(credit) AS c FROM journal_lines GROUP BY entry_id) t
    ON t.entry_id = je.id
 WHERE t.d <> t.c
ON CONFLICT ("kind", "entry_id") DO NOTHING;

-- (g) partial unique indexes --------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS "uq_journal_entries_company_idempotency"
  ON "journal_entries" ("company_id", "idempotency_key")
  WHERE "idempotency_key" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "uq_journal_entries_one_reversal"
  ON "journal_entries" ("reversed_entry_id")
  WHERE "entry_kind" = 'reversal' AND NOT "is_duplicate_reversal";
CREATE INDEX IF NOT EXISTS "idx_journal_entries_auto_reverse"
  ON "journal_entries" ("auto_reverse_on")
  WHERE "auto_reverse_on" IS NOT NULL AND "reversed_by_entry_id" IS NULL;
CREATE INDEX IF NOT EXISTS "idx_journal_entries_company_date_id"
  ON "journal_entries" ("company_id", "date" DESC, "id" DESC);

-- (h) settings, templates, attachments ----------------------------------------
CREATE TABLE IF NOT EXISTS "ledger_settings" (
  "company_id" uuid PRIMARY KEY REFERENCES "companies"("id") ON DELETE CASCADE,
  "manual_approval_threshold" numeric(15,2),
  "updated_by" uuid,
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "journal_templates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "memo" text,
  "lines" jsonb NOT NULL,
  "frequency" text NOT NULL DEFAULT 'monthly',
  "next_run_on" date,
  "end_on" date,
  "post_as" text NOT NULL DEFAULT 'posted',
  "auto_reverse_days" integer,
  "is_active" boolean NOT NULL DEFAULT true,
  "last_run_on" date,
  "last_entry_id" uuid,
  "created_by" uuid NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp,
  CONSTRAINT "journal_templates_frequency_check"
    CHECK ("frequency" IN ('none','weekly','monthly','quarterly','yearly')),
  CONSTRAINT "journal_templates_post_as_check" CHECK ("post_as" IN ('draft','posted')),
  CONSTRAINT "journal_templates_auto_reverse_days_check"
    CHECK ("auto_reverse_days" IS NULL OR ("auto_reverse_days" BETWEEN 1 AND 366))
);
CREATE INDEX IF NOT EXISTS "idx_journal_templates_company" ON "journal_templates" ("company_id");
CREATE INDEX IF NOT EXISTS "idx_journal_templates_due"
  ON "journal_templates" ("next_run_on") WHERE "is_active";

CREATE TABLE IF NOT EXISTS "journal_attachments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "entry_id" uuid NOT NULL REFERENCES "journal_entries"("id") ON DELETE CASCADE,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "file_name" text NOT NULL,
  "content_type" text NOT NULL,
  "storage_key" text NOT NULL,
  "size_bytes" integer NOT NULL DEFAULT 0,
  "uploaded_by" uuid NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_journal_attachments_entry" ON "journal_attachments" ("entry_id");
