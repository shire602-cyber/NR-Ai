-- Additional states encountered after 0097 is already recorded. Set up a missing
-- cache, an existing match with a local GL, and a pending allocation.
DO $$
DECLARE
  company uuid := md5('nr-rehearsal:company:1')::uuid;
  expense_gl uuid := md5('nr-rehearsal:account:' || company || ':5000')::uuid;
  allocation_id uuid := md5('nr-rehearsal:pending-allocation')::uuid;
BEGIN
  UPDATE bank_transactions SET bank_account_id = NULL
  WHERE id = md5('nr-rehearsal:bank-line:1:3')::uuid AND NOT is_reconciled;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Forward fixture is missing its unreconciled NULL-GL candidate';
  END IF;

  UPDATE bank_transactions SET bank_account_id = expense_gl
  WHERE id = md5('nr-rehearsal:bank-line:1:1')::uuid AND is_reconciled;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Forward fixture is missing its genuine invoice reconciliation';
  END IF;

  UPDATE bank_transactions SET bank_account_id = expense_gl, match_status = 'suggested'
  WHERE id = md5('nr-rehearsal:bank-line:1:4')::uuid AND NOT is_reconciled;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Forward fixture is missing the transaction for a pending allocation';
  END IF;

  INSERT INTO bank_transaction_matches (id, company_id, bank_transaction_id, match_group_id,
                                        target_type, target_id, amount, status, created_at)
  SELECT allocation_id, company, id, allocation_id,
         'invoice', md5('nr-rehearsal:invoice:1:3')::uuid, amount, 'pending', '2026-01-17'
  FROM bank_transactions WHERE id = md5('nr-rehearsal:bank-line:1:4')::uuid;
END
$$;
