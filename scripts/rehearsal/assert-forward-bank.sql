-- Run in addition to assert-0097.sql after the forward migration on the recorded base.
DO $$
DECLARE
  company uuid := md5('nr-rehearsal:company:1')::uuid;
  expense_gl uuid := md5('nr-rehearsal:account:' || company || ':5000')::uuid;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM bank_transactions bt JOIN bank_accounts ba ON ba.id = bt.bank_statement_account_id
    WHERE bt.id = md5('nr-rehearsal:bank-line:1:3')::uuid
      AND bt.bank_account_id = ba.gl_account_id AND NOT bt.is_reconciled AND bt.match_status = 'unmatched'
  ) THEN
    RAISE EXCEPTION 'Forward bank repair did not fill the NULL GL cache for an unreconciled row';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM bank_transactions
    WHERE id = md5('nr-rehearsal:bank-line:1:1')::uuid AND bank_account_id = expense_gl
      AND is_reconciled AND match_status = 'matched'
  ) THEN
    RAISE EXCEPTION 'Forward bank repair changed the GL on a valid existing invoice reconciliation';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM bank_transactions bt
    JOIN bank_accounts ba ON ba.id = bt.bank_statement_account_id AND ba.company_id = bt.company_id
    JOIN bank_transaction_matches m ON m.bank_transaction_id = bt.id AND m.company_id = bt.company_id
    WHERE bt.id = md5('nr-rehearsal:bank-line:1:4')::uuid AND bt.bank_account_id = expense_gl
      AND bt.bank_account_id IS DISTINCT FROM ba.gl_account_id
      AND NOT bt.is_reconciled AND bt.match_status = 'suggested'
      AND bt.matched_journal_entry_id IS NULL AND bt.matched_invoice_id IS NULL AND bt.matched_receipt_id IS NULL
      AND m.id = md5('nr-rehearsal:pending-allocation')::uuid AND m.status = 'pending'
      AND m.target_type = 'invoice' AND m.target_id = md5('nr-rehearsal:invoice:1:3')::uuid
      AND m.amount = bt.amount
  ) THEN
    RAISE EXCEPTION 'Pending allocation lost its divergent cached GL or persisted match state';
  END IF;
END
$$;
