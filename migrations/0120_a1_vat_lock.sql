-- 0120_a1_vat_lock (A1 accounting audit; W4-E VAT engine residual): filed-period lock, supplier debit note VAT treatment, bank-line VAT, customs value, partial exemption.
-- Idempotent: ADD COLUMN IF NOT EXISTS and CREATE INDEX IF NOT EXISTS only, so re-running the
-- file changes nothing.
--
-- 1. C1: the filed-period lookup runs on every VAT-affecting posting.
CREATE INDEX IF NOT EXISTS idx_vat_returns_company_status_period
  ON vat_returns (company_id, status, period_start, period_end);
--> statement-breakpoint
-- 2. C2: a supplier debit note follows the original bill's VAT treatment
--    (standard | reverse_charge | import | none) and records the input VAT it reverses.
ALTER TABLE vendor_debit_notes ADD COLUMN IF NOT EXISTS vat_treatment text;
--> statement-breakpoint
ALTER TABLE vendor_debit_notes ADD COLUMN IF NOT EXISTS recoverable_vat_amount numeric(15,2);
--> statement-breakpoint
-- 3. H7 / M8: the VAT treatment of an entry created from a bank line, so the return reports it
--    in the ordinary amount and VAT columns (standard) or in Box 4 / Box 5.
ALTER TABLE bank_transaction_matches ADD COLUMN IF NOT EXISTS vat_treatment text;
--> statement-breakpoint
ALTER TABLE bank_transaction_matches ADD COLUMN IF NOT EXISTS vat_net_amount numeric(15,2);
--> statement-breakpoint
ALTER TABLE bank_transaction_matches ADD COLUMN IF NOT EXISTS vat_amount numeric(15,2);
--> statement-breakpoint
-- 4. M7: Box 6 reports the customs value plus duty from the import declaration.
ALTER TABLE vendor_bills ADD COLUMN IF NOT EXISTS customs_value numeric(15,2);
--> statement-breakpoint
ALTER TABLE vendor_bills ADD COLUMN IF NOT EXISTS customs_duty_amount numeric(15,2);
--> statement-breakpoint
-- 5. C6: direct attribution of a bill's input VAT (taxable | exempt | residual) and the
--    partial-exemption switch on the company.
ALTER TABLE vendor_bills ADD COLUMN IF NOT EXISTS input_vat_attribution text;
--> statement-breakpoint
ALTER TABLE companies ADD COLUMN IF NOT EXISTS partial_exemption_enabled boolean NOT NULL DEFAULT false;
