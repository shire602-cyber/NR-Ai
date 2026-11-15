CREATE TABLE IF NOT EXISTS "products" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "name_ar" text,
  "sku" text,
  "description" text,
  "unit_price" real NOT NULL DEFAULT 0,
  "cost_price" real DEFAULT 0,
  "vat_rate" real NOT NULL DEFAULT 0.05,
  "unit" text NOT NULL DEFAULT 'pcs',
  "current_stock" integer NOT NULL DEFAULT 0,
  "low_stock_threshold" integer DEFAULT 10,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "inventory_movements" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "product_id" uuid NOT NULL REFERENCES "products"("id") ON DELETE CASCADE,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "type" text NOT NULL,
  "quantity" integer NOT NULL,
  "unit_cost" real,
  "reference" text,
  "notes" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);
