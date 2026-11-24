import { sql } from "drizzle-orm";
import type { PoolClient } from "pg";

/** The schema stores UTC wall-clock values in timestamp-without-time-zone columns. */
export const databaseUtcNow = sql<Date>`(statement_timestamp() AT TIME ZONE 'UTC')`;

/** pg-pool and Neon both wait for verification before checking out a new connection. */
export const databaseSessionOptions = {
  verify(client: Pick<PoolClient, "query">, done: (error?: Error) => void): void {
    void client.query("SET TIME ZONE 'UTC'").then(
      () => done(),
      (error: Error) => done(error)
    );
  },
};
