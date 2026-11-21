-- 0138_repair_bank_gl_links (W3-C): repair bank GL links when 0097 was already recorded.
-- Idempotent: preserve findings by transaction and kind, and update only stale cached GL links.
CREATE TABLE IF NOT EXISTS "bank_gl_migration_findings" (
  "bank_transaction_id" uuid NOT NULL,
  "company_id" uuid NOT NULL,
  "kind" text NOT NULL,
  "details" jsonb NOT NULL,
  "found_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "bank_gl_migration_findings_pkey" PRIMARY KEY ("bank_transaction_id", "kind")
);
--> statement-breakpoint
-- Record independent ownership and eligibility defects before repairing cached links.
-- Only unallocated, unreconciled lines can safely take the statement's current GL link.
WITH RECURSIVE target_chain AS (
  SELECT a."id" AS target_id, a."company_id", a."code", a."parent_id",
         a."is_vat_account" AND a."vat_type" IN ('input', 'output') AS is_vat_control,
         0 AS depth
    FROM "accounts" a
   WHERE EXISTS (SELECT 1 FROM "bank_accounts" b WHERE b."gl_account_id" = a."id")
  UNION ALL
  SELECT c.target_id, c."company_id", p."code", p."parent_id",
         p."is_vat_account" AND p."vat_type" IN ('input', 'output'), c.depth + 1
    FROM target_chain c
    JOIN "accounts" p ON p."id" = c."parent_id" AND p."company_id" = c."company_id"
   WHERE c.depth < 8
), eligible_targets AS (
  SELECT DISTINCT gl."id", gl."company_id"
    FROM "bank_accounts" ba
    JOIN "accounts" gl ON gl."id" = ba."gl_account_id"
   WHERE gl."is_active" = true AND gl."is_archived" = false
     AND gl."type" = 'asset' AND gl."sub_type" IN ('bank', 'cash')
     AND NOT EXISTS (
       SELECT 1 FROM target_chain c WHERE c.target_id = gl."id"
         AND (c."code" IN ('1040', '2010', '1070', '1050', '2020', '2015', '2030', '2032', '2034', '2036')
           OR c.is_vat_control)
     )
     AND NOT EXISTS (
       SELECT 1 FROM "products" p
        WHERE p."company_id" = gl."company_id" AND p."inventory_account_id" = gl."id"
     )
), findings AS (
  INSERT INTO "bank_gl_migration_findings" ("bank_transaction_id", "company_id", "kind", "details")
  SELECT bt."id", bt."company_id", finding.kind,
         jsonb_build_object(
           'statement_account_id', bt."bank_statement_account_id",
           'statement_company_id', ba."company_id",
           'target_gl_account_id', ba."gl_account_id",
           'target_gl_company_id', gl."company_id",
           'cached_gl_account_id', bt."bank_account_id"
         )
    FROM "bank_transactions" bt
    LEFT JOIN "bank_accounts" ba ON ba."id" = bt."bank_statement_account_id"
    LEFT JOIN "accounts" gl ON gl."id" = ba."gl_account_id"
    LEFT JOIN eligible_targets eligible ON eligible."id" = gl."id"
   CROSS JOIN LATERAL (VALUES
     ('statement_account_missing', ba."id" IS NULL),
     ('statement_company_mismatch', ba."company_id" <> bt."company_id"),
     ('target_gl_account_missing', ba."gl_account_id" IS NOT NULL AND gl."id" IS NULL),
     ('target_gl_company_mismatch', gl."company_id" <> ba."company_id"),
     ('target_gl_ineligible', gl."id" IS NOT NULL AND eligible."id" IS NULL)
   ) AS finding(kind, present)
   WHERE bt."bank_statement_account_id" IS NOT NULL
     AND finding.present
  ON CONFLICT ("bank_transaction_id", "kind") DO NOTHING
)
UPDATE "bank_transactions" bt
   SET "bank_account_id" = gl."id"
  FROM "bank_accounts" ba
  JOIN eligible_targets gl ON gl."id" = ba."gl_account_id" AND gl."company_id" = ba."company_id"
 WHERE bt."bank_statement_account_id" = ba."id"
   AND bt."company_id" = ba."company_id"
   AND bt."bank_account_id" IS DISTINCT FROM gl."id"
   AND bt."is_reconciled" = false
   AND bt."matched_journal_entry_id" IS NULL
   AND bt."matched_invoice_id" IS NULL
   AND bt."matched_receipt_id" IS NULL
   AND NOT EXISTS (
     SELECT 1 FROM "bank_transaction_matches" m
      WHERE m."bank_transaction_id" = bt."id" AND m."status" IN ('active', 'pending')
   );
