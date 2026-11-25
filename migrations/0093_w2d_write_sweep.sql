-- 0093_w2d_write_sweep (W2-D): legacy write-path and tenancy sweep. Idempotent.
--  * accounts.parent_id (hierarchy, R02-16c), sub_type backfill for seeded codes, missing seed accounts
--  * receipts.lines (multi-account split posting, R05-19b)
--  * companies.logo_path (logo stored through fileStorage, R14-13), no global unique company name (R14-09)
--  * unique SKU per company after a dedupe guard (R10-07)

-- ── accounts: hierarchy ───────────────────────────────────────────────────────
ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "parent_id" uuid;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'accounts_parent_id_accounts_id_fk') THEN
    ALTER TABLE "accounts"
      ADD CONSTRAINT "accounts_parent_id_accounts_id_fk"
      FOREIGN KEY ("parent_id") REFERENCES "accounts"("id") ON DELETE SET NULL;
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_accounts_parent_id" ON "accounts" ("parent_id") WHERE "parent_id" IS NOT NULL;
--> statement-breakpoint

-- ── receipts / companies columns ──────────────────────────────────────────────
ALTER TABLE "receipts" ADD COLUMN IF NOT EXISTS "lines" jsonb;
--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "logo_path" text;
--> statement-breakpoint

-- ── companies: names are unique per owner in the route, never globally ────────
DO $$
DECLARE cname text;
BEGIN
  FOR cname IN
    SELECT c.conname
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
     WHERE t.relname = 'companies' AND c.contype = 'u'
       AND (SELECT array_agg(a.attname::text) FROM unnest(c.conkey) k
              JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k) = ARRAY['name']
  LOOP
    EXECUTE format('ALTER TABLE companies DROP CONSTRAINT %I', cname);
  END LOOP;
END $$;
--> statement-breakpoint
DROP INDEX IF EXISTS "companies_name_unique";
--> statement-breakpoint

-- ── products: unique SKU per company (dedupe guard first) ─────────────────────
UPDATE "products" SET "sku" = NULL WHERE "sku" IS NOT NULL AND btrim("sku") = '';
--> statement-breakpoint
WITH ranked AS (
  SELECT id,
         row_number() OVER (PARTITION BY company_id, lower(sku) ORDER BY created_at, id) AS rn
    FROM "products"
   WHERE "sku" IS NOT NULL
)
UPDATE "products" p
   SET "sku" = p."sku" || '-dup-' || substr(p."id"::text, 1, 8)
  FROM ranked r
 WHERE p."id" = r."id" AND r.rn > 1;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_products_company_sku"
  ON "products" ("company_id", lower("sku"))
  WHERE "sku" IS NOT NULL;
--> statement-breakpoint

-- ── accounts: sub_type backfill for the seeded chart (guarded by code + seed name) ──
WITH seed(code, name_en, sub_type) AS (
  VALUES
    ('1010', 'Cash on Hand', 'cash'),
    ('1020', 'Bank Accounts', 'bank'),
    ('1030', 'Petty Cash', 'cash'),
    ('1040', 'Accounts Receivable', 'receivable'),
    ('1050', 'VAT Receivable (Input VAT)', 'other_current_asset'),
    ('1060', 'Prepaid Expenses', 'other_current_asset'),
    ('1070', 'Inventory', 'inventory'),
    ('2010', 'Accounts Payable', 'payable'),
    ('2210', 'Loan Payable', 'long_term_liability'),
    ('3010', 'Owner''s Capital / Share Capital', 'owner_equity'),
    ('3020', 'Retained Earnings', 'retained_earnings'),
    ('3030', 'Dividends / Owner Drawings', 'drawings'),
    ('4010', 'Product Sales', 'operating_revenue'),
    ('4020', 'Service Revenue', 'operating_revenue'),
    ('4030', 'Other Income', 'other_income'),
    ('4040', 'Interest Income', 'other_income'),
    ('4050', 'Discounts Given', 'operating_revenue'),
    ('4060', 'Zero-Rated Sales', 'operating_revenue'),
    ('4070', 'Exempt Sales', 'operating_revenue'),
    ('4080', 'Gain on Asset Disposal', 'other_income'),
    ('4090', 'Foreign Exchange Gain', 'other_income'),
    ('5100', 'Depreciation Expense', 'depreciation'),
    ('5130', 'Loss on Asset Disposal', 'other_expense'),
    ('5140', 'Foreign Exchange Loss', 'other_expense')
)
UPDATE "accounts" a
   SET "sub_type" = s.sub_type
  FROM seed s
 WHERE a."code" = s.code
   AND a."name_en" = s.name_en
   AND (a."sub_type" IS NULL OR a."sub_type" IN ('current_asset', 'current_liability'));
--> statement-breakpoint
UPDATE "accounts"
   SET "sub_type" = 'operating_expense'
 WHERE "type" = 'expense' AND "sub_type" IS NULL
   AND "code" IN ('5000','5010','5020','5025','5028','5030','5040','5050','5060','5070','5080','5090','5110','5120');
--> statement-breakpoint

-- ── accounts: seed accounts missing from existing companies' charts ───────────
INSERT INTO "accounts" ("company_id", "code", "name_en", "name_ar", "description", "type", "sub_type", "is_system_account")
SELECT c."id", v.code, v.name_en, v.name_ar, v.description, v.type, v.sub_type, v.is_system
  FROM "companies" c
  CROSS JOIN (VALUES
    ('1080', 'Other Current Assets', 'أصول متداولة أخرى', 'Current assets that do not fit another category', 'asset', 'other_current_asset', false),
    ('5000', 'General Expenses', 'مصروفات عامة', 'Default expense account for uncategorised spending', 'expense', 'operating_expense', false),
    ('5005', 'Cost of Goods Sold', 'تكلفة البضاعة المباعة', 'Direct cost of inventory and services sold', 'expense', 'cost_of_sales', false)
  ) AS v(code, name_en, name_ar, description, type, sub_type, is_system)
 WHERE EXISTS (SELECT 1 FROM "accounts" a WHERE a."company_id" = c."id")
ON CONFLICT DO NOTHING;
