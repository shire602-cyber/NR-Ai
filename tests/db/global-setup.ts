/**
 * Vitest globalSetup for the DB harness (tests/db/vitest.config.ts).
 *
 * Creates ONE migrated template database per `npm run test:db` run; every
 * test file then clones it (CREATE DATABASE ... TEMPLATE) so each file gets
 * a fresh, fully migrated database in ~1 s. The template is dropped on
 * teardown. If the role cannot CREATE DATABASE (or Postgres is unreachable),
 * workers fall back to an in-process PGlite database instead.
 */
import {
  HARNESS_DB_PREFIX,
  canCreateDatabases,
  createDatabase,
  databaseUrl,
  dropDatabase,
  migrateDatabase,
  resolveAdminUrl,
  withAdmin,
} from "./pg-admin";

export default async function globalSetup() {
  const adminUrl = resolveAdminUrl();
  const probe = await canCreateDatabases(adminUrl);
  if (!probe.ok) {
    process.env.HARNESS_MODE = "pglite";
    process.env.HARNESS_FALLBACK_REASON = probe.reason ?? "CREATE DATABASE not permitted";
    console.warn(
      `[db-harness] Postgres CREATE DATABASE unavailable (${process.env.HARNESS_FALLBACK_REASON}); ` +
        "falling back to in-process PGlite. Concurrency tests will be skipped."
    );
    return async () => undefined;
  }

  // Sweep templates/databases left behind by a crashed earlier run (>6h old).
  await withAdmin(adminUrl, async (c) => {
    const { rows } = await c.query<{ datname: string }>(
      `SELECT datname FROM pg_database WHERE datname LIKE $1`,
      [`${HARNESS_DB_PREFIX}%`]
    );
    const cutoff = Date.now() - 6 * 3600_000;
    for (const { datname } of rows) {
      const ts = Number.parseInt(datname.split("_").pop() ?? "", 36);
      if (Number.isFinite(ts) && ts > 1e12 && ts < cutoff) {
        await c.query(`DROP DATABASE IF EXISTS "${datname}" WITH (FORCE)`).catch(() => undefined);
      }
    }
  });

  const template = `${HARNESS_DB_PREFIX}tpl_${process.pid}_${Date.now().toString(36)}`;
  const started = Date.now();
  await createDatabase(adminUrl, template);
  try {
    migrateDatabase(databaseUrl(adminUrl, template));
  } catch (err) {
    await dropDatabase(adminUrl, template).catch(() => undefined);
    throw err;
  }
  console.log(`[db-harness] migrated template ${template} in ${Date.now() - started} ms`);

  process.env.HARNESS_MODE = "postgres";
  process.env.HARNESS_ADMIN_URL = adminUrl;
  process.env.HARNESS_TEMPLATE_DB = template;

  return async () => {
    await dropDatabase(adminUrl, template).catch((err) =>
      console.warn(`[db-harness] could not drop template ${template}: ${err?.message ?? err}`)
    );
  };
}
