import "dotenv/config";

import path from "path";
import { fileURLToPath } from "url";

import { validateEnv } from "./config/env";
import { createLogger } from "./config/logger";
import { runMigrations, ensureCriticalSchema, closePool } from "./db";

validateEnv();

const log = createLogger("migrate");
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const migrationsFolder = path.resolve(projectRoot, "migrations");

try {
  await runMigrations(migrationsFolder);
  await ensureCriticalSchema();
  log.info("Production migration completed");
} catch (err) {
  log.error({ err }, "Production migration failed");
  process.exitCode = 1;
} finally {
  await closePool();
}
