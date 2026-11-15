/**
 * R14-06 (Critical): journal numbering must never leave an advisory lock on a
 * pooled connection. The old generateEntryNumber took a SESSION-level
 * pg_advisory_lock and released it with a separate pooled query, which could
 * run on another connection; the lock then stayed on an idle connection and
 * every later posting for that company+date blocked for 30 s and 500'd.
 *
 * This file runs the app with a pool of 5 connections (set before the harness
 * imports server/db.ts).
 */
process.env.DB_POOL_MAX = "5";

import { beforeAll, describe, expect, it } from "vitest";
import { accountByCode, useHarness, type Tenant } from "./harness";

const h = useHarness();
const today = () => new Date().toISOString().slice(0, 10);

let t: Tenant;
let a: string;
let b: string;

async function advisoryLocks(): Promise<number> {
  const rows = await h.sql<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM pg_locks l JOIN pg_database d ON d.oid = l.database
      WHERE l.locktype = 'advisory' AND d.datname = current_database()`
  );
  return rows[0].n;
}

describe.skipIf(process.env.HARNESS_MODE !== "postgres")("R14-06 numbering lock", () => {
  beforeAll(async () => {
    t = await h.createTenant({ name: "Numbering" });
    a = (await accountByCode(t, "1020")).id;
    b = (await accountByCode(t, "3010")).id;
  });

  it("R14-06: the app pool really has 5 connections in this file", async () => {
    const { pool } = await import("../../server/db");
    expect(pool.options.max).toBe(5);
  });

  it("R14-06: 50 concurrent posts on one company and date -> unique sequential numbers, no 500, no advisory lock left", async () => {
    const res = await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        t.as.post(`/api/companies/${t.company.id}/journal`, {
          date: today(),
          status: "posted",
          memo: `p${i}`,
          lines: [
            { accountId: a, debit: i + 1 },
            { accountId: b, credit: i + 1 },
          ],
        })
      )
    );
    expect(res.map((r) => r.status)).toEqual(Array(50).fill(200));
    const nums = res.map((r) => r.body.entryNumber as string);
    expect(new Set(nums).size).toBe(50);
    const seq = nums.map((n) => Number(n.split("-").pop())).sort((x, y) => x - y);
    expect(seq).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
    expect(await advisoryLocks()).toBe(0);
  }, 120_000);

  it("R14-06: generateEntryNumber takes no lock at all (no session lock can leak)", async () => {
    const { storage } = await import("../../server/storage");
    const d = new Date();
    const previews = await Promise.all(
      Array.from({ length: 20 }, () => storage.generateEntryNumber(t.company.id, d))
    );
    expect(new Set(previews).size).toBe(1);
    expect(await advisoryLocks()).toBe(0);
    // And posting right after still works (the failure mode was a 30 s block + 500).
    const started = Date.now();
    const r = await t.as.post(`/api/companies/${t.company.id}/journal`, {
      date: today(),
      status: "posted",
      lines: [
        { accountId: a, debit: 1 },
        { accountId: b, credit: 1 },
      ],
    });
    expect(r.status, r.text).toBe(200);
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it("R14-06: legacy createJournalEntry callers (invoice issue path) interleave with manual posts safely", async () => {
    const { storage } = await import("../../server/storage");
    const legacy = Array.from({ length: 15 }, (_, i) =>
      storage.generateEntryNumber(t.company.id, new Date()).then((entryNumber) =>
        storage.createJournalEntry(
          {
            companyId: t.company.id,
            date: new Date(),
            entryNumber,
            status: "posted",
            source: "invoice",
            createdBy: t.user.id,
          },
          [
            { accountId: a, debit: 10 + i, credit: 0 },
            { accountId: b, debit: 0, credit: 10 + i },
          ]
        )
      )
    );
    const manual = Array.from({ length: 15 }, (_, i) =>
      t.as.post(`/api/companies/${t.company.id}/journal`, {
        date: today(),
        status: "posted",
        lines: [
          { accountId: a, debit: 100 + i },
          { accountId: b, credit: 100 + i },
        ],
      })
    );
    const [legacyRes, manualRes] = await Promise.all([Promise.all(legacy), Promise.all(manual)]);
    expect(manualRes.map((r) => r.status)).toEqual(Array(15).fill(200));
    const all = [
      ...legacyRes.map((e) => e.entryNumber),
      ...manualRes.map((r) => r.body.entryNumber),
    ];
    expect(new Set(all).size).toBe(30);
    expect(await advisoryLocks()).toBe(0);
  }, 120_000);

  it("R14-06: no session-level advisory lock code remains in the storage/ledger sources", async () => {
    const fs = await import("node:fs");
    for (const f of [
      "server/storage.ts",
      "server/ledger/numbering.ts",
      "server/ledger/kernel.ts",
    ]) {
      const src = fs.readFileSync(f, "utf8");
      expect(src, f).not.toMatch(/pg_advisory_lock\(/);
      expect(src, f).not.toMatch(/pg_advisory_unlock\(/);
    }
  });
});
