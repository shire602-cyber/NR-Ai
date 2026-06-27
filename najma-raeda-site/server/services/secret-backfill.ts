/**
 * One-shot, idempotent backfill: encrypt any legacy plaintext secret columns
 * with the secret-vault. Runs from migrate.ts (which has SESSION_SECRET /
 * TOKEN_ENCRYPTION_KEY at hand) — a SQL migration cannot do this because the
 * key never touches the database.
 *
 * Rows already in `enc:v1:` format are skipped, so re-running is free.
 */
import { pool } from "../db";
import { createLogger } from "../config/logger";
import { encryptSecret, isEncryptedSecret } from "./secret-vault";

const log = createLogger("secret-backfill");

const TARGETS: Array<{ table: string; columns: string[] }> = [
  {
    table: "ecommerce_integrations",
    columns: ["api_key", "access_token", "refresh_token", "webhook_secret"],
  },
  { table: "bank_connections", columns: ["access_token", "refresh_token"] },
];

export async function backfillPlaintextSecrets(): Promise<void> {
  for (const { table, columns } of TARGETS) {
    const exists = await pool.query(
      `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1`,
      [table]
    );
    if (exists.rowCount === 0) continue;

    const plaintextFilter = columns
      .map((col) => `(${col} IS NOT NULL AND ${col} <> '' AND ${col} NOT LIKE 'enc:v1:%')`)
      .join(" OR ");
    const { rows } = await pool.query(
      `SELECT id, ${columns.join(", ")} FROM ${table} WHERE ${plaintextFilter}`
    );
    if (rows.length === 0) continue;

    let updated = 0;
    for (const row of rows) {
      const sets: string[] = [];
      const values: unknown[] = [];
      for (const col of columns) {
        const value = row[col];
        if (typeof value === "string" && value !== "" && !isEncryptedSecret(value)) {
          values.push(encryptSecret(value));
          sets.push(`${col} = $${values.length}`);
        }
      }
      if (sets.length === 0) continue;
      values.push(row.id);
      await pool.query(
        `UPDATE ${table} SET ${sets.join(", ")} WHERE id = $${values.length}`,
        values
      );
      updated += 1;
    }
    log.info({ table, updated }, "Encrypted legacy plaintext secrets");
  }
}
