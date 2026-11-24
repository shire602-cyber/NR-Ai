-- One deterministic JSON object, using only columns that exist at 0088 and head.
-- The excluded values have dedicated backfill and banking assertions.
WITH fixture AS (
  SELECT md5('nr-rehearsal:company:' || n)::uuid AS company_id,
         md5('nr-rehearsal:owner:' || n)::uuid AS owner_id,
         md5('nr-rehearsal:bank-line:' || n || ':2')::uuid AS legacy_fee_id
  FROM generate_series(1, 4) n
), fixture_rows(kind, id, data) AS (
  SELECT 'companies', id, to_jsonb(row) FROM (
    SELECT c.id, c.name, c.base_currency, c.company_type, c.trn_vat_number, c.emirate, c.vat_filing_frequency
    FROM companies c JOIN fixture f ON c.id = f.company_id
  ) row
  UNION ALL SELECT 'users', id, to_jsonb(row) FROM (
    SELECT id, email, name, user_type, firm_role, email_verified FROM users
    WHERE id IN (SELECT owner_id FROM fixture)
       OR id IN (md5('nr-rehearsal:firm_owner')::uuid, md5('nr-rehearsal:firm_admin')::uuid)
  ) row
  UNION ALL SELECT 'memberships', id, to_jsonb(row) FROM (
    SELECT m.id, m.company_id, m.user_id,
           CASE WHEN m.user_id = md5('nr-rehearsal:owner:3')::uuid
                     AND m.company_id = md5('nr-rehearsal:company:4')::uuid THEN NULL ELSE m.role END AS role
    FROM company_users m JOIN fixture f ON m.company_id = f.company_id
  ) row
  UNION ALL SELECT 'firm_staff_assignments', id, to_jsonb(row) FROM (
    SELECT s.id, s.user_id, s.company_id, s.role, s.assigned_at
    FROM firm_staff_assignments s JOIN fixture f USING (company_id)
  ) row
  UNION ALL SELECT 'engagements', id, to_jsonb(row) FROM (
    SELECT e.id, e.company_id, e.account_manager_id, e.start_date, e.status, e.monthly_fee,
           e.services_included, e.onboarding_completed
    FROM engagements e JOIN fixture f USING (company_id)
  ) row
  UNION ALL SELECT 'subscriptions', id, to_jsonb(row) FROM (
    SELECT id, company_id, plan_id, plan_name, status, current_period_start, current_period_end
    FROM subscriptions WHERE id = md5('nr-rehearsal:subscription:' || md5('nr-rehearsal:company:3')::uuid)::uuid
  ) row
  UNION ALL SELECT 'contacts', id, to_jsonb(row) FROM (
    SELECT c.id, c.company_id, c.name, c.email, c.is_active
    FROM customer_contacts c JOIN fixture f USING (company_id)
  ) row
  UNION ALL SELECT 'accounts', id, to_jsonb(row) FROM (
    SELECT a.id, a.company_id, a.code, a.name_en, a.type, a.is_active
    FROM accounts a JOIN fixture f USING (company_id)
    WHERE a.id = md5('nr-rehearsal:account:' || a.company_id || ':' || a.code)::uuid
  ) row
  UNION ALL SELECT 'invoices', id, to_jsonb(row) FROM (
    SELECT i.id, i.company_id, i.number, i.customer_name, i.contact_id, i.date, i.due_date, i.currency,
           i.subtotal, i.vat_amount, i.total, i.exchange_rate, i.base_currency_amount, i.status
    FROM invoices i JOIN fixture f USING (company_id)
  ) row
  UNION ALL SELECT 'invoice_lines', id, to_jsonb(row) FROM (
    SELECT l.id, l.invoice_id, l.description, l.quantity, l.unit_price, l.vat_rate, l.vat_supply_type
    FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id JOIN fixture f ON i.company_id = f.company_id
  ) row
  UNION ALL SELECT 'invoice_payments', id, to_jsonb(row) FROM (
    SELECT p.id, p.company_id, p.invoice_id, p.amount, p.date, p.method, p.reference,
           p.payment_account_id, p.journal_entry_id, p.created_by, p.exchange_rate
    FROM invoice_payments p JOIN fixture f USING (company_id)
  ) row
  UNION ALL SELECT 'bills', id, to_jsonb(row) FROM (
    SELECT b.id, b.company_id, b.vendor_name, b.bill_number, b.bill_date, b.due_date, b.currency,
           b.exchange_rate, b.subtotal, b.vat_amount, b.total_amount, b.amount_paid,
           b.status, b.approved_by, b.approved_at, b.paid_at
    FROM vendor_bills b JOIN fixture f USING (company_id)
  ) row
  UNION ALL SELECT 'bill_lines', id, to_jsonb(row) FROM (
    SELECT l.id, l.bill_id, l.description, l.quantity, l.unit_price, l.vat_rate, l.amount, l.account_id
    FROM bill_line_items l JOIN vendor_bills b ON b.id = l.bill_id JOIN fixture f ON b.company_id = f.company_id
  ) row
  UNION ALL SELECT 'bill_payments', id, to_jsonb(row) FROM (
    SELECT p.id, p.bill_id, p.payment_date, p.amount, p.payment_method, p.reference
    FROM bill_payments p JOIN vendor_bills b ON b.id = p.bill_id JOIN fixture f ON b.company_id = f.company_id
  ) row
  UNION ALL SELECT 'journal_entries', id, to_jsonb(row) FROM (
    SELECT j.id, j.company_id, j.date, j.memo, j.created_by, j.entry_number,
           j.status, j.source, j.source_id, j.posted_by, j.posted_at
    FROM journal_entries j JOIN fixture f USING (company_id)
  ) row
  UNION ALL SELECT 'journal_lines', id, to_jsonb(row) FROM (
    SELECT l.id, l.entry_id, l.account_id, l.debit, l.credit
    FROM journal_lines l JOIN journal_entries j ON j.id = l.entry_id JOIN fixture f ON j.company_id = f.company_id
  ) row
  UNION ALL SELECT 'vat_returns', id, to_jsonb(row) FROM (
    SELECT v.id, v.company_id, v.period_start, v.period_end, v.due_date, v.status, v.submitted_by,
           v.submitted_at, v.fta_reference_number, v.box1b_dubai_amount, v.box1b_dubai_vat,
           v.box1c_sharjah_amount, v.box1c_sharjah_vat, v.box8_total_amount, v.box8_total_vat,
           v.box9_expenses_amount, v.box9_expenses_vat, v.box11_total_amount, v.box11_total_vat,
           v.box12_total_due_tax, v.box13_recoverable_tax, v.box14_payable_tax
    FROM vat_returns v JOIN fixture f USING (company_id)
  ) row
  UNION ALL SELECT 'vat_periods', id, to_jsonb(row) FROM (
    SELECT p.id, p.company_id, p.period_start, p.period_end, p.due_date, p.status,
           p.output_vat, p.input_vat, p.net_vat_payable, p.vat_return_id
    FROM vat_return_periods p JOIN fixture f USING (company_id)
  ) row
  UNION ALL SELECT 'bank_accounts', id, to_jsonb(row) FROM (
    SELECT b.id, b.company_id, b.name_en, b.bank_name, b.account_number, b.currency, b.gl_account_id
    FROM bank_accounts b JOIN fixture f USING (company_id)
  ) row
  UNION ALL SELECT 'bank_transactions', id, to_jsonb(row) FROM (
    SELECT b.id, b.company_id, b.bank_statement_account_id, b.transaction_date, b.description,
           b.amount, b.balance, b.reference, b.import_source, b.matched_invoice_id, b.matched_journal_entry_id,
           CASE WHEN b.id NOT IN (f.legacy_fee_id, md5('nr-rehearsal:bank-line:4:1')::uuid,
                                  md5('nr-rehearsal:bank-line:1:3')::uuid,
                                  md5('nr-rehearsal:bank-edge:line:active-cash')::uuid)
                THEN b.bank_account_id END AS bank_account_id,
           CASE WHEN NOT repair.stale_match THEN b.is_reconciled END AS is_reconciled,
           CASE WHEN NOT repair.stale_match THEN b.match_status END AS match_status
    FROM bank_transactions b JOIN fixture f USING (company_id)
    CROSS JOIN LATERAL (
      SELECT b.id IN (f.legacy_fee_id, md5('nr-rehearsal:bank-link:foreign-statement')::uuid,
                      md5('nr-rehearsal:bank-link:foreign-target')::uuid)
    ) repair(stale_match)
  ) row
)
SELECT jsonb_object_agg(kind, rows)
FROM (SELECT kind, jsonb_agg(data ORDER BY id) AS rows FROM fixture_rows GROUP BY kind) snapshot;
