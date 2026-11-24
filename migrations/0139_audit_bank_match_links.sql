-- 0139_audit_bank_match_links (W3-C): record unsafe historical bank allocations and GL links.
-- Idempotent: retain the original finding per transaction and kind; leave accounting rows intact.

-- A unique invoice/company/journal candidate can still share its journal with another payment.
-- Aggregate only payments for journals referenced by current invoice allocations.
WITH invoice_matches AS (
  SELECT m.*, bt."company_id" AS transaction_company_id, bt."is_reconciled",
         bt."matched_invoice_id", bt."matched_receipt_id", bt."matched_journal_entry_id"
    FROM "bank_transaction_matches" m
    JOIN "bank_transactions" bt ON bt."id" = m."bank_transaction_id"
   WHERE m."target_type" = 'invoice' AND m."status" IN ('active', 'pending')
), journal_ids AS (
  SELECT DISTINCT "journal_entry_id" FROM invoice_matches WHERE "journal_entry_id" IS NOT NULL
), payment_groups AS (
  SELECT p."journal_entry_id", p."company_id", p."invoice_id", count(*) AS candidate_count
    FROM "invoice_payments" p
    JOIN journal_ids j ON j."journal_entry_id" = p."journal_entry_id"
   GROUP BY p."journal_entry_id", p."company_id", p."invoice_id"
), journal_counts AS (
  SELECT "journal_entry_id", sum(candidate_count) AS journal_payment_count
    FROM payment_groups GROUP BY "journal_entry_id"
), reviewed AS (
  SELECT m."id", m."bank_transaction_id", m.transaction_company_id, m."payment_id",
         m."target_id", m."journal_entry_id",
         COALESCE(g.candidate_count, 0) AS candidate_count,
         COALESCE(jc.journal_payment_count, 0) AS journal_payment_count,
         array_remove(ARRAY[
           CASE WHEN m."company_id" <> m.transaction_company_id THEN 'allocation_company_mismatch' END,
           CASE WHEN inv."id" IS NULL THEN 'invoice_missing'
                WHEN inv."company_id" <> m.transaction_company_id THEN 'invoice_company_mismatch' END,
           CASE WHEN je."id" IS NULL THEN 'journal_missing'
                WHEN je."company_id" <> m.transaction_company_id THEN 'journal_company_mismatch' END,
           CASE WHEN g.candidate_count IS NULL AND NOT provenance.bank_owned_journal
                  THEN 'missing_payment_candidate'
                WHEN g.candidate_count > 1 THEN 'duplicate_payment_candidates' END,
           CASE WHEN m."payment_id" IS NULL THEN
                  CASE WHEN NOT provenance.bank_owned_journal THEN 'payment_link_missing' END
                WHEN p."id" IS NULL OR p."company_id" <> m.transaction_company_id
                  OR p."invoice_id" IS DISTINCT FROM m."target_id"
                  OR p."journal_entry_id" IS DISTINCT FROM m."journal_entry_id"
                  THEN 'payment_link_mismatch' END,
           CASE WHEN jc.journal_payment_count > 1 THEN 'shared_payment_journal' END,
           CASE WHEN m."status" <> 'active' OR (m."created_journal" AND NOT provenance.bank_owned_journal)
                  THEN 'unexpected_allocation_state' END,
           CASE WHEN je."id" IS NOT NULL AND (je."status" IS DISTINCT FROM 'posted'
                  OR je."reversed_by_entry_id" IS NOT NULL) THEN 'journal_not_reversible' END
         ], NULL) AS problems
    FROM invoice_matches m
    LEFT JOIN "invoices" inv ON inv."id" = m."target_id"
    LEFT JOIN "journal_entries" je ON je."id" = m."journal_entry_id"
    LEFT JOIN "invoice_payments" p ON p."id" = m."payment_id"
    LEFT JOIN payment_groups g ON g."journal_entry_id" = m."journal_entry_id"
     AND g."company_id" = m.transaction_company_id AND g."invoice_id" = m."target_id"
    LEFT JOIN journal_counts jc ON jc."journal_entry_id" = m."journal_entry_id"
   -- A legacy invoice match could post its own bank journal without an invoice payment row.
   CROSS JOIN LATERAL (VALUES ((
     m."payment_id" IS NULL AND m."idempotency_key" IS NULL AND m."is_reconciled" = true
     AND m."company_id" = m.transaction_company_id AND inv."company_id" = m.transaction_company_id
     AND je."company_id" = m.transaction_company_id AND m."matched_receipt_id" IS NULL
     AND (m."matched_invoice_id" IS NULL OR m."matched_invoice_id" = inv."id")
     AND (m."matched_journal_entry_id" IS NULL OR m."matched_journal_entry_id" = je."id")
     AND je."source" = 'bank_reconciliation' AND je."source_id" = m."bank_transaction_id"
     AND jc.journal_payment_count IS NULL
   ) IS TRUE)) AS provenance(bank_owned_journal)
)
INSERT INTO "bank_gl_migration_findings" ("bank_transaction_id", "company_id", "kind", "details")
SELECT "bank_transaction_id", transaction_company_id, 'invoice_payment_link_review',
       jsonb_build_object('allocations', jsonb_agg(jsonb_build_object(
         'match_id', "id", 'payment_id', "payment_id", 'invoice_id', "target_id",
         'journal_entry_id', "journal_entry_id", 'candidate_count', candidate_count,
         'journal_payment_count', journal_payment_count, 'problems', problems
       ) ORDER BY "id"))
  FROM reviewed
 WHERE cardinality(problems) > 0
 GROUP BY "bank_transaction_id", transaction_company_id
ON CONFLICT ("bank_transaction_id", "kind") DO NOTHING;
--> statement-breakpoint

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
--> statement-breakpoint

-- The journal cannot establish which cache values an older migration introduced.
-- Capture present invalid links for review and keep the original values intact.
WITH RECURSIVE linked_ids AS (
  SELECT "gl_account_id" AS account_id FROM "bank_accounts" WHERE "gl_account_id" IS NOT NULL
  UNION
  SELECT "bank_account_id" FROM "bank_transactions" WHERE "bank_account_id" IS NOT NULL
), linked_accounts AS (
  SELECT a.* FROM "accounts" a JOIN linked_ids l ON l.account_id = a."id"
), account_chain AS (
  SELECT a."id" AS account_id, a."company_id", a."code", a."parent_id",
         a."is_vat_account" AND a."vat_type" IN ('input', 'output') AS is_vat_control,
         0 AS depth
    FROM linked_accounts a
  UNION ALL
  SELECT c.account_id, c."company_id", p."code", p."parent_id",
         p."is_vat_account" AND p."vat_type" IN ('input', 'output'), c.depth + 1
    FROM account_chain c
    JOIN "accounts" p ON p."id" = c."parent_id" AND p."company_id" = c."company_id"
   WHERE c.depth < 8
), eligible_accounts AS (
  SELECT a."id"
    FROM linked_accounts a
   WHERE a."is_active" = true AND a."is_archived" = false
     AND a."type" = 'asset' AND a."sub_type" IN ('bank', 'cash')
     AND NOT EXISTS (
       SELECT 1 FROM account_chain c WHERE c.account_id = a."id"
         AND (c."code" IN ('1040', '2010', '1070', '1050', '2020', '2015', '2030', '2032', '2034', '2036')
           OR c.is_vat_control)
     )
     AND NOT EXISTS (
       SELECT 1 FROM "products" p
        WHERE p."company_id" = a."company_id" AND p."inventory_account_id" = a."id"
     )
)
INSERT INTO "bank_gl_migration_findings" ("bank_transaction_id", "company_id", "kind", "details")
SELECT bt."id", bt."company_id", finding.kind,
       jsonb_build_object(
         'statement_account_id', bt."bank_statement_account_id",
         'statement_company_id', ba."company_id",
         'target_gl_account_id', ba."gl_account_id",
         'target_gl_company_id', target."company_id",
         'cached_gl_account_id', bt."bank_account_id",
         'cached_gl_company_id', cached."company_id",
         'target_gl_code', target."code",
         'cached_gl_code', cached."code"
       )
  FROM "bank_transactions" bt
  LEFT JOIN "bank_accounts" ba ON ba."id" = bt."bank_statement_account_id"
  LEFT JOIN linked_accounts target ON target."id" = ba."gl_account_id"
  LEFT JOIN linked_accounts cached ON cached."id" = bt."bank_account_id"
  LEFT JOIN eligible_accounts eligible_target ON eligible_target."id" = target."id"
  LEFT JOIN eligible_accounts eligible_cached ON eligible_cached."id" = cached."id"
 CROSS JOIN LATERAL (VALUES
   ('target_gl_ineligible', target."id" IS NOT NULL AND eligible_target."id" IS NULL),
   ('cached_gl_ineligible', cached."id" IS NOT NULL AND eligible_cached."id" IS NULL),
   ('cached_gl_company_mismatch', cached."company_id" <> bt."company_id"),
   ('cached_gl_account_missing', bt."bank_account_id" IS NOT NULL AND cached."id" IS NULL)
 ) AS finding(kind, present)
 WHERE finding.present
ON CONFLICT ("bank_transaction_id", "kind") DO NOTHING;
