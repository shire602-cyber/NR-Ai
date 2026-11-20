/**
 * F8 item 1: the audit hash chain under concurrency (R02-17 follow-up).
 *
 * Root cause of the intermittent "[R02-17] concurrent inserts keep one unbroken chain" failure:
 * a row inserted while another transaction held the chain lock is stored unsealed (seq NULL),
 * and the post-insert seal used pg_try_advisory_xact_lock. When a concurrent sealer held the
 * lock with a snapshot taken before our row committed, our try-lock failed and the sealer did
 * not see the row, so recordAudit returned with the row still unsealed until the minute job.
 * The chain itself never forked, but a caller (or the test) reading right after the write saw
 * a NULL seq. The post-commit seal now waits (bounded by lock_timeout) for the chain lock and
 * seals with a fresh snapshot, so a committed autocommit audit row is sealed when
 * recordAudit returns.
 */
import { describe, expect, it } from "vitest";
import { useHarness } from "./harness";

const h = useHarness();

async function expectSealedChain(companyId: string, expected: number): Promise<void> {
  // Read the raw table BEFORE any verify call (verify seals pending rows itself).
  const all = await h.sql<{ seq: number | null; prev_hash: string | null; hash: string | null }>(
    `SELECT seq::int AS seq, prev_hash, hash FROM audit_logs WHERE company_id = $1
      ORDER BY seq NULLS LAST, created_at, id`,
    [companyId]
  );
  expect(all.length).toBeGreaterThanOrEqual(expected);
  expect(all.filter((r) => r.seq === null)).toHaveLength(0);
  expect(all.map((r) => r.seq)).toEqual(all.map((_, i) => i + 1));
  expect(all[0].prev_hash).toBe("0".repeat(64));
  for (let i = 1; i < all.length; i++) expect(all[i].prev_hash).toBe(all[i - 1].hash);
}

describe("F8 audit chain concurrency", () => {
  it("[F8-01] 100 concurrent autocommit inserts are all sealed into one chain on return", async () => {
    const { recordAudit } = await import("../../server/services/audit.service");
    for (let round = 0; round < 5; round++) {
      const t = await h.createTenant({ name: `Burst${round}` });
      await Promise.all(
        Array.from({ length: 100 }, (_, i) =>
          recordAudit({
            userId: t.user.id,
            companyId: t.company.id,
            action: "test.burst",
            entityType: "test",
            entityId: String(i),
            after: { i, round },
          })
        )
      );
      const burst = await h.sql(
        `SELECT 1 FROM audit_logs WHERE company_id = $1 AND action = 'test.burst'`,
        [t.company.id]
      );
      expect(burst).toHaveLength(100);
      await expectSealedChain(t.company.id, 100);
      const verify = await t.as.get(`/api/companies/${t.company.id}/audit-log/verify`);
      expect(verify.body, JSON.stringify(verify.body)).toMatchObject({
        ok: true,
        firstBroken: null,
        pendingRows: 0,
      });
    }
  });

  it("[F8-01] in-transaction inserts racing autocommit inserts, with rollbacks, leave no gap", async () => {
    const t = await h.createTenant({ name: "Mixed" });
    const { recordAudit } = await import("../../server/services/audit.service");
    const { db } = await import("../../server/db");
    const work = Array.from({ length: 60 }, (_, i) => {
      if (i % 3 === 0) {
        // Document transaction that writes its audit row, then rolls back: no row, no gap.
        return db
          .transaction(async (tx) => {
            await recordAudit({
              userId: t.user.id,
              companyId: t.company.id,
              action: "test.rolledback",
              entityType: "test",
              entityId: String(i),
              tx: tx as never,
            });
            throw new Error("rollback");
          })
          .catch(() => undefined);
      }
      if (i % 3 === 1) {
        return db.transaction(async (tx) => {
          await recordAudit({
            userId: t.user.id,
            companyId: t.company.id,
            action: "test.intx",
            entityType: "test",
            entityId: String(i),
            tx: tx as never,
          });
        });
      }
      return recordAudit({
        userId: t.user.id,
        companyId: t.company.id,
        action: "test.autocommit",
        entityType: "test",
        entityId: String(i),
      });
    });
    await Promise.all(work);
    const rolled = await h.sql(
      `SELECT 1 FROM audit_logs WHERE company_id = $1 AND action = 'test.rolledback'`,
      [t.company.id]
    );
    expect(rolled).toHaveLength(0);
    // In-transaction rows that lost the lock race are sealed by the next seal; verify seals
    // them (waiting for the lock) and then walks the whole chain strictly.
    const verify = await t.as.get(`/api/companies/${t.company.id}/audit-log/verify`);
    expect(verify.body, JSON.stringify(verify.body)).toMatchObject({
      ok: true,
      firstBroken: null,
      pendingRows: 0,
    });
    await expectSealedChain(t.company.id, 40);
  });
});
