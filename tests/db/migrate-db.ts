/**
 * Child-process entry used by tests/db/global-setup.ts to migrate the
 * template database with the app's OWN migration code path
 * (server/db.ts runMigrations + ensureCriticalSchema, exactly what
 * server/migrate.ts runs in the deploy phase).
 *
 * Usage: DATABASE_URL=postgres://.../db npx tsx tests/db/migrate-db.ts [--no-critical-schema]
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.resolve(here, "../../migrations");

const { runMigrations, ensureCriticalSchema, closePool } = await import("../../server/db");

try {
  await runMigrations(migrationsFolder);
  if (!process.argv.includes("--no-critical-schema")) {
    await ensureCriticalSchema();
  }
  console.log("migrate-db: ok");
} catch (err) {
  console.error("migrate-db: FAILED", err);
  process.exitCode = 1;
} finally {
  await closePool();
}
