-- 0154_postmerge_buyer_billing_payroll (S1, S5): Preserve buyer classification and Stripe checkout history.
-- Idempotent, including the leave defaults needed by existing payroll workspaces.
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS buyer_type text
  CHECK (buyer_type IN ('consumer', 'business', 'government'));
--> statement-breakpoint
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS stripe_checkout_completed boolean NOT NULL DEFAULT false;
--> statement-breakpoint
-- Checkout populated usage_period_start. Deletion cleared the subscription ID and reset
-- the billing period, while leaving that checkout timestamp and the customer ID in place.
UPDATE subscriptions
SET stripe_checkout_completed = true
WHERE NOT stripe_checkout_completed
  AND (
    stripe_subscription_id IS NOT NULL
    OR (stripe_customer_id IS NOT NULL AND usage_period_start IS NOT NULL)
  );
--> statement-breakpoint
INSERT INTO leave_types (
  company_id, code, name_en, name_ar, is_paid, annual_entitlement_days,
  accrual_method, carry_forward_max_days
)
SELECT employee_companies.company_id, defaults.*
FROM (SELECT DISTINCT company_id FROM employees) AS employee_companies
CROSS JOIN (VALUES
  ('annual', 'Annual leave', 'إجازة سنوية', true, 30, 'monthly', 15),
  ('sick', 'Sick leave', 'إجازة مرضية', true, 15, 'annual', 0),
  ('unpaid', 'Unpaid leave', 'إجازة بدون راتب', false, 0, 'none', 0)
) AS defaults(code, name_en, name_ar, is_paid, entitlement, accrual, carry_forward)
ON CONFLICT (company_id, code) DO NOTHING;
