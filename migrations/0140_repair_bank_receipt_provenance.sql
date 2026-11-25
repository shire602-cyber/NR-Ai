-- 0140_repair_bank_receipt_provenance (W3-C): restore provable legacy receipt journal ownership.
-- Idempotent: repair only the affected receipt flag and record competing claims for operator review.

-- Older 0097 variants found the receipt but missed its bank-generated journal.
-- Modern receipt allocations intentionally link existing entries and keep their original flags.
UPDATE "bank_transaction_matches" m
   SET "created_journal" = true
  FROM "bank_transactions" bt, "receipts" r, "journal_entries" j
 WHERE m."bank_transaction_id" = bt."id" AND m."company_id" = bt."company_id"
   AND m."target_type" = 'receipt' AND m."target_id" = r."id" AND r."company_id" = bt."company_id"
   AND m."journal_entry_id" = j."id" AND j."company_id" = bt."company_id"
   AND m."status" = 'active' AND m."created_journal" = false
   AND m."payment_id" IS NULL AND m."idempotency_key" IS NULL
   AND bt."is_reconciled" = true AND bt."matched_invoice_id" IS NULL
   AND (bt."matched_receipt_id" IS NULL OR bt."matched_receipt_id" = r."id")
   AND (bt."matched_journal_entry_id" IS NULL OR bt."matched_journal_entry_id" = j."id")
   AND j."source" = 'bank_reconciliation' AND j."source_id" = bt."id";
--> statement-breakpoint

-- Repeat the current 0139 claim audit for databases with its earlier hash recorded.
-- Record both actual pointers and unambiguous intended pointers. An allocation can
-- claim a payment through either and must count only once for the same payment.
-- Ownership comes from the candidate payment and its invoice/journal. Corrupt
-- claimant metadata does not make either observed link safe to ignore.
WITH live_matches AS (
  SELECT m."id", m."bank_transaction_id", bt."company_id" AS transaction_company_id,
         m."target_type", m."target_id", m."journal_entry_id", m."payment_id"
    FROM "bank_transaction_matches" m
    JOIN "bank_transactions" bt ON bt."id" = m."bank_transaction_id"
   WHERE m."status" IN ('active', 'pending')
), owned_triples AS (
  SELECT DISTINCT i."company_id", m."target_id", m."journal_entry_id"
    FROM live_matches m
    JOIN "invoices" i ON i."id" = m."target_id"
    JOIN "journal_entries" j ON j."id" = m."journal_entry_id" AND j."company_id" = i."company_id"
   WHERE m."target_type" = 'invoice'
), unique_candidates AS (
  SELECT p."company_id", p."invoice_id", p."journal_entry_id",
         (array_agg(p."id"))[1] AS candidate_id
    FROM "invoice_payments" p
    JOIN owned_triples t ON t."company_id" = p."company_id"
     AND t."target_id" = p."invoice_id" AND t."journal_entry_id" = p."journal_entry_id"
   GROUP BY p."company_id", p."invoice_id", p."journal_entry_id"
  HAVING count(*) = 1
), claims AS (
  SELECT DISTINCT m."id", m."bank_transaction_id", m.transaction_company_id,
         m."payment_id", evidence.claimed_payment_id
    FROM live_matches m
    LEFT JOIN unique_candidates c ON m."target_type" = 'invoice'
     AND c."invoice_id" = m."target_id" AND c."journal_entry_id" = m."journal_entry_id"
   CROSS JOIN LATERAL (VALUES (m."payment_id"), (c.candidate_id)) AS evidence(claimed_payment_id)
    JOIN "invoice_payments" actual_payment ON actual_payment."id" = evidence.claimed_payment_id
), counted AS (
  SELECT claims.*, count(*) OVER (PARTITION BY claimed_payment_id) AS claim_count FROM claims
)
INSERT INTO "bank_gl_migration_findings" ("bank_transaction_id", "company_id", "kind", "details")
SELECT "bank_transaction_id", transaction_company_id, 'invoice_payment_competing_claims',
       jsonb_build_object('claims', jsonb_agg(jsonb_build_object(
         'match_id', "id", 'claimed_payment_id', claimed_payment_id,
         'stored_payment_id', "payment_id", 'claim_count', claim_count
       ) ORDER BY "id", claimed_payment_id))
  FROM counted
 WHERE claim_count > 1
 GROUP BY "bank_transaction_id", transaction_company_id
ON CONFLICT ("bank_transaction_id", "kind") DO NOTHING;
