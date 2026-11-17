-- 0122_a3_chart (A3 financial statements / IFRS; W2-B reporting residual): account classification metadata.
-- Idempotent: guarded UPDATEs of account metadata (sub_type) only, so re-running the file changes
-- nothing. No journal entry, journal line, balance or document row is read or written.
--
--  * H10: the end-of-service gratuity provision (2036) is a long-term employee benefit and is
--    non-current (IAS 1.69, IAS 19.153-155). Existing companies were seeded with
--    sub_type 'current_liability'; the balance sheet now shows only the provision of known
--    leavers as the current portion (server/reporting/ifrs-adjustments.ts).
--  * H3: the corporate tax expense account created by the CT module (tax_tag
--    'corporate_tax_expense', 5200) is income tax, presented after profit before tax
--    (IAS 1.82(d), IAS 12.77), not an operating expense.
UPDATE accounts
   SET sub_type = 'long_term_liability', updated_at = now()
 WHERE code = '2036'
   AND type = 'liability'
   AND sub_type = 'current_liability'
   AND (is_system_account = true OR lower(name_en) LIKE '%gratuity%');
--> statement-breakpoint
UPDATE accounts
   SET sub_type = 'income_tax', updated_at = now()
 WHERE type = 'expense'
   AND tax_tag = 'corporate_tax_expense'
   AND (sub_type IS NULL OR sub_type IN ('', 'operating_expense', 'expense'));
