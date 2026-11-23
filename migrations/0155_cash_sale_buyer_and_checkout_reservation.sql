-- 0155_cash_sale_buyer_and_checkout_reservation: Idempotent e-invoicing identity and checkout reservation.
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS einvoice_buyer_contact_id uuid;
--> statement-breakpoint
ALTER TABLE companies ADD COLUMN IF NOT EXISTS stripe_first_checkout_expires_at timestamptz;
