-- Check the intentional changes omitted from the pre/post preservation snapshot.
DO $$
DECLARE
  legacy_firm uuid := '00000000-0000-4000-8000-000000000001';
  rehearsal_owner uuid := md5('nr-rehearsal:firm_owner')::uuid;
  rehearsal_admin uuid := md5('nr-rehearsal:firm_admin')::uuid;
  contact uuid := md5('nr-rehearsal:contact:1')::uuid;
  company_ids uuid[] := ARRAY(SELECT md5('nr-rehearsal:company:' || n)::uuid FROM generate_series(1, 4) n ORDER BY n);
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM firms WHERE id = legacy_firm AND is_nr AND status = 'active'
  ) OR (SELECT count(*) FROM firm_members WHERE firm_id = legacy_firm AND
        ((user_id = rehearsal_owner AND role = 'firm_owner') OR
         (user_id = rehearsal_admin AND role = 'firm_admin'))) <> 2 THEN
    RAISE EXCEPTION '0108 did not backfill the legacy firm and its two staff members';
  END IF;

  IF (SELECT array_agg(company_id ORDER BY company_id) FROM firm_client_links
      WHERE firm_id = legacy_firm AND status = 'active' AND company_id = ANY (company_ids))
     IS DISTINCT FROM ARRAY(SELECT id FROM unnest(company_ids[1:2]) id ORDER BY id)
     OR (SELECT count(*) FROM engagements WHERE firm_id = legacy_firm AND company_id = ANY (company_ids[1:2])) <> 2
     OR (SELECT count(*) FROM firm_company_grants WHERE firm_id = legacy_firm AND created_membership AND
         ((user_id = rehearsal_owner AND company_id = ANY (company_ids[1:2])) OR
          (user_id = rehearsal_admin AND company_id = company_ids[2]))) <> 3 THEN
    RAISE EXCEPTION '0108 did not backfill the expected firm client links, engagements and grants';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM company_users WHERE company_id = company_ids[4]
      AND user_id = md5('nr-rehearsal:owner:3')::uuid AND role = 'viewer'
  ) THEN
    RAISE EXCEPTION '0092 did not normalize the legacy Read-Only company role to viewer';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM customer_contacts WHERE id = contact AND portal_access_token IS NULL)
     OR (SELECT count(*) FROM portal_access_tokens WHERE contact_id = contact AND company_id = company_ids[1]
       AND kind = 'link' AND token_hash = encode(sha256(convert_to('synthetic-rehearsal-link', 'UTF8')), 'hex')) <> 1 THEN
    RAISE EXCEPTION '0103 did not replace the plaintext portal token with its digest';
  END IF;

  IF (SELECT count(*) FROM subscriptions WHERE company_id = ANY (company_ids) AND status = 'active' AND
      ((company_id = company_ids[3] AND plan_id = 'starter') OR
       (company_id <> company_ids[3] AND plan_id = 'free'))) <> 4 THEN
    RAISE EXCEPTION '0113 did not backfill Free subscriptions while preserving the existing Starter subscription';
  END IF;

  IF (SELECT count(*) FROM bank_transactions bt JOIN bank_accounts ba ON ba.id = bt.bank_statement_account_id
      WHERE bt.id IN (SELECT md5('nr-rehearsal:bank-line:' || n || ':2')::uuid FROM generate_series(1, 4) n)
        AND NOT bt.is_reconciled AND bt.match_status = 'unmatched' AND bt.bank_account_id = ba.gl_account_id) <> 4 THEN
    RAISE EXCEPTION '0097 did not clear stale bank reconciliation and relink fees to the managed GL accounts';
  END IF;

  IF (SELECT count(*) FROM bank_transaction_matches WHERE company_id = ANY (company_ids)) <> 4
     OR (SELECT count(*) FROM bank_transaction_matches m
         JOIN bank_transactions bt ON bt.id = m.bank_transaction_id AND bt.company_id = m.company_id
         JOIN invoice_payments p ON p.id = m.payment_id AND p.journal_entry_id = bt.matched_journal_entry_id
         WHERE m.company_id = ANY (company_ids) AND m.target_type = 'invoice' AND m.status = 'active'
           AND m.target_id = bt.matched_invoice_id AND m.journal_entry_id = bt.matched_journal_entry_id
           AND m.amount = bt.amount AND bt.is_reconciled AND bt.match_status = 'matched') <> 4 THEN
    RAISE EXCEPTION '0097 did not preserve all four valid invoice allocations';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM invoice_number_sequences WHERE company_id = company_ids[1]
      AND doc_type = 'cash_sale' AND year = 2026 AND last_value = 42
  ) THEN
    RAISE EXCEPTION '0130 did not advance the cash-sale sequence to the historical document number';
  END IF;
END
$$;
