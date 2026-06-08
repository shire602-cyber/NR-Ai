-- Performance indexes for core tables.
-- These cover the most common query patterns (by company, by date, by status).

-- journal_entries
CREATE INDEX IF NOT EXISTS idx_journal_entries_company_id ON journal_entries (company_id);
CREATE INDEX IF NOT EXISTS idx_journal_entries_company_date ON journal_entries (company_id, date);
CREATE INDEX IF NOT EXISTS idx_journal_entries_company_entry_number ON journal_entries (company_id, entry_number);

-- journal_lines
CREATE INDEX IF NOT EXISTS idx_journal_lines_entry_id ON journal_lines (entry_id);
CREATE INDEX IF NOT EXISTS idx_journal_lines_account_id ON journal_lines (account_id);

-- invoices
CREATE INDEX IF NOT EXISTS idx_invoices_company_id ON invoices (company_id);
CREATE INDEX IF NOT EXISTS idx_invoices_company_date ON invoices (company_id, date);
CREATE INDEX IF NOT EXISTS idx_invoices_company_status ON invoices (company_id, status);

-- receipts
CREATE INDEX IF NOT EXISTS idx_receipts_company_id ON receipts (company_id);
CREATE INDEX IF NOT EXISTS idx_receipts_company_created_at ON receipts (company_id, created_at);

-- bank_transactions
CREATE INDEX IF NOT EXISTS idx_bank_transactions_company_id ON bank_transactions (company_id);
CREATE INDEX IF NOT EXISTS idx_bank_transactions_company_date ON bank_transactions (company_id, transaction_date);

-- accounts
CREATE INDEX IF NOT EXISTS idx_accounts_company_id ON accounts (company_id);
CREATE INDEX IF NOT EXISTS idx_accounts_company_code ON accounts (company_id, code);

-- customer_contacts
CREATE INDEX IF NOT EXISTS idx_customer_contacts_company_id ON customer_contacts (company_id);

-- notifications
CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications (user_id, is_read);

-- company_users
CREATE INDEX IF NOT EXISTS idx_company_users_user_id ON company_users (user_id);
CREATE INDEX IF NOT EXISTS idx_company_users_company_id ON company_users (company_id);

-- activity_logs
CREATE INDEX IF NOT EXISTS idx_activity_logs_company_id ON activity_logs (company_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_user_id ON activity_logs (user_id);
