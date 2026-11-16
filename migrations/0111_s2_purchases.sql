-- 0111_s2_purchases (S2 final sweep; W3-B / W4-B / W4-C residuals): purchases, inventory and claims.
-- Idempotent: every statement can run twice.
--
--  * vendor_bills.recoverable_vat_base: input VAT (base currency) recoverable after the
--    vat-recovery category rules were applied at approval (R05-28); NULL = bill-level percent.
--  * einvoice_inbound_documents.debit_note_id + status 'credit_created': a reviewed supplier
--    credit note becomes a vendor debit note through the bills service.
--  * expense claims reimbursed through payroll (R04-20): claim -> employee / payroll run link,
--    payroll_items.expense_reimbursement, payroll_runs.total_expense_reimbursement.
--  * expense claim numbers: duplicates repaired (renumbered, audited), then the unique index.

-- ── Bills: blocked input VAT under the recovery rules ────────────────────────────────────
ALTER TABLE "vendor_bills" ADD COLUMN IF NOT EXISTS "recoverable_vat_base" numeric(15,2);
--> statement-breakpoint

-- ── Inbound supplier credit notes -> vendor debit notes ──────────────────────────────────
ALTER TABLE "einvoice_inbound_documents" ADD COLUMN IF NOT EXISTS "debit_note_id" uuid;
--> statement-breakpoint
ALTER TABLE "einvoice_inbound_documents" DROP CONSTRAINT IF EXISTS "einvoice_inbound_status_check";
--> statement-breakpoint
ALTER TABLE "einvoice_inbound_documents" ADD CONSTRAINT "einvoice_inbound_status_check"
  CHECK (status IN ('received', 'bill_created', 'credit_created', 'invalid', 'failed'));
--> statement-breakpoint

-- ── Expense claims reimbursed on payroll ─────────────────────────────────────────────────
ALTER TABLE "expense_claims" ADD COLUMN IF NOT EXISTS "employee_id" uuid;
--> statement-breakpoint
ALTER TABLE "expense_claims" ADD COLUMN IF NOT EXISTS "reimburse_via_payroll" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE "expense_claims" ADD COLUMN IF NOT EXISTS "payroll_run_id" uuid;
--> statement-breakpoint
ALTER TABLE "expense_claims" ADD COLUMN IF NOT EXISTS "claim_number_renumbered_from" text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_expense_claims_payroll_queue"
  ON "expense_claims" ("company_id", "employee_id") WHERE "reimburse_via_payroll" = true;
--> statement-breakpoint
ALTER TABLE "payroll_items" ADD COLUMN IF NOT EXISTS "expense_reimbursement" numeric(15,2) NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD COLUMN IF NOT EXISTS "total_expense_reimbursement" numeric(15,2) NOT NULL DEFAULT 0;
--> statement-breakpoint

-- ── Expense claim numbers: repair duplicates, then enforce uniqueness ────────────────────
-- 0096 skipped the unique index where the old COUNT(*)+1 race left duplicates. The earliest
-- claim keeps its number; every later duplicate is renumbered "<number>-R<k>" (first free k),
-- keeps the old number in claim_number_renumbered_from and gets an audit_logs row.
DO $$
DECLARE
  r record;
  k integer;
  candidate text;
BEGIN
  FOR r IN
    SELECT id, company_id, claim_number, rn
      FROM (
        SELECT id, company_id, claim_number,
               row_number() OVER (PARTITION BY company_id, claim_number ORDER BY created_at, id) AS rn
          FROM "expense_claims" WHERE claim_number IS NOT NULL
      ) d
     WHERE d.rn > 1
     ORDER BY company_id, claim_number, rn
  LOOP
    k := 1;
    LOOP
      candidate := r.claim_number || '-R' || k;
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM "expense_claims" WHERE company_id = r.company_id AND claim_number = candidate
      );
      k := k + 1;
    END LOOP;
    UPDATE "expense_claims"
       SET claim_number = candidate,
           claim_number_renumbered_from = COALESCE(claim_number_renumbered_from, r.claim_number)
     WHERE id = r.id;
    INSERT INTO "audit_logs" (user_id, company_id, action, resource_type, resource_id, details)
    VALUES (NULL, r.company_id, 'expense_claim.renumber', 'expense_claim', r.id::text,
            json_build_object('companyId', r.company_id,
                              'before', json_build_object('claimNumber', r.claim_number),
                              'after', json_build_object('claimNumber', candidate),
                              'reason', '0111_s2_purchases: duplicate claim number repaired')::text);
  END LOOP;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_expense_claims_company_number"
  ON "expense_claims"("company_id", "claim_number");
