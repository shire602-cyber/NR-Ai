/**
 * S8 (W5-A / S5 residual): deferred object-storage deletions.
 *
 * Report delivery artifacts keep their bytes in object storage (`storage_key`). Deleting an
 * artifact row, directly or by cascade from its run or company, fires the migration-0114 trigger,
 * which queues the key in `object_storage_deletions`. The database delete never touches the
 * object store, so a slow or failing bucket can never block or roll back a delete.
 *
 * `processObjectDeletionQueue` (job "storage.objectDeletionSweep") drains the queue through
 * `fileStorage.deleteObjectOrThrow`: success removes the queue row; a failure is logged, counted
 * and retried with exponential backoff; after MAX_ATTEMPTS the row is parked as `dead` for an
 * operator to inspect.
 */
import { pool } from "../db";
import { createLogger } from "../config/logger";
import { listJobs, registerJob } from "../platform/job-registry";
import { deleteObjectOrThrow } from "./fileStorage";

const log = createLogger("object-deletion-queue");

export const OBJECT_DELETION_MAX_ATTEMPTS = 10;

/** Minutes until the next attempt after `attempts` failures: 1, 2, 4 ... capped at one day. */
export function objectDeletionBackoffMinutes(attempts: number): number {
  return Math.min(24 * 60, 2 ** Math.max(0, attempts - 1));
}

export interface ObjectDeletionSweepResult {
  deleted: number;
  failed: number;
  dead: number;
  stillReferenced: number;
}

export async function processObjectDeletionQueue(
  opts: { limit?: number } = {}
): Promise<ObjectDeletionSweepResult> {
  const limit = Math.max(1, Math.min(500, opts.limit ?? 100));
  const result: ObjectDeletionSweepResult = { deleted: 0, failed: 0, dead: 0, stillReferenced: 0 };
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = (await client.query(
      `SELECT id, storage_key, attempts FROM object_storage_deletions
        WHERE status = 'pending' AND next_attempt_at <= now()
        ORDER BY next_attempt_at
        LIMIT $1
        FOR UPDATE SKIP LOCKED`,
      [limit]
    )) as { rows: Array<{ id: string; storage_key: string; attempts: number }> };
    for (const row of rows) {
      try {
        // A key still referenced by a live row (a restore re-inserted it, or a copy shares it)
        // must not be deleted: drop the queue entry and keep the object.
        const live = await client.query(
          `SELECT 1 FROM company_report_delivery_artifacts WHERE storage_key = $1 LIMIT 1`,
          [row.storage_key]
        );
        if ((live.rowCount ?? 0) > 0) {
          await client.query(`DELETE FROM object_storage_deletions WHERE id = $1`, [row.id]);
          result.stillReferenced += 1;
          continue;
        }
        await deleteObjectOrThrow(row.storage_key);
        await client.query(`DELETE FROM object_storage_deletions WHERE id = $1`, [row.id]);
        result.deleted += 1;
      } catch (err) {
        const attempts = Number(row.attempts) + 1;
        const dead = attempts >= OBJECT_DELETION_MAX_ATTEMPTS;
        const message = err instanceof Error ? err.message : String(err);
        await client.query(
          `UPDATE object_storage_deletions
              SET attempts = $2, last_error = $3, status = $4,
                  next_attempt_at = now() + ($5::int * interval '1 minute')
            WHERE id = $1`,
          [
            row.id,
            attempts,
            message.slice(0, 1000),
            dead ? "dead" : "pending",
            objectDeletionBackoffMinutes(attempts),
          ]
        );
        if (dead) result.dead += 1;
        else result.failed += 1;
        log.warn(
          { id: row.id, storageKey: row.storage_key, attempts, dead, err: message },
          "Object storage deletion failed; will retry"
        );
      }
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
  return result;
}

/** Register the sweep (every 10 minutes). Idempotent. */
export function registerObjectDeletionJob(): void {
  if (listJobs().some((j) => j.name === "storage.objectDeletionSweep")) return;
  registerJob({
    name: "storage.objectDeletionSweep",
    cron: "*/10 * * * *",
    description: "Delete queued object-storage keys (report artifacts); retry with backoff",
    run: async () => {
      const r = await processObjectDeletionQueue();
      if (r.deleted || r.failed || r.dead) log.info(r, "Object deletion sweep");
    },
  });
}
