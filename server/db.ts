// ✅ Must come first before any usage of process.env
import 'dotenv/config';

import { sql } from 'drizzle-orm';
import * as schema from '@shared/schema';
import { createLogger } from './config/logger';

const log = createLogger('db');

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?"
  );
}

const DATABASE_URL = process.env.DATABASE_URL;
const isNeon = DATABASE_URL.includes('neon.tech') || DATABASE_URL.includes('neon.');

// Pool sizing is overridable via env so Railway / Docker / Neon can be tuned
// without a redeploy. Defaults match a single-instance Railway deployment.
function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const POOL_CONFIG = {
  max: envInt('DB_POOL_MAX', 10),
  min: envInt('DB_POOL_MIN', 1),
  idleTimeoutMillis: envInt('DB_POOL_IDLE_MS', 30_000),
  connectionTimeoutMillis: envInt('DB_POOL_CONN_MS', 10_000),
  // pg also honours `statement_timeout` per-connection; expose via env for
  // long-running analytical queries that should be killed to protect the pool.
  statement_timeout: envInt('DB_STATEMENT_TIMEOUT_MS', 30_000),
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
    log.error({ err: err.message }, 'Unexpected pool client error');
  });
  db = pgDrizzle({ client: pool, schema });
  _driver = 'pg';
}

export async function runMigrations(migrationsFolder: string): Promise<void> {
  log.info({ migrationsFolder, driver: _driver }, 'Running migrations');
  try {
    if (_driver === 'neon') {
      const { migrate } = await import('drizzle-orm/neon-serverless/migrator');
      await migrate(db, { migrationsFolder });
    } else {
      const { migrate } = await import('drizzle-orm/node-postgres/migrator');
      await migrate(db, { migrationsFolder });
    }
    log.info('Migrations completed successfully');
  } catch (err) {
    log.error({ err }, 'Migration failed');
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
  const schemaSteps: Array<{ name: string; sql: ReturnType<typeof sql> }> = [
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
    // ── 0026: onboarding_completed on companies ──────────────────────────
    {
      name: 'companies.onboarding_completed',
      sql: sql`ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "onboarding_completed" boolean NOT NULL DEFAULT false`,
    },
    // ── 0029: drop incorrect global UNIQUE on companies.name ─────────────
    // The original schema (migration 0000) created `companies_name_unique`
    // on companies(name). In a multi-tenant SaaS, two unrelated tenants can
    // legitimately share a legal name, so this constraint causes the
    // onboarding "Save & Continue" step to fail with a unique violation
    // for the second tenant. Migration 0029 drops it; this guard ensures
    // the drop happens even when 0029 was skipped (tracked-but-not-run).
    {
      name: 'companies.name unique constraint drop',
      sql: sql`DO $$
        DECLARE cname text;
        BEGIN
          SELECT tc.constraint_name INTO cname
          FROM information_schema.table_constraints tc
          JOIN information_schema.constraint_column_usage ccu
            ON tc.constraint_name = ccu.constraint_name
           AND tc.table_schema    = ccu.table_schema
          WHERE tc.table_name = 'companies'
            AND tc.constraint_type = 'UNIQUE'
            AND ccu.column_name = 'name'
          LIMIT 1;
          IF cname IS NOT NULL THEN
            EXECUTE format('ALTER TABLE companies DROP CONSTRAINT %I', cname);
          END IF;
        END $$`,
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
    // ── 0020 (was missing): invoice contact_id FK ─────────────────────────
    {
      name: 'invoices.contact_id',
      sql: sql`ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "contact_id" uuid REFERENCES "customer_contacts"("id") ON DELETE SET NULL`,
    },
    // ── audit_logs: critical for financial audit trail (now wired in) ────
    {
      name: 'audit_logs table',
      sql: sql`CREATE TABLE IF NOT EXISTS "audit_logs" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id" uuid REFERENCES "users"("id"),
        "action" text NOT NULL,
        "resource_type" text NOT NULL,
        "resource_id" text,
        "details" text,
        "ip_address" text,
        "user_agent" text,
        "created_at" timestamp DEFAULT now() NOT NULL
      )`,
    },
    {
      name: 'audit_logs.created_at index',
      sql: sql`CREATE INDEX IF NOT EXISTS "idx_audit_logs_created_at" ON "audit_logs" ("created_at" DESC)`,
    },
    {
      name: 'audit_logs.resource index',
      sql: sql`CREATE INDEX IF NOT EXISTS "idx_audit_logs_resource" ON "audit_logs" ("resource_type", "resource_id")`,
    },
    // ── 0040: auth & session security [CRITICAL FOR LOGIN] ───────────────
    // Drizzle's select(users) reads every column declared in the schema. If
    // email_verified is missing the entire login flow returns 500. The
    // companion token tables back logout/blacklist, password-reset, and
    // email-verification flows.
    {
      name: 'users.email_verified',
      sql: sql`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "email_verified" boolean NOT NULL DEFAULT false`,
    },
    {
      name: 'token_blacklist table',
      sql: sql`CREATE TABLE IF NOT EXISTS "token_blacklist" (
        "token_hash" text PRIMARY KEY,
        "expires_at" timestamp NOT NULL,
        "created_at" timestamp DEFAULT now() NOT NULL
      )`,
    },
    {
      name: 'token_blacklist.expires_at index',
      sql: sql`CREATE INDEX IF NOT EXISTS "idx_token_blacklist_expires_at" ON "token_blacklist" ("expires_at")`,
    },
    {
      name: 'password_reset_tokens table',
      sql: sql`CREATE TABLE IF NOT EXISTS "password_reset_tokens" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "token_hash" text NOT NULL UNIQUE,
        "expires_at" timestamp NOT NULL,
        "used_at" timestamp,
        "created_at" timestamp DEFAULT now() NOT NULL
      )`,
    },
    {
      // 0042 added used_at after 0040 created the table. If 0040 ran but 0042
      // did not, the column is missing — guard separately so the table-create
      // step above (a no-op when the table already exists) does not mask it.
      name: 'password_reset_tokens.used_at',
      sql: sql`ALTER TABLE "password_reset_tokens" ADD COLUMN IF NOT EXISTS "used_at" timestamp`,
    },
    {
      name: 'password_reset_tokens.user_id index',
      sql: sql`CREATE INDEX IF NOT EXISTS "idx_password_reset_tokens_user_id" ON "password_reset_tokens" ("user_id")`,
    },
    {
      name: 'password_reset_tokens.expires_at index',
      sql: sql`CREATE INDEX IF NOT EXISTS "idx_password_reset_tokens_expires_at" ON "password_reset_tokens" ("expires_at")`,
    },
    {
      name: 'password_reset_tokens.token_hash index',
      sql: sql`CREATE INDEX IF NOT EXISTS "idx_password_reset_token_hash" ON "password_reset_tokens" ("token_hash")`,
    },
    {
      name: 'email_verification_tokens table',
      sql: sql`CREATE TABLE IF NOT EXISTS "email_verification_tokens" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "token_hash" text NOT NULL UNIQUE,
        "expires_at" timestamp NOT NULL,
        "created_at" timestamp DEFAULT now() NOT NULL
      )`,
    },
    {
      name: 'email_verification_tokens.user_id index',
      sql: sql`CREATE INDEX IF NOT EXISTS "idx_email_verification_tokens_user_id" ON "email_verification_tokens" ("user_id")`,
    },
    // ── 0033: companies.exempt_supply_ratio (partial-exemption VAT) ──────
    // Schema-required column. If migration 0033 was tracked-but-not-run,
    // any SELECT/UPDATE...RETURNING on companies fails with 42703 because
    // Drizzle's generated SQL references this column explicitly. That
    // surfaces as a 500 "Internal Server Error" on the onboarding wizard.
    {
      name: 'companies.exempt_supply_ratio',
      sql: sql`ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "exempt_supply_ratio" numeric(5,4) NOT NULL DEFAULT 0`,
    },
    // ── 0039: companies MOHRE + WPS employer bank fields ────────────────
    {
      name: 'companies.mohre_establishment_id',
      sql: sql`ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "mohre_establishment_id" text`,
    },
    {
      name: 'companies.wps_employer_bank_name',
      sql: sql`ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "wps_employer_bank_name" text`,
    },
    {
      name: 'companies.wps_employer_iban',
      sql: sql`ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "wps_employer_iban" text`,
    },
    {
      name: 'companies.wps_employer_routing_code',
      sql: sql`ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "wps_employer_routing_code" text`,
    },
    // ── 0044: companies preferences columns (QuickBooks-style settings) ──
    // Same failure mode as 0033 above. These are referenced by Drizzle's
    // RETURNING clause on every PATCH /api/companies/:id, so a missing
    // column blocks the onboarding "Save & Continue" step.
    {
      name: 'companies.legal_name',
      sql: sql`ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "legal_name" text`,
    },
    {
      name: 'companies.date_format',
      sql: sql`ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "date_format" text NOT NULL DEFAULT 'DD/MM/YYYY'`,
    },
    {
      name: 'companies.fiscal_year_start_month',
      sql: sql`ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "fiscal_year_start_month" integer NOT NULL DEFAULT 1`,
    },
    {
      name: 'companies.default_vat_rate',
      sql: sql`ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "default_vat_rate" numeric(5,4) NOT NULL DEFAULT 0.05`,
    },
    {
      name: 'companies.address_street',
      sql: sql`ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "address_street" text`,
    },
    {
      name: 'companies.address_city',
      sql: sql`ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "address_city" text`,
    },
    {
      name: 'companies.address_country',
      sql: sql`ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "address_country" text DEFAULT 'AE'`,
    },
  ];

  // Dev/test seed data was removed 2026-04-30. The previous block contained
  // a committed bcrypt hash for the `test_firm_owner@nra.ae` account that
  // was applied to production by migrations 0023/0024/0028 (see
  // 0051_revoke_test_backdoor_accounts.sql for the cleanup).
  // tools/check-migrations-no-secrets.sh blocks recurrence by scanning all
  // source dirs for bcrypt-hash literals and user-row seed statements.
  // Local dev should create test accounts via the registration API.
  const steps = schemaSteps;

  let ok = 0;
  let failed = 0;
  for (const step of steps) {
    try {
      await db.execute(step.sql);
      ok++;
    } catch (err: any) {
      log.error({ step: step.name, err: err.message }, 'Schema guard step failed');
      failed++;
    }
  }
  log.info({ ok, failed, mode: 'schema-only' }, 'Critical schema guard completed');
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

/** Ping with latency. Used by detailed health to expose response times. */
export async function pingDb(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const start = Date.now();
  try {
    await db.execute(sql`SELECT 1`);
    return { ok: true, latencyMs: Date.now() - start };
  } catch (err: any) {
    return { ok: false, latencyMs: Date.now() - start, error: err?.message || 'unknown' };
  }
}

/** Snapshot of pool state — total/idle/waiting connections. */
export function getPoolStats(): {
  driver: 'pg' | 'neon';
  total: number;
  idle: number;
  waiting: number;
  max: number;
} {
  return {
    driver: _driver,
    total: pool?.totalCount ?? 0,
    idle: pool?.idleCount ?? 0,
    waiting: pool?.waitingCount ?? 0,
    max: POOL_CONFIG.max,
  };
}

/** Drain and close the pool. Bounded by `timeoutMs` so shutdown is never stuck. */
export async function closePool(timeoutMs = 10_000): Promise<void> {
  if (!pool?.end) return;
  await Promise.race([
    pool.end(),
    new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
}

export { pool, db };
