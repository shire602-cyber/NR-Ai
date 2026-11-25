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
-- Keep the ownership defects for operator review. The two ownership checks are independent:
-- transaction -> managed statement account, and managed statement account -> target GL account.
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
 CROSS JOIN LATERAL (VALUES
   ('statement_account_missing', ba."id" IS NULL),
   ('statement_company_mismatch', ba."company_id" <> bt."company_id"),
   ('target_gl_account_missing', ba."gl_account_id" IS NOT NULL AND gl."id" IS NULL),
   ('target_gl_company_mismatch', gl."company_id" <> ba."company_id")
 ) AS finding(kind, present)
 WHERE bt."bank_statement_account_id" IS NOT NULL
   AND finding.present
ON CONFLICT ("bank_transaction_id", "kind") DO NOTHING;
--> statement-breakpoint
-- Only unallocated, unreconciled lines can safely take the statement's current GL link.
UPDATE "bank_transactions" bt
   SET "bank_account_id" = gl."id"
  FROM "bank_accounts" ba
  JOIN "accounts" gl ON gl."id" = ba."gl_account_id" AND gl."company_id" = ba."company_id"
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
