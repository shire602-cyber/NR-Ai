/**
 * Postgres admin helpers for the DB test harness.
 *
 * The admin URL comes from TEST_DATABASE_ADMIN_URL, else it is derived from
 * the DATABASE_URL in the repo's .env (database name swapped for `postgres`),
 * else postgresql://muhasib:muhasib@localhost:5432/postgres. The harness only
 * ever CREATEs and DROPs databases whose names start with HARNESS_DB_PREFIX;
 * it never connects to the database named in .env.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import pg from "pg";

const here = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(here, "../..");
export const HARNESS_DB_PREFIX = "harness_";

export function resolveAdminUrl(): string {
  if (process.env.TEST_DATABASE_ADMIN_URL) return process.env.TEST_DATABASE_ADMIN_URL;
  let base = "postgresql://muhasib:muhasib@localhost:5432/postgres";
  const envFile = path.join(repoRoot, ".env");
  if (fs.existsSync(envFile)) {
    const parsed = dotenv.parse(fs.readFileSync(envFile));
    if (parsed.DATABASE_URL && /^postgres(ql)?:\/\//.test(parsed.DATABASE_URL)) {
      base = parsed.DATABASE_URL;
    }
  }
  const u = new URL(base);
  u.pathname = "/postgres";
  return u.toString();
}

export function databaseUrl(adminUrl: string, dbName: string): string {
  const u = new URL(adminUrl);
  u.pathname = `/${dbName}`;
  return u.toString();
}

function assertHarnessName(name: string): void {
  if (!name.startsWith(HARNESS_DB_PREFIX) || !/^[a-z0-9_]+$/.test(name)) {
    throw new Error(`refusing to touch non-harness database name: ${name}`);
  }
}

export async function withAdmin<T>(adminUrl: string, fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: adminUrl, connectionTimeoutMillis: 5_000 });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end().catch(() => undefined);
  }
}

export async function createDatabase(
  adminUrl: string,
  name: string,
  template?: string
): Promise<void> {
  assertHarnessName(name);
  if (template) assertHarnessName(template);
  // CREATE DATABASE ... TEMPLATE fails with 55006 while another session is
  // copying the same template, so retry with backoff.
  for (let attempt = 0; ; attempt++) {
    try {
      await withAdmin(adminUrl, (c) =>
        c.query(`CREATE DATABASE "${name}"${template ? ` TEMPLATE "${template}"` : ""}`)
      );
      return;
    } catch (err: any) {
      if (err?.code === "55006" && attempt < 40) {
        await new Promise((r) => setTimeout(r, 150 + Math.random() * 350));
        continue;
      }
      throw err;
    }
  }
}

export async function dropDatabase(adminUrl: string, name: string): Promise<void> {
  assertHarnessName(name);
  await withAdmin(adminUrl, (c) => c.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`));
}

/** Probe whether this role may CREATE DATABASE on the server. */
export async function canCreateDatabases(
  adminUrl: string
): Promise<{ ok: boolean; reason?: string }> {
  const probe = `${HARNESS_DB_PREFIX}probe_${process.pid}_${Date.now().toString(36)}`;
  try {
    await createDatabase(adminUrl, probe);
    await dropDatabase(adminUrl, probe);
    return { ok: true };
  } catch (err: any) {
    return { ok: false, reason: `${err?.code ?? ""} ${err?.message ?? String(err)}`.trim() };
  }
}

/** Run the app's own migration path against `url` in a child process. */
export function migrateDatabase(url: string, opts: { criticalSchema?: boolean } = {}): void {
  const args = ["tsx", "tests/db/migrate-db.ts"];
  if (opts.criticalSchema === false) args.push("--no-critical-schema");
  const res = spawnSync("npx", args, {
    cwd: repoRoot,
    env: { ...process.env, DATABASE_URL: url, LOG_LEVEL: "error", NODE_ENV: "test" },
    encoding: "utf8",
  });
  if (res.status !== 0) {
    throw new Error(`migrations failed for ${url}:\n${res.stdout}\n${res.stderr}`);
  }
}
