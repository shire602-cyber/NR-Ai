-- Production-like seed for the 0089+ migration rehearsal (docs/release/MIGRATION-REHEARSAL.md).
-- Runs on a database migrated with origin/main's chain (0000-0088) plus main's
-- ensureCriticalSchema. Deterministic; no real personal data; no password material
-- (password_hash is a placeholder string, never a bcrypt hash).
--
-- Shape: 8 companies (6 customer, 2 NR clients), ~30 users, 4,000 invoices with lines and
-- ledger postings, 1,600 payments, 200 credit notes, audit rows, FX rates without a company,
-- customer portal tokens, subscriptions for 5 of 8 companies, and the edge cases each 0089+
-- migration rewrites: placeholder (invited) users, free-text roles, email-case duplicates,
-- inverted manual FX rows, bad reconciliation rules, unbalanced and duplicate-reversal
-- journals, duplicate employee numbers / IBANs, and the legacy 0054-promoted owner account.
BEGIN;

-- ── users ──────────────────────────────────────────────────────────────────────
INSERT INTO users (id, email, name, password_hash, user_type, is_admin, firm_role, email_verified, created_at)
SELECT ('00000000-0000-4000-a000-' || lpad(g::text, 12, '0'))::uuid,
       'user' || g || '@tenant' || ((g - 1) % 8 + 1) || '.example.test',
       'User ' || g, 'x-placeholder-not-a-hash', 'customer', false, NULL, true,
       now() - (g || ' days')::interval
  FROM generate_series(1, 24) g;
-- Placeholder users created by the old team invite (password_hash = '').
INSERT INTO users (id, email, name, password_hash, user_type, created_at)
SELECT ('00000000-0000-4000-a000-' || lpad((100 + g)::text, 12, '0'))::uuid,
       'invited' || g || '@tenant1.example.test', 'Invited ' || g, '', 'customer', now()
  FROM generate_series(1, 3) g;
-- Accounts differing only by email case.
INSERT INTO users (id, email, name, password_hash, user_type) VALUES
  ('00000000-0000-4000-a000-000000000201', 'Dup.Owner@tenant2.example.test', 'Dup Upper', 'x-placeholder-not-a-hash', 'customer'),
  ('00000000-0000-4000-a000-000000000202', 'dup.owner@tenant2.example.test', 'Dup Lower', 'x-placeholder-not-a-hash', 'customer');
-- NR firm staff (legacy users.firm_role).
INSERT INTO users (id, email, name, password_hash, user_type, firm_role, email_verified) VALUES
  ('00000000-0000-4000-a000-000000000301', 'firm.owner@nr.example.test', 'NR Firm Owner', 'x-placeholder-not-a-hash', 'admin', 'firm_owner', true),
  ('00000000-0000-4000-a000-000000000302', 'firm.admin@nr.example.test', 'NR Firm Admin', 'x-placeholder-not-a-hash', 'admin', 'firm_admin', true);
-- The production owner account in the state the original 0054 left it.
INSERT INTO users (id, email, name, password_hash, user_type, is_admin, firm_role, email_verified) VALUES
  ('00000000-0000-4000-a000-000000000401', 'shire602@gmail.com', 'Owner (0054 promoted)', 'x-placeholder-not-a-hash', 'admin', true, 'firm_owner', true);

-- ── companies ──────────────────────────────────────────────────────────────────
INSERT INTO companies (id, name, base_currency, company_type, trn_vat_number, emirate, vat_filing_frequency, created_at)
SELECT ('00000000-0000-4000-b000-' || lpad(c::text, 12, '0'))::uuid,
       'Tenant ' || c || ' Trading LLC', 'AED',
       CASE WHEN c IN (7, 8) THEN 'client' ELSE 'customer' END,
       '1000000000000' || lpad((c % 10)::text, 1, '0') || '3',
       (ARRAY['dubai','abu_dhabi','sharjah','ajman'])[(c - 1) % 4 + 1], 'quarterly',
       now() - interval '400 days'
  FROM generate_series(1, 8) c;

-- ── memberships (incl. free-text roles) ────────────────────────────────────────
INSERT INTO company_users (company_id, user_id, role)
SELECT ('00000000-0000-4000-b000-' || lpad(((g - 1) % 8 + 1)::text, 12, '0'))::uuid,
       ('00000000-0000-4000-a000-' || lpad(g::text, 12, '0'))::uuid,
       CASE WHEN g <= 8 THEN 'owner'
            ELSE (ARRAY['accountant','employee','cfo','manager','Read-Only','bookkeeping clerk','viewer','superuser'])[(g - 9) % 8 + 1]
       END
  FROM generate_series(1, 24) g;
INSERT INTO company_users (company_id, user_id, role)
SELECT '00000000-0000-4000-b000-000000000001', ('00000000-0000-4000-a000-' || lpad((100 + g)::text, 12, '0'))::uuid, 'employee'
  FROM generate_series(1, 3) g;
INSERT INTO company_users (company_id, user_id, role) VALUES
  ('00000000-0000-4000-b000-000000000002', '00000000-0000-4000-a000-000000000201', 'accountant'),
  ('00000000-0000-4000-b000-000000000002', '00000000-0000-4000-a000-000000000202', 'accountant'),
  ('00000000-0000-4000-b000-000000000007', '00000000-0000-4000-a000-000000000301', 'owner'),
  ('00000000-0000-4000-b000-000000000008', '00000000-0000-4000-a000-000000000301', 'owner'),
  ('00000000-0000-4000-b000-000000000008', '00000000-0000-4000-a000-000000000302', 'accountant');

-- ── subscriptions (companies 6-8 have none: 0113 backfills Free) ───────────────
INSERT INTO subscriptions (company_id, plan_id, plan_name, status, current_period_start, current_period_end, max_invoices)
SELECT ('00000000-0000-4000-b000-' || lpad(c::text, 12, '0'))::uuid,
       (ARRAY['free','starter','professional','starter','enterprise'])[c],
       initcap((ARRAY['free','starter','professional','starter','enterprise'])[c]),
       'active', date_trunc('month', now()), date_trunc('month', now()) + interval '1 month', 1000
  FROM generate_series(1, 5) c;

-- ── chart of accounts (minimal posting set per company) ───────────────────────
INSERT INTO accounts (company_id, code, name_en, type, is_active)
SELECT ('00000000-0000-4000-b000-' || lpad(c::text, 12, '0'))::uuid, a.code, a.name, a.type, true
  FROM generate_series(1, 8) c
 CROSS JOIN (VALUES ('1000','Assets','asset'), ('1020','Bank Accounts','asset'),
                    ('1040','Accounts Receivable','asset'), ('2010','Accounts Payable','liability'),
                    ('2200','VAT Output','liability'), ('4000','Sales Revenue','income'),
                    ('5000','Cost of Sales','expense')) AS a(code, name, type);

-- ── FX rates (no company column on main; manual rows include inverted ones) ────
INSERT INTO exchange_rates (base_currency, target_currency, rate, date, source)
SELECT 'USD', 'AED', 3.6725, now() - (d || ' days')::interval, 'fta' FROM generate_series(0, 29) d;
INSERT INTO exchange_rates (base_currency, target_currency, rate, date, source)
SELECT 'EUR', 'AED', 3.95 + d * 0.001, now() - (d || ' days')::interval, 'api' FROM generate_series(0, 19) d;
INSERT INTO exchange_rates (base_currency, target_currency, rate, date, source)
SELECT 'AED', 'USD', 0.2723, now() - (d || ' days')::interval, 'manual' FROM generate_series(0, 4) d;
INSERT INTO exchange_rates (base_currency, target_currency, rate, date, source)
SELECT 'USD', 'AED', 0.2723, now() - (d || ' days')::interval, 'manual' FROM generate_series(0, 4) d;  -- inverted

-- ── customer contacts with plaintext portal tokens ─────────────────────────────
INSERT INTO customer_contacts (id, company_id, name, email, portal_access_token, portal_access_expires_at)
SELECT ('00000000-0000-4000-c000-' || lpad(g::text, 12, '0'))::uuid,
       ('00000000-0000-4000-b000-' || lpad(((g - 1) % 8 + 1)::text, 12, '0'))::uuid,
       'Customer ' || g, 'customer' || g || '@buyer.example.test',
       CASE WHEN g <= 40 THEN md5('portal-token-' || g) ELSE NULL END,
       CASE WHEN g <= 40 THEN now() + interval '180 days' ELSE NULL END
  FROM generate_series(1, 80) g;

-- ── invoices, lines, postings ──────────────────────────────────────────────────
INSERT INTO invoices (id, company_id, number, customer_name, date, currency, subtotal, vat_amount, total,
                      status, contact_id, exchange_rate, base_currency_amount, due_date, created_at)
SELECT md5('inv-' || g)::uuid,
       ('00000000-0000-4000-b000-' || lpad(((g - 1) % 8 + 1)::text, 12, '0'))::uuid,
       'INV-' || lpad(g::text, 6, '0'), 'Customer ' || ((g - 1) % 80 + 1),
       now() - ((g % 365) || ' days')::interval,
       CASE WHEN g % 10 = 0 THEN 'USD' ELSE 'AED' END,
       (100 + g % 900)::numeric(15,2), round((100 + g % 900) * 0.05, 2),
       round((100 + g % 900) * 1.05, 2),
       (ARRAY['paid','sent','partial','draft','void'])[g % 5 + 1],
       ('00000000-0000-4000-c000-' || lpad(((g - 1) % 80 + 1)::text, 12, '0'))::uuid,
       CASE WHEN g % 10 = 0 THEN 3.6725 ELSE 1 END,
       round((100 + g % 900) * 1.05 * CASE WHEN g % 10 = 0 THEN 3.6725 ELSE 1 END, 2),
       now() - ((g % 365) || ' days')::interval + interval '30 days',
       now() - ((g % 365) || ' days')::interval
  FROM generate_series(1, 4000) g;
INSERT INTO invoice_lines (invoice_id, description, quantity, unit_price, vat_rate, vat_supply_type)
SELECT md5('inv-' || g)::uuid, 'Line ' || l, 1, round((100 + g % 900) / 3.0, 2), 0.05, 'standard_rated'
  FROM generate_series(1, 4000) g CROSS JOIN generate_series(1, 3) l;

-- Posted journal per non-draft invoice (Dr AR / Cr revenue / Cr VAT).
INSERT INTO journal_entries (id, company_id, date, memo, created_by, entry_number, status, source, source_id, posted_at)
SELECT md5('je-inv-' || i.id)::uuid, i.company_id, i.date, 'Invoice ' || i.number,
       ('00000000-0000-4000-a000-' || lpad(((substr(i.company_id::text, 25)::int - 1) % 8 + 1)::text, 12, '0'))::uuid,
       'JE-' || i.number, 'posted', 'invoice', i.id, i.date
  FROM invoices i WHERE i.status NOT IN ('draft', 'void');  -- voids on main carry no open posting
INSERT INTO journal_lines (entry_id, account_id, debit, credit)
SELECT je.id, a.id,
       CASE WHEN a.code = '1040' THEN i.base_currency_amount ELSE 0 END,
       CASE WHEN a.code = '4000' THEN round(i.subtotal * i.exchange_rate, 2)
            WHEN a.code = '2200' THEN i.base_currency_amount - round(i.subtotal * i.exchange_rate, 2)
            ELSE 0 END
  FROM journal_entries je
  JOIN invoices i ON i.id = je.source_id AND je.source = 'invoice'
  JOIN accounts a ON a.company_id = je.company_id AND a.code IN ('1040', '4000', '2200');

-- Payments on paid invoices (Dr bank / Cr AR).
INSERT INTO invoice_payments (id, invoice_id, company_id, amount, date, method, payment_account_id, created_by, exchange_rate)
SELECT md5('pay-' || i.id)::uuid, i.id, i.company_id, i.total, i.date + interval '10 days', 'bank_transfer',
       (SELECT a.id FROM accounts a WHERE a.company_id = i.company_id AND a.code = '1020'),
       ('00000000-0000-4000-a000-' || lpad(((substr(i.company_id::text, 25)::int - 1) % 8 + 1)::text, 12, '0'))::uuid,
       i.exchange_rate
  FROM invoices i WHERE i.status IN ('paid', 'partial');
INSERT INTO journal_entries (id, company_id, date, memo, created_by, entry_number, status, source, source_id, posted_at)
SELECT md5('je-pay-' || p.id)::uuid, p.company_id, p.date, 'Payment', p.created_by,
       'JP-' || substr(p.id::text, 1, 8) || substr(p.id::text, 10, 4), 'posted', 'payment', p.id, p.date
  FROM invoice_payments p;
UPDATE invoice_payments p SET journal_entry_id = md5('je-pay-' || p.id)::uuid;
INSERT INTO journal_lines (entry_id, account_id, debit, credit)
SELECT je.id, a.id,
       CASE WHEN a.code = '1020' THEN round(p.amount * p.exchange_rate, 2) ELSE 0 END,
       CASE WHEN a.code = '1040' THEN round(p.amount * p.exchange_rate, 2) ELSE 0 END
  FROM journal_entries je
  JOIN invoice_payments p ON p.id = je.source_id AND je.source = 'payment'
  JOIN accounts a ON a.company_id = je.company_id AND a.code IN ('1020', '1040');

-- ── credit notes ───────────────────────────────────────────────────────────────
INSERT INTO credit_notes (id, company_id, number, customer_name, invoice_id, invoice_number, date, currency,
                          subtotal, vat_amount, total, status, reason)
SELECT md5('cn-' || i.id)::uuid, i.company_id, 'CN-' || i.number, i.customer_name, i.id, i.number,
       i.date + interval '5 days', i.currency, round(i.subtotal / 2, 2), round(i.vat_amount / 2, 2),
       round(i.subtotal / 2, 2) + round(i.vat_amount / 2, 2),
       CASE WHEN row_number() OVER () % 4 = 0 THEN 'draft' ELSE 'issued' END, 'Partial return'
  FROM (SELECT * FROM invoices WHERE status = 'sent' ORDER BY number LIMIT 200) i;
INSERT INTO credit_note_lines (credit_note_id, description, quantity, unit_price, vat_rate, vat_supply_type)
SELECT cn.id, 'Return', 1, cn.subtotal, 0.05, 'standard_rated' FROM credit_notes cn;

-- ── ledger defects 0090 must flag (not repair) ─────────────────────────────────
INSERT INTO journal_entries (id, company_id, date, memo, created_by, entry_number, status, source)
SELECT md5('je-unbal-' || c)::uuid, ('00000000-0000-4000-b000-' || lpad(c::text, 12, '0'))::uuid,
       now() - interval '200 days', 'Legacy unbalanced import',
       ('00000000-0000-4000-a000-' || lpad(c::text, 12, '0'))::uuid, 'JE-UNBAL-' || c, 'posted', 'manual'
  FROM generate_series(1, 3) c;
INSERT INTO journal_lines (entry_id, account_id, debit, credit)
SELECT md5('je-unbal-' || c)::uuid, a.id, CASE WHEN a.code = '1020' THEN 500 ELSE 0 END,
       CASE WHEN a.code = '4000' THEN 450 ELSE 0 END
  FROM generate_series(1, 3) c
  JOIN accounts a ON a.company_id = ('00000000-0000-4000-b000-' || lpad(c::text, 12, '0'))::uuid AND a.code IN ('1020', '4000');
-- Two reversals of the same entry (company 4).
INSERT INTO journal_entries (id, company_id, date, memo, created_by, entry_number, status, source, reversed_entry_id)
SELECT md5('je-rev-' || r)::uuid, je.company_id, je.date + interval '1 day', 'Reversal ' || r, je.created_by,
       'JE-REV-' || r, 'posted', 'reversal', je.id
  FROM (SELECT * FROM journal_entries WHERE company_id = '00000000-0000-4000-b000-000000000004' AND source = 'invoice'
         ORDER BY entry_number LIMIT 1) je
 CROSS JOIN generate_series(1, 2) r;
INSERT INTO journal_lines (entry_id, account_id, debit, credit)
SELECT md5('je-rev-' || r)::uuid, jl.account_id, jl.credit, jl.debit
  FROM generate_series(1, 2) r
  JOIN journal_entries rev ON rev.id = md5('je-rev-' || r)::uuid
  JOIN journal_lines jl ON jl.entry_id = rev.reversed_entry_id;

-- ── reconciliation rules (0097 deactivates unknown match types) ────────────────
INSERT INTO reconciliation_rules (company_id, name, match_field, match_type, match_value, category, is_active)
SELECT ('00000000-0000-4000-b000-' || lpad(((g - 1) % 8 + 1)::text, 12, '0'))::uuid, 'Rule ' || g, 'description',
       (ARRAY['contains','exact','starts_with','fuzzy','LIKE','contains'])[(g - 1) % 6 + 1], 'ACME ' || g, 'Office', true
  FROM generate_series(1, 24) g;

-- ── employees: one duplicate employee number and one duplicate IBAN (company 3) ─
INSERT INTO employees (company_id, employee_number, full_name, iban, basic_salary, total_salary, status)
SELECT ('00000000-0000-4000-b000-' || lpad(((g - 1) % 8 + 1)::text, 12, '0'))::uuid, 'EMP-' || g, 'Employee ' || g,
       'AE07033123456789012' || lpad(g::text, 4, '0'), 8000, 10000, 'active'
  FROM generate_series(1, 40) g;
INSERT INTO employees (company_id, employee_number, full_name, iban, basic_salary, total_salary, status) VALUES
  ('00000000-0000-4000-b000-000000000003', 'EMP-3', 'Employee 3 (duplicate number)', 'AE070331234567890129999', 8000, 10000, 'active'),
  ('00000000-0000-4000-b000-000000000003', 'EMP-903', 'Employee 903 (duplicate IBAN)', 'AE070331234567890120011', 8000, 10000, 'active');

-- ── audit history ──────────────────────────────────────────────────────────────
INSERT INTO audit_logs (user_id, action, resource_type, resource_id, details, created_at)
SELECT ('00000000-0000-4000-a000-' || lpad(((g - 1) % 24 + 1)::text, 12, '0'))::uuid,
       (ARRAY['invoice.create','invoice.post','payment.record','team.role_change'])[(g - 1) % 4 + 1],
       'invoice', md5('inv-' || ((g - 1) % 4000 + 1))::text,
       json_build_object('companyId', '00000000-0000-4000-b000-' || lpad(((g - 1) % 8 + 1)::text, 12, '0'))::text,
       now() - ((g % 365) || ' days')::interval
  FROM generate_series(1, 2500) g;

COMMIT;
ANALYZE;
