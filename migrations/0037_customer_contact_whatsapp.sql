-- WhatsApp integration: dedicated WhatsApp number on customer contacts.
-- In the UAE, business contacts often share a different number for WhatsApp
-- than their listed phone (corporate landline vs personal mobile, or a
-- separate "business" WhatsApp account). Storing it as its own column lets
-- the composer prefer it without overloading the phone field.

ALTER TABLE "customer_contacts"
  ADD COLUMN IF NOT EXISTS "whatsapp_number" text;
