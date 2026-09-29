-- 0090_invoice_line_revenue_account: let each sales line choose its revenue
-- (income) account. Until now every line posted to one account (4010 Product
-- Sales, 4060 for zero-rated), so service revenue was misfiled. The column is
-- nullable: NULL keeps today's behaviour. The choice lives on quote lines and
-- credit-note lines too so it survives quote -> invoice conversion and credit
-- notes reverse the same account. Recurring invoices keep their lines as JSON
-- (recurring_invoices.lines_json) and carry the id inside it.
-- ON DELETE SET NULL: deleting an account falls back to the default account.
-- Additive only: no data is changed. Idempotent: re-running is a no-op.

ALTER TABLE invoice_lines
  ADD COLUMN IF NOT EXISTS revenue_account_id uuid REFERENCES accounts(id) ON DELETE SET NULL;

ALTER TABLE quote_lines
  ADD COLUMN IF NOT EXISTS revenue_account_id uuid REFERENCES accounts(id) ON DELETE SET NULL;

ALTER TABLE credit_note_lines
  ADD COLUMN IF NOT EXISTS revenue_account_id uuid REFERENCES accounts(id) ON DELETE SET NULL;
