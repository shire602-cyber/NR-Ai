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

type QueryRow = Record<string, unknown>;

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

function rowsFromResult<T extends QueryRow = QueryRow>(result: unknown): T[] {
  if (Array.isArray(result)) {
    return result as T[];
  }

  const rows = (result as { rows?: unknown })?.rows;
  return Array.isArray(rows) ? (rows as T[]) : [];
}

async function queryRows<T extends QueryRow = QueryRow>(query: ReturnType<typeof sql>): Promise<T[]> {
  return rowsFromResult<T>(await db.execute(query));
}

async function tableExists(schemaName: string, tableName: string): Promise<boolean> {
  const rows = await queryRows<{ exists: boolean }>(sql`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = ${schemaName}
        AND table_name = ${tableName}
    ) AS "exists"
  `);
  return Boolean(rows[0]?.exists);
}

/**
 * Production has gone through a few migration systems. Some Railway databases
 * already contain the app schema but have an empty Drizzle migration ledger,
 * which makes Drizzle replay 0000 and fail on CREATE TABLE accounts. When the
 * core schema is present and the ledger is empty, mark the current migration
 * set as the baseline so future migrations can proceed normally.
 */
async function baselineMigrationLedgerForExistingSchema(migrationsFolder: string): Promise<void> {
  const hasExistingAppSchema = await Promise.all([
    tableExists('public', 'accounts'),
    tableExists('public', 'companies'),
    tableExists('public', 'users'),
    tableExists('public', 'journal_entries'),
  ]).then((checks) => checks.every(Boolean));

  if (!hasExistingAppSchema) {
    log.info('Migration baseline check skipped: core app schema not present');
    return;
  }

  const ledgerExists = await tableExists('drizzle', '__drizzle_migrations');
  if (ledgerExists) {
    const rows = await queryRows<{ count: string | number }>(
      sql`SELECT COUNT(*) AS "count" FROM "drizzle"."__drizzle_migrations"`
    );
    if (Number(rows[0]?.count ?? 0) > 0) {
      log.info({ count: Number(rows[0]?.count ?? 0) }, 'Migration baseline check passed: Drizzle ledger already populated');
      return;
    }
  }

  const { readMigrationFiles } = await import('drizzle-orm/migrator');
  const migrations = readMigrationFiles({ migrationsFolder });

  await db.execute(sql`CREATE SCHEMA IF NOT EXISTS "drizzle"`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )
  `);

  for (const migration of migrations) {
    await db.execute(sql`
      INSERT INTO "drizzle"."__drizzle_migrations" ("hash", "created_at")
      VALUES (${migration.hash}, ${migration.folderMillis})
    `);
  }

  log.warn(
    { count: migrations.length },
    'Baselined Drizzle migration ledger for existing app schema'
  );
}

export async function runMigrations(migrationsFolder: string): Promise<void> {
  log.info({ migrationsFolder, driver: _driver }, 'Running migrations');
  try {
    log.info('Checking migration ledger baseline');
    await baselineMigrationLedgerForExistingSchema(migrationsFolder);
    log.info({ driver: _driver }, 'Executing Drizzle migrations');
    if (_driver === 'neon') {
      const { migrate } = await import('drizzle-orm/neon-serverless/migrator');
      await migrate(db, { migrationsFolder });
    } else {
      const { migrate } = await import('drizzle-orm/node-postgres/migrator');
      await migrate(db, { migrationsFolder });
    }
    log.info('Migrations completed successfully');
  } catch (err: any) {
    log.error(
      { err, message: err?.message, code: err?.code, detail: err?.detail, query: err?.query },
      'Migration failed',
    );
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
    // ── 0001/production drift: complete companies profile surface ───────
    // Drizzle UPDATE/SELECT returns every declared company column. If any
    // historical profile column is missing, onboarding step 2 fails with a
    // generic 500 even when the submitted fields are valid.
    {
      name: 'companies.company_type',
      sql: sql`ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "company_type" text NOT NULL DEFAULT 'customer'`,
    },
    {
      name: 'companies.legal_structure',
      sql: sql`ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "legal_structure" text`,
    },
    {
      name: 'companies.industry',
      sql: sql`ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "industry" text`,
    },
    {
      name: 'companies.registration_number',
      sql: sql`ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "registration_number" text`,
    },
    {
      name: 'companies.business_address',
      sql: sql`ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "business_address" text`,
    },
    {
      name: 'companies.contact_phone',
      sql: sql`ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "contact_phone" text`,
    },
    {
      name: 'companies.contact_email',
      sql: sql`ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "contact_email" text`,
    },
    {
      name: 'companies.website_url',
      sql: sql`ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "website_url" text`,
    },
    {
      name: 'companies.logo_url',
      sql: sql`ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "logo_url" text`,
    },
    {
      name: 'companies.trn_vat_number',
      sql: sql`ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "trn_vat_number" text`,
    },
    {
      name: 'companies.tax_registration_type',
      sql: sql`ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "tax_registration_type" text`,
    },
    {
      name: 'companies.vat_filing_frequency',
      sql: sql`ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "vat_filing_frequency" text`,
    },
    {
      name: 'companies.tax_registration_date',
      sql: sql`ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "tax_registration_date" timestamp`,
    },
    {
      name: 'companies.corporate_tax_id',
      sql: sql`ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "corporate_tax_id" text`,
    },
    {
      name: 'companies.emirate',
      sql: sql`ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "emirate" text DEFAULT 'dubai'`,
    },
    {
      name: 'companies.invoice_show_logo',
      sql: sql`ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "invoice_show_logo" boolean NOT NULL DEFAULT true`,
    },
    {
      name: 'companies.invoice_show_address',
      sql: sql`ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "invoice_show_address" boolean NOT NULL DEFAULT true`,
    },
    {
      name: 'companies.invoice_show_phone',
      sql: sql`ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "invoice_show_phone" boolean NOT NULL DEFAULT true`,
    },
    {
      name: 'companies.invoice_show_email',
      sql: sql`ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "invoice_show_email" boolean NOT NULL DEFAULT true`,
    },
    {
      name: 'companies.invoice_show_website',
      sql: sql`ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "invoice_show_website" boolean NOT NULL DEFAULT false`,
    },
    {
      name: 'companies.invoice_custom_title',
      sql: sql`ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "invoice_custom_title" text`,
    },
    {
      name: 'companies.invoice_footer_note',
      sql: sql`ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "invoice_footer_note" text`,
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
    {
      name: 'refresh_sessions table',
      sql: sql`CREATE TABLE IF NOT EXISTS "refresh_sessions" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "token_hash" text NOT NULL UNIQUE,
        "replaced_by_token_hash" text,
        "expires_at" timestamp NOT NULL,
        "revoked_at" timestamp,
        "reuse_detected_at" timestamp,
        "last_used_at" timestamp,
        "user_agent" text,
        "ip_address" text,
        "created_at" timestamp DEFAULT now() NOT NULL
      )`,
    },
    {
      name: 'refresh_sessions.token_hash index',
      sql: sql`CREATE INDEX IF NOT EXISTS "idx_refresh_sessions_token_hash" ON "refresh_sessions" ("token_hash")`,
    },
    {
      name: 'refresh_sessions.user_id index',
      sql: sql`CREATE INDEX IF NOT EXISTS "idx_refresh_sessions_user_id" ON "refresh_sessions" ("user_id")`,
    },
    {
      name: 'refresh_sessions.expires_at index',
      sql: sql`CREATE INDEX IF NOT EXISTS "idx_refresh_sessions_expires_at" ON "refresh_sessions" ("expires_at")`,
    },
    // ── 0053: social login identity + one-time OAuth state ───────────────
    {
      name: 'auth_identities table',
      sql: sql`CREATE TABLE IF NOT EXISTS "auth_identities" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "provider" text NOT NULL,
        "issuer" text NOT NULL,
        "provider_subject" text NOT NULL,
        "provider_email" text NOT NULL,
        "provider_email_verified" boolean NOT NULL DEFAULT false,
        "profile" jsonb,
        "linked_at" timestamp DEFAULT now() NOT NULL,
        "last_login_at" timestamp,
        CONSTRAINT "auth_identities_provider_subject_unique" UNIQUE ("provider", "issuer", "provider_subject")
      )`,
    },
    {
      name: 'auth_identities.user_provider index',
      sql: sql`CREATE INDEX IF NOT EXISTS "idx_auth_identities_user_provider" ON "auth_identities" ("user_id", "provider")`,
    },
    {
      name: 'auth_identities.provider_email index',
      sql: sql`CREATE INDEX IF NOT EXISTS "idx_auth_identities_provider_email" ON "auth_identities" ("provider_email")`,
    },
    {
      name: 'oauth_login_states table',
      sql: sql`CREATE TABLE IF NOT EXISTS "oauth_login_states" (
        "state_hash" text PRIMARY KEY,
        "provider" text NOT NULL,
        "encrypted_code_verifier" text NOT NULL,
        "encrypted_nonce" text NOT NULL,
        "nonce_hash" text NOT NULL,
        "next_path" text NOT NULL DEFAULT '/dashboard',
        "expires_at" timestamp NOT NULL,
        "consumed_at" timestamp,
        "ip_address" text,
        "user_agent" text,
        "created_at" timestamp DEFAULT now() NOT NULL
      )`,
    },
    {
      name: 'oauth_login_states.provider index',
      sql: sql`CREATE INDEX IF NOT EXISTS "idx_oauth_login_states_provider" ON "oauth_login_states" ("provider")`,
    },
    {
      name: 'oauth_login_states.expires_at index',
      sql: sql`CREATE INDEX IF NOT EXISTS "idx_oauth_login_states_expires_at" ON "oauth_login_states" ("expires_at")`,
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
    {
      name: 'companies.vat_auto_calculate',
      sql: sql`ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "vat_auto_calculate" boolean NOT NULL DEFAULT true`,
    },
    {
      name: 'companies.vat_period_start_month',
      sql: sql`ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "vat_period_start_month" integer NOT NULL DEFAULT 1`,
    },
    {
      name: 'companies.classifier_config',
      sql: sql`ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "classifier_config" jsonb NOT NULL DEFAULT '{"mode":"hybrid","accuracyThreshold":0.8,"autopilotEnabled":false}'::jsonb`,
    },
    // ── 0056: WhatsApp Web bridge ────────────────────────────────────────
    {
      name: 'whatsapp_bridge_sessions table',
      sql: sql`CREATE TABLE IF NOT EXISTS "whatsapp_bridge_sessions" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE cascade,
        "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
        "extension_id" text NOT NULL,
        "extension_version" text,
        "status" text DEFAULT 'active' NOT NULL,
        "user_agent" text,
        "last_seen_at" timestamp DEFAULT now() NOT NULL,
        "expires_at" timestamp NOT NULL,
        "created_at" timestamp DEFAULT now() NOT NULL,
        "updated_at" timestamp DEFAULT now() NOT NULL
      )`,
    },
    {
      name: 'whatsapp_bridge_sessions indexes',
      sql: sql`CREATE INDEX IF NOT EXISTS "idx_whatsapp_bridge_sessions_company_id" ON "whatsapp_bridge_sessions" ("company_id")`,
    },
    {
      name: 'whatsapp_bridge_sessions user index',
      sql: sql`CREATE INDEX IF NOT EXISTS "idx_whatsapp_bridge_sessions_user_id" ON "whatsapp_bridge_sessions" ("user_id")`,
    },
    {
      name: 'whatsapp_bridge_sessions status index',
      sql: sql`CREATE INDEX IF NOT EXISTS "idx_whatsapp_bridge_sessions_status" ON "whatsapp_bridge_sessions" ("status")`,
    },
    {
      name: 'whatsapp_bridge_jobs table',
      sql: sql`CREATE TABLE IF NOT EXISTS "whatsapp_bridge_jobs" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE cascade,
        "created_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
        "session_id" uuid REFERENCES "whatsapp_bridge_sessions"("id") ON DELETE set null,
        "whatsapp_message_id" uuid REFERENCES "whatsapp_messages"("id") ON DELETE set null,
        "provider" text DEFAULT 'whatsapp_web_extension' NOT NULL,
        "kind" text DEFAULT 'direct_message' NOT NULL,
        "recipient_phone" text NOT NULL,
        "normalized_recipient_phone" text NOT NULL,
        "recipient_name" text,
        "message_body" text NOT NULL,
        "attachment_url" text,
        "attachment_label" text,
        "source_type" text,
        "source_id" uuid,
        "status" text DEFAULT 'queued' NOT NULL,
        "delivery_status" text DEFAULT 'logged' NOT NULL,
        "error_message" text,
        "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
        "drafted_at" timestamp,
        "completed_at" timestamp,
        "created_at" timestamp DEFAULT now() NOT NULL,
        "updated_at" timestamp DEFAULT now() NOT NULL
      )`,
    },
    {
      name: 'whatsapp_bridge_jobs company index',
      sql: sql`CREATE INDEX IF NOT EXISTS "idx_whatsapp_bridge_jobs_company_id" ON "whatsapp_bridge_jobs" ("company_id")`,
    },
    {
      name: 'whatsapp_bridge_jobs creator index',
      sql: sql`CREATE INDEX IF NOT EXISTS "idx_whatsapp_bridge_jobs_created_by" ON "whatsapp_bridge_jobs" ("created_by")`,
    },
    {
      name: 'whatsapp_bridge_jobs status index',
      sql: sql`CREATE INDEX IF NOT EXISTS "idx_whatsapp_bridge_jobs_status" ON "whatsapp_bridge_jobs" ("status")`,
    },
    {
      name: 'whatsapp_bridge_jobs recipient index',
      sql: sql`CREATE INDEX IF NOT EXISTS "idx_whatsapp_bridge_jobs_recipient" ON "whatsapp_bridge_jobs" ("normalized_recipient_phone")`,
    },
    {
      name: 'whatsapp_bridge_jobs source index',
      sql: sql`CREATE INDEX IF NOT EXISTS "idx_whatsapp_bridge_jobs_source" ON "whatsapp_bridge_jobs" ("source_type", "source_id")`,
    },
    // ── 0057: corporate tax manual workpaper support ───────────────────
    // Production can contain drifted databases where the migration ledger is
    // ahead of a specific table. Keep this guard non-fatal when the table is
    // absent, but self-heal the column as soon as the table exists.
    {
      name: 'corporate_tax_returns.workpaper',
      sql: sql`
        DO $$
        BEGIN
          IF to_regclass('public.corporate_tax_returns') IS NOT NULL THEN
            ALTER TABLE "corporate_tax_returns" ADD COLUMN IF NOT EXISTS "workpaper" jsonb;
          END IF;
        END $$
      `,
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
