-- Synthetic accounting data for a disposable database at journal entry 0088.
-- Legacy CSV/PDF imports are represented by bank_transactions.import_source.
-- The bank_import_batches table arrives in 0097.
BEGIN;

CREATE TEMP TABLE rehearsal_companies ON COMMIT DROP AS
SELECT n, md5('nr-rehearsal:company:' || n)::uuid AS id,
       md5('nr-rehearsal:owner:' || n)::uuid AS owner_id,
       md5('nr-rehearsal:contact:' || n)::uuid AS contact_id,
       md5('nr-rehearsal:bank-account:' || n)::uuid AS bank_account_id,
       (ARRAY['Harbour Lighting LLC', 'Dune Office Supplies LLC',
              'Creek Design Studio LLC', 'Palm Workshop LLC'])[n] AS name,
       (ARRAY['dubai', 'dubai', 'sharjah', 'dubai'])[n] AS emirate
FROM generate_series(1, 4) n;

INSERT INTO users (id, email, name, password_hash, user_type, firm_role, email_verified, created_at)
SELECT owner_id, 'owner' || n || '@rehearsal.example.test', name || ' Owner',
       'fixture-unusable-password', 'customer', NULL, true, '2025-12-01'::timestamp
FROM rehearsal_companies
UNION ALL
SELECT md5('nr-rehearsal:' || role)::uuid, role || '@rehearsal.example.test', name,
       'fixture-unusable-password', 'admin', role, true, '2025-12-01'::timestamp
FROM (VALUES ('firm_owner', 'Practice Partner'), ('firm_admin', 'Client Accountant')) staff(role, name);

INSERT INTO companies (id, name, base_currency, company_type, trn_vat_number, emirate,
                       vat_filing_frequency, created_at)
SELECT id, name, 'AED', CASE WHEN n <= 2 THEN 'client' ELSE 'customer' END,
       '1000000000010' || n || '3', emirate, 'quarterly', '2025-12-01'::timestamp
FROM rehearsal_companies;

INSERT INTO company_users (id, company_id, user_id, role, created_at)
SELECT md5('nr-rehearsal:membership:' || c.id || ':' || staff.user_id)::uuid,
       c.id, staff.user_id, staff.role, '2025-12-01'::timestamp
FROM rehearsal_companies c
CROSS JOIN LATERAL (
  SELECT c.owner_id, 'owner' AS role
  UNION ALL SELECT md5('nr-rehearsal:firm_owner')::uuid, 'owner' WHERE c.n <= 2
  UNION ALL SELECT md5('nr-rehearsal:firm_admin')::uuid, 'accountant' WHERE c.n = 2
  UNION ALL SELECT md5('nr-rehearsal:owner:3')::uuid, 'Read-Only' WHERE c.n = 4
) staff(user_id, role);

INSERT INTO firm_staff_assignments (id, user_id, company_id, role, assigned_at)
SELECT md5('nr-rehearsal:assignment:' || id)::uuid, md5('nr-rehearsal:firm_admin')::uuid,
       id, 'accountant', '2025-12-02'
FROM rehearsal_companies WHERE n = 2;

INSERT INTO engagements (id, company_id, account_manager_id, start_date, monthly_fee, services_included,
                         onboarding_completed, created_at, updated_at)
SELECT md5('nr-rehearsal:engagement:' || id)::uuid, id, md5('nr-rehearsal:firm_owner')::uuid,
       '2025-12-01', 1200 + n * 125, '["bookkeeping", "vat"]', true, '2025-12-01', '2025-12-10'
FROM rehearsal_companies WHERE n <= 2;

INSERT INTO subscriptions (id, company_id, plan_id, plan_name, current_period_start, current_period_end,
                           created_at, updated_at)
SELECT md5('nr-rehearsal:subscription:' || id)::uuid, id, 'starter', 'Starter',
       '2026-04-01', '2026-05-01', '2025-12-01', '2026-04-01'
FROM rehearsal_companies WHERE n = 3;

INSERT INTO customer_contacts (id, company_id, name, email, portal_access_token,
                               portal_access_expires_at, created_at)
SELECT contact_id, id, 'Customer ' || n, 'customer' || n || '@buyer.example.test',
       CASE WHEN n = 1 THEN 'synthetic-rehearsal-link' END,
       CASE WHEN n = 1 THEN '2099-01-01'::timestamp END, '2025-12-01'
FROM rehearsal_companies;

INSERT INTO accounts (id, company_id, code, name_en, type, created_at)
SELECT md5('nr-rehearsal:account:' || c.id || ':' || a.code)::uuid, c.id, a.code, a.name, a.type, '2025-12-01'
FROM rehearsal_companies c
CROSS JOIN (VALUES ('1020', 'Bank Accounts', 'asset'), ('1040', 'Accounts Receivable', 'asset'),
                   ('1200', 'Input VAT', 'asset'), ('2010', 'Accounts Payable', 'liability'),
                   ('2200', 'Output VAT', 'liability'), ('4000', 'Sales Revenue', 'income'),
                   ('5000', 'Cost of Sales', 'expense')) a(code, name, type);

CREATE TEMP TABLE rehearsal_invoices ON COMMIT DROP AS
SELECT c.id AS company_id, c.contact_id, c.owner_id, c.n AS tenant, i,
       md5('nr-rehearsal:invoice:' || c.n || ':' || i)::uuid AS id,
       CASE WHEN c.n = 1 AND i = 9 THEN 'CS-2026-00042'
            ELSE 'INV-' || lpad(i::text, 4, '0') END AS number,
       '2026-01-03'::date + i * 5 AS issued_on,
       (ARRAY['draft', 'paid', 'partial', 'sent'])[1 + i % 4] AS status,
       CASE WHEN i % 3 = 0 THEN 'USD' ELSE 'AED' END AS currency,
       CASE WHEN i % 3 = 0 THEN 3.6725 ELSE 1 END AS rate,
       200 + c.n * 20 + i * 12 AS subtotal
FROM rehearsal_companies c CROSS JOIN generate_series(1, 12) i;

INSERT INTO invoices (id, company_id, number, customer_name, contact_id, date, due_date, currency,
                      subtotal, vat_amount, total, exchange_rate, base_currency_amount, status, created_at)
SELECT id, company_id, number, 'Customer ' || tenant, contact_id, issued_on, issued_on + 30, currency,
       subtotal, subtotal * 0.05, subtotal * 1.05, rate, round(subtotal * 1.05 * rate, 2), status, issued_on
FROM rehearsal_invoices;

INSERT INTO invoice_lines (id, invoice_id, description, quantity, unit_price, vat_rate, vat_supply_type)
SELECT md5('nr-rehearsal:invoice-line:' || i.id || ':' || line.description)::uuid, i.id,
       line.description, line.quantity, line.unit_price, 0.05, 'standard_rated'
FROM rehearsal_invoices i
CROSS JOIN LATERAL (VALUES ('Supplies', 2, i.subtotal * 0.40),
                          ('Delivery', 1, i.subtotal * 0.20)) line(description, quantity, unit_price);

CREATE TEMP TABLE rehearsal_bills ON COMMIT DROP AS
SELECT c.id AS company_id, c.owner_id, c.n AS tenant, b,
       md5('nr-rehearsal:bill:' || c.n || ':' || b)::uuid AS id,
       'BILL-' || lpad(b::text, 4, '0') AS number,
       '2026-01-04'::date + b * 8 AS issued_on,
       (ARRAY['pending', 'paid', 'approved'])[1 + b % 3] AS status,
       CASE WHEN b % 2 = 0 THEN 'USD' ELSE 'AED' END AS currency,
       CASE WHEN b % 2 = 0 THEN 3.6725 ELSE 1 END AS rate,
       110 + c.n * 8 + b * 14 AS subtotal
FROM rehearsal_companies c CROSS JOIN generate_series(1, 8) b;

INSERT INTO vendor_bills (id, company_id, vendor_name, bill_number, bill_date, due_date,
                          currency, exchange_rate, subtotal, vat_amount, total_amount, amount_paid,
                          status, approved_by, approved_at, paid_at, created_at)
SELECT id, company_id, 'Supplier ' || tenant, number, issued_on, issued_on + 30,
       currency, rate, subtotal, subtotal * 0.05, subtotal * 1.05,
       CASE WHEN status = 'paid' THEN subtotal * 1.05 ELSE 0 END, status,
       CASE WHEN status <> 'pending' THEN owner_id END,
       CASE WHEN status <> 'pending' THEN issued_on END,
       CASE WHEN status = 'paid' THEN issued_on + 5 END, issued_on
FROM rehearsal_bills;

INSERT INTO bill_line_items (id, bill_id, description, quantity, unit_price, vat_rate, amount, account_id,
                             created_at)
SELECT md5('nr-rehearsal:bill-line:' || b.id || ':' || line.description)::uuid, b.id,
       line.description, line.quantity, line.unit_price, 5, line.quantity * line.unit_price,
       md5('nr-rehearsal:account:' || b.company_id || ':5000')::uuid, b.issued_on
FROM rehearsal_bills b
CROSS JOIN LATERAL (VALUES ('Materials', 2, b.subtotal * 0.35),
                          ('Freight', 1, b.subtotal * 0.30)) line(description, quantity, unit_price);

CREATE TEMP TABLE rehearsal_postings ON COMMIT DROP AS
SELECT md5('nr-rehearsal:invoice-posting:' || id)::uuid AS id, company_id, owner_id,
       issued_on AS posted_on, 'JE-' || number AS number, 'invoice' AS source, id AS source_id,
       '1040' AS debit_code, '4000' AS credit_code, '2200' AS tax_code,
       round(subtotal * rate, 2) AS net, round(subtotal * 1.05 * rate, 2) AS gross
FROM rehearsal_invoices WHERE status <> 'draft'
UNION ALL
SELECT md5('nr-rehearsal:invoice-payment-posting:' || id)::uuid, company_id, owner_id,
       issued_on + 5, 'JE-REC-' || number, 'payment', md5('nr-rehearsal:invoice-payment:' || id)::uuid,
       '1020', '1040', NULL, p.amount, p.amount
FROM rehearsal_invoices
CROSS JOIN LATERAL (SELECT round(round(subtotal * CASE WHEN status = 'partial' THEN 0.50 ELSE 1.05 END, 2) * rate, 2)) p(amount)
WHERE status IN ('paid', 'partial')
UNION ALL
SELECT md5('nr-rehearsal:bill-posting:' || id)::uuid, company_id, owner_id,
       issued_on, 'JE-' || number, 'vendor_bill', id, '5000', '2010', '1200',
       round(subtotal * rate, 2), round(subtotal * 1.05 * rate, 2)
FROM rehearsal_bills WHERE status <> 'pending'
UNION ALL
SELECT md5('nr-rehearsal:bill-payment-posting:' || id)::uuid, company_id, owner_id,
       issued_on + 5, 'JE-PAY-' || number, 'bill_payment', md5('nr-rehearsal:bill-payment:' || id)::uuid,
       '2010', '1020', NULL, round(subtotal * 1.05 * rate, 2), round(subtotal * 1.05 * rate, 2)
FROM rehearsal_bills WHERE status = 'paid';

INSERT INTO journal_entries (id, company_id, date, memo, created_by, entry_number, status, source,
                             source_id, posted_by, posted_at, created_at)
SELECT id, company_id, posted_on, number, owner_id, number, 'posted', source, source_id,
       owner_id, posted_on, posted_on
FROM rehearsal_postings;

INSERT INTO journal_lines (id, entry_id, account_id, debit, credit)
SELECT md5('nr-rehearsal:journal-line:' || p.id || ':' || l.code)::uuid, p.id,
       md5('nr-rehearsal:account:' || p.company_id || ':' || l.code)::uuid, l.debit, l.credit
FROM rehearsal_postings p
CROSS JOIN LATERAL (
  VALUES (p.debit_code, CASE WHEN p.source = 'vendor_bill' THEN p.net ELSE p.gross END, 0),
         (p.credit_code, 0, CASE WHEN p.source = 'vendor_bill' THEN p.gross ELSE p.net END),
         (p.tax_code, CASE WHEN p.source = 'vendor_bill' THEN p.gross - p.net ELSE 0 END,
                      CASE WHEN p.source = 'invoice' THEN p.gross - p.net ELSE 0 END)
) l(code, debit, credit)
WHERE l.code IS NOT NULL;

INSERT INTO invoice_payments (id, invoice_id, company_id, amount, date, method, reference,
                              payment_account_id, journal_entry_id, created_by, exchange_rate, created_at)
SELECT md5('nr-rehearsal:invoice-payment:' || id)::uuid, id, company_id,
       round(subtotal * CASE WHEN status = 'partial' THEN 0.50 ELSE 1.05 END, 2),
       issued_on + 5, 'bank_transfer', 'REC-' || number,
       md5('nr-rehearsal:account:' || company_id || ':1020')::uuid,
       md5('nr-rehearsal:invoice-payment-posting:' || id)::uuid, owner_id, rate, issued_on + 5
FROM rehearsal_invoices WHERE status IN ('paid', 'partial');

INSERT INTO bill_payments (id, bill_id, payment_date, amount, payment_method, reference, created_at)
SELECT md5('nr-rehearsal:bill-payment:' || id)::uuid, id, issued_on + 5, subtotal * 1.05,
       'bank_transfer', 'PAY-' || number, issued_on + 5
FROM rehearsal_bills WHERE status = 'paid';

-- One VAT 201 and linked filing period per company, derived from posted documents in AED.
CREATE TEMP TABLE rehearsal_vat ON COMMIT DROP AS
SELECT c.*, md5('nr-rehearsal:vat-return:' || c.id)::uuid AS return_id,
       CASE WHEN c.n <= 2 THEN 'submitted' ELSE 'draft' END AS status,
       sales.net AS sales_net, sales.vat AS output_vat,
       purchases.net AS purchases_net, purchases.vat AS input_vat
FROM rehearsal_companies c
CROSS JOIN LATERAL (
  SELECT sum(round(subtotal * rate, 2)) AS net, sum(round(subtotal * 1.05 * rate, 2) - round(subtotal * rate, 2)) AS vat
  FROM rehearsal_invoices WHERE company_id = c.id AND status <> 'draft'
) sales
CROSS JOIN LATERAL (
  SELECT sum(round(subtotal * rate, 2)) AS net, sum(round(subtotal * 1.05 * rate, 2) - round(subtotal * rate, 2)) AS vat
  FROM rehearsal_bills WHERE company_id = c.id AND status <> 'pending'
) purchases;

INSERT INTO vat_returns (id, company_id, period_start, period_end, due_date, status,
                         box1b_dubai_amount, box1b_dubai_vat, box1c_sharjah_amount, box1c_sharjah_vat,
                         box8_total_amount, box8_total_vat, box9_expenses_amount, box9_expenses_vat,
                         box11_total_amount, box11_total_vat, box12_total_due_tax, box13_recoverable_tax,
                         box14_payable_tax, submitted_by, submitted_at, fta_reference_number,
                         created_by, created_at, updated_at)
SELECT return_id, id, '2026-01-01', '2026-03-31', '2026-04-28', status,
       CASE WHEN emirate = 'dubai' THEN sales_net ELSE 0 END,
       CASE WHEN emirate = 'dubai' THEN output_vat ELSE 0 END,
       CASE WHEN emirate = 'sharjah' THEN sales_net ELSE 0 END,
       CASE WHEN emirate = 'sharjah' THEN output_vat ELSE 0 END,
       sales_net, output_vat, purchases_net, input_vat, purchases_net, input_vat,
       output_vat, input_vat, output_vat - input_vat,
       CASE WHEN status = 'submitted' THEN owner_id END,
       CASE WHEN status = 'submitted' THEN '2026-04-21'::timestamp END,
       CASE WHEN status = 'submitted' THEN 'SYNTHETIC-VAT-' || n END,
       owner_id, '2026-04-01', '2026-04-21'
FROM rehearsal_vat;

INSERT INTO vat_return_periods (id, company_id, period_start, period_end, due_date, status,
                                output_vat, input_vat, net_vat_payable, vat_return_id,
                                created_at, updated_at)
SELECT md5('nr-rehearsal:vat-period:' || id)::uuid, id, '2026-01-01', '2026-03-31', '2026-04-28',
       status, output_vat, input_vat, output_vat - input_vat, return_id, '2026-04-01', '2026-04-21'
FROM rehearsal_vat;

INSERT INTO bank_accounts (id, company_id, name_en, bank_name, account_number, gl_account_id, created_at)
SELECT bank_account_id, id, 'Operating account', 'Synthetic Bank', 'TEST-' || n,
       md5('nr-rehearsal:account:' || id || ':1020')::uuid, '2025-12-01'
FROM rehearsal_companies;

-- The old matching path marked the bank fee reconciled without a posting and recorded the
-- expense account as its GL link. Migration 0097 repairs both fields on its first run.
INSERT INTO bank_transactions (id, company_id, bank_statement_account_id, bank_account_id,
                               transaction_date, description, amount, balance, reference,
                               import_source, is_reconciled, match_status, matched_invoice_id,
                               matched_journal_entry_id, created_at)
SELECT md5('nr-rehearsal:bank-line:' || c.n || ':' || l.n)::uuid, c.id, c.bank_account_id,
       md5('nr-rehearsal:account:' || c.id || CASE WHEN l.n = 2 THEN ':5000' ELSE ':1020' END)::uuid,
       i.issued_on + 4 + l.n, l.description, l.amount,
       2000 + sum(l.amount) OVER (PARTITION BY c.id ORDER BY l.n), 'BANK-' || c.n || '-' || l.n,
       CASE WHEN l.n <= 2 THEN 'csv:' ELSE 'pdf_ai:' END || md5('nr-rehearsal:statement:' || c.n || ':' || ((l.n - 1) / 2)),
       l.n <= 2, CASE WHEN l.n <= 2 THEN 'matched' ELSE 'unmatched' END,
       CASE WHEN l.n = 1 THEN i.id END,
       CASE WHEN l.n = 1 THEN md5('nr-rehearsal:invoice-payment-posting:' || i.id)::uuid END,
       i.issued_on + 6 + l.n
FROM rehearsal_companies c
JOIN rehearsal_invoices i ON i.company_id = c.id AND i.i = 1
CROSS JOIN LATERAL (VALUES (1, 'Customer bank transfer', i.subtotal * 1.05),
                          (2, 'Unposted bank fee', -15.75),
                          (3, 'Supplier transfer', -93.45),
                          (4, 'Card settlement', 142.65)) l(n, description, amount);

COMMIT;
