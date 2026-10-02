-- 0124_vendor_bills_created_by: who entered a bill or purchase order, so the approval engine can refuse
-- self-approval. Additive and idempotent; existing rows keep NULL (no creator known, no self-approval check).

ALTER TABLE "vendor_bills" ADD COLUMN IF NOT EXISTS "created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL;
ALTER TABLE "purchase_orders" ADD COLUMN IF NOT EXISTS "created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL;
