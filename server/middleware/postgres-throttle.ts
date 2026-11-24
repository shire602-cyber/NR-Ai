import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";

type ThrottleEvent = { at: number; id?: string };
type BucketRow = { events: ThrottleEvent[]; now: number };

export function usesPostgresThrottle(): boolean {
  return process.env.NODE_ENV === "production" || process.env.VERCEL === "1";
}

/** One row per scoped identity, shared by every app instance. */
export class PostgresThrottleBucket {
  constructor(
    readonly namespace: string,
    private readonly horizonMs: number
  ) {}

  private hash(key: string): string {
    return createHash("sha256").update(key).digest("hex");
  }

  async read(key: string): Promise<BucketRow> {
    const { db } = await import("../db");
    const { rows } = await db.execute<BucketRow>(sql`
      SELECT events, (extract(epoch FROM clock_timestamp()) * 1000)::float8 AS now
      FROM request_throttle_buckets
      WHERE namespace = ${this.namespace} AND key_hash = ${this.hash(key)}
    `);
    return rows[0] ?? { events: [], now: Date.now() };
  }

  async mutate<T>(key: string, apply: (events: ThrottleEvent[], now: number) => T): Promise<T> {
    const { db } = await import("../db");
    const hash = this.hash(key);
    return db.transaction(async (tx) => {
      // The upsert locks even a newly created bucket against competing writers.
      const { rows } = await tx.execute<BucketRow>(sql`
        INSERT INTO request_throttle_buckets (namespace, key_hash, expires_at)
        VALUES (${this.namespace}, ${hash}, clock_timestamp())
        ON CONFLICT (namespace, key_hash) DO UPDATE SET key_hash = EXCLUDED.key_hash
        RETURNING events, (extract(epoch FROM clock_timestamp()) * 1000)::float8 AS now
      `);
      const { events, now } = rows[0]!;
      const fresh = events.filter((event) => event.at > now - this.horizonMs);
      const result = apply(fresh, now);
      const newest = fresh.at(-1);
      const expiresAt = newest ? newest.at + this.horizonMs : now;
      await tx.execute(sql`
        UPDATE request_throttle_buckets
        SET events = ${JSON.stringify(fresh)}::jsonb,
            expires_at = to_timestamp(${expiresAt / 1000})
        WHERE namespace = ${this.namespace} AND key_hash = ${hash}
      `);
      // Bound cleanup per invocation and skip rows held by other instances.
      if (Math.random() < 1 / 256) {
        await tx.execute(sql`
          DELETE FROM request_throttle_buckets
          WHERE (namespace, key_hash) IN (
            SELECT namespace, key_hash FROM request_throttle_buckets
            WHERE expires_at <= statement_timestamp()
            ORDER BY expires_at LIMIT 512 FOR UPDATE SKIP LOCKED
          )
        `);
      }
      return result;
    });
  }

  async reset(key: string): Promise<void> {
    const { db } = await import("../db");
    await db.execute(sql`
      DELETE FROM request_throttle_buckets
      WHERE namespace = ${this.namespace} AND key_hash = ${this.hash(key)}
    `);
  }
}
