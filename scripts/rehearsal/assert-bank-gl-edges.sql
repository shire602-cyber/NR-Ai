DO $$
DECLARE
  company uuid := md5('nr-rehearsal:company:1')::uuid;
  bank_gl uuid := md5('nr-rehearsal:account:' || company || ':1020')::uuid;
  expense_gl uuid := md5('nr-rehearsal:account:' || company || ':5000')::uuid;
  invoice uuid := md5('nr-rehearsal:invoice:1:1')::uuid;
  posting uuid := md5('nr-rehearsal:invoice-payment-posting:' || invoice)::uuid;
BEGIN
  IF (SELECT count(*) FROM (
        SELECT suffix, bank_gl AS cached_gl, 'unmatched' AS match_status, NULL::uuid AS invoice_id, NULL::uuid AS journal_id
        FROM unnest(ARRAY['expense', 'inactive-bank', 'archived-bank', 'nonbank-asset', 'control-bank']) suffix
        UNION ALL VALUES ('active-cash', md5('nr-rehearsal:bank-edge:gl:active-cash')::uuid, 'unmatched', NULL, NULL),
                         ('legacy-invoice', expense_gl, 'suggested', invoice, NULL),
                         ('legacy-journal', expense_gl, 'suggested', NULL, posting)
      ) expected
      JOIN bank_transactions bt ON bt.id = md5('nr-rehearsal:bank-edge:line:' || expected.suffix)::uuid
      WHERE bt.company_id = company AND NOT bt.is_reconciled
        AND bt.bank_account_id = expected.cached_gl AND bt.match_status = expected.match_status
        AND bt.matched_invoice_id IS NOT DISTINCT FROM expected.invoice_id
        AND bt.matched_journal_entry_id IS NOT DISTINCT FROM expected.journal_id
        AND bt.matched_receipt_id IS NULL) <> 8 THEN
    RAISE EXCEPTION 'Bank GL edge case lost a legacy link or changed GL outside the eligible cash destination';
  END IF;
END
$$;
