-- 0141_restore_legacy_invoice_bank_provenance (W3-C): restore ownership of legacy invoice-match journals.
-- Idempotent: update only the proven journal ownership flag; preserve all accounting rows.
-- Before bank matching used canonical invoice payments, a match could create its own journal.
-- An independently recorded invoice payment stays linked by identity and has no bank-owned flag.
UPDATE "bank_transaction_matches" m
   SET "created_journal" = true
  FROM "bank_transactions" bt, "invoices" i, "journal_entries" j
 WHERE m."bank_transaction_id" = bt."id" AND m."company_id" = bt."company_id"
   AND m."target_type" = 'invoice' AND m."target_id" = i."id" AND i."company_id" = bt."company_id"
   AND m."journal_entry_id" = j."id" AND j."company_id" = bt."company_id"
   AND m."status" = 'active' AND m."created_journal" = false
   AND m."payment_id" IS NULL AND m."idempotency_key" IS NULL
   AND bt."is_reconciled" = true AND bt."matched_receipt_id" IS NULL
   AND (bt."matched_invoice_id" IS NULL OR bt."matched_invoice_id" = i."id")
   AND (bt."matched_journal_entry_id" IS NULL OR bt."matched_journal_entry_id" = j."id")
   AND j."source" = 'bank_reconciliation' AND j."source_id" = bt."id"
   AND NOT EXISTS (
     SELECT 1 FROM "invoice_payments" p WHERE p."journal_entry_id" = j."id"
   );
