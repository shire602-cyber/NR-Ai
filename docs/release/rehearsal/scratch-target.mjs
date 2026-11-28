/* global process, URL */
import pg from "pg";

export async function connectScratchTarget() {
  const connectionString = process.env.DATABASE_URL;
  const expectedCluster = process.env.REHEARSAL_CLUSTER_ID;
  const expectedDatabase = process.env.REHEARSAL_DATABASE;
  const url = new URL(connectionString ?? "");
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    url.hostname !== "127.0.0.1" ||
    !url.port ||
    url.hash ||
    (url.search && url.search !== "?sslmode=disable") ||
    !/^[a-z_][a-z0-9_]*$/.test(expectedDatabase ?? "") ||
    url.pathname !== "/" + expectedDatabase ||
    !/^\d+$/.test(expectedCluster ?? "")
  ) {
    throw new Error("Expected a driver-created database on a verified disposable loopback cluster");
  }

  const client = new pg.Client({
    connectionString,
    connectionTimeoutMillis: 5000,
    options: "-c search_path=public,pg_catalog",
  });
  try {
    await client.connect();
    const { rows } = await client.query(
      `SELECT system_identifier::text AS cluster_id, current_database() AS database
         FROM pg_catalog.pg_control_system(), pg_catalog.pg_database
        WHERE datname = current_database()
          AND shobj_description(oid, 'pg_database') = 'Muhasib disposable release rehearsal'
          AND NOT pg_is_in_recovery()`
    );
    if (rows[0]?.cluster_id !== expectedCluster || rows[0].database !== expectedDatabase) {
      throw new Error("Disposable rehearsal database or cluster identity mismatch");
    }
    return client;
  } catch (error) {
    await client.end();
    throw error;
  }
}
