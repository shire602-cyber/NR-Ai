-- 0108_approvals: amount/role approval rules gating the existing approve transitions. Additive and idempotent.
--
-- approval_rules     per company and document type: when the AED amount is ABOVE threshold_aed, the document
--                    needs one or two approvals, step k by someone of at least approver_roles[k]'s rank.
-- approval_requests  one pending request per document (unique partial index); it snapshots the rule's roles and
--                    the amount, so editing or deactivating a rule never changes a request already in flight.
-- approval_steps     the signatures. One person signs a request once.
--
-- The documents gain a 'pending_approval' status where a status column exists (payroll_runs has a CHECK).

CREATE TABLE IF NOT EXISTS "approval_rules" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "document_type" text NOT NULL,
  "name" text NOT NULL,
  "threshold_aed" numeric(15,2) NOT NULL DEFAULT 0,
  "approver_roles" text[] NOT NULL,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_by" uuid REFERENCES "users"("id"),
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "approval_rules_document_type_check"
    CHECK ("document_type" IN ('bill', 'expense_claim', 'purchase_order', 'payroll_run', 'manual_journal')),
  CONSTRAINT "approval_rules_threshold_check" CHECK ("threshold_aed" >= 0),
  CONSTRAINT "approval_rules_roles_check"
    CHECK (cardinality("approver_roles") BETWEEN 1 AND 2 AND "approver_roles" <@ ARRAY['accountant', 'cfo', 'owner']::text[])
);
CREATE INDEX IF NOT EXISTS "idx_approval_rules_company_type_active"
  ON "approval_rules"("company_id", "document_type") WHERE "is_active";

CREATE TABLE IF NOT EXISTS "approval_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "document_type" text NOT NULL,
  "document_id" uuid NOT NULL,
  "rule_id" uuid NOT NULL REFERENCES "approval_rules"("id") ON DELETE RESTRICT,
  "rule_name" text NOT NULL,
  "required_roles" text[] NOT NULL,
  "amount_aed" numeric(15,2) NOT NULL DEFAULT 0,
  "required_steps" integer NOT NULL,
  "completed_steps" integer NOT NULL DEFAULT 0,
  "status" text NOT NULL DEFAULT 'pending',
  "previous_status" text,
  "requested_by" uuid REFERENCES "users"("id"),
  "created_at" timestamp NOT NULL DEFAULT now(),
  "decided_at" timestamp,
  CONSTRAINT "approval_requests_status_check" CHECK ("status" IN ('pending', 'approved', 'rejected', 'cancelled')),
  CONSTRAINT "approval_requests_steps_check" CHECK ("required_steps" BETWEEN 1 AND 2 AND "completed_steps" BETWEEN 0 AND "required_steps")
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_approval_requests_pending_document"
  ON "approval_requests"("document_type", "document_id") WHERE "status" = 'pending';
CREATE INDEX IF NOT EXISTS "idx_approval_requests_company_status" ON "approval_requests"("company_id", "status");
CREATE INDEX IF NOT EXISTS "idx_approval_requests_document" ON "approval_requests"("document_type", "document_id");

CREATE TABLE IF NOT EXISTS "approval_steps" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "request_id" uuid NOT NULL REFERENCES "approval_requests"("id") ON DELETE CASCADE,
  "step_number" integer NOT NULL,
  "required_role" text NOT NULL,
  "decided_by" uuid NOT NULL REFERENCES "users"("id"),
  "decision" text NOT NULL,
  "comment" text,
  "decided_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "approval_steps_decision_check" CHECK ("decision" IN ('approved', 'rejected'))
);
-- A step is signed once and one person signs a request once (a rejection by an earlier signer is allowed).
CREATE UNIQUE INDEX IF NOT EXISTS "uq_approval_steps_request_step"
  ON "approval_steps"("request_id", "step_number") WHERE "decision" = 'approved';
CREATE UNIQUE INDEX IF NOT EXISTS "uq_approval_steps_request_signer"
  ON "approval_steps"("request_id", "decided_by") WHERE "decision" = 'approved';
CREATE INDEX IF NOT EXISTS "idx_approval_steps_request" ON "approval_steps"("request_id");

ALTER TABLE "payroll_runs" DROP CONSTRAINT IF EXISTS "payroll_runs_status_check";
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_status_check"
  CHECK ("status" IN ('draft', 'calculated', 'pending_approval', 'approved', 'paid', 'cancelled'));
