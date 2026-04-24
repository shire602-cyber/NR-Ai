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
 * Belt-and-suspenders schema guard: ensures critical columns added in later
 * migrations actually exist. Runs raw SQL with IF NOT EXISTS so it is always
 * safe to re-run regardless of the Drizzle migration tracking state.
 */
export async function ensureCriticalSchema(): Promise<void> {
  try {
    // Phase 0: firm_role column + firm_staff_assignments table
    await db.execute(
      sql`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "firm_role" text`
    );
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "firm_staff_assignments" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
        "assigned_at" timestamp DEFAULT now() NOT NULL,
        CONSTRAINT "firm_staff_assignments_user_company_unique"
          UNIQUE("user_id", "company_id")
      )
    `);
    console.log('[db] Critical schema guard: OK');
  } catch (err) {
    console.error('[db] Critical schema guard failed:', err);
  }
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
