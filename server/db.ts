// ✅ Must come first before any usage of process.env
import 'dotenv/config';

import { sql } from 'drizzle-orm';
import * as schema from '@shared/schema';

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?"
  );
}

const DATABASE_URL = process.env.DATABASE_URL;
const isNeon = DATABASE_URL.includes('neon.tech') || DATABASE_URL.includes('neon.');

// Connection pool settings — sized for Railway's single-instance deployment
const POOL_CONFIG = {
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
};

let pool: any;
let db: any;
let _driver: 'neon' | 'pg' = 'pg';

if (isNeon) {
  // Use Neon serverless driver (WebSocket-based) for Neon databases
  const { Pool: NeonPool, neonConfig } = await import('@neondatabase/serverless');
  const { drizzle: neonDrizzle } = await import('drizzle-orm/neon-serverless');
  const ws = await import('ws');
  neonConfig.webSocketConstructor = ws.default;
  pool = new NeonPool({ connectionString: DATABASE_URL, ...POOL_CONFIG });
  db = neonDrizzle({ client: pool, schema });
  _driver = 'neon';
} else {
  // Use standard pg driver for Railway/Docker/standard PostgreSQL
  const pg = await import('pg');
  const { drizzle: pgDrizzle } = await import('drizzle-orm/node-postgres');
  pool = new pg.default.Pool({ connectionString: DATABASE_URL, ...POOL_CONFIG });
  // Prevent unhandled 'error' events from crashing the process
  pool.on('error', (err: Error) => {
    console.error('[db] Unexpected pool client error:', err.message);
  });
  db = pgDrizzle({ client: pool, schema });
  _driver = 'pg';
}

export async function runMigrations(migrationsFolder: string): Promise<void> {
  console.log(`[db] Running migrations from ${migrationsFolder} (driver: ${_driver})...`);
  try {
    if (_driver === 'neon') {
      const { migrate } = await import('drizzle-orm/neon-serverless/migrator');
      await migrate(db, { migrationsFolder });
    } else {
      const { migrate } = await import('drizzle-orm/node-postgres/migrator');
      await migrate(db, { migrationsFolder });
    }
    console.log('[db] Migrations completed successfully');
  } catch (err) {
    console.error('[db] Migration failed:', err);
    throw err;
  }
}

/**
 * Belt-and-suspenders schema guard: ensures critical columns exist regardless
 * of Drizzle migration tracking state. Every statement uses IF NOT EXISTS so
 * it is always safe to re-run. Covers migrations 0003-0020 which may have
 * been tracked-but-not-executed in the production database.
 */
export async function ensureCriticalSchema(): Promise<void> {
  const steps: Array<{ name: string; sql: ReturnType<typeof sql> }> = [
    // ── 0003: invoice share token ────────────────────────────────────────
    {
      name: 'invoices.share_token',
      sql: sql`ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "share_token" text UNIQUE`,
    },
    {
      name: 'invoices.share_token_expires_at',
      sql: sql`ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "share_token_expires_at" timestamp`,
    },
    // ── 0006: e-invoice fields ───────────────────────────────────────────
    {
      name: 'invoices.einvoice_uuid',
      sql: sql`ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "einvoice_uuid" text`,
    },
    {
      name: 'invoices.einvoice_xml',
      sql: sql`ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "einvoice_xml" text`,
    },
    {
      name: 'invoices.einvoice_hash',
      sql: sql`ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "einvoice_hash" text`,
    },
    {
      name: 'invoices.einvoice_status',
      sql: sql`ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "einvoice_status" text`,
    },
    // ── 0015: exchange_rate columns ──────────────────────────────────────
    {
      name: 'exchange_rates table',
      sql: sql`CREATE TABLE IF NOT EXISTS "exchange_rates" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "base_currency" TEXT NOT NULL DEFAULT 'AED',
        "target_currency" TEXT NOT NULL,
        "rate" REAL NOT NULL,
        "date" TIMESTAMP NOT NULL DEFAULT NOW(),
        "source" TEXT NOT NULL DEFAULT 'manual',
        "created_at" TIMESTAMP NOT NULL DEFAULT NOW()
      )`,
    },
    {
      name: 'invoices.exchange_rate',
      sql: sql`ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "exchange_rate" REAL NOT NULL DEFAULT 1`,
    },
    {
      name: 'invoices.base_currency_amount',
      sql: sql`ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "base_currency_amount" REAL NOT NULL DEFAULT 0`,
    },
    {
      name: 'receipts.exchange_rate',
      sql: sql`ALTER TABLE "receipts" ADD COLUMN IF NOT EXISTS "exchange_rate" REAL NOT NULL DEFAULT 1`,
    },
    {
      name: 'receipts.base_currency_amount',
      sql: sql`ALTER TABLE "receipts" ADD COLUMN IF NOT EXISTS "base_currency_amount" REAL NOT NULL DEFAULT 0`,
    },
    {
      name: 'journal_lines.foreign_currency',
      sql: sql`ALTER TABLE "journal_lines" ADD COLUMN IF NOT EXISTS "foreign_currency" TEXT`,
    },
    {
      name: 'journal_lines.foreign_debit',
      sql: sql`ALTER TABLE "journal_lines" ADD COLUMN IF NOT EXISTS "foreign_debit" REAL DEFAULT 0`,
    },
    {
      name: 'journal_lines.foreign_credit',
      sql: sql`ALTER TABLE "journal_lines" ADD COLUMN IF NOT EXISTS "foreign_credit" REAL DEFAULT 0`,
    },
    {
      name: 'journal_lines.exchange_rate',
      sql: sql`ALTER TABLE "journal_lines" ADD COLUMN IF NOT EXISTS "exchange_rate" REAL DEFAULT 1`,
    },
    // ── 0016: bank_accounts table + bank_transaction columns ─────────────
    {
      name: 'bank_accounts table',
      sql: sql`CREATE TABLE IF NOT EXISTS "bank_accounts" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
        "name_en" text NOT NULL,
        "bank_name" text NOT NULL,
        "account_number" text,
        "iban" text,
        "currency" text NOT NULL DEFAULT 'AED',
        "gl_account_id" uuid REFERENCES "accounts"("id"),
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" timestamp DEFAULT now() NOT NULL
      )`,
    },
    {
      name: 'bank_transactions.bank_statement_account_id',
      sql: sql`ALTER TABLE "bank_transactions" ADD COLUMN IF NOT EXISTS "bank_statement_account_id" uuid REFERENCES "bank_accounts"("id")`,
    },
    {
      name: 'bank_transactions.match_status',
      sql: sql`ALTER TABLE "bank_transactions" ADD COLUMN IF NOT EXISTS "match_status" text NOT NULL DEFAULT 'unmatched'`,
    },
    {
      name: 'bank_transactions.balance',
      sql: sql`ALTER TABLE "bank_transactions" ADD COLUMN IF NOT EXISTS "balance" real`,
    },
    // ── 0017: invoice email / reminder fields ────────────────────────────
    {
      name: 'invoices.due_date',
      sql: sql`ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "due_date" timestamp`,
    },
    {
      name: 'invoices.payment_terms',
      sql: sql`ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "payment_terms" text DEFAULT 'net30'`,
    },
    {
      name: 'invoices.reminder_count',
      sql: sql`ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "reminder_count" integer DEFAULT 0 NOT NULL`,
    },
    {
      name: 'invoices.last_reminder_sent_at',
      sql: sql`ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "last_reminder_sent_at" timestamp`,
    },
    // ── 0018: credit notes + recurring + invoice_payments ────────────────
    {
      name: 'invoices.invoice_type',
      sql: sql`ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "invoice_type" text NOT NULL DEFAULT 'invoice'`,
    },
    {
      name: 'invoices.original_invoice_id',
      sql: sql`ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "original_invoice_id" uuid REFERENCES "invoices"("id")`,
    },
    {
      name: 'invoices.is_recurring',
      sql: sql`ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "is_recurring" boolean NOT NULL DEFAULT false`,
    },
    {
      name: 'invoices.recurring_interval',
      sql: sql`ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "recurring_interval" text`,
    },
    {
      name: 'invoices.next_recurring_date',
      sql: sql`ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "next_recurring_date" timestamp`,
    },
    {
      name: 'invoices.recurring_end_date',
      sql: sql`ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "recurring_end_date" timestamp`,
    },
    {
      name: 'invoice_payments table',
      sql: sql`CREATE TABLE IF NOT EXISTS "invoice_payments" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "invoice_id" uuid NOT NULL REFERENCES "invoices"("id") ON DELETE CASCADE,
        "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
        "amount" real NOT NULL,
        "date" timestamp NOT NULL,
        "method" text NOT NULL DEFAULT 'bank',
        "reference" text,
        "notes" text,
        "payment_account_id" uuid REFERENCES "accounts"("id"),
        "journal_entry_id" uuid REFERENCES "journal_entries"("id"),
        "created_by" uuid NOT NULL REFERENCES "users"("id"),
        "created_at" timestamp NOT NULL DEFAULT now()
      )`,
    },
    // ── 0024: receipt image_path column ─────────────────────────────────
    {
      name: 'receipts.image_path',
      sql: sql`ALTER TABLE "receipts" ADD COLUMN IF NOT EXISTS "image_path" text`,
    },
    // ── 0019/0020: firm_role + firm_staff_assignments ────────────────────
    {
      name: 'users.firm_role',
      sql: sql`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "firm_role" text`,
    },
    {
      name: 'firm_staff_assignments table',
      sql: sql`CREATE TABLE IF NOT EXISTS "firm_staff_assignments" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
        "assigned_at" timestamp DEFAULT now() NOT NULL,
        CONSTRAINT "firm_staff_assignments_user_company_unique"
          UNIQUE("user_id", "company_id")
      )`,
    },
    // ── 0021: client_communications + communication_templates ────────────
    {
      name: 'client_communications table',
      sql: sql`CREATE TABLE IF NOT EXISTS "client_communications" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
        "user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
        "channel" text NOT NULL,
        "direction" text NOT NULL DEFAULT 'outbound',
        "recipient_phone" text,
        "recipient_email" text,
        "subject" text,
        "body" text NOT NULL,
        "status" text NOT NULL DEFAULT 'sent',
        "template_type" text,
        "metadata" text,
        "sent_at" timestamp DEFAULT now() NOT NULL,
        "created_at" timestamp DEFAULT now() NOT NULL
      )`,
    },
    {
      name: 'communication_templates table',
      sql: sql`CREATE TABLE IF NOT EXISTS "communication_templates" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "name" text NOT NULL,
        "channel" text NOT NULL,
        "template_type" text NOT NULL,
        "subject_template" text,
        "body_template" text NOT NULL,
        "language" text NOT NULL DEFAULT 'en',
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" timestamp DEFAULT now() NOT NULL
      )`,
    },
    // ── 0022: firm_leads ─────────────────────────────────────────────────
    {
      name: 'firm_leads table',
      sql: sql`CREATE TABLE IF NOT EXISTS "firm_leads" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "company_id" uuid REFERENCES "companies"("id") ON DELETE SET NULL,
        "stage" text DEFAULT 'prospect' NOT NULL,
        "source" text DEFAULT 'manual' NOT NULL,
        "notes" text,
        "score" integer DEFAULT 50,
        "converted_at" timestamp,
        "created_at" timestamp DEFAULT now() NOT NULL,
        "updated_at" timestamp DEFAULT now() NOT NULL
      )`,
    },
    // ── 0023/0024: NRA test firm_owner seed (fallback for migration skip) ──
    {
      name: 'seed nra test firm_owner user',
      sql: sql`INSERT INTO users (email, name, password_hash, is_admin, user_type, firm_role)
        VALUES (
          'nra.test.owner@testmail.com',
          'NRA Test Owner',
          '$2b$10$17KhNf4OVbKwuWeBLcJop.aECfiBQzfd2XVmAfIZ3AvYLgvhv59ea',
          false,
          'customer',
          'firm_owner'
        )
        ON CONFLICT (email) DO UPDATE SET firm_role = 'firm_owner'`,
    },
    {
      name: 'seed nra test firm company',
      sql: sql`INSERT INTO companies (name, base_currency, locale, company_type)
        VALUES ('NRA Test Firm', 'AED', 'en', 'customer')
        ON CONFLICT (name) DO NOTHING`,
    },
    // ── 0026: onboarding_completed on companies ──────────────────────────
    {
      name: 'companies.onboarding_completed',
      sql: sql`ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "onboarding_completed" boolean NOT NULL DEFAULT false`,
    },
    {
      name: 'seed nra test firm company_users link',
      sql: sql`INSERT INTO company_users (company_id, user_id, role)
        SELECT c.id, u.id, 'owner'
        FROM companies c
        CROSS JOIN users u
        WHERE c.name = 'NRA Test Firm'
          AND u.email = 'nra.test.owner@testmail.com'
          AND NOT EXISTS (
            SELECT 1 FROM company_users cu
            WHERE cu.company_id = c.id AND cu.user_id = u.id
          )`,
    },
    // ── 0019 (was missing): companies soft-delete columns [CRITICAL] ─────
    // Without deleted_at, ALL Drizzle company queries fail (column in schema but not in DB).
    {
      name: 'companies.deleted_at',
      sql: sql`ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp`,
    },
    {
      name: 'companies.is_active',
      sql: sql`ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "is_active" boolean NOT NULL DEFAULT true`,
    },
    // ── 0028: test_firm_owner@nra.ae seed for endpoint testing ───────────
    {
      name: 'update test_firm_owner firm_role',
      sql: sql`UPDATE users SET firm_role = 'firm_owner' WHERE email = 'test_firm_owner@nra.ae'`,
    },
    {
      name: 'seed NRA Test Company',
      sql: sql`INSERT INTO companies (name, base_currency, locale, company_type)
        VALUES ('NRA Test Company', 'AED', 'en', 'customer')
        ON CONFLICT (name) DO NOTHING`,
    },
    {
      name: 'seed test_firm_owner company link',
      sql: sql`INSERT INTO company_users (company_id, user_id, role)
        SELECT c.id, u.id, 'owner'
        FROM companies c
        CROSS JOIN users u
        WHERE c.name = 'NRA Test Company'
          AND u.email = 'test_firm_owner@nra.ae'
          AND NOT EXISTS (
            SELECT 1 FROM company_users cu
            WHERE cu.company_id = c.id AND cu.user_id = u.id
          )`,
    },
    {
      name: 'seed NRA Test Company subscription',
      sql: sql`INSERT INTO subscriptions (company_id, plan_id, plan_name, status, current_period_start, current_period_end)
        SELECT c.id, 'free', 'Free', 'active', now(), now() + interval '100 years'
        FROM companies c
        WHERE c.name = 'NRA Test Company'
          AND NOT EXISTS (
            SELECT 1 FROM subscriptions s WHERE s.company_id = c.id
          )`,
    },
    // ── 0020 (was missing): invoice contact_id FK ─────────────────────────
    {
      name: 'invoices.contact_id',
      sql: sql`ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "contact_id" uuid REFERENCES "customer_contacts"("id") ON DELETE SET NULL`,
    },
    // ── Ensure module tables exist (migrations may have been skipped by Drizzle tracking) ──
    {
      name: 'create employees table',
      sql: sql`CREATE TABLE IF NOT EXISTS "employees" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
        "employee_number" text,
        "full_name" text NOT NULL,
        "full_name_ar" text,
        "nationality" text,
        "passport_number" text,
        "visa_number" text,
        "labor_card_number" text,
        "bank_name" text,
        "bank_account_number" text,
        "iban" text,
        "routing_code" text,
        "department" text,
        "designation" text,
        "join_date" timestamp,
        "basic_salary" numeric(12,2) NOT NULL DEFAULT 0,
        "housing_allowance" numeric(12,2) NOT NULL DEFAULT 0,
        "transport_allowance" numeric(12,2) NOT NULL DEFAULT 0,
        "other_allowance" numeric(12,2) NOT NULL DEFAULT 0,
        "total_salary" numeric(12,2) NOT NULL DEFAULT 0,
        "status" text NOT NULL DEFAULT 'active',
        "created_at" timestamp DEFAULT now() NOT NULL
      )`,
    },
    {
      name: 'create payroll_runs table',
      sql: sql`CREATE TABLE IF NOT EXISTS "payroll_runs" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
        "period_month" integer NOT NULL,
        "period_year" integer NOT NULL,
        "run_date" timestamp DEFAULT now(),
        "total_basic" numeric(12,2) NOT NULL DEFAULT 0,
        "total_allowances" numeric(12,2) NOT NULL DEFAULT 0,
        "total_deductions" numeric(12,2) NOT NULL DEFAULT 0,
        "total_net" numeric(12,2) NOT NULL DEFAULT 0,
        "employee_count" integer NOT NULL DEFAULT 0,
        "status" text NOT NULL DEFAULT 'draft',
        "sif_file_content" text,
        "approved_by" uuid REFERENCES "users"("id"),
        "approved_at" timestamp,
        "created_at" timestamp DEFAULT now() NOT NULL
      )`,
    },
    {
      name: 'create payroll_items table',
      sql: sql`CREATE TABLE IF NOT EXISTS "payroll_items" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "payroll_run_id" uuid NOT NULL REFERENCES "payroll_runs"("id") ON DELETE CASCADE,
        "employee_id" uuid NOT NULL REFERENCES "employees"("id") ON DELETE CASCADE,
        "basic_salary" numeric(12,2) NOT NULL DEFAULT 0,
        "housing_allowance" numeric(12,2) NOT NULL DEFAULT 0,
        "transport_allowance" numeric(12,2) NOT NULL DEFAULT 0,
        "other_allowance" numeric(12,2) NOT NULL DEFAULT 0,
        "gross_salary" numeric(12,2) NOT NULL DEFAULT 0,
        "deductions" numeric(12,2) NOT NULL DEFAULT 0,
        "net_salary" numeric(12,2) NOT NULL DEFAULT 0,
        "created_at" timestamp DEFAULT now() NOT NULL
      )`,
    },
    {
      name: 'create vendor_bills table',
      sql: sql`CREATE TABLE IF NOT EXISTS "vendor_bills" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
        "vendor_name" text NOT NULL,
        "vendor_trn" text,
        "bill_number" text,
        "bill_date" timestamp NOT NULL,
        "due_date" timestamp,
        "currency" text DEFAULT 'AED',
        "subtotal" numeric(12,2) DEFAULT 0,
        "vat_amount" numeric(12,2) DEFAULT 0,
        "total_amount" numeric(12,2) DEFAULT 0,
        "amount_paid" numeric(12,2) DEFAULT 0,
        "status" text DEFAULT 'pending',
        "category" text,
        "notes" text,
        "attachment_url" text,
        "approved_by" uuid,
        "approved_at" timestamp,
        "paid_at" timestamp,
        "created_at" timestamp DEFAULT now()
      )`,
    },
    {
      name: 'create bill_line_items table',
      sql: sql`CREATE TABLE IF NOT EXISTS "bill_line_items" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "bill_id" uuid NOT NULL REFERENCES "vendor_bills"("id") ON DELETE CASCADE,
        "description" text NOT NULL,
        "quantity" numeric(10,2) DEFAULT 1,
        "unit_price" numeric(12,2) NOT NULL,
        "vat_rate" numeric(5,2) DEFAULT 5,
        "amount" numeric(12,2),
        "account_id" uuid REFERENCES "accounts"("id") ON DELETE SET NULL,
        "created_at" timestamp DEFAULT now()
      )`,
    },
    {
      name: 'create bill_payments table',
      sql: sql`CREATE TABLE IF NOT EXISTS "bill_payments" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "bill_id" uuid NOT NULL REFERENCES "vendor_bills"("id") ON DELETE CASCADE,
        "payment_date" timestamp NOT NULL,
        "amount" numeric(12,2) NOT NULL,
        "payment_method" text DEFAULT 'bank_transfer',
        "reference" text,
        "notes" text,
        "created_at" timestamp DEFAULT now()
      )`,
    },
    {
      name: 'create fixed_assets table',
      sql: sql`CREATE TABLE IF NOT EXISTS "fixed_assets" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
        "asset_name" text NOT NULL,
        "asset_name_ar" text,
        "asset_number" text,
        "category" text NOT NULL,
        "purchase_date" timestamp NOT NULL,
        "purchase_cost" numeric(12,2) NOT NULL,
        "salvage_value" numeric(12,2) DEFAULT 0,
        "useful_life_years" integer NOT NULL,
        "depreciation_method" text DEFAULT 'straight_line',
        "accumulated_depreciation" numeric(12,2) DEFAULT 0,
        "net_book_value" numeric(12,2),
        "location" text,
        "serial_number" text,
        "status" text DEFAULT 'active',
        "disposal_date" timestamp,
        "disposal_amount" numeric(12,2),
        "notes" text,
        "created_at" timestamp DEFAULT now()
      )`,
    },
    {
      name: 'create expense_claims table',
      sql: sql`CREATE TABLE IF NOT EXISTS "expense_claims" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
        "submitted_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "claim_number" text,
        "title" text NOT NULL,
        "description" text,
        "total_amount" numeric(12,2) DEFAULT 0,
        "currency" text DEFAULT 'AED',
        "status" text DEFAULT 'draft',
        "submitted_at" timestamp,
        "reviewed_by" uuid,
        "reviewed_at" timestamp,
        "review_notes" text,
        "paid_at" timestamp,
        "payment_reference" text,
        "created_at" timestamp DEFAULT now()
      )`,
    },
    {
      name: 'create expense_claim_items table',
      sql: sql`CREATE TABLE IF NOT EXISTS "expense_claim_items" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "claim_id" uuid NOT NULL REFERENCES "expense_claims"("id") ON DELETE CASCADE,
        "expense_date" timestamp NOT NULL,
        "category" text NOT NULL,
        "description" text NOT NULL,
        "amount" numeric(12,2) NOT NULL,
        "vat_amount" numeric(12,2) DEFAULT 0,
        "receipt_url" text,
        "merchant_name" text,
        "created_at" timestamp DEFAULT now()
      )`,
    },
    {
      name: 'create budget_plans table',
      sql: sql`CREATE TABLE IF NOT EXISTS "budget_plans" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
        "name" text NOT NULL,
        "fiscal_year" integer NOT NULL,
        "start_date" timestamp NOT NULL,
        "end_date" timestamp NOT NULL,
        "status" text DEFAULT 'draft',
        "notes" text,
        "created_at" timestamp DEFAULT now()
      )`,
    },
  ];

  let ok = 0;
  let failed = 0;
  for (const step of steps) {
    try {
      await db.execute(step.sql);
      ok++;
    } catch (err: any) {
      console.error(`[db] Schema guard step "${step.name}" failed:`, err.message);
      failed++;
    }
  }
  console.log(`[db] Critical schema guard: ${ok} OK, ${failed} failed`);
}

/** Ping the database — used by /health and connection validation. */
export async function checkDbConnectivity(): Promise<boolean> {
  try {
    await db.execute(sql`SELECT 1`);
    return true;
  } catch {
    return false;
  }
}

/** Close the pool — call during graceful shutdown. */
export async function closePool(): Promise<void> {
  if (pool?.end) {
    await pool.end();
  }
}

export { pool, db };
