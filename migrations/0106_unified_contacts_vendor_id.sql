-- 0106_unified_contacts_vendor_id: one contacts table for customers and vendors. Additive and idempotent.
--
-- customer_contacts gains contact_type (customer | vendor | both). vendor_bills, purchase_orders and
-- vendor_credit_notes gain vendor_id -> customer_contacts(id), nullable (ON DELETE SET NULL, like
-- invoices.contact_id; documents keep the vendor_name / vendor_trn snapshot they always had).
--
-- Backfill, per company:
--   1. a 'vendor' contact is created for every distinct normalised vendor name (lower(btrim(name)))
--      that has no contact yet; the TRN is copied only when it is exactly 15 digits;
--   2. every document whose normalised vendor name matches exactly ONE contact is linked to it
--      (a name that matches several contacts stays NULL: ambiguous, never guessed);
--   3. a linked contact that was a 'customer' becomes 'both'.

ALTER TABLE "customer_contacts" ADD COLUMN IF NOT EXISTS "contact_type" text NOT NULL DEFAULT 'customer';

DO $$ BEGIN
  ALTER TABLE "customer_contacts"
    ADD CONSTRAINT "customer_contacts_contact_type_check" CHECK ("contact_type" IN ('customer', 'vendor', 'both'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "vendor_bills" ADD COLUMN IF NOT EXISTS "vendor_id" uuid REFERENCES "customer_contacts"("id") ON DELETE SET NULL;
ALTER TABLE "purchase_orders" ADD COLUMN IF NOT EXISTS "vendor_id" uuid REFERENCES "customer_contacts"("id") ON DELETE SET NULL;
ALTER TABLE "vendor_credit_notes" ADD COLUMN IF NOT EXISTS "vendor_id" uuid REFERENCES "customer_contacts"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "idx_vendor_bills_company_vendor" ON "vendor_bills"("company_id", "vendor_id");
CREATE INDEX IF NOT EXISTS "idx_purchase_orders_company_vendor" ON "purchase_orders"("company_id", "vendor_id");
CREATE INDEX IF NOT EXISTS "idx_vendor_credit_notes_company_vendor" ON "vendor_credit_notes"("company_id", "vendor_id");
CREATE INDEX IF NOT EXISTS "idx_customer_contacts_company_lname" ON "customer_contacts"("company_id", lower(btrim("name")));

-- 1. vendor contacts for names that have none
INSERT INTO "customer_contacts" ("company_id", "name", "trn_number", "contact_type")
SELECT n."company_id", n."display_name", n."trn", 'vendor'
FROM (
  SELECT v."company_id",
         lower(btrim(v."vendor_name")) AS "norm",
         (array_agg(btrim(v."vendor_name") ORDER BY v."created_at" DESC))[1] AS "display_name",
         (array_agg(btrim(v."vendor_trn") ORDER BY v."created_at" DESC) FILTER (WHERE btrim(v."vendor_trn") ~ '^[0-9]{15}$'))[1] AS "trn"
  FROM (
    SELECT "company_id", "vendor_name", "vendor_trn", "created_at"::timestamp AS "created_at" FROM "vendor_bills"
    UNION ALL
    SELECT "company_id", "vendor_name", "vendor_trn", "created_at"::timestamp FROM "purchase_orders"
    UNION ALL
    SELECT "company_id", "vendor_name", "vendor_trn", "created_at"::timestamp FROM "vendor_credit_notes"
  ) v
  WHERE btrim(v."vendor_name") <> ''
  GROUP BY v."company_id", lower(btrim(v."vendor_name"))
) n
WHERE NOT EXISTS (
  SELECT 1 FROM "customer_contacts" c
  WHERE c."company_id" = n."company_id" AND lower(btrim(c."name")) = n."norm"
);

-- 2. link documents to the one contact their normalised name matches
UPDATE "vendor_bills" d SET "vendor_id" = m."contact_id"
FROM (
  SELECT "company_id", lower(btrim("name")) AS "norm", (array_agg("id"))[1] AS "contact_id", count(*) AS "cnt"
  FROM "customer_contacts" GROUP BY "company_id", lower(btrim("name"))
) m
WHERE d."vendor_id" IS NULL AND m."company_id" = d."company_id" AND m."norm" = lower(btrim(d."vendor_name")) AND m."cnt" = 1;

UPDATE "purchase_orders" d SET "vendor_id" = m."contact_id"
FROM (
  SELECT "company_id", lower(btrim("name")) AS "norm", (array_agg("id"))[1] AS "contact_id", count(*) AS "cnt"
  FROM "customer_contacts" GROUP BY "company_id", lower(btrim("name"))
) m
WHERE d."vendor_id" IS NULL AND m."company_id" = d."company_id" AND m."norm" = lower(btrim(d."vendor_name")) AND m."cnt" = 1;

UPDATE "vendor_credit_notes" d SET "vendor_id" = m."contact_id"
FROM (
  SELECT "company_id", lower(btrim("name")) AS "norm", (array_agg("id"))[1] AS "contact_id", count(*) AS "cnt"
  FROM "customer_contacts" GROUP BY "company_id", lower(btrim("name"))
) m
WHERE d."vendor_id" IS NULL AND m."company_id" = d."company_id" AND m."norm" = lower(btrim(d."vendor_name")) AND m."cnt" = 1;

-- 3. a customer that is also a vendor becomes 'both'
UPDATE "customer_contacts" c SET "contact_type" = 'both'
WHERE c."contact_type" = 'customer' AND (
  EXISTS (SELECT 1 FROM "vendor_bills" b WHERE b."vendor_id" = c."id")
  OR EXISTS (SELECT 1 FROM "purchase_orders" p WHERE p."vendor_id" = c."id")
  OR EXISTS (SELECT 1 FROM "vendor_credit_notes" v WHERE v."vendor_id" = c."id")
);
